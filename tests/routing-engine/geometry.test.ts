import {expect,test} from "bun:test"
import {segmentDistanceSquared,segmentRectDistanceSquared} from "../../lib/routing/geometry"
import {CopperMap} from "../../lib/routing/CopperMap"
import {RoutingSolver} from "../../lib/routing/RoutingSolver"
import type {RoutingProblem,RoutingTask} from "../../lib/routing/types"

const task: RoutingTask={id:"signal",netName:"signal",connectionName:"signal",connectedNames:["signal"],
 start:{x:1,y:5,layer:"top"},end:{x:9,y:5,layer:"top"},traceWidth:.2}
const board=(): RoutingProblem=>({srj:{layerCount:2,minTraceWidth:.2,bounds:{minX:0,maxX:10,minY:0,maxY:10},connections:[],obstacles:[]},
 tasks:[task],fixedTraces:[],obstacleMargin:.15,viaDiameter:.6,viaHoleDiameter:.3,effort:1})

test("continuous geometry detects crossing segments and rounded rectangle clearance",()=>{
 expect(segmentDistanceSquared({x:0,y:0},{x:2,y:2},{x:0,y:2},{x:2,y:0})).toBe(0)
 expect(segmentDistanceSquared({x:0,y:0},{x:0,y:0},{x:2,y:0},{x:3,y:0})).toBe(4)
 expect(segmentRectDistanceSquared({x:2,y:2},{x:3,y:3},1,1)).toBe(2)
 expect(segmentRectDistanceSquared({x:-2,y:0},{x:2,y:0},1,1)).toBe(0)
})

test("spatial checks preserve net exemptions and reject crossing fixed copper",()=>{
 const problem=board()
 problem.fixedTraces=[{type:"pcb_trace",pcb_trace_id:"fixed",connection_name:"ground",route:[
  {route_type:"wire",x:5,y:1,layer:"top",width:.3},{route_type:"wire",x:5,y:9,layer:"top",width:.3}]}]
 const map=new CopperMap(problem)
 expect(map.clear(task.start,task.end,0,.1,task)).toBe(false)
 expect(map.clear(task.start,task.end,1,.1,task)).toBe(true)
 expect(map.clear(task.start,task.end,0,.1,{...task,connectedNames:["ground"]})).toBe(true)
})

test("routing escapes a top-layer barrier with clearance-checked vias",()=>{
 const problem=board()
 problem.srj.obstacles=[{type:"rect",center:{x:5,y:5},width:1,height:10,layers:["top"],connectedTo:["barrier"]}]
 const solver=new RoutingSolver(problem);solver.solve()
 expect(solver.solved).toBe(true)
 const trace=solver.routes[0]!
 expect(trace.route.filter(p=>p.route_type==="via").length).toBe(2)
 const map=new CopperMap(problem)
 for(let i=0;i<trace.route.length;i++) {
  const p=trace.route[i]!,q=trace.route[i+1]
  if(p.route_type==="via") expect(map.viaClear(p,task)).toBe(true)
  if(p.route_type==="wire"&&q?.route_type==="wire"&&p.layer===q.layer)
   expect(map.clear(p,q,map.layers.indexOf(p.layer),p.width/2,task)).toBe(true)
 }
 expect(trace.route[0]).toMatchObject({x:1,y:5,layer:"top"})
 expect(trace.route[trace.route.length-1]).toMatchObject({x:9,y:5,layer:"top"})
})

test("a via respects obstacles on intermediate layers",()=>{
 const problem=board();problem.srj.layerCount=4
 problem.srj.obstacles=[{type:"rect",center:{x:5,y:5},width:1,height:1,layers:["inner1"],connectedTo:["other"]}]
 expect(new CopperMap(problem).viaClear({x:5,y:5},task)).toBe(false)
})

test("rotated rectangles use physical shape rather than its bounding box",()=>{
 const problem=board()
 problem.srj.obstacles=[{type:"rect",center:{x:5,y:5},width:4,height:.4,ccwRotationDegrees:45,layers:["top"],connectedTo:["other"]}]
 const map=new CopperMap(problem)
 expect(map.clear({x:4,y:6},{x:4,y:6},0,.1,task)).toBe(true)
 expect(map.clear({x:6,y:6},{x:6,y:6},0,.1,task)).toBe(false)
})

test("same-net vias keep drill clearance while their attached wire remains reachable",()=>{
 const problem=board()
 problem.fixedTraces=[{type:"pcb_trace",pcb_trace_id:"fixed-via",connection_name:"signal",route:[
  {route_type:"wire",x:4,y:5,layer:"top",width:.2},
  {route_type:"via",x:5,y:5,from_layer:"top",to_layer:"bottom",via_diameter:.6},
  {route_type:"wire",x:6,y:5,layer:"bottom",width:.2}]}]
 const map=new CopperMap(problem)
 expect(map.clear({x:4,y:5},{x:5,y:5},0,.1,task)).toBe(true)
 expect(map.viaClear({x:5.65,y:5},task)).toBe(false)
 expect(map.viaClear({x:5.8,y:5},task)).toBe(true)
})

test("oval envelope remains clear after rectangular SRJ pad conversion",()=>{
 const problem=board()
 problem.srj.obstacles=[{type:"oval",center:{x:5,y:5},width:1,height:1,layers:["top"],connectedTo:["other"]}]
 expect(new CopperMap(problem).clear({x:5.55,y:5.55},{x:5.55,y:5.55},0,.1,task)).toBe(false)
})

