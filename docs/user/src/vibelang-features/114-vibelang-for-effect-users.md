# VibeLang for Effect users

Keep Effect's runtime, libraries, layers, and error channels; in `.vibe` files, write sequential work as effect functions and statements. The [cheat sheet](115-cheat-sheet.md) shows every change beside its Effect code, and the [specification](../../../design/src/000-intro.md) gives the rules behind each.

An `effect` function or producer expression cannot name itself `fork` or `join` (`EK1702`). A declaration uses its enclosing context: `export effect function fork() { return 1 }` is allowed in plain code, while a declaration named `fork` or `join` inside effect code is rejected. Method and property names remain ordinary names, so `{ effect join() { return 1 } }` is allowed.

```vibe
// run: try Console.log(try main())
effect function greet(name: string) {
  try sleep("10 millis")
  const message = `Hello, ${name}`
  try Console.log(message)
  return message
}

effect function main() {
  return try retry(greet("Ada"), Schedule.recurs(2))
}
// Output: Hello, Ada
// Output: Hello, Ada
```

Calling `greet("Ada")` returns an Effect. `try greet("Ada")` runs it and returns its string. Pass that Effect directly to `retry`, `timeout`, or another Effect function. Use `effect { ... }` to build an Effect from several statements. Plain and `async` functions keep their TypeScript meaning. `await` waits for Promises in `async` functions. Awaiting an Effect reports `EK0103`, including in an `async function*` with a written `AsyncGenerator`, `AsyncIterator`, `AsyncIterableIterator` or `AsyncIterable` return type. Write `await runPromise(program)` to execute it. If the unrun Effect is the intended value, `vibelang --fix` keeps the native `await` and its result type without executing the Effect. Generic inference for an implementation built inside `Effect.gen` also preserves the requirements inferred by TypeScript 5.9.3: binding a function that pipes a union of Effects to a local `const` retains the same requirements as writing it directly in the returned object.

A direct `try` call whose return type is `any` contributes `unknown` error and requirement channels, just like storing that result and trying the value. Parenthesized calls, method calls and calls selected by a conditional preserve the same channels. Give a dynamic call a precise `Effect.Effect<A, E, R>` return type when those channels are known.

An ordinary call keeps its TypeScript meaning when its receiver has a capitalized name. A local object, class, function or parameter such as `Box` does not become a service key because of its spelling; a parameter also shadows an outer service with the same name. The TypeScript view used by editors follows the resolved lexical binding.

A plain function's written return type checks the whole value it returns. For `function make(value: string): { type: "dataUrl"; value: string }!unknown { return Effect.succeed({ type: "dataUrl", value }) }`, the return expression is typed by the full `Effect`, preserving `"dataUrl"` as a literal, as in TypeScript. An `effect` function's body instead returns the `Effect`'s success value.

`noImplicitReturns` checks that success value, including when the return type is inferred. An `effect` function whose branches only use bare `return` or fall through succeeds with `undefined`; it needs no value-returning statement. A branch that returns a value while another falls through still reports `TS7030`, as its `Effect.gen` counterpart does.

Choose one function kind: `effect` returns an Effect and `async` returns a Promise. Combining them in either order, including on arrows, methods and blocks, reports `EK0105`. The editor can remove either modifier from a function; for a block it removes `async` and keeps `effect { ... }`. `vibelang --fix` removes `effect` from functions to preserve the native `Promise` API previously emitted for accepted mixed declarations and methods; for blocks it removes `async`.

A generic plain function also keeps TypeScript's inference. In `expect(awaited(p))`, where `awaited` returns an Effect and `expect<T>(value: T)` accepts any value, `T` is the Effect type. The call receives the cold program. To assert on its success, first write `const value = try awaited(p)`, then `try Effect.try(() => expect(value).toBe(expected))`, since an assertion can throw. Passing the Effect directly remains useful when the assertion inspects the program itself. In effect code, an inferred Effect argument to a plain generic parameter reports the advisory `EK4802` warning. Ignoring that warning or configuring it off keeps the program cold; a project-wide error policy requires an explicit preserving repair.

An optional call can return `undefined`, which is not an Effect (`EK0502`). Keep the optional call's normal TypeScript evaluation, then guard its result before `try`:

```vibe
effect function maybeLoad(load?: () => string!!) {
  const program = load?.()
  return program === undefined ? undefined : try program
}
```

`try make()` explicitly delegates the call's result even when `make` has type `any`. The compiler no longer describes that result as an unrun Effect. Give the callable an Effect return type to check its success, error, and service channels. An unwrapped tail call through `any` can report both `EK0403` for its unknown synchronous throws and the compatibility warning `EK4409` for its unchecked result; changing the enclosing success type to `unknown` or `object` does not establish a callable contract.

With `strictNullChecks` enabled, `try load?.()` and `try program` where `program` may be `undefined` report `EK0502`. Narrow the callable or operand first, or provide an Effect fallback. Optional syntax on a proven-present callable stays allowed, as does an Effect whose success value is `undefined`. The operand check follows the project's TypeScript nullability settings.

For unchecked operands such as `any`, `try load?.()` delegates the optional call's actual result. If the call is absent, `undefined` produces a native `TypeError` defect. To make absence succeed, write `try (load?.() ?? Effect.succeed(undefined))`. Native optional chaining still skips its arguments and retains method receivers.

Plain code may discard a runner's result: `function run(): void { Effect.runSyncExit(Effect.succeed(1)) }` runs the Effect and discards its `Exit`, just as in TypeScript. The same applies to plain callbacks, `async` functions and module statements. Discarding a constructed Effect value does not run it; use explicit execution when that is intended.

A plain `for...of` also keeps TypeScript's lexical scopes. A closure made in its iterable expression captures an uninitialized `let` or `const` head binding, even with destructuring. Calling that closure during or after the loop throws `ReferenceError`; initializing the separate per-iteration bindings does not initialize the captured cell. An assignment head keeps its outer shared binding instead. In `.vibe`, write an explicit outer `let` and an assignment head when migrating a shared `var` cell; `var` itself belongs in a `.ts` or `.js` file (VIP-1).

