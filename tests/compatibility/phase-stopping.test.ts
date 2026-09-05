import {test, expect} from "bun:test"
import {Pipeline9} from "../../lib"

test("phase stepping stops before the requested stage and rejects unknown phases", () => {
  const pipeline = new Pipeline9({bounds: {minX: -2, maxX: 2, minY: -2, maxY: 2},
    layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: []})
  pipeline.solveUntilPhase("highDensityRouteSolver")
  expect(pipeline.preprocessSimpleRouteJsonSolver?.solved).toBe(true)
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
  expect(pipeline.solved).toBe(false)
  expect(() => pipeline.solveUntilPhase("misspelled")).toThrow("Unknown pipeline phase")
  pipeline.solve()
  expect(pipeline.getOutputSimplifiedPcbTraces()).toEqual([])
})
