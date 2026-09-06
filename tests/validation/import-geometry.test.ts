import {expect, test} from "bun:test"
import {readFile} from "node:fs/promises"
import type {SimpleRouteJson} from "../../lib/types"
import importManifest from "../../imports/manifest.json"
import {getVerifiedSourceGeometry} from "../../scripts/validation/sourceGeometry"
import {describeConversionCoverage} from "../../scripts/validation/convertSrjToCircuitJson"
import {layerNames} from "../../scripts/validation/assertPhysicalConnectivity"

const originalPath = new URL("../../datasets/dataset-srj18/sample016.json", import.meta.url)
const correctedPath = new URL("../../imports/dataset-srj18/sample016.corrected.srj.json", import.meta.url)

test("the explicitly recorded corrected import retains verified drill provenance", async () => {
  const bytes = await readFile(correctedPath)
  const source = JSON.parse(bytes.toString()) as SimpleRouteJson
  const snapshot = JSON.stringify(source)
  const correction = importManifest.corrections[0]!
  const geometry = getVerifiedSourceGeometry({originalSrjBytes:bytes,routedSrj:source})!
  expect(geometry.originalSrjSha256).toBe(correction.correctedSrjSha256)
  expect(geometry.importCorrection).toMatchObject({
    originalSrjSha256:correction.originalSrjSha256,
    correctedSrjSha256:correction.correctedSrjSha256,
    changedObstacleIndices:[85,86,219,220],
    audit:{path:"imports/source-rotation-audit.json",sha256:importManifest.audit.sha256},
  })
  expect(JSON.stringify(source)).toBe(snapshot)
  // Pipeline9 removes phantom copper-layer labels before conversion.
  const layers = layerNames(source.layerCount)
  for (const obstacle of source.obstacles) obstacle.layers = obstacle.layers.filter(layer => layers.includes(layer))
  const coverage = describeConversionCoverage(source,{sourceGeometry:geometry})
  expect(coverage.verifiedSourceGeometry?.importCorrection).toEqual(geometry.importCorrection)
  expect(coverage.verifiedSourceGeometry?.nonPlatedHoleCount).toBe(geometry.holes.length)
})

test("source enrichment never silently repairs the original contradictory input", async () => {
  const bytes = await readFile(originalPath)
  const source = JSON.parse(bytes.toString()) as SimpleRouteJson
  const snapshot = JSON.stringify(source)
  const geometry = getVerifiedSourceGeometry({originalSrjBytes:bytes,routedSrj:source})!
  expect(geometry.importCorrection).toBeUndefined()
  expect(source.obstacles[85]!.width).toBe(2.5)
  expect(JSON.stringify(source)).toBe(snapshot)
})

test("a further edit cannot inherit the recorded corrected import's proof", async () => {
  const bytes = await readFile(correctedPath)
  const source = JSON.parse(bytes.toString()) as SimpleRouteJson
  source.obstacles[85]!.width = 2.5
  expect(() => getVerifiedSourceGeometry({
    originalSrjBytes:JSON.stringify(source),routedSrj:source,
  })).toThrow("recognized allowed source")
})
