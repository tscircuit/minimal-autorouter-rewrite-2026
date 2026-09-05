import {test, expect} from "bun:test"
import {BaseSolver, Pipeline9, type SimpleRouteJson} from "../../lib"

test("step and solve expose the same terminal state, timings, and immutable SRJ", () => {
  const input: SimpleRouteJson = {bounds: {minX: -5, maxX: 5, minY: -5, maxY: 5}, layerCount: 2,
    minTraceWidth: 0.1, obstacles: [], connections: [{name: "signal", pointsToConnect: [
      {x: -3, y: 0, layer: "top", pcb_port_id: "A"}, {x: 3, y: 0, layer: "top", pcb_port_id: "B"}]}]}
  const before = structuredClone(input)
  const stepped = new Pipeline9(input, {cacheProvider: null})
  expect(stepped).toBeInstanceOf(BaseSolver)
  expect(stepped.getSolverName()).toBe("AutoroutingPipelineSolver9_PreloadedTraceGraph")
  expect(() => stepped.getOutputSimpleRouteJson()).toThrow("before solving")
  expect(stepped.preview().rects.length).toBeGreaterThan(0)
  while (!stepped.solved && !stepped.failed) stepped.step()
  expect(stepped.error).toBeNull()
  expect(stepped.solved).toBe(true)
  expect(stepped.progress).toBe(1)
  expect(stepped.getCurrentPhase()).toBe("none")
  const iterations = stepped.iterations
  stepped.step()
  expect(stepped.iterations).toBe(iterations)
  const bulk = new Pipeline9(input, {cacheProvider: null})
  bulk.solve()
  expect(bulk.getOutputSimpleRouteJson()).toEqual(stepped.getOutputSimpleRouteJson())
  expect(bulk.timeToSolve).toBeGreaterThanOrEqual(0)
  expect(input).toEqual(before)
  for (const phase of stepped.pipelineDef) expect(stepped.timeSpentOnPhase[phase.solverName]).toBeGreaterThanOrEqual(0)
  const wires = bulk.getOutputSimplifiedPcbTraces()[0]!.route.filter((segment) => segment.route_type === "wire")
  expect(wires[0]!.start_pcb_port_id).toBe("A")
  expect(wires.at(-1)!.end_pcb_port_id).toBe("B")
})
