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

Hover over an Effect-returning function to see its inferred `Effect<A, E, R>`.

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

### Move a TypeScript module body to a file

Place the cursor in a top-level `module parse { … }` declaration and request **Move module to a TypeScript file** (VIP-40). The refactor writes the TypeScript body to `parse.ts` beside a `.vibe` source, or to `parse.tsx` beside a `.vibex` source even when the body has no JSX, and rewrites its identifier imports, re-exports and side-effect imports to that file. When the copied body would be a script under the project's options, for example a body with no `import` or `export` under `moduleDetection: "legacy"`, the new file ends with `export {}` so its declarations stay private; otherwise the body is copied unchanged. Other module declarations stay in place. The new file keeps the body's comments, JSDoc, relative imports and runtime behavior.

If `parse.ts` or a conflicting sibling name is taken, compared case-insensitively, the refactor chooses `main.parse.ts` for `main.vibe`, then adds a number if needed. The rewritten specifier ends in `.ts` when `rewriteRelativeImportExtensions` or `allowImportingTsExtensions` is enabled, and `.js` otherwise. The editor applies file creation and source edits together and does not overwrite an existing file. This move is an explicit refactor.

`new f()` on a function declared in a `.vibe` file uses TypeScript's own constructor checks. VibeLang adds no constructor diagnostic, so assertions and `@ts-ignore` keep TypeScript's behavior.

A generated declaration for a `module` body keeps relative imports pointed at their source modules. With `vibe.sidecarDir`, rebuilding does not import a relocated declaration as a second source module. The migrate flow removes a returned source's module-body declarations when it restores the original TypeScript. Project references also retain a body's type exports when reading built declarations, so inherited members stay available to the consuming project.

## Diagnostic reference: additional codes

`EK1502` rejects type parameters on a `schema` body or alias. Write a generic TypeScript factory for parameterized construction.

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

