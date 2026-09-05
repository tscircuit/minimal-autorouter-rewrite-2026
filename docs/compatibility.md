# Pipeline9 integration contract

The replacement exports `AutoroutingPipelineSolver9_PreloadedTraceGraph` and
`AutoroutingPipelineSolver9_Networked` under their original names. `Pipeline9`,
`AutoroutingPipelineSolver9`, and `Pipeline9_Networked` are convenience aliases.
Both constructors accept the SRJ followed by an optional options object.

For a package-level replacement, install this repository under the existing
dependency key. After an npm release, npm's alias syntax can keep application
imports of `@tscircuit/capacity-autorouter` unchanged. The repository currently
builds an ESM package with bundled TypeScript declarations and no runtime
dependency on the original autorouter. The additional `lib/*` source paths are
for TypeScript-aware tooling; the package root works in Node and browsers.

## Lifecycle and output

`step()`, `solve()`, `solved`, `failed`, `error`, `progress`, `iterations`,
`MAX_ITERATIONS`, and `activeSubSolver` retain the solver pattern. Steps after a
terminal state are idempotent. Solver exceptions set failure state and propagate.
The network class provides `stepAsync()`, `solveAsync()`, and
`solveUntilPhaseAsync()`; its synchronous bulk methods reject with instructions
to await the asynchronous method. Network effort remains restricted to 1.

The input is cloned. Obstacle layer names outside the declared board stack are
removed from the clone, matching the public constructor's normalization.
Unrecognized SRJ metadata remains present in the final SRJ.

`getOutputSimplifiedPcbTraces()` returns newly routed traces after successful
completion. `getOutputSimpleRouteJson()` includes both retained preloaded traces
and new traces. This implementation routes around preloaded copper and preserves
it, so `getUpdatedPreloadedTraces()` returns that copper and
`getMutatedPreloadedTraces()` returns an empty array. Partial routes are available
for inspection through the routing stage, but never returned as successful final
output. Vias have explicit dimensions and colocated layer-transition endpoints.

`highDensityRouteSolver.routes` contains numeric-layer `HighDensityRoute`
snapshots. Its `getSimplifiedTraces()` method exposes the internal SRJ trace form.
The facade delegates to a real child solver, including asynchronous pending
effects and failures. Snapshots cannot mutate engine copper. `_getOutputHdRoutes()`,
`getNewTracesBeforePowerExpansion()`, graphics previews, constructor parameters,
and per-stage wall-clock timing remain available.

## Stage boundaries

The algorithm has five real stages, each with a bounded-step solver:

1. `preprocessSimpleRouteJsonSolver` validates geometry, unifies electrical aliases,
   identifies physically connected copper, and plans required terminal pairs.
2. `escapeViaLocationSolver` reserves explicit terminal-via requests.
3. `highDensityRouteSolver` searches layered free space and repairs route ordering.
4. `lengthMatchingPostProcessingSolver` adjusts constrained conductor lengths.
5. `traceSimplificationSolver` assembles new traces with unique output identities.

`solveUntilPhase()` stops before constructing the requested real stage. Legacy
phase names resolve to the corresponding new boundary using
[`legacyPhaseTargets.ts`](../lib/legacyPhaseTargets.ts): preparation labels stop
after preparation, topology/pathing labels stop before routing, and routing-repair
labels stop before postprocessing. `getCurrentPhase()` and phase timings report
the actual stage name. Unknown phase names are errors.

The old capacity mesh, topology generators, and repair solver objects are not
recreated. Those diagnostic internals depended on the former algorithm. Consumers
that inspect them should instead follow `activeSubSolver`, the actual stage list,
and the routing statistics. `netToPointPairsSolver` refers to the preparation
solver. The final `powerTraceExpansionSolver` compatibility reference currently
refers to assembled nominal-width output; see the width behavior below.

## Routing controls

Trace widths, via dimensions, explicit clearances, layer restrictions, board
outlines, rotated rectangular and oval obstacles, terminal-via hints, bus widths,
and bus length limits are represented directly in the new routing problem.
Electrical aliases and overlapping same-net pads never by themselves prove a
physical path between distinct terminal ports.

`effort` scales search limits. Capacity-depth and mesh-dimension options are
accepted and preserved for callers, but this grid search has no capacity mesh;
those settings do not describe its internal subdivision. `cacheProvider` is
preserved, including explicit `null`. The pinned original's normal Pipeline9
solve did not call a supplied cache provider in the contract probe; network
caching uses its own explicit versioned protocol.

When several connection records name the same electrical net, preparation builds
one physical tree. Each record resolves its width from its own nominal override,
then an applicable bus width, then the board nominal width, then the minimum trace
width. The tree uses the largest resolved width. Permitted layers are the
intersection of all applicable bus restrictions across every member name and
alias. This whole-net policy is conservative: an empty intersection or a required
terminal with no eligible layer produces an explicit failure instead of silently
ignoring a member's constraints. Nonpositive or nonfinite resolved widths are
rejected. These resolved constraints remain private preparation state; source
connection metadata is preserved.

Nominal trace width is applied during search. The power-expansion options are
accepted as optional reshaping preferences. This implementation does not narrow
then shove or relocate preloaded traces to widen them later. Routes that already
meet their nominal width need no expansion. See
[`postprocessing.md`](postprocessing.md) for length matching and its constraints,
and [`network.md`](network.md) for service compatibility and measured transport.
