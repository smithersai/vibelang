# C6 extension-rename repair and audit

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## Settled policy

`docs/DECISIONS.md` line 21 locks `.sm` as the Smithers source extension, and
`skills/smithers/SKILL.md` says that `.sm` opts into Smithers checking and
lowering. Neither source authorizes `.smithers` as a legacy alias, so the toolchain
must accept `.sm` only. `.smx` remains an open candidate and is not an
implemented source mode; the compatibility wrapper only rejects it with the
same honest `NotImplementedError` used for `.sm`.

Product and protocol names remain Smithers names. In particular, `smithers`,
`smthrs/runtime`, `smithers:comptime`, `smithers:flows`, `.smithers-*`, the
`smithers` CLI/bin, `kind: "smithers"`, `smithers:` nominal-identity prefixes, and
`.smithers-*` documentation CSS classes are not source extensions and were left
unchanged.

## Rename corruption repaired in owned files

- `scripts/fork-e2e.mjs:61`: `process.env.SMLANG_TYPESCRIPT_FORK` ->
  `process.env.SMITHERS_TYPESCRIPT_FORK`. The former silently ignored the
  documented and tested Smithers fork override.
- `scripts/fork-e2e.mjs:65`: `process.env.SMLANG_TYPESCRIPT_FORK_CACHE` ->
  `process.env.SMITHERS_TYPESCRIPT_FORK_CACHE`.
- `scripts/verify-pack.mjs:31`: `process.env.SM_VERIFY_TIMEOUT_MS` ->
  `process.env.SMITHERS_VERIFY_TIMEOUT_MS`. The package verification namespace is
  a product/CLI identifier, not the source extension.

## Legacy-extension inconsistencies repaired in owned files

These virtual source names are compiler inputs, so they must follow the
settled `.sm` convention. There is no legacy `.smithers` compatibility path.

- `poc/src/durable/broadcast.test.ts:44`:
  ``flows/${id.toLowerCase()}.smithers.ts`` ->
  ``flows/${id.toLowerCase()}.sm.ts``.
- `poc/src/durable/crash-matrix.test.ts:385`:
  `flows/crash-queue.smithers.ts` -> `flows/crash-queue.sm.ts`.
- `poc/src/durable/crash-matrix.test.ts:442`:
  `flows/crash-broadcast.smithers.ts` -> `flows/crash-broadcast.sm.ts`.
- `poc/src/durable/migration.test.ts:346`:
  ``flows/${id}.smithers.ts`` -> ``flows/${id}.sm.ts``.
- `poc/src/durable/migration.test.ts:362` and `:378`:
  `flows/Contract.smithers.ts` -> `flows/Contract.sm.ts`.
- `poc/src/durable/queue.test.ts:37`:
  ``flows/${id.toLowerCase()}.smithers.ts`` ->
  ``flows/${id.toLowerCase()}.sm.ts``.
- `poc/src/durable/queue.test.ts:116`:
  ``flows/invalid-queue-${index}.smithers.ts`` ->
  ``flows/invalid-queue-${index}.sm.ts``.
- `poc/src/durable/queue.test.ts:132`:
  `flows/conflicting-queue.smithers.ts` -> `flows/conflicting-queue.sm.ts`.
- `poc/src/durable/queue.test.ts:427`:
  `flows/other.smithers.ts` -> `flows/other.sm.ts`.
- `poc/.scratch-w4w/bundle-e2e-probe.ts:8`: `probe-action.smithers` ->
  `probe-action.sm`.
- `poc/.scratch-w4w/bundle-e2e-probe.ts:23` and `:50`:
  `probe-helper.smithers` -> `probe-helper.sm`.
- `poc/.scratch-w4w/bundle-probe.ts:11`, `:25`, and `:26`:
  `helper.smithers`/`impl.smithers` -> `helper.sm`/`impl.sm`.
- `poc/.scratch-w4w/subset-probe.ts:31`, `:35`, and `:37`:
  `probe.smithers` -> `probe.sm`.

## Toolchain consistency audit

- Root CLI input detection, formatter acceptance, project discovery,
  extensionless/`.js` authored-import resolution, and output rewriting all use
  `.sm` only.
- The language frontend semantic checks, LSP file-kind checks, project
  lowering, target classifier, comptime resolver, durable source closure, and
  portable backend all use `.sm` only.
- Source assets and the bounded foreign runtime graph recognize authored
  `.sm`; runtime outputs strip it to `.mjs`. Root declaration output remains
  `.d.mts`/`.d.cts` as designed.
- The forbidden Go content-mapper bridge consistently maps authored `.sm` to
  virtual `.sm.ts`, runtime `.js`, and content-mapper declarations
  `.d.sm.ts`. That is a documented fork-specific naming rule, distinct from
  the root CLI's `.d.mts` policy.
- Every deleted tracked `*.smithers` fixture/example has a corresponding `*.sm`
  file. Comparing each old file after the mechanical extension substitution
  with its new file found no missing or divergent rename.
- No actual `*.smithers` source file remains in the worktree. Remaining `.smithers`
  substrings are the intentionally preserved product/protocol identifiers
  listed above.
- No `.sm.sm`, `sm.sm`, `visms`, or `sms` mangling remains. `.smx` occurs only
  as the explicitly open/unimplemented JSX candidate and in the compatibility
  rejection guard.

## Forbidden-path owner handoff

- `conformance/runner/backend-go.mjs:45` still says
  `SMLANG_TYPESCRIPT_FORK`. Its owner must change that token to
  `SMITHERS_TYPESCRIPT_FORK`; it is the same product-environment corruption
  repaired in `scripts/fork-e2e.mjs`. I did not edit `conformance/**`.

No other remaining rename damage was found in the forbidden paths. In
particular, `compiler/forkbridge/main.go.txt:935` and `:941` correctly use the
`target.smithers` field, and the forbidden Go/fixture/fork files consistently use
`.sm` for source-extension checks.

## Gate-only inconsistency repaired

The first root Node run passed 90 tests and failed
`test/typescript-fork.test.mjs` because the owned test still asserted the old
vendor-status fields (`configuredRevision`, `vendorPath`, `sourcePresent`, and
`compilerModulePresent`). The forbidden vendor tool now deliberately reports
the vendored capsule contract (`revision`, `present`, `format`, ledger
strategy, dependency/payload counts, and `errors`).

`test/typescript-fork.test.mjs:26,35-43` was updated from the removed status
fields to the current capsule fields. The focused rerun passed 2/2, and the
complete root suite then passed 91/91.

## Exact verification results

- `cd poc && bun run check`: PASS; `tsc --noEmit`, zero errors.
- `cd poc && bun test`: PASS; 1,032 pass, 1 skip, 5 todo, 0 fail,
  13,351 `expect()` calls; 1,038 tests across 92 files in 191.21 seconds.
- `npm run build`: PASS.
- Initial `node --test test/*.test.mjs`: 90 pass, 1 fail; investigated and
  repaired as described above.
- Focused `node --test test/typescript-fork.test.mjs`: 2 pass, 0 fail.
- Final `node --test test/*.test.mjs`: PASS; 91 pass, 0 fail, 0 skipped,
  0 todo in 86.30 seconds.
- `go build ./...`: PASS.
- `go vet ./...`: PASS.
- `git diff --check`: PASS on the completed tree.

SOURCE SETTLED
