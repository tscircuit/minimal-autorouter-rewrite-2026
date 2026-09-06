import type { AnyCircuitElement } from "circuit-json"
import type {
  ConnectionPoint,
  Obstacle,
  Point,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../lib/types"
import {
  getBoardLayers,
  getPointLayers,
} from "../../lib/preparation/PrepareBoardSolver"
import {assertSourceGeometryMatches, type VerifiedSourceGeometry} from "./sourceGeometry"

export interface SrjConversionOptions {
  sourceGeometry?: VerifiedSourceGeometry
}

type Element = Record<string, any>
export interface SrjConversionCoverage {
  sourceObstacleCount: number
  representedObstacleCount: number
  sourceTraceCount: number
  representedTraceCount: number
  routeViaCount: number
  standaloneViaCount: number
  sourceTerminalCount: number
  representedTerminalCount: number
  obstacleElementIds: Record<string, string[]>
  obstacleComponentIds: Record<string, string>
  traceElementIds: Record<string, string[]>
  terminalElementIds: Record<string, string[]>
  verifiedSourceGeometry?: {
    originalSrjSha256: string
    sourceCircuitJson: VerifiedSourceGeometry["sourceCircuitJson"]
    importCorrection?: VerifiedSourceGeometry["importCorrection"]
    nonPlatedHoleCount: number
  }
  limitations: string[]
}
class Aliases {
  readonly parents = new Map<string, string>()
  find(name: string): string {
    const parent = this.parents.get(name)
    if (parent === undefined) {
      this.parents.set(name, name)
      return name
    }
    if (parent === name) return name
    const root = this.find(parent)
    this.parents.set(name, root)
    return root
  }
  join(values: Array<string | undefined>): void {
    const ids = values.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    )
    if (!ids.length) return
    const root = this.find(ids[0]!)
    for (const id of ids.slice(1)) this.parents.set(this.find(id), root)
  }
}
function demand(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`SRJ conversion: ${message}`)
}
const nonemptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0
function optionalId(value: unknown, name: string): void {
  demand(value === undefined || nonemptyString(value), `invalid ${name}`)
}
function optionalIds(value: unknown, name: string): void {
  demand(
    value === undefined ||
      (Array.isArray(value) && value.every((id) => typeof id === "string")),
    `invalid ${name}`,
  )
}
function optionalBoolean(value: unknown, name: string): void {
  demand(value === undefined || typeof value === "boolean", `invalid ${name}`)
}
function metadataIds(value: unknown): void {
  if (value === undefined) return
  demand(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "invalid circuitJsonMetadata",
  )
  const metadata = value as Record<string, unknown>
  for (const key of [
    "pcb_smtpad_id",
    "pcb_plated_hole_id",
    "pcb_port_id",
    "pcb_via_id",
    "source_component_name",
    "source_port_name",
  ])
    optionalId(metadata[key], `circuitJsonMetadata.${key}`)
}
const finitePoint = (point: Point) =>
  point && Number.isFinite(point.x) && Number.isFinite(point.y)
const near = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-8
const obstacleNames = (o: Obstacle) =>
  [
    ...o.connectedTo,
    ...(o.offBoardConnectsTo ?? []),
    ...(o.circuitJsonMetadata?.pcb_port_id
      ? [o.circuitJsonMetadata.pcb_port_id]
      : []),
  ].filter(nonemptyString)
const rotate = (point: Point, angle: number, center: Point): Point => ({
  x: center.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
  y: center.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
})
function rectOutline(
  center: Point,
  width: number,
  height: number,
  degrees: number,
): Point[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) =>
    rotate(
      { x: (x! * width) / 2, y: (y! * height) / 2 },
      (degrees * Math.PI) / 180,
      center,
    ),
  )
}

