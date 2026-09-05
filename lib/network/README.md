# Independent network routing

The canonical async Pipeline9 API is backed by a real remote routing request. Services advertising `minimal_exact_board_v1` receive the complete prepared board problem; older services receive the legacy node contract when representable and otherwise cause explicit local fallback.

- `boardContract.ts`: exact serializable problem, browser-compatible SHA-256 identity, independent board helper, and certificate validation.
- `capabilities.ts`: explicit version/contract negotiation before board dispatch.
- `HdCache2Client.ts`: shared bounded batch/NDJSON and single-request transport with independent item settlement and drain.
- `NetworkRoutingSolver.ts`: real remote work, transparent local fallback, counters, and async effects.
- `Pipeline9NetworkedHighDensitySolver.ts`: public solver facade with numeric high-density routes.
- `validateBoardRoutes.ts` and `validateRemoteRoutes.ts`: trusted-input copper and physical connectivity validation.

Run the loopback service with `bun scripts/network-server.ts`. Its GET health/status endpoints report supported contracts and actual cache/helper counters. It is an in-memory development and benchmark service. No upstream engine is used by this implementation.

See `../../docs/network.md` for protocol details, timeout behavior, limitations, and interpretation of recorded benchmark evidence.
