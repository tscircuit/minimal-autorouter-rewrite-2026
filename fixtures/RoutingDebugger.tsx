import { useEffect, useMemo, useRef, useState } from "react"
import { Pipeline9 } from "../lib/index"
import type { Point, SimpleRouteJson, SimplifiedPcbTrace } from "../lib/types/srj-types"
import "./routing-debugger.css"

const palette = ["#f28579", "#67bfff", "#f4cf70", "#bf9ef4", "#71d7b4", "#ed9ecb"]
const boardLayers = (count: number) => Array.from({ length: count }, (_, z) =>
  z === 0 ? "top" : z === count - 1 ? "bottom" : `inner${z}`,
)

type DrawLine = { a: Point; b: Point; layer: string; width: number; net: string }
type DrawVia = Point & { from: string; to: string; diameter: number; net: string }
type Drawing = { lines: DrawLine[]; vias: DrawVia[] }

function traceDrawing(traces: SimplifiedPcbTrace[]): Drawing {
  const drawing: Drawing = { lines: [], vias: [] }
  for (const trace of traces) {
    let previous: { point: Point; layer: string; width: number } | undefined
    for (const entry of trace.route) {
      if (entry.route_type === "wire") {
        if (previous?.layer === entry.layer) drawing.lines.push({
          a: previous.point, b: entry, layer: entry.layer, width: entry.width, net: trace.connection_name,
        })
        previous = { point: entry, layer: entry.layer, width: entry.width }
      } else if (entry.route_type === "via") {
        if (previous?.layer === entry.from_layer) drawing.lines.push({
          a: previous.point, b: entry, layer: entry.from_layer, width: previous.width, net: trace.connection_name,
        })
        drawing.vias.push({ ...entry, from: entry.from_layer, to: entry.to_layer,
          diameter: entry.via_diameter ?? 0.5, net: trace.connection_name })
        previous = { point: entry, layer: entry.to_layer, width: previous?.width ?? 0.1 }
      } else {
        const layer = entry.route_type === "jumper" ? entry.layer : entry.from_layer
        drawing.lines.push({ a: entry.start, b: entry.end, layer,
          width: entry.route_type === "through_obstacle" ? entry.width : 0.3, net: trace.connection_name })
        previous = { point: entry.end,
          layer: entry.route_type === "jumper" ? entry.layer : entry.to_layer,
          width: entry.route_type === "through_obstacle" ? entry.width : 0.3 }
      }
    }
  }
  return drawing
}

type PreviewRoute = {
  connectionName: string; traceThickness: number; viaDiameter: number
  route: Array<Point & { z: number }>
}

function previewDrawing(solver: Pipeline9, layers: string[]): Drawing {
  if (solver.solved) return traceDrawing(solver.getOutputSimpleRouteJson().traces ?? [])
  const drawing = traceDrawing(solver.originalSrj.traces ?? [])
  const routes = (solver as unknown as { highDensityRouteSolver?: { routes?: Array<PreviewRoute | SimplifiedPcbTrace> } })
    .highDensityRouteSolver?.routes ?? []
  for (const route of routes) {
    if ("type" in route && route.type === "pcb_trace") {
      const trace = traceDrawing([route])
      drawing.lines.push(...trace.lines)
      drawing.vias.push(...trace.vias)
      continue
    }
    if (!("connectionName" in route)) continue
    for (let i = 1; i < route.route.length; i++) {
      const a = route.route[i - 1]!
      const b = route.route[i]!
      if (a.z === b.z) drawing.lines.push({ a, b, layer: layers[a.z] ?? "top",
        width: route.traceThickness, net: route.connectionName })
      else drawing.vias.push({ ...b, from: layers[a.z] ?? "top", to: layers[b.z] ?? "bottom",
        diameter: route.viaDiameter, net: route.connectionName })
    }
  }
  return drawing
}

