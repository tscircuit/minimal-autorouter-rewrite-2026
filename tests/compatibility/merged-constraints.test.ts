import { expect, test } from "bun:test"
import { PrepareBoardSolver } from "../../lib/preparation/PrepareBoardSolver"
import { Pipeline9 } from "../../lib/Pipeline9"
import type { SimpleRouteJson } from "../../lib/types"

function input(): SimpleRouteJson {
  const point=(x:number)=>({x,y:5,layers:["top","inner1","bottom"]})
  return {layerCount:3,minTraceWidth:.1,nominalTraceWidth:.2,
    bounds:{minX:0,maxX:10,minY:0,maxY:10},obstacles:[],connections:[
      {name:"first",rootConnectionName:"shared",nominalTraceWidth:.1,pointsToConnect:[point(1),point(5)]},
      {name:"second",rootConnectionName:"shared",pointsToConnect:[point(5),point(9)]},
    ]}
}
function prepare(source: SimpleRouteJson): PrepareBoardSolver {
  const solver=new PrepareBoardSolver(source,{effort:1,viaDiameter:.3,viaHoleDiameter:.15})
  solver.solve();return solver
}

test("merged members retain the widest resolved width, including a later member's bus width",()=>{
  const source=input();source.buses=[{busId:"later",connectionNames:["second"],traceWidth:.4}]
  const before=JSON.stringify(source),solver=prepare(source)
  expect(solver.solved).toBe(true);expect(solver.tasks).toHaveLength(2)
  expect(solver.tasks.every(task=>task.traceWidth===.4)).toBe(true)
  expect(JSON.stringify(source)).toBe(before)
  expect(JSON.stringify(solver.srj.connections)).toBe(JSON.stringify(source.connections))
})

test("per-record width overrides a bus width before whole-net widths are combined",()=>{
  const source=input();source.connections[1]!.nominalTraceWidth=.25
  source.buses=[{busId:"later",connectionNames:["second"],traceWidth:.4}]
  expect(prepare(source).tasks.every(task=>task.traceWidth===.25)).toBe(true)
  delete source.connections[1]!.nominalTraceWidth;delete source.buses
  expect(prepare(source).tasks.every(task=>task.traceWidth===.2)).toBe(true)
  delete source.nominalTraceWidth
  expect(prepare(source).tasks.every(task=>task.traceWidth===.1)).toBe(true)
})

test("layer restrictions across merged member names intersect and govern emitted copper",()=>{
  const source=input();source.connections[1]!.mergedConnectionNames=["second-alias"]
  source.buses=[
    {busId:"one",connectionNames:["first"],allowedLayers:["top","inner1"]},
    {busId:"two",connectionNames:["second-alias"],allowedLayers:["inner1","bottom"]},
  ]
  const prepared=prepare(source)
  expect(prepared.solved).toBe(true)
  expect(prepared.tasks.every(task=>JSON.stringify(task.allowedLayers)==='["inner1"]')).toBe(true)
  const solver=new Pipeline9(source,{cacheProvider:null});solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces().flatMap(trace=>trace.route)
    .every(point=>point.route_type==="wire"&&point.layer==="inner1")).toBe(true)
})

test("incompatible whole-net layers fail explicitly without manufacturing an output",()=>{
  const source=input();source.buses=[
    {busId:"one",connectionNames:["first"],allowedLayers:["top"]},
    {busId:"two",connectionNames:["second"],allowedLayers:["bottom"]},
  ]
  const prepared=prepare(source)
  expect(prepared.failed).toBe(true);expect(prepared.solved).toBe(false)
  expect(prepared.error).toContain("no common routing layer")
  const solver=new Pipeline9(source,{cacheProvider:null});solver.solve()
  expect(solver.failed).toBe(true)
  expect(()=>solver.getOutputSimplifiedPcbTraces()).toThrow()
})

test("an original terminal must have a layer allowed by the merged tree",()=>{
  const source=input();source.connections[0]!.pointsToConnect[0]={x:1,y:5,layer:"top",pcb_port_id:"top-only"}
  source.buses=[{busId:"later",connectionNames:["second"],allowedLayers:["bottom"]}]
  const solver=prepare(source)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("top-only")
  expect(solver.error).toContain("bottom")
})

test("nonpositive and nonfinite resolved widths are rejected",()=>{
  for(const width of [0,-.1,NaN,Infinity]) {
    const source=input();source.connections[1]!.nominalTraceWidth=width
    const solver=prepare(source)
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain("positive finite width")
  }
})
