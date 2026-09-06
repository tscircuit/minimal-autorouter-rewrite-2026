import { BaseSolver } from "../solvers/BaseSolver"
import type { SimplifiedPcbTrace } from "../types"
import { CopperMap } from "./CopperMap"
import { RouteSearch, type RoutePoint } from "./RouteSearch"
import type { RoutingProblem, RoutingTask } from "./types"

/** Continue the best partial board while moving a bounded set of blocking routes. */
export class CompletionRepairSolver extends BaseSolver {
  routes: SimplifiedPcbTrace[] = []
  unroutedTaskIds: string[] = []
  readonly maximumAttempts: number
  private readonly initialRoutes: SimplifiedPcbTrace[]
  private readonly tasks = new Map<string, RoutingTask>()
  private readonly initialMap: CopperMap
  private initialIndex = 0
  private initialized = false
  private queue: RoutingTask[] = []
  private bestRoutes: SimplifiedPcbTrace[] = []
  private task?: RoutingTask
  private fullMap?: CopperMap
  private search?: RouteSearch
  private mode: "hard" | "soft" = "hard"
  private pitchIndex = 0
  private candidate?: RouteSearch
  private candidateIndex = 0
  private conflicts: SimplifiedPcbTrace[] = []
  private readonly placedAt = new Map<string, number>()
  private placementSerial = 0
  private attempts = 0
  private repairs = 0
  private displaced = 0

  constructor(readonly problem: RoutingProblem, initialRoutes: SimplifiedPcbTrace[]) {
    super()
    if (!Number.isFinite(problem.effort) || problem.effort <= 0)
      throw new Error("Completion repair effort must be positive and finite")
    this.MAX_ITERATIONS = 10_000_000
    this.maximumAttempts = Math.max(32, Math.min(2000,
      Math.ceil(problem.tasks.length * 2 * Math.max(1, Math.min(problem.effort, 8)))))
    for (const task of problem.tasks) {
      if (this.tasks.has(task.id)) throw new Error(`Duplicate routing task ${task.id}`)
      this.tasks.set(task.id, task)
    }
    this.initialRoutes = structuredClone(initialRoutes)
    this.initialMap = new CopperMap(problem)
    this.updateStats()
  }

  override getConstructorParams(): [RoutingProblem, SimplifiedPcbTrace[]] {
    return [this.problem, this.initialRoutes]
  }

  override _step(): void {
    if (!this.initialized) { this.initializeOneRoute(); return }
    if (this.candidate) { this.inspectCandidate(); return }
    if (!this.task) {
      while (this.queue.length && this.hasRoute(this.queue[0]!)) this.queue.shift()
      if (!this.queue.length) { this.finish(); return }
      if (this.attempts >= this.maximumAttempts) { this.finish(); return }
      this.task = this.queue.shift()!
      this.attempts++
      this.fullMap = new CopperMap({ ...this.problem,
        fixedTraces: [...this.problem.fixedTraces, ...this.routes] })
      this.mode = "hard"
      this.pitchIndex = 0
    }
    if (!this.search) {
      const width = Math.max(0.05, Math.min(0.25, this.problem.srj.minTraceWidth))
      const pitch = width * [0.7, 0.4][this.pitchIndex]!
      const protectedRoutes = this.routes.filter((trace) =>
        this.placementSerial - (this.placedAt.get(trace.pcb_trace_id) ?? -Infinity) < 4)
      const map = this.mode === "hard" ? this.fullMap! : new CopperMap({
        ...this.problem, fixedTraces: [...this.problem.fixedTraces, ...protectedRoutes],
      })
      this.search = new RouteSearch(map, this.task, pitch,
        this.mode === "soft" ? this.fullMap : undefined)
      this.activeSubSolver = this.search
      this.updateStats()
      return
    }
    if (!this.search.solved && !this.search.failed) this.search.step()
    if (this.search.solved) {
      if (this.mode === "hard") this.commit(this.search, [])
      else {
        this.candidate = this.search
        this.candidateIndex = 0
        this.conflicts = []
      }
    } else if (this.search.failed) this.nextSearch()
    this.updateStats()
  }

