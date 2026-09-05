import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import sample from "../../datasets/dataset-srj18/sample016.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import { Pipeline9 } from "../../lib/Pipeline9"

test("dataset-srj18 sample016: certifies the existing cross-net pad short and reports infeasibility", () => {
  const source = sample as SimpleRouteJson
  const bytes = readFileSync(new URL("../../datasets/dataset-srj18/sample016.json", import.meta.url))
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("f323b21b2d833b61149d5041c04af8575c77b8cd3bb3340cba36c017872e6bf3")
  const connection = source.connections.find(connection => connection.name === "source_net_15")!
  const terminal = connection.pointsToConnect.find(point => point.pcb_port_id === "pcb_port_183")!
  expect(terminal).toMatchObject({ x: -1.843115, y: -5.06532, layer: "top" })
  const ownPad = source.obstacles.find(obstacle => obstacle.connectedTo.includes("pcb_smtpad_183") &&
    obstacle.center.x === terminal.x && obstacle.center.y === terminal.y)!
  const otherPad = source.obstacles.find(obstacle => obstacle.connectedTo.includes("pcb_smtpad_62") &&
    obstacle.center.x === -1.793115 && obstacle.center.y === -7.34032)!
  expect(ownPad).toMatchObject({ type: "oval", width: 0.75, height: 0.75, layers: ["top"] })
  expect(otherPad).toMatchObject({ type: "rect", width: 2.5, height: 5.3, layers: ["top"] })
  expect(otherPad.ccwRotationDegrees ?? 0).toBe(0)
  expect(otherPad.connectedTo).toContain("source_net_12")
  const radius = ownPad.width / 2
  expect(Math.abs(terminal.x - otherPad.center.x) + radius).toBeLessThanOrEqual(otherPad.width / 2 + 1e-9)
  expect(Math.abs(terminal.y - otherPad.center.y) + radius).toBeLessThanOrEqual(otherPad.height / 2 + 1e-9)

  // Independently check electrical aliases. Geometric overlap must not merge intended nets.
  const parent = new Map<string, string>()
  const root = (name: string): string => {
    const next = parent.get(name)
    if (next === undefined || next === name) { parent.set(name, name); return name }
    const result = root(next); parent.set(name, result); return result
  }
  const join = (identities: Array<string | undefined>) => {
    const names = identities.filter((name): name is string => Boolean(name))
    for (const name of names.slice(1)) parent.set(root(name), root(names[0]!))
  }
  for (const obstacle of source.obstacles) join([obstacle.obstacleId, ...obstacle.connectedTo, ...(obstacle.offBoardConnectsTo ?? [])])
  for (const connection of source.connections) join([connection.name, connection.rootConnectionName,
    connection.netConnectionName, connection.__netConnectionName, ...(connection.mergedConnectionNames ?? []),
    ...(connection.__rootConnectionNames ?? []), ...connection.pointsToConnect.flatMap(point => [point.pointId, point.pcb_port_id])])
  for (const trace of source.traces ?? []) join([trace.pcb_trace_id, trace.connection_name, ...(trace.connectsTo ?? [])])
  expect(root("source_net_15")).not.toBe(root("source_net_12"))
  expect(root("pcb_port_183")).toBe(root("source_net_15"))
  expect(root("pcb_smtpad_62")).toBe(root("source_net_12"))

  const input = structuredClone(source), snapshot = JSON.stringify(input)
  const solver = new Pipeline9(input, { cacheProvider: null, effort: 1 })
  const deadline = performance.now() + 10_000
  while (!solver.solved && !solver.failed) {
    if (performance.now() > deadline) throw new Error("An infeasible terminal must be diagnosed before geometric route search")
    solver.step()
  }
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toContain("pcb_port_183")
  expect(solver.error).toContain("pcb_smtpad_62")
  const certificate = solver.highDensityRouteSolver?.stats.terminalContradiction
  expect(certificate).toMatchObject({ kind: "terminal-inside-unrelated-copper", eligibleLayers: ["top"],
    terminal: { x: -1.843115, y: -5.06532, pcb_port_id: "pcb_port_183" } })
  expect(root(certificate.terminalNet)).toBe(root("source_net_15"))
  expect(certificate.blockingObstacles).toContainEqual(expect.objectContaining({ layer: "top", obstacleId: "pcb_smtpad_62" }))
  expect(JSON.stringify(input)).toBe(snapshot)
  expect(() => solver.getOutputSimpleRouteJson()).toThrow()
}, 15_000)
