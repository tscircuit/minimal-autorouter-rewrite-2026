import { readFile } from "node:fs/promises"
import { acceptsKnownInvalidFailure, knownInvalidInput } from "./known-invalid-input"
import { summarizeResults } from "./summarize"
import type { BenchmarkResult } from "./types"

export interface BenchmarkReport {
  complete: boolean
  environment: { bun: string; platform: string; cpu: string; concurrency: number }
  oracle: { sha256: string }
  implementation?: { sourceChangedDuringRun?: boolean; constructorName?: string; solverOptions?: Record<string, unknown> }
  cachePass?: "cold" | "hot"
  timeout?: unknown
  results: BenchmarkResult[]
}

export async function compareReports(baseline: BenchmarkReport, candidate: BenchmarkReport, timeRatio = 1.1) {
  if (!Number.isFinite(timeRatio) || timeRatio <= 0) throw new Error("Maximum time ratio must be positive")
  const failures: string[] = []
  if (!baseline.complete || !candidate.complete) failures.push("Both benchmark runs must be complete")
  if (baseline.implementation?.sourceChangedDuringRun || candidate.implementation?.sourceChangedDuringRun) failures.push("An implementation changed during the benchmark run")
  if (baseline.oracle.sha256 !== candidate.oracle.sha256) failures.push("DRC oracle hashes differ")
  if (baseline.cachePass !== candidate.cachePass) failures.push("Network cache passes differ")
  if (JSON.stringify(baseline.timeout) !== JSON.stringify(candidate.timeout)) failures.push("Benchmark timeouts differ")
  const comparableOptions = (report: BenchmarkReport): string => {
    const options: Record<string, unknown> = {effort: 1, ...report.implementation?.solverOptions}
    delete options.hdCache2ServerUrl
    delete options.hdCache2CacheVersion
    return JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))))
  }
  if (comparableOptions(baseline) !== comparableOptions(candidate)) failures.push("Routing constructor options differ")
  if (Boolean(baseline.implementation?.constructorName?.includes("Networked")) !==
    Boolean(candidate.implementation?.constructorName?.includes("Networked"))) failures.push("Local and networked solver modes differ")
  for (const key of ["bun", "platform", "cpu", "concurrency"] as const) {
    if (baseline.environment[key] !== candidate.environment[key]) failures.push(`Benchmark environment differs: ${key}`)
  }
  const keyFor = (result: BenchmarkResult): string => `${result.dataset}/${result.sample}`
  const originals = new Map(baseline.results.map(result => [keyFor(result), result]))
  const candidates = new Map(candidate.results.map(result => [keyFor(result), result]))
  const acceptedInvalidInputFailures: Array<typeof knownInvalidInput & { baselineDidSolve: boolean; candidateDidSolve: boolean; baselineDrcErrorCount: number; candidateError: string; candidateWitness: unknown }> = []
  const ineligible = new Set<string>()
  if (originals.size !== baseline.results.length || candidates.size !== candidate.results.length) failures.push("Duplicate sample results")
  for (const [name, original] of originals) {
    const updated = candidates.get(name)
    if (!updated) { failures.push(`Missing candidate sample ${name}`); continue }
    if (original.sha256 !== updated.sha256) failures.push(`Sample bytes differ: ${name}`)
    if (original.relaxedDrcPassed && !updated.relaxedDrcPassed) failures.push(`Relaxed DRC regression: ${name}`)
    if (candidate.cachePass) {
      if (!updated.networkAudit) failures.push(`Missing candidate network audit: ${name}`)
      else for (const issue of updated.networkAudit.issues) failures.push(`Candidate network audit: ${name}: ${issue}`)
    }
    if (original.didSolve && !updated.didSolve) {
      let certified = false
      try { certified = await acceptsKnownInvalidFailure(original, updated) }
      catch (error) { failures.push(error instanceof Error ? error.message : String(error)) }
      if (!certified) failures.push(`Solve regression: ${name}`)
      else {
        ineligible.add(name)
        acceptedInvalidInputFailures.push({ ...knownInvalidInput, baselineDidSolve: original.didSolve, candidateDidSolve: updated.didSolve, baselineDrcErrorCount: original.drcErrorCount!, candidateError: updated.error!, candidateWitness: updated.inputContradiction ?? (updated.networkStats as Record<string, unknown> | undefined)?.terminalContradiction })
      }
    }
  }
  for (const name of candidates.keys()) if (!originals.has(name)) failures.push(`Unexpected candidate sample ${name}`)
  const datasets = [...new Set(baseline.results.map(result => result.dataset))]
  const raw = { baseline: summarizeResults(baseline.results, datasets), candidate: summarizeResults(candidate.results, datasets) }
  const eligible = {
    baseline: summarizeResults(baseline.results.filter(result => !ineligible.has(keyFor(result))), datasets),
    candidate: summarizeResults(candidate.results.filter(result => !ineligible.has(keyFor(result))), datasets),
  }
  for (const original of eligible.baseline) {
    const updated = eligible.candidate.find(summary => summary.dataset === original.dataset)!
    for (const metric of ["p50TimeMs", "p95TimeMs"] as const) {
      if (original[metric] !== null && (updated[metric] === null || updated[metric]! > original[metric]! * timeRatio)) failures.push(`${original.dataset} ${metric}: ${updated[metric]} exceeds ${timeRatio} × ${original[metric]}`)
    }
    if (original.avgVia !== null && (updated.avgVia === null || updated.avgVia > original.avgVia)) failures.push(`${original.dataset} avgVia: ${updated.avgVia} exceeds ${original.avgVia}`)
    if (updated.solved < original.solved || updated.relaxedDrcPassed < original.relaxedDrcPassed || updated.timedOut > original.timedOut) failures.push(`${original.dataset} eligible-input completion, DRC, or timeout regression`)
  }
  const networkAudit = candidate.cachePass ? {
    pass: candidate.cachePass,
    baselineIssues: baseline.results.filter(result => result.networkAudit?.issues.length).map(result => ({sample: keyFor(result), ...result.networkAudit})),
    candidateIssues: candidate.results.filter(result => result.networkAudit?.issues.length).map(result => ({sample: keyFor(result), ...result.networkAudit})),
  } : undefined
  return { passed: failures.length === 0, maximumTimeRatio: timeRatio, failures, raw, eligible, acceptedInvalidInputFailures, networkAudit }
}

if (import.meta.main) {
  const [baselineFile, candidateFile, timeRatioArgument] = Bun.argv.slice(2)
  if (!baselineFile || !candidateFile) throw new Error("Usage: bun scripts/benchmark/compare.ts BASELINE.json CANDIDATE.json [maximum-time-ratio=1.1]")
  const [baseline, candidate] = await Promise.all([baselineFile, candidateFile].map(async file => JSON.parse(await readFile(file, "utf8")) as BenchmarkReport))
  const result = await compareReports(baseline!, candidate!, Number(timeRatioArgument ?? 1.1))
  console.log(JSON.stringify(result, null, 2))
  if (!result.passed) process.exitCode = 1
}
