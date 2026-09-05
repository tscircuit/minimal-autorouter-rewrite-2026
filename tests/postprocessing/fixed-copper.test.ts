import { expect, test } from "bun:test"
import { LengthMatchingSolver } from "../../lib/postprocessing/LengthMatchingSolver"
import { lengthProblem, measuredLength, straightTrace } from "./fixtures"

test("a same-net fixed trace blocks an excursion that would create a length shortcut", () => {
  const traces = [straightTrace("long", 8, 0), straightTrace("short", 4, 3)]
  const fixed = [straightTrace("short", 6, 4)]
  const original = JSON.stringify(fixed)
  const solver = new LengthMatchingSolver(lengthProblem(traces, {
    buses: [{ busId: "data", connectionNames: ["long", "short"], maxLengthSkew: 0.1 }],
  }, fixed), traces)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(measuredLength(solver.routes[1]!)).toBeGreaterThan(7.9)
  expect(solver.routes[1]!.route.every((point) => point.route_type === "wire" && point.y <= 3)).toBe(true)
  expect(JSON.stringify(fixed)).toBe(original)
})
