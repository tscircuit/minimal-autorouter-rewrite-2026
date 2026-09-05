import type {ConnectionPoint, SimpleRouteJson, SimplifiedPcbTrace} from "../types"

export interface RoutingTask {
  id: string
  connectionName: string
  netName: string
  connectedNames: string[]
  start: ConnectionPoint
  end: ConnectionPoint
  traceWidth: number
  allowedLayers?: string[]
}

export interface RoutingProblem {
  srj: SimpleRouteJson
  tasks: RoutingTask[]
  fixedTraces: SimplifiedPcbTrace[]
  viaDiameter: number
  viaHoleDiameter: number
  obstacleMargin: number
  effort: number
}
