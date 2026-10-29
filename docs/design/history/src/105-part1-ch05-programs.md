### 5. Programs as values: retry, timeout, and pipe

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

#### The one rule

A call runs where it stands. A function does not run until it is called, so `() =>` is how you write a program: work described now and done later.

```ts es
syncInventory(store)                    // runs now
fork syncInventory(store)               // fork's operand is a program: the new fiber runs it

const job = () => syncInventory(store)  // a program: nothing has run
job()                                   // runs it
job()                                   // runs it again, from scratch
```

This is what a TypeScript developer expects from a call: `syncInventory(store)` does its work, and `() => syncInventory(store)` does not. No parameter type or annotation changes that, and the overload a call resolves to is the one TypeScript picks (Chapter 13). An `Effect` value from TypeScript is a program too, and calling it runs it (`Clock.currentTimeMillis()`). A value whose type extends `Effect`, such as a `Config` or an `Exit`, is data until you call it.

Effect's combinators take programs, so pass them a function:

```ts effect
const user = yield* fetchUser(id).pipe(Effect.retry(Schedule.exponential("100 millis")))
const fresh = yield* fetchUser(id).pipe(Effect.timeout("1 second"))
const fastest = yield* Effect.race(fromCache(id), fromNetwork(id))
```

```ts es
const user = retry(() => fetchUser(id), Schedule.exponential("100 millis"))
const fresh = timeout(() => fetchUser(id), "1 second")
const fastest = race(() => fromCache(id), () => fromNetwork(id))   // the first to succeed
```

Each line is a call of an Effect function, so it runs: `user` is a `User`, not an `Effect`. `retry` runs its program again on each attempt, and each attempt evaluates `fetchUser(id)` afresh. Without the arrow, `fetchUser(id)` would run once, before `retry` started, and pass a `User`; that is EK1018, whose quick fix writes the arrow. In the docs and examples, arrows around single calls were 2.6% of the tokens (D320). They buy a call site that says when its work happens.

A program of several statements is `() => { … }`. A block after a call passes one as the call's last argument (D188, D376), which suits a function that takes its program last, such as `it.effect("name") { … }`; Effect's combinators take their program first, so they take the arrow; a block after one fails to type-check, and the error's note gives the arrow form (Chapter 13).

#### Several combinators around one program

```ts effect
const user = yield* fetchUser(id).pipe(
  Effect.retry({ times: 3 }),
  Effect.timeout("2 seconds"),
  Effect.withSpan("load-user")
)
```

```ts es
const attempt = () => fetchUser(id)
const retried = () => retry(attempt, { times: 3 })
const bounded = () => timeout(retried, "2 seconds")
const user = withSpan(bounded, "load-user")
// user: User;  E gains Cause.TimeoutError from Effect.timeout
```

Each arrow is a program, so each combinator receives the one before it: `retry` runs `fetchUser(id)` again on each attempt, `timeout` bounds the retried work, and `withSpan` traces it. Only the last line runs anything. Nested in one expression it reads `withSpan(() => timeout(() => retry(() => fetchUser(id), { times: 3 }), "2 seconds"), "load-user")`. The types flow exactly as in Effect: `Effect.timeout` adds `Cause.TimeoutError` to E, and `Effect.retry` keeps E and R.

Effect's `pipe` function is an ordinary call: `pipe(x, f, g)` is `g(f(x))`, with `x` passed as the value it is (D383). A function literal first stays a function, so `pipe(() => fetchUser(id), retry({ times: 3 }))` does not type-check, since `retry`'s data-last form takes an `Effect`; nest the calls as above. `pipe` suits data-last functions with no data-first form, such as `Match.when`. Its declared return type is a type parameter, so a `pipe` call returns its result without running it, whatever that result is (Chapter 13).

#### The pipe operator

VibeLang has TC39's proposed Hack-style pipe operator (D154): in `x |> f(%, a)`, the topic `%` is the value of `x`. The left side is evaluated once, before the body, as an operand is (D325):

```ts es
const rows = items |> Arr.filter(%, isActive) |> Arr.map(%, toRow)
const total = loadOrder(id) |> sumLines(%.lines) |> addTax(%, region)
```

