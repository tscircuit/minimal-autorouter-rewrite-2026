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