Root `vibelang.diagnostics` and `compilerOptions.vibelang.diagnostics` are legacy maps in any supported config or extended config. Supported settings keep applying until migrated; modern entries for the same diagnostic or its explicitly mapped port win. Each map reports `EK3009`, and hiding that warning leaves its settings active. See [Diagnostic severities](../setup/vibelang-cli.md#diagnostic-severities).

For example, a legacy `EK4406` policy entry cannot appear in `vibe.severities`; remove it before migrating the map. `EK9100` is editor-only and warns by default; it requests a written type for the text-only projection and is not reported by the CLI.

Unknown or retired warning codes cannot be configured. Remove an entry for the retired unused-`main` warning: that warning was retired when `main` became an ordinary function (VIP-26).

`vibe.effectGlobals` defaults to `true`, making every value export of `effect/Effect` a global, such as `retry` and `tryPromise`. Set it to `false` to use `Effect.retry` and other qualified names ([Effect's functions](008-importing-effect.md)).

## TypeScript-style Effect code

VibeLang does not ship its own automatic fixes before 1.0. Edit diagnosed source explicitly; TypeScript's built-in code fixes remain available.

Effect declarations and combinator calls written in TypeScript's style still use the same library APIs in `.vibe`. These diagnostics suggest equivalent VibeLang forms without changing how the original source compiles or runs.

| Code | TypeScript style | VibeLang form |
| --- | --- | --- |
| EK4830 | `class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}` | `error NotFound { id: string }` |
| EK4831 | `class Users extends Context.Service<Users, { find(id: string): Effect.Effect<User> }>()("app/Users") {}` | `service Users { static readonly key = "app/Users"; find(id: string): User!! }` |
| EK4832 | `const User = Schema.Struct({ id: Schema.String })` | `schema User { readonly id: string }` |
| `EK4833` | `Effect.Effect<User \| null, NotFound \| Timeout, Db>` | `(User \| null)!(NotFound \| Timeout)!Db` |
| EK4834 | `return try Effect.succeed(user)`, `try Effect.fail(error)` | `return user`, `throw error` |
| EK4835 | `try Effect.catchTag(find(id), "NotFound", (e) => …)` | `find(id) catch effect (e) => match (e) { when { _tag: "NotFound" }: …; default: throw e; }` |
| `EK4836` | `Effect.withSpan(main(), "main")`, `return try Effect.provide(main(), AppLive)`, `try Effect.provideService(main(), Users, users)` | `withSpan(main(), "main")`, `provide AppLive { return try main() }`; retain the native `Effect.provideService` call |
| EK4837 | `class Failed extends Schema.TaggedError<Failed>()("Failed", { … }) {}` | `schema error Failed { … }` |
| EK4839 | `Match.value(status).pipe(Match.when("idle", () => "Idle"), Match.orElse(() => "Busy"))` | `match (status) { when "idle": "Idle"; default: "Busy"; }` |
| EK4841 | `export const Tags = Schema.Array(Schema.String)` just before `export type Tags = typeof Tags.Type` | `export schema Tags = readonly string[]` |
| EK4842 | `import { Array } from "effect"` and `Array.take(values, 2)` | `import { Array as Arr } from "effect"` and `Arr.take(values, 2)` |

For `EK4834`, `EK4835` and the `provide` calls in `EK4836`, only the direct operand of bare `try` in effect code warns. Parentheses, `as`, `satisfies` and non-null `!` wrappers still count, as do resolved import aliases. Stored or returned Effects, `fork` and `join` operands, collection operands, Effect API arguments and `catch` heads keep their existing diagnostics.

Native error classes with spread fields or a written static `_tag` retain their existing library form and advisory exemptions. Schema constants retain their existing associated-type and declaration-preservation checks. `EK4833` retains its checks on written Effect type arguments, and `EK4856` still warns about the transitional bare `Effect<A, E, R>` alias.

### Effect.gen and Effect.fn

Write an Effect generator in direct style with an `effect` function or block and `try` for each run Effect. Preserve the original evaluation order, coldness and thrown-error policy when changing a program by hand. See [Creating effects](005-creating-effects.md) and [the cheat sheet](../vibelang-features/115-cheat-sheet.md).

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

Since such a rule does not run, an `@effect-diagnostics-next-line` comment that names it suppresses nothing in a `.vibe` file, and Effect reports `TS377000: @effect-diagnostics directive has no effect`; a file renamed from `.ts` keeps every such comment. Rewrite each comment `TS377000` reports. A rule whose code in this table reports on the next line keeps its setting under that code, so `// @effect-diagnostics-next-line overriddenSchemaConstructor:off` above a Schema class's `constructor` becomes `// @vibelang-diagnostics-next-line EK4814:off`. The comment's other rules go, and its explanation stays: `// @effect-diagnostics-next-line effectSucceedWithVoid:off - why` becomes `// why`. A comment left with nothing goes with its line.

In `.vibe` code, `EK4814` warns when a `Schema.Class` subclass overrides its constructor. Decoding invokes the override. Move work that should happen only during explicit construction to a separate factory function.

Native `|>` stages do not count as written `.pipe` chains. Their generated calls provide contextual types; `unnecessaryPipeChain` still reports written nested `.pipe` calls, including those inside a native pipeline.

| Group | Effect's rule or feature | In VibeLang | Example |
| --- | --- | --- | --- |
| Correctness | `anyUnknownInErrorContext` | EK4811, off by default | `throw cause` where `cause: unknown` |
| Correctness | `classSelfMismatch` | Not needed: a `service` has no `Self` parameter | `service Users { find(id: string): User!NotFound }` |
| Correctness | `duplicatePackage` | EK4803, warning | two versions of `effect` in one program |
| Correctness | `effectFnImplicitAny` | Not needed: parameters are TypeScript's, so `strict` reports TS7006 | `effect function load(id) { … }` |
| Correctness | `floatingEffect` | `EK3801`, error on selected inputs, with the `@effect/language-service` plugin; `EK4801`, error, without it | A discarded Effect value or `effect { … }` block; write `void (expression)` to preserve the deliberate discard |
| Correctness | `genericEffectServices` | Covered: EK3005 | `service Repo<T> { … }` |
| Correctness | `missingEffectContext` | Covered: `EK9202` (interim) at a contract, `EK9211` at a runner | `effect function f(): User!NotFound { return try (try Users).find(id) }` is `EK9202` |
| Correctness | `missingEffectError` | Covered: `EK9201` (interim) | `effect function f(): User!! { return try (try Users).find(id) }` |
| Correctness | `missingLayerContext` | Covered: `EK9202` (interim) and `EK3201` | `provide UsersLive { … }` without the database layer is `EK3201` at the runner |
| Correctness | `missingReturnYieldStar` | Not needed in `.vibe`: `throw` ends the function | `throw new NotFound({ id })` |
| Correctness | `missingStarInYieldEffectGen` | Use `try` in an effect function | `const user = try (try Users).find(id)` |
| Correctness | `nonObjectEffectServiceType` | Effect 3 only, and a `service` declares members | `service Port { value: number }` |
| Correctness | `outdatedApi` | EK4813, error, in place of TS2339 | `Effect.catchAll`; use `Effect.catch` |
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
| Style | `unnecessaryArrowBlock` | EK4823, off by default | `(x) => { return x + 1 }` |
| Style | `unnecessaryEffectGen` | Effect functions use `try` | None |
| Style | `unnecessaryFailYieldableError` | Not needed: `throw new NotFound({ id })` | `throw new NotFound({ id })` |
| Style | `unnecessaryPipe` | EK4824, off by default | `pipe(x)` |
| Style | `unnecessaryPipeChain` | `EK4825`, off by default | `x.pipe(f).pipe(g)` |
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

Port source explicitly. Use `effect` functions and blocks for programs, `try` to run an Effect, and `catch` handlers for typed failures. Keep argument evaluation, coldness, error channels and public declarations in mind when replacing library forms.

| Code | Meaning and manual guidance |
| --- | --- |
| `EK1015` | Use `try` in an effect function: `const value = try load()`. Producers use `yield` to emit values. |
| `EK2112` | A legacy typed catch clause no longer filters failures. Write `catch effect (e) => match (e) { when NotFound: fallback; default: throw e; }` to recover selected failures and fail again with the rest. An ordinary function-literal handler parameter annotation, such as `catch (e: NotFound) => fallback`, remains a TypeScript annotation. Native catch parameter annotations `any` and `unknown` also retain TypeScript behavior, including destructuring with `any`. |
| `TS2709`, `TS2707`, `TS2351` (`Message`, `Command`, `new Worker(…)`) | The name is Effect's module, in scope without an import. The note names the module; declare or import your own of that name. For a DOM name Effect takes, such as `Worker`, the note says how to reach the DOM's: `globalThis.Worker` in a `.ts` adapter, or its type aliased in a `.ts` file. Code that `Effect.try` or `Effect.tryPromise` wraps gets the same note. |
| `TS2339` (`Number.sum`, `Array.make`) | JavaScript's global wins over Effect's module of that name, so the note names Effect's module and its import under another name: `import { Number as EffectNumber } from "effect"`. A member of Effect's type of a DOM name, such as `w.postMessage` on Effect's `Worker`, gets the DOM's alias instead. |
| `TS2304`, `TS2552` (`Process`, `Locks`) | An experimental service is in scope only as a member of `Experimental`; the note qualifies the access, such as `try (try Experimental.Process.Process).hostname`. A misspelled name never suggests a platform global that EK4402 bans, such as `process`; inside a `.ts` file, it may. |
| `TS2304` (`Model`, `Prompt`) | Two of effect's subpath packages have a module of this name, so neither is in scope. The note names both imports; write the one you mean, such as `import { Model } from "effect/schema"`. |

An `EK4802` warning describes an Effect passed as data to a plain generic function. If the function should receive its result, run that Effect with `try` at the intended execution site. A returned Effect can remain data.

See [the cheat sheet](../vibelang-features/115-cheat-sheet.md) for each form beside its Effect TypeScript, and [TypeScript-style Effect code](#typescript-style-effect-code) for the retained advisory codes.

## Last resort: keep TypeScript file names

Use the compiler, plugins and editor integrations above with `.vibe` and `.vibex` files whenever possible. A project that cannot rename its TypeScript files can consider the experimental [TypeScript shim](../setup/typescript-shim.md) as the final fallback. Stock readers can accept marked files with different meaning; read the shim's limitations first.
