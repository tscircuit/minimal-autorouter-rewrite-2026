import {expect,test} from "bun:test"
import {RoutingSolver} from "../../lib/routing/RoutingSolver"
import type {RoutingProblem,RoutingTask} from "../../lib/routing/types"

function problem():RoutingProblem {
  const tasks:RoutingTask[]=[
    {id:"horizontal",connectionName:"horizontal",netName:"horizontal",connectedNames:["horizontal"],
      start:{x:-1,y:-1,layer:"top"},end:{x:1,y:-1,layer:"top"},traceWidth:0.1},
    {id:"vertical",connectionName:"vertical",netName:"vertical",connectedNames:["vertical"],
      start:{x:1.5,y:-1,layer:"top"},end:{x:1.5,y:1,layer:"top"},traceWidth:0.1},
  ]
  return {srj:{layerCount:1,minTraceWidth:0.1,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},
    obstacles:[{type:"rect",center:{x:0,y:0},width:4,height:0.4,layers:["top"],connectedTo:[]}],
    connections:tasks.map(task=>({name:task.connectionName,pointsToConnect:[task.start,task.end]}))},
    tasks,fixedTraces:[],effort:1,obstacleMargin:0.1,viaDiameter:0.3,viaHoleDiameter:0.15}
}

test("outer routing limit preserves accepted copper and an exact unfinished-task ledger",()=>{
  const solver=new RoutingSolver(problem())
  solver.MAX_ITERATIONS=0
  solver.step()
  expect(solver.failed).toBe(true)
  expect(solver.routes.map(trace=>trace.pcb_trace_id)).toEqual(["minimal_horizontal"])
  expect(solver.unroutedTaskIds).toEqual(["vertical"])
  expect(solver.activeSubSolver).toBeNull()
})

test("outer routing limit finalizes a completion child during seed validation",()=>{
  const solver=new RoutingSolver(problem())
  while(!solver.completionRepairSolver&&!solver.solved&&!solver.failed) solver.step()
  expect(solver.completionRepairSolver).toBeDefined()
  solver.MAX_ITERATIONS=solver.iterations
  solver.step()
  expect(solver.failed).toBe(true)
  expect(solver.routes.map(trace=>trace.pcb_trace_id)).toEqual(["minimal_horizontal"])
  expect(solver.unroutedTaskIds).toEqual(["vertical"])
  expect(solver.completionRepairSolver!.failed).toBe(true)
  expect(solver.activeSubSolver).toBeNull()
})
