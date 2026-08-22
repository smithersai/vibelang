# W7-N Integration Report

## Agent export partition

`vibelang/agent` is Node-safe. It exports the coding agent, compiler, sandbox,
bindings, fakes (including `MemoryTurnJournal`), identity/model/prompt helpers,
Action tools, the platform-neutral Flow contract helpers, callable-surface
helpers, and shared agent types. Its built module has 46 runtime exports and no
transitive `bun:sqlite` dependency.

`vibelang/agent/bun` is the complete Bun surface. It re-exports every symbol
from `vibelang/agent` and adds the symbols that moved out of the Node entrypoint:

- `SqliteTurnJournal`, `TurnJournalIntegrityError`, and
  `TurnJournalDivergenceError`
- `flowTool`, whose terminal-outcome classification imports the Bun durable
  executor
- `StoredJournalEvent`, `StoredHostCall`, `StoredFlowCall`, and
  `SqliteTurnJournalOptions` (types)

The Bun surface retains all 50 runtime exports from the former aggregate agent
entrypoint. The platform-neutral `FlowToolContractError`,
`DurableFlowInterrupted`, `flowContractFromPlan`, `flowExecutionId`,
`DurableFlowBinding`, `DeployedFlowExecutor`, `FlowToolTarget`, and
`FlowToolOptions` remain on `vibelang/agent` and are consequently also available
from the Bun superset.

The new package export is:

```json
"./agent/bun": {
  "types": "./poc/dist/agent/bun.d.ts",
  "default": "./poc/dist/agent/bun.js"
}
```

Agent fixtures that exercise SQLite journaling or durable Flow execution now
import the Bun aggregate entrypoint.

## Regression fixes

1. Split `poc/src/agent/index.ts` from the new `poc/src/agent/bun.ts`, and moved
   the executor-dependent `flowTool` implementation into `flow-tools.ts`.
   `tools.ts`, `sandbox.ts`, and `coding-agent.ts` are now transitively Node-safe.
2. Added the exact declaration-only `NominalError<Identity>` unique-symbol brand
   to `scripts/fork-e2e/vibe-runtime.ts`.
3. Replaced the shipped terminal API's `NodeJS.ReadableStream` and
   `NodeJS.WritableStream` references with local structural input/output
   interfaces covering `on`, `write`, `isTTY`, `columns`, and `rows`. The emitted
   `terminal.d.ts` contains no `NodeJS` reference.
4. Added the accepted file-leading `/** @module @throws {never} */` trust marker
   to `schema-runtime.ts`. Its module initialization only performs deterministic
   imports and registers `ValidationError` once under a valid fixed identity;
   its codec callbacks are not invoked during initialization.
5. Updated the release runtime/type fixtures so `./agent/bun` is recognized as
   Bun-only and its representative API is typechecked.

## Verification

- `cd poc && bun run check`: pass, zero diagnostics (including zero in-flux
  diagnostics on the final run).
- `cd poc && bun test examples/agent/ src/platform/`: 219 pass, 1 skip, 0 fail
  across 21 files and 5,169 expectations.
  - Agent: 61 pass, 1 skip.
  - Platform: 158 pass.
- `npm run build`: pass.
- `node --test test/fork-e2e.test.mjs test/package-exports.test.mjs`: 10 pass,
  0 fail.
- `node --check scripts/verify-pack.mjs`: pass.
- `import("vibelang/agent")` under Node: pass, 46 runtime exports.
- Direct Node import of `poc/dist/agent/index.js`: pass, 46 runtime exports.
- `import("vibelang/agent/bun")` under Bun: pass, complete 50-export surface.
- `import("vibelang/agent/bun")` under Node: fails closed with
  `ERR_UNSUPPORTED_ESM_URL_SCHEME`, as intended for the explicit Bun subpath.

`npm run verify:pack` was not run, as directed.

SOURCE SETTLED
