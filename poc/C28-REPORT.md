# C28 — documentation lane report

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

Date: 2026-08-23

## Outcome

The public documentation now describes Smithers rather than the retired
VibeLang surface, presents the TypeScript instrument and the real opt-in Go fork
implementation as distinct compiler paths, documents both compiler intrinsics
and all nine surface-grammar forms in the fork, records the provisional native
pin candidate without closing the decision, and keeps the release boundaries
explicit. The retired `!T`, prefix-`try`, and `native function` examples have
been removed from live documentation.

No current conformance scoreboard is copied into the docs. Every status page
instead identifies the corpus as a contract rather than a census and points at
`conformance/COVERAGE.md` as the live obligation-to-case matrix.

Nothing was committed.

## Files changed by C28

- `README.md` — added the two-compiler/tooling status and a concise evidence and limitation boundary.
- `docs/README.md` — updated content conventions for the default TypeScript instrument, opt-in Go backend, and moving conformance totals.
- `docs/TYPESCRIPT_FORK.md` — replaced the foundation-era story with the pinned source capsule, reversible forkpatch series, real Go lowering, both intrinsics, CLI selection, upstream-health evidence, tooling ownership, and distribution limits.
- `docs/COMPATIBILITY_API.md` — documented `--backend go`, internal fork lowering, current comptime/durable division, formatter/LSP reality, live coverage source, and remaining compatibility gaps.
- `docs/DECISIONS.md` — kept the native pin spelling Open while recording provisional `native(fn)` from `"smithers:native"`, binding-identity recognition, and the zero-grammar-cost rationale.
- `docs/src/pages/index.mdx` — replaced retired failure syntax and corrected the home-page TypeScript/native/Wasm claims.
- `docs/src/pages/introduction/getting-started.mdx` — added Go backend commands and the current two-implementation boundary.
- `docs/src/pages/introduction/overview.mdx` — updated the compiler, target, durable, formatter, and language-server status without claiming a conforming release.
- `docs/src/pages/guide/features.mdx` — replaced the obsolete file-local-frontend warning and qualified target availability.
- `docs/src/pages/guide/comptime.mdx` — documented the Go comptime subset and its tracked-asset/schema/loader/cache refusals.
- `docs/src/pages/reference/comptime.mdx` — added the checker-owned Go comptime path and its exact bounded scope.
- `docs/src/pages/guide/durable-execution.mdx` — documented Go `smithers:flows` lowering, supported Plan forms, and fail-closed remainder.
- `docs/src/pages/reference/actions-and-flows.mdx` — added the current TypeScript-versus-Go durable backend boundary.
- `docs/src/pages/guide/control-flow.mdx` — recorded that the Go fork parses, type-checks, and lowers all nine surface-grammar forms.
- `docs/src/pages/specification/control-flow.mdx` — resolved the prior loop-expression conflict by making only the labeled loop-value form Direction and retaining rejection of unlabeled loop expressions.
- `docs/src/pages/guide/platforms-and-targets.mdx` — replaced `native function` with the provisional imported intrinsic and documented full-path assertion diagnostics and grammar-cost reasoning.
- `docs/src/pages/reference/cli.mdx` — removed the stale 92-case claim, documented current Go semantics/intrinsics, preserved the JS default, and stated how formatter/LSP work.
- `docs/src/pages/specification/compatibility.mdx` — recorded the open native-pin candidate and its current checked-assertion evidence.
- `docs/src/pages/specification/index.mdx` — updated implementation status, the live conformance framing and four uncovered-obligation classes, and the required non-claims.
- `poc/C28-REPORT.md` — this handoff report, explicitly requested by the lane brief.

## Claims deliberately not made

- I did not publish a JS or Go conformance total. The corpus and backend results
  were moving during this lane; a copied 176-case snapshot would become stale
  without an exact tree identity. The docs point to the live matrix instead.
- I did not claim that the corpus proves feature completeness. It is a contract;
  `COVERAGE.md` is the census and names four classes of uncovered obligation.
- I did not claim a conforming, released, or production-distributed compiler.
  The TypeScript instrument remains the CLI default and the Go path is explicit.
- I did not claim complete parity for either Go intrinsic. Go comptime refuses
  tracked `embed` and lacks schema/loader/persistent-cache parity; Go durable
  lowering rejects fan-out, child Flows, general statement control flow, loops,
  broadcast, and queues.
- I did not claim exact emitted-byte parity between the TypeScript and Go
  durable compilers. The evidence is TypeScript artifact validation and matching
  digest recomputation for the landed Go subset.
- I did not close the native-pin spelling. `native(fn)` from
  `"smithers:native"` remains a provisional candidate under an Open ledger
  entry.
- I did not claim a native/LLVM backend or general Wasm backend. The current
  Wasm work is a bounded proof.
- I did not claim container/VM isolation, multi-machine durable coordination,
  signed compiler artifacts, vendored distribution patches, or cross-platform
  byte reproducibility.

## Stale naming and inconsistencies outside `docs/**`

These were reported only; their owning lanes were live and C28 did not edit
them.

1. Active durable compiler and corpus sources still use the retired
   `vibelang:flows` spelling:
   - `compiler/forkbridge/durable.go.txt:38`
   - `compiler/forkbridge/lowering.go.txt:271`
   - `compiler/fork_durable_test.go:90,189,210,219,227`
   - `conformance/corpus/17-durable/statement-branch-fails-closed.sm:1`
   - `conformance/corpus/17-durable/static-plan-shape-is-digest-pinned.sm:1`
   - `conformance/corpus/17-durable/unrelated-local-durable-stays-ordinary.expected.json:7`
2. Coordinator-owned `poc/PRODUCTION_READINESS.md` has a deliberately untouched
   but stale top snapshot: lines 7–20 freeze the old 92-case result and say both
   Go intrinsics have no lowering. Its conformance table also says grammar,
   LSP, and formatter work is absent (`:491`, `:499`, `:503`). The coordinator
   should reconcile that block with C20/C21/C19 and the current corpus when the
   live lanes settle.
3. `conformance/COVERAGE.md` still carries the 169-case measurement and calls
   the native pin unwritable because it has no spelling (`:208`, `:505`). C25
   added the provisional binding-identity spelling and area 21, and reported a
   176-case tree. The conformance owner should update the live matrix after the
   active corpus work settles.

Historical lane reports and scratch artifacts also contain old spellings; I did
not classify those records as active product surfaces or rewrite their evidence.

## Verification

```text
npm --prefix docs run build
  exit 0
  Vocs production build completed
  75 static files generated
  internal links validated

git diff --check -- README.md docs
  exit 0

documentation stale-name sweep
  no VibeLang, vibe CLI, VIBE diagnostic, @vibeEffects, .vibe, or
  vibelang:* occurrence under README.md or docs/**
```

SOURCE SETTLED
