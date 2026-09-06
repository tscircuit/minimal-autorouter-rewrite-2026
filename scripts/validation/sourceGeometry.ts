import {createHash} from "node:crypto"
import {pcb_hole} from "circuit-json"
import type {Obstacle, SimpleRouteJson} from "../../lib/types"
import manifest from "./source-geometry-manifest.json"
import importManifest from "../../imports/manifest.json"

export interface VerifiedNonPlatedHole {
  readonly type: "pcb_hole"
  readonly pcb_hole_id: string
  readonly hole_shape: "circle"
  readonly x: number
  readonly y: number
  readonly hole_diameter: number
}

export interface VerifiedSourceHoleReplacement {
  readonly obstacleIndex: number
  readonly hole: VerifiedNonPlatedHole
  /** Provenance only: no missing component body is invented. */
  readonly sourceComponentId?: string
}

export interface VerifiedSourceGeometry {
  readonly version: 1
  readonly dataset: "dataset-srj18"
  readonly sample: string
  readonly originalSrjSha256: string
  readonly sourceCircuitJson: {
    readonly repository: string
    readonly commit: string
    readonly path: string
    readonly sha256: string
  }
  readonly holes: readonly VerifiedSourceHoleReplacement[]
  readonly importCorrection?: {
    readonly originalSrjSha256: string
    readonly correctedSrjSha256: string
    readonly audit: {readonly path: string; readonly sha256: string}
    readonly changedObstacleIndices: readonly number[]
    readonly sourceKicad: {readonly path: string; readonly sha256: string}
  }
}

