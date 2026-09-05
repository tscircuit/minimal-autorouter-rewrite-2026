export interface PendingEffect {
  name: string
  promise: Promise<unknown>
}

/** A solver performs bounded work at each step and owns its terminal state. */
export class BaseSolver {
  MAX_ITERATIONS = 1000
  solved = false
  failed = false
  iterations = 0
  progress = 0
  error: string | null = null
  activeSubSolver?: BaseSolver | null
  failedSubSolvers?: BaseSolver[]
  pendingEffects?: PendingEffect[]
  timeToSolve?: number
  stats: Record<string, any> = {}
  cacheHit?: boolean
  cacheKey?: string
  cacheToSolveSpaceTransform?: unknown

  getSolverName(): string { return this.constructor.name }

  step(): void {
    if (this.solved || this.failed) return
    this.iterations += 1
    try {
      this._step()
      if (!this.solved && !this.failed && this.iterations > this.MAX_ITERATIONS) {
        this.tryFinalAcceptance()
        if (!this.solved) {
          this.failed = true
          this.error = `${this.getSolverName()} ran out of iterations (MAX_ITERATIONS=${this.MAX_ITERATIONS})`
        }
      }
      if (this.solved) this.progress = 1
    } catch (error) {
      this.failed = true
      this.error = `${this.getSolverName()} error: ${String(error)}`
      throw error
    }
  }

  _step(): void {}
  tryFinalAcceptance(): void {}
  getConstructorParams(): unknown[] { throw new Error("getConstructorParams not implemented") }

  solve(): void {
    const start = performance.now()
    try {
      while (!this.solved && !this.failed) this.step()
    } finally {
      this.timeToSolve = performance.now() - start
    }
  }

  visualize(): any { return {lines: [], points: [], rects: [], circles: []} }
  preview(): any { return this.visualize() }
}
