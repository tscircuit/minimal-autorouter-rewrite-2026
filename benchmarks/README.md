# Controlled benchmark results

The rewrite passes the local, cold-cache, and warm-cache comparisons against published `@tscircuit/capacity-autorouter@0.0.884`, including a **strict timing ratio of 1.0**. Each of the six runs contains the same 85 dataset01 and 16 dataset-srj18 inputs. All 93 baseline relaxed-DRC passes remain passes in every mode; the rewrite reaches 99. There are zero benchmark process timeouts across all 606 attempts.

The run used Bun 1.4.1, an Apple M3 Pro on macOS (Darwin 25.6.0), and one worker at a time, from 2026-09-05 21:33:52 to 22:27:17 UTC. Source was frozen at [commit 6d4e332](https://github.com/tscircuit/minimal-autorouter-rewrite-2026/commit/6d4e33227f47064805518615c69b4dca3ae0d0c8). [The artifact index](controlled-final/README.md) records reports, hashes, service evidence, and provenance for later changes to public types.

## Raw results

Every supplied input remains in these tables. Time percentiles use completed solves and timed-out attempts; bounded solver failures that do not time out are excluded, matching the reference benchmark. Average vias use completed solves, including those with DRC errors. Times are seconds and exclude construction, imports, DRC, and artifact writes. See [the benchmark method](../docs/benchmark-method.md) for complete definitions.

### Pipeline9, local

| Dataset | Implementation | Solved | DRC passed | p50 (s) | p95 (s) | Average vias |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dataset01 | Baseline | 85/85 | 85/85 | 0.824 | 3.309 | 37.518 |
| dataset01 | Rewrite | 85/85 | 85/85 | 0.039 | 0.239 | 33.541 |
| dataset-srj18 | Baseline | 14/16 | 8/16 | 39.100 | 160.997 | 217.286 |
| dataset-srj18 | Rewrite | 14/16 | 14/16 | 1.205 | 33.590 | 176.071 |

[Baseline report](controlled-final/local-baseline.json) · [Rewrite report](controlled-final/local-rewrite.json) · [Strict comparison](controlled-final/comparison-local-strict.json)

### Pipeline9_Networked, cold cache

| Dataset | Implementation | Solved | DRC passed | p50 (s) | p95 (s) | Average vias |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dataset01 | Baseline | 85/85 | 85/85 | 0.941 | 3.717 | 37.518 |
| dataset01 | Rewrite | 85/85 | 85/85 | 0.043 | 0.243 | 33.541 |
| dataset-srj18 | Baseline | 14/16 | 8/16 | 33.335 | 189.025 | 217.286 |
| dataset-srj18 | Rewrite | 14/16 | 14/16 | 2.658 | 43.461 | 176.071 |

[Baseline report](controlled-final/cold-baseline.json) · [Rewrite report](controlled-final/cold-rewrite.json) · [Strict comparison](controlled-final/comparison-cold-strict.json)

### Pipeline9_Networked, warm cache

| Dataset | Implementation | Solved | DRC passed | p50 (s) | p95 (s) | Average vias |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| dataset01 | Baseline | 85/85 | 85/85 | 0.451 | 1.978 | 37.518 |
| dataset01 | Rewrite | 85/85 | 85/85 | 0.019 | 0.034 | 33.541 |
| dataset-srj18 | Baseline | 14/16 | 8/16 | 18.839 | 92.132 | 217.286 |
| dataset-srj18 | Rewrite | 14/16 | 14/16 | 1.076 | 7.825 | 176.071 |

[Baseline report](controlled-final/hot-baseline.json) · [Rewrite report](controlled-final/hot-rewrite.json) · [Strict comparison](controlled-final/comparison-hot-strict.json)

The solved/DRC counts and geometry metrics are identical across modes. Average returned trace length is 487.233 → 462.924 mm for dataset01 and 2171.315 → 1826.010 mm for srj18 (baseline → rewrite); length is an additional diagnostic, not an acceptance gate.

## The two remaining failures

Sample014 remains a bounded-search failure in both implementations. The rewrite solves sample015, which the baseline does not solve. Sample016 has an independently verified fixed-pad short: terminal `pcb_port_183` and its entire pad lie inside unrelated `pcb_smtpad_62`. The baseline marks sample016 solved with six DRC errors; the rewrite reports the source contradiction. [The input and routing limitations](../docs/known-input-limitations.md) distinguish these two cases.

The comparator retains sample016 in raw results. Its only exception independently checks the exact input hash, fixed geometry, distinct intended nets, and matching failure witness before removing that input from both sides of the acceptance calculations. It never waives a baseline DRC pass. On the remaining 15 srj18 inputs, baseline completion/DRC counts are 13/8 and rewrite counts are 14/14. The eligible timing population and via averages are:

| Mode | Baseline p50 / p95 (s) | Rewrite p50 / p95 (s) | Baseline average vias | Rewrite average vias |
| --- | ---: | ---: | ---: | ---: |
| local | 41.168 / 167.760 | 1.205 / 33.590 | 225.462 | 176.071 |
| cold | 41.700 / 194.547 | 2.658 / 43.461 | 225.462 | 176.071 |
| hot | 21.707 / 94.006 | 1.076 / 7.825 | 225.462 | 176.071 |

## Remote cache evidence

Both loopback services started with empty caches under a fresh namespace. The rewrite caches complete board problems; the baseline caches its native high-density node problems. These are end-to-end Pipeline9_Networked measurements, not equal-sized per-node speed measurements. The rewrite needs the matching service that advertises its board contract. The baseline package version is 0.0.884, with embedded wire-protocol version 0.0.883; the rewrite service uses 0.1.0.

| Service | Cold requests / helper runs | Warm cache responses / requests | Warm helper runs | Client fallbacks, cold / warm |
| --- | ---: | ---: | ---: | ---: |
| Baseline, node inputs | 22,789 / 22,789 | 22,789 / 22,789 | 0 | 1,714 / 30 |
| Rewrite, board inputs | 101 / 101 | 101 / 101 | 0 | 0 / 0 |

Every rewrite sample, including failed samples014 and016, was remotely evaluated. Its warm run accepted all 101 cached results with no misses and no solver responses. Seven oversized board inputs used the single endpoint for valid cached responses; the other 94 used batch requests.

The baseline's own client recorded 1,689 logical-timeout fallbacks and 25 invalid-response fallbacks during the cold run, affecting 22 samples. During the warm run it rejected 30 cached outputs across 21 samples, so its accepted client cache-hit count is 22,759 even though the service returned all 22,789 from cache. Its later received responses can overlap with logical-timeout fallback counts. These anomalies remain visible separately from actual solved/DRC outcomes; the baseline is not described as executing entirely remotely without fallback. Baseline samples014 and015 fail before the high-density stage and expose no remote metrics in either pass; they remain failed benchmark attempts. The rewrite has no network-audit issues in either pass.

[controlled-run.json](controlled-final/controlled-run.json) records all initial/end counters, request totals, source checks, and the three passing comparisons. The additional strict comparisons remove the default 10% timing allowance. Earlier reports in this directory are development measurements and are superseded by these controlled results for acceptance.
