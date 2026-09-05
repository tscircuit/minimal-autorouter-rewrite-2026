import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { pathToFileURL } from "node:url"
import { readSample } from "./data"
import type { BenchmarkResult, BenchmarkSolver, BenchmarkTask, BenchmarkTrace } from "./types"

const task = JSON.parse(await Bun.stdin.text()) as BenchmarkTask
const result: BenchmarkResult = {
  dataset: task.dataset, sample: task.sample.name, sha256: task.sample.sha256,
  solver: task.constructorName, didSolve: false, didTimeout: false,
  relaxedDrcPassed: false, elapsedTimeMs: 0,
}

function traceLength(traces: BenchmarkTrace[]): number {
  let length = 0
  for (const trace of traces) {
    for (let index = 1; index < trace.route.length; index++) {
      const before = trace.route[index - 1]!
      const after = trace.route[index]!
      if (before.route_type === "wire" && after.route_type === "wire" && before.layer === after.layer) {
        length += Math.hypot(after.x - before.x, after.y - before.y)
      }
    }
  }
  return length
}

try {
  const input = await readSample(task.samplePath, task.sample)
  const implementation = await import(pathToFileURL(task.modulePath).href)
  const oracle = await import(pathToFileURL(task.oraclePath).href)
  if (typeof implementation[task.constructorName] !== "function") {
    throw new Error(`Missing public constructor ${task.constructorName}`)
  }
  if (typeof oracle.evaluateRelaxedDrc !== "function") throw new Error("DRC oracle is unavailable")
  const options = { ...task.solverOptions }
  if (options.effort === undefined && Number.isFinite(input.effort) && input.effort >= 1) {
    options.effort = input.effort
  }
  const solver = new implementation[task.constructorName](structuredClone(input), options) as BenchmarkSolver
  const start = performance.now()
  let lastProgressAt = start
  const progress = (): void => {
    const now = performance.now()
    if (now - lastProgressAt < 1000) return
    lastProgressAt = now
    console.log("BENCHMARK_PROGRESS " + JSON.stringify({
      elapsedTimeMs: now - start, iterations: solver.iterations,
      phase: solver.pipelineDef?.[solver.currentPipelineStepIndex ?? 0]?.solverName,
    }))
  }
  let solveError: unknown
  try {
    if (solver.solveAsync) {
      const interval = setInterval(progress, 1000)
      try { await solver.solveAsync() } finally { clearInterval(interval) }
    } else {
      while (!solver.solved && !solver.failed) { solver.step(); progress() }
    }
  } catch (error) { solveError = error }
  result.elapsedTimeMs = performance.now() - start
  result.didSolve = solver.solved && !solveError
  result.iterations = solver.iterations
  result.phase = solver.pipelineDef?.[solver.currentPipelineStepIndex ?? 0]?.solverName
  result.phaseTimeMs = solver.timeSpentOnPhase
  result.networkStats = solver.highDensityRouteSolver?.stats
  result.inputContradiction = (solver.highDensityRouteSolver?.stats as Record<string, unknown> | undefined)?.terminalContradiction
  if (task.cachePass) {
    await solver.highDensityRouteSolver?.waitForAllRemoteRequests?.()
    result.networkStats = solver.highDensityRouteSolver?.stats
    const stats = result.networkStats
    const issues: string[] = []
    const metricsAvailable = !!stats && Number.isFinite(stats.remoteRequestsStarted) &&
      Number.isFinite(stats.remoteTransportFallbacks) && Number.isFinite(stats.remoteCacheHits)
    if (!metricsAvailable) issues.push("No complete remote metrics were exposed")
    else if (stats) {
      if (stats.remoteRequestsStarted < 1) issues.push("No remote solve was requested")
      if (stats.remoteTransportFallbacks > 0) issues.push(`${stats.remoteTransportFallbacks} requests fell back to local routing`)
      if (task.cachePass === "hot" && (stats.remoteBatchCacheMisses > 0 || stats.remoteSolverResults > 0 || stats.remoteCacheHits !== stats.remoteRequestsStarted)) {
        issues.push("Hot pass did not accept every requested result from cache")
      }
    }
    // Transport qualification must never overwrite the actual solver outcome.
    // The pinned baseline can reject its own helper's output and finish locally.
    result.networkAudit = {metricsAvailable, issues}
  }
  if (!result.didSolve) {
    result.error = solveError instanceof Error ? solveError.message : String(solveError ?? solver.error ?? "Solver did not solve")
  } else {
    const traces = solver.getOutputSimplifiedPcbTraces()
    result.traceCount = traces.length
    result.viaCount = traces.reduce((count, trace) => count + trace.route.filter((point) => point.route_type === "via").length, 0)
    result.traceLengthMm = traceLength(traces)
    const drcStart = performance.now()
    const evaluated = oracle.evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs ?? input, routedTraces: traces })
    result.drcTimeMs = performance.now() - drcStart
    result.drcErrorCount = evaluated.errors.length
    result.relaxedDrcPassed = evaluated.errors.length === 0
    result.drcErrorTypes = {}
    for (const error of evaluated.errors) {
      const kind = error.error_type ?? error.type ?? "unknown"
      result.drcErrorTypes![kind] = (result.drcErrorTypes![kind] ?? 0) + 1
    }
    result.drcErrorExamples = evaluated.errors.slice(0, 5)
    if (task.traceOutputPath) {
      await mkdir(dirname(task.traceOutputPath), { recursive: true })
      try {
        await writeFile(task.traceOutputPath, JSON.stringify({ traces, errors: evaluated.errors }, null, 2) + "\n")
      } catch (error) {
        result.error = `Trace artifact write failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error)
  result.relaxedDrcPassed = false
}
console.log("BENCHMARK_RESULT " + JSON.stringify(result))
