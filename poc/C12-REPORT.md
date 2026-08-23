# C12 — the grammar and Go lowering are connected

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## Result

The Go backend moved from **56/91 to 79/91**, a gain of **23 cases**, with
**12 unsupported, 0 divergent, and 0 xfail**. Plain-TypeScript interop remains
**6/6**.

The 23 newly matching cases are exactly:

| corpus area | gained | what now matches |
|---|---:|---|
| `10-defer` | 6 | all defer/errdefer execution and refusal cases |
| `11-expression-if-switch` | 6 | value if in argument/Result positions, its short-circuit refusal, exhaustive and defaulted value switches, and missing-union-member refusal |
| `12-labeled-block-values` | 4 | both executed joins plus incomplete-block and nested-function refusals |
| `13-loop-values` | 3 | `for` and `while` joins and plain-break flow through `else` |
| `14-conditional-declarations` | 4 | scope, unwrap, `var`, and braceless-branch cases |

No previously matching corpus case regressed. The corpus was not edited.

## The bridge now fails closed around forkpatch

`compiler/fork.go` embeds `series.json` and every patch. Before it can use a
checkout it now:

1. Strictly decodes the manifest, requires its revision to equal
   `c087644e82dc3d48cf87e4c5519eeaaea9daf35c`, verifies every recorded patch
   SHA-256, rejects duplicate/missing/unlisted patch files, and validates all
   pre/post/created image entries.
2. Requires checkout `HEAD` to be the pinned revision and `tsc/go.mod` to be
   the expected compiler module.
3. Classifies the checkout solely from the recorded file digests as pristine,
   fully applied, or mixed. Mixed state—including a partially applied old
   series, a hand edit, or any digest drift—is a hard `ErrForkUnavailable`.
4. Requires the pristine worktree to be clean. It then materializes the
   embedded patches, runs ordered `git apply --check` followed by `git apply`
   for each patch, rolls back completed patches if a later patch fails, and
   requires every post-image and the exact expected Git status afterward.
5. Accepts an already-applied checkout only when every post-image and every
   expected modified/created path matches and there is no extra worktree state.

There is no unpatched fallback. This was exercised both ways: a fresh checkout
was advanced to the eight-patch applied state, while the earlier checkout with
only seven patches became mixed when `0600-labeled-expression-values-grammar`
joined the live series and was rejected.

The patch-series identity is SHA-256 over the manifest plus the ordered patch
names and bytes. The bridge cache path contains the full pinned revision, full
series identity, bridge-source digest, GOOS, and GOARCH. A series edit therefore
cannot reuse an older binary. Cold preparation is locked, and the built binary
must answer a revision-and-series identity handshake before it is accepted.

The conformance Go runner now probes this exact forkpatch-backed build before
scheduling cases. A revision, digest, application, build, or handshake failure
makes the backend unavailable up front instead of producing misleading
per-case measurements.

Direct tests cover embedded patch digests/identity, pristine/applied/mixed
classification, wrong-revision rejection without mutation, cache overlap, and
concurrent cold-cache preparation.

## The lowering

All rewrites use fork AST nodes, its node factory, checker, and printer. No
source-text rewrite is used. Result, Optional, and checker decisions continue to
be resolved by symbol/type identity. Labels have no checker symbol in the fork,
so one binder-equivalent lexical walk resolves label spelling once and records
the exact target AST node; every lowering decision after that is target-node
identity based, with nested functions resetting the label environment.

### `defer` and `errdefer`

A marker consumes its lexical statement tail and emits nested `try/finally`.
This makes registration reachability structural and makes later registrations
run first. `defer` runs on all exits. `errdefer` instruments lowered Result
returns, including unwrap propagation, and its finally guard runs only for the
error variant. Missing/newline-separated cleanup AST, non-Result ownership,
ambiguous cleanup channels, and uninspectable async returns fail closed.

Executed proof:

`TestPinnedForkInternalLoweringExecutesDeferAndErrdefer` runs emitted JavaScript
under Node and observes:

`ok:0|ok:1|error|0:always,1:late,1:always,-1:error,-1:late,-1:always`

That single trace proves reach-only registration, success/error exits, LIFO,
and error-only cleanup.

### `break :label value`, labeled blocks, and loop `else`

