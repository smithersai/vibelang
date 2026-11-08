# Devtools

Compiler diagnostics show VibeLang contracts and catch failures or requirements that escape a function's promise. The `vibelang` compiler and its language server check `.vibe` and `.ts` files together. A written `./target.ts` import keeps TypeScript's native substitutions, including `target.tsx` and `target.d.ts`; it never selects `target.vibe`. Use `./target.js` for a runtime import of migrated source, or `./target.vibe` with the source-extension options.

## Install language tooling

```vibe
// example.vibe
// run: try Console.log(try sample())
effect function sample() {
  try sleep("5 millis")
  return "sample"
}
// string!!
// Output: sample
```

Install `vibelang` as a dev dependency. `vibelang --lsp --stdio` starts the language server from the project's compiler, one server for `.vibe` and `.ts` files. Completion also works inside the iterable expression of a `for concurrent` loop.

For VS Code and Cursor, install the extension that ships in `vibelang`, then open the application directory:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
# Or, for Cursor:
cursor --install-extension node_modules/vibelang/editor/vibelang.vsix
```

The extension is not on the VS Code Marketplace or Open VSX yet; reinstall it from `node_modules` after you update `vibelang`.

Other editors configure their LSP client to run `vibelang --lsp --stdio` for `*.vibe` and `*.ts`, with `vibe.config.json`, `tsconfig.json`, or `jsconfig.json` as a root marker. Turn off the other TypeScript server for this project to avoid duplicate diagnostics. JetBrains IDEs can use LSP4IJ.

Organize Imports and Remove Unused Imports keep type-only bindings used by generic `schema` mappings. An import that supplies a shadowing type still counts as used when it causes `EK2109`; organizing imports keeps that diagnostic instead of silently selecting a different schema. Unused aliases and names hidden by a local type are still removed. Rename and Find References also follow those schema type uses, including default and namespace imports; renaming a binding preserves the selected decoder and its diagnostics. Renaming a shorthand pattern binding keeps its property key: `{ let value }` becomes `{ value: let fresh }`, and its bound reads become `fresh`. Rename and Find References also retain a predicate parameter’s declaration and its uses, as in `(value: unknown) => value is E`, before and after a rename. When an imported type shares a binding with a `module` declaration, document highlighting follows its identifier specifiers along with Rename and Find References.

A retired `select` block still reports `EK4607`, while Find References, hover, Rename and call hierarchy follow its written callees and bindings. This includes empty arms and defaults before later cases.

The `EK0401` quick fix that makes a function effectful and uses `die` keeps written statement separators and comments, so a following statement or `else` stays separate.

The editor outline gives each `module` declaration its own entry, including a second declaration whose duplicate name reports `EK4005`, so every written name remains available for navigation.

For GitHub highlighting, add `*.vibe linguist-language=TypeScript` to `.gitattributes`; the starter's `.gitattributes` already has this line. Effect's type-aware lint rules, `@effect/tsgo`'s `effecttsgo/*` rules, are built into `vibelang`: see [Lint Effect code](../setup/vibelang-cli.md#lint-effect-code).

Ordinary `async` functions in `.vibe` files return `Promise<T>`, as in TypeScript. The server accepts them and shows the promise's type on hover. Write an `effect` function to run Effects with `try`.

Converting an `async` function writes a qualified `Effect.tryPromise(() => promise)` bridge for each `await`. Both actions write the explicit `effect` modifier, preserve its surrounding comments, remove the `Promise` return annotation so the Effect contract is inferred, and convert an arrow's expression body too. The action with an error per `await` uses `Effect.tryPromise({ try: () => promise, catch: (cause) => new PromiseFailed({ cause }) })`; the generated error name follows the awaited call and receives a numeric suffix when needed to avoid existing declarations or shadowing bindings. Recovered `async name()` shorthands gain `function`, including names beginning with `function`.

The conversion is withheld when a `return`, `break` or `continue` in an awaited `do` expression targets the surrounding function or loop: moving the operand into a `Promise` callback would change its target. Move that control flow before the `await` before converting. Jumps to targets within the operand and returns from nested callables keep the conversion available. An explicit `throw` in the operand also prevents conversion when it would move into the plain `Effect.tryPromise` callback, where explicit throws are forbidden. Keep that throwing code in an appropriate `async` or `effect` body before converting; nested callables retain their own throw context.

The conversion is withheld when the function refers to its own callable binding, including recursive methods, captured aliases and parameter defaults. Those references still expect a `Promise`, so migrate the recursion and its callers together. Shadowed names, unrelated properties and type-only references keep the conversion available.

Async conversion checks the `Effect` binding at each `Promise` bridge. If a block, loop or switch scope shadows the module at an `await`, the editor withholds the conversion. Rename the local binding before converting; unrelated sibling scopes and nested callable bodies do not prevent conversion.

The async conversion edits the selected function. It leaves containing variable and callback signatures, inherited member contracts and other overload signatures in place. When those require a `Promise`, the editor withholds the conversion; migrate the function and its contracts together. Inferred functions and contexts that accept any result remain eligible.

`fork` and `join` become reserved in an `effect` function's parameters and body. Async conversion is withheld when it would turn a binding or reference into a reserved name or fiber operation. Rename those bindings before converting. Property names and nested plain callable bodies keep their usual rules.

The error-per-await conversion declares its generated errors at module scope, so exported factories can name the resulting types in their declarations. File headers, directives and attached documentation keep their roles, including documentation separated from its declaration by blank lines. The error-per-await action is withheld when a file pragma and attached documentation cannot keep their original roles.

Async conversion also checks inherited contracts on callable class fields and applicable index signatures on classes and contextually typed objects. A field or method whose converted result would violate a `Promise` contract keeps its `async` form until those contracts are migrated. Inferred fields and index signatures that do not apply to the member remain eligible. Computed member names use their key types, including numeric, template-literal and union keys, when checking those contracts. Indexes inferred from computed members also participate, including a widened `string` index. Generic computed keys also use their resolved constraints, including unions and chained constraints.

The Promise conversion refactors apply to ordinary `async` functions. For an async generator, write an Effect producer and handle its terminal result and Promise yields explicitly.

## Inspect inferred information

```vibe
// run: try Console.log(try accepted(2))
error Rejected

effect function accepted(value: number) {
  if (value < 0) throw new Rejected()
  return value + 1
}
// number!Rejected
// Output: 3
```

Inspect `A`, `E`, and `R` when changing a function. Calling an `effect` function returns an unrun Effect. `try` returns its success value. The function's complete contract also records escaping failures and unmet services, and generated declarations expose it to TypeScript consumers.

An ordinary function that returns a native helper's Effect keeps the helper's inferred declaration spelling. If TypeScript writes `import("effect/Effect").Effect<…>` and this file never names `Effect`, the `.vibe` declaration keeps that import type; merely inferring an Effect return does not add a root `Effect` import. An `effect` function or `effect { … }` block still imports the types its generated declaration needs.

Hover over an Effect-returning function to see its inferred `Effect<A, E, R>`. Language-server, formatter, and diagnostic support for the new forms arrives with the compiler's VIP implementation.

## Diagnostics, completions, and refactors

Malformed imports keep their TypeScript syntax errors even when `vibelang-runtime` is absent.

```vibe
// expect-error: EK9201
// Rejected escapes a contract promising no failures.
effect function promised(value: number): number!! {
  return try accepted(value)
}
```

This is `EK9201`, an interim code ([diagnostic code map](../vibelang-features/diagnostic-code-map.md)): handle `Rejected` inside the function or widen its contract. Unmet services are `EK9202`, also interim. A call returns an Effect that can be stored at module top level; run it with an explicit runner. A synchronous callback can return an Effect without running it.

Inside effect functions, wrap a call that may throw with `Effect.try`, or a Promise with `tryPromise`, then run the wrapper with `try`. A VibeLang plain function never throws, so it can be called directly; so can a `.ts` function known not to throw. A Node.js or web I/O global, run or held as a value, and a Node.js module imported as a value are rejected with the Effect service that replaces them (`EK4402`). The web's `crypto` and `performance` are such globals. `Date.now()` and `Math.random()` stay allowed. `Temporal.Now` reads also stay allowed when the selected ECMAScript library declares `Temporal`. Host clock and randomness reads use `EK4402`. The old `EK4403` is retired, so remove its severity settings. A runner inside code a fiber runs is `EK1005`. A `catch` expression whose Effect has E = `never` gets `EK9204`, an interim code (defects pass through), a warning by default.

Use a throw statement to fail an Effect: `if (value === undefined) throw new MissingValue()`. A handler that fails again uses `catch effect (e) => { throw e }`; a plain `catch (e) => value` returns a value.

The server exposes TypeScript completions through the VibeLang checker, service member types included. Catch-specific completions are not implemented. Other diagnostic messages suggest repairs as text. Use an effect function and `try` for VibeLang sequencing.

The `EK0501` editor quick fix marks an ordinary function `effect`, so callers receive an unrun Effect. Header comments stay unchanged while the modifier is added before the declaration’s `function` keyword.

For `EK0801`, the resource quick fix moves a direct `using` declaration and the rest of its Effect callable into `scoped`, with `acquireDisposable` for acquisition. It withholds the action when an earlier closure, hoisted reference or type reference needs a declaration that would move into the new block. Move the dependent code together when writing the conversion by hand. The action also stays unavailable when the moved code needs the ambient `Scope`, or its requirements are still generic and could include `Scope`: the new `scoped` would consume that requirement. Broad requirements such as `object`, `{}` or an empty interface also prevent the action because their Effect can still read the caller’s scope. A concrete unrelated requirement remains eligible. A `Scope` use before the declaration, a locally provided scope, or an unrun nested Effect does not prevent the edit.

The `EK0801` resource action keeps initializer names: an anonymous class, function or arrow initializer has no automatic conversion when the acquisition callback would erase its inferred name. A class can observe that name while its static fields initialize, so setting `.name` afterward is insufficient.

The resource action groups object initializers through `as`, `satisfies` and non-null `!` wrappers, so acquisition still returns the object. Acquisition uses an explicit `effect { … }` block, preserving `try` in computed names and heritage and retaining nested Effect bodies. A local name `sync` does not prevent this repair. Comments around the binding, initializer and commas remain in the repaired declaration.

### Move a TypeScript module body to a file

Place the cursor in a top-level `module parse { … }` declaration and request **Move module to a TypeScript file** (VIP-40). The refactor writes the TypeScript body to `parse.ts` beside a `.vibe` source, or to `parse.tsx` beside a `.vibex` source even when the body has no JSX, and rewrites its identifier imports, re-exports and side-effect imports to that file. When the copied body would be a script under the project's options, for example a body with no `import` or `export` under `moduleDetection: "legacy"`, the new file ends with `export {}` so its declarations stay private; otherwise the body is copied unchanged. Other module declarations stay in place. The new file keeps the body's comments, JSDoc, relative imports and runtime behavior.

If `parse.ts` or a conflicting sibling name is taken, compared case-insensitively, the refactor chooses `main.parse.ts` for `main.vibe`, then adds a number if needed. The rewritten specifier ends in `.ts` when `rewriteRelativeImportExtensions` or `allowImportingTsExtensions` is enabled, and `.js` otherwise. The editor applies file creation and source edits together and does not overwrite an existing file. This move is an explicit refactor; `vibelang --fix` leaves legal module declarations in place.

`new f()` on a function declared in a `.vibe` file uses TypeScript's own constructor checks. VibeLang adds no constructor diagnostic, so assertions and `@ts-ignore` keep TypeScript's behavior.

A generated declaration for a `module` body keeps relative imports pointed at their source modules. With `vibe.sidecarDir`, rebuilding does not import a relocated declaration as a second source module. The migrate flow removes a returned source's module-body declarations when it restores the original TypeScript. Project references also retain a body's type exports when reading built declarations, so inherited members stay available to the consuming project.

## Diagnostic reference: additional codes

`EK1502` rejects type parameters on a `schema` body or alias. Write a generic TypeScript factory for parameterized construction. If an older compiler accepted the header as an empty schema followed by a TypeScript expression, its quick fix and `vibelang --fix` make that empty body explicit and retain the expression, preserving the old decoder and public type.

Each entry gives the condition and the repair. The examples and language-service tables on this page cover the other registered codes for these forms.

| Code | Meaning | Remedy |
| --- | --- | --- |
| EK2301 | A pipe body never uses its input topic, `%`, or `%` appears outside a pipe body. | Put `%` where the input belongs in the call after the pipe; use `%` only after the pipe operator, or name the value with a variable. |
| EK1017 | A `provide` statement was used in an expression position. | Write `provide layer { statements }` as a statement and return from inside its block. |
| EK2111 | A `restore` block has no enclosing `uninterruptible` block. | Put it inside `uninterruptible`, or use `interruptible { … }`. |
| EK3001 | Two services share a key. | Rename one of the declarations named by the diagnostic. |
| EK3002 | A class extends a service key. | Implement the service's shape instead of extending its key. |
| EK3003 | `new` tries to construct a service key. | Read the provided implementation with `try Service`; create implementations as objects or classes implementing its shape. |
| EK3004 | `instanceof` or a class pattern, `when Users:`, tests a service key, which is no base class. | Test the implementation's data or a concrete implementation class instead; match its members, `when { find: let find }`. |
| EK4838 | An obsolete check from the old language, which tied a fiber to the region that forked it. Returning, storing or passing a `Fiber` is not a VibeLang error, and a plain `fork` child is still interrupted when its parent ends. | The legacy warning has no automatic lifetime conversion. Use `fork.scoped p()` for the caller's scope, `fork.in(scope) p()` for a scope you hold, or `fork.detached p()` for a fiber nothing owns. |
| `EK1906` | A `for concurrent` head uses `var`, `using`, `await using`, or an assignment. | Declare the item with `const` or `let`; assign an existing variable inside the body. |
| `EK2005` | A `for try` head uses `var`, `using`, `await using`, or an assignment. | Write `for try (const item of stream) { current = item }` to assign an existing variable. |
| EK1704 | `join` receives something other than a Fiber. | Join one fiber at a time; run Effects with `try`, use `try Deferred.await(deferred)`, or wrap Promises with `tryPromise`. See [fiber lifetimes](../concurrency/047-fibers.md) for ownership forms. |
| EK4819 | Registered for `yield effect` in a TypeScript Effect generator; currently not emitted in `.ts` files. | In TypeScript use `yield* effect`; in VibeLang write an effect function with `try`. |
| EK4820 | Registered for a non-returning `yield* effect` whose success type is `never`; currently not emitted in `.ts` files. | In TypeScript write `return yield* effect` so control flow narrows; in VibeLang run the Effect with `try`. |
| EK9100 | The editor's text-only projection needs a written type to choose a form. | Add the annotation requested by the message. |
| EK9101 | An editor-only suggestion: the text-only projection cannot safely select a data-type method from the receiver's written type or access syntax. | Apply "Annotate as the fork infers", which writes the checker's receiver type as an annotation, or call the module function explicitly; optional or uncalled accesses need a direct call. |

## Configure compiler checks

```vibe
// run: try Console.log(try checked(2))
effect function checked(value: number): number!Rejected {
  return try accepted(value)
}
// Output: 3
```

A contract gives the compiler a promise to check. Write all three channels, such as `Effect.Effect<number, Rejected, never>`, or omit the return annotation to infer all three. An omitted slot is `never`, so `Effect.Effect<number>` is `number!!`. VibeLang reads `vibe.config.json`, `tsconfig.json`, or `jsconfig.json`, in that order within a directory. `vibe.config.json` accepts every `tsconfig.json` field with its TypeScript meaning, except that every `.vibe` file is a module whatever `moduleDetection` says. Put VibeLang's settings under the top-level `"vibe"` key:

```json
{
  "compilerOptions": {
    "strict": true,
    "sourceMap": true
  },
  "vibe": {
    "severities": { "EK0801": "error", "EK4609": "warning", "EK3801": "off" },
    "effectGlobals": true
  }
}
```

A config that `extends` another inherits its `vibe` settings key by key, and `severities` merges entry by diagnostic code. TypeScript, typescript-eslint, and editors' TypeScript servers ignore the top-level object. Plain `tsc` rejects unknown `compilerOptions` with TS5023, so keep VibeLang's settings at the top level.

Each `.vibe` file keeps the settings of the package that owns it. When a project reads another workspace package's `.vibe` source, the checker applies that package's config to its diagnostics. The importing project's settings apply to the files of its own package. Editor projects and imported packages use the nearest configuration directory, preferring `vibe.config.json`, then `tsconfig.json`, then `jsconfig.json` there. Creating `vibe.config.json` in an open project refreshes that selection.

Only a warning's code or an assigned imported `EK38xx` lint code may appear in `vibe.severities`. Set it to `"error"`, `"warning"`, `"suggestion"` or `"off"`. VibeLang's own warnings do not fail CI or prevent emission under `noEmitOnError`; use `"error"` to fail CI. Own suggestions appear only in the language server. Imported Effect diagnostics follow the plugin's `ignoreEffect*InTscExitCode` and `includeSuggestionsInTsc` options; imported warnings fail compiler builds by default. Invalid entries report `EK3006`; unknown or wrong-typed `vibe` options report `EK3007`. `extends` merges severity entries by code.

Root `vibelang.diagnostics` and `compilerOptions.vibelang.diagnostics` are legacy maps in any supported config or extended config. Supported settings keep applying until migrated; modern entries for the same diagnostic or its explicitly mapped port win. Each map reports `EK3009`, and hiding that warning leaves its settings active. Run `vibelang --fix` to migrate eligible maps while preserving comments; resolve obsolete or nonconfigurable entries first. Comments inside wrappers and empty maps, after final entries, and on superseded entries also survive. See [Diagnostic severities](../setup/vibelang-cli.md#diagnostic-severities).

For example, a legacy `EK4406` policy entry cannot appear in `vibe.severities`; remove it before migrating the map. `EK9100` is editor-only and warns by default; it requests a written type for the text-only projection and is not reported by the CLI.

Unknown or retired warning codes cannot be configured. Remove an entry for the retired unused-`main` warning: that warning was retired when `main` became an ordinary function (VIP-26).

`vibe.effectGlobals` defaults to `true`, making every value export of `effect/Effect` a global, such as `retry` and `tryPromise`. Set it to `false` to use `Effect.retry` and other qualified names ([Effect's functions](008-importing-effect.md)).

## TypeScript-style Effect code

Native `Schema.TaggedError` classes whose fields object contains a spread, and native `Schema.TaggedError` or `Data.TaggedError` classes with a written static `_tag`, keep their library form without `EK4837` or `EK4830` and without a declaration quick fix. These shapes have no equivalent declaration form; a stale editor diagnostic does not make them eligible for a repair.

Effect declarations and combinator calls written in TypeScript's style use the same library APIs in `.vibe`. The table shows declaration forms and their existing diagnostics. Quick fixes for new VIP forms arrive with the compiler's VIP implementation; [Effect.gen in direct style](#effectgen-and-effectfn) shows the conversion.

The `.pipe(...)` quick fix captures custom stage expressions before applying them when one could change a later expression. All stages are constructed before the first is applied. Options with accessors or opaque values keep the data-last `retry`, `repeat` or `withSpan` call, preserving when options are read. A custom stage that may observe the receiver supplied by `.pipe(...)` keeps its library form. Comments between captured stages keep their original association by declining the automatic rewrite.

For `EK4834`, `EK4835` and the `provide` calls in `EK4836`, only the direct operand of bare `try` in effect code warns. Parentheses, `as`, `satisfies` and non-null `!` wrappers still count, as do resolved import aliases. Stored or returned Effects, `fork` and `join` operands, `try.all` and its siblings' elements, Effect API arguments and `catch` heads keep their library forms. A recognized direct operand still warns when no safe rewrite exists; its note explains why the quick fix is unavailable. Wrappers with written type effects stay intact. A direct `Effect.provide` call with explicit type arguments still warns, but keeps its native call: a block cannot preserve that written type contract.

| Code | TypeScript style | VibeLang form | Quick fix |
| --- | --- | --- | --- |
| EK4830 | `class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}` | `error NotFound { id: string }` | When the tag is the class name and the base is `Data.TaggedError`; a different tag keeps the warning without one. A class extending untagged `Data.Error` draws no EK4830: keep its library form |
| EK4831 | `class Users extends Context.Service<Users, { find(id: string): Effect.Effect<User> }>()("app/Users") {}` | `service Users { static readonly key = "app/Users"; find(id: string): User!! }` | When the members are written in the type argument; the class's key stays, written as `static readonly key` unless it is the one the compiler derives |
| EK4832 | `const User = Schema.Struct({ id: Schema.String })` | `schema User { readonly id: string }` | When every field has a declaration form. With `Schema.optionalKey` or a check, the warning stays but offers no quick fix, and says why. In a project that emits declarations, an exported constant keeps its form unless the file also declares its type, `export type User = typeof User.Type`: the declaration would add that type to the declaration file. A private constant without its type keeps its form there too when the declaration file names it, through `typeof User`, `Schema.Schema.Type<typeof User>`, `export { User }` or `export default User`: the declaration would print the type beside it. An alias or interface written with `Schema.Schema.Type<typeof User>` also keeps its form, private or exported, because a `schema` declaration would change its printed spelling. A documented `type User = typeof User.Type` stays beside the declaration with its comment, which replaces the alias the declaration synthesizes (VIP-15, detail 256). Without declaration output, the helper must resolve to Effect's own `Schema.Type`; a same-spelled custom helper keeps its alias or interface and its constant An optional field is written `name?: T \| undefined`, which is `Schema.optional` under either `exactOptionalPropertyTypes` setting, so the fix keeps the schema in every project that compiles the file; a `Schema.optional(Schema.Undefined)` field keeps its constant. |
| `EK4833` | `Effect.Effect<User \| null, NotFound \| Timeout, Db>` | `(User \| null)!(NotFound \| Timeout)!Db` | Hovers and offered edits keep compound channels grouped; a warning may retain the qualified type when no automatic edit preserves its contract |
| EK4834 | `return try Effect.succeed(user)`, `try Effect.fail(error)` | `return user`, `throw error` | When bare `try` directly runs the call and the replacement preserves its types and evaluation |
| EK4835 | `try Effect.catchTag(find(id), "NotFound", (e) => …)` | `find(id) catch effect (e) => match (e) { when { _tag: "NotFound" }: …; default: throw e; }` | When bare `try` directly runs the call and each handler is an arrow with one value. A handler that only gives `Effect.succeed` values stays plain; a `throw` or a `try` makes it `effect` |
| `EK4836` | `Effect.withSpan(main(), "main")`, `return try Effect.provide(main(), AppLive)`, `try Effect.provideService(main(), Users, users)` | `withSpan(main(), "main")`, `provide AppLive { return try main() }`; retain the native `Effect.provideService` call | `withSpan` always. A `provide` block when bare `try` directly runs the call as a statement or a return, and the program is a stable binding or a call of an `effect` function: the block evaluates it after the layers build, where the call evaluated it first. A service call has no automatic block rewrite: building a `Layer` changes scope and memo-map observations |
| EK4837 | `class Failed extends Schema.TaggedError<Failed>()("Failed", { … }) {}` | `schema error Failed { … }` | When the tag is the class's name and the body holds accessors and annotated methods; a field with no type form is named by a constant, including in a private class. Comments between fields and before or after members are retained. A JSDoc comment that would gain a new member attachment keeps the class. `Schema.optionalKey`, an annotations argument or a constructor keeps the class |
| EK4839 | `Match.value(status).pipe(Match.when("idle", () => "Idle"), Match.orElse(() => "Busy"))` | `match (status) { when "idle": "Idle"; default: "Busy"; }` | When each pattern is a literal, an object of patterns, a `Match` refinement such as `Match.string`, or `Match.instanceOf(C)` for a proven ordinary class, and each handler an arrow function that runs no program; `Match.instanceOf(Number)`, `Match.instanceOf(String)`, `Match.instanceOf(Boolean)`, `Match.instanceOf(Array)` and other unproven constructors keep the warning without a repair, as do predicate functions and array patterns. A type the arms do not share is written: `withReturnType`'s or the handlers' type, or a primitive one |
| EK4841 | `export const Tags = Schema.Array(Schema.String)` just before `export type Tags = typeof Tags.Type` | `export schema Tags = readonly string[]` | `Schema.Struct` pairs qualify too, for example `schema User = { readonly name: string }`; their repair keeps the written imports. When the type alias is the statement just after the constant, with the same export and no JSDoc, and every part of the schema has a type; a type written before its constant keeps its form, because the alias's declaration file lists the constant first; the repair keeps an explicit statement terminator so deleting the type alias cannot join the following statement to the schema initializer |
| EK4842 | `import { Array } from "effect"` and `Array.take(values, 2)` | `import { Array as Arr } from "effect"` and `Arr.take(values, 2)` | When no type is written with the import, as `Array.NonEmptyReadonlyArray<T>`, and nothing the file exports names it or has a type the module declares; the names are `Arr`, `Str`, `Num`, `Bool`, `Fn`, `Sym`, `Big` and `Regex`, or `EffectArray` and its siblings when the file already uses the short one |

`EK4856` warns about the transitional bare `Effect<A, E, R>` alias. Its migration fix uses shorthand only when it needs no new parentheses: `Effect<number>[]` becomes `Effect.Effect<number>[]`, while `(Effect<number>)[]` becomes `(Effect.Effect<number>)[]` to retain its declaration bytes. Existing parentheses, comments and explicit default slots are preserved; `Effect<number, never>` becomes `number!never`. Local and imported types named `Effect` retain their native meaning.

`EK4833` then writes the equivalent shorthand with its required parentheses, such as `(number | string)!!` for `Effect.Effect<number | string>`, because added parentheses leave declaration output unchanged. A full `vibelang --fix` run therefore ends at the grouped shorthand. `EK4833` refuses, and its note says why, only where declaration output would drop parentheses written in the source, such as `(Effect.Effect<number>)[]`, or where the rewrite would lose comments between type arguments.

Schema repairs retain value references. A library alias or field that refers to a value named `string`, `number` or another type keyword (including `keyof` and `readonly`) keeps its form: using that bare name as a schema type would change its meaning. Qualified references such as `holder.string` and neutral names remain eligible for automatic repair.

`EK4833` omits an unused requirements slot: `Effect.Effect<User, NotFound>` becomes `User!NotFound`, whose requirements default to `never`. A custom alias named `Effect` is suggested only when its written arguments already match the resolved Effect's success, error and requirements types, including omitted `never` slots. Aliases whose parameter order, defaults, wrapped slots, service requirements or union branches would change the resulting type keep their spelling.

A pure `Option.gen(function* () { … })` has an eager plain-function quick fix for
statement-position `yield*` bindings, discarded yields, and `return yield*`.
It evaluates each Option in order, returns `Option.none()` at the first `None`, and wraps normal
completion in a fresh `Some`. A fallthrough or void return, nested expression yield, nested function,
generator receiver, `try`/`finally`, or a delegated yield inside a `for...of` body keeps the diagnostic and its refusal
reason; those shapes need a manual rewrite.

A plain `Option.match(value, { onNone, onSome })` has a native quick fix: the subject and the handler object are read once, in their original order, then a `match` chooses `when Option.Some(let value)` or the default. A handler may ignore the `Some` payload; the repair preserves its contextual result type and passes the original argument. A private interface payload from another module is expanded structurally when the repair needs an annotation, so it does not introduce an out-of-scope type name. A choice whose arms return programs keeps the diagnostic and its reason.

A discarded `Option.match` result becomes a statement block; expression positions retain a `do` expression. A choice that starts a larger expression statement is parenthesized. Both evaluate the subject and callbacks once, in order.

Legacy Effect data extension calls have a preserving migration: `Option.some(1).map(f)` becomes `Option.map(Option.some(1), f)` under `vibelang -p tsconfig.json --fix` or `vibelang -p tsconfig.json --fix --fix-migration-only`. The compiler resolves the receiver first; array methods, own methods, namespace calls and optional chains stay as written. The rewrite evaluates the receiver and arguments once, retains comments, and checks public declaration bytes, emitted module evaluation order and new errors. It refuses a shadowed module without a safely reusable namespace binding, an alias whose erased, deferred or reordered import could change module initialization, a module format whose startup order cannot be proved, explicit type arguments, trailing blocks or changed declarations; use an explicit namespace call and verify those sites.

An Option pipe whose stage argument is a callback factory, a property read or an object literal, such as `pipe(value, Option.map(EffectArray.append(1)))`, is cached first: a `do` block evaluates the subject and each argument in pipe order, then calls the module functions on the cached values, so no factory moves into the stage that uses it.

A default `Match.orElse` handler that destructures its parameter, `({ _tag }) => _tag`, becomes a catch-all `let` arm whose `do` block performs the same destructure, defaults included, only when the default runs.

A `Match.when(String.startsWith("Core"), …)` predicate, alone or inside `Match.whenOr` with exact literals, becomes a guarded arm, `when let value and if (value.startsWith("Core"))`, in the original case order.

A hoisted return-type stage, `const withChoice = Match.withReturnType<T>()` passed to `.pipe(withChoice, …)`, converts like the inline form: the chain becomes a `match`, the hint's type context is kept, and the hint is still read before the subject so initialization order and TDZ behavior do not change.

A `service` without a derived key reports `EK0903`. Its quick fix inserts `static readonly key` with the current identity; `--fix` applies it to local declarations and declarations without a named package too.
### Effect.gen and Effect.fn

When converting an Effect generator, `--fix` preserves a native constructor hidden by an implicit Effect namespace: `new Headers(input)` becomes `new globalThis.Headers(input)`. Local and imported constructors keep their bindings. This qualification does not permit host APIs in VibeLang: a banned constructor still reports `EK4402` and belongs in a TypeScript adapter. If a local `globalThis` prevents safe qualification, the generator stays unchanged.

`--fix` writes an `Effect.gen` or `Effect.fn` program as an effect function or an `effect { … }` block, and a `.pipe` of an Effect with `|>`. When the `|>` form of a generator's `.pipe` would add an error, as `HttpEffect.toWebHandlerWith(context)` does by taking its requirements from the `.pipe`, the generator becomes an effect function that keeps that `.pipe`. The last stage of a pipeline that runs becomes a catch expression: `Effect.catch`, `Effect.catchTag`, `Effect.catchTags`, `Effect.orElseSucceed(x, () => v)` as `x catch () => v`, and `Effect.mapError(x, (e) => f(e))` as `x catch effect (e) => { throw f(e) }`. A stage with stages after it stays a call, and so does a pipeline held as a value. `Effect.withSpan(x, name)` as a last stage becomes `withSpan(() => x, name)`, and under `try`, `Effect.provide(x, L)` becomes `try effect { provide L { return try x } }`. `try Effect.void` goes. `Effect.sync(() => v)` becomes `effect { return v }`, or `v` where it runs, and `Effect.suspend(() => p)` becomes `effect { return try p }`, or `try p` where it runs. A thunk that throws, awaits, or reads `this`, and a `sync` whose value is a program, stay as written. Each `yield* e` becomes `try e`, including an Effect value such as a service key or a `Config` descriptor:

```ts
// fragment
export const greet = (id: string) =>
  Effect.gen(function* () {
    const users = yield* Users
    return `Hello, ${yield* users.find(id)}`
  })
```

```vibe
// pending: VIP-1, VIP-5
// fragment
export const greet = effect (id: string) => {
  const users = try Users
  return `Hello, ${try users.find(id)}`
}
```

Use an effect function for a sequence with parameters, and `effect { … }` for an Effect argument, such as `Layer.effect`'s second argument. Keep unrun Effect values intact. A `throw` in effect code fails the Effect with a typed error; plain and `async` callbacks keep JavaScript's exception semantics.

`Effect.fn` infers its parameter tuple before TypeScript prints declarations. Its repair writes those checked parameter types: for example, a generator parameter written `ReadonlyArray<T>` becomes `readonly T[]`. It preserves generic parameters, optional parameters and the generator's input types through pipeline stages. A parameter without an annotation, defaulted or not, takes the tuple's `any`, so `function* (version = "unknown")` becomes `effect (version: any = "unknown") =>`; when every parameter is defaulted and a stage follows, TypeScript infers an empty tuple and the generator stays. When the written annotation was the last read of a type name, the repair removes that name under `noUnusedLocals`: a type-only import binding, an import binding that only types read, such as `Schema` in `Schema.ID` or `typeof made`, or a type alias the module does not export. It leaves a name the author had already left unused, and a local value it leaves unused still refuses the fix. A comment inside a type that needs rewriting keeps the diagnostic and its reason instead of losing the comment. An explicit import type such as `import("effect/Brand").Brand<"Path">` stays qualified in the parameter and inferred return declaration.

An `Effect.gen` generator with a written `Effect.fn.Return<A, E, R>` or an alias of a generator type retains its checked `Effect` result type on a cold function around the converted body. This keeps contextual literal return types and the declared failure and requirement channels, including when a surrounding pipeline transforms the result. A direct JavaScript iterator annotation such as `Generator<Y, A, N>` already selects a native generator and stays native. Unsafe rewrites still leave the generator and explain the refusal.

`Effect.fn("name")` keeps its name as a span, `try Effect.withSpan(effect { … }, "name")`. When it has a written `Effect.fn.Return` or contextual Effect return type, the fix puts that type on a cold function inside the span, so literal object fields retain their declared types. An effect function records no `Effect.fn` stack frame in a failure's trace. A parameter with a default or a pattern, bound when an `Effect.gen` function is called, keeps the function plain: `({ id }): infer _ => effect { … }`. A generator's `throw`, a defect in Effect, becomes `return try Effect.die(e)`. A stage that reads the function's arguments, `(effect, path) => …`, receives the effect function's parameters, `|> ((effect, path) => …)(%, path)`; a generator parameter with a default or a pattern, which does not hold its argument, keeps its native form, and so does a stage that names an argument otherwise, `(effect, _path)`, whose name `Effect.fn`'s declaration takes, or that reads a name one of the generator's parameters would hide. A comment in the generator's parameter list, or before a stage, keeps its place. A `.pipe` stage that a call into a TypeScript module builds, as `effect.pipe(instances.provide(session))`, goes through the same defect bridge as the generator's other throwing calls: `effect.pipe(try Effect.orDie(Effect.try({ try: () => instances.provide(session), catch: (e) => e })))`.

Legacy `: infer _` annotations in plain callbacks checked as TypeScript by `Effect.try`, `Effect.tryPromise`, `sync` or `callback` can report `TS1338`. `--fix` removes a simple whole-return marker and keeps TypeScript's inferred result, including inside a converted generator. Conditional `infer` types keep their meaning; an async or generator return contract, a named inference parameter, or an annotation containing comments is left for a manual edit.

`--fix` also preserves a named `Effect.fn` generator's generic requirement contract. When `withSpan` would otherwise infer `Exclude<R, ParentSpan>`, the converted function retains the original final `Effect` return type, including any pipeline stages. A written generator contract still belongs to the cold inner program.

A bare `return` in an `Effect.fn` generator must satisfy its written `Effect.fn.Return<A>` success type. If it does not, `--fix` leaves the generator unchanged and reports the incompatible return; `void`, `undefined` and success types that include `undefined` remain eligible for conversion.

Async conversion requires every `await` operand to be statically `PromiseLike`. JavaScript also permits `await` on a scalar, an unknown value or a mixed union. Normalize those operands explicitly, for example with `await Promise.resolve(value)`, before requesting the refactor.

A legacy service's cached `static readonly default` remains a cached value during migration. An exported key that cannot be changed safely is left with an explained refusal; a safe local key can become an equivalent native service class. Field reads, type reads and unrelated shadowed utility types remain intact. Adopting a `defaultValue` fallback is a separate semantic change.

For a throwing call in plain code, `--fix` can move the invocation into a TypeScript `module` helper while keeping the function synchronous. An overloaded call is eligible when every overload accepts the supplied argument count and has the same types at those argument positions and the same return type. The helper retains method receivers and evaluates a method getter before its arguments. Overloads with generic parameters, predicates, rest parameters or an explicit `this` parameter still require manual repair.

A generator parameter may omit array elements, as in `[, value]` or `[,]`. The teaching rewrite for an ordinary `Effect.fn` call or `Effect.fnUntraced` retains that destructuring inside the cold body, including its defaults and skipped value reads. A binding combined with a named span or stage keeps its valid native generator form when the rewrite cannot preserve that boundary. Import cleanup may still apply.

A known-throwing call in an effectful callable’s parameter initializer has a preserving repair: a private TypeScript adapter evaluates the call immediately and preserves its value or original exception. Destructuring defaults and computed binding keys keep their native order. Repeated runs do not reevaluate the callable’s defaults; a callback’s own defaults still run when its caller invokes that callback. A strict callable’s body remains a separate boundary.

A synchronous call of a plain TypeScript function whose exceptions nothing lists, `EK0403` in effect code, becomes `try Effect.orDie(Effect.try({ try: () => f(x), catch: (e) => e }))`: the inline mapper cannot throw, an exception stays the defect it was in `Effect.gen`, and the function's type doesn't change. To make it a typed failure, return an `error` declaration's instance from `catch` and remove `Effect.orDie`. In a function that runs no Effect, `--fix` writes `: infer _`, which keeps the function plain. `EK1002`'s rewrite of an `Effect.gen` or `Effect.fn` generator writes its throwing calls through the same wrapper. Both keep what a guard proved about a property the call reads, which the wrapper's function would not know: in `o.p ? f(o.p) : 0` the guard moves into `try:` with the call, and a property an earlier statement proved moves to a `const` before the call's statement, as `if (!o.p) return 0` then `const n = o.p` and `f(n)`. An unbraced `if` branch becomes a block that holds the `const`. A foreign type predicate that an `if` tests keeps its proof the same way: `if (!isRecord(body)) return 0` becomes `const record = try Effect.orDie(Effect.try({ try: () => isRecord(body) ? body : undefined, catch: (e) => e }))`, `if (record === undefined) return 0`, and the code the test guards reads `record`. A predicate tested beside other operands keeps it too: `if (!output || !isRecord(body)) return 0` becomes `if (!output) return 0`, the `const`, and `if (record === undefined) return 0`, so `isRecord` still runs only when `output` is set.

Apply every fix in a project, then compile as the rest of the command says:

```sh
npx vibelang -p tsconfig.json --fix --noEmit
```

`--fix` writes what the prelude makes shorter: it can remove an import of one of Effect's modules under its own name, as `import * as Console from "effect/Console"`, `import { HttpRouter } from "effect/http"`, or `import { FileSystem } from "effect/FileSystem"` are, writing a use the module's name cannot stand for as `FileSystem.FileSystem`. The report counts these as `prelude import` and `module export`. In a project that emits declarations, `--fix` keeps what the declaration file writes: an import that the file's declaration file keeps stays when it is spelled otherwise than `import { Schema } from "effect"`, so `import * as Schema from "effect/Schema"` stays beside `export const Value: Schema.Codec<unknown>`, and `import * as DateTime from "effect/DateTime"` beside a local `type NonNull<V> = V extends DateTime.Utc ? string : V` that an export names, and EK4833 keeps a `never` written in an exported statement, writing `Effect.Effect<void, never, never>` as `void!never!never`. The declaration file then matches the one the TypeScript emitted. It prints each file it changes, with its fixes by code, and writes a file only after it checks the fixed program: a fix that would add an error is listed as not fixed, and the file keeps its other fixes. It writes each set of fixes as soon as the check passes, so a run stopped by Ctrl-C, `SIGTERM` or a timeout keeps every fix it checked and none it did not, says so on stderr and exits nonzero at once, without waiting for the check under way; run it again to finish. A run that takes more than five seconds prints a line to stderr every five seconds, with its phase and round, the fixes applied, pending and refused, the checks of the program so far and in this round, whole or of only the files that report an error, and the size of the check under way, as `vibelang --fix: 4m10s: round 3: 41 fixes applied, 20 pending, 3 refused; 17 checks, 6 this round (2 whole, 4 partial); checking 23 fixes in 9 files for 6s; checking diagnostics for 6s; heap 2048 MiB, goal 4096 MiB, 12 GCs`; stdout holds only the report. The stage distinguishes program construction, diagnostic checking, diagnostic comparison and error-origin analysis. The heap is Go heap allocation, the goal is the garbage collector's next collection target, and the count is collections completed; these are not the process's resident or peak memory. Such a run ends with a line that says what it cost: its time and checks, the largest heap and the memory from the system that its lines saw, the trials it checked only in the files they changed and the files that read those, why it checked the whole program instead, and the time of each stage, most first, as `vibelang --fix: cost: 8m35s; 59 checks (16 whole, 43 partial); peak heap 7944 MiB, 8916 MiB from the system; 14 checks of changed files, 356 files each; whole for added errors 4, other files 2; checking changed files 2m55s (16), checking diagnostics 2m39s (7), finding fixes 1m4s (15)`. A trial checks the files whose text it changes, every file that imports one whose declaration file or exported statements change, the files that reported an error when a changed file exports other names, and the files that declare globals; the other files read nothing the trial changed, as TypeScript's incremental builder assumes, and report the errors they did. A trial checks the whole program when it changes a file that declares globals or is read by one, or a service class's name, key or default value, when a `.vibe` file doesn't find `vibelang-runtime`, when the program reports a global diagnostic, under `--only`, and again in a fresh program when it adds an error, so that a refusal rests on a check of the whole program. `VIBELANG_FIX_CHECKS=whole` checks the whole program for every trial, and `VIBELANG_FIX_CHECKS=verify` checks both ways and says on stderr where the errors differ; the fixes are the same either way. It fixes only what the project reports, so the `vibe.severities` setting and the legacy comments below choose what it touches; `// @vibelang-diagnostics-next-line EK4833:off` keeps one line as written. It rewrites only the project's own files: a workspace dependency's `.vibe` source that the project imports through its package keeps its text, and the compilation still reports its diagnostics. A second run finds nothing to fix. `vibelang --build --fix tsconfig.json` repairs each referenced project's own sources and eligible configs once, in dependency order, before building. `--watch` cannot be combined with `--fix`. An inferred import type from an unchanged native module keeps TypeScript's native ending preferences: importing an unrelated `.vibe` module does not request a `.ts` ending. An import the module's declaration needs stays, in its place, so the declaration doesn't change: `--fix` removes an import only where the declaration comes out the same bytes without it. This holds under every compiler option, because every `.vibe` module has a declaration sidecar.

Prelude cleanup keeps imports used by bare type references, including interface base types, and does not shorten a qualified type such as `FileSystem.FileSystem` to a bare name. A shared module may be checked under several configs: changing `lib` or `types` must not make its fixed types resolve to another config’s ambient declarations.

A service-class fix requires a literal key. A dynamic key stays as written, including its evaluation during class initialization.

Async conversion is not offered for a body containing a JavaScript `try` statement, `using` or `await using`. Rewrite its handlers and cleanup explicitly with Effect before converting; nested functions keep their own completion and disposal rules.

Async conversion is withheld when an `await` evaluates a computed member name or a class’s `extends` expression. Those expressions run in the enclosing function; nested `async` bodies keep their own awaits. This also applies when the definition is inside another `await` operand, such as an object or class passed to `Promise.resolve`. Simplify the definition’s awaited expressions before converting.

Async conversion requires each `await` operand to contain no further `await` from the same function. Simplify code such as `return await await input` before converting; nested functions keep their own `await` expressions.

When a fix removes the last value imported from another module, it keeps a side-effect import in the same position. Removing an unused binding must not remove that module's initialization.

A proposed rewrite includes removal of imports from `effect` and its modules that it makes unused, so `noUnusedLocals` does not prevent an otherwise valid fix.

When a proposed fix adds an error in an unchanged importer, `--fix` follows references in that error to prioritize the edited declarations. It still checks each candidate against the original project's errors before keeping it; ambiguous references use the ordinary grouped search.

The check matches errors one to one by file, code and message, or by file, code and span. A changed message at an existing span and an unchanged message at a different span cannot both reuse one existing error. Spans before or after an edit are compared at their original positions.

Calls such as `JSON.parse(text)` keep their exceptions as defects while an `Effect.gen` body is migrated. The repair uses an explicit `Effect.orDie` boundary, preserving the original error channel and catch behavior.

A trial that adds an error needs only that error to fail, so once a round has found errors, `--fix` looks for a trial's errors in the files that reported them. It keeps no fix until a check of the whole project passes. A fix refused on that evidence names the first error of those files, which may not be the first error it adds across the project.

A round that halves its fixes also writes edits as it goes. Once the round has made 16 checks, then 32, 64 and so on, `--fix` checks the fixes it has kept and the halving's passing fixes in a fresh check of the whole project, and writes them when that check passes, at most four such checks a round. An interrupted run keeps the last verified checkpoint. After 256 isolation checks in one round, `--fix` stops telling the remaining suspects apart. It first keeps those it can verify: it sets aside the fixes in files that report an added error, in the files those import, and in each file with a fix whose text declares something an added error reads, and checks the rest in a fresh check of the whole project, at most three such checks. It refuses the fixes it set aside as a group, each named by the first added error of its file or of a file that imports it, and `the gate stopped telling apart after 256 checks of its round; run vibelang --fix again to try them`. Rerun `vibelang --fix` to retry them: the kept fixes are written, so the next run starts from them.

A refused site is the span of one diagnostic `--fix` declines: its fix would add an error, its fix would edit another refused site, or the run ends with the diagnostic still there and no fix for it. A rewrite after the fixes, such as shortening `Option.Option` to `Option`, never edits a refused site or a diagnostic `--fix` declines: that one edit is dropped and reported as a refused site of its own, and the file keeps its other rewrites. A refused site keeps its bytes, and no edit overlaps it, so a file can hold refused sites and fixes elsewhere. For example, a refused authored `@throws` comment stays intact while an independent `Stream<A>` type is repaired to `Stream.Stream<A>`. `--fix` prints one line per site, with its span in the file as it stood before the run: 1-based line and column (UTF-16 code units, as diagnostics count them), then the byte offsets `[start,end)`:

```text
vibelang --fix: refused site: src/a.vibe:12:3-12:40 [281,318) EK2128: no fix applies: A JavaScript caller can read a plain function*'s return value, so vibelang --fix leaves it; mark the function effect if it is a producer.
```

A site in text that an earlier fix of the same run wrote reads `EK2128 new`, and its span is the original text that fix replaced. Refused sites alone don't change the exit status. If a rewrite changes a refused site anyway, that is a VibeLang bug: `--fix` prints `vibelang --fix: refused site changed: <site>: a vibelang bug; <file> keeps its text from before --fix`, leaves that file as it was, and exits 3.

To audit refusals created by intermediate fix rounds, set `VIBELANG_FIX_AUDIT_DIR` to a local artifact directory:

```sh
VIBELANG_FIX_AUDIT_DIR=.cache/fix-audit vibelang --fix
```

Each invocation that records refused sites creates a private `run-*` directory. Its `refusals.jsonl` records the phase, round, diagnostic code or rewrite label and byte/UTF-16 spans in the source state where each refusal was encountered, alongside its projected original byte span. The `source` field names an immutable SHA-256-named `.source` snapshot in the same directory. Snapshots contain the complete intermediate source; on Unix, directories and files use owner-only permissions. Source text is absent from the metadata and normal compiler output. Keep these artifacts local. Without the environment variable, no audit files are written. An audit write failure makes the command fail instead of silently claiming a complete receipt.


Normalization continues until no accepted fix remains, even when nested edits overlap for more than sixteen rounds. If a rewrite repeats a source state, the command reports non-convergence and writes no files.

A direct `extends` or `implements` entry retains its named type, such as `Effect.Effect<number>`. Effect types inside another base's type arguments can still shorten, as in `Holder<number!!>`.

A helper's return-type quick fix writes imported names in the helper's scope: for a namespace import such as `foreign`, it writes `foreign.Thing`. If the inferred type cannot be written there, the annotation is `infer _`.

When annotating helpers also changes a collected callback result, the fix writes `: infer _` so the return type follows the corrected helpers.

An existing callback error on a factory result does not prevent safe rewrites inside its arguments. For a unique named call, the diagnostic keeps a label such as `Effect.catchTags(…)`; repeated or computed calls retain their source text.

Fixes retain field comments and comments before unwrapped succeed/fail arguments. If a proposed rewrite cannot retain its comments, neither the editor nor --fix applies it.

When `vibe.effectModules` is `false`, `--fix` keeps the explicit Effect imports the program needs. The editor offers those bindings through imports and local declarations.

Before async conversion, await a returned `Promise` or `PromiseLike` explicitly, as in `return await input`. Async functions adopt returned thenables; effect bodies require explicit Promise handling. The refactors therefore require an explicit `await` for those returns, including a union that may contain a Promise. A fresh returned object literal with an explicit noncallable data property `then`, such as `{ then: 7 }`, keeps the conversion available. Promise adoption reads `then` even when its declared result is primitive, so a getter may run or throw. Getters, computed keys, spreads and aliased objects still require an adoption bridge.

A primitive TypeScript type can still hide a boxed runtime value with a `then` method. For returned values that need adoption, conversion finishes the body in an `effect { … }` block before bridging its result through `Effect.tryPromise`. Iterator cleanup therefore completes before a thenable is adopted. The conversion retains source comments, template contents and strict-mode directives, and is unavailable when a local or type-only `Effect` binding would make the bridge invalid.

For bodyless service contracts, `EK0902`'s quick fix and `vibelang --fix` remove class-only modifiers and definite assignment assertions, preserving comments and the written types. Choose a public contract name for a private field.

## Effect language service rules

`@effect/language-service` 0.87.5 has 108 diagnostics and editor features. The table maps rules to VibeLang forms and existing EK diagnostics. Effect functions use `try` to run Effects, and `catch` expressions handle failures. The table also marks features not implemented.

A row's answer says how to write the code in VibeLang. The compiler, language server and `vibelang lint` use the project's resolved `@effect/language-service` plugin and its configured rules. Oxlint has its own configuration; `vibelang lint` accepts compiler options and files only.

Lint leaves build outputs intact, including when `--build --clean` lists the files a compiler clean would remove.

A `module` body is TypeScript, so the rules run on it as on a `.ts` file. `deterministicKeys` derives the expected key from the `.vibe` file that holds the body, the sibling `.ts` file the body would move to: a `Context.Service` named `Port` in `module platform { … }` of `src/a.vibe` keeps `@x/pkg/a/Port`, the key it had in `src/a.ts`, not one built from the body's own file, `@x/pkg/a.vibe.platform/Port`.

EK4801-EK4825 are lint. Each has a default, error, warning, or off, and the historical port codes below remain available through legacy diagnostic comments. Configure assigned imported `EK38xx` codes through `vibe.severities`; core errors cannot be turned off. For example, disabling the JSON lint rule does not suppress `EK0403` for a direct `JSON.parse` call in effect code. A later comment overrides an earlier one; within one comment, a code named on its own overrides `*`. Words after the codes are prose, and punctuation ends a category, so `// @vibelang-diagnostics-next-line EK4804:off: generic error` keeps its reason:

```vibe
// run: try Console.log(discard() catch () => 0)
effect function discard() {
  // @vibelang-diagnostics-next-line EK4804:off
  throw new Error("unused")
}
// Output: 0
```

`// @vibelang-diagnostics EK4818:warning` applies from its line to the end of the file; `*` names every adjustable code. Language diagnostics report in `.vibe` files, configuration diagnostics in config files; a `.ts` file keeps TypeScript's verdict. `vibelang` also runs Effect's own rules, copied from `@effect/tsgo`, on selected `.ts` and `.vibe` inputs, keeping the pinned upstream rule/file eligibility and declaration/library exclusions ([Lint Effect code](../setup/vibelang-cli.md#lint-effect-code)). In a `.vibe` file, a rule this table marks "Not needed" or "Covered" does not run, imported rules report their assigned `EK38xx` codes and rule names, at the configured severity. A rule's severity comes from its code's entry in `vibe.severities`, else the repository's existing Effect language-service configuration, else the rule's default.

Since such a rule does not run, an `@effect-diagnostics-next-line` comment that names it suppresses nothing in a `.vibe` file, and Effect reports `TS377000: @effect-diagnostics directive has no effect`; a file renamed from `.ts` keeps every such comment. `vibelang --fix` rewrites each comment `TS377000` reports. A rule whose code in this table reports on the next line keeps its setting under that code, so `// @effect-diagnostics-next-line overriddenSchemaConstructor:off` above a Schema class's `constructor` becomes `// @vibelang-diagnostics-next-line EK4814:off`. The comment's other rules go, and its explanation stays: `// @effect-diagnostics-next-line effectSucceedWithVoid:off - why` becomes `// why`. A comment left with nothing goes with its line. The report counts these as `TS377000`. A marker inside a string is no comment, so `--fix` leaves it, although Effect's parser reports it too.

In `.vibe` code, `EK4814` warns when a `Schema.Class` subclass overrides its constructor. Decoding invokes the override. Move work that should happen only during explicit construction to a separate factory function.

Native `|>` stages do not count as written `.pipe` chains. Their generated calls provide contextual types; `unnecessaryPipeChain` still reports written nested `.pipe` calls, including those inside a native pipeline.

| Group | Effect's rule or feature | In VibeLang | Example |
| --- | --- | --- | --- |
| Correctness | `anyUnknownInErrorContext` | EK4811, off by default | `throw cause` where `cause: unknown` |
| Correctness | `classSelfMismatch` | Not needed: a `service` has no `Self` parameter | `service Users { find(id: string): User!NotFound }` |
| Correctness | `duplicatePackage` | EK4803, warning | two versions of `effect` in one program |
| Correctness | `effectFnImplicitAny` | Not needed: parameters are TypeScript's, so `strict` reports TS7006 | `effect function load(id) { … }` |
| Correctness | `floatingEffect` | `EK3801`, error on selected inputs | A discarded Effect value or `effect { … }` block; `vibelang --fix` writes `void (expression)` to preserve the deliberate discard |
| Correctness | `genericEffectServices` | Covered: EK3005 | `service Repo<T> { … }` |
| Correctness | `missingEffectContext` | Covered: `EK9202` (interim) at a contract, `EK9211` at a runner | `effect function f(): User!NotFound { return try (try Users).find(id) }` is `EK9202` |
| Correctness | `missingEffectError` | Covered: `EK9201` (interim) | `effect function f(): User!! { return try (try Users).find(id) }` |
| Correctness | `missingLayerContext` | Covered: `EK9202` (interim) and `EK3201` | `provide UsersLive { … }` without the database layer is `EK3201` at the runner |
| Correctness | `missingReturnYieldStar` | Not needed in `.vibe`: `throw` ends the function | `throw new NotFound({ id })` |
| Correctness | `missingStarInYieldEffectGen` | Use `try` in an effect function | `const user = try (try Users).find(id)` |
| Correctness | `nonObjectEffectServiceType` | Effect 3 only, and a `service` declares members | `service Port { value: number }` |
| Correctness | `outdatedApi` | EK4813, error, in place of TS2339, with a quick fix; the same fix on TS2339 in `.ts` files | `Effect.catchAll`; the fix writes `Effect.catch` |
| Correctness | `outdatedEffectCodegen` | Not adopted: no codegen comments | None |
| Correctness | `overriddenSchemaConstructor` | EK4814, warning | `class Person extends Schema.Class<Person>("Person")({ … }) { constructor() { … } }` |
| Anti-pattern | `catchUnfailableEffect` | Covered: `EK9204` (interim), warning. Appendix B assigns the imported rule `EK3818` | `succeed(1) catch (e) => fallback`; a catch expression receives typed failures only |
| Anti-pattern | `effectFnIife` | An effect function call returns an Effect | `(() => load())()` |
| Anti-pattern | `effectGenUsesAdapter` | Effect functions use `try` | None |
| Anti-pattern | `effectInFailure` | EK4815, warning | `throw program`; run it: `try program` |
| Anti-pattern | `effectInVoidSuccess` | `EK3830`, the pinned Effect rule at its configured severity; separate from the inferred-argument warning `EK4802` | An Effect containing another Effect is assigned to an `Effect.Effect<void>` contract |
| Anti-pattern | `globalErrorInEffectCatch` | EK4804, warning | `Effect.try({ try: code, catch: (cause) => new Error(String(cause)) })` |
| Anti-pattern | `globalErrorInEffectFailure` | EK4804, warning | `throw new Error("boom")`; declare `error Boom { }` |
| Anti-pattern | `lazyPromiseInEffectSync` | Use `promise` for a Promise whose rejection is a defect | `try promise(() => load(url))`, with `load` from a `.ts` module |
| Anti-pattern | `leakingRequirements` | EK4809, warning; `@vibelang leakable` exempts a service | `service Users { find(): User!!Db; all(): User[]!!Db }` |
| Anti-pattern | `multipleEffectProvide` | `EK4808`, warning | `provide A { provide B { … } }`; nesting alone does not imply separate layer builds. `Layer.provideMerge(A)(B)` retains both layers when `B` needs `A`; review evaluation and build order before composing manually. There is no automatic merge. |
| Anti-pattern | `returnEffectInGen` | `EK4802`, warning; no automatic execution repair | `return program`; use `return try program` |
| Anti-pattern | `runEffectInsideEffect` | Covered: EK1005 | `Effect.runPromise(load())` inside a function |
| Anti-pattern | `schemaSyncInEffect` | Effect 3 only | None |
| Anti-pattern | `scopeInLayerEffect` | Effect 3 only: Effect 4's `Layer.effect` owns its scope | `Layer.effect(Users, effect { const pool = try open(); … })` |
| Anti-pattern | `strictEffectProvide` | EK4816, off by default | `provide AppLive { … }` or `Effect.provide(program, AppLive)`; includes functions named `main` |
| Anti-pattern | `tryCatchInEffectGen` | Use a `catch` expression | `(try Users).find(id) catch (e) => fallback` |
| Anti-pattern | `unknownInEffectCatch` | `EK4806`, warning; a direct `Effect.orDie` defect bridge or its `\|>` spelling is exempt | `Effect.try({ try: code, catch: (cause) => cause })` without a defect bridge |
| Effect-native | `cryptoRandomUUID` | Covered: `EK4402`, because `crypto` is a banned global | `crypto.randomUUID()` |
| Effect-native | `cryptoRandomUUIDInEffect` | Covered: `EK4402`, because `crypto` is a banned global | `crypto.randomUUID()` |
| Effect-native | `extendsNativeError` | EK4805, warning | `class Boom extends Error {}`; declare `error Boom { }` |
| Effect-native | `globalConsole` | Covered: EK4402 | `console.log(x)` |
| Effect-native | `globalConsoleInEffect` | Covered: EK4402 | `console.log(x)` |
| Effect-native | `globalDate` | Not reported: `Date` is ECMAScript; use `Clock` where a test controls time | `Date.now()` |
| Effect-native | `globalDateInEffect` | Not reported: `Date` is ECMAScript; use `Clock` where a test controls time | `new Date()` |
| Effect-native | `globalFetch` | Covered: EK4402 | `fetch(url)` |
| Effect-native | `globalFetchInEffect` | Covered: EK4402 | `fetch(url)` |
| Effect-native | `globalRandom` | Not reported: `Math` is ECMAScript; use `Random` where a test controls it | `Math.random()` |
| Effect-native | `globalRandomInEffect` | Not reported: `Math` is ECMAScript; use `Random` where a test controls it | `Math.random()` |
| Effect-native | `globalTimers` | Covered: EK4402 | `setTimeout(f, 10)` |
| Effect-native | `globalTimersInEffect` | Covered: EK4402 | `setTimeout(f, 10)` |
| Effect-native | `instanceOfSchema` | `EK4817`, off by default; no automatic test conversion | `value instanceof Person`; choose `Schema.is(Person)(value)` explicitly when schema validation is intended |
| Effect-native | `newPromise` | EK4812, warning | `new Promise((resolve) => …)`; use `callback((resume) => …)` |
| Effect-native | `nodeBuiltinImport` | Covered: EK4402 at a value import of a Node.js module | `readFile(path)` from `node:fs/promises` |
| Effect-native | `preferSchemaOverJson` | EK4818, off by default | `JSON.parse(text)` |
| Effect-native | `processEnv` | Covered: EK4402 | `process.env.PORT`; use `Config` |
| Effect-native | `processEnvInEffect` | Covered: EK4402 | `process.env.PORT` |
| Effect-native | `unsafeEffectTypeAssertion` | `EK4810`, warning; removing the assertion has no automatic fix | `program as Effect.Effect<number>` drops a failure  A type-spelling repair also protects the whole refused assertion; unrelated annotations can still be repaired. |
| Style | `catchAllToMapError` | Not needed: a catch that rethrows is the one form | `catch effect (e) => { throw new Failed({ cause: e }) }` |
| Style | `deterministicKeys` | Not needed: the compiler derives each service key from its package, module, and name | `@acme/app/src/users#Users` |
| Style | `effectDoNotation` | Not needed: `const` statements bind values | `const user = try (try Users).find(id)` |
| Style | `effectFnOpportunity` | Use an effect function | `effect function load(id: string) { … }` |
| Style | `effectMapFlatten` | Not needed: statements | `const a = try f(); return try g(a)` |
| Style | `effectMapVoid` | Not needed: statements | `try f()` on its own line |
| Style | `effectSucceedWithVoid` | Not needed: an effect function that returns nothing | `effect function done() { }` |
| Style | `flatMapToMap` | Not needed: statements | `return try g(try f())` |
| Style | `importFromBarrel` | Not needed: the compiler imports effect's root names and subpath modules | `Option.some(1)` with no import |
| Style | `missedPipeableOpportunity` | Refactor: "Convert to a pipe" | `f(g(h(x)))` becomes `x \|> h(%) \|> g(%) \|> f(%)` |
| Style | `nestedEffectGenYield` | Effect functions use `try` | None |
| Style | `redundantSchemaTagIdentifier` | Not needed: `error` and `schema` declarations take their tag from their name | `error NotFound { id: string }` |
| Style | `schemaStructWithTag` | `EK4821`, off by default; no automatic constructor conversion | `Schema.Struct({ _tag: Schema.Literal("A"), … })` |
| Style | `schemaUnionOfLiterals` | Effect 3 only | None |
| Style | `serviceNotAsClass` | Not needed: `service` declarations | `service Users { … }` |
| Style | `strictBooleanExpressions` | EK4822, off by default | `if (count) { … }` |
| Style | `unnecessaryArrowBlock` | EK4823, off by default, with a quick fix that `--fix` applies when the rule is on | `(x) => { return x + 1 }` |
| Style | `unnecessaryEffectGen` | Effect functions use `try` | None |
| Style | `unnecessaryFailYieldableError` | Not needed: `throw new NotFound({ id })` | `throw new NotFound({ id })` |
| Style | `unnecessaryPipe` | EK4824, off by default, with a quick fix that `--fix` applies when the rule is on | `pipe(x)` |
| Style | `unnecessaryPipeChain` | `EK4825`, off by default, with a quick fix that `--fix` applies when the rule is on | `x.pipe(f).pipe(g)` |
| Hover | Extended Effect type | Covered: a function's hover shows its contract, `A!E!R` | `string!UserNotFound!Users` |
| Hover | `yield*` hover | Use `try` to get the success value | `try load()` returns `User` |
| Hover | Layer service involvement | Hover: a layer lists what it provides, needs, and fails with | Hover on `UsersLive` |
| Completion | `Self` in classes | Not needed: declarations have no `Self` | None |
| Completion | `Effect.gen` snippet | Use an effect function | None |
| Completion | `Effect.fn` span name | Not needed: name a span explicitly | `try withSpan(effect { … }, "checkout")` |
| Completion | Duration strings | Completion: `"2 seconds"` and the other units where a `Duration.Input` goes | `Effect.sleep("1 second")` |
| Completion | Namespace import style | Not needed: effect's root names and subpath modules are in scope | `Option.some(1)` |
| Completion | `Schema.brand` name | Completion: the declared name in `Schema.brand("…")` | `const UserId = Schema.String.pipe(Schema.brand("UserId"))` |
| Completion | Comment directives | `@vibelang-diagnostics` comments, whose codes complete | `// @vibelang-diagnostics-next-line EK4804:off` |
| Refactor | async function to `Effect.gen` | Convert to an effect function | `try tryPromise(() => load(url))` |
| Refactor | async function to `Effect.gen`, with an error per promise | Convert to an effect function with a mapped failure | `try tryPromise({ try: () => load(url), catch: (cause) => new LoadFailed({ cause }) })` |
| Refactor | async function to `Effect.fn` | Use an effect function | As above |
| Refactor | async function to `Effect.fn`, with an error per promise | Convert to an effect function with a mapped failure | As above |
| Refactor | `Effect.gen` to `Effect.fn` | Use an effect function | None |
| Refactor | Function calls to pipe | Refactor: "Convert to a pipe" | `f(g(x))` becomes `x \|> g(%) \|> f(%)` |
| Refactor | Pipe to data-first | Refactor: "Convert the pipe to calls" | `x \|> g(%) \|> f(%)` becomes `f(g(x))` |
| Refactor | Toggle return type signature | Refactor: "Write the inferred contract" and "Remove the contract" | `effect function load(id: string): User!NotFound!Users` |
| Refactor | Remove an unnecessary `Effect.gen` | Use an effect function | None |
| Refactor | Wrap with `Effect.gen` | Use an effect function | None |
| Refactor | Toggle pipe styles | Refactor: "Write pipe(x, …)" and "Write x.pipe(…)" | `x.pipe(f, g)` and `pipe(x, f, g)` |
| Refactor | Structural type to Schema | Refactor: "Convert to a schema declaration" | `interface User { name: string }` becomes `schema User { name: string }` |
| Refactor | `Effect.Service` to `Context.Tag` | Not needed: `service` declarations | None |
| Codegen | `annotate` | Refactor: "Write the inferred contract" | `effect function load(id: string): User!NotFound!Users` |
| Codegen | `typeToSchema` | Refactor: "Convert to a schema declaration" | `schema User { name: string }` |
| Other | Renaming a tagged class renames its tag | Not needed: an `error` declaration's tag is its name, so a rename renames both | `error NotFound { }` renamed to `Missing` |
| Other | Go to definition for `RpcClient` | Not adopted yet: the language server has no definition hook | None |

When enabled, `strictEffectProvide` reports providing a layer in every function, including one named `main`. Compose layers at the application entry point and disable the diagnostic at that site, as for Effect TypeScript.

The `async` conversion keeps returns only when their values are known to be primitive, including primitive-constrained type parameters. It declines `any`, `unknown` and object-valued returns, including records, arrays and callable objects, whose types can hide a `then` method. A `void`-typed call or type parameter can also hide an object, so its return is declined. An `async` return adopts its result even after `await`, so `return await` needs the same primitive-value guarantee. Empty returns and existing explicit `void` expressions already return `undefined` and remain eligible. Convert functions with other result types by hand.

## Debug stack traces

Build with `"sourceMap": true` in `compilerOptions`, then run `node --enable-source-maps dist/main.js`. Source maps translate JavaScript locations to `.vibe` locations. They do not record the logical caller chain.

Generated effect-function bodies preserve the source function name in JavaScript stack frames, including functions with parameters. Parameters still bind when the function is called.

VibeLang adds no spans of its own, so a defect can show only one frame, even with source maps enabled. Wrap work that needs a meaningful operation name in `try withSpan(effect { ... }, "checkout")`. More spans add runtime work.

The Node runner can exit with only `Error: message`. For a debugging run, call your application's exported `main` from a TypeScript entry and print the rejected error's stack:

```ts
// debug.ts
// fragment
import { Effect } from "effect"
import { main } from "./app.vibe"

Effect.runPromise(main()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error)
  throw error
})
```

Include `debug.ts` in the project, compile it with `vibelang`, then run `node --enable-source-maps dist/debug.js`. Export the application Effect from `app.vibe` and call its runner from a separate entry module, so importing `app.vibe` does not start execution. This entry prints the underlying JavaScript stack and rethrows to preserve the failure exit status. Tracing and named spans add logical Effect call context.

## Lint and build integration

Type-check with `vibelang --noEmit`. The compiler owns type and language diagnostics in the terminal, editor, and Vite overlay. The local `vibelang-vite` package supports Vite 7 and 8 and Vitest 5. It runs one whole-project compiler subprocess on the first request and after edits, serves JavaScript and source maps, and invalidates loaded `.vibe` modules and their importers; it does not use `vibelang --api`.

```ts
// TypeScript (.ts)
// vitest.config.ts
import { defineConfig } from "vitest/config"
import vibelang from "vibelang-vite"

export default defineConfig({
  plugins: [vibelang()],
  test: { include: ["src/**/*.test.vibe"] }
})
```

The starter already includes this configuration. `bun run test` checks and compiles source tests without a prior build. See [TestClock](../testing/063-testclock.md) for tests with virtual time.

Lint `.vibe` and `.vibex` files with ESLint through `vibelang/eslint`, the parser the `vibelang` package ships. A parser warning alone does not prevent the tree from being produced. If a file also has a syntax error, the parser reports the first error at its own location. The compiler parses each file, and ESLint gets the tree typescript-eslint gives it for TypeScript: typescript-eslint's rules and plugins such as `eslint-plugin-import`, `eslint-plugin-jsdoc`, and `eslint-plugin-unicorn` apply unchanged. Install `eslint` and `typescript-eslint` 8 beside `vibelang`; the parser uses typescript-eslint's scope analysis.

```js
// eslint.config.js
import tseslint from "typescript-eslint"
import vibelang from "vibelang/eslint"

