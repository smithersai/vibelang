# Diagnostic code map

Diagnostic codes follow Appendix B of the specification: `EK`, the two-digit VIP number, then two digits for the rule. A code change does not change which programs a diagnostic rejects. Update saved diagnostic filters and expected-output assertions to the new code.

| Previous code | Appendix B code | Rule and repair |
| --- | --- | --- |
| `EK4617` | `EK0103` | `await` does not run an Effect in an `async` function. Use `await runPromise(program)`. |

The language server keeps the numeric code (`103`) with source `EK`; the terminal and diagnostic references write `EK0103`.

## Remaining renumberings

| Previous code | Current code | Rule |
| --- | --- | --- |
| `EK4615` | `EK0502` | The same diagnostic rule with Appendix B numbering |
| `EK4605` | `EK1903` | The same diagnostic rule with Appendix B numbering |
| `EK4606` | `EK1904` | The same diagnostic rule with Appendix B numbering |
| `EK2001` | `EK9201` | Legacy rule awaiting retirement by its owning VIP |
| `EK2002` | `EK9202` | Legacy rule awaiting retirement by its owning VIP |
| `EK2003` | `EK9203` | Legacy rule awaiting retirement by its owning VIP |
| `EK2004` | `EK9204` | Legacy rule awaiting retirement by its owning VIP |
| `EK2101` | `EK9205` | Legacy rule awaiting retirement by its owning VIP |
| `EK2102` | `EK9206` | Legacy rule awaiting retirement by its owning VIP |
| `EK2103` | `EK9207` | Legacy rule awaiting retirement by its owning VIP |
| `EK3006` | `EK9208` | Legacy rule awaiting retirement by its owning VIP |
| `EK2126` (parameter count) | `EK2801` | More than four generic `data` parameters |
| `EK2126` (constraint) | `EK2126` | A constrained generic `data` parameter |

The temporary `EK92xx` codes preserve older checks whose numbers Appendix B reassigns to different rules. They are not new language rules. Their owning VIP implementations retire them. Other older codes keep their existing numbers until their VIP implementation removes or replaces the check.

## Appendix B reference

Registration reserves a code; it does not mean the compiler already implements every rule. The chapters describe the intended language; the VIP implementation lanes own remaining behavior gaps.

| Code | Rule |
| --- | --- |
| `EK0101` | `effect f() { }` or `async f() { }` outside a class or object literal |
| `EK0102` | `await`, `for await` or `await using` in effect code |
| `EK0103` | `await` on an Effect in an `async` function |
| `EK0104` | `effect` on a getter, setter or constructor |
| `EK0105` | `effect` and `async` on one function |
| `EK0106` | an `effect` function whose written return type is not an Effect |
| `EK0107` | `eval`, `Function`, `arguments`, `var` or `with` in a `.vibe` file |
| `EK0301` | `!` beside a union, an intersection, a function type or a conditional type without parentheses |
| `EK0401` | a `throw`, a call that may throw, or a parameter default that may throw, in an effectful function |
| `EK0402` | a function that may throw where a function type doesn't admit its thrown type |
| `EK0403` | an unwrapped call, `new` expression or tagged template that may throw, in effect code or a plain `catch` handler |
| `EK0404` | an unwrapped Promise-producing call, `new` expression or `async match` in effect code |
| `EK0405` | a body that throws more than its written `@throws {T}` |
| `EK0501` | `try` outside effect code, the top level included |
| `EK0502` | `try` on a value that is not an Effect |
| `EK0503` | a `try` statement in effect code |
| `EK0504` | `catch` outside effect code |
| `EK0505` | `try x catch h` |
| `EK0506` | `e catch h` where `e` is not an Effect |
| `EK0507` | a handler whose result is a Promise or thenable |
| `EK0508` | lint warning: a plain handler whose result is an Effect; use `catch effect` |
| `EK0801` | warning: `using` in effect code; use `acquireDisposable` inside `scoped` |
| `EK0901` | a `static key` without `readonly`, or whose initializer is not a string literal |
| `EK0902` | a service member that is not a `PropertySignature`, `MethodSignature`, `KeyMember` or `DefaultMember` |
| `EK0903` | a service with no derived key and no `static readonly key` |
| `EK1201` | `provide` outside effect code |
| `EK1301` | a constructor in an `error` or `schema error` body |
| `EK1302` | a user-written `static` member or setter in an `error` or `schema error` body |
| `EK1303` | type parameters on an `error` or `schema error` declaration |
| `EK1304` | any other `RejectedElement` in an `error` or `schema error` body; an `implements` clause |
| `EK1401` | a namespace name that two subpaths export, or a subpath and the root |
| `EK1701` | `fork` or `join` outside effect code |
| `EK1801` | a `try.all` operand that is not an array of Effects |
| `EK1901` | a `for concurrent` operand that is not an `Iterable` |
| `EK1902` | `for concurrent` outside effect code |
| `EK1903` | `break` leaving a `for concurrent` body |
| `EK1904` | `return` in a `for concurrent` body |
| `EK1905` | a labeled `continue` naming a statement that encloses the `for concurrent` |
| `EK2001` | `for try` outside effect code |
| `EK2002` | `return` in a `for try` body |
| `EK2003` | a labeled `break` or `continue` from a `for try` body to a statement outside it |
| `EK2004` | a `for try` operand that is not a `Stream` |
| `EK2102` | a producer whose written return type is not a `Stream` |
| `EK2103` | `yield*` in a producer |
| `EK2109` | a `schema` field type outside the mapping |
| `EK2111` | `restore` outside an `uninterruptible` block |
| `EK2117` | an `extends` clause or a `_tag` member in an `error` or `schema error` body |
| `EK2126` | a constraint on a generic `data` type parameter |
| `EK2201` | an interruption block outside effect code |
| `EK2202` | `restore` in an `effect` arrow or block nested in an `uninterruptible` block |
| `EK2801` | a `data` declaration with more than 4 type parameters |
| `EK2803` | a default on a generic `data` type parameter |
| `EK3001` | two services with the same key |
| `EK3002` | a class extends a service |
| `EK3003` | `new` on a service |
| `EK3004` | `instanceof` a service |
| `EK3005` | a generic service |
| `EK3006` | an error code or an unknown code in `vibe.severities`; remove the entry |
| `EK4402` | a value import of a Node builtin, with or without `node:` (`node:fs`, `fs`), or a reference to a banned platform global, in a `.vibe` file |
| `EK4609` | lint warning: `await` on a `Fiber` in an `async` function; use `join` |
| `EK4610` | lint warning: `await` on a `Deferred` in an `async` function; use `try Deferred.await(d)` |
| `EK4701` | a `match` with no `default` over a finite union that misses a case; a guarded arm covers nothing |
