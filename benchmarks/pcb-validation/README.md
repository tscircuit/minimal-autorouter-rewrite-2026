# Full PCB audit after the fixes

The revised audit routes **100 of 101** pinned inputs and finds **89 PCB-clean
outputs**, up from 80. Every completed output passes independent physical
connectivity and preservation of the original geometry, requests, and fixed
copper. The strict audit still **fails** because 11 routed boards have fixed
input findings and sample016 contains a contradictory imported pad envelope.
No input or checker finding is exempted from this gate.

| Dataset | Samples | Routing completed | Zero PCB issues | Issues on completed routes | Issues on failed source inputs |
| --- | ---: | ---: | ---: | ---: | ---: |
| dataset01 | 85 | 85 | 78 | 12 | 0 |
| dataset-srj18 | 16 | 15 | 11 | 272 | 180 |
| Total | 101 | 100 | 89 | 284 | 180 |

[The current machine-readable report](report.json) contains the complete audit,
all diagnostics, source and artifact hashes, and conversion coverage. It uses
Bun 1.4.1, local Pipeline9, effort 1, no cache, `@tscircuit/checks@0.0.184`, and
Circuit JSON 0.0.485. Audit timings are diagnostics, not performance comparisons.
The [first report](report-before-fixes.json) preserves the earlier 80/101 result.

The fixes address distinct problems:

- The router now applies the checker's default 0.2 mm board-edge clearance to
  new copper. This removes 36 trace-edge reports and one generated-via edge
  report while respecting explicit source rules.
- Bounded completion repair routes all 238 sample014 tasks. Its complete output
  passes physical connectivity, original-input preservation, and all PCB checks.
- Verified original drill geometry and component membership correct sample012's
  false keepout report. The source object is a mechanical drill in the same
  footprint, and the routed geometry does not move.
- Validation compares output against original connection requirements, so
  deleting requested connections cannot manufacture a clean result.

The 464 current checker diagnostics are not 464 distinct physical defects.
Completed outputs have 284 reports, all concerning fixed input geometry. On
unrouted sample016, restored physical port identities now expose 118 additional
port-connectivity diagnostics that the earlier conversion missed; together
with 59 missing traces and three fixed-pad findings, this produces 180 source
reports. Total diagnostic counts therefore cannot be compared as a simple
before/after defect count.

The remaining boards and required design decisions are listed in
[source-layout findings](../../docs/source-layout-findings.md). The 260 reports
on sample006 concern DDR5 contacts 0.051 mm from the cutline under a default
0.2 mm rule; moving those contacts may change connector fit. Sample016's source
conflict is traced to a lost pad rotation in the original import, as documented
in [known input limitations](../../docs/known-input-limitations.md). The pinned
benchmark inputs remain unchanged.

Reproduce with Bun 1.4.1 from the repository root:

```sh
bun install --frozen-lockfile
bun scripts/validation/run.ts --output .benchmark/pcb-validation.json --artifacts-dir .benchmark/pcb-artifacts
```

The **Full PCB audit** workflow runs this strict validation on manual dispatch
and uploads its report and artifacts even on failure. Ordinary CI verifies the
implementation, including negative checks, source-preservation regressions,
individual srj18 tests, and all 16 Cosmos fixture builds. Passing implementation
checks does not override a failing PCB audit.

A clean converted board is certified only within the information represented
by its SRJ and verified source-hole records. Missing component bodies,
courtyards, plated drill details, and other unavailable source data remain
outside coverage. See [PCB validation](../../docs/pcb-validation.md) for the
conversion contract, dependency patch, and source-aware recheck commands.
