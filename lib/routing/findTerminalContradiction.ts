import type {ConnectionPoint, Obstacle, Point} from "../types"
import type {RoutingProblem, RoutingTask} from "./types"

export interface TerminalContradiction {
  kind: "terminal-inside-unrelated-copper"
  taskId: string
  terminal: ConnectionPoint
  terminalNet: string
  eligibleLayers: string[]
  blockingObstacles: {
    layer: string
    obstacleId: string
    obstacle: Obstacle
    localPoint: Point
  }[]
}

/** A strict interior intersection is a proof of a short, independent of routing. */
function interiorPoint(point: Point, obstacle: Obstacle): Point | undefined {
  const angle=-(obstacle.ccwRotationDegrees??0)*Math.PI/180
  const dx=point.x-obstacle.center.x,dy=point.y-obstacle.center.y
  const local={x:dx*Math.cos(angle)-dy*Math.sin(angle),y:dx*Math.sin(angle)+dy*Math.cos(angle)}
  const rx=obstacle.width/2,ry=obstacle.height/2
  if(rx<=0||ry<=0) return undefined
  // The ellipse is physical copper for elliptical pads and lies within a
  // capsule-shaped oval. Its interior is a valid certificate in either case.
  const inside=obstacle.type==="oval"
    ? (local.x/rx)**2+(local.y/ry)**2<1-1e-8
    : Math.abs(local.x)<rx-1e-8&&Math.abs(local.y)<ry-1e-8
  return inside?local:undefined
}

export function findTerminalContradiction(problem: RoutingProblem): TerminalContradiction | undefined {
  for(const task of problem.tasks) for(const terminal of [task.start,task.end]) {
    const eligibleLayers=("layers" in terminal?terminal.layers:[terminal.layer])
      .filter(layer=>!task.allowedLayers||task.allowedLayers.includes(layer))
    if(!eligibleLayers.length) continue
    const names=new Set([task.netName,task.connectionName,...task.connectedNames])
    const blockingObstacles: TerminalContradiction["blockingObstacles"]=[]
    for(const layer of eligibleLayers) {
      for(const obstacle of problem.srj.obstacles) {
        if(!obstacle.layers.includes(layer)||obstacle.connectedTo.some(name=>names.has(name))) continue
        const localPoint=interiorPoint(terminal,obstacle)
        if(!localPoint) continue
        blockingObstacles.push({layer,obstacle,localPoint,
          obstacleId:obstacle.obstacleId??obstacle.connectedTo[0]??`obstacle@${obstacle.center.x},${obstacle.center.y}`})
        break
      }
    }
    if(blockingObstacles.length===eligibleLayers.length)
      return {kind:"terminal-inside-unrelated-copper",taskId:task.id,terminal,
        terminalNet:task.netName,eligibleLayers,blockingObstacles}
  }
}
