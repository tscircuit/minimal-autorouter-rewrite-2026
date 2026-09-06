# Development record

## 1. Contract and independent foundation

Reference: tscircuit/tscircuit-autorouter commit
`ba756a5ae2cf4c9a8c11bce21666a28362927e94`, published version `0.0.884`.

Public interfaces and benchmark behavior were inspected. Algorithm code and the
upstream test suite are not copied into this repository. A separate routing
implementation is developed from the geometric problem and the observed public
contract. The upstream package can be installed in an ignored benchmark-only
workspace for comparison.

The first abstraction separates electrical equivalence (names belonging to one
net) from existing copper (which terminals already have a physical path).
Preparation creates a minimum-length spanning set of required terminal pairs.
Routing owns space, clearances, layer transitions, and ordering; the outer
pipeline owns orchestration and public output semantics.

Benchmark acceptance remains open. Each allowed sample must have comparable
completion, DRC, via count, and time measurements, with network cache behavior
measured separately. A passing API test is not evidence of routing parity.

## 2. Geometric routing and first comparisons

The independent router uses layered A* with exact terminal attachment, continuous
segment collision checks, and a spatial index for existing copper. Grid pitch
refinement addresses narrow passages. Route ordering retries retain evidence
about difficult pairs. Every shortcut is checked against the same copper model.

Preparation initially processed one input connection at a time. Benchmark DRC
showed that separate records belonging to one electrical net could remain
physically disconnected. Preparation now builds one spanning tree for all
terminals of each electrical net, including existing copper components.
Propagated obstacle `offBoardConnectsTo` aliases do not imply that every pad on
the net already has a physical connection; explicit external connections and
actual copper establish connectivity.

The local interface, source metadata preservation, preloaded trace output,
incremental/bulk parity, layer transitions, geometry, and independent continuity
validator have focused tests. Sixteen individual Cosmos fixtures are statically
bundled. The sample003 fixture was exercised in a browser through a complete
solve, with routes, layers, progress and export availability verified visually.

Early development timing runs overlap other routing work and are diagnostic.
Final timing comparisons must run serially on an otherwise idle benchmark host.
Network integration and difficult srj18 cases remain in progress.

## 3. Preserve successful strategies before repairing congestion

Immediate rip-up improved sample006 but changed the route-order trajectory that
had completed sample002. The routing solver now finishes a bounded ordinary
ordering attempt first. Only an unsuccessful attempt starts a fresh strategy
that may remove and reroute a few movable blocking traces. Fixed copper and pads
remain hard constraints in both strategies. Statistics identify the active
strategy, total attempts, and actual rip-ups; a failed partial board cannot be
accepted as solved.

Sequential development checks completed all 244 required pairs in sample002 and
all 255 in sample006, both with zero errors from the exact baseline DRC evaluator.
This separation trades extra work on boards needing repair for preservation of
the successful simpler strategy. Final controlled measurements remain required.

Preparation also now preserves explicit wire attachment for distinct terminal
ports whose same-net pads overlap, and uses the interior of an oval when proving
contact with fixed copper. An oval's empty bounding-box corner cannot establish
electrical continuity. A terminal strictly enclosed by unrelated physical copper
on every eligible layer produces a structured contradiction witness before
search; sample016 exercises that behavior independently.

## 4. Public contracts and exact remote execution

The public routing stage now translates internal simplified traces into detached
numeric-layer HD snapshots. This keeps the search model independent of the
debugging format. Terminal-via reservations, length matching, and planar pair
coupling each have a real solver stage or child solver. Merged net constraints
are resolved before search and kept separate from source metadata.

Native network nodes cannot express every board constraint in the allowed
inputs. The network adapter therefore negotiates an exact-board contract before
sending the complete prepared routing problem to the independent service. The
same routing engine handles local and remote work. The client validates binding,
copper geometry, physical connectivity, and certified failures before accepting
a result. Cache identity includes the entire problem and an explicit namespace.

## 5. Controlled acceptance and declaration verification

Commit `6d4e33227f47064805518615c69b4dca3ae0d0c8` was frozen for six serial runs:
rewrite and reference locally, with cold caches, and with warm caches. Every run
contains all 85 dataset01 and 16 dataset-srj18 inputs. Library, harness, service,
oracle, and manifest fingerprints remained unchanged. All comparisons pass;
the rewrite preserves all 93 reference DRC passes and reaches 99. Raw failures
remain visible, including sample014 and the independently proven sample016
input short. See [the final results](../benchmarks/README.md).

Cold and hot service counters independently establish remote work and cache
reuse. The rewrite executes 101 cold board helpers, then serves 101 hot results
with zero helper executions. Both client runs have zero local fallbacks.

After those runs, commit `2bc2b66a2760c215458549222c1924364e2a720a` changed only
public declarations and erased assertions. Generic pipelines retain externally
declared rect-only SRJ types and source metadata, while output trace arrays allow
all generated copper. HD jumper declarations match the public input/output
shapes. The rebuilt JavaScript is byte-for-byte identical to the frozen build.
Compilation against the original package's actual declarations and a fresh
installation under the old package dependency key both pass.

The frozen implementation passed CI with 99 fresh tests, 84,504 assertions,
typechecking, package build, and all 16 Cosmos fixture bundles. The declaration
change additionally passes the compile-only external-type regression and all 16
focused compatibility tests. No upstream tests or other datasets were copied.

## 6. Full PCB checks and completion repair

The first strict Circuit JSON audit exposed a missing default board-edge margin
on generated copper. The router now resolves the same 0.2 mm default as the
pinned PCB checks, including the entire via footprint. This removes 36 trace
edge reports and one generated-via edge report while preserving explicit input
rules and the original layout bytes.

Repeatedly starting a whole-board search discarded useful progress on sample014.
A separate completion solver now continues from revalidated retained copper,
temporarily protects recent placements, and displaces a bounded set of movable
blocking routes. The fresh sample014 regression requires all 238 routing tasks,
independent physical connectivity, and zero PCB issues. Synthetic limit tests
ensure a failed or interrupted repair still returns an exact task ledger.

The source format also loses the distinction between some mechanical drills and
keepout rectangles. Validation now restores 62 non-plated drill geometries from
the checksum-verified original Circuit JSON of the same 16 allowed srj18 samples.
It preserves component membership without inventing component bodies or copying
old traces. This corrects sample012's false keepout finding. A one-line pinned
utility patch fixes diagnostic formatting for absent component bodies; actual
unrelated overlaps and keepout collisions remain errors.

The cache protocol version advances to 0.1.1 so older route results cannot bypass
the new routing rules. Historical reports remain historical; fresh candidate
runs measure the revised implementation and audit real cold and warm service use.

Fresh version 0.1.1 local, cold-cache, and warm-cache measurements all pass the
strict timing ratio of 1.0 against the historical baseline on the matching host.
Each mode now has 100 relaxed-DRC passes versus 93. Cold service counters prove
101 board executions, followed by 101 warm cache results with zero helper
executions and zero local fallbacks. Baseline timing reuse is explicitly recorded
in [the current benchmark evidence](../benchmarks/candidate-pcb-fixes/README.md).
The independent full PCB audit passes 89 of 101 original inputs; remaining
completed-output findings all identify fixed pads, and sample016 remains an
explicit source-import conflict.
