import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Networked } from "../../lib/Pipeline9_Networked"
import { Pipeline9 } from "../../lib/Pipeline9"
import { HdCache2Client } from "../../lib/network/HdCache2Client"
import { NetworkRoutingSolver, projectBoardNode } from "../../lib/network/NetworkRoutingSolver"
import { solvePipeline9NetworkedHighDensityNode } from "../../lib/network/solvePipeline9NetworkedHighDensityNode"
import { toHighDensity } from "../../lib/network/nodeConversion"
import { AUTOROUTER_VERSION, PIPELINE9_NETWORKED_SOLVE_POLICY, type Pipeline9NetworkedHighDensityNodeInput } from "../../lib/network/types"
import type { SimpleRouteJson } from "../../lib/types"
import { createHdCache2Service } from "../../scripts/network-server"

const board = (): SimpleRouteJson => ({ layerCount: 2, minTraceWidth: 0.1, defaultObstacleMargin: 0.1,
  bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [],
  connections: [{ name: "signal", pointsToConnect: [{ x: -2, y: 0, layer: "top" }, { x: 2, y: 0, layer: "top" }] }] })
const input = (): Pipeline9NetworkedHighDensityNodeInput => ({ solvePolicy: PIPELINE9_NETWORKED_SOLVE_POLICY,
  enableRegionalFallback: true, layerCount: 2, effort: 1, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1,
  colorMap: {}, connectivityNetMap: { signal: ["signal"] }, obstacles: [], regionalObstacles: [], nodePf: null,
  nodeWithPortPoints: { capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 10, height: 10, availableZ: [0, 1],
    portPoints: [{ x: -2, y: 0, z: 0, connectionName: "signal" }, { x: 2, y: 0, z: 0, connectionName: "signal" }] } })
const good = () => ({ ok: true, autorouterVersion: AUTOROUTER_VERSION, source: "cache", ...solvePipeline9NetworkedHighDensityNode(input()) })

test("network pipeline performs an actual cold solve and a fully cached hot solve", async () => {
  const service = createHdCache2Service()
  try {
    const cold = new AutoroutingPipelineSolver9_Networked(board(), { hdCache2ServerUrl: service.server.url.toString(), hdCache2CacheVersion: "test-cold-hot" })
    expect(() => cold.solve()).toThrow("async")
    expect(() => cold.solveUntilPhase("highDensityRouteSolver")).toThrow("solveUntilPhaseAsync")
    await cold.solveUntilPhaseAsync("highDensityRouteSolver")
    expect(cold.getCurrentPhase()).toBe("highDensityRouteSolver")
    await cold.solveAsync(); await cold.highDensityRouteSolver!.waitForAllRemoteRequests!()
    expect(cold.solved).toBe(true); expect(cold.failed).toBe(false)
    expect(cold.highDensityRouteSolver!.routes[0]!.route.every(point => Number.isInteger(point.z))).toBe(true)
    expect(cold.highDensityRouteSolver!.getSimplifiedTraces()[0]!.type).toBe("pcb_trace")
    expect(cold.highDensityRouteSolver!.stats).toMatchObject({ remoteRequestsStarted: 1, remoteRequestsCompleted: 1,
      remoteBatchCacheMisses: 1, remoteSingleRequestsStarted: 1, remoteSolverResults: 1, remoteTransportFallbacks: 0 })
    const hot = new AutoroutingPipelineSolver9_Networked(board(), { hdCache2ServerUrl: service.server.url.toString(), hdCache2CacheVersion: "test-cold-hot" })
    await hot.solveAsync(); await hot.highDensityRouteSolver!.waitForAllRemoteRequests!()
    expect(hot.solved).toBe(true)
    expect(hot.highDensityRouteSolver!.stats).toMatchObject({ remoteRequestsStarted: 1, remoteRequestsCompleted: 1,
      remoteBatchRequestsCompleted: 1, remoteCacheHits: 1, remoteBatchCacheMisses: 0, remoteSingleRequestsStarted: 0,
      remoteSolverResults: 0, remoteTransportFallbacks: 0 })
    expect(hot.getOutputSimpleRouteJson()).toEqual(cold.getOutputSimpleRouteJson())
    expect(service.stats.solverRuns).toBe(1)
    const local = new Pipeline9(board()); local.solve()
    expect(hot.getOutputSimplifiedPcbTraces().map(trace => trace.route)).toEqual(local.getOutputSimplifiedPcbTraces().map(trace => trace.route))
  } finally { service.server.stop(true) }
})

