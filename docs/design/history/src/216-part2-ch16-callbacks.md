### 16. Callbacks and higher-order functions

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

#### A callback type means what TypeScript means

```ts es
function mapAll<A, B, E, R>(items: ReadonlyArray<A>, f: (a: A) => B!E!R) {
  const out: B[] = []
  for (const item of items) out.push(f(item))
  return out
}
// <A, B, E, R>(items: ReadonlyArray<A>, f: (a: A) => B!E!R) => B[]!E!R

const names = mapAll(ids, (id) => Users.find(id).name)   // string[]!UserNotFound!Users
const sizes = mapAll(words, (w) => w.length)             // number[]!!
```

A function type means what TypeScript means wherever it is written [Rule] (D500): `(a: A) => B` is a plain function type, in a parameter of a `.vibe` function as in a variable, a property, an interface member, an element, or a return, written in place or through a type alias. A callback that may run Effects says so in its type, `(a: A) => B!E!R`, with `E` and `R` declared as type parameters of the function, as Effect TypeScript declares a callback's channels on `Effect.forEach`. `mapAll` passes through whatever its callback does because its contract names the callback's channels: `f(item)` runs (Chapter 13, rule R), and its failures join E and its requirements R. A literal passed to `mapAll` takes the Effect form there (rule F), so `(w) => w.length` is an Effect function that cannot fail, and `sizes` needs nothing.

To accept only callbacks that cannot fail and need nothing, write `f: (a: A) => B!!`. To accept plain functions, write `f: (a: A) => B`, whose call is a plain call:

```ts es
function sumBy<A>(items: ReadonlyArray<A>, f: (a: A) => number): number {
  let total = 0
  for (const item of items) total += f(item)
  return total
}
// a plain function: <A>(items: ReadonlyArray<A>, f: (a: A) => number) => number to every caller

const total = sumBy(orders, (o) => o.amount)              // a plain literal at a plain destination
const score = sumBy(ids, (id) => Users.find(id).score)    // EK4301: the literal is plain, and its body runs an Effect
```

A function type with no Effect in its return is never a contract whose channels are silently `never`: it is a plain function type, so an effectful literal passed there is EK4301, never a callback whose failures disappear (settled decision 2). Before D500, a contract-less callback parameter of a `.vibe` function accepted any contract, through channels the compiler added, `E` and `R`, then `E2` and `R2` (D12, D68, D331, D398, D434). That gave one written type two meanings, plain to TypeScript and polymorphic to VibeLang, and made a TypeScript-shaped parameter such as `container: (value: unknown) => string | null` an Effect callback that `SchemaGetter.transform`'s synchronous callback could not call. A service member that runs a callback writes its channels as a function does:

```ts es
service Tx {
  run<A, E, R>(work: () => A!E!R): A!TxError | E!R
}
```

The declaration file writes each type as the source writes it, so a TypeScript caller passes `mapAll` a callback returning an `Effect`, `mapAll(words, (w) => Effect.succeed(w.length))`, and `sumBy` a plain one.

`mapAll` compiles to frames in v0 whatever its callback does (Chapter 15). The same rule makes wrappers short:

```ts es
function withRetry<A, E, R>(times: number, program: () => A!E!R) {
  return retry(program, Schedule.recurs(times))
}
// <A, E, R>(times: number, program: () => A!E!R) => A!E!R
```

#### Callbacks into JavaScript

A JavaScript function such as `Array.prototype.map` calls its callback synchronously, on a stack frame the runtime cannot pause or capture. A function literal at its plain destination is a plain function (Chapter 13, rule F), so it must compile to plain JavaScript (Chapter 15), with no Effect operation and E = `never`; anything else is EK4301 (Chapter 10). A named function passed as a value must be plain itself: `stores.map(makeSync)` needs `makeSync` declared with a plain return annotation, as Chapter 5 declares it, and an Effect function, an unannotated one included, is EK4301, even where the compiler gives it a plain variant for its calls (D421, D500). A callback that calls a plain function, `xs.map((x) => double(x))` with `double(n: number): number`, is plain itself; with an unannotated `double`, the literal's call of it runs an Effect, which is EK4301, and the quick fix writes `double`'s return type.

#### Which Effect combinators run their argument on another fiber

A control operation must be handled on the fiber that performs it (Chapter 9), so the compiler needs to know whether each Effect function that takes a program runs it on the same fiber. These were measured by performing a control operation inside each combinator, with the handler outside (`tests/fiber-behavior.test.ts`):

```ts es
try {
  retry(() => Approval.approve("a"), Schedule.recurs(2))     // same fiber: reaches the handler
  timeout(() => Approval.approve("b"), "1 second")           // other fiber: EK4201
} handle Approval.approve(_request) {
  resume(true)
}
```

| Same fiber: a handler outside still works | Other fibers: handle control operations inside |
| --- | --- |
| `flatMap`, `map`, `catch`, `catchCause`, `ensuring`, `onExit`, `provideService`, `scoped`, `acquireRelease` (acquire), `acquireUseRelease` (use), `retry`, `repeat`, `uninterruptible`, sequential `forEach` and `all`, `zip` by default | Measured: `timeout`, `race`, `raceFirst`, `forEach` with concurrency 2, unbounded `all`, `zip` with `concurrent: true`, `forkChild`. From source: `forkIn`, `forkScoped`, `forkDetach`, `Layer.merge` builds, parallel Scope finalizers, a producer consumed through the `Stream` interface (Chapter 8) |

`timeout` is on the right because it runs its program on a child fiber to race it against the clock. For an Effect function outside this table, the compiler assumes the argument may run on another fiber.

The runtime is the guarantee and the table is the diagnostic. A control operation that reaches another fiber fails at run time with `HandlerNotOnThisFiber` (T7b, T8), never silently. The table turns that defect into a compile-time error where it can, and a combinator missing from it costs a conservative error, not a wrong program.

TypeScript functions are judged by their signatures, because a TypeScript function can fork inside its body without taking a program argument: a TypeScript function whose R contains a control operation is EK4202 (Chapter 9). Services need no such check: their implementations live in the Context, which every forked fiber inherits.

The rule is conservative in one case. TypeScript code can implement a control operation so that it always continues exactly once; that implementation runs in place like a service and would work on a forked fiber. The compiler cannot see that from VibeLang, so it treats every control operation as bound to its fiber.
