# Diagnostic code map

Diagnostic codes follow Appendix B of the specification: `EK`, the two-digit VIP number, then two digits for the rule. A code change does not change which programs a diagnostic rejects. Update saved diagnostic filters and expected-output assertions to the new code.

| Previous code | Appendix B code | Rule and repair |
| --- | --- | --- |
| `EK4407` | `EK4006` | An identifier module specifier names no declaration, or has import attributes. Declare the module, fix the name, or quote a file or package name. |
| `EK4408` (placement, export, expression, body) | `EK4001`, `EK4002`, `EK4003`, `EK4008` | Keep declarations named, at the top level and unexported; use ES imports and exports in their TypeScript bodies (VIP-40). |
| `EK4408` (name collision) | `EK4005` | A module name redeclares a value binding or another module. Rename one; this is an error. |
| `TS1141` (identifier specifier in a body) | `EK4007` | Share code through a `.ts` file or merge the bodies. |
| Previously accepted `import.meta` in a body | `EK4009` | Pass metadata in as an argument or use a `.ts` file. |
| `TS2708` (module name as a value) | `EK4004` | Import the module's exports with a static identifier import. |
| `EK4618` | `EK0101` | A declaration such as `effect load() {}` or `async load() {}` needs `function`. Insert it. |
| `EK4617` | `EK0103` | `await` does not run an Effect in an `async` function. Use `await runPromise(program)`. |
| `EK1019` for `var` | `EK0107` | `var` inside `do` uses the global declaration restriction. `do` control-flow diagnostics use `EK0201` through `EK0205`. |

The language server keeps the numeric code (`103`) with source `EK`; the terminal and diagnostic references write `EK0103`.

Contextual identifiers such as `module`, `type` and `of` also work as module names and identifier specifiers. Module names are case-sensitive: `module Text` and `module text` are distinct. Generated filenames preserve lowercase ASCII letters, digits and `_`; each other code point becomes `-` followed by its hexadecimal value and `-`. Thus `Text` emits `main.vibe.-54-ext.js`, while `text` emits `main.vibe.text.js`. Unicode normalization twins also keep distinct filenames.

Current compatibility splits keep the old check's behavior while freeing the canonical VIP identity:

| Former use | Compatibility identity |
| --- | --- |
| EK2003 in the stock mapper for a plain return contract | EK9203 |
| EK2104 for layer setup order | EK9209 |
| EK3007 for a service-key call with arguments | EK9214 |
| EK3201 for a missing legacy provider | EK9211 |
| EK9100 / EK9101 for a fatal mapper refusal | EK9005 / EK9006; native editor advice keeps EK9100 / EK9101 |


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

The temporary `EK92xx` codes preserve older checks whose numbers Appendix B reassigns to different rules. They are not new language rules. Interim `EK92xx` codes cannot be configured in `vibe.severities`: an entry is `EK3006`. An infallible `catch` expression stays valid when its interim `EK9204` report retires; the separate imported lint is `EK3818`. Their owning VIP implementations retire them. Other older codes keep their existing numbers until their VIP implementation removes or replaces the check.

## Appendix B reference

Registration reserves a code; it does not mean the compiler already implements every rule. The chapters describe the intended language; [Known limitations](../setup/known-limitations.md) lists the behavior the compiler does not implement yet.

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
| `EK0201` | a `do` block whose last statement violates TC39's `EndsInIterationOrBareIfOrDeclaration` early error; replaces `EK0107` for the same `var`, and reports alongside `EK0203` when both apply |
| `EK0202` | a `break` or `continue` whose target is outside the block of an `effect { … }` expression |
| `EK0301` | `!` beside a union, an intersection, a function type or a conditional type without parentheses |
| `EK0401` | a `throw` statement, or a call known to throw, in synchronous code outside effect code: plain functions, methods, constructors, accessors, plain generators, initializers, parameter lists, plain `catch` handlers and the module top level; a call in the `try` block of a `try`/`catch` statement is allowed |
| `EK0402` | a function that may throw where a function type doesn't admit its thrown type |
| `EK0403` | an unwrapped call, `new` expression or tagged template that may throw, in effect code |
| `EK0404` | an unwrapped Promise-producing call, `new` expression, tagged template or `async match` in effect code |
| `EK0406` | a `@throws`, `@exception` or `@rethrows` tag in a `.vibe` file, on any declaration, signature or type; remove the tag manually while retaining its documentation |
| `EK0501` | `try` outside effect code, the top level included |
| `EK0502` | `try` on a value that is not an Effect |
| `EK0503` | a `try` statement in effect code |
| `EK0504` | `catch` outside effect code |
| `EK0505` | An unparenthesized `try`, `fork` or `join` head before `catch`, including through erased TypeScript wrappers |
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
| `EK2301` | a pipe body that never uses its topic, `x \|> f()`; a `%` outside every pipe body; a whole unparenthesized `yield`, assignment or arrow as a pipe body, `x \|> (y = %)`; an unparenthesized conditional at either end of a pipe, `x \|> f(%) ? a : b`; write `(x \|> f(%)) ? a : b` or `x \|> (f(%) ? a : b)`, the old reading; also a whole bare plain, `async` or `effect` arrow pipe body, repaired by parentheses around the arrow |
| `EK2801` | a `data` declaration with more than 4 type parameters |
| `EK2803` | a default on a generic `data` type parameter |
| `EK3001` | two services with the same key |
| `EK3002` | a class extends a service |
| `EK3003` | `new` on a service |
| `EK3004` | `instanceof` a service, or a class pattern naming one |
| `EK3005` | a service declares type parameters or captures an enclosing type parameter |
| `EK3006` | an error code or an unknown code in `vibe.severities`; remove the entry |
| `EK3013` | a `task` or `workflow` declaration, or a use of an experimental module such as `Experimental.Durable`, in a project without `"vibe": { "experimental": ["builtins"] }`; add the opt-in to `tsconfig.json` or `vibe.config.json` |
| `EK4402` | a value import of a Node builtin, with or without `node:` (`node:fs`, `fs`), or a reference to a banned platform global, in a `.vibe` file |
| `EK4609` | lint warning: `await` on a `Fiber` in an `async` function; use `await runPromise(Fiber.join(fiber))` |
| `EK4610` | lint warning: `await` on a `Deferred` in an `async` function; use `await runPromise(Deferred.await(deferred))` |
| `EK4701` | a `match` with no `default` over a finite union that misses a case; a guarded arm covers nothing |

