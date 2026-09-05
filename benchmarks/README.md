# Reference results

[`baseline-pipeline9.json`](./baseline-pipeline9.json) records all authorized samples against published `@tscircuit/capacity-autorouter@0.0.884`, using the exact bundled relaxed DRC evaluator.

| Dataset | Solved | Relaxed DRC passed | Timeouts | p50 solve time | p95 solve time | Average vias |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dataset01 | 85 / 85 | 85 / 85 | 0 | 1.145 s | 5.333 s | 37.518 |
| dataset-srj18 | 14 / 16 | 8 / 16 | 0 | 38.180 s | 213.788 s | 217.286 |

Dataset-srj18 samples 001, 003, 005, 007, 009, 010, 011, and 012 passed relaxed DRC. Samples 014 and 015 failed to solve. Samples 002, 004, 006, 008, 013, and 016 solved with DRC errors. The report retains per-sample errors and timing rather than treating these cases as successes.

The run used Bun 1.4.1 on the CPU/platform recorded in the report, with two isolated child processes and the upstream timeout formula. It ran during implementation work, so other development processes may have affected timing. Final timing comparisons should be repeated with the same runtime and concurrency and without competing solver runs. These results establish reference behavior; they do not by themselves establish replacement parity or remote cache performance. See [`docs/benchmark-method.md`](../docs/benchmark-method.md) for definitions and reproduction commands.
