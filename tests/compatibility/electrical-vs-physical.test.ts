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
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.getOutputSimplifiedPcbTraces()).toHaveLength(3)
  assertOutputConnectivity(input, pipeline.getOutputSimpleRouteJson())
})