function netColor(name: string): string {
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 72% 70%)`
}

export function RoutingDebugger({ sampleName, srj }: { sampleName: string; srj: SimpleRouteJson }) {
  return <RoutingDebuggerSession key={sampleName} sampleName={sampleName} srj={srj} />
}

function RoutingDebuggerSession({ sampleName, srj }: { sampleName: string; srj: SimpleRouteJson }) {
  const layers = useMemo(() => boardLayers(srj.layerCount), [srj.layerCount])
  const solverRef = useRef<Pipeline9 | null>(null)
  if (!solverRef.current) solverRef.current = new Pipeline9(structuredClone(srj), { cacheProvider: null })
  const [revision, setRevision] = useState(0)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [visibleLayers, setVisibleLayers] = useState(() => new Set(layers))
  const [showAirwires, setShowAirwires] = useState(false)
  const [colorByNet, setColorByNet] = useState(false)
  const runGeneration = useRef(0)
  const accumulatedMs = useRef(0)
  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; start: Point } | null>(null)
  const solver = solverRef.current
  const terminal = solver.solved || solver.failed
  const drawing = useMemo(() => previewDrawing(solver, layers), [solver, layers, revision])
  const spanX = Math.max(1, srj.bounds.maxX - srj.bounds.minX)
  const spanY = Math.max(1, srj.bounds.maxY - srj.bounds.minY)
  const margin = Math.max(spanX, spanY) * 0.04
  const viewWidth = (spanX + 2 * margin) / zoom
  const viewHeight = (spanY + 2 * margin) / zoom
  const centerX = (srj.bounds.minX + srj.bounds.maxX) / 2 + pan.x
  const centerY = -(srj.bounds.minY + srj.bounds.maxY) / 2 + pan.y
  const radius = Math.max(srj.minTraceWidth * 1.1, Math.min(spanX, spanY) * 0.0018)
  const color = (layer: string, net: string) => colorByNet ? netColor(net) : palette[layers.indexOf(layer) % palette.length] ?? palette[0]

  useEffect(() => () => { runGeneration.current++ }, [])

  const repaint = () => {
    setElapsed(accumulatedMs.current)
    setRevision(value => value + 1)
    setError(solverRef.current?.error ?? null)
  }

  const step = () => {
    const start = performance.now()
    try { solverRef.current!.step() }
    catch (caught) { setError(String(caught)) }
    accumulatedMs.current += performance.now() - start
    repaint()
  }

  const solve = async () => {
    if (running || terminal) return
    const generation = ++runGeneration.current
    setRunning(true)
    try {
      while (generation === runGeneration.current) {
        const current = solverRef.current!
        if (current.solved || current.failed) break
        const start = performance.now()
        // Each frame has a small work budget; yield so controls and SVG can repaint.
        do { current.step() }
        while (!current.solved && !current.failed && performance.now() - start < 8)
        accumulatedMs.current += performance.now() - start
        repaint()
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
    } catch (caught) {
      setError(String(caught))
    } finally {
      if (generation === runGeneration.current) {
        setRunning(false)
        repaint()
      }
    }
  }

  const pause = () => { runGeneration.current++; setRunning(false) }
  const reset = () => {
    pause()
    solverRef.current = new Pipeline9(structuredClone(srj), { cacheProvider: null })
    accumulatedMs.current = 0
    setElapsed(0)
    setError(null)
    setRevision(value => value + 1)
  }
  const toggleLayer = (layer: string) => setVisibleLayers(previous => {
    const next = new Set(previous)
    if (next.has(layer)) next.delete(layer)
    else next.add(layer)
    return next
  })
  const download = () => {
    const blob = new Blob([JSON.stringify(solver.getOutputSimpleRouteJson(), null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${sampleName}-routed.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return <main className="routing-debugger">
    <header className="routing-header">
      <div><p className="routing-eyebrow">DATASET SRJ18 · PIPELINE9</p><h1>{sampleName}</h1></div>
      <span className={`routing-status ${solver.solved ? "is-solved" : solver.failed ? "is-failed" : ""}`}>
        {solver.solved ? "Solved" : solver.failed ? "Failed" : running ? "Routing" : solver.iterations ? "Paused" : "Ready"}
      </span>
    </header>
    <div className="routing-toolbar">
      <div className="routing-actions">
        {running ? <button className="primary" onClick={pause}>Pause</button>
          : <button className="primary" onClick={() => void solve()} disabled={terminal}>Solve</button>}
        <button onClick={step} disabled={running || terminal}>Step</button>
        <button onClick={reset}>Reset</button>
        <button onClick={download} disabled={!solver.solved}>Save SRJ</button>
      </div>
      <div className="routing-metrics">
        <span><strong>{srj.connections.length}</strong> connections</span>
        <span><strong>{solver.iterations.toLocaleString()}</strong> steps</span>
        <span><strong>{(elapsed / 1000).toFixed(2)}s</strong> compute</span>
      </div>
    </div>
    <div className="routing-progress-row">
      <progress max={1} value={Math.max(0, Math.min(1, solver.progress))} aria-label="Routing progress" />
      <span>{solver.solved ? "Complete" : solver.getCurrentPhase()}</span>
    </div>
    {error && <div className="routing-error" role="alert">{error}</div>}
    <div className="routing-layer-controls">
      <span className="routing-control-label">Layers</span>
      {layers.map((layer, index) => <label key={layer}>
        <input type="checkbox" checked={visibleLayers.has(layer)} onChange={() => toggleLayer(layer)} />
        <i style={{ background: palette[index % palette.length] }} />{layer}
      </label>)}
      <span className="routing-control-spacer" />
      <label><input type="checkbox" checked={showAirwires} onChange={event => setShowAirwires(event.target.checked)} />Airwires</label>
      <label><input type="checkbox" checked={colorByNet} onChange={event => setColorByNet(event.target.checked)} />Net colors</label>
      <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>Fit board</button>
    </div>
    <div className="routing-board">
      <svg ref={svgRef} role="img" aria-label={`${sampleName} routing board`}
        viewBox={`${centerX - viewWidth / 2} ${centerY - viewHeight / 2} ${viewWidth} ${viewHeight}`}
        onWheel={event => setZoom(value => Math.max(0.7, Math.min(20, value * (event.deltaY < 0 ? 1.15 : 1 / 1.15))))}
        onPointerDown={event => {
          dragRef.current = { x: event.clientX, y: event.clientY, start: pan }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={event => {
          if (!dragRef.current || !svgRef.current) return
          const bounds = svgRef.current.getBoundingClientRect()
          const scale = Math.max(viewWidth / bounds.width, viewHeight / bounds.height)
          setPan({ x: dragRef.current.start.x - (event.clientX - dragRef.current.x) * scale,
            y: dragRef.current.start.y - (event.clientY - dragRef.current.y) * scale })
        }}
        onPointerUp={() => { dragRef.current = null }} onPointerCancel={() => { dragRef.current = null }}>
        <g transform="scale(1,-1)">
          {srj.outline?.length ? <polygon points={srj.outline.map(point => `${point.x},${point.y}`).join(" ")}
            fill="#172b29" stroke="#516964" strokeWidth={radius / 2} />
            : <rect x={srj.bounds.minX} y={srj.bounds.minY} width={spanX} height={spanY}
              fill="#172b29" stroke="#516964" strokeWidth={radius / 2} />}
          {srj.obstacles.map((obstacle, index) => obstacle.layers.some(layer => visibleLayers.has(layer)) && <rect key={index}
            x={obstacle.center.x - obstacle.width / 2} y={obstacle.center.y - obstacle.height / 2}
            width={obstacle.width} height={obstacle.height} fill="#92a09a" opacity={0.44}
            transform={obstacle.ccwRotationDegrees ? `rotate(${obstacle.ccwRotationDegrees},${obstacle.center.x},${obstacle.center.y})` : undefined}>
            <title>{obstacle.obstacleId ?? `Obstacle ${index + 1}`} · {obstacle.connectedTo.join(", ")}</title>
          </rect>)}
          {showAirwires && srj.connections.flatMap(connection => connection.pointsToConnect.slice(1).map((point, index) =>
            <line key={`${connection.name}-${index}`} x1={connection.pointsToConnect[0]!.x} y1={connection.pointsToConnect[0]!.y}
              x2={point.x} y2={point.y} stroke="#d9e1de" strokeWidth={radius / 3} strokeDasharray={`${radius * 2} ${radius * 2}`} opacity={0.35} />))}
          {drawing.lines.map((line, index) => visibleLayers.has(line.layer) && <line key={index}
            x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke={color(line.layer, line.net)}
            strokeWidth={line.width} strokeLinecap="round"><title>{line.net} · {line.layer}</title></line>)}
          {drawing.vias.map((via, index) => (visibleLayers.has(via.from) || visibleLayers.has(via.to)) && <g key={index}>
            <circle cx={via.x} cy={via.y} r={via.diameter / 2} fill="#dfcca5" />
            <circle cx={via.x} cy={via.y} r={via.diameter / 5} fill="#12211f" />
            <title>{via.net} · {via.from} → {via.to}</title>
          </g>)}
          {srj.connections.flatMap(connection => connection.pointsToConnect.map((point, index) => {
            const pointLayers = "layer" in point ? [point.layer] : point.layers
            if (!pointLayers.some(layer => visibleLayers.has(layer))) return null
            return <circle key={`${connection.name}-${index}`} cx={point.x} cy={point.y} r={radius}
              fill={colorByNet ? netColor(connection.name) : "#f4f3dc"} stroke="#142220" strokeWidth={radius / 4}>
              <title>{connection.name} · {point.pcb_port_id ?? point.pointId ?? `terminal ${index + 1}`}</title>
            </circle>
          }))}
        </g>
      </svg>
    </div>
    <footer className="routing-footer"><span>Scroll to zoom · Drag to pan · Hover to inspect</span>
      <span>{drawing.lines.length.toLocaleString()} segments · {drawing.vias.length.toLocaleString()} vias · dimensions in mm</span></footer>
  </main>
}