`EK0510` reports an unparenthesized `try`, `fork` or `join` on the left of `**`. Parenthesize the whole execution expression, as in `(try program) ** 2`. Native TypeScript unary expressions retain `TS17006`.

`EK4004` applies when a module name is used as a value. Imported or re-exported member names, destructuring property keys, labels, and names in `import.meta` or `new.target` do not read that binding. Re-export members with `export { member } from name`; exporting the module name itself is an error.

`EK9210` is retired. Continuation forms report `EK3501` before provider or operation-contract checks; handlers remain outside the first release.

`EK2118` is permanently retired. `EK2117` reports unsupported inheritance in an error declaration. Use a union to group VibeLang errors; native TypeScript classes retain TypeScript constructor rules.

`EK1001` is permanently retired under VIP-26. Calling an effect function constructs a cold Effect value; an explicit `try` outside Effect code is `EK0501`, and `catch` outside effect code is `EK0504` in both compiler hosts.

A call or construct signature in a `service` body reports one `EK0902`. A written whole shape owns that member error; independent key and generic errors still report.


## TypeScript mapper failures

The experimental `vibelang-ts-mapper` reports these codes while stock TypeScript checks or emits a `.vibe` file. Use the [native compiler](../setup/vibelang-cli.md) to check the original source when a projection cannot be represented safely.

| Code | Meaning and next step |
| --- | --- |
| `EK9001` | The mapper cannot safely project this source form. Follow the diagnostic's explicit annotation or helper advice, or check and build with `vibelang`. |
| `EK9002` | The mapper produced executable text that TypeScript cannot parse. Keep a minimal source reproduction for a bug report and build with the native compiler. Editing the generated projection will be lost on the next run. |
| `EK9003` | The mapper's `contentMappers` entry has unsupported options. Remove its `options` property or set it to `{}`; no mapper options are supported. |
| `EK9004` | A resolved Effect or platform package differs from the mapper's pinned forms table. Install the version named in the diagnostic in the consuming project; keep the mapper and its dependency pins together when updating. |
| `EK9005` | The mapper cannot choose a lowering from the written types. Add the requested annotation, or compile with the native compiler. |
| `EK9006` | The mapper cannot prove a data-method receiver or access form. Add the requested receiver type, or call the module function explicitly. |

After a configuration or dependency repair, rerun the original TypeScript command.


## Imported Effect lint rules

Every imported `EK38…` code, its default category and its message templates appear in the [imported lint diagnostic reference](imported-lint-diagnostics.md). Use the full printed code when searching or configuring a rule.

## Retained compatibility diagnostics

These identities remain in the compiler registry for older source and migration paths. Their registration does not enable a retired form. New source uses the current forms below.

