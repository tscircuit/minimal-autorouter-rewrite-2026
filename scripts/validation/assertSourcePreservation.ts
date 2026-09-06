import { isDeepStrictEqual } from "node:util"
import type { Obstacle, SimpleRouteJson } from "../../lib/types"
import { assertOutputConnectivity, layerNames } from "./assertPhysicalConnectivity"

function requireSame(value: unknown, description: string): asserts value {
  if (!value) throw new Error(`Source preservation: ${description}`)
}

/** The dataset loader can recover these two IDs from its legacy alias sequence. */
function migratedMetadata(obstacle: Obstacle): Obstacle["circuitJsonMetadata"] {
  if (obstacle.circuitJsonMetadata) return obstacle.circuitJsonMetadata
  const identity = obstacle.connectedTo[0]
  if (!identity) return undefined
  const repeat = obstacle.connectedTo.indexOf(identity, 1)
  const port = repeat < 0 ? undefined : obstacle.connectedTo[repeat + 1]
  if (!port) return undefined
  return {
    [obstacle.layers.length === 1 ? "pcb_smtpad_id" : "pcb_plated_hole_id"]: identity,
    pcb_port_id: port,
  }
}

function assertObstacle(original: Obstacle, output: Obstacle, index: number, layers: string[]): void {
  const label = `obstacle ${index}`
  requireSame(original && output && Array.isArray(original.layers) && Array.isArray(output.layers), `${label} is missing or malformed`)
  const normalizedLayers = original.layers.filter(layer => layers.includes(layer))
  requireSame(isDeepStrictEqual(output.layers, original.layers) || isDeepStrictEqual(output.layers, normalizedLayers), `${label} changed physical layers`)
  for (const key of ["zLayers", "__zLayers"] as const) {
    const normalized = original[key] === undefined ? undefined : normalizedLayers.map(layer => layers.indexOf(layer))
    requireSame(isDeepStrictEqual(output[key], original[key]) || isDeepStrictEqual(output[key], normalized), `${label} changed ${key}`)
  }
  requireSame(Array.isArray(original.connectedTo), `${label} has malformed source aliases`)
  requireSame(isDeepStrictEqual(output.circuitJsonMetadata, original.circuitJsonMetadata) ||
    (original.circuitJsonMetadata === undefined && isDeepStrictEqual(output.circuitJsonMetadata, migratedMetadata(original))),
    `${label} changed source metadata`)
  const {layers: _originalLayers, zLayers: _originalZ, __zLayers: _originalPrivateZ, circuitJsonMetadata: _originalMetadata, ...originalFields} = original
  const {layers: _outputLayers, zLayers: _outputZ, __zLayers: _outputPrivateZ, circuitJsonMetadata: _outputMetadata, ...outputFields} = output
  requireSame(isDeepStrictEqual(originalFields, outputFields), `${label} changed geometry, ownership, or other source fields`)
}

/**
 * A routed SRJ cannot redefine the board it was asked to route. Permit only
 * Pipeline9's existing copper-layer normalization and the loader's verified
 * metadata addition; source geometry, requests, rules and fixed copper survive.
 */
export function assertSourcePreservation(original: SimpleRouteJson, output: SimpleRouteJson): void {
  requireSame(original && output && Array.isArray(original.obstacles) && Array.isArray(output.obstacles) &&
    Array.isArray(original.connections) && Array.isArray(output.connections), "missing source or output board fields")
  const {obstacles: originalObstacles, traces: originalTraces, ...originalFields} = original
  const {obstacles: outputObstacles, traces: outputTraces, ...outputFields} = output
  requireSame(isDeepStrictEqual(originalFields, outputFields), "board fields, rules, connections, or terminal requirements changed")
  requireSame(originalObstacles.length === outputObstacles.length, "source obstacle count changed")
  const layers = layerNames(original.layerCount)
  originalObstacles.forEach((obstacle, index) => assertObstacle(obstacle, outputObstacles[index]!, index, layers))
  requireSame(originalTraces === undefined || Array.isArray(originalTraces), "malformed source traces")
  requireSame(outputTraces === undefined || Array.isArray(outputTraces), "malformed output traces")
  const outputById = new Map((outputTraces ?? []).map(trace => [trace.pcb_trace_id, trace]))
  requireSame(outputById.size === (outputTraces ?? []).length, "duplicate output trace identities")
  for (const trace of originalTraces ?? []) {
    requireSame(isDeepStrictEqual(outputById.get(trace.pcb_trace_id), trace), `fixed trace ${trace.pcb_trace_id} was removed or changed`)
  }
  // These requirements come from the separate original, never from an output
  // that could have discarded a difficult terminal or entire requested net.
  assertOutputConnectivity(original, output, {allowUnrequestedTraces: true})
}
