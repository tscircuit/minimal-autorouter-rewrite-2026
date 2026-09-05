import { expect, test } from "bun:test"
import { LengthMatchingSolver } from "../../lib/postprocessing/LengthMatchingSolver"
import { lengthProblem, measuredLength, straightTrace } from "./fixtures"

test("an 8 mm / 4 mm bus gains physical length at its routed width", () => {
  const traces = [straightTrace("long", 8, 0, 0.4), straightTrace("short", 4, 3, 0.4)]
  const original = JSON.stringify(traces)
  const solver = new LengthMatchingSolver(lengthProblem(traces, { buses: [{ busId: "data", connectionNames: ["long", "short"], maxLengthSkew: 0.1 }] }), traces)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(Math.abs(measuredLength(solver.routes[0]!) - measuredLength(solver.routes[1]!))).toBeLessThanOrEqual(0.1)
  expect(measuredLength(solver.routes[0]!)).toBe(8)
  expect(measuredLength(solver.routes[1]!)).toBeGreaterThan(7.9)
  expect(solver.routes[1]!.route.every((point) => point.route_type === "wire" && point.width === 0.4)).toBe(true)
  expect(solver.routes[1]!.route[0]).toEqual(traces[1]!.route[0])
  expect(solver.routes[1]!.route.at(-1)).toEqual(traces[1]!.route.at(-1))
  expect(JSON.stringify(traces)).toBe(original)
})
