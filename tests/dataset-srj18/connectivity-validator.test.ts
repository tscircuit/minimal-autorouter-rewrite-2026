import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types/srj-types"
import { assertOutputConnectivity } from "./assertSample"

const board = (): SimpleRouteJson => ({
  layerCount: 2, minTraceWidth: 0.1,
  bounds: { minX: -1, maxX: 11, minY: -1, maxY: 1 }, obstacles: [],
  connections: [{ name: "net", pointsToConnect: [{ x: 0, y: 0, layer: "top" }, { x: 10, y: 0, layer: "top" }] }],
})
const wire = (x: number, layer = "top") => ({ route_type: "wire" as const, x, y: 0, layer, width: 0.1 })
const trace = (id: string, route: SimplifiedPcbTrace["route"]): SimplifiedPcbTrace => ({
  type: "pcb_trace", pcb_trace_id: id, connection_name: "net", route,
})

test("connectivity validation rejects a gap despite matching net labels", () => {
  const source = board()
  expect(() => assertOutputConnectivity(source, { ...source, traces: [trace("left", [wire(0), wire(4)]),
    trace("right", [wire(6), wire(10)])] })).toThrow("lack continuous")
})

test("connectivity validation rejects a layer change without a via", () => {
  const source = board()
  expect(() => assertOutputConnectivity(source, { ...source, traces: [trace("broken", [wire(0), wire(2),
    wire(2, "bottom"), wire(8, "bottom"), wire(8), wire(10)])] })).toThrow("lack continuous")
})

test("connectivity validation accepts continuous copper through explicit vias", () => {
  const source = board()
  const via = (x: number, from_layer: string, to_layer: string) => ({
    route_type: "via" as const, x, y: 0, from_layer, to_layer, via_diameter: 0.5, via_hole_diameter: 0.2,
  })
  expect(() => assertOutputConnectivity(source, { ...source, traces: [trace("complete", [wire(0), wire(2),
    via(2, "top", "bottom"), wire(2, "bottom"), wire(8, "bottom"), via(8, "bottom", "top"), wire(8), wire(10)])] })).not.toThrow()
})

test("connectivity validation recognizes conductive pad contact away from the terminal center", () => {
  const source = board()
  source.obstacles = [{ type: "rect", center: { x: 0, y: 0 }, width: 2, height: 1, layers: ["top"], connectedTo: ["net"] }]
  expect(() => assertOutputConnectivity(source, { ...source, traces: [trace("pad-contact", [wire(0.9), wire(10)])] })).not.toThrow()
})

test("connectivity validation does not fill the missing corners of an oval pad", () => {
  const source = board()
  source.connections[0]!.pointsToConnect[0]!.y = 0.49
  source.obstacles = [{ type: "oval", center: { x: 0.9, y: 0 }, width: 2, height: 1, layers: ["top"], connectedTo: ["net"] }]
  expect(() => assertOutputConnectivity(source, { ...source, traces: [trace("oval-contact", [wire(0.9), wire(10)])] })).toThrow("lack continuous")
})
