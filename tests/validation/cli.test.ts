import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { execPath } from "node:process"
import { join, resolve } from "node:path"
import type { SimpleRouteJson } from "../../lib/types"

const repository = resolve(import.meta.dir, "../..")
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex")

for (const validWidth of [true, false]) {
  test(`PCB validation CLI ${validWidth ? "accepts a clean board" : "fails on a PCB warning"} and retains inspectable artifacts`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "autorouter-pcb-check-"))
    try {
      const input: SimpleRouteJson = {
        layerCount: 2,
        bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
        minTraceWidth: 0.1,
        obstacles: [-2, 2].map((x, index) => ({
          type: "rect",
          center: { x, y: 0 },
          width: 0.5,
          height: 0.5,
          layers: ["top"],
          connectedTo: ["net", `p${index}`],
        })),
        connections: [
          {
            name: "net",
            nominalTraceWidth: validWidth ? 0.1 : 0.5,
            pointsToConnect: [-2, 2].map((x, index) => ({
              x,
              y: 0,
              layer: "top",
              pcb_port_id: `p${index}`,
            })),
          },
        ],
        traces: [
          {
            type: "pcb_trace",
            pcb_trace_id: "trace",
            connection_name: "net",
            route: [-2, 2].map((x) => ({
              route_type: "wire",
              x,
              y: 0,
              layer: "top",
              width: 0.1,
            })),
          },
        ],
      }
      const inputBytes = JSON.stringify(input) + "\n"
      const inputPath = join(directory, "input.srj.json"),
        reportPath = join(directory, "report.json")
      const artifacts = join(directory, "artifacts")
      await writeFile(inputPath, inputBytes)
      const process = Bun.spawn(
        [
          execPath,
          "scripts/validation/run.ts",
          "--input",
          inputPath,
          "--output",
          reportPath,
          "--artifacts-dir",
          artifacts,
        ],
        { cwd: repository, stdout: "pipe", stderr: "pipe" },
      )
      const [code, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])
      expect(stderr).toBe("")
      expect(code).toBe(validWidth ? 0 : 1)
      expect(stdout).toContain("Wrote")
      const report = JSON.parse(await readFile(reportPath, "utf8"))
      expect(report.complete).toBe(true)
      expect(report.passed).toBe(validWidth)
      expect(report.results).toHaveLength(1)
      expect(report.summary.pcbClean).toBe(validWidth ? 1 : 0)
      const result = report.results[0]
      expect(result.validatedOutput).toBe(true)
      expect(result.sha256).toBe(hash(inputBytes))
      expect(result.physicalConnectivityError).toBeUndefined()
      const circuitJson = await readFile(
        join(artifacts, "input/routed.circuit.json"),
        "utf8",
      )
      const routed = await readFile(
        join(artifacts, "input/routed.routed.srj.json"),
        "utf8",
      )
      expect(result.circuitJsonSha256).toBe(hash(circuitJson))
      expect(result.validatedSrjSha256).toBe(hash(routed))
      expect(
        JSON.parse(circuitJson).some(
          (element: { type: string }) => element.type === "pcb_trace",
        ),
      ).toBe(true)
      if (!validWidth)
        expect(
          result.pcbIssues.some(
            (issue: { type: string }) => issue.type === "pcb_trace_warning",
          ),
        ).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
