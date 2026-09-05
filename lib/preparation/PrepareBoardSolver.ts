import {BaseSolver} from "../solvers/BaseSolver"
import type {ConnectionPoint, Point, SimpleRouteConnection, SimpleRouteJson, SimplifiedPcbTrace} from "../types"
import type {RoutingProblem, RoutingTask} from "../routing/types"
import {ConnectivityIndex} from "./ConnectivityIndex"

export function getBoardLayers(layerCount: number): string[] {
  if (!Number.isInteger(layerCount) || layerCount < 1) throw new Error("layerCount must be a positive integer")
  return layerCount === 1 ? ["top"] : ["top", ...Array.from({length: layerCount - 2}, (_, i) => `inner${i + 1}`), "bottom"]
}

export function getPointLayers(point: ConnectionPoint): string[] {
  return "layers" in point ? point.layers : [point.layer]
}

function aliases(connection: SimpleRouteConnection): string[] {
  return [connection.name, connection.rootConnectionName, connection.netConnectionName,
    connection.__netConnectionName, ...(connection.mergedConnectionNames ?? []),
    ...(connection.__rootConnectionNames ?? []),
    ...connection.pointsToConnect.flatMap((point) => [point.pointId, point.pcb_port_id])]
    .filter((id): id is string => typeof id === "string" && id.length > 0)
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x, dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy)
}

/** Physical copper coverage, used only to skip pairs that already conduct. */
function traceTouchesPoint(trace: SimplifiedPcbTrace, point: ConnectionPoint): boolean {
  const layers = getPointLayers(point)
  for (let i = 0; i < trace.route.length; i++) {
    const segment = trace.route[i]!
    if (segment.route_type === "via" &&
      (layers.includes(segment.from_layer) || layers.includes(segment.to_layer)) &&
      Math.hypot(point.x - segment.x, point.y - segment.y) < 1e-6) return true
    if (segment.route_type !== "wire" || !layers.includes(segment.layer)) continue
    if (Math.hypot(point.x - segment.x, point.y - segment.y) < 1e-6) return true
    const next = trace.route[i + 1]
    if (next?.route_type === "wire" && next.layer === segment.layer &&
      distanceToSegment(point, segment, next) < 1e-6) return true
  }
  return false
}

export class PrepareBoardSolver extends BaseSolver {
  readonly connMap = new ConnectivityIndex()
  readonly tasks: RoutingTask[] = []
  readonly srj: SimpleRouteJson
  private connectionIndex = 0
  private netAliases = new Map<string, string[]>()

  constructor(input: SimpleRouteJson, readonly parameters: {
    effort: number; viaDiameter: number; viaHoleDiameter: number
  }) {
    super()
    const layers = getBoardLayers(input.layerCount)
    this.srj = structuredClone(input)
    const {bounds, minTraceWidth} = this.srj
    if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, minTraceWidth].every(Number.isFinite) ||
      bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY || minTraceWidth <= 0) {
      throw new Error("Board bounds and trace width must be finite and positive")
    }
    for (const obstacle of this.srj.obstacles) {
      obstacle.layers = obstacle.layers.filter((layer) => layers.includes(layer))
      obstacle.__zLayers = obstacle.layers.map((layer) => layers.indexOf(layer))
      this.connMap.addConnections([[...(obstacle.obstacleId ? [obstacle.obstacleId] : []),
        ...obstacle.connectedTo, ...(obstacle.offBoardConnectsTo ?? [])]])
    }
    for (const connection of this.srj.connections) {
      this.connMap.addConnections([aliases(connection)])
      for (const point of connection.pointsToConnect) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          getPointLayers(point).length === 0 || getPointLayers(point).some((layer) => !layers.includes(layer))) {
          throw new Error(`Invalid terminal for connection ${connection.name}`)
        }
      }
    }
    for (const trace of this.srj.traces ?? []) {
      this.connMap.addConnections([[trace.pcb_trace_id, trace.connection_name, ...(trace.connectsTo ?? [])]])
    }
    for (const [net, names] of Object.entries(this.connMap.toObject())) this.netAliases.set(net, names)
    this.MAX_ITERATIONS = this.srj.connections.length + 2
  }

  override getConstructorParams(): unknown[] { return [this.srj, this.parameters] }
  getOutputSimpleRouteJson(): SimpleRouteJson { return this.srj }
  getNewSimpleRouteJson(): SimpleRouteJson { return this.srj }

  override _step(): void {
    const connection = this.srj.connections[this.connectionIndex++]
    if (!connection) { this.solved = true; return }
    this.addConnectionTasks(connection)
    this.progress = this.connectionIndex / Math.max(1, this.srj.connections.length)
  }

  private addConnectionTasks(connection: SimpleRouteConnection): void {
    const points = connection.pointsToConnect
    if (points.length < 2 || connection.isOffBoard) return
    const parent = points.map((_, i) => i)
    const find = (index: number): number => {
      while (parent[index] !== index) { parent[index] = parent[parent[index]!]!; index = parent[index]! }
      return index
    }
    const join = (a: number, b: number): void => { parent[find(b)] = find(a) }
    const netName = this.connMap.getNetConnectedToId(connection.name)
    const connectedNames = this.netAliases.get(netName) ?? [connection.name]
    const fixed = (this.srj.traces ?? []).filter((trace) => this.connMap.areIdsConnected(trace.connection_name, connection.name))
    for (const trace of fixed) {
      const terminals = points.flatMap((point, index) => traceTouchesPoint(trace, point) ? [index] : [])
      for (const index of terminals.slice(1)) join(terminals[0]!, index)
    }
    for (const obstacle of this.srj.obstacles) {
      if (!obstacle.offBoardConnectsTo?.length) continue
      const ids = new Set(obstacle.connectedTo)
      const terminals = points.flatMap((point, index) =>
        (point.pointId && ids.has(point.pointId)) || (point.pcb_port_id && ids.has(point.pcb_port_id)) ? [index] : [])
      for (const index of terminals.slice(1)) join(terminals[0]!, index)
    }
    const edges: {a: number; b: number; distance: number}[] = []
    for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
      const start = points[a]!, end = points[b]!
      const distance = Math.hypot(start.x - end.x, start.y - end.y)
      if (distance < 1e-8 && getPointLayers(start).some((layer) => getPointLayers(end).includes(layer))) join(a, b)
      else edges.push({a, b, distance})
    }
    edges.sort((a, b) => a.distance - b.distance || a.a - b.a || a.b - b.b)
    const bus = this.srj.buses?.find((candidate) => candidate.connectionNames.includes(connection.name))
    let pair = 0
    for (const edge of edges) {
      if (find(edge.a) === find(edge.b)) continue
      join(edge.a, edge.b)
      this.tasks.push({
        id: `${connection.name}__pair${pair++}`,
        connectionName: connection.name, netName, connectedNames,
        start: points[edge.a]!, end: points[edge.b]!,
        traceWidth: connection.nominalTraceWidth ?? bus?.traceWidth ?? this.srj.nominalTraceWidth ?? this.srj.minTraceWidth,
        allowedLayers: bus?.allowedLayers,
      })
    }
  }

  getProblem(): RoutingProblem {
    if (!this.solved) throw new Error("Board preparation has not completed")
    return {srj: this.srj, tasks: this.tasks, fixedTraces: this.srj.traces ?? [],
      ...this.parameters, obstacleMargin: this.srj.defaultObstacleMargin ?? 0.15}
  }
}
