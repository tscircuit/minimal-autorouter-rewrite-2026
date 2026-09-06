# Known input and routing limitations

## A fixed-pad short in dataset-srj18 sample016

The [corrected import](../imports/README.md) now routes all 269 tasks and passes
the full PCB checks. The analysis below applies to the unchanged original SRJ,
which remains in the benchmark and its original-input regression.

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

The sample016 test checks the pinned source hash, actual pad shapes/dimensions/layers, full containment, distinct electrical aliases, input immutability, and an explicit solver failure naming the terminal and obstructing pad. The other fifteen srj18 samples require completed routing and physical endpoint connectivity. Sample014 additionally requires the full PCB checks to report no issues. Benchmark reports retain sample016's failure rather than counting it as a successful route.

### The original KiCad source has different pad geometry

Follow-up investigation located a conversion defect before this SRJ was
generated. At the same pinned dataset commit
`c0aad90256a95256fcac814f9f7da81a82a2fdea`, the original
[KiCad C43 footprint](https://github.com/tscircuit/dataset-srj18/blob/c0aad90256a95256fcac814f9f7da81a82a2fdea/kicad_pcb/sample016-usb-c-power-adapter.kicad_pcb)
is rotated −90°. Its pad 1 is a 2.5 × 5.3 mm trapezoid at local
`(-3.4, 0, 270°)`. The intermediate Circuit JSON retains the component's
rotation but emits pad62 as an unrotated 2.5 × 5.3 mm rectangle. The SRJ
inherits that incorrect envelope.

The KiCad pad's world-aligned envelope is 5.3 × 2.5 mm. With the existing
pad center, that envelope no longer contains terminal183. Consequently, the
certificate above proves that the **pinned SRJ is contradictory**; it does
not prove that the original KiCad board contains that short. This is an
import correction to make explicitly in a derived input, not a net merge,
checker exception, or geometry change to hide in Pipeline9. The original
benchmark bytes and their failure witness remain intact.

Source SHA-256 values are
`f2ca55189e62f4f2638b7bde1058085ea6ab8bce9f7d846ca6946c1174d9c0e3`
(KiCad) and
`836877f24bfcd0033e3e90af00712e3e870a83189f99829b7df183772df7f951`
(intermediate Circuit JSON).

The same rotation was lost on both pads of C43 and C44: `pcb_smtpad_62`,
`pcb_smtpad_63`, `pcb_smtpad_196`, and `pcb_smtpad_197`. All four have zero
trapezoid taper. The explicit corrected derivative restores their world-aligned
5.3 × 2.5 mm envelopes at their existing centers, with all net and port identities
preserved. The import correction is checksum-guarded and independently tested;
Pipeline9 does not silently modify the original geometry.


## Completed routing on dataset-srj18 sample014

Sample014 now completes all 238 routing tasks from a fresh Pipeline9 run and passes independent physical connectivity and the full PCB checks. Earlier benchmark reports recorded an honest partial-routing failure; those historical results are preserved.

After ordered routing and its first repair strategy exhaust their budgets, a separate solver continues from the best valid partial result. It can displace blocking movable routes and queue them again. Fixed pads and input copper remain hard constraints. A short protection window prevents immediately displacing the same newly placed routes, and finer searches resolve crowded escape regions. The strategy is bounded and applies to every input without sample-specific settings.

The sample014 regression now requires complete routing, continuous physical copper, zero PCB issues, unchanged input, and stable terminal state. Separate synthetic tests exercise bounded failure and require every task to appear exactly once as retained copper or unfinished work, including when an outer solver reaches its iteration limit.
