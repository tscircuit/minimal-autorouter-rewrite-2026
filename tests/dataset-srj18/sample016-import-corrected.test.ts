import {expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {readFile} from "node:fs/promises"
import {Pipeline9} from "../../lib/Pipeline9"
import {Pipeline9_Networked} from "../../lib/Pipeline9_Networked"
import type {SimpleRouteJson} from "../../lib/types"
import {createHdCache2Service} from "../../scripts/network-server"
import {assertNoPcbIssues} from "../../scripts/validation/validateSrjWithChecks"
import {getVerifiedSourceGeometry} from "../../scripts/validation/sourceGeometry"

const originalUrl = new URL("../../datasets/dataset-srj18/sample016.json",import.meta.url)
const correctedUrl = new URL("../../imports/dataset-srj18/sample016.corrected.srj.json",import.meta.url)
const originalHash = "f323b21b2d833b61149d5041c04af8575c77b8cd3bb3340cba36c017872e6bf3"
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const corrections = [
  {id:"pcb_smtpad_62", componentId:"pcb_component_33", x:-1.793115, y:-7.34032},
  {id:"pcb_smtpad_63", componentId:"pcb_component_33", x:-1.793115, y:-14.140321},
  {id:"pcb_smtpad_196", componentId:"pcb_component_72", x:-7.793115, y:-7.34032},
  {id:"pcb_smtpad_197", componentId:"pcb_component_72", x:-7.793115, y:-14.140321},
]

async function loadCorrectedInput() {
  const [originalBytes, correctedBytes] = await Promise.all([readFile(originalUrl),readFile(correctedUrl)])
  expect(sha256(originalBytes)).toBe(originalHash)
  const original = JSON.parse(originalBytes.toString()) as SimpleRouteJson
  const corrected = JSON.parse(correctedBytes.toString()) as SimpleRouteJson
  const restored = structuredClone(corrected)
  for (const correction of corrections) {
    // Ownership is the first ID, not an alias propagated to other pads on this net.
    const matches = restored.obstacles.filter(obstacle => obstacle.connectedTo[0] === correction.id)
    expect(matches).toHaveLength(1)
    const pad = matches[0]!
    expect(pad).toMatchObject({type:"rect",componentId:correction.componentId,
      center:{x:correction.x,y:correction.y},width:5.3,height:2.5,layers:["top"]})
    expect(pad.ccwRotationDegrees ?? 0).toBe(0)
    pad.width = 2.5
    pad.height = 5.3
  }
  // The import correction changes only four dimension pairs. Net membership,
  // requested terminals, unrelated pads, board geometry and rules stay authoritative.
  expect(restored).toEqual(original)
  const terminal = corrected.connections.find(connection => connection.name === "source_net_15")!
    .pointsToConnect.find(point => point.pcb_port_id === "pcb_port_183")!
  expect(terminal).toMatchObject({x:-1.843115,y:-5.06532,layer:"top"})
  const ownPad = corrected.obstacles.find(obstacle => obstacle.connectedTo[0] === "pcb_smtpad_183")!
  const nearbyPad = corrected.obstacles.find(obstacle => obstacle.connectedTo[0] === "pcb_smtpad_62")!
  expect(ownPad).toMatchObject({type:"oval",center:{x:terminal.x,y:terminal.y},width:0.75,height:0.75,layers:["top"]})
  expect(ownPad.connectedTo).toContain("source_net_15")
  expect(nearbyPad.connectedTo).toContain("source_net_12")
  expect(nearbyPad.connectedTo).not.toContain("source_net_15")
  expect(Math.abs(terminal.y-nearbyPad.center.y)-ownPad.height/2-nearbyPad.height/2).toBeGreaterThan(0)
  return {corrected,originalBytes,correctedBytes}
}

async function assertCompleteOutput(solver: Pipeline9, input: SimpleRouteJson, originalBytes: Uint8Array, label: string) {
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const requiredTasks = solver.getRoutingProblem().tasks
  expect(requiredTasks.length).toBeGreaterThan(0)
  const routes = solver.getOutputSimplifiedPcbTraces()
  expect(routes).toHaveLength(requiredTasks.length)
  const output = solver.getOutputSimpleRouteJson()
  const sourceGeometry = getVerifiedSourceGeometry({originalSrjBytes:originalBytes,
    routedSrj:output,expectedOriginalSrjSha256:originalHash})
  expect(sourceGeometry).toBeDefined()
  // This verifies every physical request, source preservation, and all strict
  // PCB checks, with provenance-backed NPTH geometry from unchanged source holes.
  await assertNoPcbIssues(output,label,{originalSrj:input,sourceGeometry})
  const terminal = JSON.stringify(output), iterations = solver.iterations
  solver.step()
  expect(solver.iterations).toBe(iterations)
  expect(JSON.stringify(solver.getOutputSimpleRouteJson())).toBe(terminal)
  return output
}

test("corrected sample016: all physical requests route cleanly while preserving the verified import", async () => {
  const {corrected,originalBytes,correctedBytes} = await loadCorrectedInput()
  const before = JSON.stringify(corrected), solver = new Pipeline9(corrected,{effort:1,cacheProvider:null})
  const deadline = performance.now()+290_000
  while (!solver.solved && !solver.failed) {
    if (performance.now() >= deadline) throw new Error("Corrected sample016 exceeded the 290-second routing deadline")
    solver.step()
  }
  await assertCompleteOutput(solver,corrected,originalBytes,"Corrected sample016 local")
  expect(JSON.stringify(corrected)).toBe(before)
  expect(await readFile(originalUrl)).toEqual(originalBytes)
  expect(await readFile(correctedUrl)).toEqual(correctedBytes)
},300_000)

test("corrected sample016: actual cold and hot network execution preserves clean copper and cache accounting", async () => {
  const {corrected,originalBytes,correctedBytes} = await loadCorrectedInput()
  const before = JSON.stringify(corrected), service = createHdCache2Service()
  const deadline = performance.now()+290_000
  let timer: ReturnType<typeof setTimeout> | undefined
  const solveNetwork = async (solver: Pipeline9_Networked) => {
    const run = async () => {
      while (!solver.solved && !solver.failed) {
        if (performance.now() >= deadline) throw new Error("Corrected sample016 network regression exceeded 290 seconds")
        await solver.stepAsync()
      }
      await solver.highDensityRouteSolver?.waitForAllRemoteRequests()
    }
    try {
      await Promise.race([run(),new Promise<never>((_,reject) => {
        timer = setTimeout(() => reject(new Error("Corrected sample016 network regression exceeded 290 seconds")),Math.max(0,deadline-performance.now()))
      })])
    } finally {if (timer) clearTimeout(timer)}
  }
  try {
    const options = {effort:1 as const,cacheProvider:null,hdCache2ServerUrl:service.server.url.toString(),
      hdCache2CacheVersion:"sample016-verified-import"}
    expect(service.stats.solverRuns).toBe(0)
    const cold = new Pipeline9_Networked(corrected,options)
    await solveNetwork(cold)
    const coldOutput = await assertCompleteOutput(cold,corrected,originalBytes,"Corrected sample016 network cold")
    expect(cold.highDensityRouteSolver!.stats).toMatchObject({remoteRequestsStarted:1,remoteRequestsCompleted:1,
      remoteBoardResults:1,remoteSolverResults:1,remoteCacheHits:0,remoteTransportFallbacks:0,
      remoteLogicalTimeoutFallbacks:0,remoteUnsupportedInputs:0})
    expect(service.stats).toMatchObject({solverRuns:1,boardSolverRuns:1,nodeSolverRuns:0,cacheHits:0})
    expect(service.cache.size).toBe(1)
    const afterCold = {...service.stats}

    const hot = new Pipeline9_Networked(corrected,options)
    await solveNetwork(hot)
    const hotOutput = await assertCompleteOutput(hot,corrected,originalBytes,"Corrected sample016 network hot")
    expect(hot.highDensityRouteSolver!.stats).toMatchObject({remoteRequestsStarted:1,remoteRequestsCompleted:1,
      remoteBoardResults:1,remoteSolverResults:0,remoteCacheHits:1,remoteTransportFallbacks:0,
      remoteLogicalTimeoutFallbacks:0,remoteUnsupportedInputs:0})
    expect(service.stats.solverRuns-afterCold.solverRuns).toBe(0)
    expect(service.stats.boardSolverRuns-afterCold.boardSolverRuns).toBe(0)
    expect(service.stats.cacheHits-afterCold.cacheHits).toBe(1)
    expect(hotOutput).toEqual(coldOutput)
    expect(JSON.stringify(corrected)).toBe(before)
    expect(await readFile(originalUrl)).toEqual(originalBytes)
    expect(await readFile(correctedUrl)).toEqual(correctedBytes)
  } finally {
    if (timer) clearTimeout(timer)
    service.server.stop(true)
  }
},300_000)
