import { CopperMap } from "../routing/CopperMap"
import { pointSegmentDistanceSquared, segmentDistanceSquared } from "../routing/geometry"
import type { RoutingProblem, RoutingTask } from "../routing/types"
import type { Point, SimplifiedPcbTrace, Wire } from "../types"

export interface CoupledCandidate {
  traces: [SimplifiedPcbTrace, SimplifiedPcbTrace]
  escapeSegments: [Set<number>, Set<number>]
  spine: Point[]
}
const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-8
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })

function offsetSpine(spine: Point[], offset: number): Point[] | undefined {
  const vectors = spine.slice(1).map((point, index) => {
    const vector = subtract(point, spine[index]!), length = Math.hypot(vector.x, vector.y)
    return { x: vector.x / length, y: vector.y / length }
  })
  const displaced = (point: Point, vector: Point): Point => ({ x: point.x - vector.y * offset, y: point.y + vector.x * offset })
  const result = [displaced(spine[0]!, vectors[0]!)]
  for (let index = 1; index < spine.length - 1; index++) {
    const incoming = vectors[index - 1]!, outgoing = vectors[index]!
    const first = displaced(spine[index]!, incoming), second = displaced(spine[index]!, outgoing)
    const determinant = cross(incoming, outgoing)
    if (Math.abs(determinant) < 1e-8) {
      if (incoming.x * outgoing.x + incoming.y * outgoing.y < 0) return undefined
      result.push(first)
    } else {
      const along = cross(subtract(second, first), outgoing) / determinant
      result.push({ x: first.x + incoming.x * along, y: first.y + incoming.y * along })
    }
  }
  result.push(displaced(spine[spine.length - 1]!, vectors[vectors.length - 1]!))
  return result
}

/** Offset rails share every central segment and bend; terminal escapes remain explicit. */
export function* createCoupledCandidates(first: SimplifiedPcbTrace, second: SimplifiedPcbTrace, gap: number, problem: RoutingProblem): Generator<CoupledCandidate> {
  const a = first.route as Wire[], originalB = second.route as Wire[]
  const reverse = Math.hypot(a[0]!.x - originalB[0]!.x, a[0]!.y - originalB[0]!.y) + Math.hypot(a.at(-1)!.x - originalB.at(-1)!.x, a.at(-1)!.y - originalB.at(-1)!.y) > Math.hypot(a[0]!.x - originalB.at(-1)!.x, a[0]!.y - originalB.at(-1)!.y) + Math.hypot(a.at(-1)!.x - originalB[0]!.x, a.at(-1)!.y - originalB[0]!.y)
  const b = reverse ? [...originalB].reverse() : originalB
  const start = { x: (a[0]!.x + b[0]!.x) / 2, y: (a[0]!.y + b[0]!.y) / 2 }
  const end = { x: (a.at(-1)!.x + b.at(-1)!.x) / 2, y: (a.at(-1)!.y + b.at(-1)!.y) / 2 }
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  if (distance < 1e-6) return
  const u = { x: (end.x - start.x) / distance, y: (end.y - start.y) / distance }
  const v = { x: -u.y, y: u.x }
  const separation = gap + (a[0]!.width + b[0]!.width) / 2
  const sign = (a[0]!.x - b[0]!.x) * v.x + (a[0]!.y - b[0]!.y) * v.y >= 0 ? 1 : -1
  const point = (along: number, normal: number): Point => ({ x: start.x + along * u.x + normal * v.x, y: start.y + along * u.y + normal * v.y })
  const offsets = new Set<number>([0.5, -0.5, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6, 8, -8])
  const halfEnvelope = separation / 2 + Math.max(a[0]!.width, b[0]!.width) / 2 + problem.obstacleMargin + 0.02
  for (const obstacle of problem.srj.obstacles) {
    const normal = (obstacle.center.x - start.x) * v.x + (obstacle.center.y - start.y) * v.y
    const extent = Math.hypot(obstacle.width, obstacle.height) / 2 + halfEnvelope
    offsets.add(normal + extent); offsets.add(normal - extent)
  }
  function* spines(): Generator<Point[]> {
    yield [start, end]
    for (const detour of [...offsets].sort((x, y) => Math.abs(x) - Math.abs(y))) {
      if (Math.abs(detour) < 2 * halfEnvelope) continue
      for (const fraction of [0.12, 0.24, 0.36]) {
        const entry = Math.max(distance * fraction, halfEnvelope * 2)
        if (entry * 2 + halfEnvelope * 2 >= distance) continue
        yield [start, point(entry, 0), point(entry, detour), point(distance - entry, detour), point(distance - entry, 0), end]
      }
    }
  }
  for (const spine of spines()) {
    const rails = [offsetSpine(spine, sign * separation / 2), offsetSpine(spine, -sign * separation / 2)]
    if (!rails[0] || !rails[1]) continue
    const traces: SimplifiedPcbTrace[] = [], escapeSegments: Set<number>[] = []
    for (let member = 0; member < 2; member++) {
      const original = member === 0 ? first : second, ordered = member === 0 ? a : b
      const rail = rails[member]!
      const points: Wire[] = [{ ...ordered[0]! }]
      for (const p of rail) if (!near(points.at(-1)!, p)) points.push({ route_type: "wire", layer: ordered[0]!.layer, width: ordered[0]!.width, ...p })
      if (!near(points.at(-1)!, ordered.at(-1)!)) points.push({ ...ordered.at(-1)! })
      else points[points.length - 1] = { ...ordered.at(-1)! }
      const centralStart = points.findIndex(p => near(p, rail[0]!))
      let centralEnd = points.length - 1
      while (centralEnd >= 0 && !near(points[centralEnd]!, rail.at(-1)!)) centralEnd--
      const escapes = new Set<number>()
      for (let index = 0; index < points.length - 1; index++) if (index < centralStart || index >= centralEnd) escapes.add(member === 1 && reverse ? points.length - 2 - index : index)
      if (member === 1 && reverse) points.reverse()
      traces.push({ ...original, route: points }); escapeSegments.push(escapes)
    }
    yield { traces: traces as CoupledCandidate["traces"], escapeSegments: escapeSegments as CoupledCandidate["escapeSegments"], spine }
  }
}

