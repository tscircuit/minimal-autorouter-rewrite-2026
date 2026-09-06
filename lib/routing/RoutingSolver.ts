import {BaseSolver} from "../solvers/BaseSolver"
import type {SimplifiedPcbTrace} from "../types"
import {CopperMap} from "./CopperMap"
import {distance} from "./geometry"
import {RouteSearch} from "./RouteSearch"
import {findTerminalContradiction} from "./findTerminalContradiction"
import {CompletionRepairSolver} from "./CompletionRepairSolver"
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
  private repairSearch?: RouteSearch
  private repairs=0
  private repairCounts=new Map<string,number>()
  private strategy: "ordered" | "ripup" = "ordered"
  private completedPasses=0
  private totalRepairs=0
  completionRepairSolver?: CompletionRepairSolver

  constructor(readonly problem: RoutingProblem) {
    super()
    this.MAX_ITERATIONS=10_000_000
    this.map=new CopperMap(problem)
    this.order=[...problem.tasks].sort((a,b)=>distance(a.start,a.end)-distance(b.start,b.end)||a.id.localeCompare(b.id))
    const pitch=Math.max(0.1,Math.min(0.3,problem.srj.minTraceWidth+problem.obstacleMargin))
    this.pitches=[pitch,pitch*0.6,pitch*0.35]
    this.maxPasses=Math.min(8,Math.max(5,Math.ceil(problem.effort)))
    this.bestFailures=[...this.order]
    const contradiction=findTerminalContradiction(problem)
    if(contradiction) {
      this.failed=true
      this.stats={terminalContradiction:contradiction}
      this.unroutedTaskIds=this.order.map(task=>task.id)
      const {terminal,blockingObstacles}=contradiction
      this.error=`Terminal ${terminal.pcb_port_id??terminal.pointId??contradiction.taskId} at (${terminal.x}, ${terminal.y}) lies inside unrelated copper ${blockingObstacles.map(item=>item.obstacleId).join(", ")} on every eligible layer`
    }
  }

  getConstructorParams(): [RoutingProblem] {return [this.problem]}

  _step(): void {
    if(this.completionRepairSolver) {this.stepCompletion();return}
    if(this.index>=this.order.length) {this.finishPass();return}
    const task=this.order[this.index]!
    if(this.routes.some(trace=>trace.pcb_trace_id===`minimal_${task.id}`)) {this.advance();return}
    if(this.repairSearch) {this.stepRepair(task);return}
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
      if(this.attempt>=this.pitches.length) {
        if(this.strategy==="ripup"&&this.repairs<8&&(this.repairCounts.get(task.id)??0)<2&&this.routes.length) {
          this.repairs++;this.totalRepairs++
          this.repairCounts.set(task.id,(this.repairCounts.get(task.id)??0)+1)
          this.repairSearch=new RouteSearch(new CopperMap(this.problem),task,this.pitches[1]!,this.map)
          this.activeSubSolver=this.repairSearch
        } else {this.failures.push(task);this.advance()}
      }
      else {this.search=undefined;this.activeSubSolver=null}
    }
    this.progress=(this.completedPasses+this.index/Math.max(1,this.order.length))/(this.maxPasses*2+1)
    this.stats={routed:this.routes.length,total:this.problem.tasks.length,pass:this.pass+1,failed:this.failures.length,ripups:this.repairs,totalRipups:this.totalRepairs,strategy:this.strategy,attempts:this.completedPasses+1}
  }

  private stepRepair(task: RoutingTask): void {
    const search=this.repairSearch!
    if(!search.solved&&!search.failed) search.step()
    if(!search.solved&&!search.failed) return
    if(search.solved) {
      const displaced: RoutingTask[]=[]
      for(const trace of this.routes) {
        const map=new CopperMap({...this.problem,fixedTraces:[trace]})
        let collides=false
        for(let i=0;i<search.points.length;i++) {
          const p=search.points[i]!,q=search.points[i+1]
          if(q&&p.z===q.z&&!map.clear(p,q,p.z,task.traceWidth/2,task)) {collides=true;break}
          if(q&&p.z!==q.z&&!map.viaClear(p,task)) {collides=true;break}
        }
        if(collides) {
          const owner=this.problem.tasks.find(candidate=>trace.pcb_trace_id===`minimal_${candidate.id}`)
          if(owner) displaced.push(owner)
          if(displaced.length>4) break
        }
      }
      if(displaced.length<=4) {
        const ids=new Set(displaced.map(task=>`minimal_${task.id}`))
        this.routes=this.routes.filter(trace=>!ids.has(trace.pcb_trace_id))
        this.map=new CopperMap(this.problem)
        for(const trace of this.routes) this.map.addTrace(trace)
        const trace=this.toTrace(task,search)
        this.routes.push(trace);this.map.addTrace(trace,[task.netName,...task.connectedNames])
        this.order.splice(this.index+1,0,...displaced)
        this.repairSearch=undefined;this.advance();return
      }
    }
    this.failures.push(task);this.repairSearch=undefined;this.advance()
  }

  private advance(): void {this.index++;this.attempt=0;this.search=undefined;this.activeSubSolver=null}

  private stepCompletion(): void {
    const completion=this.completionRepairSolver!
    if(!completion.solved&&!completion.failed) completion.step()
    this.syncCompletion()
  }

  private syncCompletion(): void {
    const completion=this.completionRepairSolver!
    this.routes=completion.routes
    this.unroutedTaskIds=completion.unroutedTaskIds
    this.progress=(this.completedPasses+completion.progress)/(this.maxPasses*2+1)
    this.stats={...this.stats,strategy:"completion",routed:this.routes.length,
      total:this.problem.tasks.length,failed:this.unroutedTaskIds.length,completion:completion.stats}
    if(completion.solved||completion.failed) {
      this.solved=completion.solved;this.failed=completion.failed;this.error=completion.error
      if(completion.failed) this.failedSubSolvers=[completion]
      this.activeSubSolver=null
    }
  }

  override tryFinalAcceptance(): void {
    if(this.completionRepairSolver) {
      this.completionRepairSolver.tryFinalAcceptance()
      this.syncCompletion()
      return
    }
    if(this.bestRoutes.length>this.routes.length) this.routes=[...this.bestRoutes]
    const retained=new Set(this.routes.map(trace=>trace.pcb_trace_id))
    this.unroutedTaskIds=this.problem.tasks.filter(task=>!retained.has(`minimal_${task.id}`)).map(task=>task.id)
    this.solved=this.unroutedTaskIds.length===0
    this.failed=!this.solved
    if(this.activeSubSolver&&!this.activeSubSolver.solved&&!this.activeSubSolver.failed) {
      this.activeSubSolver.failed=true
      this.activeSubSolver.error="Routing parent reached its iteration limit"
      this.failedSubSolvers=[this.activeSubSolver]
    }
    this.activeSubSolver=null
    this.stats={...this.stats,routed:this.routes.length,total:this.problem.tasks.length,failed:this.unroutedTaskIds.length}
    if(this.failed) this.error=`Could not route ${this.unroutedTaskIds.length} of ${this.problem.tasks.length} connections within the iteration limit`
  }

  private finishPass(): void {
    if(this.failures.length<=this.bestFailures.length) {
      this.bestRoutes=[...this.routes];this.bestFailures=[...this.failures]
    }
    if(!this.failures.length) {this.stats={...this.stats,routed:this.routes.length,total:this.problem.tasks.length,failed:0};this.solved=true;return}
    this.completedPasses++
    if(++this.pass>=this.maxPasses) {
      if(this.strategy==="ordered") {
        // Keep the reliable ordering-only trajectory intact. Repair explores a
        // separate strategy only after that bounded search is exhausted.
        this.strategy="ripup";this.pass=0;this.priorities.clear()
      } else {
        this.routes=this.bestRoutes
        this.unroutedTaskIds=this.bestFailures.map(task=>task.id)
        // Preserve the best valid copper and repair its remaining congestion
        // instead of discarding it for another complete-board ordering pass.
        this.completionRepairSolver=new CompletionRepairSolver(this.problem,this.bestRoutes)
        this.activeSubSolver=this.completionRepairSolver
        return
      }
    } else {
      for(const task of this.failures) this.priorities.set(task.id,(this.priorities.get(task.id)??0)+1)
    }
    this.order=[...this.problem.tasks]
    this.order.sort((a,b)=>(this.priorities.get(b.id)??0)-(this.priorities.get(a.id)??0) ||
      distance(a.start,a.end)-distance(b.start,b.end))
    this.map=new CopperMap(this.problem);this.routes=[];this.failures=[];this.index=0;this.repairs=0;this.repairCounts.clear()
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
