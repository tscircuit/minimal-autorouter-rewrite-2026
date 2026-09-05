import {BaseSolver} from "./solvers/BaseSolver"
import {PrepareBoardSolver} from "./preparation/PrepareBoardSolver"
import {RoutingSolver} from "./routing/RoutingSolver"
import {AssembleTracesSolver} from "./output/AssembleTracesSolver"
import {ConnectivityIndex} from "./preparation/ConnectivityIndex"
import type {SimpleRouteJson, SimplifiedPcbTrace} from "./types"
import type {RoutingProblem} from "./routing/types"
import type {CacheProvider} from "./cache/types"
import {getGlobalInMemoryCache} from "./cache/setupGlobalCaches"
import {convertSrjToGraphicsObject, type TraceColorMode} from "./utils/convertSrjToGraphicsObject"

export interface AutoroutingPipelineSolverOptions {
  effort?: number
  capacityDepth?: number
  targetMinCapacity?: number
  cacheProvider?: CacheProvider | null
  maxNodeDimension?: number
  maxNodeRatio?: number
  minNodeArea?: number
  visualizationTraceColorMode?: TraceColorMode
  powerTraceExpansion?: Record<string, unknown>
}
export type RoutingStage = BaseSolver & {routes: SimplifiedPcbTrace[]; waitForAllRemoteRequests?: () => Promise<void>}
export interface PipelineStep {
  solverName: string
  solverClass: new (...args: any[]) => BaseSolver
  getConstructorParams: (pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph) => any[]
  onSolved?: (pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph) => void
}

/** The compatibility shell delegates each real responsibility to one solver. */
export class AutoroutingPipelineSolver9_PreloadedTraceGraph extends BaseSolver {
  readonly opts: AutoroutingPipelineSolverOptions
  readonly originalSrj: SimpleRouteJson
  srj: SimpleRouteJson
  srjWithPointPairs?: SimpleRouteJson
  readonly effort: number
  readonly viaDiameter: number
  readonly viaHoleDiameter: number
  readonly minTraceWidth: number
  readonly maxNodeDimension: number
  readonly maxNodeRatio: number
  readonly minNodeArea: number
  readonly visualizationTraceColorMode: TraceColorMode
  readonly cacheProvider: CacheProvider | null
  colorMap: Record<string, string> = {}
  connMap = new ConnectivityIndex()
  currentPipelineStepIndex = 0
  startTimeOfPhase: Record<string, number> = {}
  endTimeOfPhase: Record<string, number> = {}
  timeSpentOnPhase: Record<string, number> = {}
  override activeSubSolver: BaseSolver | null = null
  preprocessSimpleRouteJsonSolver?: PrepareBoardSolver
  netToPointPairsSolver?: PrepareBoardSolver
  highDensityRouteSolver?: RoutingStage
  traceSimplificationSolver?: AssembleTracesSolver
  powerTraceExpansionSolver?: AssembleTracesSolver

  pipelineDef: PipelineStep[] = [
    {solverName: "preprocessSimpleRouteJsonSolver", solverClass: PrepareBoardSolver,
      getConstructorParams: (pipeline) => [pipeline.originalSrj, {effort: pipeline.effort,
        viaDiameter: pipeline.viaDiameter, viaHoleDiameter: pipeline.viaHoleDiameter}],
      onSolved: (pipeline) => {
        const preparation = pipeline.preprocessSimpleRouteJsonSolver!
        pipeline.srj = preparation.srj
        pipeline.srjWithPointPairs = preparation.srj
        pipeline.connMap = preparation.connMap
        pipeline.netToPointPairsSolver = preparation
      }},
    {solverName: "highDensityRouteSolver", solverClass: RoutingSolver,
      getConstructorParams: (pipeline) => [pipeline.getRoutingProblem()]},
    {solverName: "traceSimplificationSolver", solverClass: AssembleTracesSolver,
      getConstructorParams: (pipeline) => [pipeline.srj, pipeline.highDensityRouteSolver!.routes],
      onSolved: (pipeline) => { pipeline.powerTraceExpansionSolver = pipeline.traceSimplificationSolver }},
  ]