The live grammar's `LabeledExpression` wraps the real bound
`LabeledStatement`. Lowering asks the fork checker for the expression join type,
creates a typed temporary and compiler exit label, assigns the temporary at
each value break, and targets the compiler wrapper. For a loop, normal
completion and plain labeled breaks reach the `else` assignment; a value break
skips it. Value breaks in nested functions and blocks with a reachable valueless
completion are reported as `SMITHERS1714` rather than approximated.

Executed proof:

`TestPinnedForkInternalLoweringExecutesLabeledBlockAndLoopValueJoins` runs both
block and loop joins under Node and observes:

`[pass]|[fail]|selected@body:0,value|fallback@body:0,else|fallback@body:0,body:1,else`

This proves value delivery, argument-position composition, value-break skipping
of `else`, and both normal and plain-break flow into `else`.

### Conditional declarations

`IfStatement.Initializer` is consumed directly, and the lowering requires the
fork binder's real `Locals` table. A block-scoped initializer becomes an
authored declaration followed by the same `if` with `Initializer` cleared,
inside a synthesized block. It does not re-derive the binding scope. `var` and
unbraced branch chains remain explicit `SMITHERS1717` refusals.

### Value-position `if` and `switch`

`IfExpression` becomes a factory-built conditional expression. A
`SwitchExpression` evaluates its scrutinee once into a generated temporary and
builds a conditional join from clauses whose `Value` is present. For a
no-default switch, lowering consumes the fork checker's result type and closed
literal-union decision; it does not reimplement exhaustiveness.

`TestPinnedForkInternalLoweringExecutesConditionalDeclarationAndValueExpressions`
runs all three forms together and observes:

`Ada:bonus|Ada:plain|missing|3`

The final `3` proves each conditional initializer executed once.

The value-switch conservatism is preserved: the fork creates no
`FlowSwitchClause`, and lowering does not pretend the authored scrutinee is
narrowed inside a clause value. No current corpus case requires that narrowing;
a future case that does requires a fork checker change.

### Source maps

Synthesized imports, temporaries, wrappers, guards, and join labels have no
authored mapping. Rewritten authored statements and expressions retain their
authored ranges. The executed tests also assert mappings for a deferred cleanup,
the moved conditional declaration, and a rewritten value break, and assert that
the generated labeled-value wrapper is unmapped.

## Remaining fork changes

Six of the 12 unsupported cases are blocked before sound lowering receives the
required AST or checker result:

- Braceless value-if grammar: the corpus accepts a bounded initializer form and
  expects `SMITHERS1709` for an unsafe general form, while the fork currently emits
  raw TS1005 parse diagnostics for both.
- Value-switch clauses with prior statements followed by a final value are not
  represented; the current value grammar supplies `Value` with empty
  `Statements` only.
- The ordinary statement-switch fixture receives the fork checker's TS2678 for
  the fallthrough case after a literal scrutinee.
- An unlabeled loop expression has no recoverable fork AST for the required
  `SMITHERS1702`.
- A labeled loop expression without `else` is made syntactically unrepresentable
  by patch `0600`, while the fixed corpus requires `SMITHERS1715` plus `SMITHERS1702` at
  authored positions.

The other six unsupported cases are existing Go prelude/diagnostic gaps, not
these grammar lowerings: `Result.ok/err` authoring diagnostics, nested-Result
normalization, Optional value constructors, `Error.is`/`rootCause`, and partial
error-match fallback.

## Verification

Against
`/private/tmp/smithers-c12-fork-cache-v2/c087644e82dc3d48cf87e4c5519eeaaea9daf35c`:

```text
go build ./...                                                       ok
go vet ./compiler ./cmd/smithersc-go                                    ok
SMITHERS_TYPESCRIPT_FORK=<prepared> go test ./compiler ./cmd/smithersc-go -count=1
    compiler ok; cmd/smithersc-go ok; 53 top-level tests, none skipped/weakened
node conformance/runner/run.mjs --backend go --jobs 1 --report-only
    79/91 match, 12 unsupported, 0 divergent, 0 xfail
node conformance/runner/run.mjs --backend go --only-interop --jobs 1 --report-only
    6/6 interop pass
forkpatch status
    applied; 8 patches; 30 modified + 2 created; 0 post-image divergence
```

SOURCE SETTLED