test("network options reject effort other than one", () => {
  expect(() => new AutoroutingPipelineSolver9_Networked(board(), { effort: 2 as 1 })).toThrow("effort=1")
  expect(() => new HdCache2Client(AUTOROUTER_VERSION, "http://127.0.0.1", { cacheVersion: " " })).toThrow("empty")
})

test("NDJSON parser handles out-of-order chunks, duplicates and unknown IDs", async () => {
  const response = good(), encoder = new TextEncoder()
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() {
    const lines = [JSON.stringify({ requestId: "unknown", ...response }), "not json", JSON.stringify({ requestId: "1", ...response }),
      JSON.stringify({ requestId: "1", ...response }), JSON.stringify({ requestId: "0", ...response })].join("\n")
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(lines.slice(0, 37)))
      controller.enqueue(encoder.encode(lines.slice(37)))
      controller.close()
    } }))
  } })
  try {
    const client = new HdCache2Client(AUTOROUTER_VERSION, server.url.toString())
    const results = await Promise.all(client.solveMany([input(), input()])); await client.waitForAllRequests()
    expect(results.map(result => result.kind)).toEqual(["remote", "remote"])
    expect(client.stats).toMatchObject({ batchUnknownRequestIds: 1, batchInvalidLines: 1, batchDuplicateRequestIds: 1 })
  } finally { server.stop(true) }
})

test("invalid remote geometry falls back to the local solver", async () => {
  const response = good()
  if (response.status !== "solved") throw new Error("Synthetic node should solve")
  response.routes[0]!.route.at(-1)!.x = 1
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { return new Response(JSON.stringify({ requestId: "0", ...response }) + "\n") } })
  try {
    const solver = new AutoroutingPipelineSolver9_Networked(board(), { hdCache2ServerUrl: server.url.toString() })
    await solver.solveAsync(); await solver.highDensityRouteSolver!.waitForAllRemoteRequests!()
    expect(solver.solved).toBe(true)
    expect(solver.highDensityRouteSolver!.stats).toMatchObject({ remoteTransportFallbacks: 1, remoteFallbackReasonCounts: { invalid_response: 1 } })
    expect(solver.getOutputSimplifiedPcbTraces()[0]!.route.at(-1)).toMatchObject({ x: 2, y: 0 })
  } finally { server.stop(true) }
})

for (const [name, mutation, expected] of [
  ["version mismatch", (value: any) => ({ ...value, autorouterVersion: "wrong" }), "version_mismatch"],
  ["namespace mismatch", (value: any) => ({ ...value, cacheVersion: "wrong" }), "cache_version_mismatch"],
  ["missing response", (_value: any) => ({ requestId: "unrequested" }), "missing_response"],
] as const) test(`client rejects ${name}`, async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { return new Response(JSON.stringify(mutation({ requestId: "0", ...good() })) + "\n") } })
  try {
    const client = new HdCache2Client(AUTOROUTER_VERSION, server.url.toString())
    expect(await client.solveMany([input()])[0]).toMatchObject({ kind: "local-fallback", reason: expected })
    await client.waitForAllRequests()
  } finally { server.stop(true) }
})

test("logical timeout starts local work and draining accounts for the late response", async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch() {
    await new Promise(resolve => setTimeout(resolve, 40))
    return new Response(JSON.stringify({ requestId: "0", ...good() }) + "\n")
  } })
  try {
    const pipeline = new Pipeline9(board()); pipeline.solveUntilPhase("highDensityRouteSolver")
    const stage = new NetworkRoutingSolver(pipeline.getRoutingProblem(), { hdCache2ServerUrl: server.url.toString(), requestTimeoutMs: 2 })
    while (!stage.solved && !stage.failed) {
      stage.step()
      if (stage.pendingEffects?.length) await Promise.all(stage.pendingEffects.map(effect => effect.promise))
    }
    expect(stage.solved).toBe(true)
    expect(stage.stats.remoteLogicalTimeoutFallbacks).toBe(1)
    await stage.waitForAllRemoteRequests()
    expect(stage.stats.remoteRequestsCompleted).toBe(1)
  } finally { server.stop(true) }
})

