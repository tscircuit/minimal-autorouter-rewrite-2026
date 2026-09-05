import {BaseSolver} from "../solvers/BaseSolver"
import type {ConnectionPoint, Point} from "../types"
import {CopperMap} from "./CopperMap"
import {distance} from "./geometry"
import type {RoutingTask} from "./types"

export interface RoutePoint extends Point {z: number}
const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const
const layersOf=(point: ConnectionPoint): string[] => "layers" in point ? point.layers : [point.layer]

/** Duplicate heap entries avoid a mutable decrease-key index. */
class Frontier {
  private ids: number[]=[]
  private scores: number[]=[]
  get length(): number { return this.ids.length }
  push(id: number,score: number): void {
    let i=this.ids.length
    this.ids.push(id);this.scores.push(score)
    while(i>0) {
      const parent=(i-1)>>1
      if(this.scores[parent]!<=score) break
      this.ids[i]=this.ids[parent]!;this.scores[i]=this.scores[parent]!;i=parent
    }
    this.ids[i]=id;this.scores[i]=score
  }
  pop(): number {
    const answer=this.ids[0]!,id=this.ids.pop()!,score=this.scores.pop()!
    if(this.ids.length) {
      let i=0
      while(2*i+1<this.ids.length) {
        let child=2*i+1
        if(child+1<this.ids.length && this.scores[child+1]!<this.scores[child]!) child++
        if(this.scores[child]!>=score) break
        this.ids[i]=this.ids[child]!;this.scores[i]=this.scores[child]!;i=child
      }
      this.ids[i]=id;this.scores[i]=score
    }
    return answer
  }
}

/** One connection, one grid resolution. Every accepted edge has continuous clearance. */
export class RouteSearch extends BaseSolver {
  points: RoutePoint[]=[]
  expanded=0
  private frontier=new Frontier()
  private costs: Float32Array
  private parents: Int32Array
  private closed: Uint8Array
  private blocked: Uint8Array
  private vias: Uint8Array
  private goals=new Set<number>()
  private nx: number
  private ny: number
  private plane: number
  private x0: number
  private y0: number
  private allowed: number[]
  private startLayers: number[]
  private endLayers: number[]
  private radius: number
  private maximumExpansions: number
  private source: ConnectionPoint
  private target: ConnectionPoint
  private reverse=false

  constructor(readonly map: CopperMap,readonly task: RoutingTask,readonly pitch: number) {
    super()
    this.source=task.start;this.target=task.end
    const {bounds}=map.problem.srj
    this.x0=bounds.minX+task.traceWidth/2
    this.y0=bounds.minY+task.traceWidth/2
    this.nx=Math.floor((bounds.maxX-task.traceWidth/2-this.x0)/pitch)+1
    this.ny=Math.floor((bounds.maxY-task.traceWidth/2-this.y0)/pitch)+1
    this.plane=this.nx*this.ny
    const size=this.plane*map.layers.length
    this.costs=new Float32Array(size);this.costs.fill(Infinity)
    this.parents=new Int32Array(size);this.parents.fill(-1)
    this.closed=new Uint8Array(size)
    this.blocked=new Uint8Array(size)
    this.vias=new Uint8Array(this.plane)
    this.allowed=map.layers.flatMap((layer,z)=>!task.allowedLayers||task.allowedLayers.includes(layer)?[z]:[])
    this.startLayers=this.allowed.filter(z=>layersOf(task.start).includes(map.layers[z]!))
    this.endLayers=this.allowed.filter(z=>layersOf(task.end).includes(map.layers[z]!))
    this.radius=task.traceWidth/2
    this.maximumExpansions=Math.max(50000,Math.min(size,250000*Math.max(1,map.problem.effort)))
    this.MAX_ITERATIONS=Math.ceil(this.maximumExpansions/512)*8+10
    if(!this.startLayers.length||!this.endLayers.length) {
      this.failed=true;this.error="No allowed layer reaches an endpoint";return
    }
    if(this.trySimplePath()) {this.solved=true;return}
    const starts: {id: number,p: RoutePoint}[]=[],ends: {id: number,p: RoutePoint}[]=[]
    this.attachEndpoint(task.start,this.startLayers,(id,p)=>starts.push({id,p}))
    this.attachEndpoint(task.end,this.endLayers,(id,p)=>ends.push({id,p}))
    // Start from the more constrained escape. An isolated terminal then fails
    // locally instead of exhausting the open area around its other endpoint.
    this.reverse=ends.length<starts.length
    if(this.reverse) {
      this.source=task.end;this.target=task.start
      ;[this.startLayers,this.endLayers]=[this.endLayers,this.startLayers]
    }
    for(const {id} of this.reverse?starts:ends) this.goals.add(id)
    for(const {id,p} of this.reverse?ends:starts) {
      const cost=distance(p,this.source)
      this.costs[id]=cost
      this.frontier.push(id,cost+this.heuristic(p))
    }
    if(!this.goals.size||!this.frontier.length) {
      this.failed=true;this.error="Grid cannot escape an endpoint at this resolution"
    }
  }

  getConstructorParams(): [CopperMap,RoutingTask,number] {return [this.map,this.task,this.pitch]}

