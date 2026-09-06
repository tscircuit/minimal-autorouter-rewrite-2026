# PCB validation

`bun run validate:pcb` routes the vendored `dataset01` and `dataset-srj18` samples, converts each routed SRJ to Circuit JSON, and checks the result. The strict gate requires completed routing, valid converted elements, independent physical connectivity, and zero PCB issues. PCB warnings count as issues. A routing failure, conversion failure, disconnected required net, or PCB issue produces a nonzero exit status.

The current audit passes 89 of 101 samples: 100 route successfully, 11 completed routes have fixed-input PCB findings, and sample016 fails on its contradictory imported pad geometry. The first 80/101 audit is retained as `report-before-fixes.json`. See [the findings summary](../benchmarks/pcb-validation/README.md) and [the PCB validation report](../benchmarks/pcb-validation/report.json). Read each result's `didSolve`, `validatedOutput`, `error`, `physicalConnectivityError`, `sourcePreservationError`, `pcbIssues`, and `coverage` together. If routing fails, the validator can still inspect the supplied source geometry; that inspection is not a successfully routed output.

Run the full check from the repository root:

```sh
bun run validate:pcb
```

Select allowed samples and save both the report and inspectable artifacts:

```sh
bun run validate:pcb --dataset dataset-srj18 --samples sample003,sample004 --output .benchmark/pcb-selected.json --artifacts-dir .benchmark/pcb-artifacts
```

Validate an existing routed SRJ without running the autorouter again:

```sh
bun run validate:pcb --input .benchmark/pcb-artifacts/dataset-srj18/sample003.routed.srj.json --output .benchmark/pcb-recheck.json --artifacts-dir .benchmark/pcb-recheck-artifacts
```

To also verify an existing result against its original requirements and recover verified source drill geometry, supply the original SRJ:

```sh
bun run validate:pcb --input .benchmark/pcb-artifacts/dataset-srj18/sample012.routed.srj.json --source datasets/dataset-srj18/sample012.json --output .benchmark/pcb-recheck.json
```

`--source` compares the original terminal requests, electrical aliases, fixed copper, geometry, board fields, and rules against the output. Only the existing layer normalization and deterministic legacy metadata addition are permitted. It independently checks physical copper against the original terminals, so an output cannot pass by deleting a difficult requested connection. Dataset-mode audits always perform this comparison. Without `--source`, an existing file can be checked only against the requirements it retains; it cannot prove that an external original was preserved.

`--input` cannot be combined with dataset or sample selection. `--source` requires `--input`, because dataset mode already has a pinned original. Dataset selection is restricted to the two vendored datasets. The default report path is `.benchmark/pcb-validation.json`; `--output` overrides it. Reports are checkpointed after each sample and marked complete at the end. With `--artifacts-dir`, each sample has a converted `.circuit.json` file and, when routing succeeds, a `.routed.srj.json` file. Existing-input artifacts use the `input/routed` prefix. Reports include source hashes, package versions, issue details, and conversion coverage.

The checker dependencies are pinned to `@tscircuit/checks` **0.0.184**, `circuit-json` **0.0.485**, and `@tscircuit/circuit-json-util` **0.0.111**. [The validator](../scripts/validation/validateSrjWithChecks.ts) checks every emitted element against its Circuit JSON schema, then calls the public `runAllChecks` on a clone because some checks annotate endpoints. It also calls the exported `checkSourceTracesMatchPcbTraceThickness`, which this version's aggregate runner omits. The converter preserves resolved source trace-width requirements for that supplemental check. Non-PCB issues remain in the report even though the PCB gate specifically counts issue types beginning with `pcb_`.

[Independent physical connectivity validation](../scripts/validation/assertPhysicalConnectivity.ts) additionally checks continuous copper between the requested terminals on their eligible layers. Shared labels alone cannot establish that continuity. This matters for SRJ terminals without a corresponding original pad footprint, where the checker's pad-based connectivity checks have incomplete information.

