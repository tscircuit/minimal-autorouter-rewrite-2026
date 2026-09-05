import type { RoutingProblem } from "../routing/types"
import type { SimplifiedPcbTrace } from "../types"
import { RoutingSolver } from "../routing/RoutingSolver"
import { findTerminalContradiction, type TerminalContradiction } from "../routing/findTerminalContradiction"
import { isValidBoardRoutes } from "./validateBoardRoutes"

/** This is an independently versioned extension, never sent to an unadvertised service. */
export const PIPELINE9_NETWORKED_BOARD_POLICY = "minimal_exact_board_v1" as const
export type Pipeline9NetworkedBoardInput = {
  solvePolicy: typeof PIPELINE9_NETWORKED_BOARD_POLICY
  problemHash: string
  problem: RoutingProblem
}
export type Pipeline9NetworkedBoardOutput = {
  contract: typeof PIPELINE9_NETWORKED_BOARD_POLICY
  problemHash: string
} & ({ status: "solved"; traces: SimplifiedPcbTrace[] } |
  { status: "failed"; error: string; terminalContradiction?: TerminalContradiction })

/** Canonical JSON retains every serializable field and rejects lossy numeric conversion. */
export function canonicalJson(value: unknown): string {
  const parents = new Set<object>()
  const visit = (item: unknown, array = false): string | undefined => {
    if (item === undefined) return array ? "null" : undefined
    if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item)
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("Nonfinite number in routing problem")
      return JSON.stringify(item)
    }
    if (typeof item !== "object" || parents.has(item)) throw new Error("Routing problem must be acyclic JSON")
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      throw new Error("Routing problem contains a non-JSON object")
    parents.add(item)
    const result = Array.isArray(item) ? `[${Array.from(item, entry => visit(entry, true)).join(",")}]`
      : `{${Object.keys(item).sort().flatMap(key => {
        const entry = visit((item as Record<string, unknown>)[key])
        return entry === undefined ? [] : [`${JSON.stringify(key)}:${entry}`]
      }).join(",")}}`
    parents.delete(item)
    return result
  }
  const result = visit(value)
  if (result === undefined) throw new Error("Missing routing input")
  return result
}
export async function routingDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}
export async function createBoardInput(problem: RoutingProblem): Promise<Pipeline9NetworkedBoardInput> {
  const snapshot = JSON.parse(canonicalJson(problem)) as RoutingProblem
  assertRoutingProblem(snapshot)
  return { solvePolicy: PIPELINE9_NETWORKED_BOARD_POLICY, problemHash: await routingDigest(snapshot), problem: snapshot }
}
export async function networkCacheKey(version: string, namespace: string | undefined, input: { solvePolicy: string }): Promise<string> {
  return `${version}:${input.solvePolicy}:${namespace ?? "default"}:${await routingDigest({ version, namespace: namespace ?? null, contract: input.solvePolicy, input })}`
}
const object = (value: unknown): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value)
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Invalid board contract: ${message}`) }
const point = (p: unknown) => object(p) && Number.isFinite(p.x) && Number.isFinite(p.y)
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string")

/** Validate the service boundary before allocating geometry or executing a solver. */
export function assertRoutingProblem(value: unknown): asserts value is RoutingProblem {
  requireValue(object(value) && object(value.srj), "missing problem/SRJ")
  const { srj } = value
  requireValue(Number.isInteger(srj.layerCount) && srj.layerCount >= 1 && srj.layerCount <= 64, "invalid layer count")
  const layers = Array.from({ length: srj.layerCount }, (_, i) => i === 0 ? "top" : i === srj.layerCount - 1 ? "bottom" : `inner${i}`)
  const layerList = (x: unknown) => strings(x) && x.length > 0 && x.every(layer => layers.includes(layer))
  const terminal = (x: unknown) => point(x) && object(x) && (typeof x.layer === "string" ? layers.includes(x.layer) : layerList(x.layers))
  requireValue(object(srj.bounds) && ["minX", "maxX", "minY", "maxY"].every(key => Number.isFinite(srj.bounds[key])) &&
    srj.bounds.minX < srj.bounds.maxX && srj.bounds.minY < srj.bounds.maxY, "invalid bounds")
  requireValue(Number.isFinite(srj.minTraceWidth) && srj.minTraceWidth > 0, "invalid minimum trace width")
  requireValue(Number.isFinite(value.viaDiameter) && value.viaDiameter > 0 && Number.isFinite(value.viaHoleDiameter) &&
    value.viaHoleDiameter > 0 && value.viaHoleDiameter < value.viaDiameter, "invalid via dimensions")
  requireValue(Number.isFinite(value.obstacleMargin) && value.obstacleMargin >= 0 && value.effort === 1, "invalid effort/clearance")
  for (const key of ["minTraceToPadEdgeClearance", "minViaEdgeToPadEdgeClearance", "minBoardEdgeClearance"])
    requireValue(srj[key] === undefined || Number.isFinite(srj[key]) && srj[key] >= 0, `invalid ${key}`)
  requireValue(Array.isArray(srj.obstacles) && srj.obstacles.every((o: unknown) => object(o) &&
    (o.type === "rect" || o.type === "oval") && point(o.center) && Number.isFinite(o.width) && o.width > 0 &&
    Number.isFinite(o.height) && o.height > 0 && strings(o.layers) && o.layers.every(layer => layers.includes(layer)) &&
    strings(o.connectedTo) && (o.ccwRotationDegrees === undefined || Number.isFinite(o.ccwRotationDegrees))), "invalid obstacles")
  requireValue(srj.outline === undefined || Array.isArray(srj.outline) && srj.outline.length >= 3 && srj.outline.every(point), "invalid outline")
  requireValue(Array.isArray(srj.connections) && srj.connections.every((c: unknown) => object(c) && typeof c.name === "string" &&
    Array.isArray(c.pointsToConnect) && c.pointsToConnect.every(terminal)), "invalid connections")
  requireValue(Array.isArray(value.tasks) && value.tasks.every((task: unknown) => object(task) && typeof task.id === "string" &&
    typeof task.connectionName === "string" && typeof task.netName === "string" && strings(task.connectedNames) &&
    terminal(task.start) && terminal(task.end) && Number.isFinite(task.traceWidth) && task.traceWidth > 0 &&
    (task.allowedLayers === undefined || layerList(task.allowedLayers))), "invalid routing tasks")
  requireValue(new Set(value.tasks.map((task: any) => task.id)).size === value.tasks.length, "duplicate task IDs")
  requireValue(Array.isArray(value.fixedTraces) && value.fixedTraces.every((trace: unknown) => object(trace) && trace.type === "pcb_trace" &&
    typeof trace.pcb_trace_id === "string" && typeof trace.connection_name === "string" && Array.isArray(trace.route) && trace.route.every((entry: unknown) => {
      if (!object(entry)) return false
      if (entry.route_type === "wire") return point(entry) && layers.includes(entry.layer) && Number.isFinite(entry.width) && entry.width > 0
      if (entry.route_type === "via") return point(entry) && layers.includes(entry.from_layer) && layers.includes(entry.to_layer)
      if (entry.route_type === "jumper") return point(entry.start) && point(entry.end) && layers.includes(entry.layer)
      if (entry.route_type === "through_obstacle") return point(entry.start) && point(entry.end) && layers.includes(entry.from_layer) && layers.includes(entry.to_layer)
      return false
    })), "invalid fixed copper")
}
export async function validateBoardInput(value: unknown): Promise<Pipeline9NetworkedBoardInput> {
  requireValue(object(value) && value.solvePolicy === PIPELINE9_NETWORKED_BOARD_POLICY && typeof value.problemHash === "string", "invalid discriminator")
  assertRoutingProblem(value.problem)
  requireValue(await routingDigest(value.problem) === value.problemHash, "problem digest mismatch")
  return value as Pipeline9NetworkedBoardInput
}
export function solvePipeline9NetworkedBoard(input: Pipeline9NetworkedBoardInput): Pipeline9NetworkedBoardOutput {
  const solver = new RoutingSolver(input.problem)
  solver.solve()
  const envelope = { contract: PIPELINE9_NETWORKED_BOARD_POLICY, problemHash: input.problemHash }
  if (solver.solved) return { ...envelope, status: "solved", traces: solver.routes }
  const certificate = solver.stats.terminalContradiction as TerminalContradiction | undefined
  return { ...envelope, status: "failed", error: solver.error ?? "Board routing failed", ...(certificate ? { terminalContradiction: certificate } : {}) }
}
export function isValidBoardOutput(value: unknown, input: Pipeline9NetworkedBoardInput): value is Pipeline9NetworkedBoardOutput {
  if (!object(value) || value.contract !== PIPELINE9_NETWORKED_BOARD_POLICY || value.problemHash !== input.problemHash) return false
  if (value.status === "solved") return !value.terminalContradiction && isValidBoardRoutes(value.traces, input.problem)
  if (value.status !== "failed" || typeof value.error !== "string" || !value.error) return false
  if (value.terminalContradiction !== undefined) {
    const verified = findTerminalContradiction(input.problem)
    return !!verified && canonicalJson(verified) === canonicalJson(value.terminalContradiction)
  }
  return true
}
