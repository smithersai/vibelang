// Chapter 002 coverage obligations: scoped to cov2-002a assignment.
import { test } from "bun:test"

// rule-evidence: docs/design/src/002-running.md#7b781d0f772bd757
// Chapter 002: Effect code boundaries
test.todo("docs/design/src/002-running.md#7b781d0f772bd757 | \"Effect code\" means the body of an `effect` function, a producer or an `effect` block, not counting nested functions, class field or enum member initializers or `static` blocks, as `await` is not allowed there in an `async` function. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#f7a27d841961505d
// Chapter 002: Effect parameter reservation
test.todo("docs/design/src/002-running.md#f7a27d841961505d | It is the code Appendix A parses with [the grammar's Effect parameter](900-appendices.md#the-effect-parameter), minus parameter lists and `static` blocks, which inherit its reservation without permission to run an Effect; class field and enum member initializers parse without it. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#fba338a130f3f595
// Chapter 002: Async match effect boundary
test.todo("docs/design/src/002-running.md#fba338a130f3f595 | Parentheses, `do` and `match` are not boundaries; an `async match` is one, as a nested `async` function is ([Pattern matching](004-match.md)), so `try` inside it is an error. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#2ec71a012d9f4125
// Chapter 002: Structural Effect operand test
test.todo("docs/design/src/002-running.md#2ec71a012d9f4125 | <a id=\"operand-test\"></a>**Operand test.** `e` is an Effect when its type is assignable to `Effect.Effect<any, any, any>`. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#ceb7e03dd9c3939a
// Chapter 002: Yieldable structural Effect types
test.todo("docs/design/src/002-running.md#ceb7e03dd9c3939a | For example, in Effect 4.1.1 an `Exit`, a `Config`, a `Context.Service` key, a `Context.Reference` and an `error` instance (`Data.TaggedError` or `Schema.TaggedError`) pass this structural test; the list is not exhaustive. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#7a9fe49d4a7aa85c
// Chapter 002: Handler kind quick fixes
test.todo("docs/design/src/002-running.md#7a9fe49d4a7aa85c | The quick fix wraps a value in a function literal, so the handler's kind stays visible in the source, and removes `async` or `*` from a function: | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#54c248cda254f68c
// Chapter 002: Value handler quick fix
test.todo("docs/design/src/002-running.md#54c248cda254f68c | | `x catch guest` | syntax error | quick fix: `x catch () => guest` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#f8f8e785aa81faf6
// Chapter 002: Named function handler quick fix
test.todo("docs/design/src/002-running.md#f8f8e785aa81faf6 | | `x catch onErr` (`onErr` a function) | syntax error | quick fix: `x catch (e) => onErr(e)` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#a1ca3b9c9b2726c8
// Chapter 002: Effect block handler quick fix
test.todo("docs/design/src/002-running.md#a1ca3b9c9b2726c8 | | `x catch effect { return 7 }` | syntax error | quick fix: `x catch effect () => { return 7 }` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#c1d8b353c64d764c
// Chapter 002: Async handler quick fix
test.todo("docs/design/src/002-running.md#c1d8b353c64d764c | | `x catch async (e) => 7` | syntax error | quick fix: `x catch (e) => 7` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#316c56c1d13c143e
// Chapter 002: Generator handler quick fix
test.todo("docs/design/src/002-running.md#316c56c1d13c143e | | `x catch function* (e) { }` | syntax error | quick fix: `x catch function (e) { }` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#5b85617b2d4cd49d
// Chapter 002: Promise handler results
test.todo("docs/design/src/002-running.md#5b85617b2d4cd49d | | a plain handler whose result type is a Promise or thenable (`x catch (e) => queryDb(e)`): the returned Promise or thenable is not awaited or assimilated; any already-started Promise work continues, as for an unwrapped Promise in effect code ([Failures](003-failures.md)) | `EK0507` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#ef8819ae6013c5c5
// Chapter 002: Throwing plain handler rejection
test.todo("docs/design/src/002-running.md#ef8819ae6013c5c5 | | a `throw` in a plain handler, or a call known to throw in its parameters or body; the old lint warning `EK0511` retires | `EK0401` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#432a9980fbe85782
// Chapter 002: Malformed handler diagnostic recovery
test.todo("docs/design/src/002-running.md#432a9980fbe85782 | For a malformed handler consisting of a parameter list followed directly by a block, as in `try x catch (e) { B }`, recovery reports `EK0509` and does not additionally report `EK0505` for that same expression. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#d99ce9493fa3be9f
// Chapter 002: Unrun Effect result predicate
test.todo("docs/design/src/002-running.md#d99ce9493fa3be9f | <a id=\"result-tests\"></a>**Result tests.** `EK0103` and `EK0508` ask: may this value be an unrun Effect? | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#f05335a2b3b355db
// Chapter 002: Effect union result predicate
test.todo("docs/design/src/002-running.md#f05335a2b3b355db | A type answers yes when it is not `never`, `any` or `unknown` and at least one union member is an Effect. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#97522f964b3b0956
// Chapter 002: PromiseLike union result predicate
test.todo("docs/design/src/002-running.md#97522f964b3b0956 | `EK0404` and `EK0507` ask whether a Promise or thenable may be left unhandled, using the same type predicate with `PromiseLike` in place of Effect, as typescript-eslint's `no-floating-promises` does. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#c4767b7cf09d9b34
// Chapter 002: Effect operand assignability
test.todo("docs/design/src/002-running.md#c4767b7cf09d9b34 | The [operand test](#operand-test) of `try` (`EK0502`), `catch` (`EK0506`) and `fork` (`EK1703`) uses assignability to `Effect.Effect<any, any, any>`. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#d50fa0383c15085e
// Chapter 002: Concurrent and Stream operand assignability
test.todo("docs/design/src/002-running.md#d50fa0383c15085e | The four concurrent array operations require assignability to `ReadonlyArray<Effect.Effect<any, any, any>>` (`EK1801`); `for concurrent` requires `Iterable<unknown>` (`EK1901`), and `for try` requires `Stream.Stream<any, any, any>` (`EK2004`). | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#3a8f869f282ecd11
// Chapter 002: Any and never operands
test.todo("docs/design/src/002-running.md#3a8f869f282ecd11 | These are ordinary TypeScript assignability tests, with the project's compiler options; `any` and `never` pass. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#5e57cb6b0fababf1
// Chapter 002: Mixed failure and defect Cause
test.todo("docs/design/src/002-running.md#5e57cb6b0fababf1 | `h` runs only when the `Cause` holds no defect: a `Cause` with both a failure and a defect, such as one a `.ts` function builds with `Effect.failCause`, passes through with its failures re-raised as defects, as `Effect.catch` does in Effect 4.1.1. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#f652189d3d491384
// Chapter 002: Effect handler parameter restrictions
test.todo("docs/design/src/002-running.md#f652189d3d491384 | Use an effect handler with nonthrowing parameters and move the throwing work into its body behind an explicit bridge; a `try` in its parameter list is still forbidden, as `await` is. | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")

// rule-evidence: docs/design/src/002-running.md#5d84032e4667867c
// Chapter 002: Effect handler result lint fix
test.todo("docs/design/src/002-running.md#5d84032e4667867c | A plain handler whose result type is an Effect gets a VIP-38 lint warning (`EK0508`), with the quick fix `catch effect (e) => try \u2026`: | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")

// rule-evidence: docs/design/src/002-running.md#02a2746670a0d616
// Chapter 002: Plain throw handler quick fix
test.todo("docs/design/src/002-running.md#02a2746670a0d616 | A `throw` in a plain handler is `EK0401`, with the quick fix `catch effect (e) => { \u2026 }`, which makes the throw a typed failure. | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")

// rule-evidence: docs/design/src/002-running.md#63e602c452ff2de5
// Chapter 002: Fiber and Deferred await lint
test.todo("docs/design/src/002-running.md#63e602c452ff2de5 | `await fiber` and `await deferred` keep TypeScript's native `await` behavior and get VIP-38 lint warnings (`EK4609` and `EK4610`). | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")

// rule-evidence: docs/design/src/002-running.md#25269942815e3af3
// Chapter 002: Async context bridge quick fixes
test.todo("docs/design/src/002-running.md#25269942815e3af3 | In the existing `async` context, suggest `await runPromise(Fiber.join(fiber))` or `await runPromise(Deferred.await(deferred))`, using the explicit Promise bridge from VIP-1 and VIP-5. | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")

// rule-evidence: docs/design/src/002-running.md#6db6a21be1c2dd0a
// Chapter 002: Try and await placement contract
test.todo("docs/design/src/002-running.md#6db6a21be1c2dd0a | <a id=\"try-follows-await\"></a>`try e` is allowed, forbidden and ordered exactly where `await e` is, and every rule that differs is listed here with its reason. | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")

// rule-evidence: docs/design/src/002-running.md#fa3c5ddaf6945732
// Chapter 002: Try placement through expression forms
test.todo("docs/design/src/002-running.md#fa3c5ddaf6945732 | | the body of the corresponding function (`async` for `await`, `effect` for `try`), and a `do`, `match` arm/guard or parentheses inside that context | allowed | allowed | | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")

// rule-evidence: docs/design/src/002-running.md#23281aef8024772b
// Chapter 002: Producer buffering and backpressure
test.todo("docs/design/src/002-running.md#23281aef8024772b | | An `async function*` advances only when its consumer pulls | A sequential producer may run up to two elements ahead; unbounded concurrent yields have no constant global lead bound | VIP-21 uses `Stream.callback` with one buffered element and pending offers, rather than a continuation runtime | | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")

// rule-evidence: docs/design/src/002-running.md#16fdadac4f62e39c
// Chapter 002: Effect block lexical bindings
test.todo("docs/design/src/002-running.md#16fdadac4f62e39c | Its `this`, `super` and `new.target` are the enclosing function's, passed in as for an `effect` arrow ([Functions](001-functions.md#meaning)). | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")

// rule-evidence: docs/design/src/002-running.md#dcd7466fc14ecae5
// Chapter 002: Floating effect block lint
test.todo("docs/design/src/002-running.md#dcd7466fc14ecae5 | An `effect { \u2026 }` statement builds an Effect and discards it, as a call statement `f()` does; the Effect language service's imported `floatingEffect` rule, run by VIP-38, reports it under its `EK38xx` code ([Effect's type-aware lint](007-tooling.md#effects-type-aware-lint)). | Full editor, boundary, timing, or lexical contract needs a dedicated witness.")
