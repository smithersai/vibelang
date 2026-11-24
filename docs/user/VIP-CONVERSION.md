# Converting the docs to the VIP language

This is the working guide for rewriting `docs/user`, the README, SKILL.md, the templates, the examples and the launch materials in the language the VIPs define (`docs/design/vips/`). Nothing is in the language unless an accepted VIP adds it; the old language is not a source. Where this guide and a VIP disagree, the VIP wins: fix this guide.

## The model in five lines

1. `effect` goes exactly where `async` goes (VIP-39): `effect function name() { … }`, `effect function (x) { … }`, `effect (x) => …`, and a method `effect m() { … }` in a class or object literal each declare an Effect function. A function with no modifier is plain. Calling an Effect function returns its Effect **unrun**, as calling an `async` function returns a Promise (VIP-1).
2. Inside an `effect` function or an `effect { }` block, `try e` runs the Effect `e` and gives its success value; a failure propagates. `e catch h` runs `e` and calls the literal handler `h` on failure (VIP-5). Write `try x` to propagate the failure or `x catch h` to handle it.
3. Pass the unrun Effect returned by the call: `try retry(fetchUser(id), policy)`. `effect { … }` builds an Effect from statements (VIP-2).
4. Plain functions and `async` functions mean exactly what they mean in TypeScript. `await` waits on Promises in `async` functions or at module top level (VIP-5). A Promise in Effect code is wrapped: `try tryPromise((signal) => fetchJson(url, signal))`, with `fetchJson` in a `.ts` module, since a platform call inside the wrapper is still a platform call (VIP-33).
5. Every export of Effect's `Effect` module is a global (`retry`, `sleep`, `log`, `all`, `tryPromise`, `sync`, `scoped`, `exit`, …), and every root module of `effect` is in scope (`Schema`, `Layer`, `Stream`, `Option`, `Console`, …) (VIP-6, VIP-14). Names that clash stay `Effect.x`: `Effect.try`, `Effect.catch`, `Effect.match`, `Effect.provide`, `Effect.uninterruptible`, `Effect.interruptible`, and JavaScript's `Array`, `String`, … (Effect's are `Effect.Array`, …).

## Old form to new form

| Old docs | New (VIP) |
| --- | --- |
| `function load(id) { const u = Users.find(id); … }` with Effects in the body | `effect function load(id) { const users = try Users; const u = try users.find(id); … }` |
| `export function main() { … }` running Effects | `export effect function main() { … }`, and the module calls a runner itself: `NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))` or `await runPromise(main())` (VIP-26). There is no magic `main` and no `import "vibelang/platform/node"`. |
| a statement call `Console.log("x")`, `log("x")`, `sleep("1 second")` | `try Console.log("x")`, `try log("x")`, `try sleep("1 second")` |
| `const user = getUser(id)` (it ran) | `const user = try getUser(id)` |
| `Users.find(id)` (service shorthand), `Users()` | `const users = try Users` then `try users.find(id)`, or `try (try Users).find(id)` (VIP-10) |
| `retry(() => fetchUser(id), policy)`, by-name `retry(fetchUser(id), policy)` | `try retry(fetchUser(id), policy)` |
| `timeout(() => retry(() => p(), s), t)` | `try timeout(retry(p(), s), t)` or `try (p() \|> retry(%, s) \|> timeout(%, t))` (VIP-23: Hack pipe, the topic is the Effect value) |
| `() => { stmts }` passed as a program | `effect { stmts }` |
| `Effect.all([() => a(), () => b()])` | `try all([a(), b()])` (one at a time) or `try.all [a(), b()]` (concurrent) |
| `await.all [a(), b()]`, `await.race`, `await.any`, `await.allSettled` | `try.all [a(), b()]`, `try.race`, `try.any`, `try.allSettled` (VIP-18); an object of Effects: `try all({ a: a(), b: b() }, { concurrency: "unbounded" })` |
| `fork work()` | `const f = fork work()` (owned by the current fiber) |
| `fork { … }`, `Effect.forkScoped(() => p())` | `fork.scoped p()` (VIP-17) |
| `forkIn(scope, () => p())` | `fork.in(scope) p()` |
| `detach(() => p())` | `fork.detached p()` |
| `join f`, `join [a, b]` | `join f`; for several, one `join` each, or `try all([Fiber.join(a), Fiber.join(b)])` |
| `for concurrent(8) (const x of xs) f(x)` | `for concurrent(8) (const x of xs) { try f(x) }` (VIP-19); `break`/`return` inside are errors |
| a producer `function*` with `yield` | `effect function* name() { yield v; try sleep("1 second") }` returns a Stream (VIP-21); a plain `function*` is a JavaScript generator |
| `for (const x of stream)` consuming a Stream | `for try (const x of stream) { … }` (VIP-20) |
| `uninterruptible { … restore { … } }`, `interruptible { … }` | the same blocks, with `try` inside (VIP-22) |
| `provide AppLive { … }`, `provide Key = v { … }` | the same statement, with `try` inside (VIP-12) |
| `Layer.effect(Users) { setup; return { … } }` (trailing block) | `Layer.effect(Users, effect { setup; return { … } })` (VIP-11) |
| `withSpan("n") { … }`, `withSpan(() => …, "n")` | `try withSpan(effect { … }, "n")` |
| `it.effect("n") { … }` | `it.effect("n", () => effect { … })` |
| `throw new NotFound({ id })` in Effect code | the same: it fails the Effect with a typed error (VIP-4) |
| `try { … } catch (e) { return match (e) { … } }` in Effect code | an expression: `effect { … } catch effect (e) => match (e) { when NotFound: …; default: throw e }`, or `call() catch (e) => …` (VIP-5: no try/catch statement in effect code) |
| `try { … } finally { … }`, `finally (exit)` | `try ensuring(effect { … }, cleanup)`, `try onExit(effect { … }, (exit) => …)` |
| `p catch v` | `p catch () => v`. Use `p catch (e) => f(e)` for a value derived from the failure or `p catch effect (e) => …` to run Effects or fail with `throw` (VIP-5). |
| `match (exit(p)) { … }` | `match (try exit(p())) { … }` |
| `when Delivery.Sent { let tracking }:` | `when { _tag: "Sent", let tracking }:` (VIP-16: object patterns on `_tag`) |
| `when NotFound:`, `when Option.Some(let v):`, `if (x is Exit.Failure(let c))` | unchanged: TC39 pattern matching (VIP-7) |
| `using r = Effect.acquireRelease(…)` | `try scoped(effect { const r = try acquireRelease(open(), (r) => close(r)); … })`; `using` keeps only TypeScript's meaning (VIP-8) |
| `sync(() => f())`, `sync(f(), x)` hatches | `try sync(() => f(x))`: the arrow is plain TypeScript and captures locals (VIP-6) |
| `try((t) => JSON.parse(t), (e) => new Bad({ e }), text)` | `try Effect.try({ try: () => JSON.parse(text), catch: (e) => new Bad({ e }) })` |
| `try(async (id, signal) => sdk.get(id, { signal }), mapper, id)` | `try tryPromise({ try: (signal) => sdk.get(id, { signal }), catch: (e) => new Bad({ e }) })` |
| `sync(async () => load())` | `try promise(() => load())` |
| `callback((resume) => …resume(x)…)` | `try callback((resume) => …resume(succeed(x))…)` (Effect's own `callback`) |
| hatch comments, "plain TypeScript inside this hatch" | delete: arrows are plain TypeScript everywhere |
| `trusted(impl, [Errors])`, `trustedPackages` | gone. A function that may throw is wrapped with `Effect.try` before Effect code calls it; libraries say what they throw with `@throws {E}` (VIP-4, VIP-27) |
| inline `module text { … }` | `module text { … }` with `import { name } from text` (VIP-40) |
| `wire(UsersLive, DbLive)` | `Layer.provideMerge(UsersLive, DbLive)` to retain both layers’ outputs (VIP-24) |
| `service Users { find(…): …; static readonly default = … }` | `service Users { static readonly defaultValue = () => ({ … }); … }` (VIP-9) |
| `service Prefix: string`, `service Search: SearchApi` | `service Prefix: string {}` and `service Search: SearchApi {}` use a written shape (VIP-9) |
| `import { Console } from "effect"` | delete (VIP-14) |
| `A!E` on a function with a body, R inferred | write all three slots, or leave the annotation out so the whole type is inferred (VIP-3) |
| `control`, `handle`, `resume`, `abandon` | use Effect functions and services (VIP-35, denied) |
| `vibelang.manifest.json` | use TypeScript declaration output (VIP-27) |

## Checking snippets

Run `bun docs/tools/check-snippets.ts --run` to check VibeLang and Effect TypeScript examples and their recorded output. Use `// fragment` for incomplete excerpts. Use a `// compiler-gap:` header for a known diagnostic disagreement and record the evidence in [Compiler gaps](compiler-gaps.md).

## Cases the VIPs don't decide

Use Effect’s existing functions while a language decision is pending. Record the unresolved question and page in the relevant proposal or issue.

- Effect code has no `try` statements of any kind (VIP-5), so cleanup is `try ensuring(work, cleanup)` or `onExit`.
- `try.all` and its siblings take arrays only (VIP-18), so an object is `try all({ … }, { concurrency: "unbounded" })`.
- A `catch` handler that runs Effects or fails again is an effect function: `x catch effect (e) => …` (VIP-5). A `throw` in a plain `(e) =>` handler reports `EK0401`.
- Throw expressions use the same rules as throw statements (VIP-41).
- TC39 object patterns bind with `let`: `when { _tag: "Sent", let tracking }:`. A bare name only tests that the property exists.
- `provide`, `uninterruptible`, `restore` and `interruptible` blocks are ordinary blocks: `return`, `break` and `continue` inside them reach the enclosing function or loop (VIP-12, VIP-22 amendments).
- An element of a `for try` loop that needs an Effect resource opens it with `try scoped(effect { … })` in the body (VIP-8).
- `Date` and `Math.random()` are ECMAScript, so VIP-33 allows them. Prefer `try Clock.currentTimeMillis` and `try Random.next` where a test must control them.
- An `error` declaration always extends `Data.TaggedError`: `error X extends Y` is a compile error, and related errors are grouped with a union type, `type LookupError = NotFound | Timeout` (VIP-13 amendment).
- `catch` has the precedence of `??` and associates to the left; mixing it with `??`, `||` or `&&` needs parentheses (VIP-5 amendment).

## Prose

- Explain the new model directly. Don't mention the old language, by-name passing, hatches, `trusted`, inline modules, block params, `wire`, the magic `main` or `await.all`, except on the release-notes page, which is history and is not converted.
- A section about a removed feature becomes its replacement, as the table gives it, or goes.
- Keep Effect's own vocabulary: `yield*` in Effect TypeScript is `try` in VibeLang.
- EK codes: keep a code wherever the error it names still exists under the VIPs, such as `EK1903` for `break` leaving a `for concurrent` body (VIP-19), and drop the codes of removed features. Every code the compiler reports needs a reference in the user docs.
- Style: Google developer-doc prose, active voice, no em-dash asides, no semicolon chains. Match each page's existing structure.
