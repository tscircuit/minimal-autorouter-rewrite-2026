import { RoutingSolver } from "../routing/RoutingSolver"
import { nodeProblem, toHighDensity } from "./nodeConversion"
import type { Pipeline9NetworkedHighDensityNodeInput, Pipeline9NetworkedHighDensityNodeOutput } from "./types"

/** The service and local implementation share one independent node-solving policy. */
export function solvePipeline9NetworkedHighDensityNode(input: Pipeline9NetworkedHighDensityNodeInput): Pipeline9NetworkedHighDensityNodeOutput {
  const ordinary = new RoutingSolver(nodeProblem(input))
  ordinary.solve()
  if (ordinary.solved) return { status: "solved", solutionStage: "ordinary", routes: toHighDensity(ordinary.routes, input) }
  const ordinaryFailure = ordinary.error ?? "Ordinary node routing failed"
  if (!input.enableRegionalFallback) return { status: "failed", solutionStage: "ordinary", error: ordinaryFailure }
  const regional = new RoutingSolver(nodeProblem(input, true))
  regional.solve()
  return regional.solved ? { status: "solved", solutionStage: "regional-fallback", ordinaryFailure, routes: toHighDensity(regional.routes, input) }
    : { status: "failed", solutionStage: "regional-fallback", ordinaryFailure, error: regional.error ?? "Regional node routing failed" }
}
