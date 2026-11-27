---
name: vibelang
description: Write, edit or review Vibe / VibeLang (.vibe files), Effect programs in TypeScript syntax. Use for any .vibe file, diff or question about Vibe or VibeLang.
---

# Vibe (VibeLang)

Vibe (`vibelang` on npm) is TypeScript with syntax for Effect: `effect` functions return Effects, `try` runs Effects, and every construct is exact sugar for Effect 4 TypeScript. Plain and `async` functions keep TypeScript semantics. `vibe` (alias `vibelang`, a TypeScript 7 compiler) checks `.vibe` and `.ts` together and emits JS + `.d.ts`; `vibe run <file.vibe>` runs a `.vibe` entrypoint in Node with source maps. No custom quick fixes/codemods ship before 1.0 (TypeScript's built-in code fixes remain available).

## The model

- `effect` goes wherever `async` goes: `effect function load(id: string) { … }`, `effect function (id) { … }`, `effect (id) => …`, and method `effect find(id) { … }`. Plain functions use JS's stack; write deep recursion as `effect` with `try`. Outside a class/object literal, `effect f() { … }` is an error (write `effect function f() { … }`). Calling an Effect function returns its Effect unrun; its return type is an Effect (written or inferred).
- Inside an `effect` function or `effect { }` block, `try e` runs `e` and yields its success value (like `yield*`), propagating failures—even when `e` cannot fail.
- `e catch h` runs `e` and, on failure, calls literal handler `h(err)`:
  - Plain handler returns a success value: `fetchUser(id) catch () => guest`, `fetchUser(id) catch (e) => e._tag`. A `throw` inside a plain handler is a compile error (write `catch effect`).
  - Effect handler runs Effects and re-fails typed with `throw`: `fetchUser(id) catch effect (e) => match (e) { when NotFound: guest; default: throw e; }`.
  - A value, identifier, or `effect { }` block after `catch` is a syntax error. Write `try x` or `x catch h`, never both. Effect code has no `try` statements (`try`/`finally` uses `ensuring` or `onExit`). `catch` binds like `??` (left to right); mixing with `??`, `||`, `&&` needs parens.
- Pass unrun Effects directly to combinators: `try retry(fetchUser(id), policy)`, `try timeout(retry(load(), policy), "1 second")`, or Hack pipe `try (load() |> retry(%, policy) |> timeout(%, "1 second"))`.
- `effect { … }` builds a cold Effect (`Effect.gen`). `do { … }` is a TC39 do-expression running immediately to its block's completion value (`do { 7; {} }` is `7`).
- `async`/`await` are Promises only (`await` in `effect` or on an Effect is an error). Bridge via `try tryPromise(() => load())` and `await runPromise(program)`.
- `throw new NotFound({ id })` in `effect` code fails typed (`Effect.fail`). Synchronous VibeLang code outside effect code never throws: a `throw` in a plain function, method, constructor, accessor, generator, initializer, plain handler or top level is a compile error, as is a throwing call like `JSON.parse(s)` outside a plain `try`/`catch`. Make the function `effect`. When throwing is required, keep it typed in a `module` block inside the `.vibe` file (VIP-40) with `/** @throws {T} */` on every throwing function and import from it (use a `.ts` file only when a tool needs a file path). In `async`, `throw` rejects the Promise. The compiler tracks throws of non-effectful `.ts`/JS calls (`@throws`, shipped annotations, `unknown` by default): call throwing ones in Effect code via `try Effect.try(() => parse(s))`. Plain `try`/`catch` catches all JS exceptions.

  ```vibe
  module check {
    /** @throws {RangeError} */
    export function port(raw: string): number { if (!/^\d+$/.test(raw)) throw new RangeError(raw); return Number(raw) }
  }
  import { port } from check
  export effect function loadPort(raw: string) { return try Effect.try(() => port(raw)) }
  ```

- `A!E!R` equals `Effect.Effect<A, E, R>`. Omitted slots are `never` (not inferred): `User!!` cannot fail and needs no services. Omit the annotation to infer.
- All `Effect` exports (`retry`, `timeout`, `sleep`, `log`, `all`, `race`, `sync`, `promise`, `tryPromise`, `callback`, `scoped`, `acquireRelease`, `ensuring`, `exit`, `runPromise`, …) and root `effect` modules (`Schema`, `Layer`, `Stream`, `Option`, `Console`, `Config`, `Duration`, `Schedule`, …) are globals. Clashing names stay qualified: `Effect.try`, `Effect.catch`, `Effect.match`, `Effect.provide`, `Effect.uninterruptible`, `Effect.interruptible`, and `Effect.Array`/`Effect.String` (require unshadowed implicit `Effect`; with explicit `Effect` import or `vibe.effectModules: false`, import collision modules directly, e.g. `import { Array as Arr } from "effect"`).

## Forms

| Effect TypeScript | VibeLang |
| --- | --- |
| `Effect.gen` / `Effect.fn` | `effect function load(id) { … }` |
| `Effect.gen(function* () { … })` | `effect { … }` |
| `yield* e` | `try e` |
| `Effect.fail(err)` | `throw err` |
| `Effect.catch` / `orElseSucceed` | `e catch (err) => …`, `e catch () => v` |
| `Effect.catch(e, (err) => Effect.gen(…))` | `e catch effect (err) => { … }` |
| `Effect.catchTag(e, "NotFound", …)` | `e catch effect (err) => match (err) { when NotFound: …; default: throw err; }` |
| `Data.TaggedError("E")<{ readonly id: string }>` | `error E { id: string }`, `error Timeout` |
| `Schema.TaggedError<E>()("E", { id: Schema.String })` | `schema error E { id: string }` |
| `Context.Service<Users, {...}>()("app/Users")` | `service Users { find(id: string): User!NotFound }` (optional `static readonly key = "app/Users"`, `static readonly defaultValue = () => ({ … })` for `Context.Reference`) |
| `yield* Users`, then member | `const users = try Users; try users.find(id)` or `try (try Users).find(id)` |
| `Layer.effect` / `Layer.succeed` | `Layer.effect(Users, effect { …; return { … } })`, `Layer.succeed(Users, impl)` |
| `Effect.provide(e, [AppLive, Layer.succeed(Users, u)])` | `provide AppLive, Users = u { try a(); try b() }` (statement in Effect code) |
| `Schema.Struct({ … })` + type | `schema User { id: string; nick?: string; role: "admin" \| "member"; home: Address }` |
| `Schema.Literals([...])` + type | `schema Code = "a" \| "b"` |
| `Data.TaggedEnum` + `Data.taggedEnum` | `data Delivery { Waiting; Sent { tracking: string } }`; `Delivery.Waiting()`, `Delivery.Sent({ tracking })`; generic up to 4 type params (`data Outcome<A, E> { … }`) |
| `Match.value(x)…Match.exhaustive` | `match (x) { when "a": 1; when { _tag: "Sent", let tracking }: tracking; default: 0; }` |
| `Effect.forkChild(w)`, `forkIn`, `forkScoped`, `forkDetach` | `fork w()`, `fork.in(scope) w()`, `fork.scoped w()` (adds `Scope`), `fork.detached w()` |
| `Fiber.join(f)` | `join f` |
| `Effect.all([a, b], { concurrency: "unbounded" })` | `try.all [a(), b()]` (`try all([a(), b()])` is sequential) |
| `Effect.raceAllFirst`, `Effect.raceAll` | `try.race [a(), b()]` (first finish), `try.any [a(), b()]` (first success) |
| `Effect.all([Effect.exit(a()), …], { concurrency: "unbounded" })` | `try.allSettled [a(), b()]`: each result is an `Exit` (incl. defects/interruption); never fails |
| `Effect.forEach(xs, f, { concurrency: 4, discard: true })` | `for concurrent(4) (const x of xs) { try f(x) }` (`for concurrent (…)` is unbounded) |
| `Stream.runForEachWhile(s, …)` | `for try (const x of s) { … }` |
| `Stream.callback` producer | `effect function* ticks() { yield 1; try sleep("1 second"); yield 2 }` |
| `Effect.uninterruptibleMask` / `Effect.interruptible` | `uninterruptible { try a(); restore { try b() } }`, `interruptible { try poll() }` |
| `Effect.scoped` + `acquireRelease` | `try scoped(effect { const r = try acquireRelease(open(), (r) => close(r)); … })` |
| `Effect.ensuring`, `Effect.onExit` | `try ensuring(effect { … }, cleanup)`, `try onExit(effect { … }, (exit) => …)` |
| `Effect.exit(e)` | `match (try exit(load())) { when Exit.Success(let v): v; when Exit.Failure(let cause): …; }` |
| `Effect.sync`, `Effect.promise` | `try sync(() => count * 2)`, `try promise(() => load())` |
| `Effect.try`, `Effect.tryPromise` | `try Effect.try({ try: () => JSON.parse(s), catch: (e) => new Bad({ e }) })`, `try tryPromise({ try: (signal) => sdk.get(id, { signal }), catch: (e) => new Bad({ e }) })` |
| `Effect.withSpan(e, "load")` | `try withSpan(effect { … }, "load")` |
| `NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)))` | `export effect function main() { … }` + top-level `NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))` or `await runPromise(main())` |

## Member readonlyness

- `schema` fields and `service` shape properties are writable unless marked `readonly` (writable `schema` fields map to `Schema.mutableKey`).
- `error`, `schema error`, and `data` variant payload properties are always shallowly `readonly`.

## Rules

1. `try` runs only Effects inside `effect` functions/blocks. Module top level is ordinary JS (top-level `await` works; `try` does not).
2. Platform access uses Effect services (`FileSystem`, `Path`, `HttpClient`, `ChildProcess`) via a platform layer; `.vibe` forbids `node:*` value imports and Node globals (`process`, `Buffer`), including platform calls inside `Effect.try`/`tryPromise` arrows (put those in `.ts`). `Experimental` has two groups: core VIP-33 platform additions (no opt-in) and open-proposal builtins (`Durable`, `Human`, `Eval`, `Scorer`, `Memory`, `Fuzz`, `FuzzSimulation`, `Test`), which require `"vibe": { "experimental": ["builtins"] }` (`EK3013` otherwise). Platform additions: pure `Experimental.Encoding` (`decodeBase64Lenient`) and `Experimental.NetAddress` need no layer; `Experimental.Dns` uses `ExperimentalNodeDns.layer` or `ExperimentalWorkerDns.layer` (Worker TCP requires authoritative answers, and unavailable transport fails typed `Unsupported`); `ExperimentalNodeServices.layer` (`vibelang-runtime/experimental/platform-node`) or `ExperimentalBunServices.layer` (`vibelang-runtime/experimental/platform-bun`) provides `Experimental.Process`, `Experimental.FileSystem`, `Experimental.Crypto`, `Experimental.Stdio`, `Experimental.ChildProcess`, `Experimental.NodeStream`, `Experimental.Request`, `Experimental.Response` and `Experimental.Headers`; `ExperimentalBrowserServices.layer` (`vibelang-runtime/experimental/platform-browser`) provides `Experimental.Crypto`, `Experimental.Request`, `Experimental.Response`, `Experimental.Headers`, `Experimental.Animations`, `Experimental.AudioContext`, `Experimental.BrowserInfo`, `Experimental.Document`, `Experimental.FileReader`, `Experimental.IntersectionObserver`, `Experimental.Locks`, `Experimental.MediaQuery`, `Experimental.MutationObserver`, `Experimental.ResizeObserver` and `Experimental.Window`. `Experimental.Window`'s `current` is `Window & typeof globalThis`, so tests use the injected page (`new page.KeyboardEvent(…)`, `vi.spyOn(page.Element.prototype, …)`); bare `KeyboardEvent`/`Element` is `EK4402`.
3. A `service` is a Context key, not a class: `class X extends Users` (`EK3002`), `new Users()` (`EK3003`), `x instanceof Users` (`EK3004`), `service Repo<T>` (`EK3005`) are errors, and keys are unique (`EK3001`). `Users` is the R type; `Users.Shape` is its implementation shape.
4. `error` is a `Data.TaggedError` class: tag equals name, fields are readonly; body allows methods/getters, not a constructor, an `extends` clause, or `_tag` override. Group errors with unions; `when NotFound:` matches by `_tag` across package copies.
5. `match` is TC39 pattern matching; non-exhaustive `match` over a finite union without `default` is a compile error.
6. `using` keeps TypeScript semantics; Effect resources use `scoped` + `acquireRelease`.
7. In `for concurrent`, `continue` ends one item (`break`/`return` are errors). In `for try`, `continue` skips, `break` stops, `return` is an error. Producers (`effect function*`) may `return` (no value), run up to two items ahead sequentially (unbounded inside `for concurrent`), and supply their own `Scope`.
8. `restore { }` is only valid inside `uninterruptible { }`. `return`/`break`/`continue` in `provide`/`uninterruptible`/`restore`/`interruptible` target the enclosing function or loop.
9. Contextual keywords (`effect`, `error`, `schema`, `data`, `service`, `provide`, `uninterruptible`, `interruptible`) require their name/block on the same line; in effect code/params `fork`/`join` are reserved (operand may wrap). `error`/`schema`/`service`/`data` forbid Unicode escapes (`TS1260`). Export normally: `export effect function load`, `export error NotFound`, `export service Users`, `export schema User`, `export data Shape`. Use `provide` (not retired `with Provider { … }`). No trailing blocks: `f(x) { … }` is `EK1101` (pass `effect { … }` as an argument). Experimental `task`/`workflow` (VIP-55) require `"vibe": { "experimental": ["builtins"] }` (`EK3013` otherwise).
10. Compiler writes `x.d.vibe.ts` beside `x.vibe` (`vibe.sidecarDir` mirrors them; add it to `compilerOptions.rootDirs` for stock TS). Sidecars emit `@throws {never}` on non-effectful VibeLang signatures (`.vibe` cannot write `@throws`/`@rethrows`). Foreign non-effectful functions without `@throws` default to `unknown`. A callable returning an `Effect`, `Stream` or `Layer` is effectful: call it directly, regardless of `@throws`. Its failures belong to its error channel—run it with `try`, since wrapping the factory in `Effect.try` returns the cold program instead.
11. Configure via `vibe.config.json` or `"vibe"` in `tsconfig.json`/`jsconfig.json`. `vibe.severities` sets warning/`EK38xx` lint codes to `"error" | "warning" | "suggestion" | "off"` (`EK3006` invalid entry; `EK3007` unknown/mistyped key; `EK3009` legacy `vibelang.diagnostics`). VibeLang's own warnings keep exit status zero (use `"error"` to fail CI); imported Effect warnings affect exit status and `noEmitOnError` unless `@effect/language-service` sets `ignoreEffectWarningsInTscExitCode`; `vibelang lint` exits zero on warnings alone.
12. Tests use `@effect/vitest`: `it.effect("loads", () => effect { const u = try load("1"); try Effect.try(() => expect(u.name).toBe("Ada")) })`. `it.effect` uses a test clock (`try TestClock.adjust("1 second")`); `it.live` uses real time.

## Linting

`vibelang lint` runs Effect rules when `compilerOptions.plugins` includes `@effect/language-service` (else VibeLang checks only). Oxlint uses ESLint for JS plugins + `node .vibelang/oxlint.mjs --vibe-native` on projected TS (generated-code reports dropped; native pass does not fix). Inspect projection with `vibelang --ts-projection src/app.vibe < src/app.vibe`; `--fix` applies ESLint source fixes.

## Idioms

Paths below are under `https://vibelang.sh/<section/page>`.

- Errors: `error`, `throw`, `x catch () => fallback`, `match` (`error-management/014-expected-errors`, `error-management/016-fallback`, `error-management/017-matching`).
- Services: `service Name: Type { … }` uses the written shape (body allows only `static readonly key` / `defaultValue`); `service class` is `EK0909`, retired `layer` decl is `EK2121` (use `Layer.effect`/`Layer.succeed`); `provide` once at `main` (`requirements-management/025-services`, `requirements-management/027-layers`).
- Retries & timeouts: pass/pipe Effect to `retry`/`timeout` (`error-management/018-retrying`, `error-management/019-timing-out`).
- Concurrency: `try.all`/`try.race`/`try.any`/`try.allSettled` take arrays; objects use `try all({ user: load() }, { concurrency: "unbounded" })`; `fork`/`join`, `for concurrent` (`concurrency/007-basic-concurrency`, `concurrency/047-fibers`).
- Resources: `scoped` + `acquireRelease` (`resource-management/029-introduction`).
- Data: mapped generic collections require unshadowed TS lib bindings (`EK2109`). `schema` declarations, fields of any schema (`Schema.NumberFromString`), and `Schema.Struct` for struct checks and `optionalKey` (`schema/087-basic-usage`). Tagged unions: `data` (`data-types/073-data`).
- Matching: `vibelang-features/116-match-and-is`. Producers: `vibelang-features/112-producers`. Handlers (open proposal): `vibelang-features/111-control-operations-and-handlers`.
- JSX: `.vibex` enables `.tsx` JSX; JSX wins `<` conflicts in expressions (VIP-39).
- Platform & TS edges: `platform/105-introduction`, `platform/platform-globals`, `vibelang-features/114-vibelang-for-effect-users`, `vibelang-features/115-cheat-sheet`, `https://vibelang.sh/vips`.

```vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"

export effect function main() {
  const name = try Config.withDefault(Config.String("NAME"), "stranger")
  const fs = try FileSystem.FileSystem
  const path = try Path.Path
  try scoped(effect {
    const directory = try fs.makeTempDirectoryScoped()
    const file = path.join(directory, "hello.txt")
    try fs.writeFileString(file, `Hello, ${name}!`)
    try Console.log(try fs.readFileString(file))
  })
}

NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))
```

`Config.String` is Effect 4's spelling; `withDefault` handles missing input while preserving validation failures, and `scoped` removes the temp directory on exit.