export default tseslint.config({
  files: ["src/**/*.{vibe,vibex}"],
  extends: [tseslint.configs.recommended],
  languageOptions: { parser: vibelang }
})
```

`.vibex` enables JSX with the same ESTree nodes, ranges and tokens as TypeScript JSX. React rules such as `react/jsx-key` and `react-hooks/rules-of-hooks`, and Solid's `solid/no-destructure`, read JSX directly. Component tags count as references, and comments inside JSX expression containers retain their source positions.

Reports, fixes, and `// eslint-disable-next-line` comments land on the `.vibe` or `.vibex` text. Adjacent type-list openings, such as `F<<T>(x: T) => T>`, are separate `<` tokens; a written left shift remains a single `<<` token. When an `is` pattern captures its subject, the lint tree uses `VibeIsExpression` with `callee` and `arguments` visitor keys. Its matcher retains its lexical scope and its subject is visited once; the generated invocation is not a written call. Rules still visit calls you write in the subject or a guard. Rules that need type information, such as `@typescript-eslint/no-unnecessary-type-assertion`, cannot run on a `.vibe` file, since no TypeScript program loads one: enable them for `.ts` files only and check types with `vibelang --noEmit`. EK4801-EK4825 stay in the compiler and the language server. To see the tree a rule reads, run `vibelang --estree main.vibe < main.vibe`. Pattern bindings keep their assignment child under `VibePatternAssignment`, whose `expression` visitor key lets scope analysis distinguish reads from writes. Compiler-generated constant-true steps do not trigger `no-constant-binary-expression`; constants and comma expressions written in the source still do. Calls with a lifted `do` argument retain the written method and receiver ranges; generated `.bind` wrappers do not appear as source calls. Written call and computed-access newlines still reach `no-unexpected-multiline`. A `for concurrent` loop appears as `VibeForConcurrentStatement` with `iterable`, `concurrency` and `body` visitor keys. Its `body` keeps the item binding's arrow scope; an omitted limit has `null` for `concurrency`. Calls written in its children remain ordinary calls. Generated helper variables stay absent from both scope lists and `getDeclaredVariables` results. Rules such as `prefer-const` still report authored bindings, including names beginning with `$`.