  private trySimplePath(): boolean {
    for(const z of this.startLayers.filter(z=>this.endLayers.includes(z))) {
      const start={...this.task.start,z},end={...this.task.end,z}
      if(this.map.clear(start,end,z,this.radius,this.task)) {this.points=[start,end];return true}
      const dx=end.x-start.x,dy=end.y-start.y,diagonal=Math.min(Math.abs(dx),Math.abs(dy))
      const corners=[{x:end.x,y:start.y},{x:start.x,y:end.y},
        {x:start.x+Math.sign(dx)*diagonal,y:start.y+Math.sign(dy)*diagonal},
        {x:end.x-Math.sign(dx)*diagonal,y:end.y-Math.sign(dy)*diagonal}]
      for(const corner of corners) if(this.map.clear(start,corner,z,this.radius,this.task)&&this.map.clear(corner,end,z,this.radius,this.task)) {
        this.points=[start,{...corner,z},end];return true
      }
    }
    return false
  }

  private attachEndpoint(endpoint: ConnectionPoint,layers: number[],visit: (id: number,p: RoutePoint)=>void): void {
    const cx=Math.round((endpoint.x-this.x0)/this.pitch),cy=Math.round((endpoint.y-this.y0)/this.pitch)
    for(const z of layers) for(let dx=-2;dx<=2;dx++) for(let dy=-2;dy<=2;dy++) {
      const x=cx+dx,y=cy+dy
      if(x<0||x>=this.nx||y<0||y>=this.ny) continue
      const id=x+y*this.nx+z*this.plane,p=this.point(id)
      if(this.map.clear(endpoint,p,z,this.radius,this.task)) visit(id,p)
    }
  }

  private point(id: number): RoutePoint {
    const xy=id%this.plane
    return {x:this.x0+(xy%this.nx)*this.pitch,y:this.y0+Math.floor(xy/this.nx)*this.pitch,z:Math.floor(id/this.plane)}
  }
  private heuristic(p: RoutePoint): number {
    return distance(p,this.target)*1.12+(this.endLayers.includes(p.z)?0:1.8)
  }
  private open(id: number,p: RoutePoint,parent: number,cost: number): void {
    if(cost>=this.costs[id]!-1e-6) return
    this.costs[id]=cost;this.parents[id]=parent
    this.frontier.push(id,cost+this.heuristic(p))
  }

  _step(): void {
    for(let budget=0;budget<512;budget++) {
      if(!this.frontier.length||this.expanded>=this.maximumExpansions) {
        this.failed=true;this.error="No route found within the search budget";return
      }
      const id=this.frontier.pop()
      if(this.closed[id]) continue
      this.closed[id]=1;this.expanded++
      const p=this.point(id),xy=id%this.plane,x=xy%this.nx,y=Math.floor(xy/this.nx)
      if(this.goals.has(id)) {this.finish(id);return}
      for(const [dx,dy] of directions) {
        if(x+dx<0||x+dx>=this.nx||y+dy<0||y+dy>=this.ny) continue
        const next=id+dx+dy*this.nx
        if(this.closed[next]||this.blocked[next]===2) continue
        const q={x:p.x+dx*this.pitch,y:p.y+dy*this.pitch,z:p.z}
        if(!this.blocked[next]) this.blocked[next]=this.map.clear(q,q,p.z,this.radius,this.task)?1:2
        if(this.blocked[next]===2) continue
        const cost=this.costs[id]!+this.pitch*(dx&&dy?Math.SQRT2:1)
        if(cost>=this.costs[next]!-1e-6) continue
        if(this.map.clear(p,q,p.z,this.radius,this.task)) this.open(next,q,id,cost)
      }
      if(this.allowed.length>1) {
        if(!this.vias[xy]) this.vias[xy]=this.map.viaClear(p,this.task)?1:2
        if(this.vias[xy]===1) for(const z of this.allowed) {
          if(z===p.z) continue
          const next=xy+z*this.plane
          if(!this.closed[next]) this.open(next,{...p,z},id,this.costs[id]!+1.8+Math.abs(z-p.z)*0.05)
        }
      }
    }
    this.progress=Math.min(0.95,this.expanded/this.maximumExpansions)
  }

  private finish(id: number): void {
    const reversed: RoutePoint[]=[]
    let cursor=id
    while(cursor>=0) {reversed.push(this.point(cursor));cursor=this.parents[cursor]!}
    const points=reversed.reverse()
    points.unshift({...this.source,z:points[0]!.z})
    points.push({...this.target,z:points[points.length-1]!.z})
    if(this.reverse) points.reverse()
    const corners: RoutePoint[]=[]
    for(let i=0;i<points.length;i++) {
      const a=corners[corners.length-1],b=points[i]!,c=points[i+1]
      if(a&&c&&a.z===b.z&&b.z===c.z && Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))<1e-8) continue
      if(!a||distance(a,b)>1e-9||a.z!==b.z) corners.push(b)
    }
    for(let i=0;i<corners.length;) {
      this.points.push(corners[i]!)
      let end=i+1
      while(end<corners.length&&corners[end]!.z===corners[i]!.z) end++
      let next=i+1
      for(let candidate=end-1;candidate>i+1;candidate--) {
        if(this.map.clear(corners[i]!,corners[candidate]!,corners[i]!.z,this.radius,this.task)) {next=candidate;break}
      }
      i=next
    }
    this.solved=true
  }
}
