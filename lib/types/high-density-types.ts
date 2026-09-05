import type { CircuitJsonMetadata, Point } from "./srj-types"

export type PortPoint = Point & {
  z: number; connectionName: string; rootConnectionName?: string
  portPointId?: string; pcb_port_id?: string; prevPortPointId?: string; nextPortPointId?: string
}
export type NodeWithPortPoints = {
  capacityMeshNodeId: string; center: Point; width: number; height: number
  portPoints: PortPoint[]; availableZ?: number[]; portPointsInPairs?: [PortPoint, PortPoint][]
}
export type HighDensityIntraNodeRoute = {
  connectionName: string; rootConnectionName?: string; startPcbPortId?: string; endPcbPortId?: string
  traceThickness: number; viaDiameter: number
  route: Array<Point & { z: number; traceThickness?: number; pcb_port_id?: string
    insideJumperPad?: boolean; toNextSegmentType?: "through_obstacle"; toNextSegmentCircuitJsonMetadata?: CircuitJsonMetadata }>
  vias: Point[]
  regionId?: string
}
export type HighDensityRoute = HighDensityIntraNodeRoute