`eslint-plugin-import` reads the exports of each module a file imports with the parser its `import/parsers` setting maps the module's extension to. Without an entry for `.vibe`, it finds no exports in a `.vibe` module, so `import/namespace`, `import/named` and `import/default` report every name a `.ts` file imports from one. Map `.vibe` and `.vibex` to `vibelang/eslint` (`import-x/parsers` for `eslint-plugin-import-x`); the migrate flow's setup adds this entry to each ESLint configuration that loads either plugin:

```js
// eslint.config.js
export default [
  { settings: { "import/parsers": { "vibelang/eslint": [".vibe", ".vibex"] } } },
  // ...
]
```

Find unused files, exports and dependencies in `.vibe` and `.vibex` files with [Knip](https://knip.dev) through `vibelang/knip`, a Knip [compiler](https://knip.dev/features/compilers). It gives Knip each `.vibe` module's imports, re-exports, dynamic imports and exports, JSX component tag references, and the members it reads through a namespace import, from the compiler's ESTree. Knip takes compilers only from a configuration that is code:

```js
// knip.config.js
import vibelang from "vibelang/knip"

export default {
  compilers: { vibe: vibelang, vibex: vibelang },
  // The declaration sidecars vibelang writes beside .vibe files are its output.
  ignore: ["**/*.d.vibe.ts", "**/*.d.vibex.ts"]
}
```

Knip then resolves `./x.vibe`, reports an unused export of a `.vibe` file at its line, and counts `vibelang-runtime`, which every compiled module imports, as used. Namespace reads through brackets, such as `Users["find"]`, retain the same exports as dot access. A computed key that cannot be resolved retains every export of that namespace, as Knip does for TypeScript. The migrate flow writes this configuration, moving the settings of a `knip.json` into a `knip.config.ts`.

An export keeps the JSDoc tags Knip reads, such as `/** @public */`. All names in one variable declaration share its tags, as in TypeScript: `/** @public */ export const first = 1, second = 2` keeps both exports public. The adapter also keeps intervening ordinary comments and their spacing, so a comment after a JSDoc tag affects Knip attachment exactly as it does in TypeScript. A tag after an earlier statement recognizes every JavaScript line terminator, including CR, U+2028 and U+2029. JSDoc on the same line as an earlier statement follows Knip's ordinary TypeScript lookup as well.

Typed lint of `.ts` files needs the types of the `.vibe` and `.vibex` modules they import. typescript-eslint builds its program with the `typescript` it installs, which cannot read a `.vibe` file, so a type from one, imported directly or through a `.ts` barrel, is unresolved there, and type-aware rules report code that `vibelang -p` accepts, such as a non-null assertion the compiler needs. Give typescript-eslint the program `typedProgram` builds instead of `project` or `projectService`:

```js
// eslint.config.js
import tseslint from "typescript-eslint"
import vibelang, { typedProgram } from "vibelang/eslint"

export default tseslint.config(
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { programs: [typedProgram({ project: "tsconfig.json", tsconfigRootDir: import.meta.dirname })] }
    }
  },
  {
    files: ["src/**/*.{vibe,vibex}"],
    extends: [tseslint.configs.recommended],
    languageOptions: { parser: vibelang }
  }
)
```

Without `project`, `typedProgram()` discovers the nearest config starting at `tsconfigRootDir` (the working directory by default). It checks `vibe.config.json`, `tsconfig.json`, then `jsconfig.json` in each directory before searching its parent. An explicit `project` selects that file.

`typedProgram` returns the project's TypeScript program, from the `typescript` the project resolves, in which each `.vibe` module reads as the declaration `vibelang` writes for it. A module of another workspace package compiles with that package's `tsconfig.json`, as the loaders compile it. It runs `vibelang` once per project, the first time the program reads one of its modules, and throws when a project does not compile, since typed lint would then have no types for its modules. Native imports retain their module identity beside unrelated `.ts` and `.tsx` files. Relocated sidecars follow the project's `rootDirs`.

Typed lint tools that discover `tsconfig.json` from each `.ts` file need a project that includes that file. If tests are outside the main project’s `include`, a `test/tsconfig.json` containing `{ "extends": "../tsconfig.test.json" }` can point to the existing test project. Keep its original options and file list, and inherit `allowArbitraryExtensions: true` so imports of `.vibe` read their sidecars. The migration flow prepares named test directories when an existing complete project is unambiguous.

When a typed tool uses project references across source-exporting workspace packages, keep `disableSourceOfProjectReferenceRedirect` absent or `false`. Disabling source redirects can leave a native type behind a TypeScript namespace barrel, such as `AWS.RDS.DBInstance`, as an error type even when a direct subpath import is typed. Source redirects let the tool read `x.d.vibe.ts`. Migration setup updates owned configs and records each change in `wired.declarationRedirects`; external presets stay unchanged and receive a local override.

The TypeScript projection keeps an explicitly marked `effect` lambda as an Effect function, even when its receiving callback type returns `void`. Its written keyword also settles its form when the callback comes from another module.

TypeScript JSDoc type nodes retain the stock lint-tree shapes and source ranges.

Forms whose TypeScript long form would mislead a rule have their own node types, which rules and `no-restricted-syntax` selectors can name:

| Form | ESTree node |
| --- | --- |
| `A!E!R` | `VibeEffectType` with `success`, `failure`, and `requirements` |
| `x \|> f(%)` | `VibePipeExpression` with `left` and `right`; `%` is `TopicReference` |
| `x catch () => fallback`, `x catch (e) => recover(e)` | `VibeCatchExpression` with `expression` and `handler` |
| `provide AppLive, Random.Random = seeded { ... }` | `VibeProvideStatement` with `providers` and `body`; `Random.Random = seeded` is `VibeServiceProvider` |
| `uninterruptible { ... }`, `restore { ... }`, `interruptible { ... }` | `VibeMaskStatement` with `kind` and `body` |

For example, `VibeCatchExpression > Literal.handler[value='']` selects a recovery to an empty string.

Node types for the VIP forms, such as effect functions, `effect { }` blocks, prefix `try`, `try.all` and its siblings, and the `fork` forms, are pending VIP-34's tooling implementation.

Declaration forms keep the TypeScript the checker reads: `error NotFound { id: string }` is a class with those fields, `service` declares a service key, and `schema User { ... }` is a `const User` typed by its fields. The parser leaves the names it writes for the checker, such as a `match`'s temporaries, out of scope analysis, so no rule reports a name the author did not write. A Vite Plus integration and a VibeLang Oxlint configuration are not shipped.

The TypeScript projection retains `effect` on named functions and class methods, including when the written return type names an alias imported from another module. A body that only returns a value still runs as an Effect.

## Debugging in editors

```vibe
// run: try Console.log(try tracedSample())
effect function tracedSample() {
  return try withSpan(sample(), "sample")
}
// Output: sample
```

Add spans where an execution boundary should appear in telemetry. VibeLang adds no spans of its own: name each one with `withSpan`. Effect's `DevTools` layer from `effect/devtools`, with its VS Code extension, shows fibers and logical span stacks across suspensions.

`vibelang` with `sourceMap` enabled, and the Vite plugin, map emitted JavaScript directly to `.vibe` positions. Debuggers that read standard source maps map breakpoints and paused frames to `.vibe`: VS Code's JavaScript debugger, Chrome and Edge DevTools, and JetBrains IDEs. [Source maps](../setup/source-maps.md) lists what works in each tool.

Compiled functions and producers keep their source names. The JavaScript stack shows the active frame above Effect's run loop. Stepping over a pausing `try` can enter the run loop; set a breakpoint on the next source line. Use spans for the logical call chain. When reporting a problem, include the Effect version, inferred contract, and diagnostic.

## Coming from Effect

Library debugging concepts still apply; VibeLang's effect functions, service declarations, and source mapping need language-aware tooling beyond the upstream TypeScript plugin.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/devtools)

## First calls from Effect TypeScript

| Code | Meaning and fix |
| --- | --- |
| EK1015 | Use `try` in an effect function: `const value = try load()`. Producers use `yield` to emit values. |
| `EK2112` | A legacy typed catch clause no longer filters failures. Write `catch effect (e) => match (e) { when NotFound: fallback; default: throw e; }` to recover selected failures and fail again with the rest. An ordinary function-literal handler parameter annotation, such as `catch (e: NotFound) => fallback`, remains a TypeScript annotation. Native catch parameter annotations `any` and `unknown` also retain TypeScript behavior, including destructuring with `any`. |
| TS2709, TS2707, TS2351 (`Message`, `Command`, `new Worker(…)`) | The name is Effect's module, in scope without an import. The note names the module; declare or import your own of that name. For a DOM name Effect takes, such as `Worker`, the note says how to reach the DOM's: `globalThis.Worker` in a `.ts` adapter, or its type aliased in a `.ts` file. Code that `Effect.try` or `Effect.tryPromise` wraps gets the same note. |
| TS2339 (`Number.sum`, `Array.make`) | JavaScript's global wins over Effect's module of that name, so the note names Effect's module and its import under another name: `import { Number as EffectNumber } from "effect"`. A member of Effect's type of a DOM name, such as `w.postMessage` on Effect's `Worker`, gets the DOM's alias instead. |
| TS2304, TS2552 (`Process`, `Locks`) | An experimental service is in scope only as a member of `Experimental`; the note qualifies the access, such as `try (try Experimental.Process.Process).hostname`. A misspelled name never suggests a platform global that EK4402 bans, such as `process`; inside a `.ts` file, it may. |
| TS2304 (`Model`, `Prompt`) | Two of effect's subpath packages have a module of this name, so neither is in scope. The note names both imports; write the one you mean, such as `import { Model } from "effect/schema"`. |

The `sync` and `callback` globals can be stored and renamed, and their arrows may capture surrounding locals. The old `EK4405` is retired, and its input fix is no longer offered. When native call errors trace to an older `typeof sync` or `typeof callback` annotation, the quick fix and `--fix` keep its compatibility signature with `typeof import("vibelang-runtime").sync` or `typeof import("vibelang-runtime").callback`. This type-only migration preserves evaluation and can follow an owned annotation across file imports and factory returns.

`EK4839` also reports direct `Option.match(value, handlers)` calls, including named imports and namespace aliases. Its message names `Option`'s own `match` API. The fix uses native `match`, preserving subject evaluation, handler construction, property reads and the selected callback's order. Effect-valued callbacks keep returning cold programs; an explicit `try` runs the selected callback's result in its arm, as a statement too. A handler written with `Effect.fn(function* …)` is rewritten by `EK1002` first, then the call by `EK4839`, in the same `--fix` run. It refuses comments between the arguments; those calls keep the warning and its refusal note.

The `EK4839` repair keeps literal-typed getters, properties, mutable bindings and computed constants as `Match` calls: their construction-time reads must not move into a lazy arm or a returned function. A literal `const` initialized earlier in the same activation can still convert. Reads across functions, class initializers or imports keep their advisory, because even a literal binding may still be uninitialized.

A `Match` handler's object parameter is destructured only after its original predicate succeeds. Missing optional fields, defaults, rest bindings and getters retain their ordinary parameter behavior; a binding cannot add a presence test to the arm. A handler whose function scope cannot be preserved keeps the advisory without a repair.

The `EK4839` quick fix preserves a Match return-type hint with a checked
annotation on its binding, including destructuring, or a typed local binding
inside a `do` expression. It uses existing written context when available
and does not introduce an `as` assertion.

One `vibelang --fix` invocation repeats its passes until no fix applies. Running it again changes nothing. If the pass limit is reached, it reports the remaining fixes and exits with an error.

`Convert to a pipe` keeps object literals and class expressions parenthesized at the pipe head, so the result remains an expression when used as a statement.

Completion and token navigation accept `service`, `error`, and `schema error` declaration keywords, including declarations with decorators and modifiers.

Signature help accepts positions throughout an `error` declaration, including comments and whitespace before payload fields.

Renaming a service also updates its `Shape` qualifiers, including qualified names and imported aliases.

For an inferred Effect argument such as `expect(awaited())`, `EK4802` offers `expect(try awaited())` when the function's written error and requirement channels accept it. Batch `--fix` applies that direct-argument repair only if checking accepts it. Arrays and callbacks need an explicit repair at the construction site. A returned Effect remains data and has no automatic execution repair.
 The historical `--fix-vip-only` migration keeps its separate run-phase rules.

An ordinary namespace type such as `Names.Shape` follows TypeScript namespace resolution. A missing or out-of-scope qualifier reports a TypeScript diagnostic; a service's `Shape` qualifier keeps its service identity for references and rename.

Native `Context.Service` classes keep TypeScript namespace rules: `Key.Shape` needs a declared namespace, while `Context.Service.Shape<typeof Key>` extracts the implementation without one. The `EK4831` style warning does not add members to a native class. The native namespace diagnostic offers a binding-safe shape-extractor repair for a genuine service key, also applied by `vibelang --fix`; it leaves an explicit namespace, a shadowing type and type arguments unchanged.

The `EK0406` annotation diagnostic has no automatic comment rewrite. Remove `@throws`, `@exception` or `@rethrows` manually while preserving the documentation.

For `EK0704`, the editor keeps captured variables and comments when it rewrites an extractor as a class and property pattern. It offers a bare class test only for an empty argument list.

The CLI keeps verified checkpoints during a repair. If a completed run restores a refused file, it restores the original modification time as well as the bytes. Running `--fix` again leaves unchanged files untouched.

`EK0501` requires reviewing callers before marking a plain function `effect`.
The CLI leaves its `try` span unchanged, including when another spelling fix could simplify the operand.

`--fix` also applies the editor's equivalent Effect 4 renames for `EK4813`, such as `Effect.catchAll` to `Effect.catch`.

An `EK4813` rename that changes a callback or result contract has no automatic fix.
For `either`, `async` and `withFiberRuntime`, review the diagnostic's migration note and update callers explicitly.

Migration-only fixes also apply the foreign-call defect bridge. A supported private callback parameter or object member can retain an explicit foreign `@throws {unknown}` signature in a type-only `module` body. Calls remain defects through `Effect.orDie(Effect.try(...))`; a synchronous `Effect.map` callback becomes an `Effect.flatMap` callback returning that Effect. Unsupported or declaration-changing shapes retain their diagnostic for an explicit repair.

Selected imported `floatingEffect` checks use the same file eligibility, exclusions, severity and `@effect-diagnostics` directives for `.ts` and `.vibe` inputs. The legacy `EK4801` check does not also run when that imported path is selected, even when the rule is configured `off`.

## Last resort: keep TypeScript file names

Use the compiler, plugins and editor integrations above with `.vibe` and `.vibex` files whenever possible. A project that cannot rename its TypeScript files can consider the experimental [TypeScript shim](../setup/typescript-shim.md) as the final fallback. Stock readers can accept marked files with different meaning; read the shim's limitations first.
