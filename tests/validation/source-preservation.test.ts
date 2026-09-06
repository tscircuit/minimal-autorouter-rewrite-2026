import {expect, test} from "bun:test"
import {Pipeline9} from "../../lib/Pipeline9"
import type {SimpleRouteJson, SimplifiedPcbTrace} from "../../lib/types"
import {readDatasetManifest, readSample, repositoryRoot} from "../../scripts/benchmark/data"
import {assertSourcePreservation} from "../../scripts/validation/assertSourcePreservation"
import {assertNoPcbIssues, validateSrjWithChecks} from "../../scripts/validation/validateSrjWithChecks"
import {getVerifiedSourceGeometry} from "../../scripts/validation/sourceGeometry"

const trace = (): SimplifiedPcbTrace => ({
  type:"pcb_trace",pcb_trace_id:"signal_trace",connection_name:"signal",
  route:[{route_type:"wire",x:-2,y:0,layer:"top",width:.1},
    {route_type:"wire",x:2,y:0,layer:"top",width:.1}],
})
function source(): SimpleRouteJson {
  return {
    layerCount:2,minTraceWidth:.1,minBoardEdgeClearance:.2,
    bounds:{minX:-5,maxX:5,minY:-5,maxY:5},
    connections:[{name:"signal",pointsToConnect:[
      {x:-2,y:0,layer:"top",pcb_port_id:"a"},
      {x:2,y:0,layer:"top",pcb_port_id:"b"},
    ]}],
    obstacles:[-2,2].map((x,index)=>({type:"rect",center:{x,y:0},width:.5,height:.5,
      layers:["top"],connectedTo:["signal",index===0?"a":"b"]})),
  }
}
const output = (original: SimpleRouteJson): SimpleRouteJson => ({...structuredClone(original),traces:[trace()]})

test("unchanged source requirements and complete new routing pass without mutating either input", async () => {
  const original=source(), routed=output(original), before=structuredClone({original,routed})
  expect(()=>assertSourcePreservation(original,routed)).not.toThrow()
  await expect(assertNoPcbIssues(routed,"preserved",{originalSrj:original})).resolves.toBeUndefined()
  expect({original,routed}).toEqual(before)
})

test.each([
  ["removed all requirements",(srj:SimpleRouteJson)=>{srj.connections=[];srj.traces=[]}],
  ["removed a terminal",(srj:SimpleRouteJson)=>{srj.connections[0]!.pointsToConnect.pop()}],
  ["moved terminal",(srj:SimpleRouteJson)=>{srj.connections[0]!.pointsToConnect[0]!.x+=.1}],
  ["changed terminal layer",(srj:SimpleRouteJson)=>{srj.connections[0]!.pointsToConnect[0]={x:-2,y:0,layer:"bottom",pcb_port_id:"a"}}],
  ["changed connection aliases",(srj:SimpleRouteJson)=>{srj.connections[0]!.rootConnectionName="foreign"}],
  ["off-board exception",(srj:SimpleRouteJson)=>{srj.connections[0]!.isOffBoard=true}],
  ["moved obstacle",(srj:SimpleRouteJson)=>{srj.obstacles[0]!.center.x+=.1}],
  ["changed obstacle net",(srj:SimpleRouteJson)=>{srj.obstacles[0]!.connectedTo=["foreign"]}],
  ["changed obstacle component",(srj:SimpleRouteJson)=>{srj.obstacles[0]!.componentId="invented_component"}],
  ["lost obstacle",(srj:SimpleRouteJson)=>{srj.obstacles.pop()}],
  ["weakened clearance",(srj:SimpleRouteJson)=>{srj.minBoardEdgeClearance=0}],
  ["added via-in-pad exception",(srj:SimpleRouteJson)=>{srj.allowViaInPad=true}],
  ["expanded board",(srj:SimpleRouteJson)=>{srj.bounds.maxX+=1}],
  ["changed minimum trace width",(srj:SimpleRouteJson)=>{srj.minTraceWidth=.01}],
] as const)("rejects %s independently of whether the remaining output passes DRC",(_label,mutate)=>{
  const original=source(), routed=output(original)
  mutate(routed)
  expect(()=>assertSourcePreservation(original,routed)).toThrow("Source preservation:")
})

