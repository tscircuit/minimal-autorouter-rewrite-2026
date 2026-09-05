import type {
  ConnectionPoint,
  Point,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../lib/types/srj-types"

const EPSILON = 1e-6
function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message)
}

class Groups {
  private parents = new Map<string, string>()
  find(id: string): string {
    const parent = this.parents.get(id)
    if (parent === undefined) {
      this.parents.set(id, id)
      return id
    }
    if (parent === id) return id
    const root = this.find(parent)
    this.parents.set(id, root)
    return root
  }
  join(a: string, b: string): void {
    this.parents.set(this.find(b), this.find(a))
  }
  joinAll(ids: string[]): void {
    for (const id of ids.slice(1)) this.join(ids[0]!, id)
  }
}

type Capsule = {
  kind: "capsule"
  a: Point
  b: Point
  radius: number
  layers: string[]
}
type Box = {
  kind: "box"
  center: Point
  width: number
  height: number
  angle: number
  layers: string[]
}
type Copper = Capsule | Box
type NetGeometry = {
  copper: Copper[]
  terminals: Array<{ point: ConnectionPoint; connection: string }>
}

function layerNames(count: number): string[] {
  return Array.from({ length: count }, (_, z) =>
    z === 0 ? "top" : z === count - 1 ? "bottom" : `inner${z}`,
  )
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared
    ? Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
        ),
      )
    : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  if (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  )
    return 0
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}

function localPoint(point: Point, box: Box): Point {
  const dx = point.x - box.center.x
  const dy = point.y - box.center.y
  return {
    x: dx * Math.cos(box.angle) + dy * Math.sin(box.angle),
    y: -dx * Math.sin(box.angle) + dy * Math.cos(box.angle),
  }
}

function inBox(point: Point, box: Box): boolean {
  const p = localPoint(point, box)
  return (
    Math.abs(p.x) <= box.width / 2 + EPSILON &&
    Math.abs(p.y) <= box.height / 2 + EPSILON
  )
}

function boxCorners(box: Box): Point[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => ({
    x:
      box.center.x +
      ((x! * box.width) / 2) * Math.cos(box.angle) -
      ((y! * box.height) / 2) * Math.sin(box.angle),
    y:
      box.center.y +
      ((x! * box.width) / 2) * Math.sin(box.angle) +
      ((y! * box.height) / 2) * Math.cos(box.angle),
  }))
}

function capsuleTouchesBox(capsule: Capsule, box: Box): boolean {
  if (inBox(capsule.a, box) || inBox(capsule.b, box)) return true
  const corners = boxCorners(box)
  return corners.some(
    (corner, index) =>
      segmentDistance(
        capsule.a,
        capsule.b,
        corner,
        corners[(index + 1) % 4]!,
      ) <=
      capsule.radius + EPSILON,
  )
}

function touches(a: Copper, b: Copper): boolean {
  if (!a.layers.some((layer) => b.layers.includes(layer))) return false
  if (a.kind === "capsule" && b.kind === "capsule")
    return segmentDistance(a.a, a.b, b.a, b.b) <= a.radius + b.radius + EPSILON
  if (a.kind === "capsule" && b.kind === "box") return capsuleTouchesBox(a, b)
  if (a.kind === "box" && b.kind === "capsule") return capsuleTouchesBox(b, a)
  if (a.kind === "box" && b.kind === "box") {
    const aCorners = boxCorners(a)
    const bCorners = boxCorners(b)
    if (
      aCorners.some((point) => inBox(point, b)) ||
      bCorners.some((point) => inBox(point, a))
    )
      return true
    return aCorners.some((point, index) =>
      capsuleTouchesBox(
        {
          kind: "capsule",
          a: point,
          b: aCorners[(index + 1) % 4]!,
          radius: 0,
          layers: a.layers,
        },
        b,
      ),
    )
  }
  return false
}

