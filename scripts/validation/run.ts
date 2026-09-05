import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { Pipeline9 } from "../../lib/Pipeline9"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import {
  readDatasetManifest,
  readSample,
  repositoryRoot,
} from "../benchmark/data"
import {
  CHECKS_VERSION,
  CIRCUIT_JSON_VERSION,
  validateSrjWithChecks,
} from "./validateSrjWithChecks"

const options: Record<string, string> = {}
const allowed = new Set([
  "input",
  "dataset",
  "samples",
  "output",
  "artifacts-dir",
])
for (let index = 2; index < Bun.argv.length; index += 2) {
  const flag = Bun.argv[index]!,
    value = Bun.argv[index + 1]
  if (!flag.startsWith("--") || !allowed.has(flag.slice(2)) || !value)
    throw new Error(
      "Usage: bun scripts/validation/run.ts [--input ROUTED.srj.json | --dataset dataset01|dataset-srj18 --samples sample001,...] [--output REPORT.json] [--artifacts-dir DIRECTORY]",
    )
  options[flag.slice(2)] = value
}
if (options.input && (options.dataset || options.samples))
  throw new Error("--input cannot be combined with dataset selection")
const output = resolve(options.output ?? ".benchmark/pcb-validation.json")
const artifacts = options["artifacts-dir"] && resolve(options["artifacts-dir"])
const startedAt = new Date().toISOString()
const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex")
const sourceFiles = [
  "package.json",
  "bun.lock",
  "datasets/manifest.json",
  "scripts/benchmark/data.ts",
]
for (const directory of ["lib", "scripts/validation"]) {
  for await (const path of new Bun.Glob("**/*.ts").scan(
    resolve(repositoryRoot, directory),
  ))
    sourceFiles.push(`${directory}/${path}`)
}
const sourceSha256 = Object.fromEntries(
  await Promise.all(
    sourceFiles
      .sort()
      .map(async (path) => [
        path,
        sha256(await readFile(resolve(repositoryRoot, path))),
      ]),
  ),
)
const provenance = {
  bunVersion: Bun.version,
  platform: process.platform,
  architecture: process.arch,
  sourceSha256,
}
const results: Array<Record<string, unknown>> = []
let complete = false
async function checkpoint() {
  await mkdir(dirname(output), { recursive: true })
  await writeFile(
    `${output}.tmp`,
    JSON.stringify(
      {
        version: 1,
        startedAt,
        updatedAt: new Date().toISOString(),
        complete,
        checksVersion: CHECKS_VERSION,
        circuitJsonVersion: CIRCUIT_JSON_VERSION,
        provenance,
        passed:
          complete &&
          results.every(
            (result) =>
              result.didSolve &&
              result.pcbIssueCount === 0 &&
              !result.error &&
              !result.physicalConnectivityError,
          ),
        summary: {
          samples: results.length,
          solved: results.filter((result) => result.didSolve).length,
          pcbClean: results.filter(
            (result) =>
              result.didSolve &&
              result.pcbIssueCount === 0 &&
              !result.error &&
              !result.physicalConnectivityError,
          ).length,
          pcbIssues: results.reduce(
            (sum, result) => sum + Number(result.pcbIssueCount ?? 0),
            0,
          ),
        },
        results,
      },
      null,
      2,
    ) + "\n",
  )
  await rename(`${output}.tmp`, output)
}
async function check(
  input: SimpleRouteJson,
  identity: { dataset: string; sample: string; sha256: string },
  shouldSolve: boolean,
) {
  const result: Record<string, unknown> = {
    ...identity,
    didSolve: !shouldSolve,
  }
  const started = performance.now()
  try {
    let routed = input
    if (shouldSolve) {
      const solver = new Pipeline9(input, { effort: 1, cacheProvider: null })
      const deadline = performance.now() + 290_000
      while (!solver.solved && !solver.failed) {
        if (performance.now() > deadline)
          throw new Error("Routing exceeded 290 seconds")
        solver.step()
      }
      result.didSolve = solver.solved && !solver.failed
      result.solveTimeMs = performance.now() - started
      if (result.didSolve) routed = solver.getOutputSimpleRouteJson()
      else result.routingError = solver.error
    }
    const routedJson = JSON.stringify(routed) + "\n"
    result.validatedSrjSha256 = sha256(routedJson)
    if (artifacts && result.didSolve) {
      const prefix = resolve(artifacts, identity.dataset, identity.sample)
      await mkdir(dirname(prefix), { recursive: true })
      await writeFile(`${prefix}.routed.srj.json`, routedJson)
    }
    const validation = await validateSrjWithChecks(routed)
    result.validatedOutput = result.didSolve
    result.circuitJsonElementCount = validation.circuitJson.length
    result.coverage = validation.coverage
    result.physicalConnectivityError = validation.physicalConnectivityError
    result.issueCount = validation.issues.length
    result.pcbIssueCount = validation.pcbIssues.length
    result.pcbIssueTypes = Object.fromEntries(
      [...new Set(validation.pcbIssues.map((issue) => issue.type))].map(
        (type) => [
          type,
          validation.pcbIssues.filter((issue) => issue.type === type).length,
        ],
      ),
    )
    result.pcbIssues = validation.pcbIssues
    result.otherIssues = validation.issues.filter(
      (issue) => !issue.type.startsWith("pcb_"),
    )
    const circuitJson = JSON.stringify(validation.circuitJson) + "\n"
    result.circuitJsonSha256 = sha256(circuitJson)
    if (artifacts) {
      const prefix = resolve(artifacts, identity.dataset, identity.sample)
      await mkdir(dirname(prefix), { recursive: true })
      await writeFile(`${prefix}.circuit.json`, circuitJson)
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
  }
  result.elapsedTimeMs = performance.now() - started
  results.push(result)
  console.log(
    `${identity.dataset}/${identity.sample}: solved=${result.didSolve} PCB issues=${result.pcbIssueCount ?? "unavailable"} physical=${result.physicalConnectivityError ? "failed" : result.error ? "unavailable" : "passed"}${result.error ? ` ${result.error}` : ""}`,
  )
  await checkpoint()
}
if (options.input) {
  const bytes = await readFile(resolve(options.input))
  await check(
    JSON.parse(bytes.toString()),
    {
      dataset: "input",
      sample: "routed",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    false,
  )
} else {
  const manifest = await readDatasetManifest()
  if (
    options.dataset &&
    !manifest.datasets.some((dataset) => dataset.name === options.dataset)
  )
    throw new Error("Only dataset01 and dataset-srj18 are authorized")
  const names = options.samples?.split(","),
    selected = manifest.datasets
      .filter((dataset) => !options.dataset || dataset.name === options.dataset)
      .flatMap((dataset) =>
        dataset.samples
          .filter((sample) => !names || names.includes(sample.name))
          .map((sample) => ({ dataset: dataset.name, sample })),
      )
  if (
    !selected.length ||
    names?.some((name) => !selected.some((item) => item.sample.name === name))
  )
    throw new Error("Unknown or empty manifest sample selection")
  for (const { dataset, sample } of selected) {
    const input = await readSample(
      resolve(repositoryRoot, "datasets", sample.file),
      sample,
    )
    await check(
      input as SimpleRouteJson,
      { dataset, sample: sample.name, sha256: sample.sha256 },
      true,
    )
  }
}
complete = true
await checkpoint()
console.log(`Wrote ${output}`)
if (
  results.some(
    (result) =>
      !result.didSolve ||
      result.pcbIssueCount !== 0 ||
      result.error ||
      result.physicalConnectivityError,
  )
)
  process.exitCode = 1