test("retained labels cannot hide absent new copper",()=>{
  const original=source(), routed=output(original)
  routed.traces=[]
  expect(()=>assertSourcePreservation(original,routed)).toThrow("lack continuous")
})

test("fixed copper must retain its identity and exact physical geometry even if a substitute connects every terminal",()=>{
  const original={...source(),traces:[trace()]}, routed=output(original)
  expect(()=>assertSourcePreservation(original,routed)).not.toThrow()
  routed.traces![0]!.pcb_trace_id="replacement"
  expect(()=>assertSourcePreservation(original,routed)).toThrow("fixed trace signal_trace")
  routed.traces=[trace()]
  const wire=routed.traces[0]!.route[0]!
  if(wire.route_type!=="wire") throw new Error("missing wire")
  wire.width=.2
  expect(()=>assertSourcePreservation(original,routed)).toThrow("fixed trace signal_trace")
  routed.traces=[trace()]; routed.traces.push(trace())
  expect(()=>assertSourcePreservation(original,routed)).toThrow("duplicate output trace")
})

test("only existing layer normalization and deterministically recoverable metadata are accepted",()=>{
  const original=source(), obstacle=original.obstacles[0]!
  obstacle.layers=["top","inner1"]
  obstacle.zLayers=[0,1];obstacle.__zLayers=[0,1]
  obstacle.connectedTo=["pad_a","signal","pad_a","a"]
  const routed=output(original), normalized=routed.obstacles[0]!
  normalized.layers=["top"];normalized.zLayers=[0];normalized.__zLayers=[0]
  normalized.circuitJsonMetadata={pcb_plated_hole_id:"pad_a",pcb_port_id:"a"}
  expect(()=>assertSourcePreservation(original,routed)).not.toThrow()
  normalized.circuitJsonMetadata.pcb_port_id="foreign_port"
  expect(()=>assertSourcePreservation(original,routed)).toThrow("changed source metadata")
  delete normalized.circuitJsonMetadata
  normalized.layers=["bottom"]
  expect(()=>assertSourcePreservation(original,routed)).toThrow("changed physical layers")
})

test("real pinned circuit001 Pipeline9 output preserves the raw source across metadata migration",async()=>{
  const manifest=await readDatasetManifest()
  const sample=manifest.datasets.find(dataset=>dataset.name==="dataset01")!.samples.find(sample=>sample.name==="circuit001")!
  const path=`${repositoryRoot}/datasets/${sample.file}`
  const original=await Bun.file(path).json() as SimpleRouteJson
  const migrated=await readSample(path,sample) as SimpleRouteJson
  const solver=new Pipeline9(migrated,{cacheProvider:null})
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(()=>assertSourcePreservation(original,solver.getOutputSimpleRouteJson())).not.toThrow()
})

test("an accepted NPTH proof cannot turn sample003 with all103 routing requests omitted into a passing result",async()=>{
  const bytes=new Uint8Array(await Bun.file(new URL("../../datasets/dataset-srj18/sample003.json",import.meta.url)).arrayBuffer())
  const original=JSON.parse(new TextDecoder().decode(bytes)) as SimpleRouteJson
  expect(original.connections).toHaveLength(103)
  const routed={...structuredClone(original),connections:[],traces:[]}
  const sourceGeometry=getVerifiedSourceGeometry({originalSrjBytes:bytes,routedSrj:routed})!
  expect(sourceGeometry).toBeDefined()
  const validation=await validateSrjWithChecks(routed,{sourceGeometry,originalSrj:original})
  expect(validation.pcbIssues).toHaveLength(0)
  expect(validation.sourcePreservationError).toContain("terminal requirements changed")
  await expect(assertNoPcbIssues(routed,"omitted requests",{sourceGeometry,originalSrj:original})).rejects.toThrow("source preservation failed")
})