In a flat array declaration such as `const [x = do { return 9 }] = values`, the default runs only for `undefined`. Its `return`, `break`, or `continue` reaches the enclosing function or loop and skips the remaining bindings. An unfinished iterator closes before the jump; an error from closing replaces a jump, while an exception already in flight wins over a closing error. A `match` around the `do` keeps the same behavior. In Effect code, JavaScript exceptions remain defects with the same closing precedence. An Effect failure abandons a suspended pattern without calling its iterator's `return`; normal jumps close before enclosing `Scope` finalizers. Compiler-generated cleanup does not count as a source `try`/`catch`: a plain function still needs its own catching `try` around a call known to throw.

A recognized `effect` modifier on an `abstract` declaration, in an ambient `declare` context, or on an `interface` or type literal member is `EK0108`. Run `vibelang --fix` to remove only the modifier from the erased signature, retaining its return type and comments, or put the implementation in an ordinary function or method. Nonambient overload signatures may still use `effect`. A method named `effect`, such as `interface Ordinary { effect(): number }`, keeps its ordinary TypeScript meaning.

A service contract such as `service S { effect read(): number!! }` reports `EK0902`. Declare `read(): number!!` and put its `effect` implementation in a layer. The modifier-removal fix keeps the signature’s return type and comments.

Migration setup preserves the authored `rewriteRelativeImportExtensions` option, including its default when absent and values inherited through `extends`. It adds no local override in referenced projects or newly wired packages.

When migrating an exported Effect value, keep it as a value: `export const stocked = effect { return try available("TEA") }`. A function such as `export effect function stocked()` exports a callable API and requires consumers to add a call. Compare the emitted declarations to keep the original export type and lazy behavior.

If migration cannot read a module's imports, its error includes the native parser diagnostic and compiler exit status. A failed compiler invocation never supplies import edges.

A variable annotation does not change a written execution site. If `makeJob()` returns an `Effect` that succeeds with another `Effect`, `const job: Effect.Effect<number> = try makeJob()` runs the outer `Effect` at the binding site and stores the inner one. Without `try`, initialization stores the returned cold `Effect`.

## Call VibeLang from TypeScript

Compile both files with `vibelang`, rather than ordinary `tsc`. In a `.ts` source, import the relative `.vibe` path **with its extension**:

```vibe
// t5.vibe
export effect function clampAll(values: ReadonlyArray<number>) {
  return try forEach(values, (value) => succeed(Math.min(10, Math.max(0, value))))
}
```

```ts
// use.ts
import { Effect } from "effect"
import { clampAll } from "./t5.vibe"

console.log(JSON.stringify(Effect.runSync(clampAll([-2, 4, 15]))))
// Output: [0,4,10]
```

To TypeScript, `clampAll(...)` returns an `Effect.Effect<number[], never, never>`. Run that program at the application boundary: `Effect.runSync` works when execution stays synchronous; `await Effect.runPromise(clampAll(...))` also supports asynchronous work. Import runners from `effect` as above, or `runSync` / `runPromise` from `vibelang-runtime`. Supply any required services with `Effect.provide` before running. A plain function, such as `function addOne(n: number): number`, returns its value directly and takes no runner. Inside an effect function, run `clampAll(...)` with `try`; call a plain function directly; see [Running Effects](../getting-started/009-running-effects.md).

For `src/t5.vibe` and `src/use.ts`, keep these settings in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "rewriteRelativeImportExtensions": true
  },
  "include": ["src/**/*.vibe", "src/**/*.ts"]
}
```

Keep the starter's other compiler options. `include` must cover a standalone `.ts` entry point: a `.ts` file imported by an included file is already part of the project, but an unreferenced `src/use.ts` is otherwise neither built nor typechecked. The current starter includes both `.vibe` and `.ts` files under `src/`. `rewriteRelativeImportExtensions` rewrites `"./t5.vibe"` to `"./t5.js"` in emitted JavaScript. Build, then run the emitted caller:

```sh
bun run build
node dist/use.js
```

Node runs the JavaScript output; importing the `.vibe` source directly with Node does not compile it.

### Services and errors from TypeScript

A service is Effect's own `Context.Service` class, so TypeScript sees the same two types. `Users` is the service's identifier, which carries its key, so a structural object can't stand for it. `Users.Shape`, which TypeScript spells `Context.Service.Shape<typeof Users>`, is the members. Implement a service in TypeScript with `implements Context.Service.Shape<typeof Users>`, provide it with `Layer.succeed(Users, impl)`, and read it with `yield* Users`. An `error` class is the class `Data.TaggedError` declares, and `Effect.catchTag` catches it by its tag.

```vibe
// users.vibe
export error NotFound { id: string }
export service Users { find(id: string): string!NotFound; readonly region: string }
```

```ts
// live.ts
import { Context, Effect, Layer } from "effect"
import { NotFound, Users } from "./users.vibe"

class UsersImpl implements Context.Service.Shape<typeof Users> {
  readonly region = "eu"
  find(id: string): Effect.Effect<string, NotFound> {
    return id === "1" ? Effect.succeed("Ada") : Effect.fail(new NotFound({ id }))
  }
}

const program = Effect.gen(function* () {
  const users = yield* Users
  return yield* users.find("2").pipe(Effect.catchTag("NotFound", (e) => Effect.succeed(`no user ${e.id}`)))
})

