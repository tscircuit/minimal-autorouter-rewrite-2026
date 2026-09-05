import {test, expect} from "bun:test"
import {Pipeline9, type SimpleRouteJson} from "../../lib"

test("terminal via hints reserve and emit the requested location, layers, and pad diameter", () => {
  const input: SimpleRouteJson = {layerCount: 2, minTraceWidth: 0.1,
    bounds: {minX: -3, maxX: 3, minY: -3, maxY: 3}, obstacles: [],
    connections: [{name: "supply", pointsToConnect: [
      {x: 0, y: 0, layer: "top", pcb_port_id: "supply-terminal", terminalVia: {toLayer: "bottom", viaDiameter: 0.8}},
      {x: 2, y: 0, layer: "top"}]}]}
  const pipeline = new Pipeline9(input)
  pipeline.solveUntilPhase("traceSimplificationSolver")
  expect(pipeline.getNewTracesBeforePowerExpansion().flatMap(trace => trace.route)
    .some(segment => segment.route_type === "via" && segment.via_diameter === 0.8)).toBe(true)
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  const vias = pipeline.getOutputSimplifiedPcbTraces().flatMap((trace) => trace.route.filter((segment) => segment.route_type === "via"))
  expect(vias).toContainEqual({route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "bottom", via_diameter: 0.8, via_hole_diameter: 0.15})
  expect(pipeline.originalSrj).toEqual(input)
})