  private initializeOneRoute(): void {
    const trace = this.initialRoutes[this.initialIndex++]
    if (trace) {
      const task = this.tasks.get(trace.pcb_trace_id.replace(/^minimal_/, ""))
      if (!task || trace.pcb_trace_id !== `minimal_${task.id}`)
        throw new Error(`Retained route ${trace.pcb_trace_id} has no routing task`)
      if (this.hasRoute(task)) throw new Error(`Duplicate retained route ${trace.pcb_trace_id}`)
      // A changed clearance rule must not allow invalid retained copper to survive repair.
      if (this.validRetainedRoute(trace, task)) {
        this.routes.push(trace)
        this.initialMap.addTrace(trace, [task.netName, ...task.connectedNames])
        this.bestRoutes = [...this.routes]
      }
      this.updateStats()
      return
    }
    this.bestRoutes = [...this.routes]
    this.queue = this.problem.tasks.filter((task) => !this.hasRoute(task))
    this.initialized = true
    this.updateStats()
  }

  private validRetainedRoute(trace: SimplifiedPcbTrace, task: RoutingTask): boolean {
    let previous: { point: { x: number; y: number }; layer: string; width: number } | undefined
    const first = trace.route[0], last = trace.route.at(-1)
    const layers = (point: RoutingTask["start"]) => "layers" in point ? point.layers : [point.layer]
    const aliases = new Set([task.netName, task.connectionName, ...task.connectedNames])
    if (trace.connectsTo !== undefined && (!Array.isArray(trace.connectsTo) ||
      trace.connectsTo.some((name) => !aliases.has(name)))) return false
    if (trace.connection_name !== task.connectionName || !first || !last ||
      first.route_type !== "wire" || last.route_type !== "wire" ||
      Math.hypot(first.x - task.start.x, first.y - task.start.y) > 1e-7 ||
      Math.hypot(last.x - task.end.x, last.y - task.end.y) > 1e-7 ||
      !layers(task.start).includes(first.layer) || !layers(task.end).includes(last.layer)) return false
    for (const entry of trace.route) {
      if (entry.route_type === "wire") {
        const z = this.initialMap.layers.indexOf(entry.layer)
        if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y) ||
          !Number.isFinite(entry.width) || entry.width < task.traceWidth || z < 0 ||
          (task.allowedLayers && !task.allowedLayers.includes(entry.layer)) ||
          (previous && previous.layer !== entry.layer) ||
          !this.initialMap.clear(previous?.point ?? entry, entry, z,
            Math.max(previous?.width ?? entry.width, entry.width) / 2, task)) return false
        previous = { point: entry, layer: entry.layer, width: entry.width }
      } else if (entry.route_type === "via") {
        const z = this.initialMap.layers.indexOf(entry.from_layer)
        if (!Number.isFinite(entry.x) || !Number.isFinite(entry.y) ||
          !previous || previous.layer !== entry.from_layer || z < 0 ||
          !this.initialMap.layers.includes(entry.to_layer) || entry.from_layer === entry.to_layer ||
          entry.via_diameter !== this.problem.viaDiameter ||
          entry.via_hole_diameter !== this.problem.viaHoleDiameter ||
          !this.initialMap.clear(previous.point, entry, z, previous.width / 2, task) ||
          !this.initialMap.viaClear(entry, task)) return false
        previous = { point: entry, layer: entry.to_layer, width: previous.width }
      } else return false
    }
    return true
  }

  private pathBlocked(points: RoutePoint[], map: CopperMap): boolean {
    return points.some((point, index) => {
      const next = points[index + 1]
      return next && (point.z === next.z
        ? !map.clear(point, next, point.z, this.task!.traceWidth / 2, this.task!)
        : !map.viaClear(point, this.task!))
    })
  }

  private inspectCandidate(): void {
    // Spread collision attribution over solver steps; movable copper is never ignored on commit.
    for (let budget = 0; budget < 8 && this.candidateIndex < this.routes.length; budget++) {
      const trace = this.routes[this.candidateIndex++]!
      const map = new CopperMap({ ...this.problem,
        srj: { ...this.problem.srj, obstacles: [] }, fixedTraces: [trace] })
      if (this.pathBlocked(this.candidate!.points, map)) this.conflicts.push(trace)
      if (this.conflicts.length > 8) {
        this.candidate = undefined
        this.conflicts = []
        this.nextSearch()
        return
      }
    }
    if (this.candidateIndex === this.routes.length) this.commit(this.candidate!, this.conflicts)
    this.updateStats()
  }

  private nextSearch(): void {
    this.search = undefined
    this.activeSubSolver = null
    if (++this.pitchIndex < 2) return
    if (this.mode === "hard") { this.mode = "soft"; this.pitchIndex = 0; return }
    this.queue.push(this.task!)
    this.placementSerial++
    this.task = undefined
  }

  private commit(search: RouteSearch, conflicts: SimplifiedPcbTrace[]): void {
    const removed = new Set(conflicts.map((trace) => trace.pcb_trace_id))
    this.routes = this.routes.filter((trace) => !removed.has(trace.pcb_trace_id))
    const route: SimplifiedPcbTrace["route"] = []
    for (const [index, point] of search.points.entries()) {
      const previous = search.points[index - 1], layer = this.initialMap.layers[point.z]!
      if (previous && previous.z !== point.z) route.push({ route_type: "via",
        x: point.x, y: point.y, from_layer: this.initialMap.layers[previous.z]!, to_layer: layer,
        via_diameter: this.problem.viaDiameter, via_hole_diameter: this.problem.viaHoleDiameter })
      route.push({ route_type: "wire", x: point.x, y: point.y, layer, width: this.task!.traceWidth,
        ...(index === 0 && this.task!.start.pcb_port_id ? { start_pcb_port_id: this.task!.start.pcb_port_id } : {}),
        ...(index === search.points.length - 1 && this.task!.end.pcb_port_id ? { end_pcb_port_id: this.task!.end.pcb_port_id } : {}) })
    }
    const trace: SimplifiedPcbTrace = { type: "pcb_trace", pcb_trace_id: `minimal_${this.task!.id}`,
      connection_name: this.task!.connectionName, connectsTo: [this.task!.netName, ...this.task!.connectedNames], route }
    this.routes.push(trace)
    this.placedAt.set(trace.pcb_trace_id, ++this.placementSerial)
    for (const removedTrace of conflicts) {
      const owner = this.tasks.get(removedTrace.pcb_trace_id.replace(/^minimal_/, ""))!
      if (!this.queue.includes(owner)) this.queue.push(owner)
    }
    if (conflicts.length) { this.repairs++; this.displaced += conflicts.length }
    if (this.routes.length > this.bestRoutes.length) this.bestRoutes = [...this.routes]
    this.task = undefined
    this.search = undefined
    this.candidate = undefined
    this.conflicts = []
    this.activeSubSolver = null
  }

  private hasRoute(task: RoutingTask): boolean {
    return this.routes.some((trace) => trace.pcb_trace_id === `minimal_${task.id}`)
  }

  private finish(): void {
    this.routes = this.bestRoutes
    this.unroutedTaskIds = this.problem.tasks.filter((task) => !this.hasRoute(task)).map((task) => task.id)
    this.solved = this.unroutedTaskIds.length === 0
    this.failed = !this.solved
    if (this.failed) this.error = `Could not route ${this.unroutedTaskIds.length} of ${this.problem.tasks.length} connections after bounded completion repair`
    this.activeSubSolver = null
    this.updateStats()
  }

  override tryFinalAcceptance(): void { this.finish() }

  private updateStats(): void {
    this.progress = this.solved ? 1 : Math.min(0.99, this.attempts / this.maximumAttempts)
    this.stats = { routed: this.routes.length, total: this.problem.tasks.length,
      retained: this.initialRoutes.length, bestRouted: this.bestRoutes.length,
      attempts: this.attempts, maximumAttempts: this.maximumAttempts,
      repairs: this.repairs, displacedRoutes: this.displaced,
      mode: !this.initialized ? "validate-retained" : this.mode }
  }
}
