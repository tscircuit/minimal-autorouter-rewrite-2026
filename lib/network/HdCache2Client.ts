import { DEFAULT_HD_CACHE2_SERVER_URL, type Pipeline9NetworkedHighDensityNodeInput,
  type Pipeline9NetworkedHighDensityNodeOutput } from "./types"
import { isValidRemoteRoutes } from "./validateRemoteRoutes"

export { DEFAULT_HD_CACHE2_SERVER_URL } from "./types"
export const HD_CACHE2_TRANSPORT_TIMEOUT_MS = 310_000
export const HD_CACHE2_MAX_BATCH_ITEMS = 100
export const HD_CACHE2_MAX_BATCH_BODY_BYTES = 1.75 * 1024 * 1024
export type HdCache2FallbackReason = "http_error" | "invalid_json" | "invalid_response" | "missing_response" | "remote_error" |
  "request_serialization_error" | "response_too_large" | "transport_error" | "transport_timeout" | "cache_version_mismatch" | "version_mismatch"
export type HdCache2RemoteResponse<Output> = { ok: true; autorouterVersion: string; cacheVersion?: string; source: "cache" | "solver" } & Output
export type HdCache2SolveResult<Output = Pipeline9NetworkedHighDensityNodeOutput> = { kind: "remote"; response: HdCache2RemoteResponse<Output> } |
  { kind: "local-fallback"; reason: HdCache2FallbackReason; error: string }
export type HdCache2ClientOptions<Input = Pipeline9NetworkedHighDensityNodeInput, Output = Pipeline9NetworkedHighDensityNodeOutput> = { cacheVersion?: string; transportTimeoutMs?: number; validateOutput?: (value: unknown, input: Input) => value is Output }
export type HdCache2ClientStats = {
  batchRequestsStarted: number; batchRequestsCompleted: number; batchItemsStarted: number; batchBodyBytesStarted: number
  batchMaxBodyBytes: number; batchCacheMisses: number; singleRequestsStarted: number; batchInvalidLines: number
  batchUnknownRequestIds: number; batchDuplicateRequestIds: number
}
type Pending<Input, Output> = { id: string; input: Input; done: boolean; single: boolean
  resolve: (result: HdCache2SolveResult<Output>) => void; promise: Promise<HdCache2SolveResult<Output>> }
class ResponseError extends Error { constructor(readonly reason: HdCache2FallbackReason, message: string) { super(message) } }
function fail(reason: HdCache2FallbackReason, message: string): never { throw new ResponseError(reason, message) }
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value)
export const getHdCache2SolveUrl = (url: string): string => `${url.replace(/\/+$/, "").replace(/\/solve(?:-batch)?$/, "")}/solve`
export const getHdCache2SolveBatchUrl = (url: string): string => `${getHdCache2SolveUrl(url)}-batch`

