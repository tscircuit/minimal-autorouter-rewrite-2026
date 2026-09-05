import { CopperMap } from "../routing/CopperMap"
import { pointSegmentDistanceSquared, segmentDistanceSquared } from "../routing/geometry"
import type { HighDensityIntraNodeRoute, PortPoint } from "../types/high-density-types"
import { fromHighDensity, nodePairs, nodeProblem } from "./nodeConversion"
import type { Pipeline9NetworkedHighDensityNodeInput } from "./types"

/** A remote route is untrusted: validate copper, layers, transitions, and all requested pairs. */
export function isValidRemoteRoutes(value: unknown, input: Pipeline9NetworkedHighDensityNodeInput, regional: boolean): value is HighDensityIntraNodeRoute[] {
  try {
    if (!Array.isArray(value)) return false
    const problem = nodeProblem(input, regional)
    const map = new CopperMap(problem)
    const routes = value as HighDensityIntraNodeRoute[]
    const nets: string[] = []
    for (const hd of routes) {
      if (!hd || !Array.isArray(hd.route) || hd.route.length < 2 || !Array.isArray(hd.vias) ||
          hd.traceThickness !== input.traceWidth || hd.viaDiameter !== input.viaDiameter) return false
      const task = problem.tasks.find(task => task.connectionName === hd.connectionName)
      if (!task || (hd.rootConnectionName && hd.rootConnectionName !== task.netName && !task.connectedNames.includes(hd.rootConnectionName))) return false
      nets.push(task.netName)
      let viaIndex = 0
      for (let i = 0; i < hd.route.length; i++) {
        const p = hd.route[i]!, a = hd.route[i - 1]
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isInteger(p.z) || p.z < 0 || p.z >= input.layerCount ||
            p.toNextSegmentType || p.insideJumperPad || (p.traceThickness !== undefined && p.traceThickness !== input.traceWidth)) return false
        if (!regional && input.nodeWithPortPoints.availableZ && !input.nodeWithPortPoints.availableZ.includes(p.z)) return false
        if (!a) continue
        if (a.z === p.z) {
          if (!map.clear(a, p, p.z, hd.traceThickness / 2, task)) return false
        } else {
          const via = hd.vias[viaIndex++]
          if (a.x !== p.x || a.y !== p.y || !via || via.x !== p.x || via.y !== p.y || !map.viaClear(p, task)) return false
        }
      }
      if (viaIndex !== hd.vias.length) return false
      map.addTrace(fromHighDensity([hd], problem)[0]!, task.connectedNames)
    }
    const parents = routes.map((_, i) => i)
    const find = (i: number): number => parents[i] === i ? i : (parents[i] = find(parents[i]!))
    const segments = routes.map(hd => hd.route.slice(1).map((b, i) => ({ a: hd.route[i]!, b })))
    const zs = (segment: (typeof segments)[number][number]): number[] => {
      const low = Math.min(segment.a.z, segment.b.z), high = Math.max(segment.a.z, segment.b.z)
      return Array.from({ length: high - low + 1 }, (_, i) => low + i)
    }
    for (let a = 0; a < routes.length; a++) for (let b = a + 1; b < routes.length; b++) {
      if (nets[a] !== nets[b]) continue
      if (segments[a]!.some(left => segments[b]!.some(right => zs(left).some(z => zs(right).includes(z)) &&
          segmentDistanceSquared(left.a, left.b, right.a, right.b) < 1e-10))) parents[find(b)] = find(a)
    }
    const containingRoutes = (point: PortPoint) => routes.flatMap((hd, i) => {
      const task = problem.tasks.find(task => task.connectionName === point.connectionName)
      if (!task || nets[i] !== task.netName) return []
      return segments[i]!.some(segment => zs(segment).includes(point.z) && pointSegmentDistanceSquared(point, segment.a, segment.b) < 1e-10) ? [find(i)] : []
    })
    return nodePairs(input).every(([a, b]) => {
      if (a.x === b.x && a.y === b.y && a.z === b.z) return true
      const aGroups = containingRoutes(a), bGroups = containingRoutes(b)
      return aGroups.some(group => bGroups.includes(group))
    })
  } catch { return false }
}
