# Diagnostic code map

Diagnostic codes follow Appendix B of the specification: `EK`, the two-digit VIP number, then two digits for the rule. A code change does not change which programs a diagnostic rejects. Update saved diagnostic filters and expected-output assertions to the new code.

| Previous code | Appendix B code | Rule and repair |
| --- | --- | --- |
| `EK4407` | `EK4006` | An identifier module specifier names no declaration, or has import attributes. Declare the module, fix the name, or quote a file or package name. |
| `EK4408` (placement, export, expression, body) | `EK4001`, `EK4002`, `EK4003`, `EK4008` | Keep declarations named, at the top level and unexported; use ES imports and exports in their TypeScript bodies (VIP-40). |
| `TS2708` (module name as a value) | `EK4004` | Import the module's exports with a static identifier import. |
| `EK4617` | `EK0103` | `await` does not run an Effect in an `async` function. Use `await runPromise(program)`. |

The language server keeps the numeric code (`103`) with source `EK`; the terminal and diagnostic references write `EK0103`.

## Remaining renumberings

| Previous code | Current code | Rule |
| --- | --- | --- |
| `EK0201` | a `do` expression that ends in a declaration, a loop or an `if` without an `else` |
| `EK0202` | a `break` or `continue` whose target is outside its `effect` block |
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

The temporary `EK92xx` codes preserve older checks whose numbers Appendix B reassigns to different rules. They are not new language rules. Interim `EK92xx` codes cannot be configured in `vibe.severities`: an entry is `EK3006`. An infallible `catch` expression stays valid when its interim `EK9204` report retires; the separate imported lint is `EK3818`. Their owning VIP implementations retire them. Other older codes keep their existing numbers until their VIP implementation removes or replaces the check.

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
| `EK0108` | a recognized `effect` modifier on an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member |
| `EK0109` | a typed or generic bare `effect` arrow head; parenthesize its parameters |
| `EK0301` | `!` beside a union, an intersection, a function type or a conditional type without parentheses |
| `EK0401` | a `throw` statement, or a call known to throw, in synchronous code outside effect code: plain functions, methods, constructors, accessors, plain generators, initializers, parameter lists, plain `catch` handlers and the module top level; a call in the `try` block of a `try`/`catch` statement is allowed |
| `EK0402` | a function that may throw where a function type doesn't admit its thrown type |
| `EK0403` | an unwrapped call, `new` expression or tagged template that may throw, in effect code |
| `EK0404` | an unwrapped Promise-producing call, `new` expression, tagged template or `async match` in effect code |
| `EK0406` | a `@throws` or `@rethrows` tag in a `.vibe` file, on any declaration, signature or type; quick fix: remove the tag |
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
| `EK1307` | an `error` or `schema error` declaration in a native TypeScript ambient context; use a native ambient class for an erased declaration |
| `EK1401` | a namespace name that two subpaths export, or a subpath and the root |
| `EK1501` | `export default schema S …`; write `export { S as default }` |
| `EK1502` | type parameters on a `schema` declaration; use an ordinary generic TypeScript factory |
| `EK1603` | `export default data D { … }`; write `export { D as default }` |
| `EK1701` | `fork` or `join` outside effect code |
| `EK1703` | a `fork` operand that is not an Effect |
| `EK1801` | a `try.all` operand that is not an array of Effects |
| `EK1803` | a name after `try.` other than `all`, `race`, `any` or `allSettled` |
| `EK1901` | a `for concurrent` operand that is not an `Iterable` |
| `EK1902` | `for concurrent` outside effect code |
| `EK1903` | `break` leaving a `for concurrent` body |
| `EK1904` | `return` in a `for concurrent` body |
| `EK1905` | a labeled `continue` naming a statement that encloses the `for concurrent` |
| `EK2001` | `for try` outside effect code |
| `EK2002` | `return` in a `for try` head binding initialization or body |
| `EK2003` | a labeled `break` or `continue` from a `for try` head binding initialization or body to a statement outside it |
| `EK2004` | a `for try` operand that is not a `Stream` |
| `EK2102` | a producer whose written return type is not a `Stream` |
| `EK2103` | `yield*` in a producer |
| `EK2109` | a `schema` field type outside the mapping, including a shadowing type without a suitable Schema value |
| `EK2111` | `restore` outside an `uninterruptible` block |
| `EK2117` | an `extends` clause or a `_tag` member in an `error` or `schema error` body, or a computed `schema error` key whose runtime domain cannot be proved to exclude `"_tag"` |
| `EK2126` | a constraint on a generic `data` type parameter |
| `EK2201` | an interruption block outside effect code |
| `EK2202` | `restore` in a `for concurrent` head binding initialization or body, or `restore` that captures an outer mask across an `effect` function, arrow, method, producer or block |
| `EK2301` | an unparenthesized conditional at either end of a pipe, `x \|> f(%) ? a : b`; write `(x \|> f(%)) ? a : b` or `x \|> (f(%) ? a : b)`; `vibelang --fix` writes the second, the old reading |
| `EK2801` | a `data` declaration with more than 4 type parameters |
| `EK2803` | a default on a generic `data` type parameter |
| `EK3001` | two services with the same key |
| `EK3002` | a class extends a service |
| `EK3003` | `new` on a service |
| `EK3004` | `instanceof` a service, or a class pattern naming one |
| `EK3005` | a service declares type parameters or captures an enclosing type parameter |
| `EK3006` | an error code or an unknown code in `vibe.severities`; remove the entry |
| `EK4402` | a value import of a Node builtin, with or without `node:` (`node:fs`, `fs`), or a reference to a banned platform global, in a `.vibe` file |
| `EK4609` | lint warning: `await` on a `Fiber` in an `async` function; use `join` |
| `EK4610` | lint warning: `await` on a `Deferred` in an `async` function; use `try Deferred.await(d)` |
| `EK4701` | a `match` with no `default` over a finite union that misses a case; a guarded arm covers nothing |

`EK0510` reports an unparenthesized `try`, `fork` or `join` on the left of `**`. The editor action wraps the whole execution expression, such as `(try program) ** 2`, in parentheses. `vibelang --fix` applies the same repair when it introduces no new error. Native TypeScript unary expressions retain `TS17006`.