`items |> Arr.filter(%, isActive) |> Arr.map(%, toRow)` is `Arr.map(Arr.filter(items, isActive), toRow)`. In the second line `loadOrder(id)` runs, `%` is the order it returns, and `sumLines` and `addTax` run with values. A pipe is a sequence of expressions in reading order: each stage is an ordinary expression, and each call in it follows Chapter 13's rules. A stage whose callee is itself a call, `x |> f(args)(%)`, is that call: after `x`, `f(args)` is evaluated, and its result is called with the topic, under rule R like any call (D418). One thing is borrowed from `x.pipe(f(args))`, for types only: `f(args)` is checked with the stage's parameter as its contextual type, so a data-last function such as `Schema.decodeUnknownEffect(Person)` infers its type arguments from `x` (D272). The stage never reads a `pipe` member of `x`.

The topic is never a program, whatever parameter it fills. `fetchUser(id) |> retry(%, policy)` runs `fetchUser(id)` once and passes the user, which is EK1018; write the program as a function: `retry(() => fetchUser(id), policy)`. A pipe's body must use `%` (EK1006). The pipe has its body's type; to keep a pipe as a program, wrap it: `const total = () => loadOrder(id) |> sumLines(%.lines)`.

Most pipes you write today disappear:

| You pipe today | In VibeLang |
| --- | --- |
| `Effect.map`, `Effect.flatMap`, `Effect.andThen`, `Effect.tap` | statements |
| `Effect.catchTag`, `Effect.catch`, `Effect.mapError` | `try`/`catch`, testing the failure with `match` or `is` (D216), or `x catch (e) => …` (D236) |
| `Effect.orElseSucceed`, `Effect.orElse` | `x catch fallback` (D236) |
| `Effect.ensuring` | `finally` |
| `Effect.provide`, `Effect.provideService` | `provide layer { … }` (D172), or the same functions given `() => …` |
| `Effect.retry`, `Effect.timeout`, `Effect.withSpan`, `Effect.cached` | the same functions, given `() => …` |
| `Effect.catchCause`, `Effect.onExit` | `match (exit(…))`, `finally (exit)` (D217, D178) |
| `Effect.failCause` | the same function: `Effect.failCause(cause)` runs where it stands and fails with every reason (D406) |
| `Effect.uninterruptibleMask`, `Effect.interruptible` | `uninterruptible { … restore { … } }`, `interruptible { … }` (D180) |

On a cause that also holds a defect, neither Effect's typed recovery operators nor `try`/`catch` recovers (D305). Chapter 17 lists each operator's behavior. A catch expression recovers as `try`/`catch` does.

In two large Effect codebases, once statements replace sequencing, error handling, and cleanup, only 1.1% (Smithers) and 2.6% (opencode) of Effect pipes outside tests keep two or more stages (`docs/research/pipe-census.md`).

#### Methods on Effect's data types

A value of one of Effect's data types takes its module's functions as methods (D152). `x.name(args)` calls `Module.name(x, args)`:

```ts effect
const alerts = pipe(readings, Stream.filter((c) => c > 25), Stream.map((c) => `${c} C`), Stream.take(3))
const label = Option.getOrElse(Option.map(user.nickname, (n) => n.toUpperCase()), () => "anonymous")
```

```ts es
const alerts = readings.filter((c) => c > 25).map((c) => `${c} C`).take(3)
const label = user.nickname.map((n) => n.toUpperCase()).getOrElse(() => "anonymous")
```

The module is the one that declares the value's type: a `Stream` takes `Stream`'s functions, an `Option` takes `Option`'s. Eighteen modules qualify: `BigDecimal`, `Cause`, `Chunk`, `DateTime`, `Deferred`, `Duration`, `Effect`, `Exit`, `Fiber`, `HashMap`, `HashSet`, `Option`, `Queue`, `Ref`, `Result`, `Schedule`, `Sink`, and `Stream`. Which functions are methods is a table that ships with the compiler, generated from the Effect version the runtime pins (D336). A type's own members come first, so an `Effect`'s `pipe` is its own, and arrays, strings, and objects keep JavaScript's methods: `[1, 2].map(f)` is `Array.prototype.map`. A method that returns an Effect is a call like any other, so it runs where it stands: `fiber.join()` waits for the fiber, and `counter.update((n) => n + 1)` updates the `Ref`. Chapter 13 states the rule.

The compiled JavaScript calls the module's function, `Stream.take(Stream.map(Stream.filter(readings, …), …), 3)`, so a bundler drops the functions a program never calls, as it does for Effect code.

#### Why the topic is a value

D8 kept the operator out of v0 because calls run: in `fetchUser(id) |> Effect.retry(%, policy)`, a topic that held the value would run `fetchUser(id)` once, before `Effect.retry` saw it. D155 answered by passing the left side by name wherever `%` filled a parameter that expects a program, so the parameter's type decided whether the left side ran once or on every attempt. VibeLang no longer has rules of that kind (D320): a TypeScript developer reads `a |> f(%)` as `f(a)`, with `a` evaluated first. So the topic is always the left side's value, and a program is written as one (D325). The proposal is still at Stage 2 with an undecided topic token (`docs/research/tc39-syntax.md` §1); VibeLang uses `%`, the token in the proposal's README, and will follow TC39's choice.

