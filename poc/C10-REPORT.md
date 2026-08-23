# C10 — cross-function row analysis in the Go backend

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

Date: 2026-08-22

## Result

The Go backend now matches the reference on **56/91** conformance cases, up from **33/91** at the start of this lane.

- JavaScript reference: **91/91**
- Go fork: **56/91**
- Unsupported: **35**
- Divergent: **0**
- Backend agreement: **56/91**

The required verification gates pass:

- `go build ./...`
- `go vet ./compiler ./cmd/smithersc-go`
- pinned-fork `go test ./compiler ./cmd/smithersc-go -count=1`
- 47 Go tests pass (44 existing tests plus 3 cross-function/identity tests added here)

## What moved the score

The Go bridge now agrees with the reference for all cases in these cross-function row areas:

- context rows: 3/3
- layers: 4/4
- generic rows: 4/4
- foreign calls: 7/7

The same analysis also completed the remaining reachable cases for inferred cross-function Result contracts, `Result.expect`/`Panic`, Result parameters, promise chaining, and `Error.recover`.

Diagnostics now produced directly by Go row analysis include:

- failure contracts: `SMITHERS1101`, `SMITHERS1102`, `SMITHERS1103`, `SMITHERS1104`
- must-consume boundaries and parameters: `SMITHERS1301`, `SMITHERS1302`
- foreign access/trust: `SMITHERS1506`, `SMITHERS1510`
- generic and higher-order rows: `SMITHERS1802`, `SMITHERS1803`, `SMITHERS1806`
- requirements and layers: `SMITHERS2101`, `SMITHERS2102`, `SMITHERS2103`, `SMITHERS2104`, `SMITHERS2105`

Diagnostics use authored AST nodes and trivia-skipped starts, so the codes and positions match the corpus. Synthesized lowering remains unmapped; rewritten authored statements/imports retain their authored span.

## Call graph and symbol identity

The analyzer collects function-like declarations from every authored `.sm` source file in the program. A call edge is resolved first from the checker's resolved signature declaration. If that is unavailable, it falls back to the checker symbol on the callee expression/property access. Symbols are unaliased and canonicalized through merged symbols before lookup.

This makes direct calls, relative imports, aliased imports, namespace property access, and recursive module cycles converge on the same function node without consulting source spelling. Error and Context rows are likewise sets keyed by `*ast.Symbol`; duplicate names from different modules remain distinct and are qualified only when rendered. `TypeFlags` is read for type classification but is never mutated.

Focused Go coverage proves:

- failure propagation through a namespace call and a relative import alias;
- requirement propagation through an aliased import, namespace access, and a two-module cycle;
- executable `Context`/`Layer` provision; and
- user-declared types named `Context` or values named `Layer` are untouched.

## Fixed point

Each function starts with direct recoverable failures, direct Context requirements, static call edges, and provider edges. Inference repeatedly performs monotonic set union until no published failure row, body failure row, or requirement row changes:

- requirements propagate across every resolved static call;
- failures propagate only through call sites whose enclosing construct publishes the failure channel;
- `Layer.provide` subtracts capabilities proved to be supplied by the resolved layer expression;
- an explicit `Result<A, E>` publishes its declared `E` row, while an unannotated local function publishes its inferred body row;
- generic calls take the instantiated error row from the resolved call signature and check callback nominal coverage.

Only symbols already present in the finite program can enter a row, and sets only grow, so recursive and mutually recursive components terminate naturally. There is no name-based recursion shortcut or iteration cap.

When the bridge cannot prove a row, it rejects conservatively: unresolved generic rows use `SMITHERS1803`, cross-module higher-order escapes use `SMITHERS1802`, unresolved provider callbacks/layers use `SMITHERS2103`/`SMITHERS2104`, and unannotated foreign calls charge `Panic`.

## Compiler-owned modules and foreign boundaries

Internal compiler options now resolve the exact specifiers `smithers:context`, `smithers:provider`, `smithers:exceptions`, `smithers:comptime`, and `smithers:flows` to the injected declaration module. Import rewriting is gated by the checker-resolved module symbol, not the specifier text. Context, provider, and exception identities have working declarations and runtime lowering.

`smithers:comptime` and `smithers:flows` now reach the compiler-owned module deterministically, but their API declarations and intrinsic lowering are not implemented in this lane. A requested API therefore fails closed with an ordinary missing-export diagnostic instead of being approximated at runtime.

Foreign calls are classified from their resolved declaration and immediate JSDoc contract. `@throws never` stays plain, declared nominal errors are added to the row, and an unannotated foreign call is wrapped through the injected boundary helper and charges `Panic`. Foreign module trust and property access are checked at the authored site.

The existing language default for `allowImportingTsExtensions` is preserved.

## Work that still needs the fork lane

The cross-function row work itself required no TypeScript fork change. The following 29 corpus cases remain blocked by syntax/checker support in the pinned fork:

- `defer` and `errdefer` statements;
- expression `if` and expression `switch`;
- labeled block values;
- loop values and loop `else` completion;
- conditional declarations.

One case in that group, `statement-switch-keeps-typescript-fallthrough`, already parses but the pinned checker narrows the discriminant to the first literal and emits `TS2678` for the next fallthrough case. That needs checker behavior in the fork (or an equally exact checker hook), not row inference.

The remaining 6 unsupported semantic-library cases do not need grammar work: the `Result.ok` authoring diagnostic (`SMITHERS1201`), nested Result normalization (`SMITHERS1203`), `Optional.fromNullable`, `Error.is`/root-cause support, and partial error matching. Together with the 29 fork-dependent cases, these account for all 35 unsupported observations. `smithers:comptime` and `smithers:flows` also still need their dedicated compiler API/intrinsic lowering beyond module resolution.

## Files

- `compiler/forkbridge/lowering.go.txt`
- `compiler/fork_internal_lowering_test.go`
- `poc/C10-REPORT.md`

SOURCE SETTLED
