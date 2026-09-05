# Routing length constraints

`LengthMatchingSolver(problem, routes)` is an independently written incremental solver. It accepts the routing problem and newly routed simplified PCB traces, clones the trace array, and exposes the adjusted array as `routes`. It preserves caller input, terminal identities, copper layers, widths, vias, trace IDs, and fixed copper. It can be inserted after routing and before output assembly.

The stage supports `buses[].maxLengthSkew` and `differentialPairs[].lengthTolerance`. It measures the Euclidean length of consecutive same-layer wire segments. Vertical via barrel length is excluded because SRJ does not specify board thickness. Connections resolve through their declared names and aliases. A constrained connection must resolve to one new routed path; ambiguous branches, missing paths, and unmeasurable jumper/through-obstacle conductors fail with an explicit message.

Targets propagate through overlapping constraint groups. The stage only adds length and keeps half of the allowed tolerance as a rounding reserve. Rectangular excursions add twice their depth; when height is limited, multiple excursions distribute the added length. Triangular excursions handle small adjustments. All candidates retain their original segment anchors. Segments are tried by available length, with both sides, several placements, and up to 16 excursions per segment.

Every added segment is checked against board bounds and outline, pads, fixed traces, all other final traces, vias, and the original route's remaining copper. Self-intersections and same-net shortcuts are rejected. Terminal stubs may leave their own pads; added excursions cannot hide length inside a pad. Collision checks use actual routed width and the routing problem's clearance. Final measured skew is checked again before the solver reports success.

This is a bounded geometric search. A failure saying that no tested meander fits is not a proof that no possible PCB layout exists. It means this stage could not realize the requested length using the available straight segments and tested excursions. The stage does not report success with an unmet bound. It does not relocate existing vias or fixed copper.

When a differential pair specifies `traceGap` or `maxUncoupledLength`, the stage first runs `CoupledPairSolver`. Two uniform-width paths on a common layer are replaced with offsets of one shared centerline. The center-to-center separation is the requested edge gap plus half of each copper width. The solver tries a direct middle and bounded rectangular detours; paired corners are intersections of the offset segment lines. Terminal fan-in remains explicit, and every candidate is checked against pads, fixed/final copper, its own segments, and its companion. Length matching afterward can only alter terminal escape segments, preserving the coupled middle. Branching pairs, overlapping coupled groups, changing widths, and multilayer pairs fail with descriptive errors because this bounded planar stage cannot establish their coupling.

The pinned baseline actively changes middle geometry for `traceGap`: a synthetic pair with terminals separated by 3 mm produces a 0.15 mm edge gap when requested, and 6 mm when requested. It still reports success with `maxUncoupledLength: 0` while retaining uncoupled terminal escapes. The replacement likewise keeps every middle segment coupled and treats terminal escape geometry separately. If only `maxUncoupledLength` is specified, the middle uses the 1 mm edge gap observed for the baseline's omitted-gap synthetic case. This is an observed compatibility choice, not a claim that zero permits physically eliminating the separation between differently spaced terminal pads.

Fresh tests cover an analytic 8 mm / 4 mm bus, differential length tolerance, exact coupled gap with terminal preservation, a paired detour around pads and unrelated fixed copper, an impossible pair corridor, a board with no meander room, and a fixed same-net trace that would short out a proposed excursion.

# Observed power expansion options

The reference [power-trace-expander options at commit 69e92ef](https://github.com/tscircuit/power-trace-expander/blob/69e92efc8c3dec35f9c71ba58b3cdaefffd1c257/src/types.ts) contain three fields:

| Option | Reference meaning |
| --- | --- |
| `onlyConnectionNames` | Limits the top-level expansion scan; nearby copper can still move. |
| `allowNewVias` | Allows expansion reroutes to introduce vias. Pipeline9 defaults it to `false`. |
| `powerTraceToPadClearance` | Preferred clearance to unrelated pads; defaults to half the power trace's nominal width. |

These are expansion controls and preferences, not target-width fields or unconditional hard constraints. A direct reference probe with an already 1 mm wide route beside an unrelated pad returned identical geometry with default options, an empty selection, an explicit 1 mm preferred pad clearance, and permission to add vias. The route's actual pad clearance remained 0.2 mm. This observed behavior is why the replacement must not reinterpret the preference as a hard requirement.

The replacement routing engine currently routes at the resolved nominal width. That can legitimately leave no widening work for a final stage. Upstream's additional ability to reshape or push existing copper and widen narrow portions remains distinct from this length solver. No power-expansion capability is claimed by this stage.
