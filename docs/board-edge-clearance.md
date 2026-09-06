# Board-edge routing correction

The strict PCB audit found 36 board-edge errors on newly generated trace segments and one new via placement error. `CopperMap` previously treated absent `minBoardEdgeClearance` as zero. The pinned public checker, `@tscircuit/checks@0.0.184`, uses a default copper-to-board-edge clearance of **0.2 mm**. A trace of width 0.15 mm therefore requires its centerline to remain at least 0.275 mm from the board edge; a via adds its pad radius to the same clearance.

[`CopperMap`](../lib/routing/CopperMap.ts) now resolves the absent value to 0.2 mm and applies it to rectangular bounds and polygon outline segments. The spatial query radius includes this resolved clearance, even when the obstacle margin is smaller. Explicit finite nonnegative values, including zero, remain authoritative. Invalid negative or nonfinite values produce a clear error. The correction changes routing checks without changing source geometry, supplied rules, or vendored datasets.

The same collision map is used by local routing, the exact network board service, and network response validation. The request already includes the source clearance field, so no transport approximation or alternate routing model is needed.

The package and network implementation version are **0.1.1** for this change. Versioned cache keys separate these routes from 0.1.0 results, and the service rejects requests for the old implementation before routing. The controlled benchmark reads the rewrite version from `AUTOROUTER_VERSION`; its upstream package baseline remains pinned to 0.0.884, with embedded wire-protocol version 0.0.883.

## Affected-sample verification

All nine previously affected samples complete routing and pass independent physical connectivity after the correction. All 37 findings on newly routed copper are gone. Four supplied-pad edge findings remain; neither routing nor validation moves those pads or lowers their rules.

| Sample | Original PCB issues | PCB issues after correction | Remaining findings |
| --- | ---: | ---: | --- |
| dataset01/circuit002 | 6 | 0 | None |
| dataset01/circuit101 | 3 | 0 | None |
| dataset01/circuit105 | 4 | 2 | One fixed pad represented on top and bottom |
| dataset01/circuit109 | 3 | 0 | None |
| dataset01/circuit140 | 3 | 0 | None |
| dataset01/circuit151 | 3 | 0 | None |
| dataset-srj18/sample003 | 3 | 0 | None |
| dataset-srj18/sample004 | 8 | 2 | Two fixed pads |
| dataset-srj18/sample008 | 8 | 0 | None |

The machine-readable reports retain all diagnostics, source hashes, and coverage: [dataset01](../benchmarks/pcb-validation/board-edge-fix-dataset01.json) and [dataset-srj18](../benchmarks/pcb-validation/board-edge-fix-srj18.json). Their commands exit nonzero because the remaining fixed-pad issues still fail the strict gate. Recorded solve times range from 32 to 1,849 ms; these are affected-sample development checks, not a controlled performance comparison or a complete-board certification.

Fresh [board-edge tests](../tests/routing-engine/board-edge.test.ts) cover width and via radius, the default rule, explicit zero and other overrides, invalid values, sloped outline distance with a smaller obstacle margin, input preservation, and strict validation of local, actual cold network, and cache-hit output. Together with the existing geometry tests, all 19 tests and 89 assertions pass. TypeScript and the library build also pass. One existing negotiation fixture moves its synthetic terminals inward by 0.1 mm so the intended ordering case respects the corrected default.
