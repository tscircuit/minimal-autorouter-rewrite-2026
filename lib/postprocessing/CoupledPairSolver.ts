import { BaseSolver } from "../solvers/BaseSolver"
import { CopperMap } from "../routing/CopperMap"
import type { RoutingProblem, RoutingTask } from "../routing/types"
import type { DifferentialPair, SimplifiedPcbTrace, Wire } from "../types"
import { coupledCandidateClear, createCoupledCandidates, type CoupledCandidate } from "./coupledGeometry"

/** Replaces planar pair interiors with two collision-checked offsets of one spine. */
export class CoupledPairSolver extends BaseSolver {
  readonly routes: SimplifiedPcbTrace[]
  readonly escapeSegments = new Map<number, Set<number>>()
  private pairs: DifferentialPair[]
  private pairIndex = 0
  private candidates?: Generator<CoupledCandidate>
  private routeIndices?: [number, number]
  private tasks?: [RoutingTask, RoutingTask]
  private fixed?: SimplifiedPcbTrace[]
  private map?: CopperMap
  private gap = 0

  constructor(readonly problem: RoutingProblem, readonly inputRoutes: SimplifiedPcbTrace[]) {
    super()
    this.routes = structuredClone(inputRoutes)
    this.pairs = (problem.srj.differentialPairs ?? []).filter(pair => pair.traceGap !== undefined || pair.maxUncoupledLength !== undefined)
    this.MAX_ITERATIONS = 1_000_000
    this.stats = { pairs: this.pairs.length, candidatesTested: 0, interiorUncoupledLengthMm: 0 }
  }
  override getConstructorParams(): [RoutingProblem, SimplifiedPcbTrace[]] { return [this.problem, this.inputRoutes] }
  getOutput(): SimplifiedPcbTrace[] { return this.routes }

  private begin(pair: DifferentialPair): void {
    this.gap = pair.traceGap ?? 1
    if (!Number.isFinite(this.gap) || this.gap < 0 || pair.maxUncoupledLength !== undefined && (!Number.isFinite(pair.maxUncoupledLength) || pair.maxUncoupledLength < 0)) throw new Error("Differential pair gap and uncoupled length must be finite and nonnegative")
    const indices = pair.connectionNames.map(name => {
      const connection = this.problem.srj.connections.find(connection => connection.name === name)
      if (!connection) throw new Error(`Coupled pair references unknown connection ${name}`)
      const aliases = [name, connection.rootConnectionName, connection.netConnectionName, connection.__netConnectionName,
        ...(connection.mergedConnectionNames ?? []), ...(connection.__rootConnectionNames ?? [])].filter((alias): alias is string => typeof alias === "string")
      const exact = this.routes.flatMap((trace, index) => trace.connection_name === name ? [index] : [])
      const matches = exact.length ? exact : this.routes.flatMap((trace, index) => aliases.includes(trace.connection_name) || trace.connectsTo?.some(alias => aliases.includes(alias)) ? [index] : [])
      if (matches.length !== 1) throw new Error(`Coupled connection ${name} requires exactly one routed path`)
      const route = this.routes[matches[0]!]!.route
      if (route.length < 2 || route.some(point => point.route_type !== "wire" || point.layer !== (route[0] as Wire).layer || point.width !== (route[0] as Wire).width)) throw new Error(`Coupled connection ${name} requires one planar path of uniform width`)
      if (this.escapeSegments.has(matches[0]!)) throw new Error(`Connection ${name} belongs to overlapping geometry-coupled pairs`)
      return matches[0]!
    }) as [number, number]
    if (indices[0] === indices[1]) throw new Error("A differential pair must have two distinct physical paths")
    const traces = indices.map(index => this.routes[index]!) as [SimplifiedPcbTrace, SimplifiedPcbTrace]
    if ((traces[0].route[0] as Wire).layer !== (traces[1].route[0] as Wire).layer) throw new Error("Geometry-coupled traces require a common layer")
    this.routeIndices = indices
    this.tasks = traces.map(trace => this.problem.tasks.find(task => task.connectionName === trace.connection_name) ?? {
      id: `coupled:${trace.pcb_trace_id}`, connectionName: trace.connection_name, netName: trace.connection_name,
      connectedNames: [trace.connection_name, ...(trace.connectsTo ?? [])], start: trace.route[0] as Wire, end: trace.route.at(-1) as Wire,
      traceWidth: (trace.route[0] as Wire).width,
    }) as [RoutingTask, RoutingTask]
    this.fixed = [...this.problem.fixedTraces, ...this.routes.filter((_, index) => !indices.includes(index))]
    this.map = new CopperMap({ ...this.problem, fixedTraces: this.fixed })
    this.candidates = createCoupledCandidates(traces[0], traces[1], this.gap, this.problem)
  }

  override _step(): void {
    const pair = this.pairs[this.pairIndex]
    if (!pair) { this.solved = true; return }
    if (!this.candidates) this.begin(pair)
    const next = this.candidates!.next()
    if (next.done) {
      this.failed = true
      this.error = `Could not couple ${pair.connectionNames.join(" / ")} at ${this.gap} mm edge gap: no tested shared spine clears the board, pads, and fixed copper`
      return
    }
    this.stats.candidatesTested++
    if (!coupledCandidateClear(next.value, this.tasks!, this.problem, this.fixed!, this.map!, this.gap)) return
    for (let member = 0; member < 2; member++) {
      this.routes[this.routeIndices![member]!] = next.value.traces[member]!
      this.escapeSegments.set(this.routeIndices![member]!, next.value.escapeSegments[member]!)
    }
    this.pairIndex++
    this.candidates = undefined
    this.progress = this.pairIndex / this.pairs.length
  }
}
