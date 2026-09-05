import {test, expect} from "bun:test"
import {Pipeline9} from "../../lib"

test("legacy phase stop labels expose completed data at corresponding real boundaries", () => {
  const pipeline = new Pipeline9({layerCount: 2, minTraceWidth: 0.1,
    bounds: {minX: -2, maxX: 2, minY: -2, maxY: 2}, obstacles: [],
    connections: [{name: "trace", pointsToConnect: [{x: -1, y: 0, layer: "top"}, {x: 1, y: 0, layer: "top"}]}]})
  pipeline.solveUntilPhase("netToPointPairsSolver")
  expect(pipeline.netToPointPairsSolver?.solved).toBe(true)
  expect(pipeline.getCurrentPhase()).toBe("escapeViaLocationSolver")
  pipeline.solveUntilPhase("portPointPathingSolver")
  expect(pipeline.getCurrentPhase()).toBe("highDensityRouteSolver")
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
  pipeline.solveUntilPhase("globalDrcForceImproveSolver")
  expect(pipeline.highDensityRouteSolver?.solved).toBe(true)
  expect(pipeline.highDensityRouteSolver!.routes[0]!.route[0]!.z).toBe(0)
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
})
