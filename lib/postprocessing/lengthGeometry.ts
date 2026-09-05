import { CopperMap } from "../routing/CopperMap"
import { pointSegmentDistanceSquared, segmentDistanceSquared } from "../routing/geometry"
import type { RoutingProblem, RoutingTask } from "../routing/types"
import type { Point, SimplifiedPcbTrace, Wire } from "../types"

export interface LengthCandidate {
  segmentIndex: number
  points: Wire[]
}

const coincides = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) < 1e-8

/** Planar conductor length; vertical via barrel length is not part of SRJ geometry. */
export function getTraceLength(trace: SimplifiedPcbTrace): number {
  let length = 0
  for (let index = 1; index < trace.route.length; index++) {
    const a = trace.route[index - 1]!, b = trace.route[index]!
    if (a.route_type === "wire" && b.route_type === "wire" && a.layer === b.layer) {
      length += Math.hypot(a.x - b.x, a.y - b.y)
    }
  }
  return length
}

/** A rectangular excursion adds exactly twice its depth without moving its anchors. */
export function* createLengthCandidates(trace: SimplifiedPcbTrace, extraLength: number, clearance: number, eligibleSegments?: Set<number>): Generator<LengthCandidate> {
  const segments: Array<{ index: number; a: Wire; b: Wire; length: number }> = []
  for (let index = 0; index < trace.route.length - 1; index++) {
    if (eligibleSegments && !eligibleSegments.has(index)) continue
    const a = trace.route[index]!, b = trace.route[index + 1]!
    if (a.route_type === "wire" && b.route_type === "wire" && a.layer === b.layer) {
      const length = Math.hypot(a.x - b.x, a.y - b.y)
      if (length > 1e-7) segments.push({ index, a, b, length })
    }
  }
  segments.sort((a, b) => b.length - a.length || a.index - b.index)
  for (const { index, a, b, length } of segments) {
    const width = Math.max(a.width, b.width)
    const spacing = width + clearance + 1e-5
    const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length
    const makePoint = (along: number, normal: number): Wire => ({
      route_type: "wire", layer: a.layer, width,
      x: a.x + ux * along - uy * normal,
      y: a.y + uy * along + ux * normal,
    })
    // Start with one broad bend; use multiple smaller bends when board height is limited.
    const maximumLobes = Math.min(16, Math.floor(length * 0.9 / (2 * spacing)))
    for (let lobes = 1; lobes <= Math.max(1, maximumLobes); lobes++) {
      for (const occupiedFraction of [0.8, 0.5, 0.3]) {
        const occupied = length * occupiedFraction
        const span = occupied / (2 * lobes - 1)
        if (span < spacing) continue
        for (const anchorFraction of [0.5, 0.15, 0.85]) {
          const start = (length - occupied) * anchorFraction
          for (const direction of [1, -1]) {
            const depth = direction * extraLength / (2 * lobes)
            const points: Wire[] = [{ ...a }]
            for (let lobe = 0; lobe < lobes; lobe++) {
              const from = start + 2 * lobe * span, to = from + span
              points.push(makePoint(from, 0), makePoint(from, depth), makePoint(to, depth), makePoint(to, 0))
            }
            points.push({ ...b })
            yield { segmentIndex: index, points }
          }
        }
      }
    }
    // A smooth triangular excursion can add a tiny amount that is too shallow
    // for two distinct rectangular corners at the declared trace width.
    for (const occupiedFraction of [0.8, 0.5, 0.3]) {
      const span = length * occupiedFraction
      const depth = Math.sqrt(extraLength * span / 2 + extraLength * extraLength / 4)
      for (const direction of [1, -1]) {
        const start = (length - span) / 2
        yield { segmentIndex: index, points: [{ ...a }, makePoint(start, 0),
          makePoint(length / 2, depth * direction), makePoint(start + span, 0), { ...b }] }
      }
    }
  }
}

function shareOnlyEndpoint(a: Point, b: Point, c: Point, d: Point): boolean {
  for (const [joint, first, otherJoint, second] of [[a, b, c, d], [a, b, d, c], [b, a, c, d], [b, a, d, c]] as const) {
    if (!coincides(joint, otherJoint)) continue
    const ux = first.x - joint.x, uy = first.y - joint.y
    const vx = second.x - joint.x, vy = second.y - joint.y
    // Connected adjacent segments may meet, but may not double back over copper.
    return Math.abs(ux * vy - uy * vx) > 1e-9 || ux * vx + uy * vy <= 0
  }
  return false
}

/** Existing same-net copper also matters: a self-short would invalidate added length. */
export function isLengthCandidateClear(problem: RoutingProblem, traces: SimplifiedPcbTrace[], traceIndex: number,
  candidate: LengthCandidate, task: RoutingTask, map: CopperMap): boolean {
  const trace = traces[traceIndex]!
  const layer = candidate.points[0]!.layer
  const z = map.layers.indexOf(layer)
  if (z < 0) return false
  const strictTask: RoutingTask = { ...task, netName: "__length_matching_clearance__", connectionName: "__length_matching_clearance__", connectedNames: [] }
  const last = candidate.points.length - 2
  const allCopper = [...problem.fixedTraces, ...traces]
  for (let index = 0; index < candidate.points.length - 1; index++) {
    const a = candidate.points[index]!, b = candidate.points[index + 1]!
    const width = Math.max(a.width, b.width), radius = width / 2
    // Terminal stubs may leave their own pad; the added excursion must remain
    // outside every pad so a pad cannot electrically bypass its added distance.
    if (!map.clear(a, b, z, radius, index === 0 || index === last ? task : strictTask)) return false
    for (let other = index + 2; other < candidate.points.length - 1; other++) {
      const c = candidate.points[other]!, d = candidate.points[other + 1]!
      const clearance = radius + Math.max(c.width, d.width) / 2 + problem.obstacleMargin
      if (segmentDistanceSquared(a, b, c, d) < (clearance - 1e-7) ** 2) return false
    }
    for (const copper of allCopper) {
      for (let segment = 0; segment < copper.route.length; segment++) {
        const c = copper.route[segment]!, d = copper.route[segment + 1]
        if (c.route_type === "via") {
          if ((index === 0 && coincides(a, c)) || (index === last && coincides(b, c))) continue
          const clearance = radius + (c.via_diameter ?? problem.viaDiameter) / 2 + problem.obstacleMargin
          if (pointSegmentDistanceSquared(c, a, b) < (clearance - 1e-7) ** 2) return false
        }
        if (c.route_type !== "wire" || d?.route_type !== "wire" || c.layer !== layer || d.layer !== layer) continue
        if (copper === trace && segment === candidate.segmentIndex) continue
        if ((index === 0 && (coincides(a, c) || coincides(a, d))) ||
          (index === last && (coincides(b, c) || coincides(b, d)))) {
          if (shareOnlyEndpoint(a, b, c, d)) continue
        }
        const clearance = radius + Math.max(c.width, d.width) / 2 + problem.obstacleMargin
        if (segmentDistanceSquared(a, b, c, d) < (clearance - 1e-7) ** 2) return false
      }
    }
  }
  return true
}
