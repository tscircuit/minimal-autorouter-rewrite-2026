import { expect, test } from "bun:test"
import { assertPhysicalConnectivity } from "../../scripts/validation/assertPhysicalConnectivity"
import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../lib/types/srj-types"

const trace = (name: string, y: number, end = 4): SimplifiedPcbTrace => ({
  type: "pcb_trace",
  pcb_trace_id: `trace_${name}`,
  connection_name: name,
  route: [
    { route_type: "wire", x: 0, y, layer: "top", width: 0.1 },
    { route_type: "wire", x: end, y, layer: "top", width: 0.1 },
  ],
})
const board = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: -1, maxX: 5, minY: -1, maxY: 2 },
  obstacles: [],
  connections: ["first", "second"].map((name, y) => ({
    name,
    pointsToConnect: [
      { x: 0, y, layer: "top", pcb_port_id: `${name}_start` },
      { x: 4, y, layer: "top", pcb_port_id: `${name}_end` },
    ],
  })),
})

test.each([
  ["null", null],
  ["undefined", undefined],
  ["object", {}],
  ["array", []],
] as const)(
  "raw malformed input %s cannot be physically validated",
  (_label, raw) => {
    expect(() => assertPhysicalConnectivity(raw as SimpleRouteJson)).toThrow()
  },
)

test("a routed-input validator rejects all routes being absent or empty", () => {
  const input = board()
  expect(() => assertPhysicalConnectivity(input)).toThrow("lack continuous")
  expect(() => assertPhysicalConnectivity({ ...input, traces: [] })).toThrow(
    "lack continuous",
  )
})

test("dropping a whole requested net fails even when every retained trace is correct", () => {
  const input = board()
  expect(() =>
    assertPhysicalConnectivity({ ...input, traces: [trace("first", 0)] }),
  ).toThrow("second")
})

test("a matching name cannot hide a missing portion of conductor", () => {
  const input = board()
  expect(() =>
    assertPhysicalConnectivity({
      ...input,
      traces: [trace("first", 0), trace("second", 1, 2)],
    }),
  ).toThrow("second")
})

test("complete independent copper for both retained source nets passes", () => {
  const input = { ...board(), traces: [trace("first", 0), trace("second", 1)] }
  const original = JSON.stringify(input)
  expect(() => assertPhysicalConnectivity(input)).not.toThrow()
  expect(JSON.stringify(input)).toBe(original)
})

test("an unspecified via pad is not enlarged to bridge a physical gap", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "via_net",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 0.25, y: 0, layer: "bottom" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "via_trace",
        connection_name: "via_net",
        route: [
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
        ],
      },
    ],
  }
  expect(() => assertPhysicalConnectivity(input)).toThrow("lack continuous")
  const via = input.traces![0]!.route[1]!
  if (via.route_type !== "via") throw new Error("Expected via")
  via.via_diameter = 0.6
  expect(() => assertPhysicalConnectivity(input)).not.toThrow()
})

test("fixed copper without a routing request does not invent a requested net", () => {
  const input = {
    ...board(),
    traces: [trace("first", 0), trace("second", 1), trace("unused", 1.5)],
  }
  expect(() => assertPhysicalConnectivity(input)).not.toThrow()
})

test("a through-obstacle annotation cannot stand in for absent physical copper", () => {
  const input = { ...board(), traces: [trace("first", 0), trace("second", 1)] }
  input.traces[0]!.route = [
    { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
    {
      route_type: "through_obstacle",
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      from_layer: "top",
      to_layer: "top",
      width: 0.1,
    },
    { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.1 },
  ]
  expect(() => assertPhysicalConnectivity(input)).toThrow(
    "unsupported through_obstacle",
  )
})

test("a malformed off-board flag cannot suppress a missing route", () => {
  const input = { ...board(), traces: [trace("second", 1)] }
  ;(input.connections[0] as any).isOffBoard = "false"
  expect(() => assertPhysicalConnectivity(input)).toThrow(
    "Invalid connection.isOffBoard",
  )
})
