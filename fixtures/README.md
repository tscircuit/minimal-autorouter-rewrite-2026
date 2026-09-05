# SRJ18 routing fixtures

Run `bun start` for Cosmos or `bun run fixtures:build` for a static export. There is a separate fixture for each of the 16 vendored dataset-srj18 samples. All fixtures use the same original React/SVG debugger.

Solve runs incremental steps in short batches and yields every animation frame. Pause, Step, Reset, and Save SRJ operate on the current solver. Layer checkboxes, airwires, net colors, zoom, pan, and hover labels expose the board and route geometry. Saved SRJ is available only after a successful solve. The display shows whatever partial routes the solver has produced and keeps failures visible.

Fourteen corresponding sample tests require incremental completion, input preservation, stable output, unique trace IDs, valid route shapes/layers, and physical continuity between every requested net's terminals. Sample014 checks a complete valid solution if one is found; otherwise it requires a bounded, explicit failure with independently checked partial copper, accounted-for routing tasks, and rejected final-output access. Sample016 verifies a pinned, independently proven source-pad short and requires an explicit infeasibility certificate. See [known input limitations](../docs/known-input-limitations.md).

`assertSample.ts` independently joins touching same-net trace segments, vias, and pads. Its validator tests verify that matching labels do not hide gaps or missing vias. Clearance/DRC parity is separately measured by the benchmark evaluator; this connectivity checker is not a complete manufacturing DRC engine.
