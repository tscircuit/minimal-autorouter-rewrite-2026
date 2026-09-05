import {BaseSolver} from "../solvers/BaseSolver"
import type {SimplifiedPcbTrace} from "../types"
import {CopperMap} from "./CopperMap"
import {distance} from "./geometry"
import {RouteSearch} from "./RouteSearch"
import type {RoutingProblem, RoutingTask} from "./types"

/** Owns route order and retries; individual searches own geometric decisions. */
export class RoutingSolver extends BaseSolver {
  routes: SimplifiedPcbTrace[]=[]
  unroutedTaskIds: string[]=[]
  private map: CopperMap
  private order: RoutingTask[]
  private index=0
  private attempt=0
  private pass=0
  private failures: RoutingTask[]=[]
  private bestRoutes: SimplifiedPcbTrace[]=[]
  private bestFailures: RoutingTask[]=[]
  private search?: RouteSearch
  private pitches: number[]
  private maxPasses: number
  private priorities=new Map<string,number>()

  constructor(readonly problem: RoutingProblem) {
    super()
    this.MAX_ITERATIONS=10_000_000
    this.map=new CopperMap(problem)
    this.order=[...problem.tasks].sort((a,b)=>distance(a.start,a.end)-distance(b.start,b.end)||a.id.localeCompare(b.id))
    const pitch=Math.max(0.1,Math.min(0.3,problem.srj.minTraceWidth+problem.obstacleMargin))
    this.pitches=[pitch,pitch*0.6,pitch*0.35]
    this.maxPasses=Math.min(8,Math.max(5,Math.ceil(problem.effort)))
    this.bestFailures=[...this.order]
  }

  getConstructorParams(): [RoutingProblem] {return [this.problem]}

  _step(): void {
    if(this.index>=this.order.length) {this.finishPass();return}
    const task=this.order[this.index]!
    if(!this.search) {
      this.search=new RouteSearch(this.map,task,this.pitches[this.attempt]!)
      this.activeSubSolver=this.search
    }
    if(!this.search.solved&&!this.search.failed) this.search.step()
    if(this.search.solved) {
      const trace=this.toTrace(task,this.search)
      this.routes.push(trace)
      this.map.addTrace(trace,[task.netName,...task.connectedNames])
      this.advance()
    } else if(this.search.failed) {
      this.attempt++
      if(this.attempt>=this.pitches.length) {this.failures.push(task);this.advance()}
      else {this.search=undefined;this.activeSubSolver=null}
    }
    this.progress=(this.pass+this.index/Math.max(1,this.order.length))/this.maxPasses
    this.stats={routed:this.routes.length,total:this.order.length,pass:this.pass+1,failed:this.failures.length}
  }

  private advance(): void {this.index++;this.attempt=0;this.search=undefined;this.activeSubSolver=null}

  private finishPass(): void {
    if(this.failures.length<=this.bestFailures.length) {
      this.bestRoutes=[...this.routes];this.bestFailures=[...this.failures]
    }
    if(!this.failures.length) {this.solved=true;return}
    if(++this.pass>=this.maxPasses) {
      this.routes=this.bestRoutes
      this.unroutedTaskIds=this.bestFailures.map(task=>task.id)
      this.failed=true
      this.error=`Could not route ${this.unroutedTaskIds.length} of ${this.order.length} connections`
      return
    }
    for(const task of this.failures) this.priorities.set(task.id,(this.priorities.get(task.id)??0)+1)
    this.order.sort((a,b)=>(this.priorities.get(b.id)??0)-(this.priorities.get(a.id)??0) ||
      distance(a.start,a.end)-distance(b.start,b.end))
    this.map=new CopperMap(this.problem);this.routes=[];this.failures=[];this.index=0
  }

  private toTrace(task: RoutingTask,search: RouteSearch): SimplifiedPcbTrace {
    const route: SimplifiedPcbTrace["route"]=[]
    for(let i=0;i<search.points.length;i++) {
      const p=search.points[i]!,previous=search.points[i-1],layer=this.map.layers[p.z]!
      if(previous&&previous.z!==p.z) route.push({route_type:"via",x:p.x,y:p.y,
        from_layer:this.map.layers[previous.z]!,to_layer:layer,
        via_diameter:this.problem.viaDiameter,via_hole_diameter:this.problem.viaHoleDiameter})
      route.push({route_type:"wire",x:p.x,y:p.y,layer,width:task.traceWidth,
        ...(i===0&&task.start.pcb_port_id?{start_pcb_port_id:task.start.pcb_port_id}:{}),
        ...(i===search.points.length-1&&task.end.pcb_port_id?{end_pcb_port_id:task.end.pcb_port_id}:{})})
    }
    return {type:"pcb_trace",pcb_trace_id:`minimal_${task.id}`,connection_name:task.connectionName,
      connectsTo:[...new Set([task.netName,...task.connectedNames])],route}
  }

  visualize(): any {
    const lines: any[]=[],circles: any[]=[]
    for(const trace of this.routes) for(let i=1;i<trace.route.length;i++) {
      const a=trace.route[i-1]!,b=trace.route[i]!
      if(a.route_type==="wire"&&b.route_type==="wire"&&a.layer===b.layer)
        lines.push({points:[{x:a.x,y:a.y},{x:b.x,y:b.y}],strokeColor:a.layer==="top"?"#d34a40":"#4267b2",strokeWidth:a.width})
      if(b.route_type==="via") circles.push({center:{x:b.x,y:b.y},radius:this.problem.viaDiameter/2,fill:"#747b85"})
    }
    return {lines,circles,points:[],rects:[]}
  }
}
