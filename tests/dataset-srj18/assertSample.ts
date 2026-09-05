import { Pipeline9 } from "../../lib/index"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import {
  assertOutputConnectivity,
  layerNames,
  requireCondition,
} from "../../scripts/validation/assertPhysicalConnectivity"

/** Every dataset sample gets its own test file; all share the same strict assertions. */
export function assertSample(
  sample: SimpleRouteJson,
  sampleName: string,
): void {
  const input = structuredClone(sample)
  const inputJson = JSON.stringify(input)
  const solver = new Pipeline9(input, { cacheProvider: null, effort: 1 })
  requireCondition(
    !solver.solved && !solver.failed && solver.iterations === 0,
    `${sampleName}: invalid initial solver state`,
  )
  const deadline = performance.now() + 290_000
  while (!solver.solved && !solver.failed) {
    requireCondition(
      performance.now() < deadline,
      `${sampleName}: did not finish within 290 seconds`,
    )
    solver.step()
  }
  requireCondition(
    solver.solved && !solver.failed,
    `${sampleName}: routing failed in ${solver.getCurrentPhase()}: ${solver.error}`,
  )
  requireCondition(
    solver.iterations > 0,
    `${sampleName}: solver did not execute incrementally`,
  )
  requireCondition(
    JSON.stringify(input) === inputJson,
    `${sampleName}: solver mutated its input`,
  )
  const output = solver.getOutputSimpleRouteJson()
  const normalizedSource = structuredClone(sample)
  const validLayers = layerNames(sample.layerCount)
  for (const obstacle of normalizedSource.obstacles) {
    obstacle.layers = obstacle.layers.filter((layer) =>
      validLayers.includes(layer),
    )
    if (obstacle.zLayers)
      obstacle.zLayers = obstacle.layers.map((layer) =>
        validLayers.indexOf(layer),
      )
    if (obstacle.__zLayers)
      obstacle.__zLayers = obstacle.layers.map((layer) =>
        validLayers.indexOf(layer),
      )
  }
  for (const key of Object.keys(sample).filter((key) => key !== "traces")) {
    requireCondition(
      JSON.stringify((output as unknown as Record<string, unknown>)[key]) ===
        JSON.stringify(
          (normalizedSource as unknown as Record<string, unknown>)[key],
        ),
      `${sampleName}: output changed normalized source field ${key}`,
    )
  }
  requireCondition(
    (output.traces?.length ?? 0) > 0,
    `${sampleName}: produced no traces`,
  )
  assertOutputConnectivity(sample, output)
  requireCondition(
    JSON.stringify(output) ===
      JSON.stringify(solver.getOutputSimpleRouteJson()),
    `${sampleName}: repeated output is unstable`,
  )
  const iterations = solver.iterations
  solver.step()
  requireCondition(
    solver.iterations === iterations && solver.solved,
    `${sampleName}: step after completion changed terminal state`,
  )
}

// Preserve the existing test-helper imports while validation lives outside tests.
export {
  assertOutputConnectivity,
  Groups,
  layerNames,
  checkTraceShape,
  appendTrace,
  touches,
} from "../../scripts/validation/assertPhysicalConnectivity"
export type {
  Copper,
  Capsule,
  Box,
} from "../../scripts/validation/assertPhysicalConnectivity"
