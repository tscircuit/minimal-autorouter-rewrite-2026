import {BaseSolver} from "../solvers/BaseSolver"
import {CopperMap} from "../routing/CopperMap"
import type {RoutingProblem, RoutingTask} from "../routing/types"
import type {SimpleRouteConnection, SimplifiedPcbTrace, SingleLayerConnectionPoint} from "../types"
import {ConnectivityIndex} from "./ConnectivityIndex"

/** Explicit terminal transitions are reserved before other copper is routed. */
export class TerminalViaSolver extends BaseSolver {
  readonly routes: SimplifiedPcbTrace[] = []
  private readonly requests: {connection: SimpleRouteConnection; point: SingleLayerConnectionPoint}[] = []
  private readonly copper: CopperMap
  private index = 0

  constructor(readonly problem: RoutingProblem, readonly connectivity: ConnectivityIndex) {
    super()
    this.copper = new CopperMap(problem)
    const unique = new Set<string>()
    for (const connection of problem.srj.connections) for (const point of connection.pointsToConnect) {
      if (!("layer" in point) || !point.terminalVia) continue
      const key = JSON.stringify([connectivity.getNetConnectedToId(connection.name), point.x, point.y,
        point.layer, point.terminalVia.toLayer, point.terminalVia.viaDiameter ?? problem.viaDiameter])
      if (unique.has(key)) continue
      unique.add(key)
      this.requests.push({connection, point})
    }
    this.MAX_ITERATIONS = this.requests.length + 2
  }

  override _step(): void {
    const request = this.requests[this.index++]
    if (!request) { this.solved = true; return }
    const {connection, point} = request
    const hint = point.terminalVia!
    const diameter = hint.viaDiameter ?? this.problem.viaDiameter
    if (!this.copper.layers.includes(hint.toLayer) || hint.toLayer === point.layer ||
      !Number.isFinite(diameter) || diameter <= this.problem.viaHoleDiameter) {
      throw new Error(`Invalid terminal via for ${connection.name} at (${point.x}, ${point.y})`)
    }
    const netName = this.connectivity.getNetConnectedToId(connection.name)
    const names = this.connectivity.getIdsConnectedToNet(netName)
    const task: RoutingTask = {id: `terminal_via_${this.index}`, connectionName: connection.name,
      netName, connectedNames: names, start: point, end: point, traceWidth: this.problem.srj.minTraceWidth}
    for (let z = 0; z < this.copper.layers.length; z++) {
      if (!this.copper.clear(point, point, z, diameter / 2, task, true)) {
        this.failed = true
        this.error = `Requested terminal via for ${connection.name} at (${point.x}, ${point.y}) violates copper clearance`
        return
      }
    }
    const trace: SimplifiedPcbTrace = {type: "pcb_trace", pcb_trace_id: `minimal_terminal_via_${this.index}`,
      connection_name: connection.name, connectsTo: names, route: [
        {route_type: "wire", x: point.x, y: point.y, layer: point.layer,
          width: connection.nominalTraceWidth ?? this.problem.srj.minTraceWidth, start_pcb_port_id: point.pcb_port_id},
        {route_type: "via", x: point.x, y: point.y, from_layer: point.layer, to_layer: hint.toLayer,
          via_diameter: diameter, via_hole_diameter: this.problem.viaHoleDiameter},
        {route_type: "wire", x: point.x, y: point.y, layer: hint.toLayer,
          width: connection.nominalTraceWidth ?? this.problem.srj.minTraceWidth},
      ]}
    this.routes.push(trace)
    this.copper.addTrace(trace, names)
    this.progress = this.index / this.requests.length
  }

  getOutput(): SimplifiedPcbTrace[] { return this.routes }
  override getConstructorParams(): unknown[] { return [this.problem, this.connectivity] }
}
