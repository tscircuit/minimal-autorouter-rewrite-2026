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
