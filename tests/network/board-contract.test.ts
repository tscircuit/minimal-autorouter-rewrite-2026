import { expect, test } from "bun:test"
import { Pipeline9 } from "../../lib/Pipeline9"
import { Pipeline9_Networked } from "../../lib/Pipeline9_Networked"
import { RoutingSolver } from "../../lib/routing/RoutingSolver"
import { NetworkRoutingSolver, DEFAULT_PIPELINE9_NETWORKED_BOARD_TIMEOUT_MS, projectBoardNode } from "../../lib/network/NetworkRoutingSolver"
import { canonicalJson, createBoardInput, isValidBoardOutput, networkCacheKey, PIPELINE9_NETWORKED_BOARD_POLICY,
  solvePipeline9NetworkedBoard, validateBoardInput, type Pipeline9NetworkedBoardInput } from "../../lib/network/boardContract"
import { isValidBoardRoutes } from "../../lib/network/validateBoardRoutes"
import { AUTOROUTER_VERSION } from "../../lib/network/types"
import { createHdCache2Service } from "../../scripts/network-server"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"

const source = (): SimpleRouteJson => ({ layerCount: 2, minTraceWidth: 0.1, defaultObstacleMargin: 0.1,
  minBoardEdgeClearance: 0.05, minTraceToPadEdgeClearance: 0.1, minViaEdgeToPadEdgeClearance: 0.12,
  allowViaInPad: false, bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  outline: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 2 }, { x: 0, y: 5 }, { x: -5, y: 5 }],
  obstacles: [{ type: "oval", center: { x: 0, y: 1 }, width: 1, height: 0.5, ccwRotationDegrees: 30, layers: ["top"], connectedTo: ["fixed"] }],
  connections: [
    { name: "signal", pointsToConnect: [{ x: -3, y: -1, layer: "top", pcb_port_id: "s" }, { x: 3, y: -1, layer: "top", pcb_port_id: "e" }] },
    { name: "power", nominalTraceWidth: 0.2, pointsToConnect: [{ x: -3, y: -3, layers: ["top", "bottom"] }, { x: 3, y: -3, layer: "bottom" }] },
  ], buses: [{ busId: "power-bus", connectionNames: ["power"], allowedLayers: ["bottom"], traceWidth: 0.2 }],
  traces: [{ type: "pcb_trace", pcb_trace_id: "fixed-copper", connection_name: "fixed", route: [
    { route_type: "wire", x: -1, y: 2, layer: "top", width: 0.1 }, { route_type: "wire", x: 1, y: 2, layer: "top", width: 0.1 },
  ] }] })
function problem(board = source()) {
  const pipeline = new Pipeline9(board); pipeline.solveUntilPhase("highDensityRouteSolver")
  return pipeline.getRoutingProblem()
}
async function drain(stage: NetworkRoutingSolver) {
  while (!stage.solved && !stage.failed) {
    stage.step()
    if (stage.pendingEffects?.length) await Promise.all(stage.pendingEffects.map(effect => effect.promise))
  }
  await stage.waitForAllRemoteRequests()
}

test("exact board contract preserves outlines, fixed copper, ovals, clearances, widths and layer choices in real cold/hot remote work", async () => {
  const input = problem(), snapshot = canonicalJson(input), service = createHdCache2Service()
  try {
    expect(typeof projectBoardNode(input)).toBe("string")
    const cold = new NetworkRoutingSolver(input, { hdCache2ServerUrl: service.server.url.toString(), hdCache2CacheVersion: "complete-board" })
    await drain(cold)
    expect(cold.solved).toBe(true)
    expect(cold.requestTimeoutMs).toBe(DEFAULT_PIPELINE9_NETWORKED_BOARD_TIMEOUT_MS)
    expect(cold.stats).toMatchObject({ remoteBoardContractSupported: true, remoteContract: PIPELINE9_NETWORKED_BOARD_POLICY,
      remoteRequestsStarted: 1, remoteRequestsCompleted: 1, remoteBoardResults: 1, remoteSolverResults: 1,
      remoteBatchCacheMisses: 1, remoteTransportFallbacks: 0, remoteUnsupportedInputs: 0 })
    const hot = new NetworkRoutingSolver(input, { hdCache2ServerUrl: service.server.url.toString(), hdCache2CacheVersion: "complete-board" })
    await drain(hot)
    expect(hot.solved).toBe(true)
    expect(hot.stats).toMatchObject({ remoteCacheHits: 1, remoteSingleRequestsStarted: 0, remoteTransportFallbacks: 0 })
    const local = new RoutingSolver(input); local.solve()
    expect(cold.routes).toEqual(local.routes)
    expect(hot.routes).toEqual(cold.routes)
    expect(service.stats).toMatchObject({ solverRuns: 1, boardSolverRuns: 1, nodeSolverRuns: 0, cacheHits: 1 })
    const statusUrl = new URL("benchmark-status", service.server.url)
    const before = await (await fetch(statusUrl)).json()
    expect(before).toMatchObject({ autorouterVersion: AUTOROUTER_VERSION, cacheEntries: 1, stats: { solverRuns: 1, cacheHits: 1 } })
    expect(await (await fetch(statusUrl)).json()).toEqual(before)
    const isolated = new NetworkRoutingSolver(input, { hdCache2ServerUrl: service.server.url.toString(), hdCache2CacheVersion: "other-namespace" })
    await drain(isolated)
    expect(isolated.stats).toMatchObject({ remoteCacheHits: 0, remoteSolverResults: 1, remoteTransportFallbacks: 0 })
    expect(service.stats.solverRuns).toBe(2)
    expect(canonicalJson(input)).toBe(snapshot)
  } finally { service.server.stop(true) }
})

