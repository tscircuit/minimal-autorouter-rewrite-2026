import { describe, expect, test } from "bun:test"
import { runAllChecks } from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"
import type {
  ConnectionPoint,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../lib/types"
import {
  convertSrjToCircuitJson,
  describeConversionCoverage,
} from "../../scripts/validation/convertSrjToCircuitJson"
import { validateCircuitJson } from "../../scripts/validation/validateSrjWithChecks"

const wire = (x: number, y: number, layer = "top") => ({
  route_type: "wire" as const,
  x,
  y,
  layer,
  width: 0.2,
})
const terminal = (
  name: string,
  x: number,
  y: number,
  layer = "top",
): ConnectionPoint => ({ pcb_port_id: name, x, y, layer })
function board(
  nets: Array<{
    name: string
    points: ConnectionPoint[]
    route?: SimplifiedPcbTrace["route"]
  }>,
): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: nets.map((net) => ({
      name: net.name,
      pointsToConnect: net.points,
    })),
    obstacles: nets.flatMap((net) =>
      net.points.map((point) => ({
        type: "rect" as const,
        obstacleId: `pad_${point.pcb_port_id}`,
        center: { x: point.x, y: point.y },
        width: 0.6,
        height: 0.6,
        layers: "layer" in point ? [point.layer] : point.layers,
        connectedTo: [net.name, point.pcb_port_id!],
        circuitJsonMetadata: {
          pcb_port_id: point.pcb_port_id,
          pcb_smtpad_id: `pad_${point.pcb_port_id}`,
        },
      })),
    ),
    traces: nets.flatMap((net) =>
      net.route
        ? [
            {
              type: "pcb_trace" as const,
              pcb_trace_id: `trace_${net.name}`,
              connection_name: net.name,
              route: net.route,
            },
          ]
        : [],
    ),
  }
}
const simple = () =>
  board([
    {
      name: "signal",
      points: [terminal("a", -2, 0), terminal("b", 2, 0)],
      route: [wire(-2, 0), wire(2, 0)],
    },
  ])
const byType = <T extends AnyCircuitElement["type"]>(
  elements: AnyCircuitElement[],
  type: T,
) =>
  elements.filter((element) => element.type === type) as Extract<
    AnyCircuitElement,
    { type: T }
  >[]
async function checks(srj: SimpleRouteJson) {
  const circuit = convertSrjToCircuitJson(srj)
  await validateCircuitJson(circuit) // also asserts every emitted schema
  return runAllChecks(structuredClone(circuit))
}

