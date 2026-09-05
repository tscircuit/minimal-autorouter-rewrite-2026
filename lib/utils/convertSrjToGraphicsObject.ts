import type {SimpleRouteJson} from "../types"
import {getBoardLayers} from "../preparation/PrepareBoardSolver"

export type TraceColorMode = "layer" | "net"
export type ConvertSrjToGraphicsObjectOptions = {traceColorMode?: TraceColorMode; colorMap?: Record<string, string>}
const palette = ["#c93649", "#d08724", "#9774cc", "#249184", "#927033", "#3979c5"]

export function convertSrjToGraphicsObject(srj: SimpleRouteJson, options: ConvertSrjToGraphicsObjectOptions = {}): any {
  const layers = getBoardLayers(srj.layerCount)
  const graphics: any = {lines: [], points: [], rects: [], circles: []}
  const {minX, minY, maxX, maxY} = srj.bounds
  graphics.rects.push({center: {x: (minX + maxX) / 2, y: (minY + maxY) / 2},
    width: maxX - minX, height: maxY - minY, stroke: "#6a7280", fill: "transparent", label: "Board"})
  for (const obstacle of srj.obstacles) {
    graphics.rects.push({center: obstacle.center, width: obstacle.width, height: obstacle.height,
      rotation: (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180,
      fill: "rgba(130,140,150,0.35)", stroke: "#818995", label: obstacle.obstacleId,
      layer: obstacle.layers[0]})
  }
  for (const connection of srj.connections) for (const point of connection.pointsToConnect) {
    graphics.points.push({x: point.x, y: point.y, label: connection.name, color: options.colorMap?.[connection.name] ?? "#555"})
  }
  for (const trace of srj.traces ?? []) for (let i = 0; i < trace.route.length; i++) {
    const point = trace.route[i]!, next = trace.route[i + 1]
    if (point.route_type === "via") {
      graphics.circles.push({center: {x: point.x, y: point.y}, radius: (point.via_diameter ?? 0.3) / 2,
        stroke: "#776740", fill: "transparent", label: trace.connection_name})
    }
    if (point.route_type === "wire" && next?.route_type === "wire" && point.layer === next.layer) {
      graphics.lines.push({points: [{x: point.x, y: point.y}, {x: next.x, y: next.y}],
        strokeColor: options.traceColorMode === "net" ? options.colorMap?.[trace.connection_name] ?? "#2d827a" : palette[layers.indexOf(point.layer) % palette.length],
        strokeWidth: point.width, layer: point.layer, label: trace.connection_name})
    }
  }
  return graphics
}
