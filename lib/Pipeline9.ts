import {BaseSolver} from "./solvers/BaseSolver"
import {PrepareBoardSolver, getBoardLayers} from "./preparation/PrepareBoardSolver"
import {HighDensityRoutingStage} from "./HighDensityRoutingStage"
import {AssembleTracesSolver} from "./output/AssembleTracesSolver"
import {ConnectivityIndex, createConnectivityIndex} from "./preparation/ConnectivityIndex"
import type {SimpleRouteJson, SimplifiedPcbTrace} from "./types"
import type {RoutingProblem} from "./routing/types"
import type {CacheProvider} from "./cache/types"
import {getGlobalInMemoryCache} from "./cache/setupGlobalCaches"
import {convertSrjToGraphicsObject, type TraceColorMode} from "./utils/convertSrjToGraphicsObject"
import {toHighDensityRoutes} from "./output/toHighDensityRoutes"
import type {HighDensityRoute} from "./types/high-density-types"
import {TerminalViaSolver} from "./preparation/TerminalViaSolver"
import {LengthMatchingSolver} from "./postprocessing/LengthMatchingSolver"
import {legacyPhaseTargets} from "./legacyPhaseTargets"

export interface PowerTraceExpansionOptions {
  onlyConnectionNames?: readonly string[]
  allowNewVias?: boolean
  powerTraceToPadClearance?: number
}

export interface AutoroutingPipelineSolverOptions {
  effort?: number
  capacityDepth?: number
  targetMinCapacity?: number
  cacheProvider?: CacheProvider | null
  maxNodeDimension?: number
  maxNodeRatio?: number
  minNodeArea?: number
  visualizationTraceColorMode?: TraceColorMode
  powerTraceExpansion?: PowerTraceExpansionOptions
}
export type RoutingStage = HighDensityRoutingStage
export type Pipeline9OutputSimpleRouteJson<T extends SimpleRouteJson> =
  Omit<T, "traces"> & {traces: SimplifiedPcbTrace[]}
export interface PipelineStep<T extends SimpleRouteJson = SimpleRouteJson> {
  solverName: string
  solverClass: new (...args: any[]) => BaseSolver
  getConstructorParams(pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph<T>): any[]
  onSolved?(pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph<T>): void
}

/** The compatibility shell delegates each real responsibility to one solver. */
export class AutoroutingPipelineSolver9_PreloadedTraceGraph<T extends SimpleRouteJson = SimpleRouteJson> extends BaseSolver {
  readonly opts: AutoroutingPipelineSolverOptions
  readonly originalSrj: T
  srj: T
  srjWithEscapeViaLocations?: Pipeline9OutputSimpleRouteJson<T>
  srjWithPointPairs?: T
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
  connMap: ConnectivityIndex
  currentPipelineStepIndex = 0
  startTimeOfPhase: Record<string, number> = {}
  endTimeOfPhase: Record<string, number> = {}
  timeSpentOnPhase: Record<string, number> = {}
  override activeSubSolver: BaseSolver | null = null
  preprocessSimpleRouteJsonSolver?: PrepareBoardSolver
  netToPointPairsSolver?: PrepareBoardSolver
  escapeViaLocationSolver?: TerminalViaSolver
  highDensityRouteSolver?: RoutingStage
  lengthMatchingPostProcessingSolver?: LengthMatchingSolver
  traceSimplificationSolver?: AssembleTracesSolver
  powerTraceExpansionSolver?: AssembleTracesSolver

  pipelineDef: PipelineStep<T>[] = [
    {solverName: "preprocessSimpleRouteJsonSolver", solverClass: PrepareBoardSolver,
      getConstructorParams: (pipeline) => [pipeline.originalSrj, {effort: pipeline.effort,
        viaDiameter: pipeline.viaDiameter, viaHoleDiameter: pipeline.viaHoleDiameter}],
      onSolved: (pipeline) => {
        const preparation = pipeline.preprocessSimpleRouteJsonSolver!
        pipeline.srj = preparation.srj as T
        pipeline.srjWithPointPairs = preparation.srj as T
        pipeline.connMap = preparation.connMap
        pipeline.netToPointPairsSolver = preparation
      }},
    {solverName: "escapeViaLocationSolver", solverClass: TerminalViaSolver,
      getConstructorParams: (pipeline) => [pipeline.preprocessSimpleRouteJsonSolver!.getProblem(), pipeline.connMap],
      onSolved: (pipeline) => {
        pipeline.srjWithEscapeViaLocations = {...pipeline.srj,
          traces: [...(pipeline.srj.traces ?? []), ...pipeline.escapeViaLocationSolver!.routes]}
      }},
    {solverName: "highDensityRouteSolver", solverClass: HighDensityRoutingStage,
      getConstructorParams: (pipeline) => [pipeline.getRoutingProblem()]},
    {solverName: "lengthMatchingPostProcessingSolver", solverClass: LengthMatchingSolver,
      getConstructorParams: (pipeline) => [pipeline.getRoutingProblem(), pipeline.highDensityRouteSolver!.getSimplifiedTraces()]},
    {solverName: "traceSimplificationSolver", solverClass: AssembleTracesSolver,
      getConstructorParams: (pipeline) => [pipeline.srj, [...pipeline.escapeViaLocationSolver!.routes, ...pipeline.lengthMatchingPostProcessingSolver!.routes]],
      onSolved: (pipeline) => { pipeline.powerTraceExpansionSolver = pipeline.traceSimplificationSolver }},
  ]

