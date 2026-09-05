import { BaseSolver } from "./solvers/BaseSolver"
import { RoutingSolver } from "./routing/RoutingSolver"
import type { RoutingProblem } from "./routing/types"
import type { SimplifiedPcbTrace } from "./types"
import type { HighDensityRoute } from "./types/high-density-types"
import { toHighDensityRoutes } from "./output/toHighDensityRoutes"
import { convertSrjToGraphicsObject } from "./utils/convertSrjToGraphicsObject"

export type RoutingEngine = BaseSolver & { routes: SimplifiedPcbTrace[] }

/** Exposes numeric-layer HD routes while the routing engine owns simplified copper. */
export class HighDensityRoutingStage extends BaseSolver {
  protected readonly engine: RoutingEngine

  constructor(readonly problem: RoutingProblem, engine: RoutingEngine = new RoutingSolver(problem)) {
    super()
    this.engine = engine
    this.activeSubSolver = engine
    this.MAX_ITERATIONS = engine.MAX_ITERATIONS
    this.syncState()
  }

  override getSolverName(): string { return "Pipeline9HighDensitySolver" }
  override getConstructorParams(): [RoutingProblem, ...unknown[]] { return [this.problem] }

  /** These are public route snapshots, not mutable aliases of the engine's trace objects. */
  get routes(): HighDensityRoute[] {
    return toHighDensityRoutes(this.getSimplifiedTraces(), this.problem.srj.layerCount, this.problem.viaDiameter)
  }

  getSimplifiedTraces(): SimplifiedPcbTrace[] { return this.engine.routes }

  protected syncState(): void {
    this.solved = this.engine.solved
    this.failed = this.engine.failed
    this.error = this.engine.error
    this.progress = this.engine.progress
    this.stats = this.engine.stats
    this.pendingEffects = this.engine.pendingEffects
    this.cacheHit = this.engine.cacheHit
    this.cacheKey = this.engine.cacheKey
    if (this.engine.failed) this.failedSubSolvers = [this.engine]
  }

  override _step(): void {
    try { this.engine.step() }
    finally { this.syncState() }
  }

  override tryFinalAcceptance(): void {
    this.engine.tryFinalAcceptance()
    this.syncState()
  }

  override visualize(): ReturnType<typeof convertSrjToGraphicsObject> {
    return convertSrjToGraphicsObject({ ...this.problem.srj,
      traces: [...this.problem.fixedTraces, ...this.getSimplifiedTraces()] })
  }
  override preview(): ReturnType<typeof convertSrjToGraphicsObject> { return this.visualize() }
}