The validator also calls `checkViaPadClearance` with an explicit source via-to-pad rule, when supplied: the pinned aggregate runner does not apply that dedicated field. Duplicate reports for the same pad/via pair retain the strongest violated clearance. Fresh regression tests cover converted outputs from local Pipeline9, real network execution, and a subsequent cache hit.

[The independently authored converter](../scripts/validation/convertSrjToCircuitJson.ts) preserves the supplied board bounds, outline and copper layer count; occupied obstacle geometry and rotation; source electrical aliases and terminal positions; fixed and newly routed traces; and via dimensions and physical layer spans. It emits standalone vias so checks that inspect `pcb_via` records see them, and deduplicates repeated representations of the same physical via on the same net. Explicit source rules are retained. Unspecified manufacturing rules keep the checker's defaults: the validator does not lower clearances, automatically enable via-in-pad, or suppress reported errors to obtain a clean result.

Physical port aliases are resolved using their declared net, position, and layer. One source-port identity may have several physical attachment positions, which remain separate PCB port records. Otherwise unrequested copper nets use virtual source ports to preserve electrical membership without inventing routing requirements. Generated trace aliases cannot merge two already distinct declared nets. Unknown or malformed geometry, unsupported route kinds (including jumpers and `through_obstacle` annotations), and missing required via dimensions fail conversion instead of silently disappearing. A route annotation cannot supply missing physical pad geometry.

Coverage records source and represented obstacle, trace, terminal, and via counts, along with emitted IDs and limitations. SRJ does not retain original component bodies, courtyards, schematic geometry, pin specifications, board material, or stack thickness. The converter does not invent them, so this process cannot certify their correctness. Plated-hole obstacles lacking drill geometry retain their known outer copper on the declared layers, with that limitation recorded; no drill is fabricated. Noncircular SRJ `oval` shapes are interpreted as PCB capsule/pill shapes, and that interpretation is disclosed because SRJ does not distinguish an ellipse from a capsule. Copper-pour obstacles retain their declared occupied footprint, while unavailable original boundaries and thermal details remain outside coverage.

Original component IDs are retained on converted pads and physical ports and in `coverage.obstacleComponentIds`. Component membership matters when a footprint legitimately contains its own mechanical hole. Missing component bodies remain absent. A pinned one-line Bun patch adds the missing `return` in `@tscircuit/circuit-json-util`'s unknown-ID diagnostic path, allowing actual overlaps to be reported without a formatting crash. Regression tests prove that unrelated pad/hole overlaps and genuine keepout collisions remain errors.

For the 16 checksum-pinned srj18 originals, [source geometry](../scripts/validation/sourceGeometry.ts) can recover 62 circular non-plated holes from a compact manifest of the same dataset's original Circuit JSON. The proof records the original SRJ hash, Circuit JSON path/hash and dataset commit, verifies each matching obstacle envelope and ownership, and is checked again when conversion uses it. This restores known drill geometry without changing routing obstacles or importing old traces, vias, or pours. Unknown sources retain the conservative SRJ-only conversion. Recognized but modified source data, mismatched envelopes, and forged proofs are rejected. This correction makes sample012's former pad–keepout report disappear because the original object is a same-component mechanical drill, not a keepout. Dataset routing uses the same checksum-verified metadata migration and solver layer normalization as the benchmark. The converter itself requires valid declared board layers rather than silently dropping geometry from a directly supplied `--input` file.

The [original relaxed DRC benchmark](benchmark-method.md) is a separate, narrower gate used for comparison with upstream Pipeline9. Passing it does not establish a clean result under these pinned public PCB checks. Fixed input defects and stricter default manufacturing rules can produce issues here even when routing completes; the report retains those issues. See [source-layout findings](source-layout-findings.md) for the remaining fixed-geometry decisions and [known input limitations](known-input-limitations.md) for the sample016 import defect and sample014 completion evidence.
