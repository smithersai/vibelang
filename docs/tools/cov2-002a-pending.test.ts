// Chapter 002 coverage obligations: scoped to cov2-002a assignment.
import { test } from "bun:test"

// rule-evidence: docs/design/src/002-running.md#7b781d0f772bd757
// Chapter 002: "Effect code" means the body of an `effect` function, a producer or an `effect` block, not counting nested functions, class field or enum member initializers or `static` blocks, as `await` is not allowed there in an `async` function.
test.todo("docs/design/src/002-running.md#7b781d0f772bd757 | \"Effect code\" means the body of an `effect` function, a producer or an `effect` block, not counting nested functions, class field or enum member initializers or `static` blocks, as `await` is not allowed there in an `async` function. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#f7a27d841961505d
// Chapter 002: It is the code Appendix A parses with [the grammar's Effect parameter](900-appendices.md#the-effect-parameter), minus parameter lists and `static` blocks, which inherit its reservation without permission to run an Effect; class field and enum member initializers parse without it.
test.todo("docs/design/src/002-running.md#f7a27d841961505d | It is the code Appendix A parses with [the grammar's Effect parameter](900-appendices.md#the-effect-parameter), minus parameter lists and `static` blocks, which inherit its reservation without permission to run an Effect; class field and enum member initializers parse without it. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#fba338a130f3f595
// Chapter 002: Parentheses, `do` and `match` are not boundaries; an `async match` is one, as a nested `async` function is ([Pattern matching](004-match.md)), so `try` inside it is an error.
test.todo("docs/design/src/002-running.md#fba338a130f3f595 | Parentheses, `do` and `match` are not boundaries; an `async match` is one, as a nested `async` function is ([Pattern matching](004-match.md)), so `try` inside it is an error. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#2ec71a012d9f4125
// Chapter 002: <a id="operand-test"></a>**Operand test.** `e` is an Effect when its type is assignable to `Effect.Effect<any, any, any>`.
test.todo("docs/design/src/002-running.md#2ec71a012d9f4125 | <a id=\"operand-test\"></a>**Operand test.** `e` is an Effect when its type is assignable to `Effect.Effect<any, any, any>`. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#ceb7e03dd9c3939a
// Chapter 002: For example, in Effect 4.1.1 an `Exit`, a `Config`, a `Context.Service` key, a `Context.Reference` and an `error` instance (`Data.TaggedError` or `Schema.TaggedError`) pass this structural test; the list is not exhaustive.
test.todo("docs/design/src/002-running.md#ceb7e03dd9c3939a | For example, in Effect 4.1.1 an `Exit`, a `Config`, a `Context.Service` key, a `Context.Reference` and an `error` instance (`Data.TaggedError` or `Schema.TaggedError`) pass this structural test; the list is not exhaustive. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#7a9fe49d4a7aa85c
// Chapter 002: The quick fix wraps a value in a function literal, so the handler's kind stays visible in the source, and removes `async` or `*` from a function:
test.todo("docs/design/src/002-running.md#7a9fe49d4a7aa85c | The quick fix wraps a value in a function literal, so the handler's kind stays visible in the source, and removes `async` or `*` from a function: | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#54c248cda254f68c
// Chapter 002: | `x catch guest` | syntax error | quick fix: `x catch () => guest` |
test.todo("docs/design/src/002-running.md#54c248cda254f68c | | `x catch guest` | syntax error | quick fix: `x catch () => guest` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#f8f8e785aa81faf6
// Chapter 002: | `x catch onErr` (`onErr` a function) | syntax error | quick fix: `x catch (e) => onErr(e)` |
test.todo("docs/design/src/002-running.md#f8f8e785aa81faf6 | | `x catch onErr` (`onErr` a function) | syntax error | quick fix: `x catch (e) => onErr(e)` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#a1ca3b9c9b2726c8
// Chapter 002: | `x catch effect { return 7 }` | syntax error | quick fix: `x catch effect () => { return 7 }` |
test.todo("docs/design/src/002-running.md#a1ca3b9c9b2726c8 | | `x catch effect { return 7 }` | syntax error | quick fix: `x catch effect () => { return 7 }` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#c1d8b353c64d764c
// Chapter 002: | `x catch async (e) => 7` | syntax error | quick fix: `x catch (e) => 7` |
test.todo("docs/design/src/002-running.md#c1d8b353c64d764c | | `x catch async (e) => 7` | syntax error | quick fix: `x catch (e) => 7` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#316c56c1d13c143e
// Chapter 002: | `x catch function* (e) { }` | syntax error | quick fix: `x catch function (e) { }` |
test.todo("docs/design/src/002-running.md#316c56c1d13c143e | | `x catch function* (e) { }` | syntax error | quick fix: `x catch function (e) { }` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#5b85617b2d4cd49d
// Chapter 002: | a plain handler whose result type is a Promise or thenable (`x catch (e) => queryDb(e)`): the returned Promise or thenable is not awaited or assimilated; any already-started Promise work continues, as for an unwrapped Promise in effect code ([Failures](003-failures.md)) | `EK0507` |
test.todo("docs/design/src/002-running.md#5b85617b2d4cd49d | | a plain handler whose result type is a Promise or thenable (`x catch (e) => queryDb(e)`): the returned Promise or thenable is not awaited or assimilated; any already-started Promise work continues, as for an unwrapped Promise in effect code ([Failures](003-failures.md)) | `EK0507` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#ef8819ae6013c5c5
// Chapter 002: | a `throw` in a plain handler, or a call known to throw in its parameters or body; the old lint warning `EK0511` retires | `EK0401` |
test.todo("docs/design/src/002-running.md#ef8819ae6013c5c5 | | a `throw` in a plain handler, or a call known to throw in its parameters or body; the old lint warning `EK0511` retires | `EK0401` | | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#432a9980fbe85782
// Chapter 002: For a malformed handler consisting of a parameter list followed directly by a block, as in `try x catch (e) { B }`, recovery reports `EK0509` and does not additionally report `EK0505` for that same expression.
test.todo("docs/design/src/002-running.md#432a9980fbe85782 | For a malformed handler consisting of a parameter list followed directly by a block, as in `try x catch (e) { B }`, recovery reports `EK0509` and does not additionally report `EK0505` for that same expression. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#d99ce9493fa3be9f
// Chapter 002: <a id="result-tests"></a>**Result tests.** `EK0103` and `EK0508` ask: may this value be an unrun Effect?
test.todo("docs/design/src/002-running.md#d99ce9493fa3be9f | <a id=\"result-tests\"></a>**Result tests.** `EK0103` and `EK0508` ask: may this value be an unrun Effect? | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#f05335a2b3b355db
// Chapter 002: A type answers yes when it is not `never`, `any` or `unknown` and at least one union member is an Effect.
test.todo("docs/design/src/002-running.md#f05335a2b3b355db | A type answers yes when it is not `never`, `any` or `unknown` and at least one union member is an Effect. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#97522f964b3b0956
// Chapter 002: `EK0404` and `EK0507` ask whether a Promise or thenable may be left unhandled, using the same type predicate with `PromiseLike` in place of Effect, as typescript-eslint's `no-floating-promises` does.
test.todo("docs/design/src/002-running.md#97522f964b3b0956 | `EK0404` and `EK0507` ask whether a Promise or thenable may be left unhandled, using the same type predicate with `PromiseLike` in place of Effect, as typescript-eslint's `no-floating-promises` does. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#c4767b7cf09d9b34
// Chapter 002: The [operand test](#operand-test) of `try` (`EK0502`), `catch` (`EK0506`) and `fork` (`EK1703`) uses assignability to `Effect.Effect<any, any, any>`.
test.todo("docs/design/src/002-running.md#c4767b7cf09d9b34 | The [operand test](#operand-test) of `try` (`EK0502`), `catch` (`EK0506`) and `fork` (`EK1703`) uses assignability to `Effect.Effect<any, any, any>`. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#d50fa0383c15085e
// Chapter 002: The four concurrent array operations require assignability to `ReadonlyArray<Effect.Effect<any, any, any>>` (`EK1801`); `for concurrent` requires `Iterable<unknown>` (`EK1901`), and `for try` requires `Stream.Stream<any, any, any>` (`EK2004`).
test.todo("docs/design/src/002-running.md#d50fa0383c15085e | The four concurrent array operations require assignability to `ReadonlyArray<Effect.Effect<any, any, any>>` (`EK1801`); `for concurrent` requires `Iterable<unknown>` (`EK1901`), and `for try` requires `Stream.Stream<any, any, any>` (`EK2004`). | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#3a8f869f282ecd11
// Chapter 002: These are ordinary TypeScript assignability tests, with the project's compiler options; `any` and `never` pass.
test.todo("docs/design/src/002-running.md#3a8f869f282ecd11 | These are ordinary TypeScript assignability tests, with the project's compiler options; `any` and `never` pass. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")

// rule-evidence: docs/design/src/002-running.md#5e57cb6b0fababf1
// Chapter 002: `h` runs only when the `Cause` holds no defect: a `Cause` with both a failure and a defect, such as one a `.ts` function builds with `Effect.failCause`, passes through with its failures re-raised as defects, as `Effect.catch` does in Effect 4.1.1.
test.todo("docs/design/src/002-running.md#5e57cb6b0fababf1 | `h` runs only when the `Cause` holds no defect: a `Cause` with both a failure and a defect, such as one a `.ts` function builds with `Effect.failCause`, passes through with its failures re-raised as defects, as `Effect.catch` does in Effect 4.1.1. | Retain exact boundary/type/quick-fix contract; needs focused compiler or editor witness.")
