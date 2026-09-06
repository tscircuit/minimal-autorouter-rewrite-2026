# Version 0.1.1 benchmark results

Fresh local, cold-cache, and warm-cache candidate runs all pass comparison with
`@tscircuit/capacity-autorouter@0.0.884`, including a **strict timing ratio of
1.0**. The rewrite preserves all 93 baseline relaxed-DRC passes and reaches
**100 of 101** in every mode. There are zero candidate process timeouts across
303 attempts. Sample014 now routes completely; sample016 retains its explicit
contradictory-input failure.

**The baseline timings are historical.** They come from the earlier six-run
controlled measurement on this same recorded host; they were not rerun alongside
version 0.1.1. The candidate measurements are fresh, serial, and use Bun 1.4.1,
Apple M3 Pro, Darwin 25.6.0, and one worker at a time. Original input bytes, the
baseline bundle, and the DRC oracle match the recorded hashes. Routing and
harness source stayed unchanged during the candidate runs. See the
[artifact index](candidate-pcb-fixes/README.md) for provenance and reproduction.

## Raw measurements

Every table retains all 85 dataset01 and 16 dataset-srj18 inputs. Times are
seconds. Percentiles use completed solves and timed-out attempts; bounded
failures without timeouts are excluded, matching the reference benchmark.
Average vias use completed solves. These are the relaxed performance checks;
the separate [full PCB audit](pcb-validation/README.md) passes 89 of 101 inputs.

### Pipeline9, local

| Dataset | Implementation | Solved | DRC passed | p50 (s) | p95 (s) | Average vias |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dataset01 | Historical baseline | 85/85 | 85/85 | 0.824 | 3.309 | 37.518 |
| dataset01 | Rewrite 0.1.1 | 85/85 | 85/85 | 0.045 | 0.257 | 33.776 |
| dataset-srj18 | Historical baseline | 14/16 | 8/16 | 39.100 | 160.997 | 217.286 |
| dataset-srj18 | Rewrite 0.1.1 | 15/16 | 15/16 | 1.429 | 66.070 | 177.000 |

[Historical baseline](controlled-final/local-baseline.json) · [Fresh rewrite](candidate-pcb-fixes/local-rewrite.json) · [Strict comparison](candidate-pcb-fixes/comparison-local-strict.json)

### Pipeline9_Networked, cold cache

| Dataset | Implementation | Solved | DRC passed | p50 (s) | p95 (s) | Average vias |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dataset01 | Historical baseline | 85/85 | 85/85 | 0.941 | 3.717 | 37.518 |
| dataset01 | Rewrite 0.1.1 | 85/85 | 85/85 | 0.057 | 0.411 | 33.776 |
| dataset-srj18 | Historical baseline | 14/16 | 8/16 | 33.335 | 189.025 | 217.286 |
| dataset-srj18 | Rewrite 0.1.1 | 15/16 | 15/16 | 3.694 | 78.189 | 177.000 |

[Historical baseline](controlled-final/cold-baseline.json) · [Fresh rewrite](candidate-pcb-fixes/cold-rewrite.json) · [Strict comparison](candidate-pcb-fixes/comparison-cold-strict.json)

### Pipeline9_Networked, warm cache

| Dataset | Implementation | Solved | DRC passed | p50 (s) | p95 (s) | Average vias |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dataset01 | Historical baseline | 85/85 | 85/85 | 0.451 | 1.978 | 37.518 |
| dataset01 | Rewrite 0.1.1 | 85/85 | 85/85 | 0.029 | 0.063 | 33.776 |
| dataset-srj18 | Historical baseline | 14/16 | 8/16 | 18.839 | 92.132 | 217.286 |
| dataset-srj18 | Rewrite 0.1.1 | 15/16 | 15/16 | 1.120 | 8.376 | 177.000 |

[Historical baseline](controlled-final/hot-baseline.json) · [Fresh rewrite](candidate-pcb-fixes/hot-rewrite.json) · [Strict comparison](candidate-pcb-fixes/comparison-hot-strict.json)

The solved/DRC counts and aggregate geometry metrics are identical across modes.
Average returned trace length is 487.233 → 463.267 mm for dataset01 and
2171.315 → 1836.404 mm for srj18 (historical baseline → rewrite); length remains
a diagnostic rather than an acceptance gate.

## The retained source conflict

Sample016's pinned imported pad envelope contains an unrelated terminal. The
baseline reports it solved with six DRC errors; the rewrite rejects it with a
geometric witness. Original KiCad evidence traces the conflict to an import that
lost a pad rotation. The fixed benchmark bytes remain unchanged. See
[known input limitations](../docs/known-input-limitations.md).

The comparator's existing exception rechecks the exact sample hash, geometry,
distinct nets, and failure witness before removing sample016 from both sides of
acceptance calculations. It never waives a baseline DRC pass. The remaining
15 srj18 inputs have baseline completion/DRC counts 13/8 and rewrite counts
15/15. Each comparison records both raw and eligible statistics.

## Real service and cache evidence

The matching version 0.1.1 loopback service starts with an empty cache under a
fresh namespace. Each remote work item is a complete board. Client and server
counters independently agree:

| Pass | Batch HTTP calls | Single HTTP calls | Capability HTTP calls | Board helper executions | Cached board results | Local fallbacks |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold | 94 | 101 | 101 | 101 | 0 | 0 |
| Warm | 94 | 7 | 101 | 0 | 101 | 0 |

All 101 boards, including the explicit sample016 failure, are evaluated remotely
and subsequently retrieved from cache. Seven oversized inputs use the single
endpoint for warm results. The service is stopped after measurement. No cache,
transport, source-preservation, or comparison audit failures are recorded.

The historical baseline service processed native high-density node problems,
whereas this service handles complete boards. These are end-to-end public
pipeline measurements with different work-unit sizes, not per-node comparisons
or claims about the deployed public cache service. Historical baseline transport
fallbacks remain recorded in the [original controlled evidence](controlled-final/README.md).

The original version 0.1.0 reports remain in `controlled-final/` as historical
measurements. Version 0.1.1 timings supersede them for the current rewrite.
