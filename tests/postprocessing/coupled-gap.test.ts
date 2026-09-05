import { expect, test } from "bun:test"
import { LengthMatchingSolver } from "../../lib/postprocessing/LengthMatchingSolver"
import type { SimplifiedPcbTrace, Wire } from "../../lib/types"
import { lengthProblem, measuredLength, straightTrace } from "./fixtures"

function pairedProblem(changes: Parameters<typeof lengthProblem>[1] = {}, fixed: SimplifiedPcbTrace[] = []) {
  const traces = [straightTrace("positive", 8, 0, 0.1), straightTrace("negative", 8, 3, 0.1)]
  const problem = lengthProblem(traces, { differentialPairs: [{ connectionNames: ["positive", "negative"], lengthTolerance: 0.01, traceGap: 0.15, maxUncoupledLength: 0 }], ...changes }, fixed)
  return { traces, problem }
}

test("pair rails have the resolved copper gap, preserve terminals and satisfy length tolerance", () => {
  const { traces, problem } = pairedProblem(), snapshot = JSON.stringify(traces)
  const solver = new LengthMatchingSolver(problem, traces)
  solver.solve()
  expect(solver.solved).toBe(true)
  const [a, b] = solver.routes.map(trace => trace.route as Wire[]) as [Wire[], Wire[]]
  const firstRail = a.find((point, index) => index > 0 && point.y === a[index - 1]!.y && point.x !== a[index - 1]!.x)!
  const secondRail = b.find((point, index) => index > 0 && point.y === b[index - 1]!.y && point.x !== b[index - 1]!.x)!
  expect(Math.abs(firstRail.y - secondRail.y) - (firstRail.width + secondRail.width) / 2).toBeCloseTo(0.15, 8)
  expect(Math.abs(measuredLength(solver.routes[0]!) - measuredLength(solver.routes[1]!))).toBeLessThanOrEqual(0.01)
  for (let member = 0; member < 2; member++) {
    expect(solver.routes[member]!.route[0]).toEqual(traces[member]!.route[0])
    expect(solver.routes[member]!.route.at(-1)).toEqual(traces[member]!.route.at(-1))
    expect(solver.routes[member]!.pcb_trace_id).toBe(traces[member]!.pcb_trace_id)
  }
  expect(JSON.stringify(traces)).toBe(snapshot)
})

test("a blocked coupled interior takes a common detour clear of pads and unrelated fixed copper", () => {
  const fixed = straightTrace("foreign", 3, 2.5, 0.3)
  fixed.route = (fixed.route as Wire[]).map(point => ({ ...point, x: point.x + 2 }))
  const { traces, problem } = pairedProblem({ obstacles: [{ type: "rect", center: { x: 4, y: 1.5 }, width: 1, height: 1, layers: ["top"], connectedTo: ["obstacle"] }] }, [fixed])
  const solver = new LengthMatchingSolver(problem, traces)
  solver.solve()
  expect(solver.solved).toBe(true)
  for (const trace of solver.routes) {
    const route = trace.route as Wire[]
    // The horizontal middle must leave both supplied copper barriers behind.
    const across = route.filter((point, index) => index > 0 && point.y === route[index - 1]!.y && Math.min(point.x, route[index - 1]!.x) < 3.5 && Math.max(point.x, route[index - 1]!.x) > 4.5)
    expect(across.length).toBeGreaterThan(0)
    for (const point of across) expect(point.y < 0.85 || point.y > 2.8).toBe(true)
  }
  expect(Math.abs(measuredLength(solver.routes[0]!) - measuredLength(solver.routes[1]!))).toBeLessThanOrEqual(0.01)
})

test("a fully blocked pair corridor reports failure with no invented coupled result", () => {
  const { traces, problem } = pairedProblem({ bounds: { minX: -0.1, maxX: 8.1, minY: -0.1, maxY: 3.1 }, obstacles: [{ type: "rect", center: { x: 4, y: 1.5 }, width: 1, height: 5, layers: ["top"], connectedTo: ["wall"] }] })
  const solver = new LengthMatchingSolver(problem, traces)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("Could not couple")
})
