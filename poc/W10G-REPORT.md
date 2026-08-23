# W10-G cleanup and reconciliation report

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## Item 1 — documentation reconciliation

Outcome: completed.

- Verified the current root export map before updating the package-entry-point
  table. `smthrs/platform`, `smthrs/data`, `smthrs/schema-runtime`,
  `smthrs/concurrency/bun`, and `smthrs/agent/bun` all exist. The docs now
  distinguish the Node-safe concurrency/agent entries from their Bun-only
  worker, SQLite-journal, and durable-Flow surfaces. Platform and data are now
  described as provisional root package APIs rather than checkout-only POCs.
- Verified all three formerly missing asset integrations in current code. The
  Smithers emitter rewrites re-exports and literal dynamic asset imports, semantic
  binding follows generated-module re-exports, and the root relative runtime
  graph resolves re-export/dynamic edges plus nested generated sibling edges.
  The compatibility, CLI, asset guide, and loader-design docs now describe
  named/namespace re-exports, literal dynamic asset imports, and generated
  graphs through depth four as end-to-end root support.
- Kept the real asset limits: type-only and side-effect asset forms, bare star
  re-exports, nonliteral dynamic imports/attributes, general executable
  generated modules, and non-asset dynamic `.sm` imports remain unsupported.
- Verified root schema wiring in `src/cli.ts`, the published
  `smthrs/schema-runtime` export, and the root compile/runtime test. The
  runtime-validation guide now describes `Schema.derive<T>()` in root `check`,
  `compile`, `run`, and `test`, while retaining the provisional virtual-module
  spelling and bounded reification grammar.
- Verified the actual `format` and `lsp` implementations and their root tests.
  The CLI docs now specify formatter inputs, in-place/check/stdout modes,
  `--indentSize` 1–8 (default 2), mutually exclusive `--check`/`--stdout`, and
  fail-without-rewrite behavior. They also specify the stdio JSON-RPC LSP's
  diagnostics, channel/failure/requirement hover, definition, formatting, and
  deliberate one-workspace/full-document/no-watch editor limits. The separate
  TypeScript language-service plugin remains accurately described as
  pass-through.
- No current claim in `docs/**` was refused. The historical statement in
  `poc/W6D-REPORT.md` and the stale integration paragraph in
  `poc/src/build/README.md` were not rewritten: the former is a settled lane
  report, and the latter is inside the explicitly forbidden live `build/`
  ownership area.

Verification: `npm --prefix docs run build` exited 0 and completed static
generation/link validation. `git diff --check -- docs` was clean.

## Item 2 — bundle `Sleeper`

Outcome: deliberately not applied because it cannot satisfy the required
unchanged-suite constraint.

`schedule.test.ts` currently has two compatibility/precedence tests that call
`TestPlatform.make()` and then merge its layer with
`Layer.succeed(Sleeper, provided)`: “a Sleeper provided by the Layer is used
with no option at all” and “an explicit sleeper outranks the one in the Layer”.
`Layer.merge` intentionally throws on duplicate nominal capabilities. Adding a
default `Sleeper` to `TestPlatform` would therefore make both unchanged tests
throw before `Schedule.retry` runs. It would also break the same extension
pattern for existing callers.

No duplicate-override semantics were invented, no scheduler test was edited,
and no partial Node-only bundle was introduced. `TestPlatform.make` was not
given a sleeper option because doing that without actually bundling the service
would expose an incomplete/misleading option, while bundling it would trigger
the conflict above. Consequently `poc/src/platform/layers.ts` and
`platform.test.ts` remain unchanged, and the documentation continues to say
that `Sleeper` is not bundled.

Verification: the unmodified full platform suite reports 158 pass, 0 fail
across 15 files.

## Item 3 — forged `__memory` export test

Outcome: completed; no backend validation hole found.

The new test compiles a real string-using portable module and parses its Wasm
export section. It then constructs two independent, structurally valid binary
patches:

1. renames the eight-byte `__memory` export in place to `__hidden`, leaving the
   section lengths unchanged; and
2. rebuilds the export vector and section-size LEB to append
   `function:__bogus`, a second name for a real function index.

Stock `WebAssembly.Module` accepts both patched binaries and reports the forged
surfaces. After recalculating the binary/build digests, `executePortableWasm`
rejects each with the exact diagnostic `{ code: "SMITHERS5059", message: "portable
Wasm exports do not match checked IR", line: 1, column: 1 }`. No change to
`portable-backend.ts` was needed. The focused backend file reports 22 pass,
0 fail.

## Item 4 — classifier limitation boundary

Outcome: completed without changing analysis behavior.

`classify.ts` now has a file-header limitations block covering:

- indirect/higher-order calls;
- object-literal and class methods;
- nested declarations, expressions, arrows, and method bodies;
- generic capability receivers; and
- Layer provision/satisfaction/subtraction.

`classify.test.ts` mirrors those five shapes as clearly named `test.todo`
entries. Existing active assertions that pin current under-reporting remain in
place. The focused classifier file reports 21 pass, 5 todo, 0 fail.

## Final verification

- `bun test src/platform/` — 158 pass, 0 fail, 15 files.
- `bun test src/targets/` — 43 pass, 5 todo, 0 fail, 2 files. The pass count is
  one above the 42-test baseline because of the forged-export test.
- `bun test src/platform/ src/targets/` — 201 pass, 5 todo, 0 fail, 17 files.
- `bun run check` — exit 1 solely because the concurrently edited, out-of-scope
  `src/durable/engine.ts:757:75` has TS2366 (“Function lacks ending return
  statement and return type does not include 'undefined'”). After correcting
  the local `test.todo` callback signatures, the command reports no error in a
  W10-G-owned file.
- A same-compiler-options targeted `tsc --noEmit` over
  `classify.ts`, `classify.test.ts`, and `portable-backend.test.ts` exits 0.
- `npm --prefix docs run build` — exit 0.
- `git diff --check` over all W10-G-owned changed files — clean.
- No commit was created. `npm run verify:pack` was not run.

SOURCE SETTLED
