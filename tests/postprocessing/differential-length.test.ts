import { expect, test } from "bun:test"
import { LengthMatchingSolver } from "../../lib/postprocessing/LengthMatchingSolver"
import { lengthProblem, measuredLength, straightTrace } from "./fixtures"

test("differential length tolerance is measured from final copper geometry", () => {
  const traces = [straightTrace("positive", 8, 0), straightTrace("negative", 4, 3)]
  const solver = new LengthMatchingSolver(lengthProblem(traces, { differentialPairs: [{ connectionNames: ["positive", "negative"], lengthTolerance: 0.01 }] }), traces)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(Math.abs(measuredLength(solver.routes[0]!) - measuredLength(solver.routes[1]!))).toBeLessThanOrEqual(0.01)
  expect(solver.routes[1]!.route.length).toBeGreaterThan(2)
})
