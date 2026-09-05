# Authorized benchmark data

This directory contains only these two datasets:

| Dataset | Pinned source | Samples | Layers |
| --- | --- | ---: | --- |
| dataset01 | [autorouting-dataset-01 at b97f505](https://github.com/tscircuit/autorouting-dataset-01/tree/b97f5052a2359ab2da3f186765c6a5e839535efb) | 85 | 2 |
| dataset-srj18 | [dataset-srj18 at c0aad90](https://github.com/tscircuit/dataset-srj18/tree/c0aad90256a95256fcac814f9f7da81a82a2fdea) | 16 | 2, 4, 6 |

The JSON files preserve the source bytes. `manifest.json` records each SHA-256 hash, source repository and commit, and basic size measurements. The benchmark verifies hashes before solving. Dataset01 uses its exported `circuitNNN` samples; numbering is intentionally discontinuous. Dataset-srj18 uses `sample001` through `sample016`.

Only sample inputs are vendored. Neither source repository's test suite, generators, dependencies, nor other datasets are imported. Dataset-srj18 files retain their source-board attribution fields. These input files come from the linked repositories and are separate from this repository's independently written source-code license.
