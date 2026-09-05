import type { RoutingProblem } from "../../lib/routing/types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"

export function straightTrace(name: string, length: number, y: number, width = 0.2, layer = "top"): SimplifiedPcbTrace {
  return { type: "pcb_trace", pcb_trace_id: `trace_${name}`, connection_name: name,
    route: [{ route_type: "wire", x: 0, y, layer, width, start_pcb_port_id: `${name}_start` },
      { route_type: "wire", x: length, y, layer, width, end_pcb_port_id: `${name}_end` }] }
}

export function lengthProblem(traces: SimplifiedPcbTrace[], changes: Partial<SimpleRouteJson> = {}, fixedTraces: SimplifiedPcbTrace[] = []): RoutingProblem {
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.2,
    bounds: { minX: -1, maxX: 10, minY: -4, maxY: 8 }, obstacles: [],
    connections: traces.map((trace) => ({ name: trace.connection_name,
      pointsToConnect: trace.route.filter((point) => point.route_type === "wire").map((point) => ({
        x: point.x, y: point.y, layer: point.layer, pcb_port_id: point.start_pcb_port_id ?? point.end_pcb_port_id,
      })) })),
    ...changes,
  }
  return { srj, tasks: [], fixedTraces, effort: 1, viaDiameter: 0.3, viaHoleDiameter: 0.15, obstacleMargin: 0.1 }
}

/** Independent measurement for tests, deliberately does not import solver geometry. */
export function measuredLength(trace: SimplifiedPcbTrace): number {
  let length = 0
  for (let index = 1; index < trace.route.length; index++) {
    const before = trace.route[index - 1]!, after = trace.route[index]!
    if (before.route_type === "wire" && after.route_type === "wire" && before.layer === after.layer) {
      length += Math.sqrt((after.x - before.x) ** 2 + (after.y - before.y) ** 2)
    }
  }
  return length
}
