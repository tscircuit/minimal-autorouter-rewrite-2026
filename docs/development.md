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
