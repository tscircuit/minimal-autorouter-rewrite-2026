import { expect } from "bun:test"
import type { ConnectionPoint, SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"
import { Groups, layerNames, checkTraceShape, appendTrace, touches, type Copper, type Capsule } from "./assertSample"

const EPSILON=1e-6
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y)

/** Validate retained copper against source geometry, without trusting solver collision methods. */
export function assertPartialRoutes(source: SimpleRouteJson,traces: SimplifiedPcbTrace[]): void {
  const layers=layerNames(source.layerCount),aliases=new Groups()
  for(const connection of source.connections) aliases.joinAll([connection.name,connection.rootConnectionName,
    connection.netConnectionName,connection.__netConnectionName,...(connection.mergedConnectionNames??[]),
    ...(connection.__rootConnectionNames??[]),...connection.pointsToConnect.flatMap(point=>[point.pointId,point.pcb_port_id])]
    .filter((name):name is string=>!!name))
  for(const obstacle of source.obstacles) aliases.joinAll(obstacle.connectedTo)
  const terminals=new Map<string,ConnectionPoint[]>()
  for(const connection of source.connections) {
    const net=aliases.find(connection.name)
    terminals.set(net,[...(terminals.get(net)??[]),...connection.pointsToConnect])
  }
  const obstacles: {net:string;copper:Copper}[]=source.obstacles.map(obstacle=>{
    const angle=(obstacle.ccwRotationDegrees??0)*Math.PI/180
    const net=aliases.find(obstacle.connectedTo[0]??"")
    if(obstacle.type==="oval") {
      const radius=Math.min(obstacle.width,obstacle.height)/2
      const dx=Math.max(0,obstacle.width/2-radius),dy=Math.max(0,obstacle.height/2-radius)
      const x=dx*Math.cos(angle)-dy*Math.sin(angle),y=dx*Math.sin(angle)+dy*Math.cos(angle)
      return {net,copper:{kind:"capsule" as const,radius,layers:obstacle.layers,
        a:{x:obstacle.center.x-x,y:obstacle.center.y-y},b:{x:obstacle.center.x+x,y:obstacle.center.y+y}}}
    }
    return {net,copper:{kind:"box" as const,center:obstacle.center,width:obstacle.width,height:obstacle.height,angle,layers:obstacle.layers}}
  })
  const defaultClearance=source.defaultObstacleMargin??Math.min(.15,Math.max(.1,source.minTraceWidth))
  const allCopper:{net:string;traceId:string;copper:Capsule;via:boolean}[]=[]
  const allVias:{net:string;x:number;y:number;diameter:number}[]=[]
  const ids=new Set<string>()
  for(const trace of traces) {
    checkTraceShape(trace,layers)
    expect(ids.has(trace.pcb_trace_id)).toBe(false);ids.add(trace.pcb_trace_id)
    const net=aliases.find(trace.connection_name),points=terminals.get(net)
    expect(points,`${trace.pcb_trace_id}: unknown source net`).toBeDefined()
    const first=trace.route[0]!,last=trace.route[trace.route.length-1]!
    for(const endpoint of [first,last]) {
      expect(endpoint.route_type).toBe("wire")
      if(endpoint.route_type!=="wire") throw new Error("Route endpoint must be a wire")
      expect(points!.some(point=>distance(point,endpoint)<EPSILON&&
        ("layer" in point?[point.layer]:point.layers).includes(endpoint.layer)),
        `${trace.pcb_trace_id}: endpoint is not a requested physical terminal`).toBe(true)
    }
    for(let i=0;i<trace.route.length;i++) {
      const current=trace.route[i]!,previous=trace.route[i-1],next=trace.route[i+1]
      expect(current.route_type==="wire"||current.route_type==="via").toBe(true)
      if(current.route_type==="wire") {
        if(previous?.route_type==="wire") expect(current.layer).toBe(previous.layer)
        if(previous?.route_type==="via") expect(current.layer).toBe(previous.to_layer)
      } else if(current.route_type==="via") {
        expect(previous?.route_type).toBe("wire");expect(next?.route_type).toBe("wire")
        if(previous?.route_type==="wire") expect(current.from_layer).toBe(previous.layer)
        if(next?.route_type==="wire") expect(current.to_layer).toBe(next.layer)
        allVias.push({net,x:current.x,y:current.y,diameter:current.via_diameter??source.minViaDiameter??.3})
      }
    }
    const copper:Copper[]=[]
    appendTrace(copper,trace,layers,source)
    // Drilled through vias occupy every copper layer, including intermediate ones.
    for(const entry of trace.route) if(entry.route_type==="via") copper.push({kind:"capsule",a:entry,b:entry,
      radius:(entry.via_diameter??source.minViaDiameter??.3)/2,layers})
    for(const atom of copper) {
      if(atom.kind!=="capsule") throw new Error("Unexpected generated copper shape")
      const via=trace.route.some(entry=>entry.route_type==="via"&&distance(entry,atom.a)<EPSILON&&
        distance(atom.a,atom.b)<EPSILON&&Math.abs((entry.via_diameter??.3)/2-atom.radius)<EPSILON)
      const edge=source.minBoardEdgeClearance??0
      for(const point of [atom.a,atom.b]) {
        expect(point.x-atom.radius).toBeGreaterThanOrEqual(source.bounds.minX+edge-EPSILON)
        expect(point.x+atom.radius).toBeLessThanOrEqual(source.bounds.maxX-edge+EPSILON)
        expect(point.y-atom.radius).toBeGreaterThanOrEqual(source.bounds.minY+edge-EPSILON)
        expect(point.y+atom.radius).toBeLessThanOrEqual(source.bounds.maxY-edge+EPSILON)
      }
      for(const obstacle of obstacles) {
        if(obstacle.net===net) continue
        const clearance=(via?source.minViaEdgeToPadEdgeClearance:source.minTraceToPadEdgeClearance)??defaultClearance
        if(touches({...atom,radius:atom.radius+clearance-3*EPSILON},obstacle.copper))
          throw new Error(`${trace.pcb_trace_id}: copper violates unrelated pad clearance`)
      }
      allCopper.push({net,traceId:trace.pcb_trace_id,copper:atom,via})
    }
  }
  for(let i=0;i<allCopper.length;i++) for(let j=i+1;j<allCopper.length;j++) {
    const a=allCopper[i]!,b=allCopper[j]!
    if(a.net===b.net) continue
    if(touches({...a.copper,radius:a.copper.radius+defaultClearance-3*EPSILON},b.copper))
      throw new Error(`${a.traceId} and ${b.traceId}: unrelated copper violates clearance`)
  }
  for(let i=0;i<allVias.length;i++) for(let j=i+1;j<allVias.length;j++) {
    const a=allVias[i]!,b=allVias[j]!,separation=distance(a,b)
    if(a.net===b.net&&separation<EPSILON) continue // Reuse of the same physical drill.
    expect(separation).toBeGreaterThanOrEqual((a.diameter+b.diameter)/2+defaultClearance-EPSILON)
  }
}
