import {test, expect} from "bun:test"
import {Pipeline9, type SimpleRouteJson} from "../../lib"
import {assertOutputConnectivity} from "../dataset-srj18/assertSample"

test("net aliases merge routing requests without inventing physical copper", () => {
  const points = [-3, -1, 1, 3].map((x, i) => ({x, y: 0, layer: "top", pcb_port_id: `P${i}`}))
  const input: SimpleRouteJson = {bounds: {minX: -5, maxX: 5, minY: -3, maxY: 3},
    layerCount: 2, minTraceWidth: 0.1,
    obstacles: points.map((point) => ({type: "rect", center: point, width: 0.5, height: 0.5,
      layers: ["top"], connectedTo: ["shared", "branchA", "branchB", point.pcb_port_id],
      offBoardConnectsTo: ["propagated-net-alias"]})),
    connections: [{name: "branchA", rootConnectionName: "shared", pointsToConnect: points.slice(0, 2)},
      {name: "branchB", rootConnectionName: "shared", pointsToConnect: points.slice(2)}]}
  const pipeline = new Pipeline9(input)
  expect(pipeline.connMap.areIdsConnected("P0", "P3")).toBe(true)
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.getOutputSimplifiedPcbTraces()).toHaveLength(3)
  assertOutputConnectivity(input, pipeline.getOutputSimpleRouteJson())
})

test("an oval's empty corner cannot join a terminal to preloaded copper", () => {
  const input: SimpleRouteJson = {bounds: {minX: -3, maxX: 3, minY: -3, maxY: 3},
    layerCount: 2, minTraceWidth: 0.1,
    obstacles: [{type: "oval", center: {x: 0, y: 0}, width: 2, height: 2,
      layers: ["top"], connectedTo: ["n", "port"]}],
    connections: [{name: "n", pointsToConnect: [
      {x: 0, y: 0, layer: "top", pcb_port_id: "port"}, {x: 1.8, y: 1.8, layer: "top"}]}],
    traces: [{type: "pcb_trace", pcb_trace_id: "existing", connection_name: "n", route: [
      {route_type: "wire", x: 0.9, y: 0.9, layer: "top", width: 0.1},
      {route_type: "wire", x: 1.8, y: 1.8, layer: "top", width: 0.1},
    ]}]}
  const solver = new Pipeline9(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(1)
  assertOutputConnectivity(input, solver.getOutputSimpleRouteJson())
})