/** Build only geometry and electrical information present in the SRJ. */
function build(srj: SimpleRouteJson, options: SrjConversionOptions = {}): {
  circuitJson: AnyCircuitElement[]
  coverage: SrjConversionCoverage
} {
  demand(
    srj && Array.isArray(srj.obstacles) && Array.isArray(srj.connections),
    "missing obstacles or connections",
  )
  if(options.sourceGeometry) assertSourceGeometryMatches(srj,options.sourceGeometry)
  const sourceHoles = new Map(options.sourceGeometry?.holes.map(hole=>[hole.obstacleIndex,hole]))
  const layers = getBoardLayers(srj.layerCount)
  demand(
    srj.jumpers === undefined || Array.isArray(srj.jumpers),
    "invalid jumpers",
  )
  demand(
    !srj.jumpers?.length,
    "standalone jumper component geometry is unsupported; geometry was not omitted",
  )
  demand(
    Number.isFinite(srj.minTraceWidth) && srj.minTraceWidth > 0,
    "invalid trace width",
  )
  demand(
    srj.bounds &&
      Object.values(srj.bounds).every(Number.isFinite) &&
      srj.bounds.minX < srj.bounds.maxX &&
      srj.bounds.minY < srj.bounds.maxY,
    "invalid board bounds",
  )
  demand(
    srj.outline === undefined ||
      (srj.outline.length >= 3 && srj.outline.every(finitePoint)),
    "invalid board outline",
  )
  const aliases = new Aliases(),
    elements: Element[] = [],
    usedIds = new Set<string>()
  const coverage: SrjConversionCoverage = {
    sourceObstacleCount: srj.obstacles.length,
    representedObstacleCount: 0,
    sourceTraceCount: srj.traces?.length ?? 0,
    representedTraceCount: 0,
    routeViaCount: 0,
    standaloneViaCount: 0,
    sourceTerminalCount: srj.connections.reduce(
      (n, c) => n + c.pointsToConnect.length,
      0,
    ),
    representedTerminalCount: 0,
    obstacleElementIds: {},
    obstacleComponentIds: {},
    traceElementIds: {},
    terminalElementIds: {},
    limitations: [
      "SRJ has no component bodies, courtyards, schematic geometry, pin specifications, board material, or stack thickness; those cannot be reconstructed or certified.",
      "Noncircular SRJ oval footprints are represented as capsules (Circuit JSON pill/rotated_pill), consistent with PCB oval-pad geometry.",
    ],
  }
  const id = (base: string): string => {
    let result = base,
      suffix = 1
    while (usedIds.has(result)) result = `${base}__${suffix++}`
    usedIds.add(result)
    return result
  }
  if(options.sourceGeometry) {
    coverage.verifiedSourceGeometry = {
      originalSrjSha256:options.sourceGeometry.originalSrjSha256,
      sourceCircuitJson:options.sourceGeometry.sourceCircuitJson,
      ...(options.sourceGeometry.importCorrection ? {importCorrection:options.sourceGeometry.importCorrection} : {}),
      nonPlatedHoleCount:sourceHoles.size,
    }
    coverage.limitations.push(`${sourceHoles.size} non-plated drill holes are restored from hash-verified source geometry; their SRJ routing envelopes are not reclassified as physical keepouts.`)
  }
  const validLayers = (values: string[]) =>
    Array.isArray(values) &&
    values.length > 0 &&
    values.every((layer) => layers.includes(layer))
  for (const connection of srj.connections) {
    demand(
      typeof connection.name === "string" &&
        connection.name &&
        Array.isArray(connection.pointsToConnect),
      "invalid connection",
    )
    optionalBoolean(connection.isOffBoard, "connection.isOffBoard")
    for (const key of [
      "rootConnectionName",
      "netConnectionName",
      "__netConnectionName",
    ] as const)
      optionalId(connection[key], `connection.${key}`)
    for (const key of [
      "mergedConnectionNames",
      "__rootConnectionNames",
    ] as const)
      optionalIds(connection[key], `connection.${key}`)
    if (connection.externallyConnectedPointIds !== undefined) {
      demand(
        Array.isArray(connection.externallyConnectedPointIds),
        "invalid connection.externallyConnectedPointIds",
      )
      for (const group of connection.externallyConnectedPointIds) {
        demand(Array.isArray(group), "invalid externally connected point group")
        optionalIds(group, "externally connected point group")
      }
    }
    for (const point of connection.pointsToConnect) {
      demand(
        finitePoint(point) && validLayers(getPointLayers(point)),
        `invalid terminal in ${connection.name}`,
      )
      optionalId(point.pcb_port_id, "terminal.pcb_port_id")
      optionalId(point.pointId, "terminal.pointId")
    }
    aliases.join([
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pcb_port_id,
        point.pointId,
      ]),
    ])
  }
  for (const obstacle of srj.obstacles) {
    demand(
      (obstacle.type === "rect" || obstacle.type === "oval") &&
        finitePoint(obstacle.center) &&
        Number.isFinite(obstacle.width) &&
        obstacle.width > 0 &&
        Number.isFinite(obstacle.height) &&
        obstacle.height > 0 &&
        validLayers(obstacle.layers) &&
        Array.isArray(obstacle.connectedTo) &&
        obstacle.connectedTo.every((name) => typeof name === "string") &&
        (obstacle.ccwRotationDegrees === undefined ||
          Number.isFinite(obstacle.ccwRotationDegrees)),
      "invalid obstacle geometry, layers or aliases",
    )
    optionalId(obstacle.obstacleId, "obstacle.obstacleId")
    optionalId(obstacle.componentId, "obstacle.componentId")
    optionalIds(obstacle.offBoardConnectsTo, "obstacle.offBoardConnectsTo")
    optionalBoolean(obstacle.isCopperPour, "obstacle.isCopperPour")
    optionalBoolean(obstacle.netIsAssignable, "obstacle.netIsAssignable")
    metadataIds(obstacle.circuitJsonMetadata)
    const names = obstacleNames(obstacle)
    if (names.length) aliases.join([obstacle.obstacleId, ...names])
  }
  const traces = srj.traces ?? []
  demand(Array.isArray(traces), "invalid traces")
  const traceNet = new Map<SimplifiedPcbTrace, string>(),
    traceIds = new Set<string>()
  for (const trace of traces) {
    demand(
      trace?.type === "pcb_trace" &&
        typeof trace.connection_name === "string" &&
        trace.connection_name &&
        typeof trace.pcb_trace_id === "string" &&
        trace.pcb_trace_id &&
        Array.isArray(trace.route) &&
        trace.route.length > 0,
      "invalid trace",
    )
    demand(
      !traceIds.has(trace.pcb_trace_id),
      `duplicate trace ID ${trace.pcb_trace_id}`,
    )
    traceIds.add(trace.pcb_trace_id)
    optionalIds(trace.connectsTo, "trace aliases")
    optionalId(trace.__replaces_pcb_trace_id, "trace.__replaces_pcb_trace_id")
    const labels = [
      trace.connection_name,
      trace.pcb_trace_id,
      ...(trace.connectsTo ?? []),
    ]
    const known = new Set(
      labels
        .filter((name) => aliases.parents.has(name))
        .map((name) => aliases.find(name)),
    )
    demand(
      known.size <= 1,
      `${trace.pcb_trace_id} claims different declared nets`,
    )
    const net =
      (known.values().next().value as string | undefined) ??
      trace.connection_name
    aliases.join([net, trace.connection_name, trace.pcb_trace_id])
    traceNet.set(trace, net)
  }
  type Net = {
    root: string
    netId: string
    traceId: string
    terminals: Set<string>
    ports: Set<string>
    width: number
  }
  const nets = new Map<string, Net>()
  const netFor = (name: string): Net => {
    const root = aliases.find(name)
    let net = nets.get(root)
    if (!net) {
      net = {
        root,
        netId: id(`source_net_srj_${nets.size}`),
        traceId: id(`source_trace_srj_${nets.size}`),
        terminals: new Set(),
        ports: new Set(),
        width: srj.minTraceWidth,
      }
      nets.set(root, net)
    }
    return net
  }
  const board: Element = {
    type: "pcb_board",
    pcb_board_id: id("pcb_board_srj"),
    num_layers: srj.layerCount,
    center: {
      x: (srj.bounds.minX + srj.bounds.maxX) / 2,
      y: (srj.bounds.minY + srj.bounds.maxY) / 2,
    },
    width: srj.bounds.maxX - srj.bounds.minX,
    height: srj.bounds.maxY - srj.bounds.minY,
    ...(srj.outline
      ? {
          outline: srj.outline.map((point) => ({ ...point })),
          shape: "polygon",
        }
      : { shape: "rect" }),
    min_trace_width: srj.minTraceWidth,
  }
  const rules = {
    min_board_edge_clearance: srj.minBoardEdgeClearance,
    min_trace_to_pad_edge_clearance: srj.minTraceToPadEdgeClearance,
    min_via_edge_to_pad_edge_clearance: srj.minViaEdgeToPadEdgeClearance,
    min_via_hole_diameter: srj.min_via_hole_diameter ?? srj.minViaHoleDiameter,
    min_via_pad_diameter:
      srj.min_via_pad_diameter ?? srj.minViaPadDiameter ?? srj.minViaDiameter,
  }
  for (const [key, value] of Object.entries(rules))
    if (value !== undefined) {
      demand(Number.isFinite(value) && value >= 0, `invalid ${key}`)
      board[key] = value
    }
  if (srj.allowViaInPad !== undefined) {
    demand(typeof srj.allowViaInPad === "boolean", "invalid allowViaInPad")
    board.is_via_in_pad_allowed = srj.allowViaInPad
  }
  elements.push(board)
  if (srj.defaultObstacleMargin !== undefined)
    coverage.limitations.push(
      "defaultObstacleMargin is an autorouter search parameter without one equivalent manufacturing rule; unspecified Circuit JSON DRC rules retain checker defaults.",
    )

  type Port = { net: Net; pcb: Element; source: Element; synthetic: boolean }
  const ports = new Map<string, Port>(),
    pointKeys = new Map<string, string>(),
    portAliases = new Map<string, Port[]>()
  const physicalAlias = (name: string, port: Port) => {
    const existing = portAliases.get(name) ?? []
    demand(
      existing.every((member) => member.net === port.net),
      `conflicting declared net for port ${name}`,
    )
    if (!existing.includes(port)) existing.push(port)
    portAliases.set(name, existing)
  }
  const addPort = (
    point: ConnectionPoint,
    net: Net,
    synthetic = false,
  ): Port => {
    const identity =
      point.pcb_port_id ??
      point.pointId ??
      `${net.root}:${point.x},${point.y}:${getPointLayers(point).join(",")}`
    const key = `${identity}:${point.x},${point.y}`
    const existingId = pointKeys.get(key),
      existing = existingId ? ports.get(existingId) : undefined
    if (existing) {
      demand(
        near(existing.pcb as Point, point) && existing.net === net,
        `conflicting position or net for ${key}`,
      )
      existing.pcb.layers = [
        ...new Set([...existing.pcb.layers, ...getPointLayers(point)]),
      ]
      return existing
    }
    const existingSource = portAliases.get(identity)?.[0]
    demand(
      !existingSource || existingSource.net === net,
      `conflicting declared net for port ${identity}`,
    )
    const pcbId = id(point.pcb_port_id ?? `pcb_port_srj_${ports.size}`),
      sourceId =
        existingSource?.source.source_port_id ??
        id(`source_port_srj_${ports.size}`)
    const source = existingSource?.source ?? {
      type: "source_port",
      source_port_id: sourceId,
      name: point.pcb_port_id ?? point.pointId ?? `terminal ${ports.size}`,
    }
    const pcb = {
      type: "pcb_port",
      pcb_port_id: pcbId,
      source_port_id: sourceId,
      x: point.x,
      y: point.y,
      layers: [...getPointLayers(point)],
    }
    const port = { net, pcb, source, synthetic }
    ports.set(pcbId, port)
    pointKeys.set(key, pcbId)
    net.ports.add(sourceId)
    physicalAlias(identity, port)
    physicalAlias(pcbId, port)
    if (!synthetic) {
      ;(coverage.terminalElementIds[identity] ??= []).push(pcbId)
      if (existingSource)
        coverage.limitations.push(
          `${identity}: one declared source-port identity has several physical attachment positions; separate PCB ports retain every coordinate and layer.`,
        )
    }
    return port
  }
  for (const connection of srj.connections) {
    const net = netFor(connection.name)
    const busWidths = (srj.buses ?? [])
      .filter((bus) =>
        bus.connectionNames.some((name) => aliases.find(name) === net.root),
      )
      .flatMap((bus) => (bus.traceWidth === undefined ? [] : [bus.traceWidth]))
    const width =
      connection.nominalTraceWidth ??
      (busWidths.length ? Math.max(...busWidths) : undefined) ??
      srj.nominalTraceWidth ??
      srj.minTraceWidth
    demand(
      Number.isFinite(width) && width > 0,
      `invalid nominal width for ${connection.name}`,
    )
    net.width = Math.max(net.width, width)
    for (const point of connection.pointsToConnect) {
      const port = addPort(point, net)
      if (!connection.isOffBoard) net.terminals.add(port.source.source_port_id)
      coverage.representedTerminalCount++
    }
  }
  const pad = (
    obstacle: Obstacle,
    padId: string,
    layer: string,
    port: Port | undefined,
  ): Element => {
    const rotation = obstacle.ccwRotationDegrees ?? 0
    const shape =
      obstacle.type === "rect"
        ? rotation % 360
          ? "rotated_rect"
          : "rect"
        : obstacle.width === obstacle.height
          ? "circle"
          : rotation % 360
            ? "rotated_pill"
            : "pill"
    return {
      type: "pcb_smtpad",
      pcb_smtpad_id: padId,
      shape,
      x: obstacle.center.x,
      y: obstacle.center.y,
      layer,
      ...(shape === "circle"
        ? { radius: obstacle.width / 2 }
        : { width: obstacle.width, height: obstacle.height }),
      ...(shape === "pill" || shape === "rotated_pill"
        ? { radius: Math.min(obstacle.width, obstacle.height) / 2 }
        : {}),
      ...(shape === "rotated_rect" || shape === "rotated_pill"
        ? { ccw_rotation: rotation }
        : {}),
      ...(port ? { pcb_port_id: port.pcb.pcb_port_id } : {}),
      ...(obstacle.componentId
        ? { pcb_component_id: obstacle.componentId }
        : {}),
    }
  }
  const padPortUses = new Map<Port, number>()
  for (const [index, obstacle] of srj.obstacles.entries()) {
    const sourceId = obstacle.obstacleId ?? `obstacle:${index}`,
      names = obstacleNames(obstacle),
      emitted: string[] = []
    if (obstacle.componentId)
      coverage.obstacleComponentIds[sourceId] = obstacle.componentId
    const sourceHole=sourceHoles.get(index)
    if(sourceHole) {
      const holeId=id(sourceHole.hole.pcb_hole_id)
      elements.push({
        ...sourceHole.hole,
        pcb_hole_id:holeId,
        ...(sourceHole.sourceComponentId
          ? {pcb_component_id:sourceHole.sourceComponentId}
          : {}),
      })
      emitted.push(holeId)
    } else if (
      names.length ||
      obstacle.circuitJsonMetadata?.pcb_smtpad_id ||
      obstacle.circuitJsonMetadata?.pcb_plated_hole_id ||
      obstacle.isCopperPour
    ) {
      const net = names.length ? netFor(names[0]!) : undefined
      const metadataPort = obstacle.circuitJsonMetadata?.pcb_port_id
      // connectedTo contains the complete net, not just this pad's physical port.
      const colocated = net
        ? [...ports.values()].filter(
            (port) =>
              port.net === net &&
              near(port.pcb as Point, obstacle.center) &&
              port.pcb.layers.some((layer: string) =>
                obstacle.layers.includes(layer),
              ),
          )
        : []
      const preferred = metadataPort
        ? portAliases
            .get(metadataPort)
            ?.find((port) => colocated.includes(port))
        : undefined
      // Several source pads may overlap exactly on one net. All physical ports
      // remain present; distribute their pad records across equivalent positions.
      let port =
        preferred && colocated.includes(preferred)
          ? preferred
          : colocated.sort(
              (a, b) => (padPortUses.get(a) ?? 0) - (padPortUses.get(b) ?? 0),
            )[0]
      const explicitPort = metadataPort ?? port?.pcb.pcb_port_id
      if (metadataPort && port) {
        physicalAlias(metadataPort, port)
      }
      if (net && !port && obstacle.layers.length)
        port = addPort(
          {
            x: obstacle.center.x,
            y: obstacle.center.y,
            layers: [...obstacle.layers],
            pcb_port_id: explicitPort,
          },
          net,
          true,
        )
      if (port) padPortUses.set(port, (padPortUses.get(port) ?? 0) + 1)
      if (obstacle.componentId) {
        // A source port may have several physical attachment positions. Preserve
        // its declared component membership at each position without adding a body.
        const associatedPorts = new Set([
          ...(port ? [port] : []),
          ...(metadataPort ? portAliases.get(metadataPort) ?? [] : []),
        ])
        for (const associated of associatedPorts) {
          demand(
            associated.pcb.pcb_component_id === undefined ||
              associated.pcb.pcb_component_id === obstacle.componentId,
            `conflicting component for physical port ${associated.pcb.pcb_port_id}`,
          )
          associated.pcb.pcb_component_id = obstacle.componentId
        }
      }
      if (colocated.length > 1)
        coverage.limitations.push(
          `${sourceId}: several same-net terminals share this exact position/layer; pad provenance uses an equivalent colocated port while preserving every physical terminal.`,
        )
      for (const [layerIndex, layer] of obstacle.layers.entries()) {
        const preferred =
          obstacle.circuitJsonMetadata?.pcb_smtpad_id ??
          obstacle.obstacleId ??
          `pcb_smtpad_srj_${index}`
        const padId = id(
          layerIndex === 0 ? preferred : `${preferred}__${layer}`,
        )
        elements.push(pad(obstacle, padId, layer, port))
        emitted.push(padId)
      }
      if (obstacle.circuitJsonMetadata?.pcb_plated_hole_id)
        coverage.limitations.push(
          `${sourceId}: plated-hole outer copper retained on each declared layer; drill dimensions are absent and were not invented.`,
        )
      if (obstacle.isCopperPour)
        coverage.limitations.push(
          `${sourceId}: declared occupied copper footprint retained; SRJ does not preserve the original pour boundary/thermal details.`,
        )
    } else if (obstacle.layers.length) {
      const common = {
        type: "pcb_keepout",
        layers: [...obstacle.layers],
        description: sourceId,
      }
      const push = (shape: Element) => {
        const keepoutId = id(`pcb_keepout_srj_${index}_${emitted.length}`)
        elements.push({ ...common, ...shape, pcb_keepout_id: keepoutId })
        emitted.push(keepoutId)
      }
      const rotation = obstacle.ccwRotationDegrees ?? 0
      if (obstacle.type === "rect")
        push(
          rotation % 360
            ? {
                shape: "outline",
                outline: rectOutline(
                  obstacle.center,
                  obstacle.width,
                  obstacle.height,
                  rotation,
                ),
                stroke_width: 0,
              }
            : {
                shape: "rect",
                center: { ...obstacle.center },
                width: obstacle.width,
                height: obstacle.height,
              },
        )
      else if (obstacle.width === obstacle.height)
        push({
          shape: "circle",
          center: { ...obstacle.center },
          radius: obstacle.width / 2,
        })
      else {
        const radius = Math.min(obstacle.width, obstacle.height) / 2,
          long = Math.abs(obstacle.width - obstacle.height)
        const angle =
          ((rotation + (obstacle.width >= obstacle.height ? 0 : 90)) *
            Math.PI) /
          180
        push({
          shape: "outline",
          outline: rectOutline(
            obstacle.center,
            long,
            2 * radius,
            (angle * 180) / Math.PI,
          ),
          stroke_width: 0,
        })
        for (const side of [-1, 1])
          push({
            shape: "circle",
            center: rotate(
              { x: (side * long) / 2, y: 0 },
              angle,
              obstacle.center,
            ),
            radius,
          })
      }
    }
    coverage.obstacleElementIds[sourceId] = emitted
    if (emitted.length || obstacle.layers.length === 0)
      coverage.representedObstacleCount++
    if (!obstacle.layers.length)
      coverage.limitations.push(
        `${sourceId}: obstacle has no declared copper layer, so no planar geometry can be emitted.`,
      )
  }
  const vias = new Map<string, Element>()
  if (Object.keys(coverage.obstacleComponentIds).length)
    coverage.limitations.push(
      "Original component identities are retained on pads, associated physical ports, and verified source holes, and in obstacleComponentIds provenance. SRJ has no component bodies or courtyards; no component records or missing geometry are fabricated.",
    )
  for (const trace of traces) {
    const net = netFor(traceNet.get(trace)!),
      pieces: Element[][] = [[]]
    let previous: Element | undefined, activeLayer: string | undefined
    const append = (entry: Element) => {
      pieces.at(-1)!.push(entry)
      previous = entry
    }
    for (const entry of trace.route) {
      if (entry.route_type === "wire") {
        demand(
          finitePoint(entry) &&
            layers.includes(entry.layer) &&
            Number.isFinite(entry.width) &&
            entry.width > 0,
          `${trace.pcb_trace_id}: invalid wire`,
        )
        if (activeLayer && activeLayer !== entry.layer) {
          pieces.push([])
          coverage.limitations.push(
            `${trace.pcb_trace_id}: disconnected layer change preserved as separate trace fragments; no missing via was fabricated.`,
          )
        }
        const point: Element = { ...entry }
        for (const key of ["start_pcb_port_id", "end_pcb_port_id"] as const)
          if (point[key] !== undefined) {
            const candidates = portAliases.get(point[key])
            demand(
              candidates?.length &&
                candidates.every((port) => port.net === net),
              `${trace.pcb_trace_id}: unknown or foreign terminal identity ${point[key]}`,
            )
            const port = candidates.find(
              (port) =>
                near(port.pcb as Point, entry) &&
                port.pcb.layers.includes(entry.layer),
            )
            demand(
              port,
              `${trace.pcb_trace_id}: terminal identity ${point[key]} has the wrong position or layer`,
            )
            point[key] = port.pcb.pcb_port_id
          }
        if (
          previous?.route_type === "via" &&
          activeLayer === entry.layer &&
          !near(previous as Point, entry)
        )
          append({
            route_type: "wire",
            x: previous.x,
            y: previous.y,
            layer: entry.layer,
            width: entry.width,
          })
        append(point)
        activeLayer = entry.layer
      } else if (entry.route_type === "via") {
        demand(
          finitePoint(entry) &&
            layers.includes(entry.from_layer) &&
            layers.includes(entry.to_layer) &&
            entry.from_layer !== entry.to_layer,
          `${trace.pcb_trace_id}: invalid via`,
        )
        const outer =
          entry.via_diameter ??
          srj.min_via_pad_diameter ??
          srj.minViaPadDiameter ??
          srj.minViaDiameter
        const hole =
          entry.via_hole_diameter ??
          srj.min_via_hole_diameter ??
          srj.minViaHoleDiameter
        demand(
          outer !== undefined &&
            hole !== undefined &&
            Number.isFinite(outer) &&
            Number.isFinite(hole) &&
            hole > 0 &&
            outer > hole,
          `${trace.pcb_trace_id}: via dimensions are missing or invalid; conversion will not invent drills`,
        )
        if (activeLayer && activeLayer !== entry.from_layer) pieces.push([])
        if (
          previous?.route_type === "wire" &&
          activeLayer === entry.from_layer &&
          !near(previous as Point, entry)
        )
          append({
            route_type: "wire",
            x: entry.x,
            y: entry.y,
            layer: entry.from_layer,
            width: previous.width,
          })
        append({
          route_type: "via",
          x: entry.x,
          y: entry.y,
          from_layer: entry.from_layer,
          to_layer: entry.to_layer,
          outer_diameter: outer,
          hole_diameter: hole,
        })
        activeLayer = entry.to_layer
        const key = JSON.stringify([
          net.root,
          entry.x,
          entry.y,
          outer,
          hole,
          layers,
        ])
        if (!vias.has(key))
          vias.set(key, {
            type: "pcb_via",
            pcb_via_id: id(`pcb_via_srj_${vias.size}`),
            x: entry.x,
            y: entry.y,
            outer_diameter: outer,
            hole_diameter: hole,
            layers: [...layers],
            pcb_trace_id: trace.pcb_trace_id,
            source_trace_id: net.traceId,
            source_net_id: net.netId,
          })
        coverage.routeViaCount++
      } else if (entry.route_type === "through_obstacle") {
        throw new Error(
          "SRJ conversion: unsupported through_obstacle route; physical pad conductors cannot be inferred from a route annotation",
        )
      } else
        throw new Error(
          `SRJ conversion: unsupported route kind ${String((entry as { route_type: string }).route_type)}; geometry was not omitted`,
        )
    }
    const emitted: string[] = []
    for (const [index, route] of pieces
      .filter((piece) => piece.length)
      .entries()) {
      const traceId = id(
        index === 0
          ? trace.pcb_trace_id
          : `${trace.pcb_trace_id}__fragment${index}`,
      )
      // Preserve supplied identities; infer missing ones only at exact same-net, same-layer terminals.
      for (const [entry, key] of [
        [route[0], "start_pcb_port_id"],
        [route.at(-1), "end_pcb_port_id"],
      ] as const) {
        if (entry?.route_type !== "wire" || entry[key]) continue
        const matches = [...ports.values()].filter(
          (port) =>
            !port.synthetic &&
            port.net === net &&
            port.pcb.layers.includes(entry.layer) &&
            near(port.pcb as Point, entry as Point),
        )
        if (matches.length === 1) entry[key] = matches[0]!.pcb.pcb_port_id
      }
      elements.push({
        type: "pcb_trace",
        pcb_trace_id: traceId,
        source_trace_id: net.traceId,
        route,
      })
      emitted.push(traceId)
    }
    coverage.traceElementIds[trace.pcb_trace_id] = emitted
    if (emitted.length) coverage.representedTraceCount++
  }
  for (const net of nets.values()) {
    elements.push({
      type: "source_net",
      source_net_id: net.netId,
      name: net.root,
      member_source_group_ids: [],
      trace_width: net.width,
    })
    // Separate declared net binding from requested terminal connectivity so missing routes remain detectable.
    if (
      net.terminals.size ||
      traces.some((trace) => aliases.find(traceNet.get(trace)!) === net.root)
    )
      elements.push({
        type: "source_trace",
        source_trace_id: net.traceId,
        connected_source_port_ids: [...net.terminals],
        connected_source_net_ids: [],
        name: net.root,
        min_trace_thickness: net.width,
      })
    if (net.terminals.size >= 2)
      elements.push({
        type: "source_trace",
        source_trace_id: id(`${net.traceId}__net_binding`),
        connected_source_port_ids: [...net.ports],
        connected_source_net_ids: [net.netId],
      })
    else {
      const members = [...ports.values()].filter((port) => port.net === net)
      const representative =
        members.find((port) => !port.synthetic) ?? members[0]
      if (representative) {
        // One logical source port can have several physical copper-pad representations.
        // This declares ownership without a source trace asking to route unused pads.
        for (const port of members)
          port.pcb.source_port_id = representative.source.source_port_id
        if (net.terminals.size === 0) {
          representative.source.name = `virtual copper-net port: ${net.root}`
          coverage.limitations.push(
            `${net.root}: unrequested copper uses one virtual source port to preserve electrical membership across ${members.length} physical PCB ports; no source trace or routing requirement was invented.`,
          )
        }
      }
    }
  }
  const emittedSourcePorts = new Set<string>()
  for (const port of ports.values()) {
    if (
      port.source.source_port_id === port.pcb.source_port_id &&
      !emittedSourcePorts.has(port.source.source_port_id)
    ) {
      elements.push(port.source)
      emittedSourcePorts.add(port.source.source_port_id)
    }
    elements.push(port.pcb)
  }
  for (const via of vias.values()) {
    const actualTrace = coverage.traceElementIds[via.pcb_trace_id]?.[0]
    demand(actualTrace, `via has no represented trace ${via.pcb_trace_id}`)
    via.pcb_trace_id = actualTrace
  }
  elements.push(...vias.values())
  coverage.standaloneViaCount = vias.size
  if (ports.size > coverage.sourceTerminalCount)
    coverage.limitations.push(
      "Additional pad-provenance ports identify declared copper nets; they are excluded from requested terminal connectivity.",
    )
  const padPortIds = new Set(
    elements
      .filter((element) => element.type === "pcb_smtpad")
      .map((element) => element.pcb_port_id),
  )
  const terminalsWithoutPads = [...ports.values()].filter(
    (port) => !port.synthetic && !padPortIds.has(port.pcb.pcb_port_id),
  )
  if (terminalsWithoutPads.length)
    coverage.limitations.push(
      `${terminalsWithoutPads.length} physical terminal records have no corresponding pad footprint in the SRJ; independent endpoint connectivity checks remain necessary because PCB pad-based checks cannot certify those terminals.`,
    )
  demand(
    coverage.representedObstacleCount === coverage.sourceObstacleCount &&
      coverage.representedTraceCount === coverage.sourceTraceCount &&
      coverage.representedTerminalCount === coverage.sourceTerminalCount,
    "incomplete geometry conversion",
  )
  return { circuitJson: elements as AnyCircuitElement[], coverage }
}

export function convertSrjToCircuitJson(
  srj: SimpleRouteJson,
  options: SrjConversionOptions = {},
): AnyCircuitElement[] {
  return build(srj,options).circuitJson
}
export function describeConversionCoverage(
  srj: SimpleRouteJson,
  options: SrjConversionOptions = {},
): SrjConversionCoverage {
  return build(srj,options).coverage
}
export function convertSrjWithCoverage(srj: SimpleRouteJson, options: SrjConversionOptions = {}) {
  return build(srj,options)
}
