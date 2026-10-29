# Converting the docs to the VIP language

This is the working guide for rewriting `docs/user`, the README, SKILL.md, the templates, the examples and the launch materials in the language the VIPs define (`docs/design/vips/`). Nothing is in the language unless an accepted VIP adds it; the old language is not a source. Where this guide and a VIP disagree, the VIP wins: fix this guide.

## The model in five lines

1. `effect` goes exactly where `async` goes (VIP-39): `effect function name() { … }`, `effect function (x) { … }`, `effect (x) => …`, and a method `effect m() { … }` in a class or object literal each declare an Effect function. A function with no modifier is plain. Calling an Effect function returns its Effect **unrun**, as calling an `async` function returns a Promise (VIP-1).
2. Inside an `effect` function or an `effect { }` block, `try e` runs the Effect `e` and gives its success value; a failure propagates. `e catch y` runs `e` and, on a failure, gives `y` or `y(error)` (VIP-5). You write `try x` or `x catch y`, never both.
3. A call never runs anything by itself, so a program is passed as the Effect value: `try retry(fetchUser(id), policy)`. `effect { … }` builds an Effect from statements (VIP-2).
4. Plain functions and `async` functions mean exactly what they mean in TypeScript. `await` is only for Promises, only in `async` functions (VIP-5). A Promise in Effect code is wrapped: `try tryPromise((signal) => fetchJson(url, signal))`, with `fetchJson` in a `.ts` module, since a platform call inside the wrapper is still a platform call (VIP-33).
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
| `p catch v`, `p catch (e) => f(e)` | the same, where `p` is an Effect value: `fetchUser(id) catch guest`. The handler's syntax decides what it may do (VIP-5, amended 2026-10-29): a value or a plain `(e) => v` gives a value, and a `throw` inside a plain arrow is a defect; `catch effect (e) => …` runs Effects with `try` and fails again with `throw`; `catch effect { … }` runs a fallback Effect |
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
| inline `module text { … }` | a `.ts` file beside the `.vibe` file, imported normally (VIP-25) |
| `wire(UsersLive, DbLive)` | `UsersLive.pipe(Layer.provide(DbLive))` (VIP-24) |
| `service Users { find(…): …; static readonly default = … }` | `service Users { static readonly defaultValue = () => ({ … }); … }` (VIP-9) |
| `service Prefix: string`, `service Search: SearchApi` | not a VIP form: `service Search { query(q: string): string }` with the members written out, or Effect's own `Context.Service` or `Context.Reference` class, written exactly as in Effect TypeScript |
| `import { Console } from "effect"` | delete (VIP-14) |
| `A!E` on a function with a body, R inferred | write all three slots, or leave the annotation out so the whole type is inferred (VIP-3) |
| `control`, `handle`, `resume`, `abandon` | open (VIP-35): not documented as a feature |
| `vibelang.manifest.json` | open (VIP-36): not documented |

## Checking snippets while the compiler catches up

The compiler doesn't implement the VIP forms yet. Every converted `vibe` block gets a header line naming the VIPs it needs, right after any filename line:

```vibe
// pending: VIP-1, VIP-5
effect function load(id: string) {
  return try fetchUser(id)
}
```

`check-snippets` reports such a block as `pending` instead of compiling it, and `--pending-list` writes every pending block with its VIPs, which is the list to flip when the compiler lands each VIP. Keep `// run:` and `// Output:` lines: they run once the block is no longer pending. Effect TypeScript (`ts effect`) blocks stay compiled.

## Cases the VIPs don't decide

Don't decide language. Write the case with Effect's existing functions, which VIP-6 makes globals and so add no language, mark the block `// pending-decision: <topic>`, and report the case to smithers-f2, who takes it to Will. Settled so far:

- Effect code has no `try` statements of any kind (VIP-5), so cleanup is `try ensuring(work, cleanup)` or `onExit`.
- `try.all` and its siblings take arrays only (VIP-18), so an object is `try all({ … }, { concurrency: "unbounded" })`.
- A `catch` handler that runs Effects or fails again is an effect function: `x catch effect (e) => …` or `x catch effect { … }` (VIP-5, amended 2026-10-29). A `throw` in a plain `(e) =>` handler is a defect.
- No throw expressions: write `catch effect (e) => { throw x }` or an `if` statement.
- TC39 object patterns bind with `let`: `when { _tag: "Sent", let tracking }:`. A bare name only tests that the property exists.
- `provide`, `uninterruptible`, `restore` and `interruptible` blocks are ordinary blocks: `return`, `break` and `continue` inside them reach the enclosing function or loop (VIP-12, VIP-22 amendments).
- An element of a `for try` loop that needs an Effect resource opens it with `try scoped(effect { … })` in the body (VIP-8).
- `Date` and `Math.random()` are ECMAScript, so VIP-33 allows them. Prefer `try Clock.currentTimeMillis` and `try Random.next` where a test must control them.
- ESTree node shapes for the new forms are tooling detail: `pending: VIP-34`.

- An `error` declaration always extends `Data.TaggedError`: `error X extends Y` is a compile error, and related errors are grouped with a union type, `type LookupError = NotFound | Timeout` (VIP-13 amendment).
- `catch` has the precedence of `??` and associates to the left; mixing it with `??`, `||` or `&&` needs parentheses (VIP-5 amendment).

A case still open goes in a `// pending-decision: <topic>` line in the block's header. `check-snippets` holds such a block out as it does a pending one and lists its topic.

## Prose

- Explain the new model directly. Don't mention the old language, by-name passing, hatches, `trusted`, inline modules, block params, `wire`, the magic `main` or `await.all`, except on the release-notes page, which is history and is not converted.
- A section about a removed feature becomes its replacement, as the table gives it, or goes.
- Keep Effect's own vocabulary: `yield*` in Effect TypeScript is `try` in VibeLang.
- EK codes: keep a code wherever the error it names still exists under the VIPs, such as EK4605 for `break` in `for concurrent` (VIP-19), and drop the codes of removed features. Every code the compiler reports needs a reference in the user docs.
- Style: Google developer-doc prose, active voice, no em-dash asides, no semicolon chains. Match each page's existing structure.
