# C8 frontend conformance report

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

All three JS-reference defects are fixed. Each case was first reproduced as `0/1 pass, 1 xfail`, its marker was then removed, and the case now passes as an ordinary conformance expectation. No runtime file needed a change.

## 1. `andThen` callback Results were reported as unconsumed

Conformance case: `01-result-lifting/result-transformations-preserve-the-error-type` — now `1/1 pass`, with no xfail marker.

Root cause: `producerConsumed` and `referenceConsumes` in `poc/src/language/semantic.ts` recognized an explicit `return` statement and the concise callback boundary owned by `Result.try` / `Result.tryPromise`, but stopped at every other concise arrow function. Consequently, the `Result` call in `result.andThen(value => fallible(value))` reached the arrow-function node and incorrectly produced `SMITHERS1301`, even though `andThen` consumes and flattens that callback result.

Fix: added a checker-backed concise-callback boundary restricted to Result receivers and the transformations that actually consume/flatten callback Results: `andThen` and `recover`. It is deliberately narrower than `RESULT_CONSUMERS`; `map` can nest a Result and `tap` discards its callback return. A focused language test proves both sides: a concise `andThen` return is accepted, while a separate discarded Result expression inside the same callback still receives exactly one `SMITHERS1301`.

Specification basis: `docs/src/pages/specification/failures.mdx`, “Matching and Transformation”, requires `andThen` and says a Result is not discarded when it is returned or transformed.

## 2. `Result.expect` threw past its declared Panic row

Conformance case: `01-result-lifting/expect-charges-the-panic-channel` — now `1/1 pass`, with no xfail marker.

Semantic decision: `Result.expect` must lower to a checked early return of the Panic error variant, not remain a throwing escape hatch.

The locked evidence is consistent on this point:

- `docs/src/pages/specification/failures.mdx`, “Inference and Public Contracts”, requires Panic to be explicitly catchable.
- The same page’s “Propagation” section requires the emitted checked error path to return the enclosing error variant rather than throw past the Result contract.
- `poc/src/language/README.md`, the `Result.expect(...)` rule, says `expect` charges the distinguished `Panic` channel to the enclosing inferred failure row.

A function typed `Result<A, Panic>` therefore has to deliver that Panic through its error variant. Leaving `.expect(...)` as a runtime throw made the declared row misleading and made the same Panic channel behave differently from a checked foreign boundary.

Root cause: semantic inference already collected `expectCalls` and added `Panic` to the owner’s row, but `rewriteExpression` only lowered Result/Optional `unwrap` calls. The authored `.expect(...)` survived emission and reached `poc/src/runtime/result.ts`, whose missed-lowering fallback throws.

Fix: the frontend now recognizes checker-proven Result `expect` calls and lowers them through `__vsInspectResult`. It evaluates and binds the receiver and message once in authored order; success yields the inspected value, while failure returns `__vsResultFailure(__vsPanicValue(new Error(message, { cause: originalError })))`. The generated return carries source provenance. The same placement, repeated-loop, JavaScript-catch, defer-cleanup, and control-flow-expression safety gates used for other checked early exits now include `expect`.

The focused execution test proves success remains a success variant, failure becomes a `Panic` error variant with the authored message and original error in its cause chain, and no runtime `.expect(...)` call remains in emitted code.

## 3. `Optional.fromNullable` crashed source-map compilation

Conformance case: `03-optionals/optional-nullable-interop` — now `1/1 pass`, with no xfail marker.

Root cause: `reserveBuiltinBindings` discovered that the checker-only `Optional` namespace needed a generated runtime import, but did not mark the output changed. `compileSemanticModel` therefore skipped AST printing and had no printer source map. Only afterward did `emitHelperImport` prepend the import and set `state.changed`, causing `createPreciseSourceMap` to reject the changed output with `changed output requires an AST printer source map`.

Fix: reserving any checker-prelude runtime namespace now marks the output changed before the identity-versus-printer-map decision. The transformed source is consequently printed with TypeScript’s AST/original-node provenance; the generated import header remains unmapped, and the unchanged authored `Optional.fromNullable` token maps exactly to its source span. The focused source-map test asserts all three properties.

Specification basis: `docs/DECISIONS.md`, “Optionals and nullability”, locks `Optional.fromNullable(...)` and `optional.toNullable()` as the explicit nullable interop operations.

## Verification

- `cd poc && bun run check`: pass, zero TypeScript errors.
- `cd poc && bun test src/language/`: **155 pass / 0 fail**, 1,095 assertions across 14 files.
- `cd poc && bun test`: **1,035 pass / 1 skip / 5 todo / 0 fail**, 13,367 assertions across 1,041 tests and 92 files.
- `node conformance/runner/run.mjs --backend js`: **91/91 pass / 0 fail / 0 xfail / 0 xpass**.
- `npm run build && node --test test/*.test.mjs`: build pass; **94 pass / 0 fail / 0 skipped / 0 todo**.
- `conformance/corpus` contains zero `xfail` fields, and `conformance/README.md` lists no current xfails.

SOURCE SETTLED
