import { CopperMap } from "../routing/CopperMap"
import { pointSegmentDistanceSquared, segmentDistanceSquared, segmentRectDistanceSquared } from "../routing/geometry"
import type { RoutingProblem, RoutingTask } from "../routing/types"
import type { Obstacle, Point, SimplifiedPcbTrace } from "../types"
import { getBoardLayers, getPointLayers } from "../preparation/PrepareBoardSolver"

type Segment = { a: Point; b: Point; radius: number; layers: string[] }
type Conductor = { net: string; segments: Segment[]; pad?: Obstacle }
const validPoint = (p: unknown): p is Point => !!p && typeof p === "object" && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y)
const EPS = 1e-7
const names = (task: RoutingTask) => [task.connectionName, task.netName, ...task.connectedNames]
function local(p: Point, pad: Obstacle): Point {
  const angle = -(pad.ccwRotationDegrees ?? 0) * Math.PI / 180, x = p.x - pad.center.x, y = p.y - pad.center.y
  return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) }
}
function segmentTouchesPad(segment: Segment, pad: Obstacle): boolean {
  if (!segment.layers.some(layer => pad.layers.includes(layer))) return false
  const a = local(segment.a, pad), b = local(segment.b, pad)
  if (pad.type === "rect") return segmentRectDistanceSquared(a, b, pad.width / 2, pad.height / 2) <= (segment.radius + EPS) ** 2
  // An ellipse lies inside either supported interpretation of an oval pad. A
  // centerline intersecting it proves contact without treating empty corners as copper.
  const scaled = (p: Point) => ({ x: p.x / (pad.width / 2), y: p.y / (pad.height / 2) })
  return pointSegmentDistanceSquared({ x: 0, y: 0 }, scaled(a), scaled(b)) <= 1 + EPS
}
function padBoundary(pad: Obstacle): Segment[] {
  const angle = (pad.ccwRotationDegrees ?? 0) * Math.PI / 180
  const coordinates = pad.type === "rect" ? [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    : Array.from({ length: 64 }, (_, i) => [Math.cos(i * Math.PI / 32), Math.sin(i * Math.PI / 32)])
  const points = coordinates.map(([x, y]) => ({ x: pad.center.x + x! * pad.width / 2 * Math.cos(angle) - y! * pad.height / 2 * Math.sin(angle),
    y: pad.center.y + x! * pad.width / 2 * Math.sin(angle) + y! * pad.height / 2 * Math.cos(angle) }))
  return points.map((a, i) => ({ a, b: points[(i + 1) % points.length]!, radius: 0, layers: pad.layers }))
}
function touches(a: Conductor, b: Conductor): boolean {
  if (a.net !== b.net) return false
  if (a.pad && b.pad) return padBoundary(a.pad).some(s => segmentTouchesPad(s, b.pad!)) || padBoundary(b.pad).some(s => segmentTouchesPad(s, a.pad!))
  if (a.pad) return b.segments.some(segment => segmentTouchesPad(segment, a.pad!))
  if (b.pad) return a.segments.some(segment => segmentTouchesPad(segment, b.pad!))
  return a.segments.some(left => b.segments.some(right => left.layers.some(layer => right.layers.includes(layer)) &&
    segmentDistanceSquared(left.a, left.b, right.a, right.b) <= (left.radius + right.radius + EPS) ** 2))
}
function traceSegments(trace: SimplifiedPcbTrace, layers: string[], problem: RoutingProblem): Segment[] {
  const segments: Segment[] = []
  let previous: { point: Point; layer: string; width: number } | undefined
  for (const item of trace.route) {
    if (item.route_type === "wire") {
      segments.push({ a: previous?.layer === item.layer ? previous.point : item, b: item, radius: item.width / 2, layers: [item.layer] })
      previous = { point: item, layer: item.layer, width: item.width }
    } else if (item.route_type === "via") {
      if (previous?.layer === item.from_layer) segments.push({ a: previous.point, b: item, radius: previous.width / 2, layers: [item.from_layer] })
      segments.push({ a: item, b: item, radius: (item.via_diameter ?? problem.viaDiameter) / 2, layers })
      previous = { point: item, layer: item.to_layer, width: previous?.width ?? problem.srj.minTraceWidth }
    } else {
      const from = item.route_type === "jumper" ? item.layer : item.from_layer
      const to = item.route_type === "jumper" ? item.layer : item.to_layer
      if (previous?.layer === from) segments.push({ a: previous.point, b: item.start, radius: previous.width / 2, layers: [from] })
      segments.push({ a: item.start, b: item.end, radius: item.route_type === "through_obstacle" ? item.width / 2 : 0, layers: [from, to] })
      previous = { point: item.end, layer: to, width: problem.srj.minTraceWidth }
    }
  }
  return segments
}

/** Validate exact board copper and physical task connectivity against trusted input. */
export function isValidBoardRoutes(value: unknown, problem: RoutingProblem): value is SimplifiedPcbTrace[] {
  try {
    if (!Array.isArray(value)) return false
    const routes = value as SimplifiedPcbTrace[], layers = getBoardLayers(problem.srj.layerCount)
    const copper = new CopperMap(problem), ids = new Set(problem.fixedTraces.map(trace => trace.pcb_trace_id))
    const conductors: Conductor[] = []
    const matchTask = (name: string) => problem.tasks.find(task => names(task).includes(name))
    for (const trace of problem.fixedTraces) {
      const task = matchTask(trace.connection_name) ?? trace.connectsTo?.flatMap(name => matchTask(name) ?? [])[0]
      if (task) conductors.push({ net: task.netName, segments: traceSegments(trace, layers, problem) })
    }
    for (const obstacle of problem.srj.obstacles) {
      const task = problem.tasks.find(task => obstacle.connectedTo.some(name => names(task).includes(name)))
      if (task) conductors.push({ net: task.netName, segments: [], pad: obstacle })
    }
    for (const trace of routes) {
      if (!trace || trace.type !== "pcb_trace" || typeof trace.pcb_trace_id !== "string" || !trace.pcb_trace_id || ids.has(trace.pcb_trace_id) ||
        typeof trace.connection_name !== "string" || !Array.isArray(trace.route) || trace.route.length < 2) return false
      ids.add(trace.pcb_trace_id)
      const task = problem.tasks.find(task => task.connectionName === trace.connection_name)
      if (!task) return false
      const aliases = new Set(names(task))
      if (trace.connectsTo !== undefined && (!Array.isArray(trace.connectsTo) || trace.connectsTo.some(name => !aliases.has(name)))) return false
      let previous: { point: Point; layer: string; width: number } | undefined
      for (const item of trace.route) {
        if (!validPoint(item)) return false
        if (item.route_type === "wire") {
          if (!layers.includes(item.layer) || task.allowedLayers && !task.allowedLayers.includes(item.layer) ||
            item.width !== task.traceWidth || previous && previous.layer !== item.layer) return false
          const a = previous?.point ?? item
          if (!copper.clear(a, item, layers.indexOf(item.layer), item.width / 2, task)) return false
          previous = { point: item, layer: item.layer, width: item.width }
        } else if (item.route_type === "via") {
          if (!previous || previous.layer !== item.from_layer || !layers.includes(item.to_layer) || item.from_layer === item.to_layer ||
            task.allowedLayers && (!task.allowedLayers.includes(item.from_layer) || !task.allowedLayers.includes(item.to_layer)) ||
            (item.via_diameter ?? problem.viaDiameter) !== problem.viaDiameter ||
            (item.via_hole_diameter ?? problem.viaHoleDiameter) !== problem.viaHoleDiameter ||
            !copper.clear(previous.point, item, layers.indexOf(item.from_layer), previous.width / 2, task) || !copper.viaClear(item, task)) return false
          previous = { point: item, layer: item.to_layer, width: previous.width }
        } else return false // The independent routing engine produces wire/via copper only.
      }
      copper.addTrace(trace, names(task))
      conductors.push({ net: task.netName, segments: traceSegments(trace, layers, problem) })
    }
    const parents = conductors.map((_, i) => i)
    const find = (id: number): number => parents[id] === id ? id : (parents[id] = find(parents[id]!))
    const join = (a: number, b: number) => { parents[find(b)] = find(a) }
    for (let a = 0; a < conductors.length; a++) for (let b = a + 1; b < conductors.length; b++)
      if (touches(conductors[a]!, conductors[b]!)) join(a, b)
    const endpoints: Array<[number, number]> = []
    for (const task of problem.tasks) {
      const pair = [task.start, task.end].map(point => {
        const terminal: Conductor = { net: task.netName, segments: [{ a: point, b: point, radius: 0, layers: getPointLayers(point) }] }
        const id = conductors.length
        conductors.push(terminal); parents.push(id)
        for (let i = 0; i < id; i++) if (touches(terminal, conductors[i]!)) join(id, i)
        return id
      })
      endpoints.push(pair as [number, number])
    }
    return endpoints.every(([a, b]) => find(a) === find(b))
  } catch { return false }
}
