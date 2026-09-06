# SRJ18 routing fixtures

Run `bun start` for Cosmos or `bun run fixtures:build` for a static export. There is a separate fixture for each of the 16 vendored dataset-srj18 samples. All fixtures use the same original React/SVG debugger.

Solve runs incremental steps in short batches and yields every animation frame. Pause, Step, Reset, and Save SRJ operate on the current solver. Layer checkboxes, airwires, net colors, zoom, pan, and hover labels expose the board and route geometry. Saved SRJ is available only after a successful solve. The display shows whatever partial routes the solver has produced and keeps failures visible.

Fifteen corresponding sample tests require completed routing, input preservation, stable output, and physical continuity between every requested net's terminals. Sample014 also requires zero issues from the full PCB checks; it no longer accepts partial routing. Sample016 verifies a pinned, independently proven source-pad conflict caused by an upstream import defect and requires an explicit infeasibility certificate. See [known input limitations](../docs/known-input-limitations.md).

`assertSample.ts` independently joins touching same-net trace segments, vias, and pads. Its validator tests verify that matching labels do not hide gaps or missing vias. Clearance/DRC parity is separately measured by the benchmark evaluator; this connectivity checker is not a complete manufacturing DRC engine.

Sample016 additionally offers **Corrected import** and **Original import** views
in the same fixture file. The corrected source restores four pad orientations
lost during import and completes 269 routing tasks with zero PCB issues. Its
separate tests cover local, cold network, and warm network execution. The
original view and certificate regression preserve the pinned benchmark case.
See [import corrections](../imports/README.md).

## Vercel hosting

The repository's `vercel.json` publishes `cosmos-export/` as a static site. Both
installation and export explicitly use Bun 1.4.1 to support the pinned lockfile.
The playground, fixture renderer, and all 16 lazy fixture bundles run in the
browser without a backend. Keep `renderer.html` and the exported asset paths
intact; no SPA rewrite is needed. The Vercel project is
`tscircuit/minimal-autorouter-rewrite-2026` and is connected to this GitHub
repository for subsequent deployments. Manual production deployment is available
with `vercel deploy --prod --scope tscircuit` from the repository root.
