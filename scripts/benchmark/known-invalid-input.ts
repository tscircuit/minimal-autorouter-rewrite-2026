import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { BenchmarkResult } from "./types"

/** A fixed source-geometry certificate, never a configurable benchmark exclusion. */
export const knownInvalidInput = {
  dataset: "dataset-srj18", sample: "sample016",
  sha256: "f323b21b2d833b61149d5041c04af8575c77b8cd3bb3340cba36c017872e6bf3",
  document: "docs/known-input-limitations.md",
} as const

interface Source {
  obstacles: Array<{ obstacleId?: string; type: string; center: { x: number; y: number }; width: number; height: number; ccwRotationDegrees?: number; layers: string[]; connectedTo: string[]; offBoardConnectsTo?: string[] }>
  connections: Array<{ name: string; rootConnectionName?: string; netConnectionName?: string; __netConnectionName?: string; mergedConnectionNames?: string[]; __rootConnectionNames?: string[]; pointsToConnect: Array<{ x: number; y: number; layer?: string; layers?: string[]; pointId?: string; pcb_port_id?: string }> }>
  traces?: Array<{ pcb_trace_id: string; connection_name?: string; connectsTo?: string[] }>
}
function requireProof(value: unknown, detail: string): asserts value {
  if (!value) throw new Error(`Known invalid input certificate failed: ${detail}`)
}

/** Re-check fixed copper independently of every routing implementation. */
export async function verifyKnownInvalidInput(): Promise<{ terminalNetAliases: string[] }> {
  const bytes = await readFile(new URL("../../datasets/dataset-srj18/sample016.json", import.meta.url))
  requireProof(createHash("sha256").update(bytes).digest("hex") === knownInvalidInput.sha256, "source SHA-256 changed")
  const source = JSON.parse(bytes.toString()) as Source
  const terminal = source.connections.find(connection => connection.name === "source_net_15")?.pointsToConnect.find(point => point.pcb_port_id === "pcb_port_183")
  requireProof(terminal && terminal.x === -1.843115 && terminal.y === -5.06532 && terminal.layer === "top", "terminal geometry")
  requireProof(!terminal.layers || (terminal.layers.length === 1 && terminal.layers[0] === "top"), "terminal must require the top layer")
  const own = source.obstacles.find(pad => pad.connectedTo.includes("pcb_smtpad_183") && pad.center.x === terminal.x && pad.center.y === terminal.y)
  const foreign = source.obstacles.find(pad => pad.connectedTo.includes("pcb_smtpad_62") && pad.center.x === -1.793115 && pad.center.y === -7.34032)
  requireProof(own && own.type === "oval" && own.width === 0.75 && own.height === 0.75 && own.layers.length === 1 && own.layers[0] === "top", "own pad geometry")
  requireProof(foreign && foreign.type === "rect" && foreign.width === 2.5 && foreign.height === 5.3 && (foreign.ccwRotationDegrees ?? 0) === 0 && foreign.layers.length === 1 && foreign.layers[0] === "top", "foreign pad geometry")
  const radius = own.width / 2
  requireProof(Math.abs(terminal.x - foreign.center.x) + radius <= foreign.width / 2 + 1e-9 && Math.abs(terminal.y - foreign.center.y) + radius <= foreign.height / 2 + 1e-9, "entire own pad must be contained in foreign copper")
  // Declared aliases form equivalence classes; geometric overlap does not.
  const components: Set<string>[] = []
  const connect = (values: Array<string | undefined>): void => {
    const names = new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))
    if (!names.size) return
    for (let index = components.length - 1; index >= 0; index--) {
      if ([...components[index]!].some(name => names.has(name))) {
        for (const name of components[index]!) names.add(name)
        components.splice(index, 1)
      }
    }
    components.push(names)
  }
  for (const pad of source.obstacles) connect([pad.obstacleId, ...pad.connectedTo, ...(pad.offBoardConnectsTo ?? [])])
  for (const connection of source.connections) connect([connection.name, connection.rootConnectionName, connection.netConnectionName, connection.__netConnectionName, ...(connection.mergedConnectionNames ?? []), ...(connection.__rootConnectionNames ?? []), ...connection.pointsToConnect.flatMap(point => [point.pointId, point.pcb_port_id])])
  for (const trace of source.traces ?? []) connect([trace.pcb_trace_id, trace.connection_name, ...(trace.connectsTo ?? [])])
  const intended = components.find(group => group.has("source_net_15"))
  const unrelated = components.find(group => group.has("source_net_12"))
  requireProof(intended && unrelated && intended !== unrelated && intended.has("pcb_port_183") && intended.has("pcb_smtpad_183") && unrelated.has("pcb_smtpad_62"), "pad identities must belong to distinct intended nets")
  return { terminalNetAliases: [...intended] }
}

/** Only a matching, explicit infeasibility result qualifies. */
export async function acceptsKnownInvalidFailure(baseline: BenchmarkResult, candidate: BenchmarkResult): Promise<boolean> {
  if (baseline.dataset !== knownInvalidInput.dataset || candidate.dataset !== knownInvalidInput.dataset || baseline.sample !== knownInvalidInput.sample || candidate.sample !== knownInvalidInput.sample || baseline.sha256 !== knownInvalidInput.sha256 || candidate.sha256 !== knownInvalidInput.sha256) return false
  if (!baseline.didSolve || baseline.relaxedDrcPassed || !(baseline.drcErrorCount! > 0) || candidate.didSolve || candidate.didTimeout || candidate.relaxedDrcPassed) return false
  const proof = await verifyKnownInvalidInput()
  const witness = candidate.inputContradiction ?? (candidate.networkStats as Record<string, unknown> | undefined)?.terminalContradiction
  if (!witness || typeof witness !== "object") return false
  const { kind, terminal, terminalNet, eligibleLayers, blockingObstacles } = witness as Record<string, any>
  return kind === "terminal-inside-unrelated-copper" && terminal?.pcb_port_id === "pcb_port_183" && terminal.x === -1.843115 && terminal.y === -5.06532 && proof.terminalNetAliases.includes(terminalNet) && Array.isArray(eligibleLayers) && eligibleLayers.length === 1 && eligibleLayers[0] === "top" && Array.isArray(blockingObstacles) && blockingObstacles.some(obstacle => obstacle?.layer === "top" && obstacle?.obstacleId === "pcb_smtpad_62") && candidate.error?.includes("pcb_port_183") === true && candidate.error.includes("pcb_smtpad_62")
}
