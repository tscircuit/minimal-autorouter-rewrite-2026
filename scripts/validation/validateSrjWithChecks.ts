import {
  checkSourceTracesMatchPcbTraceThickness,
  checkViaPadClearance,
  runAllChecks,
} from "@tscircuit/checks"
import * as circuitJsonSchemas from "circuit-json"
import { any_circuit_element, type AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import {
  convertSrjWithCoverage,
  type SrjConversionOptions,
} from "./convertSrjToCircuitJson"
import { assertPhysicalConnectivity } from "./assertPhysicalConnectivity"
import { assertSourcePreservation } from "./assertSourcePreservation"

export interface SrjValidationOptions extends SrjConversionOptions {
  originalSrj?: SimpleRouteJson
}

export const CHECKS_VERSION = "0.0.184"
export const CIRCUIT_JSON_VERSION = "0.0.485"
const elementSchemas = {
  pcb_board: circuitJsonSchemas.pcb_board,
  pcb_trace: circuitJsonSchemas.pcb_trace,
  pcb_smtpad: circuitJsonSchemas.pcb_smtpad,
  pcb_plated_hole: circuitJsonSchemas.pcb_plated_hole,
  pcb_keepout: circuitJsonSchemas.pcb_keepout,
  pcb_hole: circuitJsonSchemas.pcb_hole,
  pcb_via: circuitJsonSchemas.pcb_via,
  pcb_port: circuitJsonSchemas.pcb_port,
  source_port: circuitJsonSchemas.source_port,
  source_trace: circuitJsonSchemas.source_trace,
  source_net: circuitJsonSchemas.source_net,
}

/** Include public checks/rules that this pinned runAllChecks does not apply. */
export async function validateCircuitJson(circuitJson: AnyCircuitElement[]) {
  if (
    circuitJson.filter((element) => element.type === "pcb_board").length !== 1
  )
    throw new Error("Circuit JSON validation requires exactly one PCB board")
  for (const [index, element] of circuitJson.entries()) {
    const schema =
      elementSchemas[element.type as keyof typeof elementSchemas] ??
      any_circuit_element
    const parsed = schema.safeParse(element)
    if (!parsed.success) {
      const details = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")
      throw new Error(
        `Invalid converted Circuit JSON at element ${index} (${element.type}): ${details}`,
      )
    }
  }
  // Some checks annotate endpoints. Preserve the exact converted artifact.
  const checked = structuredClone(circuitJson)
  const issues: AnyCircuitElement[] = [
    ...(await runAllChecks(checked)),
    ...checkSourceTracesMatchPcbTraceThickness(checked),
  ]
  const board = checked.find((element) => element.type === "pcb_board")!
  // Circuit JSON exposes this rule, but checks 0.0.184 reads the general pad
  // clearance inside runAllChecks. Pass the precise via-to-pad rule explicitly.
  if (
    board.type === "pcb_board" &&
    board.min_via_edge_to_pad_edge_clearance !== undefined
  ) {
    const supplemental = checkViaPadClearance(checked, {
      minClearance: board.min_via_edge_to_pad_edge_clearance,
    })
    for (const issue of supplemental) {
      const existingIndex = issues.findIndex(
        (existing) =>
          existing.type === "pcb_pad_pad_clearance_error" &&
          existing.pcb_pad_pad_clearance_error_id ===
            issue.pcb_pad_pad_clearance_error_id,
      )
      const existing = issues[existingIndex]
      if (
        existing?.type === "pcb_pad_pad_clearance_error" &&
        (existing.minimum_clearance ?? -Infinity) >=
          (issue.minimum_clearance ?? -Infinity)
      )
        continue
      if (existingIndex >= 0) issues[existingIndex] = issue
      else issues.push(issue)
    }
  }
  const pcbIssues = issues.filter((issue) => issue.type.startsWith("pcb_"))
  return { circuitJson, issues, pcbIssues }
}

/** Run the public checks on a schema-validated, independent SRJ conversion. */
export async function validateSrjWithChecks(srj: SimpleRouteJson, options: SrjValidationOptions = {}) {
  let physicalConnectivityError: string | undefined
  let sourcePreservationError: string | undefined
  if (options.originalSrj !== undefined) {
    try {
      assertSourcePreservation(options.originalSrj, srj)
    } catch (error) {
      sourcePreservationError = error instanceof Error ? error.message : String(error)
    }
  }
  try {
    assertPhysicalConnectivity(srj)
  } catch (error) {
    physicalConnectivityError =
      error instanceof Error ? error.message : String(error)
  }
  const {circuitJson,coverage} = convertSrjWithCoverage(srj,options)
  return {
    ...(await validateCircuitJson(circuitJson)),
    physicalConnectivityError,
    sourcePreservationError,
    coverage,
  }
}

export async function assertNoPcbIssues(
  srj: SimpleRouteJson,
  label = "Routed board",
  options: SrjValidationOptions = {},
): Promise<void> {
  const { pcbIssues, physicalConnectivityError, sourcePreservationError } =
    await validateSrjWithChecks(srj,options)
  if (pcbIssues.length) {
    const details = pcbIssues
      .slice(0, 10)
      .map(
        (issue) =>
          `${issue.type}: ${"message" in issue ? issue.message : JSON.stringify(issue)}`,
      )
      .join("\n")
    throw new Error(
      `${label}: @tscircuit/checks found ${pcbIssues.length} PCB issues\n${details}`,
    )
  }
  if (sourcePreservationError)
    throw new Error(`${label}: source preservation failed: ${sourcePreservationError}`)
  if (physicalConnectivityError)
    throw new Error(
      `${label}: independent physical connectivity failed: ${physicalConnectivityError}`,
    )
}
