import { expect, test } from "bun:test"
import { compareReports, type BenchmarkReport } from "../../scripts/benchmark/compare"
import { knownInvalidInput, verifyKnownInvalidInput } from "../../scripts/benchmark/known-invalid-input"
import type { BenchmarkResult } from "../../scripts/benchmark/types"

const result = (overrides: Partial<BenchmarkResult> = {}): BenchmarkResult => ({
  dataset: "dataset-srj18", sample: "sample003", sha256: "same-synthetic-result-hash",
  solver: "Pipeline9", didSolve: true, didTimeout: false, relaxedDrcPassed: true,
  elapsedTimeMs: 100, drcErrorCount: 0, viaCount: 4, ...overrides,
})
const report = (...results: BenchmarkResult[]): BenchmarkReport => ({
  complete: true, environment: { bun: "1.4.1", platform: "darwin", cpu: "same", concurrency: 1 },
  oracle: { sha256: "same-oracle" }, results,
})
const invalidPair = (): [BenchmarkResult, BenchmarkResult] => [
  result({ ...knownInvalidInput, relaxedDrcPassed: false, drcErrorCount: 6 }),
  result({ ...knownInvalidInput, didSolve: false, relaxedDrcPassed: false, drcErrorCount: undefined,
    error: "Terminal pcb_port_183 lies inside unrelated copper pcb_smtpad_62 on every eligible layer",
    inputContradiction: { kind: "terminal-inside-unrelated-copper", terminalNet: "source_net_15",
      terminal: { pcb_port_id: "pcb_port_183", x: -1.843115, y: -5.06532 }, eligibleLayers: ["top"],
      blockingObstacles: [{ layer: "top", obstacleId: "pcb_smtpad_62" }] },
  }),
]

test("every DRC-pass sample must continue passing, even if aggregate successes increase", async () => {
  const baseline = report(result(), result({ sample: "sample004", relaxedDrcPassed: false, drcErrorCount: 1 }))
  const candidate = report(result({ didSolve: false, relaxedDrcPassed: false }), result({ sample: "sample004" }))
  const compared = await compareReports(baseline, candidate)
  expect(compared.passed).toBe(false)
  expect(compared.failures).toContain("Relaxed DRC regression: dataset-srj18/sample003")
})

test("the exact fixed-input short can explain honest failure while raw counts remain visible", async () => {
  expect((await verifyKnownInvalidInput()).terminalNetAliases).toContain("pcb_port_183")
  const [baseline, candidate] = invalidPair()
  const compared = await compareReports(report(result(), baseline), report(result(), candidate))
  expect(compared.passed).toBe(true)
  expect(compared.raw.baseline[0]!.solved).toBe(2)
  expect(compared.raw.candidate[0]!.solved).toBe(1)
  expect(compared.eligible.baseline[0]!.solved).toBe(1)
  expect(compared.eligible.candidate[0]!.solved).toBe(1)
  expect(compared.acceptedInvalidInputFailures).toHaveLength(1)
  expect(compared.acceptedInvalidInputFailures[0]).toMatchObject({ ...knownInvalidInput, baselineDrcErrorCount: 6, candidateDidSolve: false })
})

test("certificate never overrides a claimed baseline DRC pass", async () => {
  const [baseline, candidate] = invalidPair()
  baseline.relaxedDrcPassed = true
  baseline.drcErrorCount = 0
  const compared = await compareReports(report(baseline), report(candidate))
  expect(compared.passed).toBe(false)
  expect(compared.failures).toContain("Relaxed DRC regression: dataset-srj18/sample016")
  expect(compared.acceptedInvalidInputFailures).toHaveLength(0)
})

test("baseline transport defects remain visible without erasing actual solved and DRC outcomes", async () => {
  const baseline = {...report(result({networkAudit: {metricsAvailable: true,
    issues: ["1 requests fell back to local routing"]}})), cachePass: "hot" as const}
  const candidate = {...report(result({networkAudit: {metricsAvailable: true, issues: []}})), cachePass: "hot" as const}
  const compared = await compareReports(baseline, candidate)
  expect(compared.passed).toBe(true)
  expect(compared.raw.baseline[0]!.solved).toBe(1)
  expect(compared.raw.baseline[0]!.relaxedDrcPassed).toBe(1)
  expect(compared.networkAudit!.baselineIssues).toHaveLength(1)
  candidate.results[0]!.networkAudit!.issues.push("1 requests fell back to local routing")
  expect((await compareReports(baseline, candidate)).passed).toBe(false)
})

test("cache state and timeout mismatches cannot pass the comparison", async () => {
  const baseline = {...report(result()), cachePass: "cold" as const, timeout: 360000}
  const candidate = {...report(result()), cachePass: "hot" as const, timeout: 720000}
  const compared = await compareReports(baseline, candidate)
  expect(compared.failures).toContain("Network cache passes differ")
  expect(compared.failures).toContain("Benchmark timeouts differ")
})

test("network failures are audited and different routing effort cannot pass", async () => {
  const failed = result({didSolve: false, relaxedDrcPassed: false})
  const baseline = {...report(failed), cachePass: "hot" as const,
    implementation: {solverOptions: {effort: 1}}}
  const candidate = {...report({...failed, networkAudit: {metricsAvailable: true,
    issues: ["1 requests fell back to local routing"]}}), cachePass: "hot" as const,
    implementation: {solverOptions: {effort: 2}}}
  const compared = await compareReports(baseline, candidate)
  expect(compared.failures).toContain("Routing constructor options differ")
  expect(compared.failures.some(issue => issue.startsWith("Candidate network audit"))).toBe(true)
})

test.each([
  ["both hashes changed", (a: BenchmarkResult, b: BenchmarkResult) => { a.sha256 = b.sha256 = "different-bytes" }],
  ["only candidate hash changed", (_a: BenchmarkResult, b: BenchmarkResult) => { b.sha256 = "different-bytes" }],
  ["different sample", (a: BenchmarkResult, b: BenchmarkResult) => { a.sample = b.sample = "sample002" }],
  ["missing witness", (_a: BenchmarkResult, b: BenchmarkResult) => { delete b.inputContradiction }],
  ["arbitrary failure", (_a: BenchmarkResult, b: BenchmarkResult) => { b.error = "Could not route" }],
  ["timeout", (_a: BenchmarkResult, b: BenchmarkResult) => { b.didTimeout = true }],
  ["wrong electrical identity", (_a: BenchmarkResult, b: BenchmarkResult) => { (b.inputContradiction as any).terminalNet = "source_net_12" }],
  ["wrong layer", (_a: BenchmarkResult, b: BenchmarkResult) => { (b.inputContradiction as any).eligibleLayers = ["bottom"] }],
] as const)("invalid-input exception rejects %s", async (_name, alter) => {
  const [baseline, candidate] = invalidPair()
  alter(baseline, candidate)
  const compared = await compareReports(report(baseline), report(candidate))
  expect(compared.passed).toBe(false)
  expect(compared.acceptedInvalidInputFailures).toHaveLength(0)
})