test("explicit via-in-pad prohibition still permits exiting a same-net pad",()=>{
 const problem=board();problem.srj.allowViaInPad=false
 problem.srj.obstacles=[{type:"rect",center:{x:5,y:5},width:1,height:1,layers:["top"],connectedTo:["signal"]}]
 const map=new CopperMap(problem)
 expect(map.clear({x:5,y:5},{x:6,y:5},0,.1,task)).toBe(true)
 expect(map.viaClear({x:5,y:5},task)).toBe(false)
})

test("an existing same-net drill is a reusable layer transition",()=>{
 const problem=board()
 problem.fixedTraces=[{type:"pcb_trace",pcb_trace_id:"reusable-via",connection_name:"signal",route:[
  {route_type:"via",x:5,y:5,from_layer:"top",to_layer:"bottom",via_diameter:.6}]}]
 const map=new CopperMap(problem)
 expect(map.hasVia({x:5,y:5},task)).toBe(true)
 expect(map.viaClear({x:5,y:5},task)).toBe(true)
 expect(map.viaClear({x:5.1,y:5},task)).toBe(false)
})

test("a terminal inside another net's copper is rejected even without other routes",()=>{
 const problem=board()
 problem.srj.obstacles=[{type:"rect",center:{x:1,y:5},width:1,height:1,layers:["top"],connectedTo:["other-net"]}]
 const map=new CopperMap(problem)
 expect(map.clear(task.start,task.start,0,task.traceWidth/2,task)).toBe(false)
 expect(map.viaClear(task.start,task)).toBe(false)
 const solver=new RoutingSolver(problem);solver.solve()
 expect(solver.failed).toBe(true)
 expect(solver.solved).toBe(false)
 expect(solver.routes).toHaveLength(0)
})

test("an exact terminal contradiction carries a physical witness",()=>{
 const problem=board()
 problem.srj.obstacles=[{type:"rect",obstacleId:"shorted-pad",center:{x:1,y:5},width:1,height:1,layers:["top"],connectedTo:["other-net"]}]
 const solver=new RoutingSolver(problem)
 expect(solver.failed).toBe(true)
 expect(solver.error).toContain("shorted-pad")
 expect(solver.stats.terminalContradiction).toMatchObject({kind:"terminal-inside-unrelated-copper",taskId:task.id,eligibleLayers:["top"]})
})

test("a clear eligible terminal layer prevents an infeasibility certificate",()=>{
 const problem=board();problem.tasks=[{...task,start:{x:1,y:5,layers:["top","bottom"]}}]
 problem.srj.obstacles=[{type:"rect",center:{x:1,y:5},width:1,height:1,layers:["top"],connectedTo:["other-net"]}]
 const solver=new RoutingSolver(problem)
 expect(solver.failed).toBe(false)
 solver.solve();expect(solver.solved).toBe(true)
})

test("oval and rotated-pad envelopes do not create false contradiction certificates",()=>{
 const problem=board()
 problem.tasks=[{...task,start:{x:1.45,y:5.45,layer:"top"}}]
 problem.srj.obstacles=[{type:"oval",center:{x:1,y:5},width:1,height:1,layers:["top"],connectedTo:["other-net"]}]
 expect(new RoutingSolver(problem).failed).toBe(false)
 problem.srj.obstacles=[{type:"rect",center:{x:1,y:5},width:2,height:.2,ccwRotationDegrees:-45,layers:["top"],connectedTo:["other-net"]}]
 expect(new RoutingSolver(problem).failed).toBe(false)
})

test("negotiation moves a blocking trace without relaxing final copper clearance",()=>{
 const problem=board();problem.srj.layerCount=1;problem.srj.bounds.maxY=30
 problem.tasks=[
  {...task,id:"across",connectionName:"across",netName:"across",connectedNames:["across"],start:{x:.2,y:15,layer:"top"},end:{x:9.8,y:15,layer:"top"}},
  {...task,id:"vertical",connectionName:"vertical",netName:"vertical",connectedNames:["vertical"],start:{x:5,y:5,layer:"top"},end:{x:5,y:25,layer:"top"}},
 ]
 const solver=new RoutingSolver(problem);solver.solve()
 expect(solver.solved).toBe(true)
 expect(solver.routes).toHaveLength(2)
 expect(solver.stats.attempts).toBeLessThanOrEqual(2)
 const map=new CopperMap(problem)
 for(const trace of solver.routes) {
  const owner=problem.tasks.find(t=>t.connectionName===trace.connection_name)!
  for(let i=0;i<trace.route.length-1;i++) {
   const a=trace.route[i]!,b=trace.route[i+1]!
   if(a.route_type==="wire"&&b.route_type==="wire") expect(map.clear(a,b,0,a.width/2,owner)).toBe(true)
  }
  map.addTrace(trace)
 }
})

test("fixed wire-to-via segments and single-point copper remain occupied",()=>{
 const problem=board()
 problem.fixedTraces=[{type:"pcb_trace",pcb_trace_id:"fixed",connection_name:"other",route:[
  {route_type:"wire",x:2,y:5,layer:"top",width:.2},
  {route_type:"via",x:8,y:5,from_layer:"top",to_layer:"bottom",via_diameter:.6},
  {route_type:"wire",x:8,y:8,layer:"bottom",width:.2},
 ]},{type:"pcb_trace",pcb_trace_id:"point",connection_name:"other",route:[
  {route_type:"wire",x:2,y:2,layer:"bottom",width:.2},
 ]}]
 const map=new CopperMap(problem)
 expect(map.clear({x:5,y:4},{x:5,y:6},0,.1,task)).toBe(false)
 expect(map.clear({x:7,y:7},{x:9,y:7},1,.1,task)).toBe(false)
 expect(map.clear({x:2,y:2},{x:2,y:2},1,.1,task)).toBe(false)
})
