# Network completion assessment

This is a proposal, not an implemented protocol extension. The inventory in `benchmarks/network-development/eligibility.json` prepares only dataset01 and dataset-srj18 and calls the pure projection helper. It performs no geometric routing or remote solve requests.

## Current coverage

| Dataset | Samples | Representable by current board-node adapter | Not represented |
| --- | --- | --- | --- |
| dataset01 | 85 | 81 | 2 fixed-copper inputs; 2 board-clearance policies |
| dataset-srj18 | 16 | 11 | 5 nonrectangular outlines |

The exceptions are dataset01 circuits004/018 (fixed copper), circuits007/011 (clearance policy), and srj18 samples001/002/005/006/016 (outline). The adapter's own development server accepts its representable inputs, including actual oval pads. This does not imply admission by the published service.

## Published service admission

The production `/health` preflight reported installed autorouter version `0.0.856` and Cloudflare Containers as the backend. No solve was submitted. The primary service source at commit `044b8318f446bc06a745222fb578062e85559d67` imports a pinned `@tscircuit/capacity-autorouter` helper and rejects a different autorouter version before cache lookup. Choosing a cache namespace cannot install version `0.1.0` or change its solver. [Service package](https://github.com/tscircuit/hd-cache2.tscircuit.com/blob/044b8318f446bc06a745222fb578062e85559d67/package.json), [installed-helper adapter](https://github.com/tscircuit/hd-cache2.tscircuit.com/blob/044b8318f446bc06a745222fb578062e85559d67/src/autorouter-adapter.ts), [service API](https://github.com/tscircuit/hd-cache2.tscircuit.com/blob/044b8318f446bc06a745222fb578062e85559d67/README.md).

The service validates a strict node schema: unknown fields are rejected, obstacle type must be `rect`, nodes are limited to 512 port points/256 pairs, and request bodies are capped at 2 MiB. Running that pinned validator as a read-only audit against our projected inputs admitted 11 dataset01 inputs and zero srj18 inputs. Seventy eligible dataset01 inputs were rejected for actual oval pads. Among the 11 eligible srj18 inputs, five first fail the oval rule and six first fail the port-point limit; five also exceed the body cap. These are shape rejections before considering the unavoidable `0.1.0` version mismatch. The upstream validator was used only in ignored audit workspace, never copied into the replacement implementation. [Input validator](https://github.com/tscircuit/hd-cache2.tscircuit.com/blob/044b8318f446bc06a745222fb578062e85559d67/src/input-validation.ts).

The replacement therefore needs its own compatible service running the new helper, or a separately reviewed change/deployment to the existing service. Merely adding unknown fields to existing node requests will not work.

## Options

1. **Add an explicit exact-board contract to the new service.** Preserve the existing node contract, add a distinct policy/version for a JSON-serializable `RoutingProblem`, and advertise support in `/health`. The exact payload includes the board outline, actual pad shapes, all clearances, task widths/layer restrictions/terminal identities, fixed traces, and via dimensions. Cache keys include implementation identity, implementation version, contract version, namespace, and the canonical exact payload. The server executes the replacement's routing engine and returns geometry plus a concrete failure witness when infeasible. The client validates returned copper against that exact problem. The current `hdCache2ServerUrl` option still selects the backend; older servers receive only legacy requests or produce an explicit fallback. This is compatible with existing callers and legacy requests on the new server, but requires a backend supporting the new contract. It can genuinely execute all 101 routing problems remotely, including the honest failure for sample016. It does not provide spatial parallelism within one board.

2. **Implement spatial node decomposition and stitching.** Partition the shared topology, determine crossing port pairs, keep board-edge/fixed-copper constraints local where necessary, route independent interior nodes remotely, and stitch with geometric checks. This is closer to upstream's distribution of work and can reduce request sizes and hot-cache granularity. It is a substantial routing algorithm change with new cross-node continuity and inter-net collision risks; it must be benchmarked again. The existing production version would still require deploying the replacement helper, and exact oval geometry needs service support or a proven projection.

3. **Keep the present explicit local fallback.** This preserves every board constraint and requires no new protocol, but only 92 inputs can use the development node path and none can use the currently deployed service with version `0.1.0`. It cannot establish full network benchmark parity.

The practical next increment is option 1 with explicit capability negotiation and a new policy discriminator, followed by controlled cold/hot runs through the replacement service. Do not hide new fields under the existing policy or count local work as a network hit. Node decomposition can then be developed and measured separately without changing the top-level pipeline API.
