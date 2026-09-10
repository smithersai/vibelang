# Alpha-0 executable-body demo — report

Started 2026-09-05 ~15:38 PDT against an actively moving tree (branch
`poc/pre-withdrawal-checkpoint`, uncommitted edits across `poc/src/durable`,
`poc/src/language`, `compiler/` by another agent). Everything below was
verified against the working-tree sources at that time, imported directly from
`poc/src/durable/index.ts` (never `dist`).

## How to run

```sh
bun poc/examples/alpha0/demo.ts          # exit 0 on PASS, 1 on any stage FAIL
bun poc/examples/alpha0/demo.ts --keep   # retain the SQLite journal / ledger / envelope
ALPHA0_WORKDIR=/some/dir bun poc/examples/alpha0/demo.ts   # choose where work files go
```

Files: `demo.ts` (orchestrator), `crash-child.ts` (spawned by stage 4),
`shared.ts` (flow source + deployment builder shared by both processes).
Deliberately not named `*.test.ts` so no test runner ever globs them.

## Result: PASS (all four stages, two consecutive runs)

1. **Compile** — a 15-line `.vibe` Flow with one `Action` (`Fetch`), a `for`
   loop over a mutable accumulator, and a `Layer.provide`/`Context` capability
   (`Rates`) compiles via `compileDurableBody`. The Effect Manifest carries the
   `perform:` site for the Action and the `get:` site for the Context, and the
   artifact survives a JSON round-trip through `validateDurableBodyArtifact`.
2. **Deploy + sign** — `Action.fromDescriptor` -> `Provider.provide` ->
   `Worker.pool` -> `buildBodyDeployment`; `SignedBodyDeployment.encode` with a
   fresh Ed25519 pair. Three forgeries rejected with three distinct errors:
   byte-flip ("artifact digest mismatch"), digest-consistent forgery
   ("signature verification failed"), untrusted signer ("is not trusted").
   `authenticate` + `requireAuthenticated` are nominal — a structural copy of
   the proof is refused.
3. **On-disk durability** — `DurableStore` takes a SQLite file path
   (`new DurableStore(path)`; `:memory:` is only the default), so this stage
   runs against a real file. A fresh store object + fresh `BodyExecutor` over
   the same file returns the persisted output with **zero** new provider
   invocations (proved by an append-only provider ledger).
4. **Real crash/restart** — a child process executes through the full public
   `BodyExecutor` path and SIGKILLs itself (exit 137) from the public
   `afterNodeAdopted` hook right after the first journal commit. The parent
   confirms on disk: status `running`, exactly one `node_succeeded` event, one
   ledger line. A second child (fresh process, fresh executor, deployment
   rebuilt from source, parent-signed envelope re-authenticated from disk)
   resumes the same executionId to the correct answer; the ledger shows the
   committed input was never re-invoked (1 `crash:` line + 3 `resume:` lines,
   4 distinct inputs).

Signature verification genuinely crosses processes: the parent signs, writes
envelope + trust key to disk; the child rebuilds the deployment locally (its
digests agree because they derive from declared identity) and authenticates the
parent's bytes.

## Integration gaps / rough edges (for the implementing agent)

1. **No typed path from `compileDurableBody` to `BuiltBodyDeployment<I, S>`.**
   `ExecutableFlow<Input, Success>` carries types only via the phantom
   `__types` field, and the compiled artifact is untyped, so the natural
   `{ id, version, body }` literal infers `BuiltBodyDeployment<unknown, unknown>`
   and every call site needs a hand cast (`as BuiltBodyDeployment<number, number>`
   in `shared.ts`; the repo's own `executableDeploymentFixture` has the same
   hole — its `execute(4, …)` only typechecks because Input is `unknown`).
   A helper like `ExecutableFlow.from<I, S>(body)` (or type parameters on
   `buildBodyDeployment`) would close the boundary.
2. **`BodyExecutor` does not surface the replay audit.** `ReplayDriver.audit`
   (requests / replayed / dispatchedLive counts) is created internally but
   never exposed, so the demo had to prove "committed step was not re-invoked"
   with an out-of-band ledger file. An optional audit on the execute result (or
   an `onAudit` hook next to `afterNodeAdopted`) would make replay observable
   through the public seam.
3. **`implementationDigest` does not cover implementation code.** It is
   `digest({ implementationId, implementationVersion, actionId, … })`
   (poc/src/durable/provider.ts:226). That is what makes the two-process demo
   work (both sides rebuild the provider and the digests agree), but it also
   means two processes with *different* function bodies under the same declared
   id/version authenticate identically. Presumably intended (declared-identity
   pinning, and `Provider.provideChecked` exists for compiled contracts), but
   worth stating loudly in the deployment docs.
4. **`poc/test/fixtures/durable-body-crash-runner.ts` bypasses the public
   path.** It monkey-patches `store.commitSuccess` and drives a raw
   `ReplayDriver`. The public `afterNodeAdopted` hook is strictly better for
   crash injection (this demo SIGKILLs from it through the real
   `BodyExecutor`); the fixture could be simplified to match.
5. **Minor:** `manifest.sites` is a union where some entries carry `key` and
   others `id` — consumer code needs an `in` probe to print them; a shared
   discriminated shape (or an exported type name in `index.ts`) would help.
   Also `ExecuteOptions.afterNodeAdopted`'s doc comment lives in `engine.ts`
   but its most interesting consumer is `body-executor.ts`; nothing in
   `index.ts` hints it is the sanctioned crash-injection seam.
6. **Not a gap, but a caveat:** bun strips types at run time, so these demo
   scripts are runtime-validated, not typechecked (running the repo's tsc gate
   was off-limits while the tree is mid-edit — it is also flaky under
   concurrent load, per project memory).

No blocking product gaps were found: every stage of the mission worked through
public exports on the first fully-assembled run.