test("capability negotiation never sends the board extension to an old endpoint", async () => {
  const paths: string[] = []
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    paths.push(new URL(request.url).pathname)
    return Response.json({ ok: true, autorouterVersion: AUTOROUTER_VERSION })
  } })
  try {
    const stage = new NetworkRoutingSolver(problem(), { hdCache2ServerUrl: server.url.toString() })
    await drain(stage)
    expect(stage.solved).toBe(true)
    expect(paths).toEqual(["/health"])
    expect(stage.stats).toMatchObject({ remoteBoardContractSupported: false, remoteRequestsStarted: 0, remoteUnsupportedInputs: 1 })
  } finally { server.stop(true) }
})

test("SHA cache identity binds all exact constraints, namespace, implementation version and contract", async () => {
  const input = await createBoardInput(problem())
  await expect(validateBoardInput(JSON.parse(JSON.stringify(input)))).resolves.toEqual(input)
  const reordered = { problem: input.problem, problemHash: input.problemHash, solvePolicy: input.solvePolicy }
  const key = await networkCacheKey(AUTOROUTER_VERSION, "test", input)
  expect(await networkCacheKey(AUTOROUTER_VERSION, "test", reordered)).toBe(key)
  expect(await networkCacheKey("different-version", "test", input)).not.toBe(key)
  expect(await networkCacheKey(AUTOROUTER_VERSION, "other", input)).not.toBe(key)
  expect(await networkCacheKey(AUTOROUTER_VERSION, "test", { ...input, solvePolicy: "other-contract" })).not.toBe(key)
  const mutated = structuredClone(input); mutated.problem.fixedTraces[0]!.route[0] = { route_type: "wire", x: -2, y: 2, layer: "top", width: 0.1 }
  expect(await networkCacheKey(AUTOROUTER_VERSION, "test", mutated)).not.toBe(key)
  await expect(validateBoardInput(mutated)).rejects.toThrow("digest mismatch")
  expect(() => canonicalJson({ a: Infinity })).toThrow("Nonfinite")
  expect(canonicalJson(Array(2))).toBe("[null,null]")
})

test("board response validation rejects disconnected endpoints, foreign aliases, wrong widths and missing vias", async () => {
  const input = await createBoardInput(problem()), result = solvePipeline9NetworkedBoard(input)
  expect(result.status).toBe("solved")
  if (result.status !== "solved") throw new Error("Synthetic board must solve")
  expect(isValidBoardOutput(result, input)).toBe(true)
  expect(isValidBoardOutput({ ...result, problemHash: "wrong" }, input)).toBe(false)
  const disconnected = structuredClone(result)
  const last = disconnected.traces[0]!.route.at(-1)!
  if (last.route_type === "wire") last.x = 2
  expect(isValidBoardOutput(disconnected, input)).toBe(false)
  const aliases = structuredClone(result); aliases.traces[0]!.connectsTo = ["fixed"]
  expect(isValidBoardOutput(aliases, input)).toBe(false)
  const width = structuredClone(result)
  if (width.traces[0]!.route[0]!.route_type === "wire") width.traces[0]!.route[0]!.width = 0.001
  expect(isValidBoardOutput(width, input)).toBe(false)
  const jumped = structuredClone(result)
  const point = jumped.traces[0]!.route.at(-1)!
  if (point.route_type === "wire") point.layer = point.layer === "bottom" ? "top" : "bottom"
  expect(isValidBoardOutput(jumped, input)).toBe(false)
})