console.log(Effect.runSync(program.pipe(Effect.provide(Layer.succeed(Users, new UsersImpl())))))
// Output: no user 2
```

The emitted declarations are the ones the Effect TypeScript writes, so a library migrated to VibeLang keeps its `.d.ts`: a service declares `class Users extends Context.Service<Users, { … }>()(key)`, a schema `const User = Schema.Struct(…)` and `type User = typeof User.Type`, and an `error` the `Data.TaggedError` class. For an existing shape, `service Name: Type { … }` passes `Type` directly to Effect, preserving its name and modifiers without a shape helper; its body admits only `key` and `defaultValue`. A migrated service keeps its key with `static readonly key = "app/Users"` in its body. Ordinary interface and object-type properties keep their written `readonly` modifiers in declarations: `value: number` stays writable, and `readonly value: number` stays readonly. This also applies to optional properties, index signatures and nested object types; class fields keep their written modifiers too. An inferred library type keeps its library qualifier even beside a local declaration with the same name: a decoder from `Schema.decodeUnknownSync` uses `import("effect/SchemaAST").ParseOptions` when the module exports its own `SchemaAST`. Declarations are written beside the source as `x.d.vibe.ts`, and package builds also write ordinary `.d.ts` files. The migration flow keeps generated `module` companions private under package wildcard exports, including `publishConfig.exports`; reverting the migration removes only the export exclusions it generated. A TypeScript `module parse { … }` body also writes `x.vibe.parse.d.ts` beside `x.vibe`, preserving its exported types and JSDoc, including `@throws`, for stock TypeScript consumers of the sidecar (VIP-40). A native `module` body inside `.vibex` follows TSX, including JSX parsing, checking and formatting. With `jsx: preserve` it emits `x.vibex.parse.jsx`; other JSX modes emit `x.vibex.parse.js`. Its public and compatibility declarations use `x.vibex.parse.d.ts`. Re-exported arrow functions retain their parameter and return types too: a call returning `string` cannot initialize a `number` in a TypeScript consumer.

A library’s composite consumers also read its TypeScript `module` body declarations from the configured declaration output. A type re-exported from a body retains its inherited members across that project reference.


For non-effectful foreign calls, `@throws {never}` permits a direct call. Other written bounds require `try Effect.try(() => call())` (`EK0403`), including through aliases and the selected overload. A callable returning an `Effect`, `Stream` or `Layer` is effectful: call it directly, regardless of `@throws`. Run an Effect result with `try`; bridging its factory with `Effect.try` returns the cold program instead of its success value. For calls that previously converted listed exception classes into typed failures, `vibelang --fix` writes an explicit bridge that preserves those failures and leaves other exceptions as defects.

When upgrading existing `.vibe` modules from the former readonly defaults, run `vibelang --fix --fix-migration-only` to make unmarked schema fields and service shape properties explicitly `readonly` and preserve legacy nested service types. Error and data fields remain shallow readonly properties, while the upgrade writes the old nested payload modifiers explicitly to retain published declarations. Ordinary classes, interfaces and object types retain their written modifiers.

### Keep a throwing helper in a TypeScript body

A named `module` body at file scope uses ordinary TypeScript, including native `throw`. Import its members with the module name:

```vibe
module pem {
  export function b(message: string): string { throw new Error(message) }
}
import { b } from pem
export { b }
```

The name is an identifier specifier in the containing VibeLang file. When moving the body to a sibling TypeScript file, import that file with a string specifier. Ordinary TypeScript namespaces remain available inside the body.

## Translate the idioms

| In Effect TypeScript | In VibeLang |
| --- | --- |
| `Effect.gen(function* () { ... })` | `effect { ... }`, or an `effect` function with statements |
| `class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}` | `error NotFound { id: string }` |
| `const User = Schema.Struct({ id: Schema.String })` and `type User = typeof User.Type` | `schema User { readonly id: string }` |
| `const Role = Schema.Literals(["admin", "member"])` and `type Role = typeof Role.Type` | `schema Role = "admin" \| "member"` |
| `interface Cart { readonly id: string; items: Array<Item> }` | The same interface: `readonly` has its TypeScript meaning |
| `const x = yield* work()` | `const x = try work()` |
| `pipe(x, Effect.map(f), Effect.flatMap(g))` | `const value = try x; const result = try g(f(value))` |
| `Option.getOrElse(Option.map(maybe, f), () => 0)` | `Option.getOrElse(Option.map(maybe, f), () => 0)` |
| `pipe(stream, Stream.filter(p), Stream.take(3))` | `pipe(stream, Stream.filter(p), Stream.take(3))` |
| `work().pipe(Effect.retry(policy), Effect.timeout("1 second"))` | `try timeout(retry(work(), policy), "1 second")` |
| `Context.Service` | `service Users { find(id: string): User!NotFound }`; look up `const users = try Users`, then run `try users.find(id)` |
| `const users = yield* Users`; `users.region` | `const users = try Users`; `users.region` reads a value member. See [service value members](../requirements-management/025-services.md). |
| `Layer.effect(Users, Effect.gen(function* () { ... }))` | `Layer.effect(Users, effect { setup; return { effect find(id) { ... } } })` |
| `Effect.provide(program, AppLive)` | `provide AppLive { try program }` |
| `Effect.provideService(program, Random.Random, seeded)` | `provide Random.Random = seeded { try program }` |
| `Effect.catchTag(program, "Missing", recover)` | `program catch effect (e) => match (e) { when Missing: try recover(e); default: throw e; }` |
| `Effect.catch(program, (e) => recover(e))` | `program catch effect (e) => try recover(e)` |
| `Effect.orElseSucceed(program, () => value)` | `program catch () => value` |
| `Effect.result(program)` (Effect 3: `Effect.either(program)`) | `try result(program)` captures one program's typed failure as a `Result`; match `Result.Success(let value)` or `Result.Failure(let error)`. |
| `Effect.exit(program)` | `try exit(program)` captures its full outcome; match `Exit.Success(let value)` or `Exit.Failure(let cause)`. |
| `Effect.ensuring(program, cleanup)` | `try ensuring(program, cleanup)` |
| `Effect.scoped` with `Effect.acquireRelease` | `try scoped(effect { const r = try acquireRelease(open(), close); ... })` releases the resource exactly once ([Releasing JavaScript Disposables](../resource-management/030-scope.md#releasing-javascript-disposables)) |
| `Effect.forkScoped(program)` | `fork.scoped program` for a child owned by the current Scope |
| `Fiber.join(fiber)` | `join fiber`; for several, use `try all([Fiber.join(a), Fiber.join(b)])` |
| `Effect.all([a, b], { concurrency: "unbounded" })` | `try.all [a, b]`, like `Promise.all`; `try all({ x: a, y: b }, { concurrency: "unbounded" })` keeps the keys |
| `Effect.all(effects.map(Effect.exit), { concurrency: "unbounded" })` | `try.allSettled effects`, with an `Exit` for each success, failure, defect, or interruption |
| `Effect.raceAllFirst([a, b])` | `try.race [a, b]`, like `Promise.race`: the first to finish wins |
| `Effect.raceAll([a, b])` | `try.any [a, b]`, like `Promise.any`: the first success wins |
| `Effect.forEach(items, f, { concurrency: 8, discard: true })` | `for concurrent(8) (const item of items) { try f(item) }` |
| `Effect.sync(() => render())` | `try sync(() => render())` |
| `Effect.try({ try: () => parse(text), catch: (e) => new BadInput({ e }) })` | `try Effect.try({ try: () => parse(text), catch: (e) => new BadInput({ e }) })` |
| `Effect.tryPromise({ try: (signal) => fetchJson(url, signal), catch: (e) => new BadFetch({ e }) })` | `try tryPromise({ try: (signal) => fetchJson(url, signal), catch: (e) => new BadFetch({ e }) })` |
| `Effect.promise(() => load())` | `try promise(() => load())` |
| `Effect.callback((resume) => …resume(Effect.succeed(x))…)` | `try callback((resume) => …resume(succeed(x))…)` |
| `Effect.runPromise(program)` in TypeScript | `runPromise(program)` in a plain or `async` function, or at the module top level |
| `Stream.fromIterable` or a generator-based source | `Stream.fromIterable` or a producer: `effect function*` with `yield value` |
| `Effect.forkChild(program)` | `fork program` |
| `Effect.forkIn(program, scope)` | `try forkIn(program, scope)` |
| `Effect.forkDetach(program)` | `fork.detached program` |
| `Stream.runForEachWhile` | `for try (const value of stream) { ... }` |

A direct `Option.match` call can migrate to `match` even when a handler is a constructor such as `Effect.succeed`. The repair captures the subject and handlers in their original order, keeps the callback type instantiated by the original call, and returns the selected Effect without running it unless the source used `try`.

When `vibelang --fix` rewrites a returned catch pipeline or a catch stage followed by another stage, it captures the original program before wrapping the catch in an `effect` block. Constructing the pipeline still evaluates its input once; executing the returned Effect runs its body, and running it again repeats that body.

`sync`, `callback` and `never` can be stored and passed as values: `const evaluate = sync`, `const register = callback`, `const waiting = never`. These bindings are `Effect.sync`, `Effect.callback` and `Effect.never`, with their native types. Older annotations, including factory return types, that require the compatibility helper's signature migrate with `vibelang --fix` to a qualified runtime import type; the underlying value and calls stay unchanged. Their arrows capture surrounding locals; an aliased `callback` resumes with an Effect, as in `register<number>((resume) => resume(Effect.succeed(value)))`.

`try.allSettled` captures every element's full outcome as an `Exit`, including defects and interruption, and the whole never fails.

`try result(program)` captures typed failures only. Defects and interruption propagate. `try exit(program)` instead captures the full cause in `Exit.Failure`, including defects and interruption.

Use Effect's operators for retries, timeouts, concurrency, and Stream transformations. Statements replace operators that only sequence ordinary work.

An `effect` function or producer expression reserves `fork` and `join` in its own name (`EK1702`), like an `async` expression reserves `await`. Top-level declarations and method names keep their ordinary names. `vibelang --fix` preserves a reserved expression name and its self-references through a local constant in a plain arrow; see [Fibers](../concurrency/047-fibers.md).

## Port code with --fix

When a `.pipe(...)` has custom stages, `--fix` preserves the construction order before applying them. It uses local captures where needed, so stage factories still run at the original call site and the returned Effect stays cold. An Effect stage whose arguments are functions, literals or constants, such as `Effect.mapError((error) => ...)`, is applied in place with the topic first rather than captured, so its callback keeps the program's types. Options with accessors or opaque values keep the data-last `retry`, `repeat` or `withSpan` call, preserving when options are read. The pinned platform runners `NodeRuntime.runMain`, `BunRuntime.runMain` and `BrowserRuntime.runMain`, including their options forms and imported aliases, can be repaired because they do not observe the stage receiver. A custom stage that may observe the receiver supplied by `.pipe(...)` keeps its library form. `Effect.sync(() => { ... })` with a block keeps its form: an `effect` block of the same statements would be built with `Effect.gen`, while `Effect.sync(() => value)` becomes `effect { return value }`, which is built with `Effect.sync`. A stream stage named `run…`, such as `Stream.runForEach(f)` or `Stream.runDrain`, builds an Effect without running anything, so it takes the topic first like other library stages: `rows.pipe(Stream.runForEach(f), Effect.forkIn(scope))` becomes `rows |> Stream.runForEach(%, f) |> Effect.forkIn(%, scope)`, and `f`'s parameter keeps the stream's element type. A runner such as `Effect.runPromise` runs the program it receives, so a pipeline through one keeps its captures.

Captured repairs keep a preceding semicolon-free statement separate, and preserve unbraced conditional and loop bodies.

Captures at the start of a larger expression also preserve the statement boundary, including `satisfies` and `as`, property or element access, and arithmetic or conditional expressions. Enclosing arguments and parentheses retain their original structure.

For a legacy `fork(program, options)` call inside `effect` code, `--fix` writes `try Effect.forkChild(program, options)`. This preserves the options and evaluates both arguments on the caller before starting the child.

Effect declarations and combinator calls ported from TypeScript compile in a `.vibe` file, with warnings `EK4830`–`EK4837` where VibeLang has its own form. A plain `function*` keeps JavaScript generator semantics, including when passed to `Effect.gen`. Run `npx vibelang -p tsconfig.json --fix --noEmit` to rewrite supported forms whose VibeLang form keeps what the program does. Forms without a preserving repair stay unchanged; read any remaining diagnostics before continuing. See [TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code).

For an `Effect.fn` callback that is not an inline generator, ordinary `--fix` retains the callback and reports a refused site explaining that a manual rewrite must preserve when it constructs its returned program. This includes direct and named `Effect.fn` calls; supported generator callbacks in the same file still convert. Each wrapper application reports one site, including when its returned function is called immediately. The migration-only scopes exclude this teaching report.

Written generator return annotations, such as `Effect.fn.Return`, keep their checked `Effect` result contract when `--fix` converts `Effect.gen`. The converted program stays cold and retains contextual literal types. A direct `Generator` annotation already selects a native JavaScript generator and stays native.

Legacy `: infer _` annotations in plain callbacks checked as TypeScript by `Effect.try`, `Effect.tryPromise`, `sync` or `callback` can report `TS1338`. `--fix` removes a simple whole-return marker and keeps TypeScript's inferred result, including inside a converted generator. Conditional `infer` types keep their meaning; an async or generator return contract, a named inference parameter, or an annotation containing comments is left for a manual edit.

`--fix` also preserves a named `Effect.fn` generator's generic requirement contract. When `withSpan` would otherwise infer `Exclude<R, ParentSpan>`, the converted function retains the original final `Effect` return type, including any pipeline stages. A written generator contract still belongs to the cold inner program.

A bare `return` in an `Effect.fn` generator must satisfy its written `Effect.fn.Return<A>` success type. If it does not, `--fix` leaves the generator unchanged and reports the incompatible return; `void`, `undefined` and success types that include `undefined` remain eligible for conversion.

For `Effect.fn` generators with a written `Effect.fn.Return<A, E, R>` annotation and later pipeline stages, `--fix` keeps that annotation on the cold inner program. The stages keep their order and may change the final success or error type without changing the generator's return contract.

When converting an Effect generator, `--fix` preserves a native constructor hidden by an implicit Effect namespace: `new Headers(input)` becomes `new globalThis.Headers(input)`. Local and imported constructors keep their bindings. This qualification does not permit host APIs in VibeLang: a banned constructor still reports `EK4402` and belongs in a TypeScript adapter. If a local `globalThis` prevents safe qualification, the generator stays unchanged.

When migrating a generator, `const inner = yield* make()` becomes `const inner = try make()` even when the result is another Effect. That inner program stays cold until a separate `try inner` runs it. A discarded program result becomes `void try make()`.

Async conversion withholds a `Promise` bridge when an awaited `do` expression would move a `return`, `break` or `continue` away from its source target. Move the outward control flow before the `await` first. Local jumps inside the operand and nested callable returns remain eligible. The same conversion is withheld for an explicit `throw` that would move from the `async` body into a plain `Effect.tryPromise` callback. Throws in a nested `async` or `effect` callable keep their own context.

## Calls return Effects; programs stay cold

```vibe
// run: { const jsonValue = [try sequential(), try concurrent()]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function sequential() {
  const first = try greet("Ada")
  const second = try greet("Grace")
  return [first, second]
}

