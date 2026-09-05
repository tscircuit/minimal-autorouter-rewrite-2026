import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises"
import { cpus, platform, release } from "node:os"
import { dirname, resolve } from "node:path"
import { readDatasetManifest, repositoryRoot } from "./data"
import type { BenchmarkResult, BenchmarkTask } from "./types"
import { summarizeResults } from "./summarize"

const args = Bun.argv.slice(2)
const values: Record<string, string> = {}
const accepted = new Set(["module", "oracle", "dataset", "samples", "solver", "timeout", "concurrency", "output", "traces-dir", "options", "cache-pass"])
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index]!
  if (!flag.startsWith("--") || !accepted.has(flag.slice(2)) || args[index + 1] === undefined) {
    throw new Error(`Invalid benchmark option ${flag}`)
  }
  values[flag.slice(2)] = args[index + 1]!
}
const defaults = resolve(repositoryRoot, ".benchmark/baseline/node_modules/@tscircuit/capacity-autorouter/dist")
const modulePath = resolve(values.module ?? resolve(repositoryRoot, "lib/index.ts"))
const oraclePath = resolve(values.oracle ?? resolve(defaults, "benchmark-oracle.js"))
const outputPath = resolve(values.output ?? resolve(repositoryRoot, ".benchmark/results.json"))
const constructorName = values.solver ?? "AutoroutingPipelineSolver9_PreloadedTraceGraph"
const concurrency = Number(values.concurrency ?? 1)
const explicitTimeout = values.timeout === undefined ? undefined : Number(values.timeout)
if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("--concurrency must be a positive integer")
if (explicitTimeout !== undefined && (!Number.isFinite(explicitTimeout) || explicitTimeout <= 0)) throw new Error("--timeout must be positive milliseconds")
const solverOptions: Record<string, unknown> = values.options ? JSON.parse(values.options) : {}
const cachePass = values["cache-pass"] as "cold" | "hot" | undefined
if (cachePass && !["cold", "hot"].includes(cachePass)) throw new Error("--cache-pass must be cold or hot")
if (cachePass && !solverOptions.hdCache2CacheVersion && !process.env.HD_CACHE2_CACHE_VERSION) throw new Error("Networked cache pass requires an explicit cache version")
if (cachePass) {
  solverOptions.hdCache2CacheVersion ??= process.env.HD_CACHE2_CACHE_VERSION
  solverOptions.hdCache2ServerUrl ??= process.env.HD_CACHE2_SERVER_URL
}
const manifest = await readDatasetManifest()
const datasets = values.dataset ? values.dataset.split(",") : manifest.datasets.map((dataset) => dataset.name)
if (datasets.some((name) => !manifest.datasets.some((dataset) => dataset.name === name))) throw new Error("Only dataset01 and dataset-srj18 are authorized")
const selection = values.samples ? new Set(values.samples.split(",")) : undefined
const tasks: BenchmarkTask[] = []
for (const dataset of manifest.datasets) {
  if (!datasets.includes(dataset.name)) continue
  for (const sample of dataset.samples) {
    if (selection && !selection.has(sample.name)) continue
    const samplePath = resolve(repositoryRoot, "datasets", sample.file)
    const declaredEffort = JSON.parse(await readFile(samplePath, "utf8")).effort
    const effort = solverOptions.effort ?? declaredEffort
    const normalizedEffort = typeof effort === "number" && Number.isFinite(effort) && effort >= 1 ? effort : 1
    tasks.push({
      dataset: dataset.name, sample, samplePath, modulePath, oraclePath, constructorName,
      solverOptions, timeoutMs: explicitTimeout ?? 300_000 + 60_000 * normalizedEffort, cachePass,
      traceOutputPath: values["traces-dir"] ? resolve(values["traces-dir"], dataset.name, `${sample.name}.json`) : undefined,
    })
  }
}
if (tasks.length === 0) throw new Error("No matching samples")
if (selection) {
  const found = new Set(tasks.map((task) => task.sample.name))
  for (const sample of selection) if (!found.has(sample)) throw new Error(`Unknown selected sample ${sample}`)
}

function summarize(results: BenchmarkResult[]) {
  return summarizeResults(results, datasets).map(summary => ({
    ...summary, expected: tasks.filter(task => task.dataset === summary.dataset).length,
  }))
}

