import { HighDensityRoutingStage } from "../HighDensityRoutingStage"
import type { RoutingProblem } from "../routing/types"
import { NetworkRoutingSolver, type NetworkRoutingOptions } from "./NetworkRoutingSolver"

/** The network public stage has the same HD route shape as the local stage. */
export class Pipeline9NetworkedHighDensitySolver extends HighDensityRoutingStage {
  declare protected readonly engine: NetworkRoutingSolver
  constructor(problem: RoutingProblem, readonly options: NetworkRoutingOptions = {}) {
    super(problem, new NetworkRoutingSolver(problem, options))
  }
  override getSolverName(): string { return "Pipeline9NetworkedHighDensitySolver" }
  override getConstructorParams(): [RoutingProblem, NetworkRoutingOptions] { return [this.problem, this.options] }
  async waitForAllRemoteRequests(): Promise<void> {
    await this.engine.waitForAllRemoteRequests()
    this.syncState()
  }
  get requestTimeoutMs(): number { return this.engine.requestTimeoutMs }
}

export { DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS } from "./NetworkRoutingSolver"
export { DEFAULT_HD_CACHE2_SERVER_URL } from "./types"
