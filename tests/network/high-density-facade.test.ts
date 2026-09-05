import { expect, test } from "bun:test"
import { HighDensityRoutingStage } from "../../lib/HighDensityRoutingStage"
import { Pipeline9NetworkedHighDensitySolver } from "../../lib/network/Pipeline9NetworkedHighDensitySolver"
import { Pipeline9NetworkedHighDensitySolver as DeepImportStage } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import { PrepareBoardSolver } from "../../lib/preparation/PrepareBoardSolver"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { getPendingEffectsFromSolverTree } from "../../lib/solvers/getPendingEffectsFromSolverTree"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "../../lib/types"
import { createHdCache2Service } from "../../scripts/network-server"

const problem = () => {
  const source: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [],
    connections: [{ name: "signal", pointsToConnect: [{ x: -2, y: 0, layer: "top", pcb_port_id: "start" },
      { x: 2, y: 0, layer: "bottom", pcb_port_id: "end" }] }] }
  const preparation = new PrepareBoardSolver(source, { effort: 1, viaDiameter: 0.3, viaHoleDiameter: 0.15 })
  preparation.solve()
  return preparation.getProblem()
}

test("local stage exposes numeric HD routes and keeps simplified traces available for assembly", () => {
  const stage = new HighDensityRoutingStage(problem())
  expect(stage.routes).toEqual([])
  expect(stage.activeSubSolver).toBeInstanceOf(BaseSolver)
  stage.solve()
  expect(stage.solved).toBe(true)
  expect(stage.stats).toBe(stage.activeSubSolver!.stats)
  expect(stage.iterations).toBe(stage.activeSubSolver!.iterations)
  const hd = stage.routes[0]!
  expect(hd).toMatchObject({ connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3,
    startPcbPortId: "start", endPcbPortId: "end" })
  expect(hd.route.every(point => Number.isInteger(point.z) && !("route_type" in point))).toBe(true)
  expect(hd.route[0]!.z).toBe(0)
  expect(hd.route.at(-1)!.z).toBe(1)
  expect(hd.vias.length).toBeGreaterThan(0)
  expect(stage.getSimplifiedTraces()[0]!.route.some(entry => entry.route_type === "via")).toBe(true)
  const engineX = stage.getSimplifiedTraces()[0]!.route[0]!
  hd.route[0]!.x = 100
  expect(stage.routes[0]!.route[0]!.x).toBe(-2)
  expect("x" in engineX && engineX.x).toBe(-2)
  expect(stage.visualize().lines.length).toBeGreaterThan(0)
})

test("facade forwards structured failure evidence from the actual underlying solver", () => {
  const input = problem()
  class FailedEngine extends BaseSolver {
    routes: SimplifiedPcbTrace[] = []
    override _step() { this.failed = true; this.error = "specific routing failure"; this.stats = { witness: "concrete" } }
  }
  const engine = new FailedEngine(), stage = new HighDensityRoutingStage(input, engine)
  stage.step()
  expect(stage.failed).toBe(true)
  expect(stage.error).toBe("specific routing failure")
  expect(stage.stats).toBe(engine.stats)
  expect(stage.stats.witness).toBe("concrete")
  expect(stage.failedSubSolvers).toEqual([engine])
})

test("network facade preserves pending effects, route shape, and drained remote statistics", async () => {
  expect(DeepImportStage).toBe(Pipeline9NetworkedHighDensitySolver)
  const service = createHdCache2Service()
  try {
    const stage = new Pipeline9NetworkedHighDensitySolver(problem(), {
      hdCache2ServerUrl: service.server.url.toString(), hdCache2CacheVersion: "facade" })
    stage.step()
    expect(getPendingEffectsFromSolverTree(stage)).toHaveLength(1)
    expect(stage.activeSubSolver).toBeInstanceOf(BaseSolver)
    while (!stage.solved && !stage.failed) {
      const effects = getPendingEffectsFromSolverTree(stage)
      if (effects.length) {
        await Promise.all(effects.map(effect => effect.promise))
        expect(getPendingEffectsFromSolverTree(stage)).toHaveLength(0)
      }
      stage.step()
    }
    await stage.waitForAllRemoteRequests()
    expect(stage.solved).toBe(true)
    expect(getPendingEffectsFromSolverTree(stage)).toHaveLength(0)
    expect(stage.routes[0]!.route.every(point => Number.isInteger(point.z))).toBe(true)
    expect(stage.getSimplifiedTraces()[0]!.type).toBe("pcb_trace")
    expect(stage.stats).toMatchObject({ remoteRequestsStarted: 1, remoteRequestsCompleted: 1,
      remoteBatchRequestsCompleted: 1, remoteSolverResults: 1, remoteTransportFallbacks: 0 })
    expect(stage.stats).toBe(stage.activeSubSolver!.stats)
    expect(stage.visualize().lines.length).toBeGreaterThan(0)
  } finally { service.server.stop(true) }
})
