# Corrected sample016 validation

The explicitly corrected import routes **269/269 tasks** and passes the full
PCB checks with **zero issues**, including independent physical connectivity
and preservation of the corrected input. The reports retain both original and
corrected source hashes and the exact import evidence used.

- [Routing report](sample016.routing.json)
- [PCB validation and code provenance](sample016.validation.json)
- [Correction evidence and reproduction](../../imports/README.md)

This is a diagnostic validation of an import derivative. It does not replace
sample016 in the pinned performance benchmark or change the recorded 89/101
strict audit result for original inputs. The other 11 original boards with
fixed-pad findings still require design decisions.

Reproduce with Bun 1.4.1:

```sh
bun scripts/imports/validate.ts --output-dir .benchmark/import-corrections
```
