import { AutoroutingPipelineSolver9_PreloadedTraceGraph, type AutoroutingPipelineSolverOptions } from "./Pipeline9"
import { Pipeline9NetworkedHighDensitySolver } from "./network/Pipeline9NetworkedHighDensitySolver"
import { DEFAULT_HD_CACHE2_SERVER_URL } from "./network/types"
import type { SimpleRouteJson } from "./types"
import type { BaseSolver } from "./solvers/BaseSolver"

export type AutoroutingPipelineSolver9NetworkedOptions = Omit<AutoroutingPipelineSolverOptions, "effort"> & {
  effort?: 1; hdCache2ServerUrl?: string; hdCache2CacheVersion?: string
}

export class AutoroutingPipelineSolver9_Networked<T extends SimpleRouteJson = SimpleRouteJson> extends AutoroutingPipelineSolver9_PreloadedTraceGraph<T> {
  declare highDensityRouteSolver?: Pipeline9NetworkedHighDensitySolver
  readonly hdCache2ServerUrl: string
  readonly hdCache2CacheVersion?: string
  constructor(srj: T, options: AutoroutingPipelineSolver9NetworkedOptions = {}) {
    super(srj, options)
    if (this.effort !== 1) throw new Error(`AutoroutingPipelineSolver9_Networked is only available at effort=1, received ${this.effort}`)
    this.hdCache2ServerUrl = options.hdCache2ServerUrl ?? DEFAULT_HD_CACHE2_SERVER_URL
    this.hdCache2CacheVersion = options.hdCache2CacheVersion
    this.pipelineDef = this.pipelineDef.map(stage => stage.solverName === "highDensityRouteSolver" ? {
      ...stage, solverClass: Pipeline9NetworkedHighDensitySolver, getConstructorParams: pipeline => [pipeline.getRoutingProblem(), {
        hdCache2ServerUrl: this.hdCache2ServerUrl, hdCache2CacheVersion: this.hdCache2CacheVersion,
      }],
    } : stage)
  }
  override getSolverName(): string { return "AutoroutingPipelineSolver9_Networked" }
  override solve(): void { throw new Error("AutoroutingPipelineSolver9_Networked requires async execution. Use solveAsync() or stepAsync().") }
  override solveUntilPhase(_phase: string): void { throw new Error("AutoroutingPipelineSolver9_Networked requires solveUntilPhaseAsync().") }
  async stepAsync(): Promise<void> {
    if (this.solved || this.failed) return
    this.step()
    let current: BaseSolver | null | undefined = this
    let effects = this.pendingEffects ?? []
    while (current) { if (current.pendingEffects?.length) effects = current.pendingEffects; current = current.activeSubSolver }
    if (effects.length) {
      await Promise.race(effects.map(effect => effect.promise.catch(() => undefined)))
      if (!this.solved && !this.failed) this.step()
    }
  }
  async solveAsync(): Promise<void> {
    const start = performance.now()
    try {
      let lastYield = start
      while (!this.solved && !this.failed) {
        await this.stepAsync()
        if (performance.now() - lastYield > 12) {
          await new Promise<void>(resolve => setTimeout(resolve, 0)); lastYield = performance.now()
        }
      }
    } finally { this.timeToSolve = performance.now() - start }
  }
  async solveUntilPhaseAsync(phase: string): Promise<void> {
    const target = this.resolvePhase(phase)
    while (!this.solved && !this.failed && this.getCurrentPhase() !== target) await this.stepAsync()
  }
}
export { AutoroutingPipelineSolver9_Networked as Pipeline9_Networked }