function endpointOnly(a: Point, b: Point, c: Point, d: Point): boolean {
  for (const [joint, first, other, second] of [[a, b, c, d], [a, b, d, c], [b, a, c, d], [b, a, d, c]]) {
    if (!near(joint!, other!)) continue
    const u = subtract(first!, joint!), v = subtract(second!, joint!)
    return Math.abs(cross(u, v)) > 1e-9 || u.x * v.x + u.y * v.y <= 0
  }
  return false
}

export function coupledCandidateClear(candidate: CoupledCandidate, tasks: [RoutingTask, RoutingTask], problem: RoutingProblem, fixed: SimplifiedPcbTrace[], map: CopperMap, gap: number): boolean {
  for (let member = 0; member < 2; member++) {
    const trace = candidate.traces[member]!, route = trace.route as Wire[], task = tasks[member]!
    const strict = { ...task, netName: "__pair_interior__", connectionName: "__pair_interior__", connectedNames: [] }
    const z = map.layers.indexOf(route[0]!.layer)
    if (z < 0) return false
    for (let index = 0; index < route.length - 1; index++) {
      const a = route[index]!, b = route[index + 1]!, radius = a.width / 2
      if (!map.clear(a, b, z, radius, index === 0 || index === route.length - 2 ? task : strict)) return false
      for (let other = index + 2; other < route.length - 1; other++) {
        if (segmentDistanceSquared(a, b, route[other]!, route[other + 1]!) < (a.width + problem.obstacleMargin - 1e-7) ** 2) return false
      }
      for (const copper of fixed) for (let part = 0; part < copper.route.length; part++) {
        const c = copper.route[part]!, d = copper.route[part + 1]
        if (c.route_type === "via") {
          if (index === 0 && near(a, c) || index === route.length - 2 && near(b, c)) continue
          if (pointSegmentDistanceSquared(c, a, b) < (radius + (c.via_diameter ?? problem.viaDiameter) / 2 + problem.obstacleMargin - 1e-7) ** 2) return false
        } else if (c.route_type === "wire" && d?.route_type === "wire" && c.layer === a.layer && d.layer === a.layer) {
          if ((index === 0 || index === route.length - 2) && endpointOnly(a, b, c, d)) continue
          if (segmentDistanceSquared(a, b, c, d) < (radius + Math.max(c.width, d.width) / 2 + problem.obstacleMargin - 1e-7) ** 2) return false
        }
      }
    }
  }
  const [a, b] = candidate.traces.map(trace => trace.route as Wire[]) as [Wire[], Wire[]]
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) {
    const bothCoupled = !candidate.escapeSegments[0].has(i) && !candidate.escapeSegments[1].has(j)
    const clearance = (a[i]!.width + b[j]!.width) / 2 + (bothCoupled ? gap : Math.min(gap, problem.obstacleMargin))
    if (segmentDistanceSquared(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!) < (clearance - 1e-7) ** 2) return false
  }
  return true
}
