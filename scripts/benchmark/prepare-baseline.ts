import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { repositoryRoot } from "./data"

// This installs a development oracle only. The replacement never imports this package.
const baselineDirectory = resolve(Bun.argv[2] ?? resolve(repositoryRoot, ".benchmark/baseline"))
await mkdir(resolve(baselineDirectory, "tmp"), { recursive: true })
await mkdir(resolve(baselineDirectory, "cache"), { recursive: true })
await writeFile(resolve(baselineDirectory, "package.json"), JSON.stringify({
  name: "pipeline9-benchmark-oracle",
  private: true,
  type: "module",
  dependencies: { "@tscircuit/capacity-autorouter": "0.0.884", "@tscircuit/checks": "0.0.163" },
}, null, 2) + "\n")
const install = Bun.spawn([process.execPath, "install", "--cwd", baselineDirectory], {
  stdout: "inherit", stderr: "inherit",
  env: { ...process.env, TMPDIR: resolve(baselineDirectory, "tmp"), BUN_INSTALL_CACHE_DIR: resolve(baselineDirectory, "cache") },
})
if (await install.exited !== 0) throw new Error("Could not install the pinned baseline oracle")

const packageDirectory = resolve(baselineDirectory, "node_modules/@tscircuit/capacity-autorouter")
const installed = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"))
if (installed.version !== "0.0.884") throw new Error("Baseline version must be 0.0.884")
const modulePath = resolve(packageDirectory, "dist/index.js")
const bundle = await readFile(modulePath, "utf8")
// The published source map predates terser, so use the evaluator's unminified object keys.
// This adds an export to an installed baseline copy; it copies no implementation into lib/.
const signatures = [...bundle.matchAll(/([\w$]+)=\(\{inputSrj:[\w$]+,srjWithPointPairs:[\w$]+,routedTraces:[\w$]+,drcOptions:[\w$]+\}\)=>/g)]
if (signatures.length !== 1) throw new Error("Pinned baseline DRC evaluator signature is not unique")
const oraclePath = resolve(packageDirectory, "dist/benchmark-oracle.js")
await writeFile(oraclePath, `${bundle}\nexport { ${signatures[0]![1]} as evaluateRelaxedDrc };\n`)
const metadata = {
  version: "0.0.884", modulePath, oraclePath,
  sha256: createHash("sha256").update(bundle).digest("hex"),
  checksVersion: "0.0.163",
}
await writeFile(resolve(baselineDirectory, "oracle.json"), JSON.stringify(metadata, null, 2) + "\n")
console.log(JSON.stringify(metadata, null, 2))
