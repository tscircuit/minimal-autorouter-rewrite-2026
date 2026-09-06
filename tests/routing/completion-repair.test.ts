import { expect, test } from "bun:test"
import { CompletionRepairSolver } from "../../lib/routing/CompletionRepairSolver"
import type { RoutingProblem, RoutingTask } from "../../lib/routing/types"
import type { SimplifiedPcbTrace } from "../../lib/types"
import { assertNoPcbIssues } from "../../scripts/validation/validateSrjWithChecks"

const task = (name: string, start: [number, number], end: [number, number]): RoutingTask => ({
  id: name, connectionName: name, netName: name, connectedNames: [name], traceWidth: 0.1,
  start: { x: start[0], y: start[1], layer: "top", pcb_port_id: `${name}_start` },
  end: { x: end[0], y: end[1], layer: "top", pcb_port_id: `${name}_end` },
})
const trace = (owner: RoutingTask): SimplifiedPcbTrace => ({
  type: "pcb_trace", pcb_trace_id: `minimal_${owner.id}`, connection_name: owner.connectionName,
  route: [owner.start, owner.end].map((point) => ({ route_type: "wire",
    x: point.x, y: point.y, layer: "top", width: owner.traceWidth })),
})
function problem(tasks: RoutingTask[], fixedTraces: SimplifiedPcbTrace[] = []): RoutingProblem {
  return { tasks, fixedTraces, effort: 1, obstacleMargin: 0.1,
    viaDiameter: 0.3, viaHoleDiameter: 0.15,
    srj: { layerCount: 2, minTraceWidth: 0.1,
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 }, obstacles: [],
      connections: tasks.map((task) => ({ name: task.connectionName,
        pointsToConnect: [task.start, task.end] })) } }
}

test("completion repair moves a blocking retained route and reconnects both requested nets", async () => {
  const first = task("horizontal", [-2, 0], [2, 0]), second = task("vertical", [0, 0], [0, 2])
  const input = problem([first, second]), retained = [trace(first)]
  const before = JSON.stringify({ input, retained })
  const solver = new CompletionRepairSolver(input, retained)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.repairs).toBeGreaterThan(0)
  expect(solver.unroutedTaskIds).toEqual([])
  expect(solver.routes.map((route) => route.pcb_trace_id).sort()).toEqual([
    "minimal_horizontal", "minimal_vertical",
  ])
  expect(JSON.stringify({ input, retained })).toBe(before)
  await assertNoPcbIssues({ ...input.srj, traces: solver.routes })
})

test("fixed copper remains a hard constraint and an exhausted repair retains an honest ledger", () => {
  const fixed = trace(task("fixed", [-2, 0], [2, 0]))
  const requested = task("vertical", [0, 0], [0, 2]), input = problem([requested], [fixed])
  const before = JSON.stringify(input), solver = new CompletionRepairSolver(input, [])
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("bounded completion repair")
  expect(solver.unroutedTaskIds).toEqual(["vertical"])
  expect(solver.routes).toEqual([])
  expect(solver.stats.attempts).toBe(solver.maximumAttempts)
  expect(JSON.stringify(input)).toBe(before)
  const terminal = JSON.stringify({ routes: solver.routes, iterations: solver.iterations, error: solver.error })
  solver.step()
  expect(JSON.stringify({ routes: solver.routes, iterations: solver.iterations, error: solver.error })).toBe(terminal)
})

test("retained copper is rechecked against board-edge rules before it can count as complete", async () => {
  const owner = task("edge", [-2, 0], [2, 0]), input = problem([owner]), retained = trace(owner)
  retained.route = [owner.start, { x: -2, y: 2.95 }, { x: 2, y: 2.95 }, owner.end]
    .map((point) => ({ route_type: "wire", x: point.x, y: point.y, layer: "top", width: 0.1 }))
  const solver = new CompletionRepairSolver(input, [retained])
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.attempts).toBeGreaterThan(0)
  expect(solver.routes).toHaveLength(1)
  expect(solver.routes[0]!.route).not.toEqual(retained.route)
  await assertNoPcbIssues({ ...input.srj, traces: solver.routes })
})

test("a retained trace cannot forge a foreign-net clearance exemption", async () => {
  const first = task("first", [-2, 0], [2, 0]), second = task("second", [-2, 1], [2, 1])
  const input = problem([first, second]), retained = trace(first)
  retained.connectsTo = ["second"]
  const solver = new CompletionRepairSolver(input, [retained])
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.routes.find((route) => route.connection_name === "first")!.connectsTo)
    .not.toContain("second")
  await assertNoPcbIssues({ ...input.srj, traces: solver.routes })
})

test("a nonfinite retained via is removed before completion can succeed", async () => {
  const owner = task("via", [-2, 0], [2, 0]), input = problem([owner]), retained = trace(owner)
  retained.route.splice(1, 0,
    { route_type: "via", x: NaN, y: 0, from_layer: "top", to_layer: "bottom", via_diameter: 0.3, via_hole_diameter: 0.15 },
    { route_type: "wire", x: 0, y: 0, layer: "bottom", width: 0.1 },
    { route_type: "via", x: 0, y: 0, from_layer: "bottom", to_layer: "top", via_diameter: 0.3, via_hole_diameter: 0.15 })
  const solver = new CompletionRepairSolver(input, [retained])
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.attempts).toBeGreaterThan(0)
  await assertNoPcbIssues({ ...input.srj, traces: solver.routes })
})

test("the outer step limit preserves the best retained copper and exact unfinished-task ledger", () => {
  const first = task("first", [-2, 0], [2, 0]), second = task("second", [-2, 1], [2, 1])
  const solver = new CompletionRepairSolver(problem([first, second]), [trace(first)])
  solver.MAX_ITERATIONS = 1
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.routes.map((route) => route.pcb_trace_id)).toEqual(["minimal_first"])
  expect(solver.unroutedTaskIds).toEqual(["second"])
})

test("noncanonical retained identities cannot create two route records for one task", () => {
  const owner = task("first", [-2, 0], [2, 0]), retained = trace(owner)
  retained.pcb_trace_id = "first"
  const solver = new CompletionRepairSolver(problem([owner]), [retained])
  expect(() => solver.solve()).toThrow("has no routing task")
  expect(solver.solved).toBe(false)
})
