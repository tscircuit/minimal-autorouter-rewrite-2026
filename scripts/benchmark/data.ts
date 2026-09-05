import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { DatasetManifest, DatasetSample } from "./types"

export const repositoryRoot = resolve(import.meta.dir, "../..")

export async function readDatasetManifest(): Promise<DatasetManifest> {
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "datasets/manifest.json"), "utf8"),
  ) as DatasetManifest
  const allowed = new Set(["dataset01", "dataset-srj18"])
  if (manifest.datasets.length !== 2 || manifest.datasets.some((d) => !allowed.has(d.name))) {
    throw new Error("Benchmark manifest must contain exactly the two authorized datasets")
  }
  return manifest
}

/** Preserve fixture bytes; reproduce only the benchmark's legacy pad metadata migration. */
export async function readSample(path: string, sample: DatasetSample): Promise<Record<string, any>> {
  const bytes = await readFile(path)
  if (createHash("sha256").update(bytes).digest("hex") !== sample.sha256) {
    throw new Error(`Dataset checksum mismatch: ${path}`)
  }
  const srj = JSON.parse(bytes.toString())
  for (const obstacle of srj.obstacles) {
    if (obstacle.circuitJsonMetadata || !obstacle.connectedTo[0]) continue
    const identity = obstacle.connectedTo[0]
    const duplicate = obstacle.connectedTo.indexOf(identity, 1)
    const port = duplicate < 0 ? undefined : obstacle.connectedTo[duplicate + 1]
    if (!port) continue
    const kind = obstacle.layers.length === 1 ? "pcb_smtpad_id" : "pcb_plated_hole_id"
    obstacle.circuitJsonMetadata = { [kind]: identity, pcb_port_id: port }
  }
  return srj
}
