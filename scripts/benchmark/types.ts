/** A benchmark accepts either implementation through its public solver interface. */
export interface BenchmarkSolver {
  solved: boolean
  failed: boolean
  error?: string | null
  iterations?: number
  progress?: number
  currentPipelineStepIndex?: number
  pipelineDef?: ReadonlyArray<{ solverName: string }>
  srjWithPointPairs?: Record<string, unknown>
  timeSpentOnPhase?: Record<string, number>
  highDensityRouteSolver?: {
    stats?: Record<string, number>
    waitForAllRemoteRequests?: () => Promise<void>
  }
  step(): void
  solveAsync?: () => Promise<void>
  getOutputSimplifiedPcbTraces(): BenchmarkTrace[]
}

export interface BenchmarkTrace {
  pcb_trace_id: string
  connection_name?: string
  route: Array<{
    route_type: string
    x: number
    y: number
    layer?: string
    from_layer?: string
    to_layer?: string
    width?: number
  }>
}

export interface DatasetSample {
  name: string
  file: string
  sha256: string
  layerCount: number
  connectionCount: number
  terminalCount: number
  obstacleCount: number
}

export interface DatasetManifest {
  version: number
  datasets: Array<{
    name: "dataset01" | "dataset-srj18"
    repository: string
    commit: string
    samples: DatasetSample[]
  }>
}

export interface BenchmarkTask {
  dataset: string
  sample: DatasetSample
  samplePath: string
  modulePath: string
  oraclePath: string
  constructorName: string
  solverOptions: Record<string, unknown>
  timeoutMs: number
  traceOutputPath?: string
  cachePass?: "cold" | "hot"
}

export interface BenchmarkResult {
  dataset: string
  sample: string
  sha256: string
  solver: string
  didSolve: boolean
  didTimeout: boolean
  relaxedDrcPassed: boolean
  elapsedTimeMs: number
  drcTimeMs?: number
  drcErrorCount?: number
  drcErrorTypes?: Record<string, number>
  drcErrorExamples?: unknown[]
  traceCount?: number
  viaCount?: number
  traceLengthMm?: number
  iterations?: number
  error?: string
  phase?: string
  phaseTimeMs?: Record<string, number>
  networkStats?: Record<string, number>
}
