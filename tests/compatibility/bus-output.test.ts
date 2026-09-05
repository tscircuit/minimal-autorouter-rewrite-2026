import {test, expect} from "bun:test"
import {Pipeline9} from "../../lib"
import {getTraceLength} from "../../lib/postprocessing/lengthGeometry"

test("the public pipeline returns bus length adjustments in final output", () => {
  const pipeline = new Pipeline9({layerCount: 2, minTraceWidth: 0.1,
    bounds: {minX: -6, maxX: 6, minY: -6, maxY: 6}, obstacles: [],
    connections: [
      {name: "long", pointsToConnect: [{x: -4, y: -3, layer: "top"}, {x: 4, y: -3, layer: "top"}]},
      {name: "short", pointsToConnect: [{x: -2, y: 3, layer: "top"}, {x: 2, y: 3, layer: "top"}]}],
    buses: [{busId: "data", connectionNames: ["long", "short"], maxLengthSkew: 0.1}]})
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  const lengths = pipeline.getOutputSimplifiedPcbTraces().map(getTraceLength)
  expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(0.1)
})
