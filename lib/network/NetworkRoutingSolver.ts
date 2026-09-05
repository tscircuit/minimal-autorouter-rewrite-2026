import { BaseSolver } from "../solvers/BaseSolver"
import { RoutingSolver } from "../routing/RoutingSolver"
import { getBoardLayers, getPointLayers } from "../preparation/PrepareBoardSolver"
import type { RoutingProblem } from "../routing/types"
import type { SimplifiedPcbTrace } from "../types"
import type { PortPoint } from "../types/high-density-types"
import { HdCache2Client, type HdCache2SolveResult } from "./HdCache2Client"
import { fromHighDensity } from "./nodeConversion"
import { AUTOROUTER_VERSION, DEFAULT_HD_CACHE2_SERVER_URL, PIPELINE9_NETWORKED_SOLVE_POLICY,
  type Pipeline9NetworkedHighDensityNodeInput } from "./types"

import { createBoardInput, isValidBoardOutput, PIPELINE9_NETWORKED_BOARD_POLICY, type Pipeline9NetworkedBoardInput, type Pipeline9NetworkedBoardOutput } from "./boardContract"
import { discoverNetworkCapabilities } from "./capabilities"

export const DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS = 30_000
export const DEFAULT_PIPELINE9_NETWORKED_BOARD_TIMEOUT_MS = 310_000
export type NetworkRoutingOptions = { autorouterVersion?: string; hdCache2ServerUrl?: string; hdCache2CacheVersion?: string; requestTimeoutMs?: number }

/** Preserve every route-affecting field, or make the unsupported shape explicit. */
export function projectBoardNode(problem: RoutingProblem): Pipeline9NetworkedHighDensityNodeInput | string {
  const { srj, tasks } = problem
  if (problem.fixedTraces.length) return "fixed copper requires local board routing"
  if (!tasks.length) return "no node routing is required"
  if (tasks.some(task => task.traceWidth !== tasks[0]!.traceWidth)) return "node protocol has one trace width"
  if (tasks.some(task => task.allowedLayers || getPointLayers(task.start).length !== 1 || getPointLayers(task.end).length !== 1 ||
      ("terminalVia" in task.start && task.start.terminalVia) || ("terminalVia" in task.end && task.end.terminalVia))) return "terminal or bus constraints need local routing"
  if (srj.allowViaInPad === false || srj.minBoardEdgeClearance || srj.minTraceToPadEdgeClearance || srj.minViaEdgeToPadEdgeClearance) return "board clearance policy is not representable by the node protocol"
  let bounds = srj.bounds
  if (srj.outline?.length) {
    const outline = srj.outline
    const minX = Math.min(...outline.map(point => point.x)), maxX = Math.max(...outline.map(point => point.x))
    const minY = Math.min(...outline.map(point => point.y)), maxY = Math.max(...outline.map(point => point.y))
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-5
    const corners = new Set(outline.map(point => `${near(point.x, minX) ? 0 : near(point.x, maxX) ? 1 : 2},${near(point.y, minY) ? 0 : near(point.y, maxY) ? 1 : 2}`))
    if (corners.size !== 4 || [...corners].some(corner => corner.includes("2")) || outline.some((a, i) => {
      const b = outline[(i + 1) % outline.length]!
      return !near(a.x, b.x) && !near(a.y, b.y)
    })) return "nonrectangular board outline requires local routing"
    bounds = { minX: Math.max(bounds.minX, minX), maxX: Math.min(bounds.maxX, maxX), minY: Math.max(bounds.minY, minY), maxY: Math.min(bounds.maxY, maxY) }
  }
  const layers = getBoardLayers(srj.layerCount)
  const pairs = tasks.map((task, index): [PortPoint, PortPoint] => [task.start, task.end].map((point, side) => ({
    x: point.x, y: point.y, z: layers.indexOf(getPointLayers(point)[0]!), connectionName: task.connectionName,
    rootConnectionName: task.netName, pcb_port_id: point.pcb_port_id, portPointId: `${index}:${side}`,
  })) as [PortPoint, PortPoint])
  const connectivityNetMap: Record<string, string[]> = {}
  for (const task of tasks) connectivityNetMap[task.netName] = [...new Set([...(connectivityNetMap[task.netName] ?? []), task.connectionName, ...task.connectedNames])]
  return { solvePolicy: PIPELINE9_NETWORKED_SOLVE_POLICY, enableRegionalFallback: true,
    nodeWithPortPoints: { capacityMeshNodeId: "board", center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
      width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, portPoints: pairs.flat(), portPointsInPairs: pairs, availableZ: layers.map((_, z) => z) },
    connectivityNetMap, colorMap: {}, viaDiameter: problem.viaDiameter, traceWidth: tasks[0]!.traceWidth,
    obstacleMargin: problem.obstacleMargin, effort: 1, obstacles: srj.obstacles, regionalObstacles: srj.obstacles,
    layerCount: srj.layerCount, nodePf: null }
}

