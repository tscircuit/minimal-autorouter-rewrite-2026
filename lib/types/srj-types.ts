export type Point = {x: number; y: number}
export type CircuitJsonMetadata = {
  pcb_smtpad_id?: string; pcb_plated_hole_id?: string; pcb_port_id?: string
  pcb_via_id?: string; source_component_name?: string; source_port_name?: string
}
export type TerminalViaHint = {toLayer: string; viaDiameter?: number}
type TerminalIdentity = Point & {pointId?: string; pcb_port_id?: string}
export type SingleLayerConnectionPoint = TerminalIdentity & {layer: string; terminalVia?: TerminalViaHint}
export type MultiLayerConnectionPoint = TerminalIdentity & {layers: string[]; busId?: string}
export type ConnectionPoint = SingleLayerConnectionPoint | MultiLayerConnectionPoint

export interface Obstacle {
  type: "rect" | "oval"
  center: Point
  width: number
  height: number
  layers: string[]
  connectedTo: string[]
  obstacleId?: string
  componentId?: string
  circuitJsonMetadata?: CircuitJsonMetadata
  zLayers?: number[]
  __zLayers?: number[]
  ccwRotationDegrees?: number
  isCopperPour?: boolean
  netIsAssignable?: boolean
  offBoardConnectsTo?: string[]
}
export interface SimpleRouteConnection {
  name: string
  pointsToConnect: ConnectionPoint[]
  rootConnectionName?: string
  mergedConnectionNames?: string[]
  __rootConnectionNames?: string[]
  isOffBoard?: boolean
  netConnectionName?: string
  __netConnectionName?: string
  nominalTraceWidth?: number
  externallyConnectedPointIds?: string[][]
}
export type Wire = Point & {
  route_type: "wire"; layer: string; width: number
  start_pcb_port_id?: string; end_pcb_port_id?: string
}
export type Via = Point & {
  route_type: "via"; from_layer: string; to_layer: string
  via_diameter?: number; via_hole_diameter?: number
}
export type RouteSegment = Wire | Via | {
  route_type: "jumper"; start: Point; end: Point
  footprint: "0603" | "1206" | "1206x4_pair"; layer: string
} | {
  route_type: "through_obstacle"; start: Point; end: Point
  from_layer: string; to_layer: string; width: number; circuitJsonMetadata?: CircuitJsonMetadata
}
export interface SimplifiedPcbTrace {
  type: "pcb_trace"
  pcb_trace_id: string
  connection_name: string
  route: RouteSegment[]
  connectsTo?: string[]
  __replaces_pcb_trace_id?: string
}
export type SimplifiedPcbTraces = SimplifiedPcbTrace[]
export type Jumper = {
  jumper_footprint: "0603" | "1206x4"; center: Point
  orientation: "horizontal" | "vertical"; width: number; height: number; pads: Obstacle[]
}
export type SimpleRouteBus = {
  busId: string; connectionNames: string[]; maxLengthSkew?: number
  traceWidth?: number; allowedLayers?: string[]
}
export type DifferentialPair = {
  connectionNames: [string, string]; lengthTolerance: number
  traceGap?: number; maxUncoupledLength?: number
}
export interface SimpleRouteJson {
  layerCount: number
  minTraceWidth: number
  bounds: {minX: number; maxX: number; minY: number; maxY: number}
  obstacles: Obstacle[]
  connections: SimpleRouteConnection[]
  traces?: SimplifiedPcbTraces
  nominalTraceWidth?: number
  minViaDiameter?: number
  minViaHoleDiameter?: number
  minViaPadDiameter?: number
  min_via_hole_diameter?: number
  min_via_pad_diameter?: number
  defaultObstacleMargin?: number
  minTraceToPadEdgeClearance?: number
  minBoardEdgeClearance?: number
  minViaEdgeToPadEdgeClearance?: number
  allowViaInPad?: boolean
  outline?: Point[]
  buses?: SimpleRouteBus[]
  differentialPairs?: DifferentialPair[]
  jumpers?: Jumper[]
  allowJumpers?: boolean
  availableJumperTypes?: ("0603" | "1206x4")[]
}
export type TraceId = string
export type NetId = string
export type BusId = string
export type PointId = string
