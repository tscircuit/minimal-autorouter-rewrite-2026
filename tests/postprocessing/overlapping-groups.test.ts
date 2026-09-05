import { expect, test } from "bun:test"
import { LengthMatchingSolver } from "../../lib/postprocessing/LengthMatchingSolver"
import { lengthProblem, measuredLength, straightTrace } from "./fixtures"

test("overlapping buses propagate length requirements before placing meanders", () => {
  const traces = [straightTrace("long", 10, 0), straightTrace("middle", 8, 3), straightTrace("short", 4, 6)]
  const solver = new LengthMatchingSolver(lengthProblem(traces, {
    bounds: { minX: -1, maxX: 12, minY: -4, maxY: 12 },
    buses: [
      { busId: "second", connectionNames: ["middle", "short"], maxLengthSkew: 0.1 },
      { busId: "first", connectionNames: ["long", "middle"], maxLengthSkew: 0.1 },
    ],
  }), traces)
  solver.solve()
  expect(solver.solved).toBe(true)
  const lengths = solver.routes.map(measuredLength)
  expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.1)
  expect(Math.abs(lengths[1]! - lengths[2]!)).toBeLessThanOrEqual(0.1)
  expect(lengths[2]).toBeGreaterThan(9.8)
})
