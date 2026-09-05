import {
  Pipeline9, Pipeline9_Networked, AutoroutingPipelineSolver9_PreloadedTraceGraph,
  AutoroutingPipelineSolver9_Networked, type SimpleRouteJson, type SimplifiedPcbTrace,
  type HighDensityRoute, type HighDensityIntraNodeRouteWithJumpers, type Jumper,
} from "../../lib/index"
import type {Jumper as SrjJumper} from "../../lib/types/srj-types"

// An independently declared consumer model retains the original rect-only contract.
interface ExternalRectSrj {
  layerCount: number
  minTraceWidth: number
  bounds: {minX: number; maxX: number; minY: number; maxY: number}
  obstacles: Array<{type: "rect"; center: {x: number; y: number}; width: number; height: number;
    layers: string[]; connectedTo: string[]}>
  connections: Array<{name: string; pointsToConnect: Array<{x: number; y: number; layer: string}>}>
  traces?: SimplifiedPcbTrace[]
}
type WireOnlyTrace = Omit<SimplifiedPcbTrace, "route"> & {
  route: Array<Extract<SimplifiedPcbTrace["route"][number], {route_type: "wire"}>>
}
type NarrowTraceInput = Omit<ExternalRectSrj, "traces"> & {
  traces: WireOnlyTrace[]
  applicationMetadata: {revision: "A"}
}

// This function is deliberately never executed; tsc checks consumer assignments.
export function publicReturnTypes(input: ExternalRectSrj, narrow: NarrowTraceInput): void {
  const local = new Pipeline9(input), networked = new Pipeline9_Networked(input)
  const originalLocal: ExternalRectSrj = local.originalSrj
  const originalNetworked: ExternalRectSrj = networked.originalSrj
  const liveLocal: ExternalRectSrj = local.srj
  const liveNetworked: ExternalRectSrj = networked.srj
  const localParameters: ExternalRectSrj = local.getConstructorParams()[0]
  const networkParameters: ExternalRectSrj = networked.getConstructorParams()[0]
  const localOutput: ExternalRectSrj = local.getOutputSimpleRouteJson()
  const networkOutput: ExternalRectSrj = networked.getOutputSimpleRouteJson()
  const localPairs: ExternalRectSrj | undefined = local.srjWithPointPairs
  const networkPairs: ExternalRectSrj | undefined = networked.srjWithPointPairs
  const localEscape: ExternalRectSrj | undefined = local.srjWithEscapeViaLocations
  const networkEscape: ExternalRectSrj | undefined = networked.srjWithEscapeViaLocations
  const rect: "rect" = local.getOutputSimpleRouteJson().obstacles[0]!.type
  const commonLocal: Pipeline9 = local
  const commonNetworked: Pipeline9_Networked = networked
  const canonicalLocal: AutoroutingPipelineSolver9_PreloadedTraceGraph = local
  const canonicalNetworked: AutoroutingPipelineSolver9_Networked = networked

  const specialized = new Pipeline9(narrow), specializedNetwork = new Pipeline9_Networked(narrow)
  const narrowOriginal: WireOnlyTrace[] = specialized.originalSrj.traces
  const narrowParameters: WireOnlyTrace[] = specialized.getConstructorParams()[0].traces
  const output = specialized.getOutputSimpleRouteJson()
  const revision: "A" = output.applicationMetadata.revision
  const viaTrace: SimplifiedPcbTrace = {type: "pcb_trace", pcb_trace_id: "new", connection_name: "signal", route: [
    {route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1},
    {route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "bottom"},
    {route_type: "wire", x: 0, y: 0, layer: "bottom", width: 0.1},
  ]}
  output.traces.push(viaTrace)
  specializedNetwork.getOutputSimpleRouteJson().traces.push(viaTrace)
  specialized.srjWithEscapeViaLocations?.traces.push(viaTrace)
  // @ts-expect-error New routes must not inherit a preloaded wire-only restriction.
  const incorrectlyNarrowOutput: WireOnlyTrace[] = output.traces

  const jumper: Jumper = {route_type: "jumper", start: {x: 0, y: 0}, end: {x: 1, y: 0}, footprint: "0603"}
  const route: HighDensityRoute = {connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{x: 0, y: 0, z: 0}, {x: 1, y: 0, z: 0}], vias: [], jumpers: [jumper]}
  const jumpers: Jumper[] | undefined = local._getOutputHdRoutes()[0]?.jumpers
  const optionalJumpers: Jumper[] | undefined = route.jumpers
  const jumperRoute: HighDensityIntraNodeRouteWithJumpers = {connectionName: "signal", traceThickness: 0.1,
    route: route.route, jumpers: [jumper]}
  const boardComponent: SrjJumper = {jumper_footprint: "0603", center: {x: 0, y: 0}, orientation: "horizontal",
    width: 1, height: 0.5, pads: []}
  // @ts-expect-error The package-root Jumper is the HD route component, not an SRJ placement.
  const wrongJumper: Jumper = boardComponent

  // Wider valid callers continue to retain the supported oval input type.
  const withOval: SimpleRouteJson = {...input, obstacles: [{type: "oval", center: {x: 0, y: 0}, width: 1, height: 1,
    layers: ["top"], connectedTo: []}]}
  const ovalOutput: SimpleRouteJson = new Pipeline9(withOval).getOutputSimpleRouteJson()
  void [originalLocal, originalNetworked, liveLocal, liveNetworked, localParameters, networkParameters, localOutput,
    networkOutput, localPairs, networkPairs, localEscape, networkEscape, rect, commonLocal, commonNetworked,
    canonicalLocal, canonicalNetworked, narrowOriginal, narrowParameters, revision, incorrectlyNarrowOutput,
    jumpers, optionalJumpers, jumperRoute, wrongJumper, ovalOutput]
}
