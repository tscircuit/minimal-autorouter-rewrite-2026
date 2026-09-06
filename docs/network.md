# Pipeline9 network behavior

`Pipeline9_Networked` uses this repository's independent routing engine through a capability-negotiated service. Use `await solver.solveAsync()`, incremental `await solver.stepAsync()`, or `await solver.solveUntilPhaseAsync(name)`. Legacy phase names resolve to actual implementation boundaries. Synchronous execution explains the required async methods. The public high-density stage exposes numeric `HighDensityRoute[]`; `getSimplifiedTraces()` supplies the original wire/via records used by the remaining pipeline.

Run `bun scripts/network-server.ts` to start the loopback service (port 3080, overridable with `PORT`). Pass its URL as `hdCache2ServerUrl` and an explicit `hdCache2CacheVersion` for isolated measurements. The service runs only this repository's own helpers. Its cache is process memory. `GET /benchmark-status` returns the implementation version, cache entry count, and service counters without changing them.

## Negotiation and exact board requests

Before routing, the adapter reads `GET /health`. The independent board extension is used only when the endpoint advertises the requested implementation version and `minimal_exact_board_v1` in `solvePolicies`. The board request carries the entire JSON routing problem: source SRJ, prepared tasks and electrical aliases, fixed copper, rectangular or oval obstacles and rotations, outline, all layer choices, trace widths, via dimensions, clearance policy, and effort. No constraints are approximated to fit the network request.

`benchmarks/network-development/board-eligibility.json` records lossless serialization, digest verification, and service-boundary validation for all **85 dataset01 inputs and all 16 dataset-srj18 inputs**. This is an eligibility check, not a solve or performance measurement. Every allowed input can perform real remote work through the independent service, including an input whose correct result is a certified failure.

The request includes a SHA-256 digest of the canonical routing problem. Cache identity includes implementation version, contract, namespace, and a SHA-256 digest of the exact request. Object property order does not alter identity; changed copper or constraints do. Both service and client check the problem binding. The library uses the browser-compatible Web Crypto API.

The board service runs the same `RoutingSolver` as the local pipeline. Successful responses contain new simplified traces; fixed input copper remains with the client. Returned traces are checked against trusted input for dimensions, layers, wire/via continuity, requested net membership, outline/copper clearance, and physical task connectivity through traces, fixed copper, and pads. Electrical names alone cannot fill a physical gap. The checks use the independent engine's conservative collision geometry; oval obstacles remain exact in the contract, while its collision map conservatively checks their rectangular envelopes. A terminal contradiction certificate is recomputed from the exact input before being accepted. Remote routing failures remain failures.

One whole board is a unit of remote work so all nets share copper constraints. Spatial decomposition and within-board distributed parallelism are not implemented. This approach supports exact remote execution and cache reuse, but its performance must be measured separately from upstream node decomposition.

## Legacy endpoints and transport

An endpoint that does not advertise the board contract receives only the existing `ordinary_then_regional_without_fixed_copper_v1` node format. For that format, rectangular outlines become node bounds; unrepresentable fixed copper, arbitrary outlines, varying widths, terminal/bus constraints, or clearance policies use explicit local fallback. `remoteUnsupportedInputs` and `remoteUnsupportedReason` expose these cases. They are never counted as remote cache hits.

The public service at `hd-cache2.tscircuit.com` advertised version `0.0.856` when inspected; version matching requires an endpoint advertising this package's current `0.1.1` implementation version. Its published schema also limits node sizes and obstacle types. No external routing requests were used in development or benchmark claims. The exact board extension requires this repository's service or a service that explicitly implements and advertises the same contract. See `network-completion-proposal.md` for the pinned primary-source audit.

Both contracts share `/solve-batch` NDJSON cache lookup and `/solve` on misses. Batches are bounded to 100 items and 1.75 MiB; a larger individual board uses `/solve` directly, including on hot cache passes. A hot single request is a cache hit only if its response says `source: "cache"` and the service does not execute the helper.

The parser supports fragmented/out-of-order NDJSON and independent item settlement. Version or namespace mismatch, malformed or missing results, invalid copper, HTTP/transport errors, and timeouts trigger local work with explicit reason counters. Legacy nodes have a 30-second logical deadline; negotiated boards have a 310-second deadline. A logical timeout can start local work while the remote transport finishes. `solver.highDensityRouteSolver.waitForAllRemoteRequests()` drains both request execution and stream cleanup, records late results, and leaves locally chosen output intact.

Stage statistics retain existing request, cache, miss, solver, transport, and fallback counters. Additions include `remoteCapabilityRequests`, `remoteBoardContractSupported`, `remoteCapabilityReason`, `remoteContract`, `remoteProblemHash`, and `remoteBoardResults`. Valid board failures expose the verified `terminalContradiction` when present. A zero-request local fallback cannot establish network performance.

## Controlled results

The [final controlled comparison](../benchmarks/README.md) covers all 101 allowed
inputs in local, cold-cache, and warm-cache modes. All three comparisons pass.
Each rewrite mode produces 85/85 dataset01 DRC passes and 14/16 dataset-srj18 DRC
passes, retaining every reference DRC pass. There are no process timeouts.

The rewrite's cold service starts with zero entries, executes 101 board helpers,
and stores 101 results. The hot pass executes zero helpers and serves all 101
results from cache. Failed samples014 and016 participate in both passes. Client
audits show 101 requests and zero fallbacks in each pass; seven oversized inputs
use the single endpoint even when warm. Independent service deltas confirm the
cache source of those responses.

These are complete-pipeline loopback measurements with matching services. The
reference sends its native high-density nodes and may reject its own helper's
output before finishing locally; those events remain in the reports. The two
implementations use different work units, so the comparison is not a per-node
microbenchmark or a claim about the deployed public service. Full inputs,
options, runtime, source fingerprints, and service evidence are retained under
[`benchmarks/controlled-final`](../benchmarks/controlled-final/README.md).

## Earlier sample003 development observations

`benchmarks/network-development/sample003-{cold,hot,local}.json` were recorded before the board extension using one native node and the same pinned relaxed DRC oracle. They remain historical development evidence:

| Run | Solved | Relaxed DRC | Time | Vias | Trace length |
| --- | --- | --- | --- | --- | --- |
| Network cold | Yes | Pass | 193.4 ms | 82 | 745.8066 mm |
| Network hot | Yes | Pass | 83.4 ms | 82 | 745.8066 mm |
| Local Pipeline9 | Yes | Pass | 141.5 ms | 82 | 745.8821 mm |

Cold used one actual request, one miss, one helper result, and zero fallbacks. Hot used one actual request, one cache hit, no helper execution, and zero fallbacks. Cold/hot output was byte-identical; source data remained unchanged. These single-sample observations do not establish full network parity or performance of the current board extension.

Fresh synthetic tests cover negotiated board cold/hot execution, exact serialization and cache keys, old endpoint behavior, corrupted geometry, foreign aliases, wrong layers and widths, fixed copper and outline checks, certificate verification, batch limits, timeout/drain behavior, and the public high-density facade. No upstream test suite was copied.