async function execute(task: BenchmarkTask): Promise<BenchmarkResult> {
  let lastProgress: Partial<BenchmarkResult> = {}
  let finalResult: BenchmarkResult | undefined
  let tail = ""
  let timedOut = false
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, "worker.ts")], {
    stdin: new Blob([JSON.stringify(task)]), stdout: "pipe", stderr: "pipe",
    env: process.env,
  })
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL") }, task.timeoutMs)
  const readOutput = async (): Promise<void> => {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let pending = ""
    while (true) {
      const { done, value } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      const lines = pending.split("\n")
      pending = lines.pop()!
      for (const line of lines) {
        if (line.startsWith("BENCHMARK_PROGRESS ")) lastProgress = JSON.parse(line.slice(19))
        else if (line.startsWith("BENCHMARK_RESULT ")) finalResult = JSON.parse(line.slice(17))
        else tail = (tail + line + "\n").slice(-4000)
      }
      if (done) break
    }
  }
  const stderr = new Response(child.stderr).text()
  try {
    await Promise.all([readOutput(), child.exited])
  } finally { clearTimeout(timer) }
  const errorText = await stderr
  if (finalResult) return finalResult
  return {
    dataset: task.dataset, sample: task.sample.name, sha256: task.sample.sha256,
    solver: task.constructorName, didSolve: false, didTimeout: timedOut,
    relaxedDrcPassed: false, elapsedTimeMs: timedOut ? task.timeoutMs : (lastProgress.elapsedTimeMs ?? 0),
    phase: lastProgress.phase, iterations: lastProgress.iterations,
    error: timedOut ? `Process exceeded ${task.timeoutMs} ms` : `Worker exited without a result: ${(errorText || tail).slice(-4000)}`,
  }
}

const startedAt = new Date().toISOString()
const results: BenchmarkResult[] = []
const oracleHash = createHash("sha256").update(await readFile(oraclePath)).digest("hex")
async function sourceFingerprint(): Promise<string> {
  const hash = createHash("sha256")
  if (modulePath !== resolve(repositoryRoot, "lib/index.ts")) {
    return hash.update(await readFile(modulePath)).digest("hex")
  }
  const visit = async (directory: string): Promise<void> => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        hash.update(path.slice(repositoryRoot.length)).update("\0").update(await readFile(path)).update("\0")
      }
    }
  }
  await visit(resolve(repositoryRoot, "lib"))
  return hash.digest("hex")
}
const initialSourceHash = await sourceFingerprint()
let sourceChangedDuringRun = false
await mkdir(dirname(outputPath), { recursive: true })
let nextTask = 0
let checkpoint = Promise.resolve()
async function save(): Promise<void> {
  sourceChangedDuringRun ||= initialSourceHash !== await sourceFingerprint()
  const snapshot = {
    version: 1, startedAt, updatedAt: new Date().toISOString(), complete: results.length === tasks.length,
    implementation: { modulePath, constructorName, solverOptions, sha256: initialSourceHash, sourceChangedDuringRun },
    oracle: { path: oraclePath, sha256: oracleHash },
    environment: { bun: Bun.version, platform: platform(), release: release(), cpu: cpus()[0]?.model, concurrency },
    timeout: explicitTimeout ?? "300000 + 60000 * effort", cachePass,
    datasets: manifest.datasets.filter((dataset) => datasets.includes(dataset.name)).map(({ samples, ...provenance }) => ({ ...provenance, sampleCount: samples.length })),
    summary: summarize(results), results: [...results].sort((a, b) => `${a.dataset}/${a.sample}`.localeCompare(`${b.dataset}/${b.sample}`)),
  }
  checkpoint = checkpoint.then(async () => {
    await writeFile(`${outputPath}.tmp`, JSON.stringify(snapshot, null, 2) + "\n")
    await rename(`${outputPath}.tmp`, outputPath)
  })
  await checkpoint
}
await save()
await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
  while (nextTask < tasks.length) {
    const task = tasks[nextTask++]!
    console.log(`Starting ${task.dataset}/${task.sample.name}`)
    const result = await execute(task)
    results.push(result)
    console.log(`${results.length}/${tasks.length} ${result.dataset}/${result.sample}: solved=${result.didSolve} drc=${result.relaxedDrcPassed} vias=${result.viaCount ?? "-"} ${Math.round(result.elapsedTimeMs)}ms${result.error ? ` ${result.error}` : ""}`)
    await save()
  }
}))
console.log(JSON.stringify(summarize(results), null, 2))
console.log(`Wrote ${outputPath}`)
