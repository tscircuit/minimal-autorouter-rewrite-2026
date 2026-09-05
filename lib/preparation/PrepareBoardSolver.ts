import {BaseSolver} from "../solvers/BaseSolver"
import type {ConnectionPoint, Point, SimpleRouteConnection, SimpleRouteJson, SimplifiedPcbTrace} from "../types"
import type {RoutingProblem, RoutingTask} from "../routing/types"
import {ConnectivityIndex, createConnectivityIndex} from "./ConnectivityIndex"

export function getBoardLayers(layerCount: number): string[] {
  if (!Number.isInteger(layerCount) || layerCount < 1) throw new Error("layerCount must be a positive integer")
  return layerCount === 1 ? ["top"] : ["top", ...Array.from({length: layerCount - 2}, (_, i) => `inner${i + 1}`), "bottom"]
}

export function getPointLayers(point: ConnectionPoint): string[] {
  return "layers" in point ? point.layers : [point.layer]
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
  readonly connMap: ConnectivityIndex
  readonly tasks: RoutingTask[] = []
  readonly srj: SimpleRouteJson
  private connectionIndex = 0
  private netAliases = new Map<string, string[]>()
  private connectionsToPrepare: SimpleRouteConnection[] = []
  private originalTerminals = new WeakSet<ConnectionPoint>()
  private constraintsByNet = new Map<string, {traceWidth: number; allowedLayers?: string[]}>()

  constructor(input: SimpleRouteJson, readonly parameters: {
    effort: number; viaDiameter: number; viaHoleDiameter: number
  }) {
    super()
    const layers = getBoardLayers(input.layerCount)
    this.srj = structuredClone(input)
    this.connMap = createConnectivityIndex(this.srj)
    const {bounds, minTraceWidth} = this.srj
    if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, minTraceWidth].every(Number.isFinite) ||
      bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY || minTraceWidth <= 0) {
      throw new Error("Board bounds and trace width must be finite and positive")
    }
    for (const obstacle of this.srj.obstacles) {
      obstacle.layers = obstacle.layers.filter((layer) => layers.includes(layer))
      obstacle.__zLayers = obstacle.layers.map((layer) => layers.indexOf(layer))
    }
    for (const connection of this.srj.connections) {
      for (const point of connection.pointsToConnect) {
        this.originalTerminals.add(point)
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          getPointLayers(point).length === 0 || getPointLayers(point).some((layer) => !layers.includes(layer))) {
          throw new Error(`Invalid terminal for connection ${connection.name}`)
        }
      }
    }
    for (const [net, names] of Object.entries(this.connMap.toObject())) this.netAliases.set(net, names)
    const netGroups = new Map<string, SimpleRouteConnection[]>()
    for (const connection of this.srj.connections) {
      const net = this.connMap.getNetConnectedToId(connection.name)
      const group = netGroups.get(net) ?? []
      group.push(connection)
      netGroups.set(net, group)
    }
    for (const [net, group] of netGroups) {
      const routedConnections = group.filter((connection) => !connection.isOffBoard)
      if (routedConnections.length === 0) continue
      const constraints = this.resolveNetConstraints(routedConnections, layers)
      if (!constraints) return
      this.constraintsByNet.set(net, constraints)
      const points = routedConnections.flatMap((connection) => connection.pointsToConnect)
      // Every connected piece of existing copper must participate in the tree,
      // even when none of the original terminal records lands on that piece.
      for (const trace of this.srj.traces ?? []) {
        if (this.connMap.getNetConnectedToId(trace.connection_name) !== net) continue
        for (const segment of trace.route) if (segment.route_type === "wire") {
          points.push({x: segment.x, y: segment.y, layer: segment.layer})
        }
      }
      const unique = new Map<string, ConnectionPoint>()
      for (const point of points) {
        const key = `${point.x},${point.y},${[...getPointLayers(point)].sort().join(",")}`
        // Prefer a real terminal's identity to an otherwise identical copper vertex.
        if (!unique.has(key)) unique.set(key, point)
      }
      this.connectionsToPrepare.push({...routedConnections[0]!,
        mergedConnectionNames: routedConnections.map((connection) => connection.name),
        pointsToConnect: [...unique.values()]})
    }
    this.MAX_ITERATIONS = this.connectionsToPrepare.length + 2
  }

  private resolveNetConstraints(connections: SimpleRouteConnection[], layers: string[]): {traceWidth: number; allowedLayers?: string[]} | undefined {
    const applicableBuses = new Set<NonNullable<SimpleRouteJson["buses"]>[number]>()
    const widths: number[] = []
    for (const connection of connections) {
      const names = new Set([connection.name, connection.rootConnectionName, connection.netConnectionName,
        connection.__netConnectionName, ...(connection.mergedConnectionNames ?? []), ...(connection.__rootConnectionNames ?? [])]
        .filter((name): name is string => typeof name === "string"))
      const buses = (this.srj.buses ?? []).filter(bus => bus.connectionNames.some(name => names.has(name)))
      for (const bus of buses) applicableBuses.add(bus)
      const busWidths = buses.flatMap(bus => bus.traceWidth === undefined ? [] : [bus.traceWidth])
      const width = connection.nominalTraceWidth ?? (busWidths.length ? Math.max(...busWidths) : undefined)
        ?? this.srj.nominalTraceWidth ?? this.srj.minTraceWidth
      if (!Number.isFinite(width) || width <= 0) {
        this.failed = true
        this.error = `Connection ${connection.name} resolves to an invalid trace width: ${width}; expected a positive finite width`
        return undefined
      }
      widths.push(width)
    }
    const restricted = [...applicableBuses].filter(bus => bus.allowedLayers !== undefined)
    const allowedLayers = restricted.length ? layers.filter(layer => restricted.every(bus => bus.allowedLayers!.includes(layer))) : undefined
    const groupName = connections.map(connection => connection.name).join(", ")
    if (allowedLayers?.length === 0) {
      this.failed = true
      this.error = `Merged net (${groupName}) has incompatible bus layer restrictions: no common routing layer`
      return undefined
    }
    if (allowedLayers) for (const connection of connections) for (const point of connection.pointsToConnect) {
      if (getPointLayers(point).some(layer => allowedLayers.includes(layer))) continue
      this.failed = true
      this.error = `Merged net (${groupName}) cannot reach terminal ${point.pcb_port_id ?? point.pointId ?? `(${point.x}, ${point.y})`} on allowed layers ${allowedLayers.join(", ")}`
      return undefined
    }
    // A merged physical tree obeys every member's constraints. Using its widest
    // resolved conductor and common permitted layers is deliberately conservative.
    return {traceWidth: Math.max(...widths), allowedLayers}
  }

  override getConstructorParams(): unknown[] { return [this.srj, this.parameters] }
  getOutputSimpleRouteJson(): SimpleRouteJson { return this.srj }
  getNewSimpleRouteJson(): SimpleRouteJson { return this.srj }

  override _step(): void {
    const connection = this.connectionsToPrepare[this.connectionIndex++]
    if (!connection) { this.solved = true; return }
    this.addConnectionTasks(connection)
    this.progress = this.connectionIndex / Math.max(1, this.connectionsToPrepare.length)
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
      if (!obstacle.connectedTo.some((name) => connectedNames.includes(name))) continue
      const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const cos = Math.cos(angle), sin = Math.sin(angle)
      const terminals = points.flatMap((point, index) => {
        if (!getPointLayers(point).some((layer) => obstacle.layers.includes(layer))) return []
        const dx = point.x - obstacle.center.x, dy = point.y - obstacle.center.y
        const x = Math.abs(dx * cos + dy * sin), y = Math.abs(-dx * sin + dy * cos)
        const inside = obstacle.type === "oval"
          ? (x / (obstacle.width / 2)) ** 2 + (y / (obstacle.height / 2)) ** 2 <= 1 + 1e-8
          : x <= obstacle.width / 2 + 1e-8 && y <= obstacle.height / 2 + 1e-8
        return inside ? [index] : []
      })
      for (const index of terminals.slice(1)) {
        const first = points[terminals[0]!]!, other = points[index]!
        const samePort = first.pcb_port_id !== undefined && first.pcb_port_id === other.pcb_port_id
        // Keep an explicit wire attachment for distinct requested ports even
        // when their pads overlap; fixed copper may attach through a pad.
        if (!this.originalTerminals.has(first) || !this.originalTerminals.has(other) || samePort) join(terminals[0]!, index)
      }
    }
    // Obstacle offBoardConnectsTo values are propagated net aliases in SRJ.
    // Only an explicit off-board connection proves an existing external path.
    for (const external of this.srj.connections) {
      if (!external.isOffBoard || !this.connMap.areIdsConnected(connection.name, external.name)) continue
      const terminals = points.flatMap((point, index) => external.pointsToConnect.some((other) =>
        Math.hypot(point.x - other.x, point.y - other.y) < 1e-8 &&
        getPointLayers(point).some((layer) => getPointLayers(other).includes(layer))) ? [index] : [])
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
    const constraints = this.constraintsByNet.get(netName)!
    let pair = 0
    for (const edge of edges) {
      if (find(edge.a) === find(edge.b)) continue
      join(edge.a, edge.b)
      this.tasks.push({
        id: `${connection.name}__pair${pair++}`,
        connectionName: connection.name, netName, connectedNames,
        start: points[edge.a]!, end: points[edge.b]!,
        traceWidth: constraints.traceWidth,
        allowedLayers: constraints.allowedLayers,
      })
    }
  }

  getProblem(): RoutingProblem {
    if (!this.solved) throw new Error("Board preparation has not completed")
    return {srj: this.srj, tasks: this.tasks, fixedTraces: this.srj.traces ?? [],
      ...this.parameters, obstacleMargin: this.srj.defaultObstacleMargin ?? Math.min(0.15, Math.max(0.1, this.srj.minTraceWidth))}
  }
}