effect function concurrent() {
  return try.all [greet("Ada"), greet("Grace")]
}
// Output: Hello, Ada
// Output: Hello, Grace
// Output: Hello, Ada
// Output: Hello, Grace
// Output: [["Hello, Ada","Hello, Grace"],["Hello, Ada","Hello, Grace"]]
```

An effect function call constructs an Effect. `try` runs it at that point. `try.all` runs the supplied Effects concurrently. An `effect { ... }` block constructs an Effect and reruns its statements each time that Effect runs. A producer call constructs a Stream. See [Producers](112-producers.md).

An effect arrow or block keeps its enclosing `this`, `super` and `new.target`.
Building the Effect does not read these bindings. You can build a block in a
derived constructor before `super()` and run it afterward. Running it before
`super()` dies with a `ReferenceError` only if execution reaches a `this` or
`super` read; a skipped read checks nothing.
Field and default-parameter arrows also keep TypeScript's inferred `name`,
including private and computed fields; lazy captures preserve that naming context.

`try` in an object literal's computed method or accessor name uses the surrounding `effect` activation. The member's body keeps its own context, and a parameter default remains plain JavaScript. Computed keys evaluate in source order, including conversion to a property key.

## Preserve a factory's call-time work

When TypeScript captures configuration before returning an Effect, keep that phase in a plain function with a declared Effect return and return an Effect value:

```vibe
export const capture = (input: { value: number }): Effect.Effect<number, never, never> => {
  const snapshot = input.value
  return effect { return snapshot }
}
```

A TypeScript caller can build `capture(input)`, mutate `input`, then run the program, and still get the snapshot. The outer body runs synchronously at the call and can compute or copy plain data; every path returns a program. **Where TypeScript returned Effect.fail(e), write return effect { throw e }**; a plain `throw` in the outer function is a compile error (EK0401), because a function that returns an Effect can't throw. Put Effects and service lookups inside the returned program.

A forwarding member keeps its delegate's call phase with `const program: Effect.Effect<number, never, never> = base.read(path); return program`. A const with a declared Effect type holds its initializer in any scope: `const built: Made = make(config)` calls the factory now and runs none of the result. Capture values at the same phase as the TypeScript implementation; keep reads intended for execution inside the returned program.

A synchronous visitor that must return a program keeps its callback type unchanged: return `effect { ... }` from the callback, then run the returned program from effectful code. A discarded `items.map(item => save(item))` still needs `Effect.forEach` or a loop.

An Effect-returning function passed or stored as data follows TypeScript's assignability rules, including generic constraints, arrays, unions and `Function` destinations. A `() => void` callback type can ignore the returned program; it does not run it. A destination requiring a number still reports TypeScript's return-type incompatibility. The function's written modifier determines its kind; the destination does not convert it.

`retry(make(config), policy)` calls the factory once and retries its returned Effect. Use `retry(suspend(() => make(config)), policy)` to call the factory on each attempt; `const p: Made = make(config); try retry(p, policy)` calls it once and retries that program.

## Declare at the module top level

```vibe
// start.vibe
export effect function main() {
  try Console.log("started")
}
await runPromise(main())
// Output: started
```

An exported `const main` or `let main` is an ordinary lexical binding. It keeps its temporal dead zone: a read before initialization throws `ReferenceError`. The compiler reports no entry warning for it, and `--fix` and editor quick fixes keep its declaration kind. Call a runner explicitly to run an Effect.

The module top level is ordinary JavaScript. Construct Effects there and run them with an explicit runner. Top-level `await` accepts a Promise. A TypeScript `namespace` body is synchronous, so `await` there reports `TS1308`; use an `async` function inside the namespace and await its Promise at the module top level. `try` execution belongs inside an effect function or block.

Every export of Effect's `Effect` module is global unless its name clashes with a keyword or JavaScript global. These are the native functions and values: `forkIn(program, scope)` keeps Effect's argument order. Setting `vibe.effectGlobals` to `false` removes every implicit Effect function, including `sync` and `callback`; explicit imports and local declarations keep their ordinary meanings. Clashing names keep the `Effect.` prefix, such as `Effect.try` and `Effect.provide`. Root modules such as `Console`, `Clock`, `Option`, `Schedule`, and `Stream` are in scope. JavaScript globals such as `Array` keep their meaning, and `Effect.Array` names Effect's module only through the unshadowed implicit `Effect`. Platform subpath namespaces such as `HttpClient` are also in scope. Precedence applies separately to TypeScript's type and value meanings: `Console` in a type position remains the DOM interface, while `Console.log` uses Effect's namespace. Local type aliases and interfaces likewise keep their type meaning without hiding Effect's value namespace; a local value binding keeps its own members. Generated imports use fresh names.

`globalThis.eval` and `globalThis.Function`, including static string or template keys and optional access, report `EK0107`. Keep code that evaluates source text in a `.ts` file or a `module` body. `x instanceof globalThis.Function` and `globalThis.Function.prototype` remain valid, as do type queries and a local binding named `globalThis`.

## Keep platform work in Effect

```vibe
// run: const clock = try Clock.Clock; provide Clock.Clock = { ...clock, currentTimeMillis: succeed(123), currentTimeMillisUnsafe: () => 123 } { try Console.log(try reportTime()) }
effect function reportTime() {
  const now = try Clock.currentTimeMillis
  try Console.log(now)
  return now
}
// Output: 123
// Output: 123
```

`console.log`, `fetch`, timers, `process`, and `node:*` imports are errors in `.vibe` (EK4402), and so are the web's clock and randomness reads, such as `crypto.randomUUID()` (EK4402). Effect has a service for each, and the error names it and the layer that provides it. ECMAScript's `Date.now()` and `Math.random()` are allowed; read `try Clock.currentTimeMillis` and `try Random.next` where a test must control them. Use the prelude's `Console`, `Clock`, `sleep`, and `Config`. Look up a platform service with `try`, with no import, then call its members and run their Effects with `try`. Choose the platform layer at the application boundary:

```vibe
// notes.vibe
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

