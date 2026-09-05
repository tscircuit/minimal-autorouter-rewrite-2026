import {test, expect} from "bun:test"
import {Pipeline9, type SimpleRouteJson} from "../../lib"

test("preloaded copper is retained, skipped when connected, and excluded from new trace output", () => {
  const input: SimpleRouteJson & {sourceName: string} = {sourceName: "metadata survives",
    bounds: {minX: -5, maxX: 5, minY: -5, maxY: 5}, layerCount: 2, minTraceWidth: 0.1,
    obstacles: [], connections: [
      {name: "old", pointsToConnect: [{x: -3, y: -1, layer: "top"}, {x: 3, y: -1, layer: "top"}]},
      {name: "new", pointsToConnect: [{x: -3, y: 1, layer: "top"}, {x: 3, y: 1, layer: "top"}]}],
    traces: [{type: "pcb_trace", pcb_trace_id: "minimal_new__pair0", connection_name: "old", route: [
      {route_type: "wire", x: -3, y: -1, layer: "top", width: 0.1},
      {route_type: "wire", x: 3, y: -1, layer: "top", width: 0.1}]}]}
  const pipeline = new Pipeline9(input)
  pipeline.solve()
  expect(pipeline.solved).toBe(true)
  expect(pipeline.getOutputSimplifiedPcbTraces()).toHaveLength(1)
  expect(pipeline.getOutputSimplifiedPcbTraces()[0]!.connection_name).toBe("new")
  const output = pipeline.getOutputSimpleRouteJson() as typeof input
  expect(output.sourceName).toBe(input.sourceName)
  expect(output.traces).toHaveLength(2)
  expect(output.traces![0]).toEqual(input.traces![0])
  expect(new Set(output.traces!.map((trace) => trace.pcb_trace_id)).size).toBe(2)
})
