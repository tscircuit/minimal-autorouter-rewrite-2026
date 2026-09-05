import type { BenchmarkResult } from "./types"

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * fraction
  return sorted[Math.floor(index)]! + (sorted[Math.ceil(index)]! - sorted[Math.floor(index)]!) * (index - Math.floor(index))
}

export function summarizeResults(results: BenchmarkResult[], datasets = [...new Set(results.map(result => result.dataset))]) {
  return datasets.map(dataset => {
    const selected = results.filter(result => result.dataset === dataset)
    const solved = selected.filter(result => result.didSolve)
    const times = selected.filter(result => result.didSolve || result.didTimeout).map(result => result.elapsedTimeMs)
    const vias = solved.flatMap(result => typeof result.viaCount === "number" ? [result.viaCount] : [])
    const lengths = solved.flatMap(result => typeof result.traceLengthMm === "number" ? [result.traceLengthMm] : [])
    return {
      dataset, completed: selected.length, solved: solved.length,
      relaxedDrcPassed: solved.filter(result => result.relaxedDrcPassed).length,
      timedOut: selected.filter(result => result.didTimeout).length,
      p50TimeMs: percentile(times, 0.5), p95TimeMs: percentile(times, 0.95),
      avgVia: vias.length ? vias.reduce((a, b) => a + b, 0) / vias.length : null,
      avgTraceLengthMm: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : null,
    }
  })
}
