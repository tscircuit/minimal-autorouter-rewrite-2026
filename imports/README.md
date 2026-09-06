# Corrected source imports

The corrected sample016 completes **269 of 269 routing tasks** and passes the
full PCB checks with **zero issues**. Physical connectivity and preservation of
the corrected source are checked independently. The original pinned benchmark
sample remains unchanged, alongside its existing contradiction regression.

The import omitted the absolute rotation of four KiCad trapezoid pads: C43 and
C44, pads 1 and 2. These pads have zero `rect_delta`, so their copper is exactly
rectangular. Their 270° orientation requires a 5.3 × 2.5 mm world envelope;
the old import emitted 2.5 × 5.3 mm. Only those four width/height pairs change.
Pad centers, components, ports, nets, layers, rules, and all other source fields
are preserved.

- [Corrected SRJ](dataset-srj18/sample016.corrected.srj.json)
- [Correction manifest and hashes](manifest.json)
- [Source audit across all 16 srj18 boards](source-rotation-audit.json)
- [Completed routing report](../benchmarks/import-corrections/sample016.routing.json)
- [Strict PCB validation report](../benchmarks/import-corrections/sample016.validation.json)

The audit matches 5,748 standard copper SMT pads to their source geometry and
finds these four rotation errors. Seven custom copper contours are outside that
rectangle-rotation audit. No other datasets are imported or used. The corrected
input is an explicit derivative of sample016, and does not replace an original
input in benchmark comparisons.

## Reproduction

With Bun 1.4.1 and the pinned dataset-srj18 checkout available:

```sh
git clone https://github.com/tscircuit/dataset-srj18 .benchmark/source-srj18
git -C .benchmark/source-srj18 checkout c0aad90256a95256fcac814f9f7da81a82a2fdea
bun scripts/imports/run.ts --source-dir .benchmark/source-srj18 --output-dir .benchmark/regenerated-imports
bun scripts/imports/validate.ts --output-dir .benchmark/import-corrections
```

The correction command verifies the original KiCad, Circuit JSON, SRJ, and
audit hashes before writing derivatives. It verifies every affected pad's
identity and original geometry, rejects unsupported taper/rotation changes,
and refuses to overwrite pinned sources or differing existing artifacts.
Regeneration is byte-identical to the committed corrected SRJ and manifest.

The regenerated Circuit JSON retains the original source's existing routing
records. Those records are source content, not newly autorouted output. The
validation command starts from the corrected SRJ, routes fresh copper, and
checks it against that corrected source. It writes routed SRJ, Circuit JSON,
validation coverage, and hashes of the code and import evidence.

The sample016 Cosmos fixture offers **Corrected import** and **Original import**
views. Tests require clean local, real cold-cache, and warm-cache routing of the
corrected input, with one cold helper execution, one warm cache hit, and no
fallbacks. The original view and certificate test retain the historical failure.

## Upstream importer fix

[Draft PR #184](https://github.com/tscircuit/kicad-to-circuit-json/pull/184)
fixes the general conversion path in `kicad-to-circuit-json`. Rectangle
fallbacks now share normal pad rotation handling; tapered trapezoids retain a
conservative rotated envelope with an explicit warning. The old defect was
reproduced using published 0.0.113 and the generator's pinned dependencies.

[The patch](upstream/preserve-trapezoid-pad-rotation.patch),
[published-version reproduction](upstream/regression-proof.json), and
[verification record](upstream/verification.json) are retained here.
Twenty-five focused synthetic tests, typechecking, and the package build pass.
The draft commit uses `[skip ci]` because upstream's full workflow downloads
unrelated datasets, outside the user's allowed scope. The fix is not merged or
released to npm yet.

The autorouter runtime is unchanged. Rebuilding its JavaScript produces SHA-256
`2bf2d00a0234980882b265e9c8f3b2632a6eb6023670cc2de42ecada18e9eec1`,
identical to the prior version 0.1.1 build. Existing benchmark measurements
therefore remain measurements of the same routing implementation.