/** Every item settles independently; a broken stream cannot discard completed results. */
export class HdCache2Client<Input = Pipeline9NetworkedHighDensityNodeInput, Output = Pipeline9NetworkedHighDensityNodeOutput> {
  readonly cacheVersion?: string
  readonly stats: HdCache2ClientStats = { batchRequestsStarted: 0, batchRequestsCompleted: 0, batchItemsStarted: 0,
    batchBodyBytesStarted: 0, batchMaxBodyBytes: 0, batchCacheMisses: 0, singleRequestsStarted: 0,
    batchInvalidLines: 0, batchUnknownRequestIds: 0, batchDuplicateRequestIds: 0 }
  private readonly timeout: number
  private readonly active = new Set<Promise<void>>()
  constructor(readonly autorouterVersion: string, readonly serverUrl = DEFAULT_HD_CACHE2_SERVER_URL, private readonly options: HdCache2ClientOptions<Input, Output> = {}) {
    this.cacheVersion = options.cacheVersion
    if (this.cacheVersion !== undefined && !this.cacheVersion.trim()) throw new Error("hd-cache2 cacheVersion must not be empty")
    this.timeout = options.transportTimeoutMs ?? HD_CACHE2_TRANSPORT_TIMEOUT_MS
    if (!Number.isFinite(this.timeout) || this.timeout <= 0) throw new Error("Network transport timeout must be positive")
  }
  private envelope() { return { autorouterVersion: this.autorouterVersion, ...(this.cacheVersion === undefined ? {} : { cacheVersion: this.cacheVersion }) } }
  private track(promise: Promise<void>): void {
    this.active.add(promise)
    void promise.finally(() => this.active.delete(promise)).catch(() => {})
  }
  async waitForAllRequests(): Promise<void> {
    while (this.active.size) await Promise.allSettled([...this.active])
  }
  private settle(pending: Pending<Input, Output>, result: HdCache2SolveResult<Output>): void { if (!pending.done) { pending.done = true; pending.resolve(result) } }
  private fallback(pending: Pending<Input, Output>, error: unknown): void {
    this.settle(pending, { kind: "local-fallback", reason: error instanceof ResponseError ? error.reason : "transport_error",
      error: error instanceof Error ? error.message : String(error) })
  }
  solveMany(inputs: readonly Input[]): Promise<HdCache2SolveResult<Output>>[] {
    const pending = inputs.map((input, index): Pending<Input, Output> => {
      let resolve!: Pending<Input, Output>["resolve"]
      const promise = new Promise<HdCache2SolveResult<Output>>(done => { resolve = done })
      return { id: String(index), input, done: false, single: false, resolve, promise }
    })
    let batch: Pending<Input, Output>[] = []
    const bytes = (items: Pending<Input, Output>[]) => new TextEncoder().encode(JSON.stringify({ ...this.envelope(), items: items.map(p => ({ requestId: p.id, input: p.input })) })).length
    const flush = () => { if (batch.length) { this.track(this.batch(batch)); batch = [] } }
    for (const item of pending) {
      try {
        if (bytes([item]) > HD_CACHE2_MAX_BATCH_BODY_BYTES) { flush(); this.single(item); continue }
        if (batch.length === HD_CACHE2_MAX_BATCH_ITEMS || bytes([...batch, item]) > HD_CACHE2_MAX_BATCH_BODY_BYTES) flush()
        batch.push(item)
      } catch (error) { this.fallback(item, new ResponseError("request_serialization_error", String(error))) }
    }
    flush()
    return pending.map(item => item.promise)
  }
  private version(value: Record<string, any>): void {
    if (value.autorouterVersion !== this.autorouterVersion) fail("version_mismatch", "Remote autorouter version does not match")
    if (value.cacheVersion !== this.cacheVersion) fail("cache_version_mismatch", "Remote cache namespace does not match")
  }
  private response(value: unknown, input: Input): HdCache2RemoteResponse<Output> {
    if (!object(value)) fail("invalid_response", "Remote result is not an object")
    if (value.ok !== true) fail("remote_error", typeof value.message === "string" ? value.message : "Remote solve rejected")
    this.version(value)
    if (value.source !== "cache" && value.source !== "solver") fail("invalid_response", "Invalid cache source")
    if (this.options.validateOutput) {
      if (!this.options.validateOutput(value, input)) fail("invalid_response", "Remote output fails its negotiated contract")
      return value as HdCache2RemoteResponse<Output>
    }
    const nodeInput = input as Pipeline9NetworkedHighDensityNodeInput
    if (value.solutionStage !== "ordinary" && value.solutionStage !== "regional-fallback") fail("invalid_response", "Invalid solution stage")
    const regional = value.solutionStage === "regional-fallback"
    if (regional && (!nodeInput.enableRegionalFallback || typeof value.ordinaryFailure !== "string" || !value.ordinaryFailure)) fail("invalid_response", "Invalid regional fallback metadata")
    if (!regional && Object.hasOwn(value, "ordinaryFailure")) fail("invalid_response", "Unexpected regional metadata")
    if (value.status === "failed") {
      if ((!regional && nodeInput.enableRegionalFallback) || typeof value.error !== "string" || !value.error) fail("invalid_response", "Invalid terminal failure")
    } else if (value.status !== "solved" || !isValidRemoteRoutes(value.routes, nodeInput, regional)) fail("invalid_response", "Remote routes fail geometry or connectivity validation")
    return value as HdCache2RemoteResponse<Output>
  }
  private async request(url: string, body: string, accept: string, consume: (response: Response) => Promise<void>): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)
    try {
      const response = await fetch(url, { method: "POST", body, headers: { "content-type": "application/json", accept }, signal: controller.signal })
      if (!response.ok) fail("http_error", `hd-cache2 returned HTTP ${response.status}`)
      await consume(response)
    } catch (error) {
      if (controller.signal.aborted) fail("transport_timeout", `Network transport exceeded ${this.timeout} ms`)
      throw error
    } finally { clearTimeout(timer) }
  }
  private single(pending: Pending<Input, Output>): void {
    if (pending.done || pending.single) return
    pending.single = true
    this.stats.singleRequestsStarted++
    this.track((async () => {
      try {
        const body = JSON.stringify({ ...this.envelope(), input: pending.input })
        await this.request(getHdCache2SolveUrl(this.serverUrl), body, "application/json", async response => {
          const text = await response.text()
          if (text.length > 16 * 1024 * 1024) fail("response_too_large", "Remote response exceeds size limit")
          let value: unknown
          try { value = JSON.parse(text) } catch { fail("invalid_json", "Remote response is not JSON") }
          this.settle(pending, { kind: "remote", response: this.response(value, pending.input) })
        })
      } catch (error) { this.fallback(pending, error) }
    })())
  }
  private async batch(items: Pending<Input, Output>[]): Promise<void> {
    const body = JSON.stringify({ ...this.envelope(), items: items.map(item => ({ requestId: item.id, input: item.input })) })
    const bodyBytes = new TextEncoder().encode(body).length
    this.stats.batchRequestsStarted++; this.stats.batchItemsStarted += items.length
    this.stats.batchBodyBytesStarted += bodyBytes; this.stats.batchMaxBodyBytes = Math.max(this.stats.batchMaxBodyBytes, bodyBytes)
    const seen = new Set<string>(), byId = new Map(items.map(item => [item.id, item]))
    const line = (text: string) => {
      if (!text.trim()) return
      if (text.length > 16 * 1024 * 1024) fail("response_too_large", "NDJSON line exceeds size limit")
      let value: unknown
      try { value = JSON.parse(text) } catch { this.stats.batchInvalidLines++; return }
      if (!object(value) || typeof value.requestId !== "string") { this.stats.batchInvalidLines++; return }
      const pending = byId.get(value.requestId)
      if (!pending) { this.stats.batchUnknownRequestIds++; return }
      if (seen.has(value.requestId)) { this.stats.batchDuplicateRequestIds++; return }
      seen.add(value.requestId)
      try {
        if (value.ok === false && value.code === "CACHE_MISS") {
          this.version(value)
          if (typeof value.message !== "string") fail("invalid_response", "Invalid cache miss")
          this.stats.batchCacheMisses++; this.single(pending)
        } else this.settle(pending, { kind: "remote", response: this.response(value, pending.input) })
      } catch (error) { this.stats.batchInvalidLines++; this.fallback(pending, error) }
    }
    try {
      await this.request(getHdCache2SolveBatchUrl(this.serverUrl), body, "application/x-ndjson", async response => {
        if (!response.body) fail("invalid_response", "Missing NDJSON response body")
        const reader = response.body.getReader(), decoder = new TextDecoder()
        let buffer = ""
        try {
          while (true) {
            const part = await reader.read()
            buffer += decoder.decode(part.value, { stream: !part.done })
            let end: number
            while ((end = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, end)); buffer = buffer.slice(end + 1) }
            if (buffer.length > 16 * 1024 * 1024) fail("response_too_large", "Unterminated NDJSON line exceeds size limit")
            if (part.done) { if (buffer.trim()) line(buffer); break }
            if (seen.size === items.length) break
          }
        } finally { await reader.cancel().catch(() => {}) }
      })
      for (const pending of items) if (!seen.has(pending.id)) this.fallback(pending, new ResponseError("missing_response", `Missing batch result ${pending.id}`))
    } catch (error) { for (const pending of items) if (!pending.single) this.fallback(pending, error) }
    finally { this.stats.batchRequestsCompleted++ }
  }
}
