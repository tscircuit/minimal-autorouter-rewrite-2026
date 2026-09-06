import { expect, test } from "bun:test"
import sample from "../../datasets/dataset-srj18/sample014.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { Pipeline9 } from "../../lib/Pipeline9"
import { assertOutputConnectivity } from "./assertSample"
import { assertPartialRoutes } from "./assertPartialRoutes"
import { assertNoPcbIssues } from "../../scripts/validation/validateSrjWithChecks"

test("dataset-srj18 sample014: complete routing with continuous copper and zero PCB issues", async () => {
  const source = sample as SimpleRouteJson
  const input = structuredClone(source)
  const before = JSON.stringify(input)
  const solver = new Pipeline9(input, { cacheProvider: null, effort: 1 })
  const deadline = performance.now() + 290_000
  while (!solver.solved && !solver.failed) {
    if (performance.now() > deadline) throw new Error("sample014 routing exceeded 290 seconds")
    solver.step()
  }
  expect(JSON.stringify(input)).toBe(before)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutputSimpleRouteJson()
  assertOutputConnectivity(source, output)
  assertPartialRoutes(source, output.traces ?? [])
  await assertNoPcbIssues(output, "dataset-srj18/sample014")
  expect(solver.getOutputSimpleRouteJson()).toEqual(output)
  const iterations = solver.iterations
  solver.step()
  expect(solver.iterations).toBe(iterations)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
}, 300_000)