/** One shared board node preserves inter-net interactions. Spatial decomposition is future work. */
export class NetworkRoutingSolver extends BaseSolver {
  routes: SimplifiedPcbTrace[] = []
  readonly client: HdCache2Client
  requestTimeoutMs: number
  private boardClient?: HdCache2Client<Pipeline9NetworkedBoardInput, Pipeline9NetworkedBoardOutput>
  private dispatchPromise?: Promise<void>
  private launched = false
  private settled?: HdCache2SolveResult | HdCache2SolveResult<Pipeline9NetworkedBoardOutput> | { kind: "logical-timeout" } | { kind: "unsupported"; reason: string }
  private remotePromise?: Promise<void>
  private local?: RoutingSolver
  constructor(readonly problem: RoutingProblem, readonly options: NetworkRoutingOptions = {}) {
    super()
    if (problem.effort !== 1) throw new Error("Pipeline9 networked high-density routing requires effort=1")
    this.MAX_ITERATIONS = 100_000_000
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) throw new Error("Pipeline9 network request timeout must be positive")
    this.client = new HdCache2Client(options.autorouterVersion ?? AUTOROUTER_VERSION, options.hdCache2ServerUrl ?? DEFAULT_HD_CACHE2_SERVER_URL,
      { cacheVersion: options.hdCache2CacheVersion })
    this.pendingEffects = []
    this.stats = { remoteRequestsStarted: 0, remoteRequestsCompleted: 0, remoteCacheHits: 0, remoteSolverResults: 0,
      remoteSolvedResults: 0, remoteFailedResults: 0, remoteOrdinaryResults: 0, remoteRegionalFallbackResults: 0,
      remoteRegionalFallbackResultsApplied: 0, remoteRegionalFallbackResultsDeferredToLocal: 0,
      remoteTransportFallbacks: 0, remoteLogicalTimeoutFallbacks: 0, remoteUnsupportedInputs: 0, remoteFallbackReasonCounts: {},
      remoteCapabilityRequests: 0, remoteBoardContractSupported: false, remoteBoardResults: 0 }
    this.syncStats()
  }
  override getSolverName(): string { return "Pipeline9NetworkedHighDensitySolver" }
  override getConstructorParams(): [RoutingProblem, NetworkRoutingOptions] { return [this.problem, this.options] }
  private syncStats(): void {
    for (const [key, value] of Object.entries((this.boardClient ?? this.client).stats)) this.stats[`remote${key[0]!.toUpperCase()}${key.slice(1)}`] = value
  }
  private reason(reason: string): void { this.stats.remoteFallbackReasonCounts[reason] = (this.stats.remoteFallbackReasonCounts[reason] ?? 0) + 1 }
  async waitForAllRemoteRequests(): Promise<void> {
    await this.dispatchPromise; await this.remotePromise
    await Promise.all([this.client.waitForAllRequests(), this.boardClient?.waitForAllRequests()])
    this.syncStats()
  }
  private beginLocal(): void { this.local = new RoutingSolver(this.problem); this.activeSubSolver = this.local }
  private launch(): void {
    this.launched = true
    const wait = this.startRemote().then(result => {
      this.settled = result
      this.pendingEffects?.splice(0)
    }).catch(error => {
      this.settled = { kind: "local-fallback", reason: "request_serialization_error", error: String(error) }
      this.pendingEffects?.splice(0)
    })
    this.dispatchPromise = wait
    this.pendingEffects = [{ name: "hd-cache2:board", promise: wait }]
  }
  private async startRemote(): Promise<NonNullable<NetworkRoutingSolver["settled"]>> {
    this.stats.remoteCapabilityRequests++
    const capabilities = await discoverNetworkCapabilities(this.client.serverUrl, this.client.autorouterVersion)
    this.stats.remoteBoardContractSupported = capabilities.board
    this.stats.remoteCapabilityReason = capabilities.reason
    let remote: Promise<HdCache2SolveResult | HdCache2SolveResult<Pipeline9NetworkedBoardOutput>>
    if (capabilities.board) {
      const input = await createBoardInput(this.problem)
      this.requestTimeoutMs = this.options.requestTimeoutMs ?? DEFAULT_PIPELINE9_NETWORKED_BOARD_TIMEOUT_MS
      this.boardClient = new HdCache2Client(this.client.autorouterVersion, this.client.serverUrl, {
        cacheVersion: this.client.cacheVersion, validateOutput: isValidBoardOutput,
        transportTimeoutMs: Math.max(310_000, this.requestTimeoutMs + 5_000),
      })
      this.stats.remoteContract = PIPELINE9_NETWORKED_BOARD_POLICY
      this.stats.remoteProblemHash = input.problemHash
      remote = this.boardClient.solveMany([input])[0]!
    } else {
      const input = projectBoardNode(this.problem)
      if (typeof input === "string") return { kind: "unsupported", reason: input }
      this.stats.remoteContract = PIPELINE9_NETWORKED_SOLVE_POLICY
      remote = this.client.solveMany([input])[0]!
    }
    this.stats.remoteRequestsStarted++
    this.remotePromise = remote.then(result => {
      this.stats.remoteRequestsCompleted++
      if (result.kind === "remote") {
        this.stats[result.response.source === "cache" ? "remoteCacheHits" : "remoteSolverResults"]++
        this.stats[result.response.status === "solved" ? "remoteSolvedResults" : "remoteFailedResults"]++
      }
      this.syncStats()
    })
    let timer!: ReturnType<typeof setTimeout>
    const timeout = new Promise<{ kind: "logical-timeout" }>(resolve => {
      timer = setTimeout(() => resolve({ kind: "logical-timeout" }), this.requestTimeoutMs)
    })
    try { return await Promise.race([remote, timeout]) }
    finally { clearTimeout(timer); this.syncStats() }
  }
  override _step(): void {
    if (!this.launched) this.launch()
    if (this.local) {
      this.local.step(); this.routes = this.local.routes; this.progress = this.local.progress
      this.stats.localRoutingStats = this.local.stats
      if (this.local.stats.terminalContradiction) this.stats.terminalContradiction = this.local.stats.terminalContradiction
      if (this.local.solved) this.solved = true
      if (this.local.failed) { this.failed = true; this.error = this.local.error }
      return
    }
    const result = this.settled
    if (!result) return
    this.settled = undefined
    if (result.kind === "unsupported") {
      this.stats.remoteUnsupportedInputs++; this.stats.remoteUnsupportedReason = result.reason
      this.beginLocal(); return
    }
    if (result.kind !== "remote") {
      this.stats.remoteTransportFallbacks++
      const reason = result.kind === "logical-timeout" ? "logical_timeout" : result.reason
      if (result.kind === "logical-timeout") this.stats.remoteLogicalTimeoutFallbacks++
      this.reason(reason); this.beginLocal(); return
    }
    if ("contract" in result.response) {
      this.stats.remoteBoardResults++
      if (result.response.status === "failed") {
        this.failed = true; this.error = result.response.error
        if (result.response.terminalContradiction) this.stats.terminalContradiction = result.response.terminalContradiction
      } else { this.routes = result.response.traces; this.solved = true; this.progress = 1 }
      return
    }
    if (result.response.solutionStage === "regional-fallback") { this.stats.remoteRegionalFallbackResults++; this.stats.remoteRegionalFallbackResultsApplied++ }
    else this.stats.remoteOrdinaryResults++
    if (result.response.status === "failed") { this.failed = true; this.error = result.response.error; return }
    this.routes = fromHighDensity(result.response.routes, this.problem)
    this.solved = true; this.progress = 1
  }
}
