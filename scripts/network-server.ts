import { AUTOROUTER_VERSION, PIPELINE9_NETWORKED_SOLVE_POLICY, type Pipeline9NetworkedHighDensityNodeInput,
  type Pipeline9NetworkedHighDensityNodeOutput } from "../lib/network/types"
import { solvePipeline9NetworkedHighDensityNode } from "../lib/network/solvePipeline9NetworkedHighDensityNode"
import { networkCacheKey, PIPELINE9_NETWORKED_BOARD_POLICY, solvePipeline9NetworkedBoard,
  validateBoardInput, type Pipeline9NetworkedBoardInput, type Pipeline9NetworkedBoardOutput } from "../lib/network/boardContract"

type Input = Pipeline9NetworkedHighDensityNodeInput | Pipeline9NetworkedBoardInput
type Output = Pipeline9NetworkedHighDensityNodeOutput | Pipeline9NetworkedBoardOutput

/** Loopback service for this implementation; advertises its independent board extension. */
export function createHdCache2Service({ port = 0, hostname = "127.0.0.1" }: { port?: number; hostname?: string } = {}) {
  const cache = new Map<string, Output>()
  const stats = { batchRequests: 0, singleRequests: 0, solverRuns: 0, cacheHits: 0, capabilityRequests: 0, boardSolverRuns: 0, nodeSolverRuns: 0 }
  const server = Bun.serve({ port, hostname, idleTimeout: 0, maxRequestBodySize: 64 * 1024 * 1024, async fetch(request) {
    const path = new URL(request.url).pathname
    const headers = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers })
    if (path === "/benchmark-status" && request.method === "GET")
      return Response.json({ autorouterVersion: AUTOROUTER_VERSION, cacheEntries: cache.size, stats: { ...stats } }, { headers })
    if (path === "/health" && request.method === "GET") {
      stats.capabilityRequests++
      return Response.json({ ok: true, service: "minimal-autorouter-rewrite-2026", autorouterVersion: AUTOROUTER_VERSION,
        solvePolicies: [PIPELINE9_NETWORKED_SOLVE_POLICY, PIPELINE9_NETWORKED_BOARD_POLICY], cacheIdentity: "version-contract-namespace-sha256", storage: "process-memory" }, { headers })
    }
    if (request.method !== "POST") return new Response("POST required", { status: 405, headers })
    if (path !== "/solve" && path !== "/solve-batch") return new Response("Unknown endpoint", { status: 404, headers })
    try {
      const body = await request.json() as { autorouterVersion: string; cacheVersion?: string; input?: Input; items?: { requestId: string; input: Input }[] }
      if (body.autorouterVersion !== AUTOROUTER_VERSION) return Response.json({ ok: false, message: "Unsupported autorouter version" }, { status: 409, headers })
      if (body.cacheVersion !== undefined && (typeof body.cacheVersion !== "string" || !body.cacheVersion.trim())) throw new Error("Invalid cache namespace")
      const envelope = { autorouterVersion: AUTOROUTER_VERSION, ...(body.cacheVersion === undefined ? {} : { cacheVersion: body.cacheVersion }) }
      const validate = async (input: Input | undefined): Promise<Input> => {
        if (input?.solvePolicy === PIPELINE9_NETWORKED_BOARD_POLICY) return await validateBoardInput(input)
        if (input?.solvePolicy !== PIPELINE9_NETWORKED_SOLVE_POLICY) throw new Error("Unsupported solve contract")
        return input
      }
      const key = (input: Input) => networkCacheKey(envelope.autorouterVersion, envelope.cacheVersion, input)
      if (path === "/solve-batch") {
        if (!Array.isArray(body.items) || body.items.length > 100) throw new Error("Expected at most 100 batch items")
        stats.batchRequests++
        const lines = await Promise.all(body.items.map(async item => {
          if (typeof item.requestId !== "string") throw new Error("Missing requestId")
          const input = await validate(item.input), result = cache.get(await key(input))
          if (result) stats.cacheHits++
          return JSON.stringify(result ? { requestId: item.requestId, ok: true, ...envelope, source: "cache", ...result }
            : { requestId: item.requestId, ok: false, ...envelope, code: "CACHE_MISS", message: "No exact cached routing problem" })
        }))
        return new Response(`${lines.join("\n")}\n`, { headers: { ...headers, "content-type": "application/x-ndjson" } })
      }
      stats.singleRequests++
      const input = await validate(body.input), cacheKey = await key(input), cached = cache.get(cacheKey)
      if (cached) stats.cacheHits++
      else { stats.solverRuns++; stats[input.solvePolicy === PIPELINE9_NETWORKED_BOARD_POLICY ? "boardSolverRuns" : "nodeSolverRuns"]++ }
      const result = cached ?? (input.solvePolicy === PIPELINE9_NETWORKED_BOARD_POLICY ? solvePipeline9NetworkedBoard(input) : solvePipeline9NetworkedHighDensityNode(input))
      cache.set(cacheKey, result)
      return Response.json({ ok: true, ...envelope, source: cached ? "cache" : "solver", ...result }, { headers })
    } catch (error) { return Response.json({ ok: false, message: error instanceof Error ? error.message : String(error) }, { status: 400, headers }) }
  } })
  return { server, cache, stats }
}
if (import.meta.main) {
  const { server } = createHdCache2Service({ port: Number(process.env.PORT ?? 3080) })
  console.log(`Independent Pipeline9 routing service: ${server.url}`)
}
