import type {Obstacle, Point, SimplifiedPcbTrace} from "../types"
import type {RoutingProblem, RoutingTask} from "./types"
import {distance, pointInPolygon, segmentDistanceSquared, segmentRectDistanceSquared} from "./geometry"

interface Shape {
  a: Point
  b: Point
  radius: number
  names: string[]
  obstacle?: Obstacle
  boundary?: boolean
  via?: boolean
  seen: number
  testedTask?: RoutingTask
  sameNet?: boolean
}

/** A spatial index of actual copper, shared by every search on one board. */
export class CopperMap {
  readonly layers: string[]
  private buckets = new Map<number, Shape[]>()
  private serial = 0
  private cellSize = 1
  private outline?: Point[]

  constructor(readonly problem: RoutingProblem) {
    this.layers = problem.srj.layerCount <= 1 ? ["top"] : ["top",
      ...Array.from({length: problem.srj.layerCount-2},(_,i)=>`inner${i+1}`),"bottom"]
    this.outline = problem.srj.outline && problem.srj.outline.length>=3 ? problem.srj.outline : undefined
    for (const obstacle of problem.srj.obstacles) {
      const shape: Shape = {a:obstacle.center,b:obstacle.center,radius:0,names:obstacle.connectedTo??[],obstacle,seen:0}
      const radius=Math.hypot(obstacle.width,obstacle.height)/2
      for (const layer of obstacle.layers) {
        const z=this.layers.indexOf(layer)
        if (z<0) continue
        this.insertBounds(shape,z,obstacle.center.x-radius,obstacle.center.x+radius,obstacle.center.y-radius,obstacle.center.y+radius)
      }
    }
    if (this.outline) for (let i=0;i<this.outline.length;i++) {
      const shape: Shape={a:this.outline[i]!,b:this.outline[(i+1)%this.outline.length]!,radius:0,names:[],boundary:true,seen:0}
      for (let z=0;z<this.layers.length;z++) this.insertSegment(shape,z)
    }
    for (const trace of problem.fixedTraces) this.addTrace(trace)
  }

  private key(x: number,y: number,z: number): number { return ((x+32768)*65536+y+32768)*8+z }
  private insertBounds(shape: Shape,z: number,minX: number,maxX: number,minY: number,maxY: number): void {
    for(let x=Math.floor(minX/this.cellSize);x<=Math.floor(maxX/this.cellSize);x++)
      for(let y=Math.floor(minY/this.cellSize);y<=Math.floor(maxY/this.cellSize);y++) {
        const k=this.key(x,y,z),bucket=this.buckets.get(k)
        if(bucket) { if(bucket[bucket.length-1]!==shape) bucket.push(shape) }
        else this.buckets.set(k,[shape])
      }
  }
  private insertSegment(shape: Shape,z: number): void {
    const count=Math.max(1,Math.ceil(distance(shape.a,shape.b)/(this.cellSize/2)))
    for(let i=0;i<=count;i++) {
      const x=shape.a.x+(shape.b.x-shape.a.x)*i/count,y=shape.a.y+(shape.b.y-shape.a.y)*i/count
      this.insertBounds(shape,z,x-shape.radius-this.cellSize/4,x+shape.radius+this.cellSize/4,
        y-shape.radius-this.cellSize/4,y+shape.radius+this.cellSize/4)
    }
  }

  addTrace(trace: SimplifiedPcbTrace, aliases: string[]=[]): void {
    const names=[trace.connection_name,...(trace.connectsTo??[]),...aliases]
    let previous: Point | undefined
    let previousLayer: string | undefined
    for(const item of trace.route) {
      if(item.route_type==="wire") {
        if(previous && previousLayer===item.layer) {
          const z=this.layers.indexOf(item.layer)
          if(z>=0) this.insertSegment({a:previous,b:item,radius:item.width/2,names,seen:0},z)
        }
        previous=item; previousLayer=item.layer
      } else if(item.route_type==="via") {
        const shape: Shape={a:item,b:item,radius:(item.via_diameter??this.problem.viaDiameter)/2,names,seen:0,via:true}
        // A drilled via occupies all copper layers, including layers it does not route on.
        for(let z=0;z<this.layers.length;z++) this.insertSegment(shape,z)
        previous=item; previousLayer=item.to_layer
      } else { previous=undefined;previousLayer=undefined }
    }
  }

