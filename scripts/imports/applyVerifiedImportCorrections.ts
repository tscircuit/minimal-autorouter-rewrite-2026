import {createHash} from "node:crypto"
import {readFileSync} from "node:fs"
import {isDeepStrictEqual} from "node:util"
import type {Obstacle, SimpleRouteJson} from "../../lib/types"

type Bytes = string | Uint8Array
type Element = Record<string, unknown>
export const SOURCE_ROTATION_AUDIT_SHA256 = "b105757f0f13aaf841ad8487d1bd66c0ae3b31aa01563a8d30d1fc98881ab913"
export const sourceRotationAuditBytes = readFileSync(new URL("../../imports/source-rotation-audit.json", import.meta.url))
export const sha256 = (bytes: Bytes): string => createHash("sha256").update(bytes).digest("hex")
const decode = (bytes: Bytes): string => typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes)
export const formatImportedJson = (value: unknown): string => JSON.stringify(value, null, 2) + "\n"
function requireProof(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Import correction: ${message}`)
}
requireProof(sha256(sourceRotationAuditBytes) === SOURCE_ROTATION_AUDIT_SHA256, "rotation audit byte hash changed")

export interface RectangularPadEvidence {
  type: string
  shape: string
  angle: number
  size: number[]
  rectDelta: number[]
}
type Correction = {
  sample: string
  sourceCommit: string
  originalSrjSha256: string
  sourceCircuitJsonSha256: string
  sourceKicadSha256: string
  sourceKicadPath: string
  sourceCircuitJsonPath: string
  obstacleIndex: number
  expectedOriginalObstacle: Obstacle
  correctedObstacle: Obstacle
  circuitJsonPadId: string
  circuitJsonComponentId: string
  circuitJsonPortId: string
  originalCircuitJsonPad: Element
  kicad: RectangularPadEvidence
}
type Audit = {version: number; sourceRepository: string; sourceCommit: string; corrections: Correction[]}
const audit = JSON.parse(sourceRotationAuditBytes.toString()) as Audit
requireProof(audit.version === 1 && audit.corrections.length === 4, "unsupported rotation audit")
const first = audit.corrections[0]!
requireProof(first.sample === "sample016" && audit.corrections.every(item =>
  item.sample === first.sample && item.sourceCommit === audit.sourceCommit &&
  item.originalSrjSha256 === first.originalSrjSha256 && item.sourceCircuitJsonSha256 === first.sourceCircuitJsonSha256 &&
  item.sourceKicadSha256 === first.sourceKicadSha256 && item.sourceKicadPath === first.sourceKicadPath &&
  item.sourceCircuitJsonPath === first.sourceCircuitJsonPath), "inconsistent source identity")
requireProof(new Set(audit.corrections.map(item => item.obstacleIndex)).size === audit.corrections.length &&
  new Set(audit.corrections.map(item => item.circuitJsonPadId)).size === audit.corrections.length, "duplicate correction identity")

/** An untapered KiCad trapezoid is exactly a rectangle; other shapes need separate proof. */
export function deriveCorrectedRectangle(evidence: RectangularPadEvidence): {width: number; height: number} {
  requireProof(evidence.type === "smd" && evidence.shape === "trapezoid", "unsupported pad type or shape")
  requireProof(evidence.size.length === 2 && evidence.size.every(value => Number.isFinite(value) && value > 0), "invalid pad size")
  requireProof(evidence.rectDelta.length === 2 && evidence.rectDelta.every(value => value === 0), "nonzero trapezoid taper is unsupported")
  requireProof(Number.isFinite(evidence.angle), "invalid pad angle")
  const turns = evidence.angle / 90
  requireProof(Math.abs(turns - Math.round(turns)) < 1e-9, "non-quarter-turn angle is unsupported")
  const swap = Math.abs(Math.round(turns)) % 2 === 1
  return {width: evidence.size[swap ? 1 : 0]!, height: evidence.size[swap ? 0 : 1]!}
}

/** Accept only the original pinned bytes; change only the four proven width/height pairs. */
export function applyVerifiedImportCorrections(originalBytes: Bytes): SimpleRouteJson {
  requireProof(sha256(originalBytes) === first.originalSrjSha256, "original SRJ byte hash does not match the audited source")
  const original = JSON.parse(decode(originalBytes)) as SimpleRouteJson
  for (const correction of audit.corrections) {
    const obstacle = original.obstacles[correction.obstacleIndex]
    requireProof(isDeepStrictEqual(obstacle, correction.expectedOriginalObstacle), `obstacle ${correction.obstacleIndex} differs from the audited original`)
    requireProof(obstacle!.componentId === correction.circuitJsonComponentId &&
      obstacle!.connectedTo[0] === correction.circuitJsonPadId, "obstacle identity does not match source pad")
    const updated = {...obstacle!, ...deriveCorrectedRectangle(correction.kicad)}
    requireProof(isDeepStrictEqual(updated, correction.correctedObstacle), "derived dimensions disagree with the audited correction")
    original.obstacles[correction.obstacleIndex] = updated
  }
  return original
}

/** Keep all original Circuit JSON elements, changing only the same pad dimensions. */
export function applyVerifiedCircuitJsonImportCorrections(originalBytes: Bytes): Element[] {
  requireProof(sha256(originalBytes) === first.sourceCircuitJsonSha256, "original Circuit JSON byte hash does not match the audited source")
  const elements = JSON.parse(decode(originalBytes)) as Element[]
  requireProof(Array.isArray(elements), "invalid original Circuit JSON")
  for (const correction of audit.corrections) {
    const indices = elements.flatMap((element, index) =>
      element.type === "pcb_smtpad" && element.pcb_smtpad_id === correction.circuitJsonPadId ? [index] : [])
    requireProof(indices.length === 1, "source pad is missing or ambiguous")
    const index = indices[0]!, original = elements[index]!
    requireProof(isDeepStrictEqual(original, correction.originalCircuitJsonPad), "source pad identity or geometry changed")
    requireProof(original.pcb_component_id === correction.circuitJsonComponentId &&
      original.pcb_port_id === correction.circuitJsonPortId, "source pad component or port changed")
    elements[index] = {...original, ...deriveCorrectedRectangle(correction.kicad)}
  }
  return elements
}

export function verifyOriginalKicadBytes(bytes: Bytes): void {
  requireProof(sha256(bytes) === first.sourceKicadSha256, "original KiCad byte hash does not match the audited source")
}

export function createImportManifest(correctedSrjBytes: Bytes) {
  return {
    version: 1,
    audit: {path: "source-rotation-audit.json", sha256: SOURCE_ROTATION_AUDIT_SHA256},
    corrections: [{
      dataset: "dataset-srj18", sample: first.sample,
      originalSrjSha256: first.originalSrjSha256,
      correctedSrjSha256: sha256(correctedSrjBytes),
      path: `dataset-srj18/${first.sample}.corrected.srj.json`,
      sourceRepository: audit.sourceRepository,
      sourceCommit: audit.sourceCommit,
      sourceKicad: {path: first.sourceKicadPath, sha256: first.sourceKicadSha256},
      sourceCircuitJson: {path: first.sourceCircuitJsonPath, sha256: first.sourceCircuitJsonSha256},
      changedObstacleIndices: audit.corrections.map(item => item.obstacleIndex),
    }],
  }
}

export const importSourcePaths = Object.freeze({
  srj: `samples/${first.sample}.json`,
  circuitJson: first.sourceCircuitJsonPath,
  kicad: first.sourceKicadPath,
})
