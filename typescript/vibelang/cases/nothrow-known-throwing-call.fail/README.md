# A call known to throw in synchronous VibeLang code

Will, 2026-10-31: synchronous VibeLang code never throws. A call whose callee
is known to throw, `JSON.parse` (shipped `SyntaxError`) or a `.ts` function
tagged `@vibelang trusted @throws {SyntaxError}`, is `EK0401` in plain code:
a function, arrow, constructor or the module's top level. The DESIGN.md
correction of 2026-10-31 allows it in the `try` block of a `try` statement with
a `catch` clause in the same function, since the `catch` catches everything;
in the `catch` or `finally` block, in a `try` with only `finally`, or in a
function nested in the `try` block, it is still the error. A `.ts` function tagged `@throws {unknown}` has a contract too, an
affirmative "may throw anything" (decided detail 255): calling it in plain code
is `EK0401`, unlike a `.ts` function with no tag.

The controls report nothing: a caught call, a `.ts` call with no contract (its
throwing is unknown), a call inside `Effect.try`'s thunk (not in a callback nested in it, which is
its own plain code), and an `async`
function, whose throw rejects its Promise (decided detail 251).