test("remote board routes crossing fixed foreign copper or leaving the outline are rejected", () => {
  const board = source(); board.connections = [board.connections[0]!]; board.buses = undefined
  const input = problem(board)
  const crossing: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: "bad", connection_name: "signal", route: [
    { route_type: "wire", x: -3, y: -1, layer: "top", width: 0.1 },
    { route_type: "wire", x: 0, y: 3, layer: "top", width: 0.1 },
    { route_type: "wire", x: 3, y: -1, layer: "top", width: 0.1 },
  ] }
  expect(isValidBoardRoutes([crossing], input)).toBe(false)
  crossing.route[1] = { route_type: "wire", x: 4, y: 4, layer: "top", width: 0.1 }
  expect(isValidBoardRoutes([crossing], input)).toBe(false)
})

test("infeasible board certificate is recomputed before accepting a remote failure and remains cached", async () => {
  const board = source(); board.obstacles.push({ type: "rect", obstacleId: "foreign-at-terminal", center: { x: -3, y: -1 },
    width: 0.5, height: 0.5, layers: ["top"], connectedTo: ["unrelated"] })
  const input = await createBoardInput(problem(board)), result = solvePipeline9NetworkedBoard(input)
  expect(result.status).toBe("failed")
  if (result.status !== "failed") throw new Error("Board contains a certified short")
  expect(result.terminalContradiction).toMatchObject({ kind: "terminal-inside-unrelated-copper" })
  expect(isValidBoardOutput(result, input)).toBe(true)
  const forged = structuredClone(result); forged.terminalContradiction!.terminalNet = "forged-net"
  expect(isValidBoardOutput(forged, input)).toBe(false)
  const service = createHdCache2Service()
  try {
    const cold = new NetworkRoutingSolver(input.problem, { hdCache2ServerUrl: service.server.url.toString() }); await drain(cold)
    const hot = new NetworkRoutingSolver(input.problem, { hdCache2ServerUrl: service.server.url.toString() }); await drain(hot)
    expect(cold.failed && hot.failed).toBe(true)
    expect(cold.stats.terminalContradiction).toEqual(result.terminalContradiction)
    expect(cold.stats.remoteTransportFallbacks).toBe(0)
    expect(hot.stats.remoteCacheHits).toBe(1)
  } finally { service.server.stop(true) }
})

test("malformed negotiated board result falls back locally with an explicit reason", async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    if (new URL(request.url).pathname === "/health") return Response.json({ ok: true, autorouterVersion: AUTOROUTER_VERSION, solvePolicies: [PIPELINE9_NETWORKED_BOARD_POLICY] })
    const body = await request.json() as { items: { requestId: string; input: Pipeline9NetworkedBoardInput }[] }
    const item = body.items[0]!, result = solvePipeline9NetworkedBoard(item.input)
    return new Response(JSON.stringify({ requestId: item.requestId, ok: true, autorouterVersion: AUTOROUTER_VERSION, source: "cache", ...result, traces: [] }) + "\n")
  } })
  try {
    const stage = new NetworkRoutingSolver(problem(), { hdCache2ServerUrl: server.url.toString() }); await drain(stage)
    expect(stage.solved).toBe(true)
    expect(stage.stats).toMatchObject({ remoteRequestsStarted: 1, remoteTransportFallbacks: 1, remoteFallbackReasonCounts: { invalid_response: 1 } })
  } finally { server.stop(true) }
})

test("service rejects a changed exact problem with a stale hash before executing", async () => {
  const input = await createBoardInput(problem()), service = createHdCache2Service()
  input.problem.obstacleMargin = 0.5
  try {
    const response = await fetch(new URL("solve", service.server.url), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ autorouterVersion: AUTOROUTER_VERSION, input }) })
    expect(response.status).toBe(400)
    expect(service.stats.solverRuns).toBe(0)
  } finally { service.server.stop(true) }
})

test("async legacy phase names resolve to the real network stage", async () => {
  const pipeline = new Pipeline9_Networked(source())
  await pipeline.solveUntilPhaseAsync("globalTopologyGeneratorSolver")
  expect(pipeline.failed).toBe(false)
  expect(pipeline.getCurrentPhase()).toBe(pipeline.resolvePhase("globalTopologyGeneratorSolver"))
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
})