type ManifestSample = typeof manifest.samples[number]
type Proof = {sample: ManifestSample; original: SimpleRouteJson}
const verifiedObjects = new WeakMap<VerifiedSourceGeometry, Proof>()
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const roundSourceCoordinate = (value: number) => Math.round(value * 1e6) / 1e6
function requireMatch(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Source geometry: ${message}`)
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value)) freeze(member)
    Object.freeze(value)
  }
  return value
}
const boardLayers = (count: number) => count === 1 ? ["top"] :
  ["top", ...Array.from({length: count - 2}, (_, i) => `inner${i + 1}`), "bottom"]
const normalizeLayers = (layers: readonly string[], count: number): string[] =>
  [...new Set(layers.filter(layer => boardLayers(count).includes(layer)))].sort()
const sameArray = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, i) => value === b[i])

function verifyEnvelope(obstacle: Obstacle | undefined, sample: ManifestSample, mapping: ManifestSample["holes"][number]): void {
  const expected = mapping.expectedObstacle
  requireMatch(obstacle && obstacle.type === expected.type &&
    obstacle.center?.x === expected.center.x && obstacle.center?.y === expected.center.y &&
    obstacle.width === expected.width && obstacle.height === expected.height &&
    (obstacle.ccwRotationDegrees ?? 0) % 360 === 0 &&
    obstacle.componentId === ("componentId" in expected ? expected.componentId : undefined),
    `${sample.sample} obstacle ${mapping.obstacleIndex} no longer matches the verified hole envelope`)
  requireMatch(Array.isArray(obstacle.layers) && obstacle.layers.every(layer => typeof layer === "string" &&
    (boardLayers(sample.layerCount).includes(layer) || expected.layers.includes(layer))) &&
    sameArray(normalizeLayers(obstacle.layers, sample.layerCount), normalizeLayers(expected.layers, sample.layerCount)),
    `${sample.sample} obstacle ${mapping.obstacleIndex} has different physical layers`)
  // A drill is not copper. A new net, assignable-net flag, or port identity
  // invalidates the proof rather than silently removing that electrical object.
  requireMatch(Array.isArray(obstacle.connectedTo) && obstacle.connectedTo.length === 0 &&
    (obstacle.offBoardConnectsTo === undefined || Array.isArray(obstacle.offBoardConnectsTo) && obstacle.offBoardConnectsTo.length === 0) &&
    (obstacle.isCopperPour === undefined || obstacle.isCopperPour === false) &&
    (obstacle.netIsAssignable === undefined || obstacle.netIsAssignable === false) &&
    obstacle.circuitJsonMetadata?.pcb_port_id === undefined &&
    obstacle.circuitJsonMetadata?.pcb_smtpad_id === undefined &&
    obstacle.circuitJsonMetadata?.pcb_plated_hole_id === undefined &&
    obstacle.circuitJsonMetadata?.pcb_via_id === undefined,
    `${sample.sample} obstacle ${mapping.obstacleIndex} has incompatible electrical ownership`)
}

/**
 * Recheck immediately before consuming a proof. Frozen metadata alone cannot
 * protect a routed SRJ that the caller has changed after verification.
 */
export function assertSourceGeometryMatches(srj: SimpleRouteJson, geometry: VerifiedSourceGeometry): void {
  const proof = verifiedObjects.get(geometry)
  requireMatch(proof, "unverified source geometry object; verify original SRJ bytes first")
  const {sample, original} = proof
  requireMatch(srj.layerCount === sample.layerCount && Array.isArray(srj.obstacles) && srj.obstacles.length === sample.obstacleCount,
    `${sample.sample} board layer or obstacle count changed`)
  requireMatch(srj.bounds && ["minX", "maxX", "minY", "maxY"].every(key =>
    srj.bounds[key as keyof SimpleRouteJson["bounds"]] === original.bounds[key as keyof SimpleRouteJson["bounds"]]) &&
    JSON.stringify(srj.outline) === JSON.stringify(original.outline), `${sample.sample} board geometry changed`)
  for (const mapping of sample.holes) verifyEnvelope(srj.obstacles[mapping.obstacleIndex], sample, mapping)
}

/**
 * Optional validation-only enrichment. The manifest was extracted from the
 * pinned allowed source Circuit JSON by matching each NPTH circle to exactly
 * one unowned SRJ rectangle after the producer's six-decimal rounding.
 * No router input or dataset bytes are modified. Explicit, exact-hash import
 * derivatives can retain their unchanged drill evidence; the correction and
 * original source hashes remain in coverage. Unknown sources stay conservative;
 * a declared/recognized source mismatch is an error.
 */
export function getVerifiedSourceGeometry(input: {
  originalSrjBytes: string | Uint8Array
  routedSrj: SimpleRouteJson
  expectedOriginalSrjSha256?: string
}): VerifiedSourceGeometry | undefined {
  const originalSrjSha256 = digest(input.originalSrjBytes)
  if (input.expectedOriginalSrjSha256 !== undefined)
    requireMatch(originalSrjSha256 === input.expectedOriginalSrjSha256, "original SRJ byte hash does not match the declared hash")
  const original = JSON.parse(typeof input.originalSrjBytes === "string" ? input.originalSrjBytes :
    new TextDecoder().decode(input.originalSrjBytes)) as SimpleRouteJson & {id?: string; sourceCircuitJson?: string}
  const correction = importManifest.corrections.find(candidate => candidate.correctedSrjSha256 === originalSrjSha256)
  const sample = manifest.samples.find(candidate => candidate.originalSrjSha256 ===
    (correction?.originalSrjSha256 ?? originalSrjSha256))
  if (!sample) {
    requireMatch(!manifest.samples.some(candidate => original.id === candidate.sample || original.sourceCircuitJson === candidate.sourceCircuitJson.path),
      "recognized allowed source does not have its pinned original SRJ hash")
    return undefined
  }
  requireMatch(original.layerCount === sample.layerCount && original.obstacles.length === sample.obstacleCount,
    "pinned source does not match its recorded board dimensions")
  if (correction) {
    requireMatch(correction.dataset === "dataset-srj18" && correction.sample === sample.sample &&
      correction.sourceCommit === manifest.sourceCommit &&
      correction.sourceCircuitJson.path === sample.sourceCircuitJson.path &&
      correction.sourceCircuitJson.sha256 === sample.sourceCircuitJson.sha256,
      "import correction does not match the pinned source geometry provenance")
    requireMatch(correction.changedObstacleIndices.every(index => !sample.holes.some(hole => hole.obstacleIndex === index)),
      "an import correction changed a source drill envelope")
  }
  const seen = new Set<number>(), seenIds = new Set<string>()
  for (const mapping of sample.holes) {
    requireMatch(!seen.has(mapping.obstacleIndex) && !seenIds.has(mapping.hole.pcb_hole_id), "duplicate source hole mapping")
    seen.add(mapping.obstacleIndex); seenIds.add(mapping.hole.pcb_hole_id)
    requireMatch(pcb_hole.safeParse(mapping.hole).success && mapping.hole.type === "pcb_hole" && mapping.hole.hole_shape === "circle",
      "invalid source hole geometry")
    const expected = mapping.expectedObstacle
    requireMatch(expected.center.x === roundSourceCoordinate(mapping.hole.x) && expected.center.y === roundSourceCoordinate(mapping.hole.y) &&
      expected.width === roundSourceCoordinate(mapping.hole.hole_diameter) && expected.height === roundSourceCoordinate(mapping.hole.hole_diameter),
      "source hole geometry disagrees with its SRJ envelope")
    verifyEnvelope(original.obstacles[mapping.obstacleIndex], sample, mapping)
  }
  const geometry: VerifiedSourceGeometry = freeze({version: 1, dataset: "dataset-srj18", sample: sample.sample, originalSrjSha256,
    ...(correction ? {importCorrection: {
      originalSrjSha256:correction.originalSrjSha256,
      correctedSrjSha256:correction.correctedSrjSha256,
      audit:{path:`imports/${importManifest.audit.path}`,sha256:importManifest.audit.sha256},
      changedObstacleIndices:[...correction.changedObstacleIndices],
      sourceKicad:{...correction.sourceKicad},
    }} : {}),
    sourceCircuitJson: {repository: manifest.sourceRepository, commit: manifest.sourceCommit,
      path: sample.sourceCircuitJson.path, sha256: sample.sourceCircuitJson.sha256},
    holes: sample.holes.map(mapping => ({obstacleIndex: mapping.obstacleIndex,
      hole: structuredClone(mapping.hole) as VerifiedNonPlatedHole,
      ...("sourceComponentId" in mapping ? {sourceComponentId: mapping.sourceComponentId} : {})}))})
  verifiedObjects.set(geometry, {sample, original: freeze(original)})
  assertSourceGeometryMatches(input.routedSrj, geometry)
  return geometry
}
