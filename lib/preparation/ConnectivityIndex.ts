import type {SimpleRouteJson} from "../types"

/** Named electrical equivalence is distinct from already-routed copper. */
export class ConnectivityIndex {
  private parent = new Map<string, string>()

  getNetConnectedToId(id: string): string {
    const parent = this.parent.get(id)
    if (parent === undefined) {
      this.parent.set(id, id)
      return id
    }
    if (parent === id) return id
    const root = this.getNetConnectedToId(parent)
    this.parent.set(id, root)
    return root
  }

  addConnections(groups: string[][]): void {
    for (const group of groups) {
      if (group.length === 0) continue
      const root = this.getNetConnectedToId(group[0]!)
      for (const id of group.slice(1)) this.parent.set(this.getNetConnectedToId(id), root)
    }
  }

  areIdsConnected(left: string, right: string): boolean {
    return this.getNetConnectedToId(left) === this.getNetConnectedToId(right)
  }

  getIdsConnectedToNet(id: string): string[] {
    const root = this.getNetConnectedToId(id)
    return [...this.parent.keys()].filter((key) => this.getNetConnectedToId(key) === root)
  }

  toObject(): Record<string, string[]> {
    const groups: Record<string, string[]> = {}
    for (const id of this.parent.keys()) {
      const root = this.getNetConnectedToId(id)
      ;(groups[root] ??= []).push(id)
    }
    return groups
  }
}

/** Build the same electrical view for construction-time inspection and preparation. */
export function createConnectivityIndex(srj: SimpleRouteJson): ConnectivityIndex {
  const result = new ConnectivityIndex()
  for (const obstacle of srj.obstacles) result.addConnections([[
    ...(obstacle.obstacleId ? [obstacle.obstacleId] : []), ...obstacle.connectedTo,
    ...(obstacle.offBoardConnectsTo ?? []),
  ]])
  for (const connection of srj.connections) result.addConnections([[
    connection.name, connection.rootConnectionName, connection.netConnectionName,
    connection.__netConnectionName, ...(connection.mergedConnectionNames ?? []),
    ...(connection.__rootConnectionNames ?? []),
    ...connection.pointsToConnect.flatMap(point => [point.pointId, point.pcb_port_id]),
  ].filter((name): name is string => typeof name === "string" && name.length > 0)])
  for (const trace of srj.traces ?? []) result.addConnections([[
    trace.pcb_trace_id, trace.connection_name, ...(trace.connectsTo ?? []),
  ]])
  return result
}
