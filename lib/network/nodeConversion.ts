import { ConnectivityIndex } from "../preparation/ConnectivityIndex"
import { getBoardLayers } from "../preparation/PrepareBoardSolver"
import type { RoutingProblem, RoutingTask } from "../routing/types"
import type { HighDensityIntraNodeRoute, PortPoint } from "../types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../types"
import { PIPELINE9_NETWORKED_SOLVE_POLICY, type Pipeline9NetworkedHighDensityNodeInput } from "./types"

export function nodePairs(input: Pipeline9NetworkedHighDensityNodeInput): [PortPoint, PortPoint][] {
  if (input.nodeWithPortPoints.portPointsInPairs) return input.nodeWithPortPoints.portPointsInPairs
  const groups = new Map<string, PortPoint[]>()
  for (const point of input.nodeWithPortPoints.portPoints) {
    const group = groups.get(point.connectionName) ?? []
    group.push(point); groups.set(point.connectionName, group)
  }
  return [...groups.values()].flatMap(points => points.slice(1).map(point => [points[0]!, point] as [PortPoint, PortPoint]))
}

export function nodeProblem(input: Pipeline9NetworkedHighDensityNodeInput, regional = false): RoutingProblem {
  if (input.solvePolicy !== PIPELINE9_NETWORKED_SOLVE_POLICY) throw new Error(`Unsupported Pipeline9 networked solve policy ${String(input.solvePolicy)}`)
  if (input.effort !== 1) throw new Error("Pipeline9 networked high-density solving requires effort=1")
  const node = input.nodeWithPortPoints
  const layers = getBoardLayers(input.layerCount)
  if (![node.center.x, node.center.y, node.width, node.height, input.traceWidth, input.viaDiameter, input.obstacleMargin].every(Number.isFinite) ||
      node.width <= 0 || node.height <= 0 || input.traceWidth <= 0 || input.viaDiameter <= 0 || input.obstacleMargin < 0) throw new Error("Invalid network node dimensions")
  const connectivity = new ConnectivityIndex()
  connectivity.addConnections(Object.entries(input.connectivityNetMap).map(([root, names]) => [root, ...names]))
  const tasks: RoutingTask[] = nodePairs(input).map(([start, end], index) => {
    for (const point of [start, end]) if (![point.x, point.y].every(Number.isFinite) || !Number.isInteger(point.z) || !layers[point.z]) throw new Error("Invalid network port point")
    const netName = connectivity.getNetConnectedToId(start.rootConnectionName ?? start.connectionName)
    return { id: `${node.capacityMeshNodeId}__pair${index}`, connectionName: start.connectionName, netName,
      connectedNames: connectivity.getIdsConnectedToNet(netName), traceWidth: input.traceWidth,
      start: { x: start.x, y: start.y, layer: layers[start.z]!, pcb_port_id: start.pcb_port_id },
      end: { x: end.x, y: end.y, layer: layers[end.z]!, pcb_port_id: end.pcb_port_id },
      allowedLayers: regional ? layers : (node.availableZ ?? layers.map((_, z) => z)).map(z => layers[z]!).filter(Boolean) }
  })
  const srj: SimpleRouteJson = { layerCount: input.layerCount, minTraceWidth: input.traceWidth,
    defaultObstacleMargin: input.obstacleMargin, bounds: {
      minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2 },
    obstacles: regional ? input.regionalObstacles : input.obstacles,
    connections: tasks.map(task => ({ name: task.connectionName, rootConnectionName: task.netName, pointsToConnect: [task.start, task.end] })) }
  return { srj, tasks, fixedTraces: [], viaDiameter: input.viaDiameter, viaHoleDiameter: input.viaDiameter / 2,
    obstacleMargin: input.obstacleMargin, effort: 1 }
}

export function toHighDensity(traces: SimplifiedPcbTrace[], input: Pipeline9NetworkedHighDensityNodeInput): HighDensityIntraNodeRoute[] {
  const layers = getBoardLayers(input.layerCount)
  return traces.map(trace => {
    const route: HighDensityIntraNodeRoute["route"] = []
    const vias: HighDensityIntraNodeRoute["vias"] = []
    for (const entry of trace.route) {
      if (entry.route_type === "wire") {
        const last = route.at(-1)
        const z = layers.indexOf(entry.layer)
        const identity = entry.start_pcb_port_id ?? entry.end_pcb_port_id
        if (last && last.x === entry.x && last.y === entry.y && last.z === z && identity) last.pcb_port_id = identity
        if (!last || last.x !== entry.x || last.y !== entry.y || last.z !== z) route.push({ x: entry.x, y: entry.y, z,
          ...(identity ? { pcb_port_id: identity } : {}) })
      } else if (entry.route_type === "via") {
        const last = route.at(-1)
        const from = layers.indexOf(entry.from_layer), to = layers.indexOf(entry.to_layer)
        if (!last || last.x !== entry.x || last.y !== entry.y || last.z !== from) route.push({ x: entry.x, y: entry.y, z: from })
        route.push({ x: entry.x, y: entry.y, z: to }); vias.push({ x: entry.x, y: entry.y })
      } else throw new Error("Network node output contains unsupported conductor type")
    }
    return { connectionName: trace.connection_name, rootConnectionName: trace.connectsTo?.[0],
      traceThickness: input.traceWidth, viaDiameter: input.viaDiameter, route, vias,
      startPcbPortId: route[0]?.pcb_port_id, endPcbPortId: route.at(-1)?.pcb_port_id }
  })
}

export function fromHighDensity(routes: HighDensityIntraNodeRoute[], problem: RoutingProblem): SimplifiedPcbTrace[] {
  const layers = getBoardLayers(problem.srj.layerCount)
  return routes.map((hd, index) => {
    const route: SimplifiedPcbTrace["route"] = []
    for (let i = 0; i < hd.route.length; i++) {
      const point = hd.route[i]!, previous = hd.route[i - 1]
      if (previous && previous.z !== point.z) route.push({ route_type: "via", x: point.x, y: point.y,
        from_layer: layers[previous.z]!, to_layer: layers[point.z]!, via_diameter: hd.viaDiameter, via_hole_diameter: problem.viaHoleDiameter })
      route.push({ route_type: "wire", x: point.x, y: point.y, layer: layers[point.z]!, width: point.traceThickness ?? hd.traceThickness,
        ...(i === 0 && hd.startPcbPortId ? { start_pcb_port_id: hd.startPcbPortId } : {}),
        ...(i === hd.route.length - 1 && hd.endPcbPortId ? { end_pcb_port_id: hd.endPcbPortId } : {}) })
    }
    const task = problem.tasks.find(task => task.connectionName === hd.connectionName)
    return { type: "pcb_trace", pcb_trace_id: `minimal_network_${index}`, connection_name: hd.connectionName,
      connectsTo: task?.connectedNames ?? [hd.rootConnectionName ?? hd.connectionName], route }
  })
}
