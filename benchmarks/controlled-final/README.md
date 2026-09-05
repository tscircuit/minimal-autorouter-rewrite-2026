# Controlled run artifacts

This directory records the six serialized runs completed on 2026-09-05 between 21:33:52 and 22:27:17 UTC, using Bun 1.4.1 on an Apple M3 Pro, Darwin 25.6.0, with concurrency 1. The measured rewrite source is [commit 6d4e33227f47064805518615c69b4dca3ae0d0c8](https://github.com/tscircuit/minimal-autorouter-rewrite-2026/commit/6d4e33227f47064805518615c69b4dca3ae0d0c8). Each report covers the exact same 85 dataset01 and 16 dataset-srj18 input hashes.

[controlled-run.json](controlled-run.json) has `complete: true`, `passed: true`, and no integrity or service failures. [The results summary](../README.md) explains raw versus eligible results, timing populations, and network fallback anomalies.

| Mode | Baseline | Rewrite | Default comparison (1.1) | Strict comparison (1.0) |
| --- | --- | --- | --- | --- |
| Local | [report](local-baseline.json) | [report](local-rewrite.json) | [pass](comparison-local.json) | [pass](comparison-local-strict.json) |
| Cold cache | [report](cold-baseline.json) | [report](cold-rewrite.json) | [pass](comparison-cold.json) | [pass](comparison-cold-strict.json) |
| Warm cache | [report](hot-baseline.json) | [report](hot-rewrite.json) | [pass](comparison-hot.json) | [pass](comparison-hot-strict.json) |

Reports are unmodified measurement outputs. The strict comparisons were subsequently produced from those same reports with the existing comparison command and maximum time ratio 1; no solver was rerun. `controlled-run.json` retains the original default-ratio comparisons.

## Frozen fingerprints

All six reports have `sourceChangedDuringRun: false`. The orchestrator also checked the service and harness sources before and after runs. SHA-256 values recorded in `controlled-run.json` are:

| Input or code | SHA-256 |
| --- | --- |
| Rewrite library | `eef284fbfcdb892a30f6d494b4ed6e4ef2756b0271506cd4be6ea0045e2c9bd4` |
| Benchmark harness | `2cece35299851b205a94353e276de15b104ef67dac7415375a05a3fa55653576` |
| Rewrite service | `f2faf1f08fb4cfcc1dedba055fa1fda79c702c7165eed850cde3694ab97621a5` |
| Baseline service | `9f41f4bc51efbf2df5916aae8f0d06eace32f1eca50226682661d849ae6863b1` |
| Published 0.0.884 bundle | `25f50b7f73fd4b387f96a03e0e2672e9ca3a80c3ec567a9e0428e91dc9ce8e14` |
| Exact bundled DRC oracle | `53c0b0bd2d7e7499cd32d03d6708ff3662b7c49668d06f2f77ce069694a1ef75` |
| Allowed input manifest | `cfd259d15568a3b76cd3e02f12822f8fcdec1530243f7fbb260be829098354bd` |

Changes to public type interfaces after this frozen run are tracked separately in [type-compatibility-verification.json](type-compatibility-verification.json). Consult that artifact for the compared revisions and emitted-JavaScript equivalence evidence; the measured source commit and fingerprints above remain the benchmark provenance.

## Cache provenance

The fresh namespace was `minimal-rewrite-controlled-09d4b964-f54c-4036-960a-f8f1cf55fd24`. Services were created after the source snapshot and began with zero entries and zero helper runs. `serviceEvidence` in the control report contains process IDs, ephemeral loopback URLs, initial/end counters, and source fingerprints for each service. The baseline's 22,789 node inputs and rewrite's 101 board inputs each produced exactly that many cold cache entries. Warm counter deltas prove zero helper executions and cache responses for every requested input. Service processes were stopped by the orchestrator's cleanup.

Only [dataset01 and dataset-srj18](../../datasets/manifest.json) were used. Sample016's fixed-pad contradiction is the comparator's sole exact-hash exception; it remains a failure in raw rewrite results. [The certificate explanation](../../docs/known-input-limitations.md) and each comparison retain the witness and original six baseline DRC errors.

## Reproduction

Prepare the isolated baseline and use the pinned Bun runtime:

```sh
bun scripts/benchmark/prepare-baseline.ts
bun scripts/benchmark/run-controlled.ts --output-dir benchmarks/new-controlled-run
```

`run-controlled.ts` requires Bun 1.4.1. `--baseline-module` and `--oracle` can select an already installed isolated baseline. It does not download datasets. [The benchmark method](../../docs/benchmark-method.md) specifies metrics and process timeout behavior.
