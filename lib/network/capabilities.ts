import { PIPELINE9_NETWORKED_BOARD_POLICY } from "./boardContract"
import { getHdCache2SolveUrl } from "./HdCache2Client"

export const HD_CACHE2_CAPABILITY_TIMEOUT_MS = 2_000
export type NetworkCapabilities = { board: boolean; reason: string }
/** A version match alone never implies support for our independent board schema. */
export async function discoverNetworkCapabilities(serverUrl: string, autorouterVersion: string, timeoutMs = HD_CACHE2_CAPABILITY_TIMEOUT_MS): Promise<NetworkCapabilities> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = getHdCache2SolveUrl(serverUrl).replace(/\/solve$/, "/health")
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: controller.signal })
    if (!response.ok) return { board: false, reason: `health HTTP ${response.status}` }
    const body = await response.text()
    if (body.length > 64 * 1024) return { board: false, reason: "capability response too large" }
    const value = JSON.parse(body)
    if (value?.ok !== true || value.autorouterVersion !== autorouterVersion) return { board: false, reason: "capability version mismatch" }
    if (!Array.isArray(value.solvePolicies) || !value.solvePolicies.includes(PIPELINE9_NETWORKED_BOARD_POLICY)) return { board: false, reason: "board contract not advertised" }
    return { board: true, reason: "exact board contract advertised" }
  } catch { return { board: false, reason: controller.signal.aborted ? "capability timeout" : "capability discovery unavailable" } }
  finally { clearTimeout(timer) }
}