function appendTrace(
  copper: Copper[],
  trace: SimplifiedPcbTrace,
  layers: string[],
  srj: SimpleRouteJson,
): void {
  let previous: { point: Point; layer: string; width: number } | undefined
  const wire = (a: Point, b: Point, layer: string, width: number) => {
    copper.push({ kind: "capsule", a, b, radius: width / 2, layers: [layer] })
  }
  for (const entry of trace.route) {
    if (entry.route_type === "wire") {
      wire(entry, entry, entry.layer, entry.width)
      if (previous?.layer === entry.layer)
        wire(previous.point, entry, entry.layer, entry.width)
      previous = { point: entry, layer: entry.layer, width: entry.width }
    } else if (entry.route_type === "via") {
      if (previous?.layer === entry.from_layer)
        wire(previous.point, entry, entry.from_layer, previous.width)
      const first = layers.indexOf(entry.from_layer)
      const last = layers.indexOf(entry.to_layer)
      const diameter =
        entry.via_diameter ??
        srj.min_via_pad_diameter ??
        srj.minViaPadDiameter ??
        srj.minViaDiameter ??
        0.3
      copper.push({
        kind: "capsule",
        a: entry,
        b: entry,
        radius: diameter / 2,
        layers: layers.slice(Math.min(first, last), Math.max(first, last) + 1),
      })
      previous = {
        point: entry,
        layer: entry.to_layer,
        width: previous?.width ?? srj.minTraceWidth,
      }
    } else if (entry.route_type === "through_obstacle") {
      throw new Error(
        `${trace.pcb_trace_id}: unsupported through_obstacle route; physical pad conductors cannot be inferred from a route annotation`,
      )
    } else {
      const startLayer = entry.layer
      const endLayer = entry.layer
      const width = srj.minTraceWidth
      if (previous?.layer === startLayer)
        wire(previous.point, entry.start, startLayer, previous.width)
      copper.push({
        kind: "capsule",
        a: entry.start,
        b: entry.end,
        radius: width / 2,
        layers: [startLayer, endLayer],
      })
      previous = { point: entry.end, layer: endLayer, width }
    }
  }
}

function checkTraceShape(trace: SimplifiedPcbTrace, layers: string[]): void {
  requireCondition(trace.type === "pcb_trace", "Output has a non-trace entry")
  requireCondition(
    typeof trace.pcb_trace_id === "string" && trace.pcb_trace_id.length > 0,
    "Trace ID is missing",
  )
  requireCondition(
    typeof trace.connection_name === "string" &&
      trace.connection_name.length > 0,
    `${trace.pcb_trace_id}: missing connection name`,
  )
  requireCondition(
    trace.route.length >= 2,
    `${trace.pcb_trace_id}: route has fewer than two entries`,
  )
  const point = (p: Point) =>
    requireCondition(
      Number.isFinite(p.x) && Number.isFinite(p.y),
      `${trace.pcb_trace_id}: nonfinite coordinate`,
    )
  const layer = (name: string) =>
    requireCondition(
      layers.includes(name),
      `${trace.pcb_trace_id}: invalid layer ${name}`,
    )
  const width = (value: number) =>
    requireCondition(
      Number.isFinite(value) && value > 0,
      `${trace.pcb_trace_id}: invalid copper width`,
    )
  for (const entry of trace.route) {
    if (entry.route_type === "wire") {
      point(entry)
      layer(entry.layer)
      width(entry.width)
    } else if (entry.route_type === "via") {
      point(entry)
      layer(entry.from_layer)
      layer(entry.to_layer)
      requireCondition(
        entry.from_layer !== entry.to_layer,
        `${trace.pcb_trace_id}: via does not change layers`,
      )
      if (entry.via_diameter !== undefined) width(entry.via_diameter)
      if (entry.via_hole_diameter !== undefined) {
        width(entry.via_hole_diameter)
        if (entry.via_diameter !== undefined)
          requireCondition(
            entry.via_hole_diameter < entry.via_diameter,
            `${trace.pcb_trace_id}: via hole is not smaller than its pad`,
          )
      }
    } else if (entry.route_type === "through_obstacle") {
      throw new Error(
        `${trace.pcb_trace_id}: unsupported through_obstacle route; physical pad conductors cannot be inferred from a route annotation`,
      )
    } else if (entry.route_type === "jumper") {
      point(entry.start)
      point(entry.end)
      layer(entry.layer)
    } else throw new Error(`${trace.pcb_trace_id}: unknown route entry`)
  }
}

