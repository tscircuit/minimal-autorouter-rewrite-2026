# Rewrite constraints

- Use only the pinned dataset01 and dataset-srj18 samples listed in
  `datasets/manifest.json`. Do not add, import, or benchmark other datasets.
- Implement algorithms independently. The upstream autorouter may run only as
  an isolated benchmark oracle; never import it from replacement library code.
- Keep the solver pattern: bounded steps, explicit progress and terminal state,
  and inspectable child solvers. Partial routing is not successful routing.
- Preserve the canonical Pipeline9 and Pipeline9_Networked entry points and
  public SRJ output behavior. Describe any remaining differences explicitly.
- Create fresh tests. Do not copy the upstream test suite. Keep an individual
  Cosmos fixture and test for every dataset-srj18 sample.
- Distinguish electrical net aliases from proven physical copper connectivity.
  A verified contradictory input must produce a clear failure, never fabricated
  copper or a falsely successful solve.
- Run `bun run typecheck`, `bun run build`, focused tests, and affected benchmark
  samples for changes. Final performance comparisons require unchanged source
  and serial runs without competing solver work. Network cold/hot results must
  include real requests and audited cache statistics.
- Record substantial design changes and measured findings in `docs/`.