#### Storing, returning, and composing programs

Programs are values: store them in variables, return them, pass them around. Nothing runs until something calls them.

```ts es
function makeSync(store: Store): () => SyncReport!SyncError!Inventory {
  return () => syncInventory(store)            // returns a program
}
// a plain function: (store: Store) => () => SyncReport!SyncError!Inventory

function syncEverything(stores: ReadonlyArray<Store>) {
  const syncAll = stores.map(makeSync)                    // an array of programs; nothing ran
  return all([...syncAll], { concurrency: 4 })     // the spread reads syncAll; now they run
}
```

`stores.map(makeSync)` passes `makeSync` to JavaScript's `Array.prototype.map`, which expects a plain function. `makeSync`'s return annotation is a function type, not an Effect, so it is a plain function (Chapter 13, rule F) and `map` receives it: `syncAll` holds programs. Its returned arrow stands where that annotation declares a function returning an Effect, so it is an Effect function, the program. Without the annotation, `makeSync` would be an Effect function, which `map` cannot call (EK4301, Chapter 10), whatever its body does (D500). Where `Effect.all` expects Effects, the elements of an array or object literal convert one by one, so the spread `[...syncAll]` reads `syncAll` once, at the call, into a literal whose elements become programs. Passing `syncAll` itself is a type error: nothing traverses a collection that a call only names (D423).

An exported VibeLang function is a cold program to TypeScript: calling it runs none of its body (Chapter 10). A function that does work when it is called and returns a program for later is a **factory**, and VibeLang has no factory form of its own (D390). Two spellings cover what a factory does. A plain function, whose annotation says it returns a function, does its work at the call:

```ts es
export function capture(input: { mutable value: number }): () => number!! {
  const snapshot = input.value             // at the call
  return () => snapshot                    // each run returns this snapshot
}
```

`capture` has a plain return annotation, so it is a plain function (Chapter 15): calling it reads `input.value` and returns the program. A VibeLang caller runs that program with `capture(input)()`, and `retry(capture(input), policy)` takes one snapshot and retries that program. TypeScript sees `(input: { value: number }) => () => Effect<number>`. A TypeScript API whose callers must receive the `Effect` itself, built when they call, is written in TypeScript, in a `.ts` file or a `module` declaration (D283), where `Effect.sync(() => snapshot)` keeps its TypeScript meaning:

```ts es
module snapshots {
  import { Effect } from "effect"
  export function capture(input: { value: number }): Effect.Effect<number> {
    const snapshot = input.value             // at the call
    return Effect.sync(() => snapshot)       // each run returns this snapshot
  }
}

export { capture } from snapshots
```

TypeScript callers of `capture` get the `Effect`, built when they call. A VibeLang caller calls a TypeScript function that returns an `Effect`, so `capture(input)` runs it and gives the number (Chapter 13), and `retry(() => capture(input), policy)` takes a fresh snapshot on each attempt.

VibeLang has no third spelling because each candidate would make a type decide when code runs. An Effect contract on a function whose body returns an arrow, `(input): number!! => { …; return () => snapshot }`, would run the body at the call only because the arrow does not fit the contract's A, and removing the annotation from a program that still type-checks would move that work from the call to the run (D320, D323). A `const` holding an arrow, `export const capture = (input) => { … }`, is a VibeLang function like any other, cold to TypeScript, and a declared Effect type on that `const` changes only the arrow's representation: converting it runs none of the body, and what then runs the body is the receiver's use of what it holds, a call of a plain function running it at the call and a run of a program running it at the run (D324, D447). A new keyword for factories could avoid both, but it would give syntax to behavior that idiomatic Effect does not use: `Effect.fn` and `Effect.gen` bodies are cold too, and Effect's own factories are TypeScript. A factory written in the earlier form, which D269 allowed, is TypeScript's TS2322 at its return; `--fix` rewrites one that is not exported into a plain function that returns the program, and refuses an exported one with EK1023, since its TypeScript API would change (D382).

```ts es
function startServer() {
  const cachedConfig = Effect.cached(() => loadConfig())  // Effect.cached's success value is a program
  const config = cachedConfig()                           // loads once
  const again = cachedConfig()                            // returns the cached value
  return Http.listen(config.port)
}
```
