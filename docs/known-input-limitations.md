# Known input and routing limitations

## A fixed-pad short in dataset-srj18 sample016

Sample016 cannot produce physically clean copper without correcting its supplied pad geometry or netlist. Its fixture remains available, and its test intentionally requires an explicit infeasibility report with a concrete conflict witness. It does not accept an arbitrary routing failure or pretend that invalid copper is solved.

The vendored source is pinned by SHA-256 `f323b21b2d833b61149d5041c04af8575c77b8cd3bb3340cba36c017872e6bf3`.

| Supplied object | Intended net | Top-layer geometry |
| --- | --- | --- |
| Terminal `pcb_port_183` | `source_net_15` | Center `(-1.843115, -5.06532)` |
| Its pad `pcb_smtpad_183` | `source_net_15` | Circular oval, diameter `0.75 mm`, same center |
| Conflicting pad `pcb_smtpad_62` | `source_net_12` | Rectangle, center `(-1.793115, -7.34032)`, width `2.5 mm`, height `5.3 mm`, rotation `0°` |

The terminal's coordinates relative to the rectangle center are `(-0.05, 2.275)`. The nearest rectangle edge is `0.375 mm` away. The terminal is strictly inside the unrelated pad, and its entire own pad of radius `0.375 mm` is contained within that rectangle, tangent to the top edge. The rectangle spans x `[-3.043115, -0.543115]` and y `[-9.99032, -4.69032]`.

An independent union-find audit included connection names, root/net aliases, terminal point and port IDs, obstacle connectivity and off-board aliases, and trace identities. The two intended nets remain distinct. In this source, `source_net_15` has 37 aliases and `source_net_12` has 41; sharing physical copper does not make their intended identities equivalent.

Any conductor reaching this required top-layer terminal or its own pad necessarily touches the unrelated net's pad. Route ordering, a different routing layer, or a via cannot undo the existing pad overlap. Reporting this source conflict is the honest outcome with the fixed input.

The recorded upstream Pipeline9 baseline marks sample016 solved but reports six relaxed DRC errors. Two errors specifically identify traces connected to `pcb_port_183` overlapping `pcb_smtpad_62`. This supports the source-geometry proof; the proof does not depend on upstream output.

The sample016 test checks the pinned source hash, actual pad shapes/dimensions/layers, full containment, distinct electrical aliases, input immutability, and an explicit solver failure naming the terminal and obstructing pad. Fourteen other srj18 samples require completed routing and physical endpoint connectivity. Sample014 has the separate bounded-search regression described below. Benchmark reports retain sample016's failure rather than counting it as a successful route.


## Bounded search on dataset-srj18 sample014

Sample014 currently exhausts the routing search while retaining substantial valid copper. The upstream Pipeline9 baseline also fails to solve this sample. Unlike sample016, this board has no established geometric infeasibility certificate: the unresolved pairs can be routed individually, and the remaining challenge is simultaneous routing through crowded pad and via escape regions.

The engine first tries deterministic route-order negotiation, then starts a separate bounded strategy that can remove conflicting movable routes and reroute them. Fixed input pads and copper always remain hard constraints. Finer-grid and larger repair-budget experiments improved coverage but did not establish a complete solution; those experimental settings are not selected by sample identity in the implementation.

The sample014 fixture test accepts a complete solution only when every source net has continuous copper connectivity. Its failure branch instead requires all of the following:

- A bounded terminal failure with a specific routing error, a nonempty list of unfinished tasks, and no unsupported infeasibility claim.
- An exact ledger: every required pair is represented once by either a retained trace or an unfinished task. Retained work must exceed unfinished work; this is a relative coverage floor, not a snapshot of one particular route count.
- Independent validation of retained copper: finite coordinates, positive dimensions, valid layer transitions, endpoints at the requested physical terminals on the intended net, and clearance from unrelated pads, traces, and vias.
- Input preservation, stable terminal state, and rejection of final-output access while the board remains unsolved.

This test documents a bounded search limitation. It does not count partial routing as a successful benchmark result or assert that the board is impossible to route. Benchmark reports retain sample014 as a failure until every required connection is completed.