  constructor(input: SimpleRouteJson, options: AutoroutingPipelineSolverOptions = {}) {
    super()
    this.originalSrj = structuredClone(input)
    this.srj = this.originalSrj
    this.opts = {...options}
    this.effort = options.effort ?? 1
    if (!Number.isFinite(this.effort) || this.effort <= 0) throw new Error("effort must be positive and finite")
    this.MAX_ITERATIONS = Math.ceil(100_000_000 * this.effort)
    this.minTraceWidth = input.minTraceWidth
    const finite = (...values: (number | undefined)[]): number | undefined => values.find((value) => value !== undefined && Number.isFinite(value))
    const hole = finite(input.min_via_hole_diameter, input.minViaHoleDiameter)
    this.viaDiameter = Math.max(finite(input.min_via_pad_diameter, input.minViaPadDiameter, input.minViaDiameter) ?? 0.3, hole ?? 0)
    this.viaHoleDiameter = hole ?? this.viaDiameter / 2
    this.maxNodeDimension = options.maxNodeDimension ?? 15
    this.maxNodeRatio = options.maxNodeRatio ?? 6
    this.minNodeArea = options.minNodeArea ?? 0.01
    this.visualizationTraceColorMode = options.visualizationTraceColorMode ?? "layer"
    this.cacheProvider = options.cacheProvider === undefined ? getGlobalInMemoryCache() : options.cacheProvider
    const extent = Math.max(input.bounds.maxX - input.bounds.minX, input.bounds.maxY - input.bounds.minY)
    this.opts.capacityDepth ??= Math.max(0, Math.ceil(Math.log2(extent / (options.targetMinCapacity ?? 0.5))))
    for (const [index, connection] of input.connections.entries()) this.colorMap[connection.name] = `hsl(${index * 137.508 % 360},65%,45%)`
  }

  override getSolverName(): string { return "AutoroutingPipelineSolver9_PreloadedTraceGraph" }
  override getConstructorParams(): [SimpleRouteJson, AutoroutingPipelineSolverOptions] { return [this.srj, this.opts] }
  getRoutingProblem(): RoutingProblem {
    if (!this.preprocessSimpleRouteJsonSolver?.solved) throw new Error("Routing requires completed board preparation")
    return this.preprocessSimpleRouteJsonSolver.getProblem()
  }
  computeProgress(): number { return this.solved ? 1 : (this.currentPipelineStepIndex + (this.activeSubSolver?.progress ?? 0)) / this.pipelineDef.length }
  getCurrentPhase(): string { return this.pipelineDef[this.currentPipelineStepIndex]?.solverName ?? "none" }

  override _step(): void {
    const stage = this.pipelineDef[this.currentPipelineStepIndex]
    if (!stage) { this.solved = true; this.progress = 1; return }
    if (!this.activeSubSolver) {
      const solver = new stage.solverClass(...stage.getConstructorParams(this))
      this.activeSubSolver = solver
      ;(this as unknown as Record<string, unknown>)[stage.solverName] = solver
      this.startTimeOfPhase[stage.solverName] = performance.now()
      this.timeSpentOnPhase[stage.solverName] = 0
    } else {
      const solver = this.activeSubSolver
      solver.step()
      this.timeSpentOnPhase[stage.solverName] = performance.now() - this.startTimeOfPhase[stage.solverName]!
      if (solver.failed) {
        this.failed = true
        this.error = solver.error
        this.failedSubSolvers = [solver]
        this.activeSubSolver = null
      } else if (solver.solved) {
        this.endTimeOfPhase[stage.solverName] = performance.now()
        stage.onSolved?.(this)
        this.activeSubSolver = null
        this.currentPipelineStepIndex++
      }
    }
    this.progress = this.computeProgress()
  }

  solveUntilPhase(phase: string): void {
    if (!this.pipelineDef.some((stage) => stage.solverName === phase) && phase !== "none") throw new Error(`Unknown pipeline phase: ${phase}`)
    while (!this.solved && !this.failed && this.getCurrentPhase() !== phase) this.step()
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTrace[] {
    if (!this.solved || !this.traceSimplificationSolver) throw new Error("Cannot get output before solving is complete")
    return this.traceSimplificationSolver.routes
  }
  getOutputSimpleRouteJson(): SimpleRouteJson {
    return {...this.originalSrj, traces: [...this.getUpdatedPreloadedTraces(), ...this.getOutputSimplifiedPcbTraces()]}
  }
  getUpdatedPreloadedTraces(): SimplifiedPcbTrace[] { return this.originalSrj.traces ?? [] }
  getMutatedPreloadedTraces(): SimplifiedPcbTrace[] { return [] }
  getNewTracesBeforePowerExpansion(): SimplifiedPcbTrace[] {
    if (!this.highDensityRouteSolver) throw new Error("Routing has not started")
    return this.highDensityRouteSolver.routes
  }
  override visualize(): any {
    return convertSrjToGraphicsObject({...this.srj, traces: [...this.getUpdatedPreloadedTraces(),
      ...(this.solved ? this.getOutputSimplifiedPcbTraces() : this.highDensityRouteSolver?.routes ?? [])]},
      {traceColorMode: this.visualizationTraceColorMode, colorMap: this.colorMap})
  }
  override preview(): any { return this.visualize() }
  visualizeStage(stage: {visualize(): any}): any { return stage.visualize() }
  visualizeFinalOutput(): any { return convertSrjToGraphicsObject(this.getOutputSimpleRouteJson(), {traceColorMode: this.visualizationTraceColorMode, colorMap: this.colorMap}) }
}

export {AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9, AutoroutingPipelineSolver9_PreloadedTraceGraph as AutoroutingPipelineSolver9}