export effect function main() {
  try scoped(effect {
    const fs = try FileSystem.FileSystem
    const path = try Path.Path
    const directory = try fs.makeTempDirectoryScoped()
    const file = path.join(directory, "note.txt")
    try fs.writeFileString(file, "saved")
    try Console.log(try fs.readFileString(file))
  })
}
NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))
// Output: saved
```

`NodeServices.layer` holds `FileSystem`, `Path`, `Stdio`, `Terminal`, and `ChildProcessSpawner`; Bun uses `BunServices.layer`. The crypto services of `effect/crypto`, such as `SecureRandom` and `Digest`, come from `NodeCrypto.layer`. `HttpClient`, from `effect/http`, needs `FetchHttpClient.layer` provided inside `main`. [The platform introduction](../platform/105-introduction.md) lists the service for each common Node.js and web call. Don't wrap a platform API that Effect covers in a `.ts` adapter. Node's globals and the web's I/O globals are not in scope in `.vibe`, and a `.vibe` file does not import a Node.js module as a value (D310); [Platform globals](../platform/platform-globals.md) answers each one. For a Node HTTP server, [Building an HTTP API](113-building-an-http-api.md) uses `ExperimentalNodeHttpServer.layer({ port })`, Effect's existing server layer with its default constructor supplied.

A platform API that Effect lacks, such as `os.hostname()`, is often one of VibeLang's [experimental platform APIs](118-experimental-platform-apis.md): `try (try Experimental.Process.Process).hostname`. Code that needs Node.js globals or `node:*` value imports belongs in a `.ts` file. Prefixing a banned global with `globalThis` does not bypass the restriction: `globalThis.fetch` and `globalThis["setTimeout"]` are also `EK4402`.

A plain function's `for…of` keeps TypeScript's iterator closing behavior. If its body throws and the iterator's `return` also throws, the body error is rethrown unchanged; if a normal `break` or `return` closes the iterator and closing throws, the close error wins. The same precedence applies when nested loops close. An effect function's `for…of` closes its iterator the same way, as a generator in `Effect.gen` does. A `try` that fails or is interrupted, or a `throw`, abandons the generator, so nothing closes the iterator; use `ensuring` or `acquireRelease` for cleanup on every exit.

A plain VibeLang function never throws (a `throw` there is `EK0401`), so an effect function calls it directly, as it does a `.ts` function known not to throw. Wrap a potentially throwing `.ts` call with `Effect.try`, then run it with `try`. The thunk keeps this contract through parentheses, computed access, constant aliases and bound references to `Effect.try` or `Effect.tryPromise`. Their `catch` mappers and functions nested inside a thunk keep their own plain-code checks. Renaming `sync` or `promise` to a local `Effect.try` or `Effect.tryPromise` member does not allow known throwing calls in its thunk. To wait for a Promise, use `Effect.tryPromise` or `Effect.promise`. Callbacks capture local variables normally. Exported VibeLang declarations carry `@throws {never}` on non-effectful functions, methods, constructors and the call, construct and method signatures of interfaces and object types. Callable constants retain their `const` declaration and use a tagged call signature in their type; bare function types retain their written form. The tag joins the signature’s existing JSDoc, preserving its documentation. API identity checks allow the generated `@throws {never}` addition when the TypeScript declaration has no authored throw contract, including in files that contain module augmentations. Authored throw contracts, other documentation and augmentation types must still match. Signatures that return only `Effect`, `Stream` or `Layer`, getters and setters carry no tag. A foreign callable without a signature contract may throw `unknown`, whether imported from source or an emitted `.d.ts` and whether its type is written or inferred. Shipped contracts precede defaults; for synchronous callables, `@rethrows f` adds the actual callback's thrown type to own throws. An `async` function's `throw` rejects its Promise. Effectful callables never add synchronous throws.

The historical empty wrapper `trusted(predicate, [])` is retired with `EK0407`; passing a foreign predicate as its input does not also produce `EK0402`. Its callable type follows TypeScript, including generic predicates and explicitly annotated assertion targets. To keep predicate or assertion narrowing at a native boundary, put the guarded operation in a TypeScript function that returns an Effect, then call it with `try` from effect code. TypeScript requires an explicitly annotated assertion-call target (`TS2775`); an unannotated `const` wrapper cannot narrow in either language.

The plain-code `throw` restriction includes ordinary generator functions and methods (`EK0401`), including one nested in Effect code. An `async function*` body rejects its iteration `Promise` when it throws; an `effect function*` producer uses its typed failure channel.

A synchronous generator body also keeps this check when the generator is passed to `Effect.try`, a callback whose type admits throws, or a Promise executor: creating its iterator does not run its body. Calls known to throw there report `EK0401`; a native `try/catch` inside the generator can handle them. Parameter defaults still run at the original call. `vibelang --fix` can retain a supported call in a local TypeScript invocation helper, preserving lazy iteration and the thrown value.

A generator callback's parameter defaults run at the invoking `@rethrows` call, for both `function*` and `async function*`. Calls known to throw in those defaults contribute to that invocation, so a surrounding native `try/catch` or `Effect.try` can handle them. The generator's body keeps its separate iteration-time check. An ordinary `async function` instead rejects its Promise when a default throws.

Promise-producing native invocations in effect code require an explicit boundary, even when their result is assigned to a variable and never awaited (`EK0404`). This includes constructors, tagged templates and calls whose result is a union containing a Promise or thenable. Use `try Effect.tryPromise(() => load())` to wait for a Promise. To retain the native Promise as unawaited data, `--fix` writes a synchronous `Effect.try` boundary with `Effect.orDie`, preserving the original invocation, evaluation order and synchronous defects. Plain and `async` function bodies retain TypeScript behavior.

A foreign function value keeps its written `@throws` contract when passed as a callback, including imports from `.d.ts` files. An untagged callback type such as `() => void` admits only `never`: passing a foreign function declared `@throws {Error}` reports `EK0402` as an argument, object member, spread member or initializer. Handle the throw in a wrapper or use a callback type whose `@throws` admits it. A foreign function declared `@throws {never}` fits the untagged type. An explicit `@throws {any}` follows TypeScript assignability to a typed thrown contract, while `@throws {unknown}` still requires a contract admitting `unknown`. Neither fits the untagged type.

A `satisfies` constraint checks the same thrown contract, including a callable read from a getter. It preserves the callback's own type, so an incompatible outer argument, initializer or return still reports `EK0402` even when the `satisfies` constraint admits the throw. For a simple reference checked against an inline function type, `vibelang --fix` keeps the structural constraint in a local type-only `module` with a compatible thrown contract. This keeps the original callable and inferred public type; constraints with comments, named constraints and incompatible outer destinations need an explicit compatible callback type or a wrapper that handles the exception.

Generic instantiation substitutes within the declaration's existing thrown contract; it does not erase it when the result becomes an Effect. A rethrowing synchronous callable's default callback contributes to its conservative own bound even when a safe callback is supplied, so declaration output cannot lose that default's throws.

A final tuple spread retains each optional callback's written thrown contract when that callback can be present. This includes readonly tuples and optional callback slots after fixed prefixes. An empty tuple supplies no callback, and a supplied nonthrowing callback remains valid. A known throwing callback still needs its exception bridge in Effect code (`EK0403`), or a native `try/catch` in plain code (`EK0401`).

Named tuple labels inside an `effect` function, arrow or method are type-only names, as in TypeScript. They do not count as writes to an enclosing parameter; actual writes retain the parameter binding created when the function was called.

## Trace and debug calls

Run emitted JavaScript with `node --enable-source-maps dist/main.js` and enable `"sourceMap": true` in `compilerOptions`. Source maps preserve `.vibe` locations. VibeLang adds no spans of its own, so defects can show only one stack frame.

Use `try withSpan(effect { ... }, "checkout")` for a named operation, as you would use `Effect.withSpan` in TypeScript. Named spans supply the logical caller context that source maps alone cannot add, and add runtime work. If the default Node runner prints only an error message, use the [TypeScript debugging entry](../getting-started/012-devtools.md#debug-stack-traces) to print the rejected error's `stack`.

## Runtime cost

VibeLang forms compile to their Effect equivalents. They preserve the same `Exit` and finalizer order.

These are single-machine observations from the 0.0.9 alpha review on Linux x64, Node 26 and Effect 4.1.1. They are not a performance guarantee. The benchmark timed sequential loops with `Clock.currentTimeMillis`, with 200,000 calls for the success-only comparison and 1,000,000 for recovery and plain functions. The step increments a number and fails every 250,000th value; recovery resets it to zero. The success-only loop ends before that failure.

| Loop | Observed time |
| --- | ---: |
| 200,000 Effect-contracted VibeLang calls without `catch` | 550 to 610 ms, about 2.9 µs per call |
| 200,000 `Effect.fn` generator calls | 860 to 1,200 ms |
| 1,000,000 `step(n) catch () => 0` expressions | 3.0 to 3.8 s |
| 1,000,000 `Effect.succeed`/`Effect.fail` steps with `Effect.orElseSucceed` | About 0.33 s |
| 1,000,000 plain-function calls | About 3 ms |

Effect-contracted calls were in the same order of cost as `Effect.fn` generators. The `catch` loop cost more than the hand-written `Effect.orElseSucceed` loop. A plain function, `double(n: number): number`, adds no Effect wrapper, and a plain function is called directly from Effect code. Measure your own workload, including tracing, before choosing a boundary for a hot loop.

## Catch expected failures only

```vibe
// run: { const jsonValue = [try displayName("ada"), try displayName("missing")]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
error Missing { id: string }

