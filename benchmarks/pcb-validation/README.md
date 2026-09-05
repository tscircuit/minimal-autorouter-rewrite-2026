# Full PCB audit

This audit is stricter than the frozen relaxed-DRC performance comparison. It
routes only the 101 checksum-pinned dataset01 and dataset-srj18 inputs, converts
their output to Circuit JSON, and calls `@tscircuit/checks@0.0.184` with the
supplemental public checks documented in [PCB validation](../../docs/pcb-validation.md).
It also independently proves physical copper connectivity. Any PCB error or
warning, incomplete route, conversion failure, or missing physical connection
fails the audit. No samples or reported issues are exempted.

The completed audit **fails**: 80 of 101 samples pass, 19 completed routes have
PCB findings, and two samples do not route. There are no conversion/checker
exceptions, and all 99 completed routes pass independent physical connectivity.

| Dataset | Samples | Routing completed | Zero PCB issues | Issues on completed routes | Issues on failed source inputs |
| --- | ---: | ---: | ---: | ---: | ---: |
| dataset01 | 85 | 85 | 73 | 33 | 0 |
| dataset-srj18 | 16 | 14 | 7 | 290 | 118 |
| Total | 101 | 99 | 80 | 323 | 118 |

The 441 total checker findings are diagnostics, not 441 distinct physical
defects: different checks can report the same pad pair, and failed source
inputs also generate missing-route findings.

[The complete machine-readable report](report.json) contains every diagnostic,
conversion coverage, source-file hashes, original dataset hashes, and hashes
of the validated SRJ and converted Circuit JSON artifacts. A solved board is
clean only for the information represented by its SRJ; absent component bodies,
courtyards, and original drill geometry cannot be certified by reconstruction.

Reproduce from the repository root:

```sh
bun install --frozen-lockfile
bun run validate:pcb --output .benchmark/pcb-validation.json --artifacts-dir .benchmark/pcb-artifacts
```

The **Full PCB audit** GitHub Actions workflow provides the same command on
manual dispatch and uploads the report and both artifact formats even on
failure. A failing audit is expected while these PCB issues remain. Ordinary
CI separately tests that the validator accepts valid boards and rejects
invalid ones, alongside the existing routing and compatibility tests.

The recorded run uses local Pipeline9, effort 1, and no routing cache. Its
timings are audit diagnostics, not a new performance comparison. Library
runtime code is unchanged; the rebuilt `dist/index.js` SHA-256 remains
`24f772b811a0b74dc6333bd595c53cc206cf38fe7fd2636978183ca61e32d7fe`.
Implementation verification passes: TypeScript, library build, all 155 tests
(84,654 assertions, including 56 new validation tests), and all 16 Cosmos
fixture exports. These passing implementation checks do not override the
failing PCB audit.

Representative findings distinguish new routing from fixed input geometry:

- `dataset01/circuit001`: three reports across two fixed pad pairs. One pair
  has only 0.0002286 mm clearance; the other has a rounding-scale overlap.
  Both miss the 0.1 mm required clearance. The overlap and clearance checks
  may diagnose the same pad pair separately.
- `dataset01/circuit101`: three board-edge findings on a newly generated
  trace, with 0.075 mm centerline distance against a required 0.275 mm.
- `dataset-srj18/sample001`: four reports across two fixed, overlapping pad
  pairs, including both overlap and clearance diagnoses.
- `dataset-srj18/sample003`: three board-edge findings on a newly generated
  trace, with 0.130 mm centerline distance against a required 0.250 mm.
- `dataset-srj18/sample006`: 260 fixed pad-to-board-edge findings. A
  representative pad has 0.051 mm clearance against a required 0.2 mm.
- `dataset-srj18/sample012`: one fixed pad–keepout overlap. Original component
  IDs remain in coverage provenance without dangling component references;
  the checker can therefore report this collision instead of crashing while
  trying to name a nonexistent component body.
- `dataset-srj18/sample015`: six fixed pad-to-board-edge findings, with
  representative clearances around 0.124–0.125 mm against 0.2 mm.
- `dataset-srj18/sample016`: routing is refused because of a verified fixed
  pad short. Its missing-route diagnostics describe an unrouted input, not a
  successfully generated output. The same distinction applies to failed
  sample014.

Moving new traces can address route-edge findings; fixed-pad defects require
changes to the supplied design or its justified manufacturing constraints.
This audit preserves the supplied geometry and does not lower checker defaults
to report success.
