import {describe, expect, test} from "bun:test"
import {createHash} from "node:crypto"
import {pcb_hole} from "circuit-json"
import {runAllChecks} from "@tscircuit/checks"
import type {SimpleRouteJson} from "../../lib/types"
import {
  assertSourceGeometryMatches,
  getVerifiedSourceGeometry,
  type VerifiedSourceGeometry,
} from "../../scripts/validation/sourceGeometry"
import manifest from "../../scripts/validation/source-geometry-manifest.json"
import {convertSrjToCircuitJson, describeConversionCoverage} from "../../scripts/validation/convertSrjToCircuitJson"

const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")
async function sample(name = "sample012") {
  const originalSrjBytes = new Uint8Array(await Bun.file(new URL(`../../datasets/dataset-srj18/${name}.json`, import.meta.url)).arrayBuffer())
  const routedSrj = JSON.parse(new TextDecoder().decode(originalSrjBytes)) as SimpleRouteJson
  return {originalSrjBytes, routedSrj, expectedOriginalSrjSha256: sha256(originalSrjBytes)}
}

describe("verified source NPTH geometry", () => {
  test("all16 allowed sources have exact, unique, schema-valid mappings for all62 non-plated holes", async () => {
    expect(manifest.samples).toHaveLength(16)
    expect(manifest.sourceCommit).toBe("c0aad90256a95256fcac814f9f7da81a82a2fdea")
    let count = 0
    for (const entry of manifest.samples) {
      const input = await sample(entry.sample), before = structuredClone(input.routedSrj)
      const geometry = getVerifiedSourceGeometry(input)!
      expect(geometry.sample).toBe(entry.sample)
      expect(geometry.originalSrjSha256).toBe(entry.originalSrjSha256)
      expect(geometry.sourceCircuitJson.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(new Set(geometry.holes.map(hole => hole.obstacleIndex)).size).toBe(geometry.holes.length)
      for (const mapping of geometry.holes) {
        expect(pcb_hole.safeParse(mapping.hole).success).toBe(true)
        expect(mapping.hole.type).toBe("pcb_hole")
        expect(input.routedSrj.obstacles[mapping.obstacleIndex]!.connectedTo).toEqual([])
        expect("pcb_component_id" in mapping.hole).toBe(false)
      }
      count += geometry.holes.length
      expect(input.routedSrj).toEqual(before)
    }
    expect(count).toBe(62)
  })

  test("sample012 recovers the declared circular drill rather than inventing a keepout", async () => {
    const input = await sample(), geometry = getVerifiedSourceGeometry(input)!
    const mapping = geometry.holes.find(hole => hole.obstacleIndex === 813)!
    expect(mapping.hole).toEqual({type: "pcb_hole", pcb_hole_id: "pcb_hole_7", hole_shape: "circle",
      x: -19.425999999999988, y: 62.19800000000001, hole_diameter: 1.25})
    expect(mapping.sourceComponentId).toBe("pcb_component_161")
    expect(geometry.sourceCircuitJson.path).toBe("circuit-json/sample012-oculink-pcie-adapter.json")
    expect(input.routedSrj.obstacles[813]).toMatchObject({type: "rect", width: 1.25, height: 1.25, connectedTo: []})
  })

  test("verified sample012 anchor hole retains its original component membership while unrelated overlap still fails", async () => {
    const input = await sample(), geometry = getVerifiedSourceGeometry(input)!
    const circuit = convertSrjToCircuitJson(input.routedSrj, {sourceGeometry:geometry})
    const hole = circuit.find(element => element.type === "pcb_hole" && element.pcb_hole_id === "pcb_hole_7")!
    const coverage = describeConversionCoverage(input.routedSrj,{sourceGeometry:geometry})
    const anchorId = coverage.obstacleElementIds["obstacle:772"]![0]
    const anchor = circuit.find(element => element.type === "pcb_smtpad" && element.pcb_smtpad_id === anchorId)!
    expect(hole).toMatchObject({pcb_component_id:"pcb_component_161", hole_shape:"circle",hole_diameter:1.25})
    expect(anchor).toMatchObject({pcb_component_id:"pcb_component_161",x:-19.4265,y:63.5,width:5,height:3})
    expect(circuit.some(element => element.type === "pcb_component")).toBe(false)
    expect(describeConversionCoverage(input.routedSrj,{sourceGeometry:geometry}).limitations.some(text =>
      text.includes("no component records or missing geometry are fabricated"))).toBe(true)

    // Isolate the original mechanical pair, preserving both geometries, to test
    // the public checker's same-component semantics independently of routing.
    const pair = circuit.filter(element => element.type === "pcb_board" || element === hole || element === anchor)
    const sameComponentIssues = await runAllChecks(structuredClone(pair))
    expect(sameComponentIssues).toHaveLength(0)
    const unrelatedPair = structuredClone(pair)
    const unrelatedHole = unrelatedPair.find(element => element.type === "pcb_hole")!
    if(unrelatedHole.type !== "pcb_hole") throw new Error("missing hole")
    unrelatedHole.pcb_component_id = "unrelated_component"
    const unrelatedIssues = await runAllChecks(unrelatedPair)
    expect(unrelatedIssues.some(issue => issue.type === "pcb_footprint_overlap_error")).toBe(true)
  })

  test("accepts Pipeline9 normalization of phantom layers without accepting new layers", async () => {
    const input = await sample("sample001"), geometry = getVerifiedSourceGeometry(input)!
    expect(input.routedSrj.layerCount).toBe(2)
    for (const {obstacleIndex} of geometry.holes) input.routedSrj.obstacles[obstacleIndex]!.layers = ["top", "bottom"]
    expect(() => assertSourceGeometryMatches(input.routedSrj, geometry)).not.toThrow()
    input.routedSrj.obstacles[geometry.holes[0]!.obstacleIndex]!.layers.push("unknown_layer")
    expect(() => assertSourceGeometryMatches(input.routedSrj, geometry)).toThrow("different physical layers")
  })

  test("pins actual original bytes and rejects modified recognized source data", async () => {
    const input = await sample()
    expect(() => getVerifiedSourceGeometry({...input, expectedOriginalSrjSha256: "0".repeat(64)})).toThrow("byte hash")
    const changed = JSON.stringify(input.routedSrj)
    expect(sha256(changed)).not.toBe(input.expectedOriginalSrjSha256)
    expect(() => getVerifiedSourceGeometry({originalSrjBytes: changed, routedSrj: input.routedSrj})).toThrow("pinned original SRJ hash")
  })

  test("rechecks coordinates, dimensions and electrical ownership at use", async () => {
    for (const mutate of [
      (srj: SimpleRouteJson, index: number) => { srj.obstacles[index]!.center.x += .001 },
      (srj: SimpleRouteJson, index: number) => { srj.obstacles[index]!.width += .001 },
      (srj: SimpleRouteJson, index: number) => { srj.obstacles[index]!.connectedTo = ["foreign_net"] },
      (srj: SimpleRouteJson, index: number) => { srj.obstacles[index]!.netIsAssignable = true },
      (srj: SimpleRouteJson, index: number) => { srj.obstacles[index]!.circuitJsonMetadata = {pcb_port_id: "port"} },
    ]) {
      const input = await sample(), geometry = getVerifiedSourceGeometry(input)!
      mutate(input.routedSrj, geometry.holes[0]!.obstacleIndex)
      expect(() => assertSourceGeometryMatches(input.routedSrj, geometry)).toThrow("Source geometry:")
      expect(() => getVerifiedSourceGeometry(input)).toThrow("Source geometry:")
    }
  })

  test("rejects board changes, reordered obstacles and forged or deserialized proofs", async () => {
    const input = await sample(), geometry = getVerifiedSourceGeometry(input)!
    const movedBoard = structuredClone(input.routedSrj)
    movedBoard.bounds.minX -= 1
    expect(() => assertSourceGeometryMatches(movedBoard, geometry)).toThrow("board geometry changed")
    const reordered = structuredClone(input.routedSrj), index = geometry.holes[0]!.obstacleIndex
    ;[reordered.obstacles[0], reordered.obstacles[index]] = [reordered.obstacles[index]!, reordered.obstacles[0]!]
    expect(() => assertSourceGeometryMatches(reordered, geometry)).toThrow("hole envelope")
    expect(() => assertSourceGeometryMatches(input.routedSrj, structuredClone(geometry))).toThrow("unverified source geometry")
    expect(() => assertSourceGeometryMatches(input.routedSrj, {} as VerifiedSourceGeometry)).toThrow("unverified source geometry")
    expect(Object.isFrozen(geometry)).toBe(true)
    expect(Object.isFrozen(geometry.holes)).toBe(true)
    expect(Object.isFrozen(geometry.holes[0]!.hole)).toBe(true)
  })

  test("allows new routing without reclassifying any other input obstacle", async () => {
    const input = await sample(), geometry = getVerifiedSourceGeometry(input)!
    input.routedSrj.traces = [{type: "pcb_trace", pcb_trace_id: "new_trace", connection_name: "test",
      route: [{route_type: "wire", x: 0, y: 0, layer: "top", width: .1}, {route_type: "wire", x: 1, y: 0, layer: "top", width: .1}]}]
    expect(() => assertSourceGeometryMatches(input.routedSrj, geometry)).not.toThrow()
    expect(geometry.holes.some(mapping => mapping.obstacleIndex === 772)).toBe(false) // pad680 stays copper
    const unknown: SimpleRouteJson = {layerCount: 2, minTraceWidth: .1, bounds: {minX: -5, maxX: 5, minY: -5, maxY: 5},
      connections: [], obstacles: [{type: "rect", center: {x: 0, y: 0}, width: 1.25, height: 1.25, layers: ["top", "bottom"], connectedTo: []}]}
    expect(getVerifiedSourceGeometry({originalSrjBytes: JSON.stringify(unknown), routedSrj: unknown})).toBeUndefined()
  })
})
