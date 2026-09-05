# Benchmark method

The comparison uses the same 101 input samples for the replacement and published `@tscircuit/capacity-autorouter@0.0.884`: all 85 dataset01 exports and all 16 dataset-srj18 samples. Pinned commits and byte hashes are in [`datasets/manifest.json`](../datasets/manifest.json). The loader accepts no other dataset names and rejects altered sample bytes.

The reference interface and measurement definitions were inspected at [tscircuit-autorouter commit ba756a5](https://github.com/tscircuit/tscircuit-autorouter/tree/ba756a5ae2cf4c9a8c11bce21666a28362927e94/scripts/benchmark). This harness is independently written in the new repository. No upstream test suite was copied. It runs outside the upstream checkout; that checkout's Blacksmith-only benchmark instruction does not govern this repository. Baseline and candidate comparisons should use the same machine, Bun version, process concurrency, timeout, effort, and cache settings.

## Measurements

- **Completed:** the public `solved` flag after stepping or awaiting `solveAsync()`. Failed solves remain failures.
- **Relaxed DRC passed:** no errors from the reference evaluator. It checks trace overlap, board boundaries, trace continuity, via/trace clearance, pad/trace clearance, and same-net/different-net via spacing. Relaxed trace and via clearance are 0.1 mm. Input copper and explicit replacement metadata are handled by the reference evaluator.
- **Vias:** the number of `route_type: "via"` points in newly returned simplified PCB traces. Preloaded input vias are excluded from this metric, matching upstream.
- **Time:** wall-clock solve duration, starting after construction and ending before DRC. Imports, construction, DRC, and artifact writes are excluded. Networked solve time includes the awaited `solveAsync()` call. The parent process enforces a hard timeout of `300000 + 60000 × effort` milliseconds, with invalid or absent effort treated as 1. The timer covers the entire child task, including setup and DRC, as an upper bound against hangs.
- **Percentiles:** linearly interpolated p50 and p95 over successful solves and timed-out attempts. Solver failures that do not time out are excluded, matching upstream. Timeout duration is included for timeouts.
- **Average vias:** all completed samples with a via count, whether DRC passes or fails, matching upstream.
- **Trace length:** an additional diagnostic absent from the upstream benchmark. It sums Euclidean distances between consecutive same-layer wire points. Vertical via length is excluded. It is not used as a substitute for completion or DRC.

The only input transformation is the reference loader's legacy obstacle metadata migration. Older producers repeated the obstacle ID in `connectedTo`, immediately followed by its PCB port ID. The loader records this as SMT-pad or plated-hole Circuit JSON provenance according to the obstacle's layer count. It does not modify vendored files.

## Exact DRC oracle

`prepare-baseline.ts` installs the pinned public baseline in ignored `.benchmark/baseline`. It adds an export of the baseline bundle's internal `evaluateRelaxedDrc` function to a separate file in that installation. The export is located using a unique function-signature match; preparation fails if the expected signature changes. The published source map does not match the final terser output, so source-map coordinates are not used. The baseline bundle SHA-256 is recorded in `oracle.json`, and reports record the oracle hash.

This oracle gives both implementations exactly the same evaluator. It is development tooling only: replacement code never imports the baseline package, and the baseline package is absent from the replacement's runtime and development dependencies. The baseline bundles its original check implementation; installing the pinned checks package alongside it does not override the bundled evaluator. No additional dataset packages are installed.

## Reproducing a comparison

From the repository root:

```sh
bun scripts/benchmark/prepare-baseline.ts
bun scripts/benchmark/run.ts --module .benchmark/baseline/node_modules/@tscircuit/capacity-autorouter/dist/index.js --concurrency 1 --output .benchmark/baseline-results.json
bun scripts/benchmark/run.ts --module lib/index.ts --concurrency 1 --output .benchmark/rewrite-results.json
bun scripts/benchmark/compare.ts .benchmark/baseline-results.json .benchmark/rewrite-results.json
```

The default solver export is `AutoroutingPipelineSolver9_PreloadedTraceGraph`. Use `--dataset dataset01` or `--dataset dataset-srj18` to narrow a run. `--samples sample001,sample002` selects exact manifest names. `--traces-dir .benchmark/traces` saves output traces and full DRC errors for inspection. `--options '{"effort":1}'` passes explicit constructor options. `--timeout` is a diagnostic override in milliseconds and must be identical on both sides of a comparison.

Reports checkpoint atomically after each result and distinguish partial runs from complete runs. They fingerprint the implementation (all `lib/` source files for the default replacement entry point, or the selected module file for an external entry point) and flag changes during a run. Each sample runs in a fresh process, bounding CPU and memory lifetime and preventing cross-sample solver state. Logs include failures rather than treating unsuccessful or timed-out samples as completed.

The comparison command requires matching sample hashes, DRC oracle, Bun version, CPU, platform, and concurrency. It rejects every per-sample loss of relaxed DRC and every loss of completion on eligible inputs, aggregate regressions, more timeouts, or higher average via count. Its default p50/p95 allowance is 1.1 times the baseline to accommodate timing noise; pass a third argument of `1` for a strict time gate. Length is reported separately. A passing aggregate alone must not hide a newly failing sample.

One exact input has a separately verified source contradiction: [sample016's fixed-pad short](known-input-limitations.md). The comparator checks the pinned SHA-256, reloads the actual JSON, proves that the terminal's entire pad lies inside unrelated fixed copper, and independently checks electrical aliases. Only a candidate failure with the matching terminal, pad, layer, and intended-net witness qualifies; arbitrary failure and timeout never qualify. The baseline must have solved with nonzero DRC errors. A baseline DRC pass is always protected, including this sample. There is no configurable exclusion list. The comparison prints all raw counts and metrics unchanged, then compares counts, times, and vias with this independently certified input removed from both sides. Its explicit `acceptedInvalidInputFailures` entry retains the hash, source-proof document, original DRC error count, candidate error, and candidate witness. This is an infeasibility result, never a successful route.

## Pipeline9_Networked

Use `--solver AutoroutingPipelineSolver9_Networked`. Remote cache benchmarking additionally requires `--cache-pass cold` followed by `--cache-pass hot`, with identical explicit `HD_CACHE2_SERVER_URL` and `HD_CACHE2_CACHE_VERSION` settings. A cold run must use a fresh cache version. Both implementations must receive equivalent empty/populated cache states; do not warm the candidate using the baseline's run.

For either remote pass, candidate qualification requires exposed remote metrics and zero local transport fallbacks. A candidate hot pass must have every remote request satisfied by a cache hit, no batch misses, and no solver results. Oversized items can use the single endpoint if its response comes from cache; a single-endpoint request alone does not prove a cache miss. Independent service counters establish whether a helper ran. The worker records transport qualification separately from actual completion and DRC. This matters because the pinned baseline can reject an output returned by its own public node helper and finish locally; such baseline anomalies remain visible in `networkAudit` and do not erase its copper outcome. Local routing and transport contract tests alone do not establish remote cold/hot benchmark parity. Reports without remote cache settings make no claim about remote cache performance.

The benchmark-only `baseline-network-server.ts` dynamically loads the published baseline's public node helper after verifying the exact bundle hash. The package is version `0.0.884`, but its embedded network protocol version is `0.0.883`; the service uses the embedded value expected by the actual caller. It returns NDJSON batch cache misses, solves single requests, caches exact input/version/namespace matches, and exposes service counters at `/benchmark-status`. This service is isolated from the replacement's runtime and its own service.
