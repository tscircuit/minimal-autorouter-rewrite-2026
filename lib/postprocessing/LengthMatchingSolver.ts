import { BaseSolver } from "../solvers/BaseSolver"
import { CopperMap } from "../routing/CopperMap"
import type { RoutingProblem, RoutingTask } from "../routing/types"
import type { SimpleRouteConnection, SimplifiedPcbTrace } from "../types"
import { convertSrjToGraphicsObject } from "../utils/convertSrjToGraphicsObject"
import { createLengthCandidates, getTraceLength, isLengthCandidateClear, type LengthCandidate } from "./lengthGeometry"
import { CoupledPairSolver } from "./CoupledPairSolver"

interface LengthConstraint {
  label: string
  members: string[]
  tolerance: number
}
interface Adjustment {
  name: string
  traceIndex: number
  target: number
}

function connectionAliases(connection: SimpleRouteConnection): string[] {
  return [connection.name, connection.rootConnectionName, connection.netConnectionName, connection.__netConnectionName,
    ...(connection.mergedConnectionNames ?? []), ...(connection.__rootConnectionNames ?? [])].filter((name): name is string => typeof name === "string")
}

/** Adds measured conductor length while leaving terminals, widths, vias and fixed copper intact. */
export class LengthMatchingSolver extends BaseSolver {
  readonly routes: SimplifiedPcbTrace[]
  private constraints: LengthConstraint[] = []
  private traceByMember = new Map<string, number>()
  private adjustments: Adjustment[] = []
  private adjustmentIndex = 0
  private candidates?: Generator<LengthCandidate>
  private collisionMap?: CopperMap
  private routingTask?: RoutingTask
  private testedCandidates = 0
  readonly coupledPairSolver?: CoupledPairSolver
  private initialized = false

  constructor(readonly problem: RoutingProblem, readonly inputRoutes: SimplifiedPcbTrace[]) {
    super()
    this.routes = structuredClone(inputRoutes)
    this.MAX_ITERATIONS = 1_000_000
    for (const bus of problem.srj.buses ?? []) if (bus.maxLengthSkew !== undefined) {
      this.constraints.push({ label: `bus ${bus.busId}`, members: [...new Set(bus.connectionNames)], tolerance: bus.maxLengthSkew })
    }
    for (const pair of problem.srj.differentialPairs ?? []) {
      this.constraints.push({ label: `differential pair ${pair.connectionNames.join(" / ")}`, members: [...pair.connectionNames], tolerance: pair.lengthTolerance })
    }
    if (problem.srj.differentialPairs?.some(pair => pair.traceGap !== undefined || pair.maxUncoupledLength !== undefined)) this.coupledPairSolver = new CoupledPairSolver(problem, this.routes)
    else { this.initializeAdjustments(); this.initialized = true }
  }

  override getConstructorParams(): [RoutingProblem, SimplifiedPcbTrace[]] { return [this.problem, this.inputRoutes] }
  getOutput(): SimplifiedPcbTrace[] { return this.routes }
  override visualize(): any { return convertSrjToGraphicsObject({ ...this.problem.srj, traces: [...this.problem.fixedTraces, ...this.routes] }) }

  private initializeAdjustments(): void {
    const targets = new Map<number, number>()
    for (const constraint of this.constraints) {
      if (!Number.isFinite(constraint.tolerance) || constraint.tolerance < 0 || constraint.members.length < 2) {
        throw new Error(`Invalid length constraint for ${constraint.label}`)
      }
      for (const name of constraint.members) {
        if (this.traceByMember.has(name)) continue
        const connection = this.problem.srj.connections.find((candidate) => candidate.name === name)
        if (!connection) throw new Error(`Length constraint references unknown connection ${name}`)
        const aliases = connectionAliases(connection)
        const exact = this.routes.flatMap((trace, index) => trace.connection_name === name ? [index] : [])
        const matches = exact.length ? exact : this.routes.flatMap((trace, index) =>
          aliases.includes(trace.connection_name) || trace.connectsTo?.some((alias) => aliases.includes(alias)) ? [index] : [])
        if (matches.length !== 1) {
          this.failed = true
          this.error = `Length matching connection ${name} needs exactly one new routed path; found ${matches.length}`
          return
        }
        const traceIndex = matches[0]!
        const trace = this.routes[traceIndex]!
        if (trace.route.some((point) => point.route_type === "jumper" || point.route_type === "through_obstacle")) {
          this.failed = true
          this.error = `Length matching connection ${name} cannot measure jumper or through-obstacle conductor length`
          return
        }
        this.traceByMember.set(name, traceIndex)
        targets.set(traceIndex, getTraceLength(trace))
      }
      const routeIndices = constraint.members.map((name) => this.traceByMember.get(name))
      if (new Set(routeIndices).size !== constraint.members.length) {
        throw new Error(`Length constraint ${constraint.label} refers to the same physical path more than once`)
      }
    }
    // Propagate lower length bounds through overlapping groups. No trace is
    // shortened, and a half-tolerance reserve keeps final rounding inside bounds.
    for (let pass = 0; pass < targets.size; pass++) {
      let changed = false
      for (const constraint of this.constraints) {
        const target = Math.max(...constraint.members.map((name) => targets.get(this.traceByMember.get(name)!)!)) - constraint.tolerance / 2
        for (const name of constraint.members) if (targets.get(this.traceByMember.get(name)!)! < target - 1e-9) {
          targets.set(this.traceByMember.get(name)!, target)
          changed = true
        }
      }
      if (!changed) break
    }
    this.adjustments = [...targets].flatMap(([traceIndex, target]) => {
      const name = [...this.traceByMember].find(([, index]) => index === traceIndex)![0]
      return target > getTraceLength(this.routes[traceIndex]!) + 1e-7 ? [{ name, traceIndex, target }] : []
    }).sort((a, b) => (b.target - getTraceLength(this.routes[b.traceIndex]!)) - (a.target - getTraceLength(this.routes[a.traceIndex]!)))
    this.stats = { constraints: this.constraints.length, tracesToAdjust: this.adjustments.length, candidatesTested: 0 }
  }

