import {getBoardLayers} from "../preparation/PrepareBoardSolver"
import type {SimplifiedPcbTrace} from "../types"
import type {HighDensityRoute} from "../types/high-density-types"

/** Converts public copper notation to the numeric-layer debugger notation. */
export function toHighDensityRoutes(traces: SimplifiedPcbTrace[], layerCount: number, viaDiameter: number): HighDensityRoute[] {
  const layers = getBoardLayers(layerCount)
  return traces.map((trace) => {
    const route: HighDensityRoute["route"] = []
    const vias: HighDensityRoute["vias"] = []
    let width: number | undefined
    let startPcbPortId: string | undefined, endPcbPortId: string | undefined
    const append = (x: number, y: number, layer: string, identity?: string): void => {
      const z = layers.indexOf(layer)
      if (z < 0) throw new Error(`Unknown trace layer: ${layer}`)
      const last = route.at(-1)
      if (last?.x === x && last.y === y && last.z === z) {
        if (identity) last.pcb_port_id = identity
      } else route.push({x, y, z, ...(identity ? {pcb_port_id: identity} : {})})
    }
    for (const segment of trace.route) {
      if (segment.route_type === "wire") {
        width ??= segment.width
        startPcbPortId ??= segment.start_pcb_port_id
        endPcbPortId = segment.end_pcb_port_id ?? endPcbPortId
        append(segment.x, segment.y, segment.layer, segment.start_pcb_port_id ?? segment.end_pcb_port_id)
      } else if (segment.route_type === "via") {
        append(segment.x, segment.y, segment.from_layer)
        append(segment.x, segment.y, segment.to_layer)
        vias.push({x: segment.x, y: segment.y})
      } else if (segment.route_type === "through_obstacle") {
        width ??= segment.width
        append(segment.start.x, segment.start.y, segment.from_layer)
        const start = route.at(-1)!
        start.toNextSegmentType = "through_obstacle"
        start.toNextSegmentCircuitJsonMetadata = segment.circuitJsonMetadata
        append(segment.end.x, segment.end.y, segment.to_layer)
      } else {
        throw new Error("High-density route visualization does not support jumper copper")
      }
    }
    if (width === undefined) throw new Error(`Trace ${trace.pcb_trace_id} has no wire width`)
    return {connectionName: trace.connection_name, rootConnectionName: trace.connectsTo?.[0],
      traceThickness: width, viaDiameter, route, vias, startPcbPortId, endPcbPortId}
  })
}
