import { createHash, randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { cpus, platform, release } from "node:os"
import { resolve } from "node:path"
import { AUTOROUTER_VERSION } from "../../lib/network/types"
import { compareReports, type BenchmarkReport } from "./compare"
import { readDatasetManifest, repositoryRoot } from "./data"

const BASELINE_BUNDLE_SHA256 = "25f50b7f73fd4b387f96a03e0e2672e9ca3a80c3ec567a9e0428e91dc9ce8e14"
const ORACLE_SHA256 = "53c0b0bd2d7e7499cd32d03d6708ff3662b7c49668d06f2f77ce069694a1ef75"
const modes = ["local", "cold", "hot"] as const
type Mode = typeof modes[number]
type Child = Pick<Bun.Subprocess, "pid" | "exitCode" | "kill" | "exited">
type ServiceStatus = { autorouterVersion: string; cacheEntries: number; stats: Record<string, number> }
type Service = { child: Child; url: string; output: Promise<void>; errors: Promise<string> }

/** Measure only the candidate; retain and explicitly identify historical baseline timing. */
export async function runCandidate(args: string[] = Bun.argv.slice(2)): Promise<void> {
  const options: Record<string, string> = {}
  const accepted = new Set(["baseline-dir", "baseline-module", "oracle", "output-dir"])
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!
    if (!flag.startsWith("--") || !accepted.has(flag.slice(2)) || args[index + 1] === undefined)
      throw new Error("Usage: bun scripts/benchmark/run-candidate.ts [--baseline-dir FROZEN_CONTROLLED_DIRECTORY] [--baseline-module BASELINE/dist/index.js] [--oracle BASELINE/dist/benchmark-oracle.js] [--output-dir DIRECTORY]")
    options[flag.slice(2)] = args[index + 1]!
  }
  const startedAt = new Date().toISOString()
  const outputDirectory = resolve(options["output-dir"] ?? resolve(repositoryRoot, "benchmarks", `candidate-${startedAt.replace(/[:.]/g, "-")}`))
  const baselineDirectory = resolve(options["baseline-dir"] ?? resolve(repositoryRoot, "benchmarks/controlled-final"))
  if (outputDirectory === baselineDirectory) throw new Error("Candidate output must not overwrite the frozen baseline directory")
  const defaults = resolve(repositoryRoot, ".benchmark/baseline/node_modules/@tscircuit/capacity-autorouter/dist")
  const baselineModule = resolve(options["baseline-module"] ?? resolve(defaults, "index.js"))
  const oracle = resolve(options.oracle ?? resolve(defaults, "benchmark-oracle.js"))
  const cacheNamespace = `minimal-rewrite-candidate-${randomUUID()}`
  const environment = { bun: Bun.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, concurrency: 1 }
  const failures: string[] = []
  const runs: Array<Record<string, unknown>> = []
  const serviceEvidence: Array<Record<string, unknown>> = []
  const comparisons: Record<string, unknown> = {}
  const baselines = new Map<Mode, BenchmarkReport>()
  const reports = new Map<Mode, BenchmarkReport>()
  const children = new Set<Child>()
  const expected = new Map<string, { sha256: string; path: string }>()
  const historicalFiles = new Map<string, string>()
  let baselineProvenance: Record<string, unknown> = { reused: true, timing: "historical", directory: baselineDirectory }
  let frozen: Record<string, string> = {}
  let service: Service | undefined
  let stopped = false, complete = false
  const fail = (message: string): void => { if (!failures.includes(message)) failures.push(message) }
  const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  const fileDigest = async (path: string) => digest(await readFile(path))
  await mkdir(outputDirectory, { recursive: true })
  async function writeJson(name: string, value: unknown): Promise<void> {
    const file = resolve(outputDirectory, name)
    await writeFile(`${file}.tmp`, JSON.stringify(value, null, 2) + "\n")
    await rename(`${file}.tmp`, file)
  }
  async function checkpoint(): Promise<void> {
    await writeJson("candidate-run.json", {
      version: 1, startedAt, updatedAt: new Date().toISOString(), complete,
      passed: complete && !failures.length && modes.every(mode => (comparisons[mode] as { passed?: boolean } | undefined)?.passed),
      comparisonMaximumTimeRatio: 1, baseline: baselineProvenance,
      runtime: { ...environment, executable: process.execPath },
      cacheNamespace, expectedSamples: { dataset01: 85, "dataset-srj18": 16 },
      baselineModule, oracle, sourceFingerprints: frozen, failures, serviceEvidence, runs, comparisons,
    })
  }
  async function treeDigest(directory: string): Promise<string> {
    const hash = createHash("sha256")
    const visit = async (directory: string): Promise<void> => {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) await visit(path)
        else if (/\.[cm]?[jt]sx?$/.test(entry.name))
          hash.update(path.slice(repositoryRoot.length)).update("\0").update(await readFile(path)).update("\0")
      }
    }
    await visit(directory)
    return hash.digest("hex")
  }
  async function fingerprints(): Promise<Record<string, string>> {
    const [lib, harness, rewriteService, baselineBundle, evaluator, datasetManifest, packageJson, lockfile] = await Promise.all([
      treeDigest(resolve(repositoryRoot, "lib")), treeDigest(resolve(repositoryRoot, "scripts/benchmark")),
      ...[resolve(repositoryRoot, "scripts/network-server.ts"), baselineModule, oracle,
        resolve(repositoryRoot, "datasets/manifest.json"), resolve(repositoryRoot, "package.json"), resolve(repositoryRoot, "bun.lock")].map(fileDigest),
    ])
    return { lib: lib!, harness: harness!, rewriteService: rewriteService!, baselineBundle: baselineBundle!,
      oracle: evaluator!, datasetManifest: datasetManifest!, packageJson: packageJson!, lockfile: lockfile! }
  }
  async function verifyInputBytes(): Promise<void> {
    for (const [name, sample] of expected)
      if (await fileDigest(sample.path) !== sample.sha256) throw new Error(`Original dataset bytes differ: ${name}`)
  }
  function verifyReport(report: BenchmarkReport, label: string, mode: Mode): void {
    if (!report.complete || report.results.length !== 101) throw new Error(`${label} must complete all 101 samples`)
    const observed = new Map(report.results.map(result => [`${result.dataset}/${result.sample}`, result.sha256]))
    if (observed.size !== expected.size || [...expected].some(([key, sample]) => observed.get(key) !== sample.sha256))
      throw new Error(`${label} sample coverage/hashes differ from the original manifest`)
    if (report.implementation?.sourceChangedDuringRun) throw new Error(`${label} source changed during measurement`)
    if (report.oracle.sha256 !== ORACLE_SHA256) throw new Error(`${label} uses a different DRC oracle`)
    if (report.cachePass !== (mode === "local" ? undefined : mode)) throw new Error(`${label} has the wrong cache pass`)
    if (report.implementation?.constructorName !== (mode === "local" ? "AutoroutingPipelineSolver9_PreloadedTraceGraph" : "AutoroutingPipelineSolver9_Networked"))
      throw new Error(`${label} uses a different public constructor`)
    for (const [key, value] of Object.entries(environment))
      if ((report.environment as unknown as Record<string, unknown>)[key] !== value) throw new Error(`${label} environment differs: ${key}`)
  }
  async function checkFrozen(where: string): Promise<void> {
    const current = await fingerprints()
    for (const key of Object.keys(frozen)) if (current[key] !== frozen[key]) throw new Error(`Source changed ${where}: ${key}`)
    for (const [path, sha256] of historicalFiles) if (await fileDigest(path) !== sha256) throw new Error(`Historical baseline changed ${where}: ${path}`)
    await verifyInputBytes()
  }
  function terminate(child: Child, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void {
    if (child.exitCode !== null) return
    try { process.kill(-child.pid, signal) } catch { child.kill(signal) }
  }
  const onSignal = (): void => {
    stopped = true
    fail("Candidate benchmark was interrupted")
    for (const child of children) terminate(child)
  }
  process.on("SIGINT", onSignal)
  process.on("SIGTERM", onSignal)
  async function status(url: string): Promise<ServiceStatus> {
    const response = await fetch(new URL("/benchmark-status", url), { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Service status returned HTTP ${response.status}`)
    const body = await response.json() as ServiceStatus
    if (body.autorouterVersion !== AUTOROUTER_VERSION || !Number.isInteger(body.cacheEntries) || body.cacheEntries < 0 ||
      !body.stats || !["batchRequests", "singleRequests", "solverRuns", "cacheHits", "capabilityRequests"].every(key => Number.isInteger(body.stats[key]) && body.stats[key]! >= 0))
      throw new Error("Candidate service status lacks matching version and complete counters")
    return body
  }
  async function startService(): Promise<Service> {
    await checkFrozen("before service startup")
    const child = Bun.spawn([process.execPath, resolve(repositoryRoot, "scripts/network-server.ts")], {
      cwd: repositoryRoot, detached: true, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, PORT: "0" },
    })
    children.add(child)
    let ready!: (url: string) => void
    const announced = new Promise<string>(resolve => { ready = resolve })
    const output = (async () => {
      const reader = child.stdout.getReader(), decoder = new TextDecoder()
      let pending = ""
      while (true) {
        const chunk = await reader.read(), text = decoder.decode(chunk.value, { stream: !chunk.done })
        if (text) await appendFile(resolve(outputDirectory, "rewrite-service.log"), text)
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
        child.exited.then(async code => { throw new Error(`Candidate service exited ${code}: ${(await errors).slice(-2000)}`) }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Candidate service startup timed out")), 15_000) }),
      ])
      const initial = await status(url)
      if (initial.cacheEntries !== 0 || Object.values(initial.stats).some(value => value !== 0)) throw new Error("Cold service did not start completely empty")
      await checkFrozen("after service startup")
      serviceEvidence.push({ event: "started-empty", at: new Date().toISOString(), pid: child.pid, url,
        cacheNamespace, sourceFingerprints: frozen, status: initial })
      await checkpoint()
      return { child, url, output, errors }
    } catch (error) { terminate(child); throw error }
    finally { if (timer) clearTimeout(timer) }
  }
  function auditNetwork(report: BenchmarkReport, mode: Exclude<Mode, "local">, before: ServiceStatus, after: ServiceStatus): void {
    const fields = ["remoteRequestsStarted", "remoteRequestsCompleted", "remoteCacheHits", "remoteSolverResults",
      "remoteTransportFallbacks", "remoteBatchRequestsStarted", "remoteSingleRequestsStarted", "remoteCapabilityRequests"] as const
    const totals = Object.fromEntries(fields.map(field => [field, 0]))
    const issues: string[] = []
    for (const result of report.results) {
      if (!result.networkAudit || !result.networkAudit.metricsAvailable || result.networkAudit.issues.length)
        issues.push(`${result.dataset}/${result.sample}: ${result.networkAudit?.issues.join("; ") || "missing remote audit"}`)
      for (const field of fields) {
        const value = result.networkStats?.[field]
        if (!Number.isInteger(value) || value! < 0) issues.push(`${result.sample}: missing ${field}`)
        else totals[field]! += value!
      }
    }
    const delta = Object.fromEntries(Object.keys(after.stats).map(key => [key, after.stats[key]! - (before.stats[key] ?? 0)]))
    serviceEvidence.push({ mode, at: new Date().toISOString(), cacheNamespace, before, after, delta, reportedCounters: totals, issues })
    if (totals.remoteRequestsStarted! < 101 || totals.remoteRequestsCompleted !== totals.remoteRequestsStarted || totals.remoteTransportFallbacks !== 0)
      issues.push("Not every board completed a real remote request without fallback")
    for (const [server, client] of [["batchRequests", "remoteBatchRequestsStarted"], ["singleRequests", "remoteSingleRequestsStarted"], ["capabilityRequests", "remoteCapabilityRequests"]])
      if (delta[server!] !== totals[client!]) issues.push(`Service/client call counters differ for ${server}`)
    if (mode === "cold") {
      if (before.cacheEntries !== 0 || delta.solverRuns !== totals.remoteRequestsStarted || delta.cacheHits !== 0 ||
        after.cacheEntries !== totals.remoteRequestsStarted || totals.remoteCacheHits !== 0 || totals.remoteSolverResults !== totals.remoteRequestsStarted)
        issues.push("Cold candidate service did not solve every requested input from its empty cache")
    } else if (delta.solverRuns !== 0 || after.cacheEntries !== before.cacheEntries || delta.cacheHits !== totals.remoteRequestsStarted ||
      totals.remoteCacheHits !== totals.remoteRequestsStarted || totals.remoteSolverResults !== 0)
      issues.push("Hot candidate service did not serve every requested result from cache with zero helper executions")
    if (issues.length) throw new Error(`${mode} network audit: ${issues.slice(0, 10).join("; ")}`)
  }
  async function execute(mode: Mode): Promise<void> {
    const output = resolve(outputDirectory, `${mode}-rewrite.json`)
    const item: Record<string, unknown> = { mode, output, startedAt: new Date().toISOString() }
    runs.push(item)
    await checkpoint()
    try {
      await checkFrozen(`before ${mode}`)
      let before: ServiceStatus | undefined
      if (mode !== "local") {
        if (mode === "hot" && !reports.get("cold")?.complete) throw new Error("Hot run has no completed cold predecessor")
        service ??= await startService()
        before = await status(service.url)
        if (mode === "cold" && before.cacheEntries !== 0) throw new Error("Cold cache was populated before the run")
      }
      const command = [process.execPath, resolve(import.meta.dir, "run.ts"), "--module", resolve(repositoryRoot, "lib/index.ts"),
        "--oracle", oracle, "--solver", mode === "local" ? "AutoroutingPipelineSolver9_PreloadedTraceGraph" : "AutoroutingPipelineSolver9_Networked",
        "--concurrency", "1", "--output", output]
      if (mode !== "local") command.push("--cache-pass", mode, "--options", JSON.stringify({ hdCache2ServerUrl: service!.url, hdCache2CacheVersion: cacheNamespace }))
      console.log(`Candidate ${mode}: all 101 original samples; historical baseline timing is reused`)
      const child = Bun.spawn(command, { cwd: repositoryRoot, detached: true, stdin: "ignore", stdout: "inherit", stderr: "inherit", env: process.env })
      children.add(child)
      const code = await child.exited
      children.delete(child)
      item.exitCode = code
      if (code !== 0) fail(`${mode} benchmark process exited ${code}`)
      const report = JSON.parse(await readFile(output, "utf8")) as BenchmarkReport
      reports.set(mode, report)
      item.complete = report.complete
      item.resultCount = report.results.length
      verifyReport(report, `Candidate ${mode}`, mode)
      if ((report.implementation as { sha256?: string }).sha256 !== frozen.lib) throw new Error(`${mode} worker measured a different candidate source`)
      if (before) auditNetwork(report, mode as "cold" | "hot", before, await status(service!.url))
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error)
      fail(`${mode}: ${item.error}`)
    } finally {
      try {
        const candidate = reports.get(mode)
        comparisons[mode] = candidate ? await compareReports(baselines.get(mode)!, candidate, 1)
          : { passed: false, failures: [`Missing ${mode} candidate report`] }
      } catch (error) { comparisons[mode] = { passed: false, failures: [String(error)] } }
      const baselineReport = resolve(baselineDirectory, `${mode}-baseline.json`)
      comparisons[mode] = { ...(comparisons[mode] as Record<string, unknown>),
        baselineTiming: "historical", baselineReport, baselineReportSha256: historicalFiles.get(baselineReport) }
      await writeJson(`comparison-${mode}-strict.json`, comparisons[mode])
      try { await checkFrozen(`after ${mode}`) } catch (error) { fail(String(error)) }
      item.finishedAt = new Date().toISOString()
      await checkpoint()
    }
  }
  try {
    await checkpoint()
    if (Bun.version !== "1.4.1" || process.platform === "win32") throw new Error("Candidate runs require Bun 1.4.1 on a POSIX host")
    const manifest = await readDatasetManifest()
    if (manifest.datasets.find(dataset => dataset.name === "dataset01")?.samples.length !== 85 ||
      manifest.datasets.find(dataset => dataset.name === "dataset-srj18")?.samples.length !== 16) throw new Error("Expected exactly 85 dataset01 and 16 dataset-srj18 samples")
    for (const dataset of manifest.datasets) for (const sample of dataset.samples)
      expected.set(`${dataset.name}/${sample.name}`, { sha256: sample.sha256, path: resolve(repositoryRoot, "datasets", sample.file) })
    if (expected.size !== 101) throw new Error("Duplicate manifest sample names")
    await verifyInputBytes()
    frozen = await fingerprints()
    if (frozen.baselineBundle !== BASELINE_BUNDLE_SHA256 || frozen.oracle !== ORACLE_SHA256) throw new Error("Baseline bundle or oracle differs from the pinned published 0.0.884 installation")
    const controlPath = resolve(baselineDirectory, "controlled-run.json"), controlBytes = await readFile(controlPath)
    historicalFiles.set(controlPath, digest(controlBytes))
    const control = JSON.parse(controlBytes.toString())
    if (!control.complete || !control.passed || control.failures?.length ||
      control.sourceFingerprints?.baselineBundle !== BASELINE_BUNDLE_SHA256 || control.sourceFingerprints?.oracle !== ORACLE_SHA256 ||
      control.sourceFingerprints?.datasetManifest !== frozen.datasetManifest) throw new Error("Historical control report does not certify the pinned baseline and original dataset manifest")
    const reportHashes: Record<string, string> = {}
    for (const mode of modes) {
      const path = resolve(baselineDirectory, `${mode}-baseline.json`), bytes = await readFile(path)
      historicalFiles.set(path, digest(bytes)); reportHashes[mode] = digest(bytes)
      const report = JSON.parse(bytes.toString()) as BenchmarkReport
      verifyReport(report, `Historical baseline ${mode}`, mode)
      if ((report.implementation as { sha256?: string }).sha256 !== BASELINE_BUNDLE_SHA256) throw new Error(`Historical ${mode} used a different baseline bundle`)
      baselines.set(mode, report)
    }
    baselineProvenance = { ...baselineProvenance, version: "0.0.884", embeddedNetworkVersion: "0.0.883",
      measurementStartedAt: control.startedAt, measurementFinishedAt: control.updatedAt,
      controlReportSha256: digest(controlBytes), reportSha256: reportHashes,
      originalSourceFingerprints: control.sourceFingerprints,
      reusedServiceEvidence: control.serviceEvidence.filter((entry: { flavor?: string }) => entry.flavor === "baseline"),
      caveat: "Baseline timings were measured previously on the matching recorded environment. They were not rerun alongside this candidate. Candidate local/cold/hot measurements are fresh and serialized.",
    }
    await checkpoint()
    for (const mode of modes) { if (stopped) break; await execute(mode) }
    complete = !stopped && runs.length === 3 && runs.every(run => run.complete === true)
  } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  finally {
    for (const child of children) terminate(child)
    const timer = setTimeout(() => { for (const child of children) terminate(child, "SIGKILL") }, 2000)
    await Promise.allSettled([...children].map(child => child.exited))
    clearTimeout(timer)
    if (service) {
      await service.output
      const errors = await service.errors
      if (errors) await appendFile(resolve(outputDirectory, "rewrite-service.log"), errors)
      serviceEvidence.push({ event: "stopped", at: new Date().toISOString(), pid: service.child.pid, exitCode: service.child.exitCode })
    }
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal)
    if (Object.keys(frozen).length) try { await checkFrozen("at finalization") } catch (error) { fail(String(error)) }
    await checkpoint()
  }
  console.log(`Candidate results: ${outputDirectory}; baseline timing explicitly reused from ${baselineDirectory}`)
  if (!complete || failures.length || modes.some(mode => !(comparisons[mode] as { passed?: boolean } | undefined)?.passed)) process.exitCode = stopped ? 130 : 1
}

if (import.meta.main) await runCandidate()