  private isSameNet(shape: Shape,task: RoutingTask): boolean {
    if(shape.testedTask!==task) {
      shape.testedTask=task
      shape.sameNet=shape.names.some(name=>name===task.netName||name===task.connectionName||task.connectedNames.includes(name))
    }
    return !!shape.sameNet
  }

  clear(a: Point,b: Point,z: number,radius: number,task: RoutingTask,via=false): boolean {
    const {srj}=this.problem
    const edge=radius+(srj.minBoardEdgeClearance??0)
    if(Math.min(a.x,b.x)<srj.bounds.minX+edge-1e-8 || Math.max(a.x,b.x)>srj.bounds.maxX-edge+1e-8 ||
      Math.min(a.y,b.y)<srj.bounds.minY+edge-1e-8 || Math.max(a.y,b.y)>srj.bounds.maxY-edge+1e-8) return false
    if(this.outline && (!pointInPolygon(a,this.outline)||!pointInPolygon(b,this.outline))) return false
    const margin=this.problem.obstacleMargin
    const queryRadius=radius+Math.max(margin,srj.minTraceToPadEdgeClearance??0,srj.minViaEdgeToPadEdgeClearance??0)
    const seen=++this.serial
    const count=Math.max(1,Math.ceil(distance(a,b)/(this.cellSize/2)))
    for(let i=0;i<=count;i++) {
      const x=a.x+(b.x-a.x)*i/count,y=a.y+(b.y-a.y)*i/count
      const reach=queryRadius+this.cellSize/4
      for(let ix=Math.floor((x-reach)/this.cellSize);ix<=Math.floor((x+reach)/this.cellSize);ix++)
        for(let iy=Math.floor((y-reach)/this.cellSize);iy<=Math.floor((y+reach)/this.cellSize);iy++) {
          const bucket=this.buckets.get(this.key(ix,iy,z))
          if(!bucket) continue
          for(const shape of bucket) {
            if(shape.seen===seen) continue
            shape.seen=seen
            const sameNet=this.isSameNet(shape,task)
            if(sameNet && !(via && (shape.via || srj.allowViaInPad===false && shape.obstacle))) continue
            const clearance=shape.boundary ? edge : radius+shape.radius+(shape.obstacle
              ? (via ? srj.minViaEdgeToPadEdgeClearance : srj.minTraceToPadEdgeClearance)??margin : margin)
            let squared: number
            if(shape.obstacle) {
              const o=shape.obstacle,angle=-(o.ccwRotationDegrees??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle)
              const local=(p: Point): Point=>({x:(p.x-o.center.x)*c-(p.y-o.center.y)*s,y:(p.x-o.center.x)*s+(p.y-o.center.y)*c})
              const aa=local(a),bb=local(b)
              // Use the rectangular envelope for oval pads. It remains safe when
              // downstream SRJ-to-circuit converters represent every pad as a rectangle.
              squared=segmentRectDistanceSquared(aa,bb,o.width/2,o.height/2)
            } else squared=segmentDistanceSquared(a,b,shape.a,shape.b)
            if(squared<(clearance-1e-7)**2 || (clearance<=1e-7 && squared===0)) return false
          }
        }
    }
    return true
  }

  viaClear(p: Point,task: RoutingTask): boolean {
    for(let z=0;z<this.layers.length;z++) if(!this.clear(p,p,z,this.problem.viaDiameter/2,task,true)) return false
    return true
  }
}
