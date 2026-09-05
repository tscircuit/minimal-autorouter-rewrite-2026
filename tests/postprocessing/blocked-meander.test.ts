import { expect, test } from "bun:test"
import { LengthMatchingSolver } from "../../lib/postprocessing/LengthMatchingSolver"
import { lengthProblem, measuredLength, straightTrace } from "./fixtures"

test("a board with no transverse copper room fails instead of claiming matched lengths", () => {
  const traces = [straightTrace("long", 8, 0, 0.2, "bottom"), straightTrace("short", 4, 0, 0.2)]
  const solver = new LengthMatchingSolver(lengthProblem(traces, {
    bounds: { minX: -1, maxX: 10, minY: -0.1, maxY: 0.1 },
    buses: [{ busId: "no-room", connectionNames: ["long", "short"], maxLengthSkew: 0.1 }],
  }), traces)
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("no tested meander fits")
  expect(measuredLength(solver.routes[1]!)).toBe(4)
})
