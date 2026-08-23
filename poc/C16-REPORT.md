# C16 — diagnostic identity and prelude API completion

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

Date: 2026-08-22

## Result

The live Go scoreboard is **91/92**: **91 match, 0 unsupported, 1 divergent, 0 xfail, and 0 unmeasured**.

The assigned snapshot was 80/91. All nine assigned cases now match, so this lane accounts for a nine-case gain. While this lane was active, the shared corpus gained `statement-switch-fallthrough-over-a-widened-scrutinee`, and the previously unsupported literal-scrutinee statement-switch case also became green outside this lane. That is why the live total is 91/92 rather than the isolated 89/91 attributable to the nine cases here.

The single live divergence did not increase: `11-expression-if-switch/switch-case-final-expression-is-the-value` still executes the selected values but loses the clause-statement trace (`"pass,retry"`). It is outside C16's assigned diagnostic/prelude cases.

## Diagnostic identity

The bridge does not translate a raw TypeScript code at a known coordinate. Each Smithers diagnostic requires a compiler-owned symbol or a parser recovery-tree shape; raw diagnostics that do not participate in that proof remain unchanged.

- `SMITHERS1201` — the owner of `.ok`, `.err`, `.success`, or `.error` must resolve to the compiler prelude's `Result` symbol. Only after that identity comparison does the bridge inspect which reserved constructor hook was selected. A same-spelled authored `Result` type/value resolves elsewhere and remains untouched. The diagnostic starts at the authored property access, producing 6:29 and 7:10 in the corpus.
- `SMITHERS1203` — the checker decomposes the function's compiler-owned outer `Result` and proves that its success type is itself the compiler-owned `Result`. This is a contract-normalization decision, so the bridge reports at the authored return type annotation (10:37), not at the later return assignment that happens to expose TS2322.
- `SMITHERS1255` — the called property must resolve to the prelude's global `Error.matchPartial` method declaration. The bridge validates the object-literal handler form and requires exactly the explicit second fallback argument. Missing it reports on the authored call receiver at 18:23, before TS2339/TS7006 cascades can escape. A valid partial match is lowered through the same constructor-symbol case resolution as exhaustive `match`, with the explicit fallback as the terminal branch.
- `SMITHERS1709` — the fork must have recovered a real `IfExpression`, and at least one branch must have the paired TS1005 recovery sites at that branch expression's start and trivia-skipped end. Those two sites are the parser's missing-open-brace and missing-close-brace pair. The pair is consumed and one diagnostic is anchored at the recovered `if` keyword (6:25). A lone TS1005 is insufficient.
- `SMITHERS1702` for an unlabeled loop expression — a variable initializer must be a missing recovery node at the exact position where the same source file contains a real recovered iteration statement, and TS1109 must occur at that shared position. This proves that the rejected expression operand is the unlabeled loop, yielding 2:17.
- `SMITHERS1715` plus `SMITHERS1702` for a loop value without `else` — the fork must have built a `LabeledExpression` whose wrapped statement is a real iteration statement and whose `ElseValue` is missing. The TS1005 must be at that missing member. The bridge reports malformed labeled-loop completion at the label (2:17) and the residual unsupported loop expression at the underlying `for` (2:25).

Focused controls use unrelated TS1005 and TS1109 parse failures and assert that they remain raw TypeScript diagnostics. This pins the contextual requirement and prevents the bridge from becoming a code/position lookup table.

## Prelude completion and runtime behavior

`Optional` now has a compiler-owned value namespace as well as its existing type alias. The prelude exports frozen `SmithersOptional.fromNullable`, whose generic parameter accepts `A | null | undefined` and delegates to the existing boxed Optional constructor. An authored global `Optional` reference is rewritten only when its checker symbol contains the prelude's ambient declaration; the replacement is a factory-built import alias. A user-declared `Optional` value or type has different declaration identity and is not rewritten.

The prelude's global `Error` interface now declares `is`, `matches`, `match`, `matchPartial`, and `rootCause`. Existing exhaustive `match` remains constructor-symbol lowered, and valid `matchPartial` now uses the same nominal dispatch with its fallback. The executable prelude installs non-enumerable `is`, `matches`, and `rootCause` methods on `Error.prototype` only when the host has no own implementation:

- `is` checks native constructor identity safely;
- `matches` checks the supplied constructor set;
- `rootCause` follows own data-property `cause` links, returns non-Error causes, and terminates on cycles.

When one of those compiler-owned Error methods survives as an authored runtime call, resolved method-declaration identity requests a side-effect-only prelude import. Same-spelled methods on an authored class do not. Executed tests cover present/absent nullable adaptation, `is`, multi-constructor `matches`, root-cause traversal, both partial-match branches, and user-defined `Optional`/Error-like methods remaining free of `__smithers` imports.

All replacements are fork AST-factory nodes and all output is produced by the fork printer. There is no source-text rewrite. Prelude imports are synthesized and unmapped; the changed Optional token retains the printer's semantic start anchor back to the authored `Optional` token rather than claiming character identity for the longer generated alias.

## Fork boundary and remaining work

No assigned case needs another fork patch. The three grammar-negative identities are recoverable soundly from AST members and missing nodes the existing ten-patch fork already produces.

The sole live divergence is not a fork-shape blocker: C15 already populated `CaseOrDefaultClause.Statements` and `Value`. The Go `lowerSwitchExpression` path still evaluates only the clause value, so supporting the preceding statements is a separate bridge-lowering task.

## Verification

- `go build ./...` — pass
- `go vet ./compiler ./cmd/smithersc-go` — pass
- `SMITHERS_TYPESCRIPT_FORK=/private/tmp/smithers-ts-fork-cache/c087644e82dc3d48cf87e4c5519eeaaea9daf35c go test ./compiler ./cmd/smithersc-go -count=1` — pass, 56 top-level tests
- `node conformance/runner/run.mjs --backend go --jobs 1 --report-only` — 91/92 match, 0 unsupported, 1 divergent
- forkpatch status — applied, 10 patches, `divergentFromApplied: 0`

Changed files:

- `compiler/forkbridge/lowering.go.txt`
- `compiler/forkbridge/main.go.txt`
- `compiler/fork_internal_lowering_test.go`
- `poc/C16-REPORT.md`

Nothing was committed. The conformance corpus and forkpatch lane were not edited.

SOURCE SETTLED
