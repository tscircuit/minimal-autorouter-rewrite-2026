import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { Pipeline9, Pipeline9_Networked } from "../../lib"
import { createHdCache2Service } from "../../scripts/network-server"
import {
  assertNoPcbIssues,
  validateCircuitJson,
  validateSrjWithChecks,
} from "../../scripts/validation/validateSrjWithChecks"
import { convertSrjToCircuitJson } from "../../scripts/validation/convertSrjToCircuitJson"

function cleanBoard(): SimpleRouteJson {
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [-3, 3].map((x, index) => ({
      type: "rect",
      center: { x, y: 0 },
      width: 0.6,
      height: 0.6,
      layers: ["top"],
      connectedTo: ["signal", `port_${index}`],
    })),
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top", pcb_port_id: "port_0" },
          { x: 3, y: 0, layer: "top", pcb_port_id: "port_1" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "route_signal",
        connection_name: "signal",
        route: [
          {
            route_type: "wire",
            x: -3,
            y: 0,
            layer: "top",
            width: 0.1,
            start_pcb_port_id: "port_0",
          },
          {
            route_type: "wire",
            x: 3,
            y: 0,
            layer: "top",
            width: 0.1,
            end_pcb_port_id: "port_1",
          },
        ],
      },
    ],
  }
}

test("full Circuit JSON validation accepts clean copper without mutating input or converted artifacts", async () => {
  const input = cleanBoard(),
    before = JSON.stringify(input)
  const result = await validateSrjWithChecks(input)
  expect(result.pcbIssues).toEqual([])
  expect(result.physicalConnectivityError).toBeUndefined()
  expect(JSON.stringify(input)).toBe(before)
  const converted = convertSrjToCircuitJson(input),
    convertedBefore = JSON.stringify(converted)
  await validateCircuitJson(converted)
  expect(JSON.stringify(converted)).toBe(convertedBefore)
  await expect(assertNoPcbIssues(input)).resolves.toBeUndefined()
})

test("PCB warnings are failures too, including the width check omitted by runAllChecks", async () => {
  const input = cleanBoard()
  input.connections[0]!.nominalTraceWidth = 0.4
  const result = await validateSrjWithChecks(input)
  expect(
    result.pcbIssues.some((issue) => issue.type === "pcb_trace_warning"),
  ).toBe(true)
  await expect(assertNoPcbIssues(input, "undersized route")).rejects.toThrow(
    "PCB issues",
  )
})

test("the validator rejects invalid Circuit JSON instead of accepting empty checker output", async () => {
  await expect(validateCircuitJson([])).rejects.toThrow("exactly one PCB board")
  const converted = convertSrjToCircuitJson(cleanBoard())
  const trace = converted.find((element) => element.type === "pcb_trace")!
  if (trace.type !== "pcb_trace")
    throw new Error("Trace missing from conversion")
  const point = trace.route[0]!
  if (point.route_type !== "wire")
    throw new Error("Wire missing from conversion")
  point.width = Number.NaN
  await expect(validateCircuitJson(converted)).rejects.toThrow(
    "Invalid converted Circuit JSON",
  )
})

test("full checking reports length warnings alongside ordinary PCB errors", async () => {
  const converted = convertSrjToCircuitJson(cleanBoard())
  for (const element of converted)
    if (element.type === "source_trace") element.max_length = 1
  const result = await validateCircuitJson(converted)
  expect(
    result.pcbIssues.some(
      (issue) => issue.type === "pcb_trace_too_long_warning",
    ),
  ).toBe(true)
})

test("validation retains an independent missing-copper failure beside checker diagnostics", async () => {
  const input = cleanBoard()
  input.traces = []
  const result = await validateSrjWithChecks(input)
  expect(result.physicalConnectivityError).toContain("lack continuous")
  await expect(assertNoPcbIssues(input)).rejects.toThrow()
})

test("the same strict validator accepts local, remote, and cached Pipeline9 outputs", async () => {
  const input = cleanBoard()
  input.traces = []
  const local = new Pipeline9(input, { cacheProvider: null, effort: 1 })
  local.solve()
  expect(local.solved).toBe(true)
  await expect(
    assertNoPcbIssues(local.getOutputSimpleRouteJson()),
  ).resolves.toBeUndefined()
  const service = createHdCache2Service()
  try {
    for (const cacheState of ["cold", "hot"]) {
      const networked = new Pipeline9_Networked(input, {
        hdCache2ServerUrl: service.server.url.toString(),
        hdCache2CacheVersion: "pcb-validation",
      })
      await networked.solveAsync()
      await networked.highDensityRouteSolver!.waitForAllRemoteRequests!()
      expect(networked.solved).toBe(true)
      await expect(
        assertNoPcbIssues(networked.getOutputSimpleRouteJson(), cacheState),
      ).resolves.toBeUndefined()
      expect(networked.getOutputSimpleRouteJson()).toEqual(
        local.getOutputSimpleRouteJson(),
      )
    }
    expect(service.stats.solverRuns).toBe(1)
    expect(service.stats.cacheHits).toBe(1)
  } finally {
    service.server.stop(true)
  }
})

function boardWithViaNearForeignPad(padY = 0.85): SimpleRouteJson {
  const input = cleanBoard()
  input.connections[0]!.pointsToConnect[1] = {
    x: 3,
    y: 0,
    layer: "bottom",
    pcb_port_id: "port_1",
  }
  input.obstacles[1]!.layers = ["bottom"]
  input.obstacles.push({
    type: "rect",
    center: { x: 0, y: padY },
    width: 0.6,
    height: 0.6,
    layers: ["top"],
    connectedTo: ["foreign"],
  })
  input.traces![0]!.route = [
    { route_type: "wire", x: -3, y: 0, layer: "top", width: 0.1 },
    { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
    {
      route_type: "via",
      x: 0,
      y: 0,
      from_layer: "top",
      to_layer: "bottom",
      via_diameter: 0.6,
      via_hole_diameter: 0.3,
    },
    { route_type: "wire", x: 0, y: 0, layer: "bottom", width: 0.1 },
    { route_type: "wire", x: 3, y: 0, layer: "bottom", width: 0.1 },
  ]
  return input
}

test("explicit via-to-pad clearance is enforced even when the general checker default passes", async () => {
  const input = boardWithViaNearForeignPad()
  expect((await validateSrjWithChecks(input)).pcbIssues).toEqual([])
  input.minViaEdgeToPadEdgeClearance = 0.4
  const circuit = convertSrjToCircuitJson(input)
  expect(circuit.find((element) => element.type === "pcb_board")).toMatchObject(
    {
      min_via_edge_to_pad_edge_clearance: 0.4,
    },
  )
  const result = await validateCircuitJson(circuit)
  expect(result.pcbIssues).toHaveLength(1)
  expect(result.pcbIssues[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    minimum_clearance: 0.4,
  })
  await expect(assertNoPcbIssues(input)).rejects.toThrow("PCB issues")
})

test("supplemental via-to-pad checking keeps one diagnostic per pair and the strongest violated rule", async () => {
  const input = boardWithViaNearForeignPad(0.65)
  for (const clearance of [0.1, 0.4]) {
    input.minViaEdgeToPadEdgeClearance = clearance
    const result = await validateSrjWithChecks(input)
    const errors = result.pcbIssues.filter(
      (issue) =>
        issue.type === "pcb_pad_pad_clearance_error" &&
        issue.pcb_pad_pad_clearance_error_id.startsWith("via_pad_clearance_"),
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ minimum_clearance: clearance })
  }
})
