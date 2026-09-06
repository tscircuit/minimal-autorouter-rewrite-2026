import {expect, test} from "bun:test"
import {Pipeline9} from "../../lib/Pipeline9"
import {Pipeline9_Networked} from "../../lib/Pipeline9_Networked"
import {CopperMap} from "../../lib/routing/CopperMap"
import type {RoutingProblem, RoutingTask} from "../../lib/routing/types"
import type {SimpleRouteJson} from "../../lib/types"
import {createHdCache2Service} from "../../scripts/network-server"
import {assertNoPcbIssues} from "../../scripts/validation/validateSrjWithChecks"

const task: RoutingTask = {id:"signal", connectionName:"signal", netName:"signal", connectedNames:["signal"],
  start:{x:1,y:5,layer:"top"}, end:{x:9,y:5,layer:"top"}, traceWidth:0.2}
const problem = (clearance?: number): RoutingProblem => ({srj:{layerCount:2, minTraceWidth:0.2,
  bounds:{minX:0,maxX:10,minY:0,maxY:10}, obstacles:[], connections:[],
  ...(clearance === undefined ? {} : {minBoardEdgeClearance:clearance})}, tasks:[task],
  fixedTraces:[], viaDiameter:0.6, viaHoleDiameter:0.3, obstacleMargin:0.05, effort:1})

test("default board clearance measures 0.2mm beyond the actual trace or via edge", () => {
  const map = new CopperMap(problem())
  for (const radius of [0.05, 0.1, 0.3]) {
    expect(map.clear({x:radius+0.199,y:2}, {x:radius+0.199,y:8}, 0, radius, task)).toBe(false)
    expect(map.clear({x:radius+0.201,y:2}, {x:radius+0.201,y:8}, 0, radius, task)).toBe(true)
    expect(map.clear({x:2,y:10-radius-0.199}, {x:8,y:10-radius-0.199}, 1, radius, task)).toBe(false)
    expect(map.clear({x:2,y:10-radius-0.201}, {x:8,y:10-radius-0.201}, 1, radius, task)).toBe(true)
  }
  expect(map.viaClear({x:0.499,y:5}, task)).toBe(false)
  expect(map.viaClear({x:0.501,y:5}, task)).toBe(true)
})

test("explicit board clearance, including zero, overrides the default independently of obstacle margin", () => {
  for (const clearance of [0, 0.05, 0.8]) {
    const input = problem(clearance)
    input.obstacleMargin = 1
    const map = new CopperMap(input), edge = clearance+task.traceWidth/2
    expect(map.clear({x:edge-0.001,y:2}, {x:edge-0.001,y:8}, 0, 0.1, task)).toBe(false)
    expect(map.clear({x:edge+0.001,y:2}, {x:edge+0.001,y:8}, 0, 0.1, task)).toBe(true)
    expect(input.srj.minBoardEdgeClearance).toBe(clearance)
  }
  for (const invalid of [-0.1, NaN, Infinity])
    expect(() => new CopperMap(problem(invalid))).toThrow("minBoardEdgeClearance must be finite and nonnegative")
})

test("outline clearance finds the actual sloped boundary even when obstacle margin is smaller", () => {
  const input = problem()
  input.srj.outline = [{x:0,y:0},{x:10,y:0},{x:0,y:10}]
  const map = new CopperMap(input)
  // x+y=10 is the cutline; these center distances are 0.2mm and 0.4mm.
  const near = (10-0.2*Math.SQRT2)/2, clear = (10-0.4*Math.SQRT2)/2
  expect(map.clear({x:near,y:near},{x:near,y:near},0,0.1,task)).toBe(false)
  expect(map.clear({x:clear,y:clear},{x:clear,y:clear},0,0.1,task)).toBe(true)
  expect(map.viaClear({x:clear,y:clear},task)).toBe(false)
})

test("local and real cold/hot network routes honor default board edges under strict PCB checks", async () => {
  const source: SimpleRouteJson = {layerCount:2, minTraceWidth:0.2,
    bounds:{minX:0,maxX:10,minY:0,maxY:10}, obstacles:[
      {type:"rect", center:{x:5,y:5}, width:1, height:8.7, layers:["top"], connectedTo:["barrier"]},
    ], connections:[{name:"signal", pointsToConnect:[task.start,task.end]}]}
  const before = structuredClone(source), local = new Pipeline9(source)
  local.solve()
  expect(local.solved).toBe(true)
  await assertNoPcbIssues(local.getOutputSimpleRouteJson(), "Local board-edge regression")
  const service = createHdCache2Service()
  try {
    const options = {hdCache2ServerUrl:service.server.url.toString(), hdCache2CacheVersion:"board-edge-default"}
    const cold = new Pipeline9_Networked(source, options)
    await cold.solveAsync()
    expect(cold.solved).toBe(true)
    await assertNoPcbIssues(cold.getOutputSimpleRouteJson(), "Network board-edge regression")
    const hot = new Pipeline9_Networked(source, options)
    await hot.solveAsync()
    expect(hot.solved).toBe(true)
    await assertNoPcbIssues(hot.getOutputSimpleRouteJson(), "Cached board-edge regression")
    expect(cold.highDensityRouteSolver!.stats).toMatchObject({remoteSolverResults:1,remoteTransportFallbacks:0})
    expect(hot.highDensityRouteSolver!.stats).toMatchObject({remoteCacheHits:1,remoteTransportFallbacks:0})
    expect(service.stats).toMatchObject({boardSolverRuns:1,cacheHits:1})
    expect(hot.getOutputSimplifiedPcbTraces()).toEqual(cold.getOutputSimplifiedPcbTraces())
    expect(cold.getOutputSimplifiedPcbTraces()).toEqual(local.getOutputSimplifiedPcbTraces())
  } finally {service.server.stop(true)}
  expect(source).toEqual(before)
})