  private beginAdjustment(adjustment: Adjustment): void {
    const trace = this.routes[adjustment.traceIndex]!
    const wires = trace.route.filter((point) => point.route_type === "wire")
    if (wires.length < 2) throw new Error(`Length matching ${adjustment.name} requires at least two wire points`)
    const originalTask = this.problem.tasks.find((task) => task.connectionName === trace.connection_name || task.connectedNames.includes(adjustment.name))
    this.routingTask = originalTask ?? {
      id: `length:${trace.pcb_trace_id}`, connectionName: trace.connection_name, netName: trace.connection_name,
      connectedNames: [trace.connection_name, ...(trace.connectsTo ?? [])], start: wires[0]!, end: wires[wires.length - 1]!,
      traceWidth: Math.max(...wires.map((point) => point.width)),
    }
    this.collisionMap = new CopperMap({ ...this.problem,
      fixedTraces: [...this.problem.fixedTraces, ...this.routes.filter((_, index) => index !== adjustment.traceIndex)] })
    this.candidates = createLengthCandidates(trace, adjustment.target - getTraceLength(trace), this.problem.obstacleMargin, this.coupledPairSolver?.escapeSegments.get(adjustment.traceIndex))
  }

  override _step(): void {
    if (!this.initialized) {
      const coupled = this.coupledPairSolver!
      if (!coupled.solved && !coupled.failed) coupled.step()
      if (coupled.failed) { this.failed = true; this.error = coupled.error; return }
      if (!coupled.solved) return
      this.routes.splice(0, this.routes.length, ...coupled.routes)
      this.initializeAdjustments()
      this.initialized = true
      if (this.failed) return
    }
    const adjustment = this.adjustments[this.adjustmentIndex]
    if (!adjustment) {
      for (const constraint of this.constraints) {
        const lengths = constraint.members.map((name) => getTraceLength(this.routes[this.traceByMember.get(name)!]!))
        const skew = Math.max(...lengths) - Math.min(...lengths)
        if (skew > constraint.tolerance + 1e-6) {
          this.failed = true
          this.error = `${constraint.label} retains ${skew.toFixed(6)} mm skew, above ${constraint.tolerance} mm`
          return
        }
      }
      this.stats.lengths = Object.fromEntries([...this.traceByMember].map(([name, index]) => [name, getTraceLength(this.routes[index]!)]))
      this.solved = true
      return
    }
    if (!this.candidates) this.beginAdjustment(adjustment)
    const next = this.candidates!.next()
    if (next.done) {
      const missing = adjustment.target - getTraceLength(this.routes[adjustment.traceIndex]!)
      this.failed = true
      this.error = `Could not add ${missing.toFixed(6)} mm to ${adjustment.name}: no tested meander fits the board, pads, and existing copper at the routed width`
      return
    }
    this.testedCandidates++
    this.stats.candidatesTested = this.testedCandidates
    if (!isLengthCandidateClear(this.problem, this.routes, adjustment.traceIndex, next.value, this.routingTask!, this.collisionMap!)) return
    const trace = this.routes[adjustment.traceIndex]!
    trace.route.splice(next.value.segmentIndex, 2, ...next.value.points)
    if (Math.abs(getTraceLength(trace) - adjustment.target) > 1e-5) throw new Error(`Length adjustment for ${adjustment.name} did not reach its measured target`)
    this.adjustmentIndex++
    this.candidates = undefined
    this.collisionMap = undefined
    this.progress = this.adjustmentIndex / Math.max(1, this.adjustments.length)
  }
}
