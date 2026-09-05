import { readFile } from "node:fs/promises"
import type { BenchmarkResult } from "./types"

interface Report {
  complete: boolean
  environment: { bun: string; platform: string; cpu: string; concurrency: number }
  oracle: { sha256: string }
  implementation?: { sourceChangedDuringRun?: boolean }
  summary: Array<{ dataset: string; solved: number; relaxedDrcPassed: number; timedOut: number; p50TimeMs: number | null; p95TimeMs: number | null; avgVia: number | null }>
  results: BenchmarkResult[]
}

const [baselineFile, candidateFile, timeRatioArgument] = Bun.argv.slice(2)
if (!baselineFile || !candidateFile) throw new Error("Usage: bun scripts/benchmark/compare.ts BASELINE.json CANDIDATE.json [maximum-time-ratio=1.1]")
const baseline = JSON.parse(await readFile(baselineFile, "utf8")) as Report
const candidate = JSON.parse(await readFile(candidateFile, "utf8")) as Report
const timeRatio = Number(timeRatioArgument ?? 1.1)
if (!Number.isFinite(timeRatio) || timeRatio <= 0) throw new Error("Maximum time ratio must be positive")
const failures: string[] = []
if (!baseline.complete || !candidate.complete) failures.push("Both benchmark runs must be complete")
if (baseline.implementation?.sourceChangedDuringRun || candidate.implementation?.sourceChangedDuringRun) failures.push("An implementation changed during the benchmark run")
if (baseline.oracle.sha256 !== candidate.oracle.sha256) failures.push("DRC oracle hashes differ")
for (const key of ["bun", "platform", "cpu", "concurrency"] as const) {
  if (baseline.environment[key] !== candidate.environment[key]) failures.push(`Benchmark environment differs: ${key}`)
}
const keyFor = (result: BenchmarkResult): string => `${result.dataset}/${result.sample}`
const originals = new Map(baseline.results.map((result) => [keyFor(result), result]))
const candidates = new Map(candidate.results.map((result) => [keyFor(result), result]))
if (originals.size !== baseline.results.length || candidates.size !== candidate.results.length) failures.push("Duplicate sample results")
for (const [name, original] of originals) {
  const updated = candidates.get(name)
  if (!updated) { failures.push(`Missing candidate sample ${name}`); continue }
  if (original.sha256 !== updated.sha256) failures.push(`Sample bytes differ: ${name}`)
  if (original.didSolve && !updated.didSolve) failures.push(`Solve regression: ${name}`)
  if (original.relaxedDrcPassed && !updated.relaxedDrcPassed) failures.push(`Relaxed DRC regression: ${name}`)
}
for (const name of candidates.keys()) if (!originals.has(name)) failures.push(`Unexpected candidate sample ${name}`)
for (const original of baseline.summary) {
  const updated = candidate.summary.find((summary) => summary.dataset === original.dataset)
  if (!updated) { failures.push(`Missing dataset summary ${original.dataset}`); continue }
  for (const metric of ["p50TimeMs", "p95TimeMs"] as const) {
    if (original[metric] !== null && (updated[metric] === null || updated[metric]! > original[metric]! * timeRatio)) {
      failures.push(`${original.dataset} ${metric}: ${updated[metric]} exceeds ${timeRatio} × ${original[metric]}`)
    }
  }
  if (original.avgVia !== null && (updated.avgVia === null || updated.avgVia > original.avgVia)) {
    failures.push(`${original.dataset} avgVia: ${updated.avgVia} exceeds ${original.avgVia}`)
  }
  if (updated.solved < original.solved || updated.relaxedDrcPassed < original.relaxedDrcPassed || updated.timedOut > original.timedOut) {
    failures.push(`${original.dataset} aggregate completion, DRC, or timeout regression`)
  }
}
console.log(JSON.stringify({ passed: failures.length === 0, maximumTimeRatio: timeRatio, failures }, null, 2))
if (failures.length) process.exitCode = 1
