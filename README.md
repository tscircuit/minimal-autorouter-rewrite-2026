# Minimal autorouter rewrite, 2026

An independent TypeScript implementation of the `Pipeline9` and
`Pipeline9_Networked` interfaces from `@tscircuit/capacity-autorouter`.

This repository is under active construction. Benchmark parity is the acceptance
criterion, not a claim about the initial implementation. Results and remaining
differences will be recorded as the implementation develops.

The design keeps the solver pattern: each stage exposes `step()`, progress,
terminal state, and inspectable results. Named electrical connectivity, physical
copper connectivity, geometric search, and asynchronous transport have separate
responsibilities.

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

See [the benchmark method](docs/benchmark-method.md) for isolated baseline setup,
the allowed dataset revisions, DRC evaluation, process timeouts, and comparison
commands. Development results under `benchmarks/` are measurements during active
implementation; performance acceptance requires a stable implementation and
controlled runs. The first complete dataset01 development run reached 85/85
completed boards and 85/85 relaxed-DRC passes.