test("unsupported geometry is reported instead of silently omitted from a network request", () => {
  const source = board(); source.outline = [{ x: -4, y: -4 }, { x: 4, y: -4 }, { x: 0, y: 4 }]
  const pipeline = new Pipeline9(source); pipeline.solveUntilPhase("highDensityRouteSolver")
  expect(projectBoardNode(pipeline.getRoutingProblem())).toContain("nonrectangular")
})

test("batches respect the 100 item limit and oversized items use the single endpoint", async () => {
  const response = good(), batchSizes: number[] = [], paths: string[] = []
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const path = new URL(request.url).pathname; paths.push(path)
    const body = await request.json() as any
    if (path === "/solve") return Response.json(response)
    batchSizes.push(body.items.length)
    return new Response(body.items.map((item: any) => JSON.stringify({ requestId: item.requestId, ...response })).join("\n") + "\n")
  } })
  try {
    const client = new HdCache2Client(AUTOROUTER_VERSION, server.url.toString())
    expect((await Promise.all(client.solveMany(Array.from({ length: 101 }, input)))).every(result => result.kind === "remote")).toBe(true)
    await client.waitForAllRequests()
    expect(batchSizes).toEqual([100, 1])
    const large = input(); large.colorMap = { label: "a".repeat(2 * 1024 * 1024) }
    expect(await client.solveMany([large])[0]).toMatchObject({ kind: "remote" })
    await client.waitForAllRequests()
    expect(paths.at(-1)).toBe("/solve")
  } finally { server.stop(true) }
})

test("a valid remote terminal failure fails the pipeline without a transport fallback", async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { return new Response(JSON.stringify({
    requestId: "0", ok: true, autorouterVersion: AUTOROUTER_VERSION, source: "solver", status: "failed",
    solutionStage: "regional-fallback", ordinaryFailure: "Ordinary routing failed", error: "Regional routing failed",
  }) + "\n") } })
  try {
    const solver = new AutoroutingPipelineSolver9_Networked(board(), { hdCache2ServerUrl: server.url.toString() })
    await solver.solveAsync(); await solver.highDensityRouteSolver!.waitForAllRemoteRequests!()
    expect(solver.failed).toBe(true); expect(solver.solved).toBe(false)
    expect(solver.error).toBe("Regional routing failed")
    expect(solver.highDensityRouteSolver!.stats.remoteTransportFallbacks).toBe(0)
  } finally { server.stop(true) }
})

test("transport timeout resolves a fallback and does not leave a pending item", async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch() {
    await new Promise(resolve => setTimeout(resolve, 30))
    return new Response(JSON.stringify({ requestId: "0", ...good() }) + "\n")
  } })
  try {
    const client = new HdCache2Client(AUTOROUTER_VERSION, server.url.toString(), { transportTimeoutMs: 2 })
    expect(await client.solveMany([input()])[0]).toMatchObject({ kind: "local-fallback", reason: "transport_timeout" })
    await client.waitForAllRequests()
    expect(client.stats.batchRequestsCompleted).toBe(1)
  } finally { server.stop(true) }
})

test("wire metadata at a via target survives high-density coordinate deduplication", () => {
  const routes = toHighDensity([{ type: "pcb_trace", pcb_trace_id: "via-terminal", connection_name: "signal", route: [
    { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1, start_pcb_port_id: "start" },
    { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
    { route_type: "via", x: 2, y: 0, from_layer: "top", to_layer: "bottom" },
    { route_type: "wire", x: 2, y: 0, layer: "bottom", width: 0.1, end_pcb_port_id: "end" },
  ] }], input())
  expect(routes[0]!.endPcbPortId).toBe("end")
  expect(routes[0]!.route.at(-1)!.pcb_port_id).toBe("end")
})
