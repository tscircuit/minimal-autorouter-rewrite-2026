import {readFile, mkdir, writeFile} from "node:fs/promises"
import {resolve} from "node:path"
import {Pipeline9} from "../../lib/Pipeline9"
import manifest from "../../imports/manifest.json"
import {repositoryRoot} from "../benchmark/data"
import {applyVerifiedImportCorrections, formatImportedJson, sha256} from "./applyVerifiedImportCorrections"

const args = Bun.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== "--output-dir" || !args[1]))
  throw new Error("Usage: bun scripts/imports/validate.ts [--output-dir DIRECTORY]")
const directory = resolve(args[1] ?? ".benchmark/import-corrections")
await mkdir(directory, {recursive:true})

for (const record of manifest.corrections) {
  const sourcePath = resolve(repositoryRoot,"imports",record.path)
  const correctedBytes = await readFile(sourcePath)
  const originalBytes = await readFile(resolve(repositoryRoot,"datasets",record.dataset,`${record.sample}.json`))
  const corrected = applyVerifiedImportCorrections(originalBytes)
  if (sha256(correctedBytes) !== record.correctedSrjSha256 ||
    formatImportedJson(corrected) !== correctedBytes.toString())
    throw new Error("Corrected input differs from the reproducible import correction")
  const solver = new Pipeline9(corrected,{effort:1,cacheProvider:null})
  const started = performance.now(), deadline = started + 290_000
  while (!solver.solved && !solver.failed) {
    if (performance.now() > deadline) throw new Error("Corrected input routing exceeded 290 seconds")
    solver.step()
  }
  if (!solver.solved || solver.failed) throw new Error(solver.error ?? "Corrected input did not route")
  const solveTimeMs = performance.now() - started
  const routed = solver.getOutputSimpleRouteJson()
  const routedPath = resolve(directory,`${record.sample}.routed.srj.json`)
  const reportPath = resolve(directory,`${record.sample}.validation.json`)
  await writeFile(routedPath,formatImportedJson(routed))
  const validation = Bun.spawn([
    process.execPath,resolve(repositoryRoot,"scripts/validation/run.ts"),
    "--input",routedPath,"--source",sourcePath,"--output",reportPath,
    "--artifacts-dir",resolve(directory,`${record.sample}.artifacts`),
  ],{cwd:repositoryRoot,stdout:"inherit",stderr:"inherit"})
  const exitCode = await validation.exited
  const report = JSON.parse(await readFile(reportPath,"utf8"))
  await writeFile(resolve(directory,`${record.sample}.routing.json`),formatImportedJson({
    version:1,sample:`${record.dataset}/${record.sample}`,derivedInput:true,
    passed:exitCode === 0 && report.passed === true,
    originalSrjSha256:record.originalSrjSha256,correctedSrjSha256:record.correctedSrjSha256,
    bunVersion:Bun.version,options:{effort:1,cacheProvider:null},solveTimeMs,
    traceCount:routed.traces?.length ?? 0,routingStats:solver.highDensityRouteSolver?.stats,
    validationReportSha256:sha256(await readFile(reportPath)),
    timings:"Diagnostic only; this derivative is excluded from the pinned benchmark population.",
  }))
  if (exitCode !== 0 || !report.passed) throw new Error("Corrected input failed strict PCB validation")
}