/** Independent geometric continuity check. Copper labels alone never connect terminals. */
export function assertOutputConnectivity(
  source: SimpleRouteJson,
  output: SimpleRouteJson,
  options: { allowUnrequestedTraces?: boolean } = {},
): void {
  const layers = layerNames(source.layerCount)
  const aliases = new Groups()
  for (const connection of source.connections) {
    requireCondition(
      connection.isOffBoard === undefined ||
        typeof connection.isOffBoard === "boolean",
      "Invalid connection.isOffBoard; expected a boolean",
    )
    aliases.joinAll(
      [
        connection.name,
        connection.rootConnectionName,
        connection.netConnectionName,
        connection.__netConnectionName,
        ...(connection.mergedConnectionNames ?? []),
        ...(connection.__rootConnectionNames ?? []),
        ...connection.pointsToConnect.flatMap((point) => [
          point.pcb_port_id,
          point.pointId,
        ]),
      ].filter((id): id is string => Boolean(id)),
    )
  }
  for (const obstacle of source.obstacles) aliases.joinAll(obstacle.connectedTo)
  const nets = new Map<string, NetGeometry>()
  const geometry = (name: string) => {
    const key = aliases.find(name)
    let net = nets.get(key)
    if (!net) {
      net = { copper: [], terminals: [] }
      nets.set(key, net)
    }
    return net
  }
  for (const connection of source.connections) {
    if (connection.isOffBoard || connection.pointsToConnect.length < 2) continue
    const net = geometry(connection.name)
    for (const point of connection.pointsToConnect)
      net.terminals.push({ point, connection: connection.name })
  }
  for (const obstacle of source.obstacles) {
    const netName = obstacle.connectedTo[0]
    if (!netName) continue
    const net = nets.get(aliases.find(netName))
    if (!net) continue
    const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const obstacleLayers = obstacle.layers.filter((layer) =>
      layers.includes(layer),
    )
    if (obstacle.type === "oval") {
      const radius = Math.min(obstacle.width, obstacle.height) / 2
      const dx = Math.max(0, obstacle.width / 2 - radius),
        dy = Math.max(0, obstacle.height / 2 - radius)
      const offset = {
        x: dx * Math.cos(angle) - dy * Math.sin(angle),
        y: dx * Math.sin(angle) + dy * Math.cos(angle),
      }
      net.copper.push({
        kind: "capsule",
        radius,
        layers: obstacleLayers,
        a: { x: obstacle.center.x - offset.x, y: obstacle.center.y - offset.y },
        b: { x: obstacle.center.x + offset.x, y: obstacle.center.y + offset.y },
      })
    } else
      net.copper.push({
        kind: "box",
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        angle,
        layers: obstacleLayers,
      })
  }
  const traces = output.traces ?? []
  const traceIds = new Set<string>()
  for (const trace of traces) {
    checkTraceShape(trace, layers)
    requireCondition(
      !traceIds.has(trace.pcb_trace_id),
      `Duplicate trace ID: ${trace.pcb_trace_id}`,
    )
    traceIds.add(trace.pcb_trace_id)
    let net = nets.get(aliases.find(trace.connection_name))
    if (!net)
      for (const alias of trace.connectsTo ?? []) {
        net = nets.get(aliases.find(alias))
        if (net) break
      }
    if (!net && options.allowUnrequestedTraces) continue
    requireCondition(
      net,
      `${trace.pcb_trace_id}: trace cannot be assigned to a requested net`,
    )
    appendTrace(net.copper, trace, layers, source)
  }
  const disconnected: string[] = []
  for (const net of nets.values()) {
    const groups = new Groups()
    for (let a = 0; a < net.copper.length; a++) {
      for (let b = a + 1; b < net.copper.length; b++) {
        if (touches(net.copper[a]!, net.copper[b]!))
          groups.join(String(a), String(b))
      }
    }
    // A multi-layer terminal is electrically one terminal on all its eligible layers.
    for (let i = 0; i < net.terminals.length; i++) {
      const { point } = net.terminals[i]!
      const terminal: Capsule = {
        kind: "capsule",
        a: point,
        b: point,
        radius: 0,
        layers: "layer" in point ? [point.layer] : point.layers,
      }
      for (let j = 0; j < net.copper.length; j++)
        if (touches(terminal, net.copper[j]!))
          groups.join(`terminal:${i}`, String(j))
    }
    const root = groups.find("terminal:0")
    for (let i = 1; i < net.terminals.length; i++)
      if (groups.find(`terminal:${i}`) !== root) {
        const { point, connection } = net.terminals[i]!
        disconnected.push(
          `${connection}/${point.pcb_port_id ?? point.pointId ?? `${point.x},${point.y}`}`,
        )
      }
  }
  requireCondition(
    disconnected.length === 0,
    `${disconnected.length} terminals lack continuous same-net copper to their peers: ${disconnected.slice(0, 12).join(", ")}`,
  )
}

/** Validate a supplied routed SRJ against the terminal requirements it retains. */
export function assertPhysicalConnectivity(srj: SimpleRouteJson): void {
  assertOutputConnectivity(srj, srj, { allowUnrequestedTraces: true })
}

// Geometry is independent of the router and shared by validation tools/tests only.
export {
  Groups,
  layerNames,
  checkTraceShape,
  appendTrace,
  touches,
  requireCondition,
}
export type { Copper, Capsule, Box }
