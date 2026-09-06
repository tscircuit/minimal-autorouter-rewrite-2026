import {mkdir, readFile, realpath, writeFile} from "node:fs/promises"
import {basename, dirname, join, relative, resolve, sep} from "node:path"
import {fileURLToPath} from "node:url"
import {
  applyVerifiedCircuitJsonImportCorrections,
  applyVerifiedImportCorrections,
  createImportManifest,
  formatImportedJson,
  importSourcePaths,
  sha256,
  sourceRotationAuditBytes,
  verifyOriginalKicadBytes,
} from "./applyVerifiedImportCorrections"

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep))
}
async function canonicalDestination(path: string): Promise<string> {
  try { return await realpath(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    return join(await canonicalDestination(dirname(path)), basename(path))
  }
}

/** Verify the three original files before creating a separate derivative directory. */
export async function regenerateVerifiedImportCorrections(options: {sourceDirectory: string; outputDirectory: string}) {
  const source = await realpath(resolve(options.sourceDirectory))
  const output = await canonicalDestination(resolve(options.outputDirectory))
  const pinned = await realpath(fileURLToPath(new URL("../../datasets", import.meta.url)))
  if (contains(source, output) || contains(pinned, output))
    throw new Error("Import correction: output directory must be outside pinned source datasets")
  const [originalSrj, originalCircuitJson, originalKicad] = await Promise.all([
    readFile(join(source, importSourcePaths.srj)),
    readFile(join(source, importSourcePaths.circuitJson)),
    readFile(join(source, importSourcePaths.kicad)),
  ])
  verifyOriginalKicadBytes(originalKicad)
  const srjBytes = formatImportedJson(applyVerifiedImportCorrections(originalSrj))
  const cjBytes = formatImportedJson(applyVerifiedCircuitJsonImportCorrections(originalCircuitJson))
  const manifest = createImportManifest(srjBytes)
  const record = manifest.corrections[0]!
  const circuitJsonPath = `dataset-srj18/${record.sample}.corrected.circuit.json`
  const provenance = {
    ...record,
    audit: manifest.audit,
    correctedCircuitJson: {path: circuitJsonPath, sha256: sha256(cjBytes)},
    statement: "Only four imported pad width/height pairs change. Centers, identities, electrical aliases, layers, rules and all other source fields are preserved. Existing Circuit JSON routing remains source content, not newly autorouted output.",
  }
  const files = new Map<string, string | Uint8Array>([
    [record.path, srjBytes], [circuitJsonPath, cjBytes],
    ["manifest.json", formatImportedJson(manifest)],
    ["provenance.json", formatImportedJson(provenance)],
    ["source-rotation-audit.json", sourceRotationAuditBytes],
  ])
  // Refuse differing existing artifacts. Identical files make regeneration idempotent.
  const missing: string[] = []
  for (const [path, bytes] of files) {
    try {
      const existing = await readFile(join(output, path))
      if (sha256(existing) !== sha256(bytes)) throw new Error(`Import correction: refusing to overwrite different artifact ${path}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      missing.push(path)
    }
  }
  for (const path of missing) {
    const destination = join(output, path)
    await mkdir(dirname(destination), {recursive: true})
    await writeFile(destination, files.get(path)!, {flag: "wx"})
  }
  return {manifest, provenance}
}
