import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

// The published 0.0.884 package embeds 0.0.883 as its wire-protocol version.
const BASELINE_VERSION = "0.0.883"
const BASELINE_MODULE_SHA256 = "25f50b7f73fd4b387f96a03e0e2672e9ca3a80c3ec567a9e0428e91dc9ce8e14"
type NodeResult = { status: "solved" | "failed"; [key: string]: unknown }

/** Benchmark-only service. The published baseline helper is never used by lib/. */
export async function createBaselineNetworkService({ modulePath, port = 0, hostname = "127.0.0.1" }: { modulePath: string; port?: number; hostname?: string }) {
  const absoluteModulePath = resolve(modulePath)
  const sha256 = createHash("sha256").update(await readFile(absoluteModulePath)).digest("hex")
  if (sha256 !== BASELINE_MODULE_SHA256) throw new Error("Baseline module does not match the pinned 0.0.884 published bundle")
  const { solvePipeline9NetworkedHighDensityNode } = await import(pathToFileURL(absoluteModulePath).href)
  if (typeof solvePipeline9NetworkedHighDensityNode !== "function") throw new Error("Baseline is missing its public high-density node helper")
  const cache = new Map<string, NodeResult>()
  const stats = { batchRequests: 0, singleRequests: 0, solverRuns: 0, cacheHits: 0 }
  const server = Bun.serve({ hostname, port, idleTimeout: 0, maxRequestBodySize: 64 * 1024 * 1024, async fetch(request) {
    const path = new URL(request.url).pathname
    if (request.method === "GET" && path === "/benchmark-status") return Response.json({ autorouterVersion: BASELINE_VERSION, moduleSha256: sha256, cacheEntries: cache.size, stats })
    if (request.method !== "POST") return new Response("POST required", { status: 405 })
    if (path !== "/solve" && path !== "/solve-batch") return new Response("Unknown endpoint", { status: 404 })
    try {
      const body = await request.json() as { autorouterVersion: string; cacheVersion?: string; input?: unknown; items?: Array<{ requestId: string; input: unknown }> }
      if (body.autorouterVersion !== BASELINE_VERSION) return Response.json({ ok: false, message: "Unsupported baseline autorouter version" }, { status: 409 })
      if (body.cacheVersion !== undefined && (typeof body.cacheVersion !== "string" || !body.cacheVersion.trim())) throw new Error("Invalid cache namespace")
      const envelope = { autorouterVersion: BASELINE_VERSION, ...(body.cacheVersion === undefined ? {} : { cacheVersion: body.cacheVersion }) }
      const key = (input: unknown): string => JSON.stringify([envelope.autorouterVersion, envelope.cacheVersion, input])
      if (path === "/solve-batch") {
        if (!Array.isArray(body.items) || body.items.length > 100) throw new Error("Expected at most 100 batch items")
        stats.batchRequests++
        const lines = body.items.map(item => {
          if (typeof item.requestId !== "string") throw new Error("Missing requestId")
          const result = cache.get(key(item.input))
          if (result) stats.cacheHits++
          return JSON.stringify(result ? { requestId: item.requestId, ok: true, ...envelope, source: "cache", ...result } : { requestId: item.requestId, ok: false, ...envelope, code: "CACHE_MISS", message: "No exact cached node" })
        })
        return new Response(`${lines.join("\n")}\n`, { headers: { "content-type": "application/x-ndjson" } })
      }
      if (!body.input || typeof body.input !== "object") throw new Error("Missing node input")
      stats.singleRequests++
      const cached = cache.get(key(body.input))
      if (cached) stats.cacheHits++
      else stats.solverRuns++
      const result = cached ?? await solvePipeline9NetworkedHighDensityNode(body.input) as NodeResult
      cache.set(key(body.input), result)
      return Response.json({ ok: true, ...envelope, source: cached ? "cache" : "solver", ...result })
    } catch (error) { return Response.json({ ok: false, message: error instanceof Error ? error.message : String(error) }, { status: 400 }) }
  } })
  return { server, cache, stats }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  const moduleIndex = args.indexOf("--module"), portIndex = args.indexOf("--port")
  if (moduleIndex < 0 || !args[moduleIndex + 1]) throw new Error("Usage: bun scripts/benchmark/baseline-network-server.ts --module BASELINE/dist/index.js [--port 3081]")
  const { server } = await createBaselineNetworkService({ modulePath: args[moduleIndex + 1]!, port: portIndex < 0 ? 3081 : Number(args[portIndex + 1]) })
  console.log(`Pinned baseline ${BASELINE_VERSION} node service: ${server.url}`)
}