| Code | Older form and repair |
| --- | --- |
| `EK1402` | A retired Effect receiver-method extension, such as `Option.some(1).map(f)`. Write `Option.map(Option.some(1), f)`. |
| `EK2105` | A typed legacy catch has no literal `_tag` to match. Use a `catch` expression and test its handler value with `match` or `is`. |
| `EK2107`, `EK2110`, `EK4202` | Legacy control-handler checks. Handlers are an open proposal; express the operation with supported Effect functions and services. |
| `EK2120` | The editor recognizes a legacy `control class` spelling. Removing `class` repairs that spelling only; it does not make the open handler proposal available. A retired `service class` instead reports `EK0909`. |
| `EK3202` | A legacy wiring expression supplies more than one provider for a service. Use an explicit `provide` block with the intended provider. |
| `EK4501` | A receiver-method extension is read as a value. Use the module function and pass the receiver explicitly; current code does not rely on receiver-method extensions. |
| `EK4601` | A legacy await check found a call that already ran. Current `async` code awaits Promises; run an Effect there with `await runPromise(program)`. |
| `EK4604`, `EK4612` | A retired hatch contains JavaScript `await` or VibeLang `join`. Put Promise-based `await` in an `async` function in a `.ts` file. In effect code, run a Promise through `try tryPromise(() => promiseCall())`, or join a fiber with `join fiber`. |


## Additional source and migration failures

| Code | Meaning and repair |
| --- | --- |
| `EK1011` | An Effect construct cannot resolve the Effect type. Install `effect@4.1.1` where the source resolves packages; if the diagnostic names another installed version, align it with the compiler's pinned peer. |
| `EK1503` | A `schema` declaration lacks its body or supported alias. Write `schema Name { field: string }` or an admitted schema alias. |
| `EK1504` | Schema fields have no separator. Insert `;` or a line break; write `;`. |
| `EK1705` | A `fork.` owner is unknown. Choose `fork.in(scope)`, `fork.scoped` or `fork.detached` for the intended lifetime. |
| `EK1706` | A `fork.in(scope)` operand is not a `Scope.Scope`. Pass an acquired scope; a lifetime string or layer is not a scope. |
| `EK4857` | A return channel still writes legacy `infer`. Run the preserving migration or write the inferred channel type explicitly. Remove an all-`infer` annotation only from an explicit `effect` callable when that preserves its contract. A repair is withheld when the returned Effect conflicts with a written channel. |

The following compatibility reports can still occur while older source is migrated. Use current forms when repairing them.

| Code | Older form and repair |
| --- | --- |
| `EK1003` | A legacy non-async path rejects `await using`. Use Promise-based disposal in ordinary `async` code; effect code uses scoped Effect resources. |
| `EK1012` | A stored call never produces a success value. Propagate its failure at the call site instead of storing an unreachable value; run Effects explicitly with `try`. |
| `EK1013` | A legacy inherited error or control body uses a comma as a class-member separator. Use native class separators; root declaration payloads retain their own separator rules. |
| `EK2006` | A legacy Effect `finally` jumps outside its block. Replace Effect `try` statements with `ensuring` or `onExit` cleanup; native JavaScript `finally` keeps its own completion rules. |
| `EK2106` | A legacy catch follows a handler that catches every failure. Use one catch expression with a `match` handler, or a native JavaScript catch clause. |
| `EK2108`, `EK2119`, `EK4201` | Legacy handler clauses are incomplete, return an incompatible answer, or cross fibers. Handlers remain an open proposal; use supported Effect functions and services. |
| `EK2114` | A catch expression appears in a retired hatch. Use a JavaScript `try` statement in a `.ts` helper or a catch expression in effect code. |
| `EK2115` | The stock mapper finds an Effect-running call in a legacy factory's call-time body. Separate plain factory setup from an explicit `effect` function or block, or compile with the native compiler. |
| `EK3203`, `EK3204` | Legacy automatic wiring finds a cycle or an unnamed output. Compose Layers explicitly and provide them with `provide`. |
| `EK3205` | A legacy automatically started `main` needs a missing service. Provide its required layers and run the resulting Effect from the entry point with `runPromise`. |
| `EK3206` | Legacy platform imports name two hosts in one file. Select the intended platform's services explicitly; importing a namespace does not start a host. |
| `EK3207` | A provider is not a supported operand. Supply a `Layer`, `Context`, non-empty tuple of layers or `Key = value` binding. |
| `EK4301` | A legacy implicit Effect callback is passed to a synchronous API. Use a plain callback for synchronous work, or an API that accepts an explicit Effect callback. |
| `EK4401` | A listed-failure wrapper names an unexported class. Export it from an imported module or use an explicit `Effect.try` boundary. |
| `EK4410` | A legacy syntax intrinsic is stored or renamed. Replace retired hatches with explicit Effect APIs; write `fork` and `join` as syntax in effect code. |
| `EK4502` | A legacy automatically run result is used as if it had `pipe`. Check the receiver's type and pipe an actual Effect or value with the appropriate API. |
| `EK4602`, `EK4603` | Legacy await checks reject a Promise or another non-fiber value. Ordinary `async` functions retain JavaScript `await`; effect code uses `try tryPromise(() => promiseCall())` or `join fiber`. |
| `EK4840` | An older Option migration suggests receiver-method syntax. Keep native `Option` calls or use `match`; do not introduce retired receiver-method extensions. |
