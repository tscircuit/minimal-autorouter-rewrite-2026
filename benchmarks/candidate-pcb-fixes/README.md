# Candidate evidence after the PCB fixes

The three fresh version 0.1.1 runs completed from `2026-09-06T00:41:22.182Z` to
`2026-09-06T00:50:18.723Z` with unchanged routing/harness source from
[commit b97af7c](https://github.com/tscircuit/minimal-autorouter-rewrite-2026/commit/b97af7c1ced6c0027f1d04cde653e38cfa992e52).
All strict comparisons pass. [Measured results](../README.md) contain the tables.

[The control report](candidate-run.json) records original sample hashes through
each report, source fingerprints, the exact runtime executable and environment,
service lifecycle and counters, and the historical baseline report hashes and
measurement window. Each comparison explicitly labels baseline timing as
historical. Baseline code/oracle and host match; those timings were not freshly
measured alongside this candidate.

| Mode | Fresh candidate report | Comparison against historical baseline |
| --- | --- | --- |
| Local | [local-rewrite.json](local-rewrite.json) | [comparison-local-strict.json](comparison-local-strict.json) |
| Cold | [cold-rewrite.json](cold-rewrite.json) | [comparison-cold-strict.json](comparison-cold-strict.json) |
| Warm | [hot-rewrite.json](hot-rewrite.json) | [comparison-hot-strict.json](comparison-hot-strict.json) |

To reproduce after preparing the isolated pinned baseline/oracle as described in
[the benchmark method](../../docs/benchmark-method.md), run on the recorded host
with no competing solver work:

```sh
bun scripts/benchmark/run-candidate.ts --baseline-dir benchmarks/controlled-final --baseline-module .benchmark/baseline/node_modules/@tscircuit/capacity-autorouter/dist/index.js --oracle .benchmark/baseline/node_modules/@tscircuit/capacity-autorouter/dist/benchmark-oracle.js --output-dir .benchmark/candidate-pcb-fixes
```

The driver requires Bun 1.4.1 and starts child processes using its exact executable.
It fails on changed input bytes, source, environment, oracle, missing samples,
network fallbacks, unverified cache reuse, or failed strict comparisons. A fresh
baseline measurement is available through `run-controlled.ts` when a coeval
six-run comparison is required. Never run a package script through a different
bare `bun` on PATH and assume the parent runtime was inherited.
