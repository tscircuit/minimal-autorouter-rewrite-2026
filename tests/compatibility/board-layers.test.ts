import {test, expect} from "bun:test"
import {Pipeline9, type SimpleRouteJson} from "../../lib"

test("board-invalid obstacle layers are normalized in output without mutating input", () => {
  const input: SimpleRouteJson = {layerCount: 2, minTraceWidth: 0.1,
    bounds: {minX: -3, maxX: 3, minY: -3, maxY: 3}, connections: [],
    obstacles: [{type: "rect", center: {x: 0, y: 0}, width: 1, height: 1,
      layers: ["top", "inner99"], connectedTo: []}]}
  const pipeline = new Pipeline9(input)
  pipeline.solve()
  expect(pipeline.getOutputSimpleRouteJson().obstacles[0]!.layers).toEqual(["top"])
  expect(input.obstacles[0]!.layers).toEqual(["top", "inner99"])
})