  constructor(input: T, options: AutoroutingPipelineSolverOptions = {}) {
    super()
    this.originalSrj = structuredClone(input)
    const layers = getBoardLayers(input.layerCount)
    for (const obstacle of this.originalSrj.obstacles) {
      obstacle.layers = obstacle.layers.filter((layer) => layers.includes(layer))
      if (obstacle.zLayers) obstacle.zLayers = obstacle.layers.map((layer) => layers.indexOf(layer))
      if (obstacle.__zLayers) obstacle.__zLayers = obstacle.layers.map((layer) => layers.indexOf(layer))
    }
    this.srj = this.originalSrj
    this.connMap = createConnectivityIndex(this.originalSrj)
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
  override getConstructorParams(): [T, AutoroutingPipelineSolverOptions] { return [this.srj, this.opts] }
  getRoutingProblem(): RoutingProblem {
    if (!this.preprocessSimpleRouteJsonSolver?.solved) throw new Error("Routing requires completed board preparation")
    const problem = this.preprocessSimpleRouteJsonSolver.getProblem()
    return {...problem, fixedTraces: [...problem.fixedTraces, ...(this.escapeViaLocationSolver?.routes ?? [])]}
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

  resolvePhase(phase: string): string {
    if (phase === "none" || this.pipelineDef.some((stage) => stage.solverName === phase)) return phase
    const target = legacyPhaseTargets[phase]
    if (target && this.pipelineDef.some((stage) => stage.solverName === target)) return target
    throw new Error(`Unknown pipeline phase: ${phase}`)
  }
  solveUntilPhase(phase: string): void {
    const target = this.resolvePhase(phase)
    while (!this.solved && !this.failed && this.getCurrentPhase() !== target) this.step()
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTrace[] {
    if (!this.solved || !this.traceSimplificationSolver) throw new Error("Cannot get output before solving is complete")
    return this.traceSimplificationSolver.routes
  }
  getOutputSimpleRouteJson(): Pipeline9OutputSimpleRouteJson<T> {
    return {...this.originalSrj, traces: [...this.getUpdatedPreloadedTraces(), ...this.getOutputSimplifiedPcbTraces()]}
  }
  getUpdatedPreloadedTraces(): SimplifiedPcbTrace[] { return this.originalSrj.traces ?? [] }
  getMutatedPreloadedTraces(): SimplifiedPcbTrace[] { return [] }
  getNewTracesBeforePowerExpansion(): SimplifiedPcbTrace[] {
    if (!this.highDensityRouteSolver) throw new Error("Routing has not started")
    const routed = this.lengthMatchingPostProcessingSolver?.solved
      ? this.lengthMatchingPostProcessingSolver.routes : this.highDensityRouteSolver.getSimplifiedTraces()
    return [...(this.escapeViaLocationSolver?.routes ?? []), ...routed]
  }
  _getOutputHdRoutes(): HighDensityRoute[] {
    return toHighDensityRoutes(this.solved ? this.getOutputSimplifiedPcbTraces() : this.getNewTracesBeforePowerExpansion(),
      this.srj.layerCount, this.viaDiameter)
  }
  override visualize(): any {
    return convertSrjToGraphicsObject({...this.srj, traces: [...this.getUpdatedPreloadedTraces(),
      ...(this.solved ? this.getOutputSimplifiedPcbTraces() : [
        ...(this.escapeViaLocationSolver?.routes ?? []), ...(this.highDensityRouteSolver?.getSimplifiedTraces() ?? [])])]},
      {traceColorMode: this.visualizationTraceColorMode, colorMap: this.colorMap})
  }
  override preview(): any { return this.visualize() }
  visualizeStage(stage: {visualize(): any}): any { return stage.visualize() }
  visualizeFinalOutput(): any { return convertSrjToGraphicsObject(this.getOutputSimpleRouteJson(), {traceColorMode: this.visualizationTraceColorMode, colorMap: this.colorMap}) }
}

export {AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9, AutoroutingPipelineSolver9_PreloadedTraceGraph as AutoroutingPipelineSolver9}
