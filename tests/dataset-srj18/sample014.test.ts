import { expect, test } from "bun:test"
import sample from "../../datasets/dataset-srj18/sample014.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { Pipeline9 } from "../../lib/Pipeline9"
import { RoutingSolver } from "../../lib/routing/RoutingSolver"
import { assertOutputConnectivity } from "./assertSample"
import { assertPartialRoutes } from "./assertPartialRoutes"

test("dataset-srj18 sample014: complete connectivity or bounded honest failure with valid retained copper", () => {
  const source=sample as SimpleRouteJson,input=structuredClone(source),before=JSON.stringify(input)
  const solver=new Pipeline9(input,{cacheProvider:null,effort:1}),deadline=performance.now()+290_000
  while(!solver.solved&&!solver.failed) {
    expect(performance.now()).toBeLessThan(deadline)
    solver.step()
  }
  expect(JSON.stringify(input)).toBe(before)
  expect(solver.solved).not.toBe(solver.failed)
  if(solver.solved) {
    const output=solver.getOutputSimpleRouteJson()
    assertOutputConnectivity(source,output)
    assertPartialRoutes(source,output.traces??[])
  } else {
    const stage=solver.highDensityRouteSolver!,engine=stage.activeSubSolver
    expect(engine).toBeInstanceOf(RoutingSolver)
    const routing=engine as RoutingSolver,traces=stage.getSimplifiedTraces(),unfinished=new Set(routing.unroutedTaskIds)
    expect(routing.failed).toBe(true);expect(routing.solved).toBe(false)
    expect(solver.error).toContain("Could not route")
    expect(solver.error).toContain(String(unfinished.size))
    expect(unfinished.size).toBeGreaterThan(0)
    expect(traces.length).toBeGreaterThan(unfinished.size)
    expect(routing.stats.terminalContradiction).toBeUndefined()
    const required=new Set(stage.problem.tasks.map(task=>task.id)),retained=new Set(traces.map(trace=>trace.pcb_trace_id))
    expect(unfinished.size).toBe(routing.unroutedTaskIds.length)
    expect(required.size).toBe(retained.size+unfinished.size)
    for(const task of stage.problem.tasks) expect(Number(retained.has(`minimal_${task.id}`))+Number(unfinished.has(task.id))).toBe(1)
    for(const id of unfinished) expect(required.has(id)).toBe(true)
    assertPartialRoutes(source,traces)
    expect(()=>solver.getOutputSimpleRouteJson()).toThrow("before solving is complete")
    expect(()=>solver.getOutputSimplifiedPcbTraces()).toThrow("before solving is complete")
  }
  const iterations=solver.iterations,solved=solver.solved,failed=solver.failed
  solver.step()
  expect(solver.iterations).toBe(iterations);expect(solver.solved).toBe(solved);expect(solver.failed).toBe(failed)
},300_000)
