import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../types/high-density-types"
import type { Obstacle } from "../types/srj-types"

export const PIPELINE9_NETWORKED_SOLVE_POLICY = "ordinary_then_regional_without_fixed_copper_v1" as const
export const AUTOROUTER_VERSION = "0.1.0"
export const DEFAULT_HD_CACHE2_SERVER_URL = "https://hd-cache2.tscircuit.com"
export type Pipeline9NetworkedCacheSource = "cache" | "solver"
export type Pipeline9NetworkedHighDensityNodeInput = {
  solvePolicy: typeof PIPELINE9_NETWORKED_SOLVE_POLICY
  enableRegionalFallback: boolean; nodeWithPortPoints: NodeWithPortPoints
  connectivityNetMap: Record<string, string[]>; colorMap: Record<string, string>
  viaDiameter: number; traceWidth: number; obstacleMargin: number; effort: 1
  obstacles: Obstacle[]; regionalObstacles: Obstacle[]; layerCount: number; nodePf: number | null
}
export type Pipeline9NetworkedHighDensityNodeOutput =
  | { status: "solved"; solutionStage: "ordinary"; routes: HighDensityIntraNodeRoute[] }
  | { status: "solved"; solutionStage: "regional-fallback"; ordinaryFailure: string; routes: HighDensityIntraNodeRoute[] }
  | { status: "failed"; solutionStage: "ordinary"; error: string }
  | { status: "failed"; solutionStage: "regional-fallback"; ordinaryFailure: string; error: string }
export type Pipeline9NetworkedSolveRequest = { autorouterVersion: string; cacheVersion?: string; input: Pipeline9NetworkedHighDensityNodeInput }
export type Pipeline9NetworkedSolveBatchItem = { requestId: string; input: Pipeline9NetworkedHighDensityNodeInput }
export type Pipeline9NetworkedSolveBatchRequest = { autorouterVersion: string; cacheVersion?: string; items: Pipeline9NetworkedSolveBatchItem[] }
export type Pipeline9NetworkedSolveResponse =
  | ({ ok: true; autorouterVersion: string; cacheVersion?: string; source: Pipeline9NetworkedCacheSource } & Pipeline9NetworkedHighDensityNodeOutput)
  | { ok: false; autorouterVersion?: string; cacheVersion?: string; message: string }
export type Pipeline9NetworkedSolveBatchCacheMiss = {
  requestId: string; ok: false; autorouterVersion: string; cacheVersion?: string; code: "CACHE_MISS"; message: string
}
export type Pipeline9NetworkedSolveBatchResult = ({ requestId: string } & Pipeline9NetworkedSolveResponse) | Pipeline9NetworkedSolveBatchCacheMiss
