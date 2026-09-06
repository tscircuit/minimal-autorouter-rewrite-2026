# Findings that require an input-design decision

The routing fixes preserve the original dataset bytes, component positions,
footprint copper, netlist, outline, and explicit manufacturing rules. The
remaining findings below concern supplied geometry under the pinned checker's
rules. Changing a route cannot increase spacing between two fixed pads or move
a connector contact away from a cutline.

| Input | Fixed geometry reported by the checks | Required design decision |
| --- | --- | --- |
| dataset01/circuit001 | USB footprint pad pairs have approximately 0 and 0.00023 mm separation against 0.1 mm | Verify the connector land pattern before changing pad size or pitch. |
| dataset01/circuit018 | Two pad pairs have 0.05 mm spacing | Adjust relative component placement or justify a different manufacturing rule. |
| dataset01/circuit105 | Header copper is about 0.116 mm from the west board edge | Confirm whether the header or physical outline may move. |
| dataset01/circuit106 | Two pad pairs have about 0.076 mm spacing | Adjust relative component placement. |
| dataset01/circuit137 | One pad pair has about 0.015 mm spacing | Adjust relative component placement. |
| dataset01/circuit138 | One pad pair has about 0.025 mm spacing | Adjust relative component placement. |
| dataset01/circuit178 | Two pad pairs have about 0.09 mm spacing | Adjust relative component placement. |
| dataset-srj18/sample001 | R2/R3 pad pairs overlap in the original placement | Resolve the intended placement and optional resistor population. |
| dataset-srj18/sample004 | Two pads are about 0.104 mm from the west outline | Confirm component-placement or board-outline changes. |
| dataset-srj18/sample006 | 260 DDR5 edge contacts are 0.051 mm from the cutline against the default 0.2 mm | Establish the connector-specific fabrication rule; moving these contacts can change mating geometry. |
| dataset-srj18/sample015 | Six pads are about 0.124–0.125 mm from the west outline | Confirm component-placement or board-outline changes. |
| dataset-srj18/sample016 | The imported C43 pad envelope contains another net's terminal | Correct the upstream import's lost pad rotation in a separately identified derived input. |

The sample016 investigation identifies an import error in the pinned SRJ, not
a demonstrated short in the original KiCad board. The exact source evidence is
in [known input limitations](known-input-limitations.md).

The strict audit continues to report these findings. It does not reduce checker
defaults, merge unrelated nets, omit offending pads, or alter benchmark inputs.
Any repaired layout should carry its original source hash and an explicit
change record, and must be checked and routed again as a derivative rather than
counted as an unchanged benchmark input.