describe("independent SRJ to Circuit JSON conversion", () => {
  test("preserves source geometry and terminal provenance without mutating the SRJ", async () => {
    const input = simple(),
      original = structuredClone(input)
    const circuit = convertSrjToCircuitJson(input)
    const traces = byType(circuit, "pcb_trace")
    expect(traces[0]!.route[0]).toMatchObject({
      x: -2,
      y: 0,
      layer: "top",
      start_pcb_port_id: "a",
    })
    expect(traces[0]!.route.at(-1)).toMatchObject({
      x: 2,
      y: 0,
      layer: "top",
      end_pcb_port_id: "b",
    })
    expect(
      byType(circuit, "pcb_smtpad")
        .map((pad) => pad.pcb_port_id)
        .sort(),
    ).toEqual(["a", "b"])
    expect(describeConversionCoverage(input)).toMatchObject({
      sourceObstacleCount: 2,
      representedObstacleCount: 2,
      sourceTerminalCount: 2,
      representedTerminalCount: 2,
      sourceTraceCount: 1,
      representedTraceCount: 1,
    })
    expect(await checks(input)).toEqual([])
    expect(input).toEqual(original)
  })

  test("full public checks reject unrelated crossing copper", async () => {
    const input = board([
      {
        name: "horizontal",
        points: [terminal("a", -2, 0), terminal("b", 2, 0)],
        route: [wire(-2, 0), wire(2, 0)],
      },
      {
        name: "vertical",
        points: [terminal("c", 0, -2), terminal("d", 0, 2)],
        route: [wire(0, -2), wire(0, 2)],
      },
    ])
    expect(
      (await checks(input)).some((issue) => issue.type === "pcb_trace_error"),
    ).toBe(true)
  })

  test("full public checks reject absent routing", async () => {
    const input = simple()
    input.traces = []
    expect(
      (await checks(input)).some(
        (issue) =>
          issue.type === "pcb_trace_missing_error" ||
          issue.type === "pcb_port_not_connected_error",
      ),
    ).toBe(true)
  })

  test("emits standalone vias with source dimensions and full physical layer span", async () => {
    const input = board([
      {
        name: "signal",
        points: [terminal("a", -2, 0), terminal("b", 2, 0, "bottom")],
        route: [
          wire(-2, 0),
          wire(0, 0),
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.6,
            via_hole_diameter: 0.3,
          },
          wire(0, 0, "bottom"),
          wire(2, 0, "bottom"),
        ],
      },
    ])
    input.layerCount = 4
    const circuit = convertSrjToCircuitJson(input),
      via = byType(circuit, "pcb_via")[0]!
    expect(via).toMatchObject({
      x: 0,
      y: 0,
      outer_diameter: 0.6,
      hole_diameter: 0.3,
      layers: ["top", "inner1", "inner2", "bottom"],
      pcb_trace_id: "trace_signal",
    })
    expect(via.source_trace_id).toBe(
      byType(circuit, "pcb_trace")[0]!.source_trace_id,
    )
    expect(await checks(input)).toEqual([])
    input.traces![0]!.route = input.traces![0]!.route.filter(
      (entry) => entry.route_type !== "via",
    )
    const broken = await checks(input)
    expect(broken.some((issue) => issue.type.startsWith("pcb_"))).toBe(true)
    expect(byType(convertSrjToCircuitJson(input), "pcb_via")).toHaveLength(0)
    expect(byType(convertSrjToCircuitJson(input), "pcb_trace")).toHaveLength(2)
  })

  test("full public checks reject a trace crossing the board boundary", async () => {
    const input = simple()
    input.traces![0]!.route = [wire(-2, 0), wire(-2, 6), wire(2, 6), wire(2, 0)]
    expect(
      (await checks(input)).some((issue) => issue.type === "pcb_trace_error"),
    ).toBe(true)
  })

  test("trace aliases cannot merge two distinct requested nets", () => {
    const input = board([
      {
        name: "signal",
        points: [terminal("a", -2, 0), terminal("b", 2, 0)],
        route: [wire(-2, 0), wire(2, 0)],
      },
      { name: "foreign", points: [terminal("c", -2, 2), terminal("d", 2, 2)] },
    ])
    input.traces![0]!.connectsTo = ["signal", "foreign"]
    expect(() => convertSrjToCircuitJson(input)).toThrow(
      "claims different declared nets",
    )
  })

  test("unused same-net pads retain separate positions without acquiring a routing requirement", async () => {
    const input = simple()
    for (const [index, x] of [-1, 1].entries())
      input.obstacles.push({
        type: "rect",
        center: { x, y: 3 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["unused_net"],
        circuitJsonMetadata: { pcb_port_id: `unused_${index}` },
      })
    const circuit = convertSrjToCircuitJson(input)
    const unused = byType(circuit, "pcb_port").filter((port) =>
      port.pcb_port_id.startsWith("unused_"),
    )
    expect(
      unused.map((port) => ({ x: port.x, y: port.y, layers: port.layers })),
    ).toEqual([
      { x: -1, y: 3, layers: ["top"] },
      { x: 1, y: 3, layers: ["top"] },
    ])
    expect(unused[0]!.source_port_id).toBe(unused[1]!.source_port_id)
    expect(
      byType(circuit, "source_trace").some((trace) =>
        trace.connected_source_port_ids.includes(unused[0]!.source_port_id),
      ),
    ).toBe(false)
    expect(
      describeConversionCoverage(input).limitations.some((message) =>
        message.includes("virtual source port"),
      ),
    ).toBe(true)
    expect(await checks(input)).toEqual([])
    input.obstacles.push({
      type: "rect",
      center: { x: -1, y: 3 },
      width: 0.6,
      height: 0.6,
      layers: ["top"],
      connectedTo: ["other_unused_net"],
    })
    expect(
      (await checks(input)).some(
        (issue) => issue.type === "pcb_pad_pad_clearance_error",
      ),
    ).toBe(true)
  })

  test("semantic pad metadata aliases resolve to the physical requested terminal", async () => {
    const input = simple()
    input.obstacles[0]!.circuitJsonMetadata!.pcb_port_id = "component_pin_a"
    input.obstacles[0]!.connectedTo.push("component_pin_a", "b")
    Object.assign(input.traces![0]!.route[0]!, {
      start_pcb_port_id: "component_pin_a",
    })
    const circuit = convertSrjToCircuitJson(input)
    expect(byType(circuit, "pcb_smtpad")[0]!.pcb_port_id).toBe("a")
    expect(byType(circuit, "pcb_trace")[0]!.route[0]).toMatchObject({
      start_pcb_port_id: "a",
    })
    expect(byType(circuit, "pcb_port")).toHaveLength(2)
    expect(await checks(input)).toEqual([])
  })

  test("one source port may have distinct physical attachment positions without moving either", async () => {
    const input = simple()
    input.connections[0]!.pointsToConnect.push(terminal("a", -2, 2))
    input.obstacles.push({
      type: "rect",
      center: { x: -2, y: 2 },
      width: 0.6,
      height: 0.6,
      layers: ["top"],
      connectedTo: ["signal", "a"],
      circuitJsonMetadata: { pcb_port_id: "a" },
    })
    input.traces!.push({
      type: "pcb_trace",
      pcb_trace_id: "second_attachment",
      connection_name: "signal",
      route: [{ ...wire(-2, 2), start_pcb_port_id: "a" }, wire(-2, 0)],
    })
    const circuit = convertSrjToCircuitJson(input),
      coverage = describeConversionCoverage(input)
    const physical = byType(circuit, "pcb_port").filter((port) =>
      coverage.terminalElementIds.a!.includes(port.pcb_port_id),
    )
    expect(physical.map((port) => [port.x, port.y])).toEqual([
      [-2, 0],
      [-2, 2],
    ])
    expect(physical[0]!.pcb_port_id).not.toBe(physical[1]!.pcb_port_id)
    expect(physical[0]!.source_port_id).toBe(physical[1]!.source_port_id)
    expect(byType(circuit, "pcb_trace")[1]!.route[0]).toMatchObject({
      x: -2,
      y: 2,
      start_pcb_port_id: physical[1]!.pcb_port_id,
    })
    expect(await checks(input)).toEqual([])
  })

  test("overlapping pads keep every declared physical terminal", async () => {
    const input = simple()
    input.connections[0]!.pointsToConnect.push(terminal("a_second", -2, 0))
    input.obstacles[0]!.connectedTo.push("a_second")
    input.obstacles.push({
      ...structuredClone(input.obstacles[0]!),
      obstacleId: "second_pad",
      circuitJsonMetadata: {
        pcb_port_id: "a_second",
        pcb_smtpad_id: "second_pad",
      },
    })
    const circuit = convertSrjToCircuitJson(input)
    expect(
      byType(circuit, "pcb_port")
        .map((port) => port.pcb_port_id)
        .sort(),
    ).toEqual(["a", "a_second", "b"])
    expect(
      byType(circuit, "pcb_smtpad")
        .map((pad) => pad.pcb_port_id)
        .sort(),
    ).toEqual(["a", "a_second", "b"])
    expect(await checks(input)).toEqual([])
  })

  test("rejects endpoint annotations that claim the wrong location or copper layer", () => {
    const input = simple()
    Object.assign(input.traces![0]!.route[0]!, { start_pcb_port_id: "b" })
    expect(() => convertSrjToCircuitJson(input)).toThrow(
      "wrong position or layer",
    )
    Object.assign(input.traces![0]!.route[0]!, {
      start_pcb_port_id: "a",
      layer: "bottom",
    })
    expect(() => convertSrjToCircuitJson(input)).toThrow(
      "wrong position or layer",
    )
  })

  test("same-net fixed and new fragments share one physical via without dropping traces", async () => {
    const input = board([
      {
        name: "signal",
        points: [terminal("a", -2, 0), terminal("b", 2, 0, "bottom")],
        route: [
          wire(-2, 0),
          wire(0, 0),
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.6,
            via_hole_diameter: 0.3,
          },
          wire(0, 0, "bottom"),
          wire(2, 0, "bottom"),
        ],
      },
    ])
    const fixed = structuredClone(input.traces![0]!)
    fixed.pcb_trace_id = "preserved_fixed_trace"
    input.traces!.unshift(fixed)
    const circuit = convertSrjToCircuitJson(input)
    expect(
      byType(circuit, "pcb_trace").map((trace) => trace.pcb_trace_id),
    ).toEqual(["preserved_fixed_trace", "trace_signal"])
    expect(byType(circuit, "pcb_via")).toHaveLength(1)
    expect(describeConversionCoverage(input)).toMatchObject({
      sourceTraceCount: 2,
      representedTraceCount: 2,
      routeViaCount: 2,
      standaloneViaCount: 1,
    })
    expect(await checks(input)).toEqual([])
  })

  test("unowned rotated keepouts remain geometrically present to full PCB checks", async () => {
    const input = simple()
    input.obstacles.push({
      type: "rect",
      center: { x: 0, y: 0 },
      width: 1,
      height: 0.8,
      ccwRotationDegrees: 45,
      layers: ["top"],
      connectedTo: [],
      obstacleId: "actual_keepout",
    })
    const keepout = byType(convertSrjToCircuitJson(input), "pcb_keepout")[0]!
    expect(keepout).toMatchObject({
      shape: "outline",
      layers: ["top"],
      stroke_width: 0,
    })
    expect(
      describeConversionCoverage(input).obstacleElementIds.actual_keepout,
    ).toHaveLength(1)
    expect(
      (await checks(input)).some(
        (issue) =>
          issue.type === "pcb_trace_error" &&
          issue.message.includes("pcb_keepout"),
      ),
    ).toBe(true)
  })

  test("preserves rotated pads, exact board outline, and explicit manufacturing rules", async () => {
    const input = simple()
    input.outline = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 4, y: 5 },
      { x: -5, y: 5 },
    ]
    input.obstacles[0]!.ccwRotationDegrees = 33
    input.minBoardEdgeClearance = 0.35
    input.allowViaInPad = false
    input.nominalTraceWidth = 0.3
    const circuit = convertSrjToCircuitJson(input)
    expect(byType(circuit, "pcb_board")[0]).toMatchObject({
      outline: input.outline,
      min_board_edge_clearance: 0.35,
      is_via_in_pad_allowed: false,
    })
    expect(byType(circuit, "pcb_smtpad")[0]).toMatchObject({
      shape: "rotated_rect",
      ccw_rotation: 33,
      x: -2,
      y: 0,
      width: 0.6,
      height: 0.6,
    })
    expect(
      byType(circuit, "source_trace").find(
        (trace) => trace.min_trace_thickness !== undefined,
      )?.min_trace_thickness,
    ).toBe(0.3)
    const defaults = byType(convertSrjToCircuitJson(simple()), "pcb_board")[0]!
    expect(defaults.min_board_edge_clearance).toBeUndefined()
    expect(defaults.is_via_in_pad_allowed).toBeUndefined()
    await validateCircuitJson(circuit)
  })

  test("retains plated-hole outer copper per layer without inventing a drill", async () => {
    const input = simple(),
      obstacle = input.obstacles[0]!
    obstacle.layers = ["top", "bottom"]
    obstacle.circuitJsonMetadata = {
      pcb_port_id: "a",
      pcb_plated_hole_id: "actual_hole_a",
    }
    const circuit = convertSrjToCircuitJson(input)
    expect(byType(circuit, "pcb_plated_hole")).toHaveLength(0)
    expect(
      byType(circuit, "pcb_smtpad")
        .filter((pad) => pad.pcb_port_id === "a")
        .map((pad) => pad.layer)
        .sort(),
    ).toEqual(["bottom", "top"])
    expect(
      describeConversionCoverage(input).limitations.some((message) =>
        message.includes("drill dimensions are absent"),
      ),
    ).toBe(true)
    await validateCircuitJson(circuit)
  })

  test("fails closed on unknown geometry and missing actual via dimensions", () => {
    const input = simple()
    ;(input.obstacles[0] as any).type = "unrepresented_shape"
    expect(() => convertSrjToCircuitJson(input)).toThrow("invalid obstacle")
    const broken = simple()
    broken.traces![0]!.route.push({
      route_type: "via",
      x: 2,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
    })
    expect(() => convertSrjToCircuitJson(broken)).toThrow(
      "will not invent drills",
    )
    ;(broken.traces![0]!.route as any) = [{ route_type: "unknown" }]
    expect(() => convertSrjToCircuitJson(broken)).toThrow(
      "geometry was not omitted",
    )
  })

  test("through-obstacle annotations cannot invent a pad conductor or hide a keepout crossing", () => {
    const input = simple()
    input.traces![0]!.route = [
      wire(-2, 0),
      {
        route_type: "through_obstacle",
        start: { x: -2, y: 0 },
        end: { x: 2, y: 0 },
        from_layer: "top",
        to_layer: "top",
        width: 0.2,
      },
      wire(2, 0),
    ]
    input.obstacles.push({
      type: "rect",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layers: ["top"],
      connectedTo: [],
    })
    expect(() => convertSrjToCircuitJson(input)).toThrow(
      "unsupported through_obstacle",
    )
  })

  test.each([
    { path: ["connections", 0, "isOffBoard"], value: "false" },
    { path: ["connections", 0, "rootConnectionName"], value: 1 },
    { path: ["connections", 0, "mergedConnectionNames"], value: "signal" },
    { path: ["connections", 0, "__rootConnectionNames"], value: [null] },
    { path: ["connections", 0, "externallyConnectedPointIds"], value: ["ab"] },
    { path: ["connections", 0, "pointsToConnect", 0, "pcb_port_id"], value: 2 },
    { path: ["connections", 0, "pointsToConnect", 0, "pointId"], value: {} },
    { path: ["obstacles", 0, "offBoardConnectsTo"], value: "signal" },
    { path: ["obstacles", 0, "connectedTo"], value: [null] },
    { path: ["obstacles", 0, "componentId"], value: [] },
    { path: ["obstacles", 0, "obstacleId"], value: false },
    { path: ["obstacles", 0, "isCopperPour"], value: "false" },
    { path: ["obstacles", 0, "circuitJsonMetadata", "pcb_port_id"], value: {} },
    { path: ["traces", 0, "connectsTo"], value: [2] },
  ])(
    "malformed electrical field $path is rejected before alias normalization",
    ({ path, value }) => {
      const input = simple()
      let target: any = input
      for (const key of path.slice(0, -1)) target = target[key]
      target[path.at(-1)!] = value
      expect(() => convertSrjToCircuitJson(input)).toThrow("invalid")
    },
  )

  test("only a real boolean off-board flag removes an on-board routing requirement", () => {
    const input = simple()
    input.traces = []
    ;(input.connections[0] as any).isOffBoard = "false"
    expect(() => convertSrjToCircuitJson(input)).toThrow(
      "connection.isOffBoard",
    )
    input.connections[0]!.isOffBoard = true
    expect(() => convertSrjToCircuitJson(input)).not.toThrow()
  })

  test("empty alias sentinels do not invent an electrical net for an unowned obstacle", () => {
    const input = simple()
    input.obstacles.push({
      type: "rect",
      center: { x: 0, y: 2 },
      width: 1,
      height: 1,
      layers: ["top"],
      connectedTo: [""],
    })
    const circuit = convertSrjToCircuitJson(input)
    expect(byType(circuit, "pcb_keepout")).toHaveLength(1)
    expect(byType(circuit, "source_net").some((net) => net.name === "")).toBe(
      false,
    )
  })

  test("component provenance remains available without dangling references that crash real overlap checks", async () => {
    const input = simple()
    input.obstacles[0]!.componentId = "original_component_a"
    input.obstacles.push({
      type: "rect",
      obstacleId: "keepout_touching_pad",
      center: { x: -2, y: 0 },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: [],
    })
    const circuit = convertSrjToCircuitJson(input)
    expect(circuit.some((element) => "pcb_component_id" in element)).toBe(false)
    expect(describeConversionCoverage(input).obstacleComponentIds).toEqual({
      pad_a: "original_component_a",
    })
    expect(byType(circuit, "pcb_smtpad")[0]).toMatchObject({
      x: -2,
      y: 0,
      width: 0.6,
      height: 0.6,
    })
    expect(
      (await checks(input)).some(
        (issue) => issue.type === "pcb_placement_error",
      ),
    ).toBe(true)
  })
})