effect function lookup(id: string) {
  if (id !== "ada") throw new Missing({ id })
  return { id, name: "Ada" }
}

effect function displayName(id: string) {
  return effect {
    return (try lookup(id)).name
  } catch (error) => match (error) {
    when Missing: `Unknown user: ${error.id}`;
  }
}
// Output: ["Ada","Unknown user: missing"]
```

Inside an Effect function, `throw` adds an expected failure to the function's error channel, and `catch` receives it. Defects and interruption bypass `catch`; `ensuring` and `onExit` still run cleanup. `try orDie(work())` promotes an expected failure to a defect; to inspect defects, use Effect's cause APIs at a boundary.

`A!E!R` means exactly `Effect.Effect<A, E, R>`. Every omitted slot is `never`, including on a function with a body. Leave out the whole annotation to infer success, errors, and requirements. A line break ends the type: each `!` and its slot stay on one line, `A!!` may end a line, and a slot in parentheses may span lines; a `!` with no slot on its line is `TS17019`.

The transitional bare `Effect<A, E, R>` alias reports `EK4856`. Its migration fix uses `A!E!R` only when the existing position and channels need no new parentheses; otherwise it retains the position and writes `Effect.Effect<A, E, R>`. Existing parentheses, explicit default slots and comments are preserved. It retains the qualified spelling when shorthand would change declaration bytes, including existing grouping that declaration output would otherwise remove. Local and imported types named `Effect` keep their meaning. `EK4833` then writes the grouped shorthand, such as `(number | string)!!`, because the added parentheses leave declaration bytes unchanged; a full `vibelang --fix` run ends there. Where `EK4833` cannot keep source-written parentheses or comments, its note says which, and the qualified spelling stays.

See [Control operations and handlers](111-control-operations-and-handlers.md) for the proposal's status.

An inferred return declaration preserves a written assertion such as `value as ReturnType<typeof create>` and the import that names `create`. This also applies to a migrated helper that still writes `: infer _`. It needs no public return annotation to retain that spelling.

Inferred parameter types of retained SDK error constructors keep their Effect namespace spelling in declarations. For example, exporting `AsyncFiberError` writes its inferred fiber parameter as `Fiber.Fiber<unknown, unknown>` with an import from `effect`, independently of nearby matching code. Explicit import types and local or generic `Fiber` bindings retain their written scope.

Returning an Effect, an Effect subtype, a union or a program function keeps it as data and does not itself report `EK4802`. To execute a returned Effect, write `return try program`. Native `Effect.gen` return advice belongs to the imported `effecttsgo/returnEffectInGen` rule (`EK38103`).

A generic assertion such as `expect(awaited(p))` in effect code reports `EK4802` when `awaited(p)` returns an Effect: the assertion would receive the unrun program. Write `expect(try awaited(p))` to inspect its result; `--fix` applies this direct-argument repair when its failure and requirement contract fits. To inspect the program object intentionally, write `expect<Effect.Effect<number>>(e)`. Generic arrays, Promises and callback contracts also report the warning; run their Effects where those values are constructed.

The pre-VIP-1 migration repairs a legacy `fork(program, options)` even when an
earlier pass already marked its function `effect`: it writes
`try Effect.forkChild(program, options)`. A single-operand `fork program`
keeps its operator form.

When migrating pre-VIP-1 code with `vibelang --fix --fix-vip-only`, a call
passed to an unconstrained generic parameter keeps its old run phase. For
example, `expect(awaited(p))` becomes `expect(try awaited(p))` in effect code:
`expect<T>(actual: T, message?: string)` does not ask for an Effect. A parameter
declared as an Effect, including `T extends Effect.Effect<unknown>`, still
receives the unrun program. Explicit type arguments that select an Effect also
keep that program unrun.

Another provided argument can also fix the same generic parameter to an Effect,
including through a record, tuple or callback. That independent context still
keeps the argument as a program, and the migration runs the generic call's
result where the old code ran it.

A plain callback keeps its TypeScript body even when an `effect` function passes it as an argument. A captured `Effect.runSyncWith(context)` runner can be called from that callback, as from an assigned or returned plain function; passing the callback does not add an Effect activation. An explicitly `effect` callback remains Effect code.

A package import or `paths` alias that selects a compatibility sidecar outside `node_modules` uses its available source, including `.vibex` and mirrored `vibe.sidecarDir` declarations. It therefore has the same class and private-member identity as a direct source import. TypeScript's `preserveSymlinks` policy still decides whether the resolved path stays inside `node_modules`.

A value or call result typed `unknown` must be narrowed to an Effect before `try`; it reports `EK0502` otherwise. An Effect may still succeed with an `unknown` value. The explicit escape hatch `any` remains unchecked.

The function `constructor` restriction applies to reading its value. It follows the `Function` type through aliases, intersections, interfaces that extend it and generic constraints. Assigning or deleting the property does not read it, including through parentheses and TypeScript assertions; ordinary TypeScript assignment and `delete` checks still apply.

`var` is rejected everywhere in `.vibe` files, including plain and `async` functions (`EK0107`). An ambient `var` directly in `declare global { }` is allowed, because it emits no code and is the only way to type a property of `globalThis`. Omitting a plain function's return annotation does not exempt its body from this check. Use `let` or `const` with explicit scope and initialization. A function-scoped binding used after a region needs an explicit outer declaration. Check hoisting and module cycles before changing legacy code; keep code that needs JavaScript `var` semantics in a `.ts` file. Where block scoping cannot change what runs, the quick fix and `vibelang --fix` write `let` to preserve inferred binding types, or `const` when every binding has a written type and is never assigned: the declaration sits directly in a block or at module scope outside any loop, it is not exported or redeclared, and every read follows it in the same block, outside nested callables. Captured bindings keep the native-module repair because changing `var` to a lexical binding can strengthen closure narrowing. For a closed file containing only native TypeScript syntax, the editor can keep the complete scope in a `module` body and re-export its exports. This preserves `var` hoisting and direct `eval` scope. Files with imports, module metadata, dependencies on VibeLang globals or VibeLang syntax require a manual migration. An empty `with ({}) {}` scope can be removed; other `with` statements require an explicit property rewrite.

An inferred `effect` arrow or function expression may refer to its own callable value, as in `const same = effect () => same === same`. Such value-only references infer as the corresponding `Effect.gen` wrapper does. A recursive return whose type cannot be inferred still requires a return annotation and reports TypeScript's native inference error.

Optional schema fields, schema-error payload fields and optional tuple elements follow the project's `exactOptionalPropertyTypes`: `?: T` uses `Schema.optionalKey` when enabled and `Schema.optional` by default; `?: T | undefined` keeps `Schema.optional` under both settings. Native `data` payloads retain TypeScript's own optional properties.

`await` in an Effect function, arrow, method or producer parameter default reports `EK0102`, including destructuring defaults and computed binding keys. Parameter initialization runs when the callable is called and is outside effect code, so `try` there remains `EK0501`. Move Promise work into an appropriate callable body; a nested `async` callable keeps its native `await` rules.

A native `Effect.gen(function* () { ... })` with JavaScript `try/catch` keeps that boundary when no equivalent teaching rewrite exists. It remains valid native code and does not create a refused repair site.

Option migration preserves comments and writes the qualified `Option.Option` type. A second `--fix` pass leaves the repaired source unchanged.

The error-per-await editor conversion keeps generated error types at module scope. An exported factory can then expose a converted class, object or function without an unnameable local error type (`TS4058`). The insertion preserves the file header, directive prologue and declaration comments, including attached documentation across blank lines.

Async-to-Effect editor conversions retain containing property contracts. A computed method key, including a numeric, template-literal or union key, still selects its applicable index signatures; the editor withholds conversion when those signatures require a `Promise` result. Indexes inferred from computed members also retain their compatibility checks. A generic computed key keeps these checks through its resolved constraint, including a union constraint. Migrate the method and its contracts together.

