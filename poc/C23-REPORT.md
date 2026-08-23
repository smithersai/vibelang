# C23 — reference conformance repairs

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## Outcome

All four reported reference defects are settled in the owned implementation.
The two JS xfails owned by this task are real passing expectations now, the
Optional-call `.?` reproducer is a corpus case instead of a compiler crash, and
compiler-module trust is exact rather than prefix-based.

The corpus and runner moved concurrently while this work ran. The requested
snapshot was 169 cases at 159 pass / 10 xfail. The isolated delta from this work
on that population is **+2 passes / -2 JS xfails** (161 pass / 8 xfail before
the live comptime lane's later integration). That lane subsequently resolved
seven more comptime xfails and added seven protected/concurrent cases (two
durable and five provisional native-pin xfails). The literal final run is
therefore **168/176 pass, 8 xfail, 0 fail, 0 unsupported, 0 divergent,
0 unmeasured**. Removing only the seven newly added cases gives 168/169 with one
remaining comptime xfail; only two of those advances belong to C23.

## 1. Violated foreign `@throws {T}` stays checked

### Root cause

`poc/src/language/compile.ts` correctly lowered a declared foreign boundary to
`Result.try(body, cause => __vsValidateForeignError(cause, Constructor))`.
However, `poc/src/runtime/errors.ts::__vsValidateForeignError` called
`panic(...)` for a value outside the declared class. `panic(...)` throws.
`poc/src/runtime/result.ts::mappedFailure` invokes the mapper after entering
`Result.try`'s catch clause; it does not wrap a second catch around the mapper.
The validator's thrown Panic therefore escaped the Result instead of becoming
the declared `Panic` error member.

### Fix

`__vsValidateForeignError` now returns `E | Panic`. It preserves an existing
Panic, returns an honest declared `E`, and uses `makePanic(...)` for a violated
claim. For an Error cause, the returned Panic retains that exact Error in
`Panic.cause`; a non-Error is retained below `UnhandledException` and remains
available through `rootCause()`.

The runtime test now asserts that a contract-violating `RangeError` produces an
error Result whose value is nominally Panic and whose `cause` and `rootCause()`
are the original object.

### Executed evidence

`09-foreign-calls/declared-foreign-throws-violated-stays-panic` completed all
three JS stages (`lower`, `emit-check`, `execute`), exited 0, and observed:

```text
41
panic:the host violated its own contract
```

The second line is emitted only when the error branch receives a nominal
`Panic` whose `cause` is the original foreign `TypeError` and prints that
cause's message. Its JS xfail was removed.

## 2. Promise `.catch()` is not retired grammar

### Root cause and fix

`checkRemovedAndUnsupportedSyntax` in `poc/src/language/semantic.ts` treated any
`catch` not preceded by `}` as the retired postfix Result-recovery form. Unlike
the neighboring `try` rule, it did not exclude a preceding `.`. The scanner now
requires `previous.text !== "."`, leaving member calls to the Promise-discipline
pass.

The case now observes only the same Promise diagnostics as its `.then()` and
`.finally()` siblings:

```text
SMITHERS1401 @ 6:22 — Promise instance chaining is unavailable
SMITHERS1402 @ 6:22 — the started Promise is not consumed by an allowed form
```

There is no `SMITHERS1001` retired-syntax claim. The JS scope was removed from
the xfail and the required JS backend passes. The Go-only xfail remains because
this task was forbidden to edit its live compiler implementation.
(`SMITHERS1402` was retained because the already-passing sibling corpus cases
explicitly make it part of the contract.)

## 3. Optional-call `.?` no longer crashes source-map generation

### Root cause

TypeScript error-recovers `lookup(1).?` as an overlapping, incomplete ternary
tree. The reference still lowers the surrounding Optional-returning function
for diagnostic display, so the TypeScript AST printer prints a malformed
`lookup(1). ? : ;` shape. Its raw provenance contains a negative generated-
column delta. `createPreciseSourceMap` passes that raw map to `decodeMappings`,
which correctly rejects the backtrack instead of inventing attribution. That
exception previously escaped `compileProject`.

### Fix

`compileSemanticModel` now applies the standing correct-or-absent rule at the
known rejected spelling: when analysis already contains the source-located
`SMITHERS1001` for the retired `.?` operator, it does not ask the malformed
printer tree to claim source-map provenance. It still returns the authored,
stable diagnostic. The source-map validator was not relaxed, and supported
recovered syntax plus unrelated semantic errors continue to receive maps.

The source-map unit test asserts that the Optional-call form returns
`SMITHERS1001` at 3:25 and has no source map. The corpus case was strengthened
from a plain string receiver to the original `Optional<string>` call reproducer
and passes with exactly `SMITHERS1001` at authored 6:25. There is no crash or
unmeasured verdict.

## 4. Capability specifier decision and exact trust

The correct capability/provider spellings in the current tree are
**`smthrs/context` and `smthrs/provider`**. No spelling migration was needed:

- `docs/DECISIONS.md` locks those exact two spellings.
- `docs/src/pages/specification/requirements.mdx` uses the same spellings.
- the root package is named `smthrs` and exports `./context` and `./provider`,
  which yields those public specifiers;
- the language prelude, semantic identity checks, lowering rewrite, target
  prelude, and every capability/layer corpus case agree;
- `smithers:exceptions`, `smithers:comptime`, and `smithers:flows` deliberately
  use the separate colon-form compiler-module namespace.

The broad trust predicate was nevertheless a real fail-open regression: it
accepted bare `smthrs`, every `smthrs/*`, and every `smithers:*` string. It now
uses an explicit exact allowlist. Tests prove that near misses such as
`smthrs/contextual`, `smthrs/provider/extra`,
`smithers:exceptions/extra`, and `smithers:unknown` remain foreign and receive
`SMITHERS1510`. Exact matching survives.

No normative docs edit is needed. The conflict paragraph in
`conformance/COVERAGE.md` and the external C22 scratchpad report is stale: both
claim the ledger/specification say `smithers/context`, while the current files
say `smthrs/context`. Another lane should correct that census prose, remove the
two repaired xfail entries, and mark the Optional-call crash obligation covered.
I did not edit it because ownership was limited to `conformance/corpus/**`.

## Corpus changes

Xfails flipped to passing expectations:

1. `08-promise-chaining/promise-catch-is-rejected` (JS scope removed; Go scope
   intentionally retained)
2. `09-foreign-calls/declared-foreign-throws-violated-stays-panic` (JS)

Strengthened crash reproducer:

- `19-retired-syntax/dot-question-operator-is-retired` now applies `.?` to an
  Optional-typed call and receives the stable authored diagnostic.

No case was removed or weakened, and nothing under `16-comptime` or
`17-durable` was touched.

## Verification

Serial gates on the final live tree:

```text
cd poc && bun run check
  exit 0, zero TypeScript errors

cd poc && bun test src/language/ src/runtime/
  186 pass, 0 fail, 1373 assertions, 16 files

node conformance/runner/run.mjs --backend js --jobs 1
  168/176 pass, 8 xfail
  0 xpass, 0 fail, 0 unsupported, 0 divergent, 0 unmeasured

cd poc && bun test
  1042 pass, 1 skip, 5 todo, 2 fail, 13390 assertions, 92 files
```

The full-suite failures are unrelated rename fallout outside this task's file
ownership, and were left untouched:

- `poc/examples/agent/durable-turn.test.ts:215` expects
  `action/smithers/agent-demo/Echo@3`, while the implementation returns
  `action/smthrs/agent-demo/Echo@3`.
- `poc/examples/agent/flow-turn.test.ts:73` expects
  `flow/smithers/agent-flow/Publishing@1`, while the implementation returns
  `flow/smthrs/agent-flow/Publishing@1`.

The focused changed-file run was **74 pass / 0 fail**, and each of the three
pinned conformance filters passed 1/1. Nothing was committed.

SOURCE SETTLED.
