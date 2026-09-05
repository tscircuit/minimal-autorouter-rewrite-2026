import {BaseSolver} from "../solvers/BaseSolver"
import type {SimpleRouteJson, SimplifiedPcbTrace} from "../types"

/** Output identity is assigned once, after geometry is settled. */
export class AssembleTracesSolver extends BaseSolver {
  readonly routes: SimplifiedPcbTrace[] = []
  private occupiedIds: Set<string>
  private index = 0

  constructor(readonly srj: SimpleRouteJson, readonly candidates: SimplifiedPcbTrace[]) {
    super()
    this.occupiedIds = new Set((srj.traces ?? []).map((trace) => trace.pcb_trace_id))
    this.MAX_ITERATIONS = candidates.length + 2
  }

  override _step(): void {
    const candidate = this.candidates[this.index++]
    if (!candidate) { this.solved = true; return }
    const trace = structuredClone(candidate)
    let id = trace.pcb_trace_id, suffix = 1
    while (this.occupiedIds.has(id)) id = `${trace.pcb_trace_id}_${suffix++}`
    trace.pcb_trace_id = id
    this.occupiedIds.add(id)
    this.routes.push(trace)
    this.progress = this.index / Math.max(1, this.candidates.length)
  }

  getOutput(): SimplifiedPcbTrace[] { return this.routes }
  override getConstructorParams(): unknown[] { return [this.srj, this.candidates] }
}
