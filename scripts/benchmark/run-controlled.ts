import { createHash, randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { compareReports, type BenchmarkReport } from "./compare"
import { readDatasetManifest, repositoryRoot } from "./data"

type ManagedChild = Pick<Bun.Subprocess, "pid" | "exitCode" | "kill" | "exited">
type ServiceStatus = { autorouterVersion: string; cacheEntries: number; moduleSha256?: string; stats: Record<string, number> }
type Service = { child: ManagedChild; url: string; output: Promise<void>; errors: Promise<string>; initial: ServiceStatus }
type Flavor = "rewrite" | "baseline"
type Mode = "local" | "cold" | "hot"

/** Execute six serialized, fully covered runs without installing any dependencies. */
export async function runControlled(args: string[] = Bun.argv.slice(2)): Promise<void> {
  if (Bun.version !== "1.4.1") throw new Error(`Controlled runs require Bun 1.4.1; current runtime is ${Bun.version} at ${process.execPath}`)
  if (process.platform === "win32") throw new Error("Controlled process-group cleanup currently requires a POSIX host")
  const options: Record<string, string> = {}
  const accepted = new Set(["baseline-module", "oracle", "output-dir"])
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!
    if (!flag.startsWith("--") || !accepted.has(flag.slice(2)) || args[index + 1] === undefined) throw new Error("Usage: bun scripts/benchmark/run-controlled.ts [--baseline-module BASELINE/dist/index.js] [--oracle BASELINE/dist/benchmark-oracle.js] [--output-dir DIRECTORY]")
    options[flag.slice(2)] = args[index + 1]!
  }
  const defaults = resolve(repositoryRoot, ".benchmark/baseline/node_modules/@tscircuit/capacity-autorouter/dist")
  const baselineModule = resolve(options["baseline-module"] ?? resolve(defaults, "index.js"))
  const oracle = resolve(options.oracle ?? resolve(defaults, "benchmark-oracle.js"))
  const startedAt = new Date().toISOString()
  const outputDirectory = resolve(options["output-dir"] ?? resolve(repositoryRoot, "benchmarks", `controlled-${startedAt.replace(/[:.]/g, "-")}`))
  await mkdir(outputDirectory, { recursive: true })
  const manifest = await readDatasetManifest()
  const expected = new Map(manifest.datasets.flatMap(dataset => dataset.samples.map(sample => [`${dataset.name}/${sample.name}`, sample.sha256] as const)))
  if (manifest.datasets.find(dataset => dataset.name === "dataset01")?.samples.length !== 85 || manifest.datasets.find(dataset => dataset.name === "dataset-srj18")?.samples.length !== 16 || expected.size !== 101) throw new Error("Controlled runs require all 85 dataset01 and all 16 dataset-srj18 samples")
  const namespace = `minimal-rewrite-controlled-${randomUUID()}`
  const digest = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex")
  async function treeDigest(directory: string): Promise<string> {
    const hash = createHash("sha256")
    const visit = async (directory: string): Promise<void> => {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) await visit(path)
        else if (/\.[cm]?[jt]sx?$/.test(entry.name)) hash.update(path.slice(repositoryRoot.length)).update("\0").update(await readFile(path)).update("\0")
      }
    }
    await visit(directory)
    return hash.digest("hex")
  }
  async function fingerprints() {
    const [lib, harness, rewriteService, baselineService, baselineBundle, evaluator, datasetManifest] = await Promise.all([
      treeDigest(resolve(repositoryRoot, "lib")), treeDigest(resolve(repositoryRoot, "scripts/benchmark")),
      ...[resolve(repositoryRoot, "scripts/network-server.ts"), resolve(import.meta.dir, "baseline-network-server.ts"), baselineModule, oracle, resolve(repositoryRoot, "datasets/manifest.json")].map(async file => digest(await readFile(file))),
    ])
    return { lib, harness, rewriteService, baselineService, baselineBundle, oracle: evaluator, datasetManifest }
  }
  const frozen = await fingerprints()
  const failures: string[] = []
  const runs: Array<Record<string, unknown>> = []
  const serviceEvidence: Record<string, unknown>[] = []
  const comparisons: Record<string, Awaited<ReturnType<typeof compareReports>> | { passed: false; failures: string[] }> = {}
  const reports = new Map<string, BenchmarkReport>()
  const services = new Map<Flavor, Service>()
  const children = new Set<ManagedChild>()
  let stopped = false, completed = false
  const fail = (message: string): void => { if (!failures.includes(message)) failures.push(message) }
  async function writeJson(file: string, value: unknown): Promise<void> {
    await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n")
    await rename(`${file}.tmp`, file)
  }
  async function checkpoint(): Promise<void> {
    await writeJson(resolve(outputDirectory, "controlled-run.json"), {
      version: 1, startedAt, updatedAt: new Date().toISOString(), complete: completed,
      passed: completed && !failures.length && Object.keys(comparisons).length === 3 && Object.values(comparisons).every(comparison => comparison.passed),
      runtime: { version: Bun.version, executable: process.execPath, concurrency: 1 },
      cacheNamespace: namespace, expectedSamples: { dataset01: 85, "dataset-srj18": 16 },
      baselineModule, oracle, sourceFingerprints: frozen, failures, serviceEvidence, runs, comparisons,
    })
  }
  async function checkFrozen(where: string): Promise<void> {
    const current = await fingerprints()
    for (const key of Object.keys(frozen) as Array<keyof typeof frozen>) if (current[key] !== frozen[key]) fail(`Source changed ${where}: ${key}`)
  }
  function terminate(child: ManagedChild, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void {
    if (child.exitCode !== null) return
    // Every tracked child owns a fresh process group. This also stops run.ts workers.
    try { process.kill(-child.pid, signal) } catch { child.kill(signal) }
  }
  const onSignal = (): void => {
    stopped = true
    fail("Controlled run was interrupted")
    for (const child of children) terminate(child)
  }
  process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal)

  async function status(service: Pick<Service, "url">): Promise<ServiceStatus> {
    const response = await fetch(new URL("/benchmark-status", service.url), { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Service status returned HTTP ${response.status}`)
    const body = await response.json() as ServiceStatus
    if (!Number.isInteger(body.cacheEntries) || body.cacheEntries < 0 || !body.stats || !["batchRequests", "singleRequests", "solverRuns", "cacheHits"].every(key => Number.isFinite(body.stats[key]))) throw new Error("Service status lacks complete counters")
    return body
  }
  async function startService(flavor: Flavor): Promise<Service> {
    await checkFrozen(`before ${flavor} service startup`)
    const command = flavor === "baseline"
      ? [process.execPath, resolve(import.meta.dir, "baseline-network-server.ts"), "--module", baselineModule, "--port", "0"]
      : [process.execPath, resolve(repositoryRoot, "scripts/network-server.ts")]
    const child = Bun.spawn(command, { cwd: repositoryRoot, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, PORT: "0" } })
    children.add(child)
    let ready!: (url: string) => void
    const announced = new Promise<string>(resolve => { ready = resolve })
    const output = (async () => {
      const reader = child.stdout.getReader(), decoder = new TextDecoder()
      let pending = ""
      while (true) {
        const chunk = await reader.read()
        const text = decoder.decode(chunk.value, { stream: !chunk.done })
        if (text) await appendFile(resolve(outputDirectory, `${flavor}-service.log`), text)
        pending += text
        for (const line of pending.split("\n").slice(0, -1)) {
          const match = line.match(/http:\/\/127\.0\.0\.1:\d+\//)
          if (match) ready(match[0])
        }
        pending = pending.slice(pending.lastIndexOf("\n") + 1)
        if (chunk.done) break
      }
    })()
    const errors = new Response(child.stderr).text()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const url = await Promise.race([
        announced,
        child.exited.then(async code => { throw new Error(`${flavor} service exited ${code}: ${(await errors).slice(-2000)}`) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${flavor} service startup timed out`)), 15_000) }),
      ])
      const service: Service = { child, url, output, errors, initial: await status({ url }) }
      const version = flavor === "baseline" ? "0.0.883" : "0.1.0"
      if (service.initial.autorouterVersion !== version) throw new Error(`${flavor} service announced the wrong protocol version`)
      if (flavor === "baseline" && service.initial.moduleSha256 !== frozen.baselineBundle) throw new Error("Baseline service loaded a different published bundle")
      if (service.initial.cacheEntries !== 0 || service.initial.stats.solverRuns !== 0 || service.initial.stats.cacheHits !== 0) throw new Error(`${flavor} cold service did not start empty`)
      services.set(flavor, service)
      await checkFrozen(`after ${flavor} service startup`)
      serviceEvidence.push({ flavor, event: "started-empty", at: new Date().toISOString(), pid: child.pid, url, namespace, sourceFingerprints: frozen, status: service.initial })
      await checkpoint()
      return service
    } catch (error) { terminate(child); throw error }
    finally { if (timer) clearTimeout(timer) }
  }

  async function execute(flavor: Flavor, mode: Mode): Promise<void> {
    const name = `${mode}-${flavor}`, output = resolve(outputDirectory, `${name}.json`)
    const item: Record<string, unknown> = { name, flavor, mode, output, startedAt: new Date().toISOString() }
    runs.push(item)
    await checkpoint()
    try {
      await checkFrozen(`before ${name}`)
      let service: Service | undefined, before: ServiceStatus | undefined
      if (mode !== "local") {
        service = services.get(flavor) ?? await startService(flavor)
        before = await status(service)
        if (mode === "cold" && before.cacheEntries !== 0) fail(`${name} service cache was populated before the cold run`)
        if (mode === "hot" && !reports.has(`cold-${flavor}`)) fail(`${name} has no completed cold predecessor`)
      }
      const solver = mode === "local" ? "AutoroutingPipelineSolver9_PreloadedTraceGraph" : "AutoroutingPipelineSolver9_Networked"
      const command = [process.execPath, resolve(import.meta.dir, "run.ts"), "--module", flavor === "baseline" ? baselineModule : resolve(repositoryRoot, "lib/index.ts"), "--oracle", oracle, "--solver", solver, "--concurrency", "1", "--output", output]
      if (service) command.push("--cache-pass", mode, "--options", JSON.stringify({ hdCache2ServerUrl: service.url, hdCache2CacheVersion: namespace }))
      console.log(`Controlled ${name}: all 101 authorized samples`)
      const child = Bun.spawn(command, { cwd: repositoryRoot, detached: true, stdin: "ignore", stdout: "inherit", stderr: "inherit", env: process.env })
      children.add(child)
      const exitCode = await child.exited
      children.delete(child)
      item.exitCode = exitCode
      if (exitCode !== 0) fail(`${name} benchmark process exited ${exitCode}`)
      const report = JSON.parse(await readFile(output, "utf8")) as BenchmarkReport
      reports.set(name, report)
      item.complete = report.complete
      item.resultCount = report.results.length
      if (!report.complete || report.results.length !== 101) fail(`${name} did not complete all 101 samples`)
      const observed = new Map(report.results.map(result => [`${result.dataset}/${result.sample}`, result.sha256]))
      if (observed.size !== expected.size || [...expected].some(([key, hash]) => observed.get(key) !== hash)) fail(`${name} sample coverage or hashes differ from the full authorized manifest`)
      if (report.implementation?.sourceChangedDuringRun) fail(`${name} implementation changed during its run`)
      if (service && before) {
        const after = await status(service)
        const delta = Object.fromEntries(Object.keys(after.stats).map(key => [key, after.stats[key]! - (before.stats[key] ?? 0)]))
        const requests = report.results.reduce((total, result) => total + (result.networkStats?.remoteRequestsStarted ?? 0), 0)
        serviceEvidence.push({ flavor, mode, namespace, before, after, delta, reportedRemoteRequests: requests, at: new Date().toISOString() })
        if (mode === "cold" && delta.solverRuns! < 1) fail(`${name} did not execute a remote helper from its empty cache`)
        if (mode === "hot") {
          if (delta.solverRuns !== 0) fail(`${name} hot service executed ${delta.solverRuns} helpers`)
          if (delta.cacheHits !== requests || requests < 1) fail(`${name} hot cache hits ${delta.cacheHits} do not account for all ${requests} requested results`)
        }
      }
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error)
      fail(`${name}: ${item.error}`)
    } finally {
      item.finishedAt = new Date().toISOString()
      try { await checkFrozen(`after ${name}`) } catch (error) { fail(`Could not recheck sources after ${name}: ${String(error)}`) }
      await checkpoint()
    }
  }

  try {
    await checkpoint()
    for (const mode of ["local", "cold", "hot"] as const) {
      for (const flavor of ["rewrite", "baseline"] as const) {
        if (stopped) break
        await execute(flavor, mode)
      }
      const baseline = reports.get(`${mode}-baseline`), candidate = reports.get(`${mode}-rewrite`)
      try {
        comparisons[mode] = baseline && candidate ? await compareReports(baseline, candidate) : { passed: false, failures: [`Missing ${mode} report(s)`] }
      } catch (error) { comparisons[mode] = { passed: false, failures: [String(error)] } }
      await writeJson(resolve(outputDirectory, `comparison-${mode}.json`), comparisons[mode])
      await checkpoint()
      if (stopped) break
    }
    completed = !stopped && runs.length === 6 && runs.every(run => run.complete === true)
  } finally {
    for (const child of children) terminate(child)
    const killTimer = setTimeout(() => { for (const child of children) terminate(child, "SIGKILL") }, 2000)
    await Promise.allSettled([...children].map(child => child.exited))
    clearTimeout(killTimer)
    for (const [flavor, service] of services) {
      await service.output
      const errors = await service.errors
      if (errors) await appendFile(resolve(outputDirectory, `${flavor}-service.log`), errors)
    }
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal)
    await checkpoint()
  }
  console.log(`Controlled results: ${outputDirectory}`)
  if (!completed || failures.length || Object.values(comparisons).some(comparison => !comparison.passed)) process.exitCode = stopped ? 130 : 1
}

if (import.meta.main) await runControlled()
