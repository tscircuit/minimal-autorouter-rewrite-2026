import {regenerateVerifiedImportCorrections} from "./regenerate"

const args: Record<string, string> = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1]
  if (!name || !["--source-dir", "--output-dir"].includes(name) || !value || args[name])
    throw new Error("Usage: bun scripts/imports/run.ts --source-dir PINNED_DATASET_CHECKOUT --output-dir DERIVATIVES")
  args[name] = value
}
if (!args["--source-dir"] || !args["--output-dir"])
  throw new Error("Both --source-dir and --output-dir are required")
const result = await regenerateVerifiedImportCorrections({
  sourceDirectory: args["--source-dir"], outputDirectory: args["--output-dir"],
})
console.log(`Wrote verified ${result.manifest.corrections[0]!.sample} import derivatives; source bytes remain unchanged.`)
