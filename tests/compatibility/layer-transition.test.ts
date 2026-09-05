import {test, expect} from "bun:test"
import {Pipeline9} from "../../lib"

test("required layer transitions use colocated wire endpoints and specified via dimensions", () => {
  const pipeline = new Pipeline9({bounds: {minX: -3, maxX: 3, minY: -3, maxY: 3},
    layerCount: 4, minTraceWidth: 0.1, min_via_pad_diameter: 0.5, min_via_hole_diameter: 0.25,
    obstacles: [], connections: [{name: "through", pointsToConnect: [
      {x: -1, y: 0, layers: ["inner1"]}, {x: 1, y: 0, layer: "bottom"}]}]})
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  const route = pipeline.getOutputSimplifiedPcbTraces()[0]!.route
  const vias = route.filter((point) => point.route_type === "via")
  expect(vias.length).toBeGreaterThan(0)
  for (let index = 0; index < route.length; index++) {
    const via = route[index]!
    if (via.route_type !== "via") continue
    expect(via.via_diameter).toBe(0.5)
    expect(via.via_hole_diameter).toBe(0.25)
    expect(route[index - 1]).toMatchObject({x: via.x, y: via.y, layer: via.from_layer})
    expect(route[index + 1]).toMatchObject({x: via.x, y: via.y, layer: via.to_layer})
  }
})
