# Minimal autorouter rewrite, 2026

An independent TypeScript implementation of the `Pipeline9` and
`Pipeline9_Networked` interfaces from `@tscircuit/capacity-autorouter`.

Version 0.1.1 completes 100 of the 101 allowed inputs. The strict Circuit JSON
PCB audit passes 89 inputs, up from 80: generated board-edge violations are
fixed, sample014 completes, and sample012's original drill geometry is restored.
The remaining findings require input-design decisions; see
[PCB audit results](benchmarks/pcb-validation/README.md).

The frozen version 0.1.0 local, cold-cache, and warm-cache comparisons preserve
every reference relaxed-DRC pass: 99 passes versus 93 for
`@tscircuit/capacity-autorouter@0.0.884`. These historical measurements are
recorded separately from the revised runtime in
[measured results](benchmarks/README.md).

The design keeps the solver pattern: each stage exposes `step()`, progress,
terminal state, and inspectable results. Named electrical connectivity, physical
copper connectivity, geometric search, and asynchronous transport have separate
responsibilities. The [architecture guide](docs/architecture.md) maps these
boundaries to the source; the [development record](docs/development.md) explains
the changes made as benchmark evidence exposed problems.

Only dataset01 and dataset-srj18 are allowed as benchmark data. The original
autorouter is an isolated benchmark oracle and is never a runtime dependency of
the replacement. The source implementation and tests are newly authored.

## Development

```sh
bun install
bun run typecheck
bun run build
bun test --timeout 300000
bun run start
```

The Cosmos playground includes an individual fixture for every dataset-srj18
sample. Each sample also has a separate test; the upstream test suite is not
included.

`bun run validate:pcb` converts routed SRJ to Circuit JSON and runs the full
`@tscircuit/checks` suite, PCB warnings, and independent copper-connectivity
validation on both allowed datasets. This stricter audit currently finds PCB
issues and exits with failure; the relaxed benchmark passes above do not mean
that every board passes full PCB checks. See [PCB validation](docs/pcb-validation.md)
for coverage, reproduction commands, and the recorded findings. The manually
triggered **Full PCB audit** workflow retains its report and converted artifacts
even when validation fails.

## Library interface

```ts
import {
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  Pipeline9,
} from "@tscircuit/minimal-autorouter-rewrite-2026"

const solver = new Pipeline9(simpleRouteJson, { effort: 1 })
solver.solve()
if (solver.failed) throw new Error(solver.error ?? "Routing failed")
const routed = solver.getOutputSimpleRouteJson()
```

`Pipeline9` aliases the canonical upstream class name. Both entry points use the
same implementation. `step()`, `solved`, `failed`, `progress`, and `activeSubSolver`
support incremental consumers. The final SRJ includes retained preloaded copper;
`getOutputSimplifiedPcbTraces()` returns only newly routed copper.

The network class has the same SRJ/options constructor and an asynchronous solve:

```ts
import { Pipeline9_Networked } from "@tscircuit/minimal-autorouter-rewrite-2026"

const solver = new Pipeline9_Networked(simpleRouteJson, {
  hdCache2ServerUrl: "http://127.0.0.1:3080",
  hdCache2CacheVersion: "my-design-cache",
})
await solver.solveAsync()
if (solver.failed) throw new Error(solver.error ?? "Routing failed")
const routed = solver.getOutputSimpleRouteJson()
```

Start the matching service with `bun scripts/network-server.ts`. Its negotiated
board contract preserves outlines, fixed copper, pad shapes, widths, and layer
constraints. The deployed public cache service uses an older solver version;
configure this matching service to use remote execution. See
[network behavior](docs/network.md) and the
[integration contract](docs/compatibility.md) for phase mappings and diagnostic
differences from the original implementation.

## Benchmarking

The frozen version 0.1.0 runs use Bun 1.4.1, one worker at a time, the same pinned
relaxed-DRC evaluator, and unchanged source at commit `6d4e332`. These historical
local Pipeline9 measurements predate the version 0.1.1 fixes:

| Dataset | Reference DRC passes | Rewrite DRC passes | Reference median | Rewrite median | Mean vias, reference → rewrite |
| --- | ---: | ---: | ---: | ---: | ---: |
| dataset01 | 85 / 85 | 85 / 85 | 824 ms | 39 ms | 37.52 → 33.54 |
| dataset-srj18 | 8 / 16 | 14 / 16 | 39.10 s | 1.20 s | 217.29 → 176.07 |

Both implementations failed sample014 in that historical run. Version 0.1.1
now completes it and passes the full PCB checks. The rewrite also completes
sample015, which the reference fails, and rejects sample016 with an independently
verified conflict in the imported pad geometry; the reference marks sample016
solved with six DRC errors. All 16 samples
remain in the raw reports. The exact-hash contradiction exception is explained
in [known input limitations](docs/known-input-limitations.md).

Network measurements use matching loopback services. The rewrite sends each
complete board remotely: cold performs 101 helper runs, and hot retrieves all
101 results from cache with zero helper runs. Both passes have zero local
fallbacks. This measures the full public pipeline and does not claim performance
on the deployed public cache service.

See [all local and network results](benchmarks/README.md), the
[controlled evidence](benchmarks/controlled-final/README.md), and the
[reproduction method](docs/benchmark-method.md). Earlier development reports
remain explicitly historical.
