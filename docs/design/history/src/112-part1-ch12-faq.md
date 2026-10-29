### 12. Questions Effect users ask

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

Short answers with code. Appendix C maps every section of Effect's documentation to VibeLang, including the many features that carry over unchanged.

#### Where did `async` and `await` go?

```ts es
function loadProfile(id: string) {
  const user = Users.find(id)                       // waits for the database: no await
  const avatar = try(                               // a Promise from a TypeScript library
    async (avatarId, signal) => avatarSdk.fetch(avatarId, { signal }),
    (cause) => new AvatarError({ cause }),
    user.avatarId                                   // an input: the hatch reads its own parameters
  )
  return { user, avatar }
}
// { user: User; avatar: Avatar }!UserNotFound | AvatarError!Users
```

A call waits for its callee, whether it finishes at once or after a network round trip; meanwhile the fiber is parked and other fibers run. An Effect function needs no `async` modifier or `await` on a call: every Effect function can wait. In VibeLang code, `join` waits for a fiber you forked, `d.await()` for a Deferred, and `await` appears only in the await operations (Chapter 7). A Promise from a TypeScript library crosses with the `try` hatch, or with `sync` when a rejection is a bug (D148); inside the hatch's function, `async` and `await` keep their JavaScript meaning, and a value of the `.vibe` file, such as `user.avatarId`, arrives as an input (D229). JavaScript `async` and `await` also work in inline `module` bodies (Chapter 10, D283). Effect modules replace platform APIs that return Promises, such as `fetch` (Chapter 11).

#### How do I run things concurrently?

```ts es
function homePage(userId: string) {
  const [feed, unread] = await.all [Feed.load(userId), Notifications.unread(userId)]
  const previews = forEach(feed.items, (item) => preview(item), { concurrency: 8 })
  return { previews, unread }
}
```

Calls run in order. Concurrency is always a combinator over programs: an await operation such as `await.all`, whose elements are programs by syntax, `fork`, or `Effect.all`, `Effect.forEach`, `Effect.race`, and `Effect.raceFirst` with programs written as functions, `() => Feed.load(userId)` (Chapter 7). `Semaphore`, `Latch`, `Queue`, `Deferred`, and `PubSub` work unchanged.

#### Where did `Effect.gen` and `yield*` go?

```ts es
function displayName(id: string) {
  return Users.find(id).name
}
```

Every function body plays the generator, and every call whose callee is declared to return an `Effect` plays `yield*` (Chapter 13). `function*` now declares a producer (Chapter 8), so APIs that take a generator, such as `Effect.gen`, `Option.gen`, and `Result.gen`, stay in `.ts` files (EK1002). The editor converts an `Effect.gen` function for you (Chapter 28).

#### What does `throw` mean now?

```ts es
function parseId(raw: string) {
  if (!/^\d+$/.test(raw)) throw new InvalidId({ raw })     // a typed failure: InvalidId joins E
  if (raw.length > 64) die(new Error("caller bug"))  // a defect, on purpose
  return Number(raw)
}
// number!InvalidId!
```

In an Effect function, `throw` is `Effect.fail`: every thrown value joins E with its type and can be caught, including `throw new Error("unreachable")`, which inside `Effect.gen` would be a defect. To signal a bug, die explicitly with `Effect.die`. Defects also come from exceptions no contract lists and from `Effect.orDie(() => …)` (Chapter 3).

#### What happens when code that is not Effect throws?

```ts es
function readPort(text: string) {
  try {
    return JSON.parse(text).port as number    // JSON.parse fails with SyntaxError
  } catch (e) {                               // e: SyntaxError
    return 8080
  }
}
// number!!
```

JavaScript's built-ins and Effect's own functions ship with contracts that say which exceptions are expected failures. Other TypeScript code needs an explicit boundary or a trusted contract (EK4401); Effect modules replace platform APIs (EK4402). An exception that no contract lists is a defect, and unlike a JavaScript `catch` inside `Effect.gen`, an Effect catch does not see it. EK2004 warns at a catch whose try block has E = `never`: defects pass through (Chapter 3). A plain function's catch follows the same rule (D282).

#### How do I use `Option` and `Result`?

```ts es
function displayName(user: User) {
  return Option.fromNullishOr(user.nickname).match({
    onNone: () => user.name,
    onSome: (nickname) => nickname
  })
}

function tryCharge(cartId: string) {
  const outcome = Effect.result(() => Payments.charge(cartId))    // Result<Receipt, PaymentError>
  return outcome.isSuccess() ? outcome.success : undefined
}
// Receipt | undefined!!Payments
```

`Option` and `Result` (Effect 4's name for `Either`) are plain data, imported from `effect` and used as in TypeScript. `Effect.result` and `Effect.option` turn a failure into a value; `throw` turns a value back into a failure.

#### How do I validate data with `Schema`?

```ts es
class Signup extends Schema.Class<Signup>("Signup")({
  email: Schema.String,
  plan: Schema.Literals(["free", "pro"])
}) {}

function register(body: unknown) {
  const signup = Schema.decodeUnknownEffect(Signup)(body)    // fails with SchemaError
  return Accounts.create(signup.email, signup.plan)
}
// Account!SchemaError | AccountError!Accounts
```

`Schema` is in the prelude and unchanged. A decoder that returns an `Effect` runs when called and fails with a typed `SchemaError`. The other forms (`decodeUnknownSync`, `is`) are trusted functions whose exceptions are defects, so `.vibe` code prefers the `Effect` forms. Errors that must cross a process boundary are `Schema.TaggedError` classes.

#### How do I work with streams?

```ts es
function digestActive(users: Stream.Stream<User, DbError>) {
  for (const user of users) {
    if (user.active) Mailer.digest(user)
  }
}
// void!DbError | MailError!Mailer

function firstErrorLines(path: string) {
  return lines(path).filter(isError).take(10).runCollect()
}
```

Effect's `Stream`, `Sink`, and `Channel` modules work unchanged: their operators take plain functions and Effect-returning callbacks, and the `Stream.run*` functions return Effects, so calling them runs the stream. `for...of` iterates a `Stream` directly, and a `function*` producer such as `lines` is a `Stream` wherever a `Stream` is expected (Chapter 8).

#### How do I test?

```ts es
import { assert, it } from "@effect/vitest"

it.effect("a reminder fires after one day") {
  const reminder = fork remindLater("ada", "1 day")
  TestClock.adjust("1 day")                          // virtual time: nothing waits
  assert.strictEqual(join reminder, "sent")
}
```

`@effect/vitest` works unchanged: `it.effect` runs a VibeLang function as a test, `assert` comes from the same package, and `TestClock` controls time. Fake services are Layers (Chapter 4), and a control operation is scripted with a handler (Chapter 9). An `Exit` is data until called, so `assert.deepStrictEqual(Effect.exit(() => f()), Exit.succeed(1))` compares two `Exit` values. A test written as `async () => { await Effect.runPromise(p) }` stays in a `.ts` file: `.vibe` code has no `await` except the await operations, and a runner inside a test body is EK1005 (Chapter 13).

#### How do I log, trace, and record metrics?

```ts es
const checkouts = Metric.counter("checkouts")

function checkout(cartId: string) {
  log(`checkout ${cartId}`)
  const receipt = withSpan(() => Payments.charge(cartId), "charge")
  Metric.update(checkouts, 1)
  return receipt
}
```

Unchanged: `Effect.log` and its levels, `Effect.annotateLogs`, `Effect.withLogSpan`, `Effect.withSpan`, `Logger`, and `Metric`, each taking a program, written `() => …`, where it takes an Effect today. Functions are untraced unless you add a span or turn on `tracing` for the project (Chapter 28). Exporters come from `effect/observability`.

#### How do I read configuration?

```ts es
const Port = Config.withDefault(Config.Port("PORT"), 3000)

function main() {
  const port = Port()                         // reads PORT; ConfigError if it is invalid
  log(`listening on ${port}`)
}
```

A `Config` is data until you call it (Chapter 13), so `Config.all`, `Config.nested`, and `Config.withDefault` compose it first and a call reads it. A `ConfigProvider` replaces the environment in tests (Chapter 11).

#### How do I run a program?

```ts es
// main.vibe
import "vibelang/platform/node"

export function main() {
  provide AppLive { serve(8080) }
}
```

A program starts only at a runner. The file that exports `main` names its platform once, and when the host starts that file, its entry statement runs `main` with the platform's services through `NodeRuntime.runMain` (D312, Chapter 11); importing the file, as a test does, starts nothing. `it.effect` runs a test, and `Effect.runPromise` or a `ManagedRuntime` runs a program where TypeScript code needs a result. A web framework that calls your handlers builds one `ManagedRuntime` from the application layer and runs each handler through it, so the layer is built once (Chapter 4). A module's top level cannot run a program (EK1001). Chapter 13 states when the compiler appends an entry statement and when an explicit top-level runner replaces it (D135).

#### Do I still use `pipe`?

```ts es
const slug = title |> %.trim() |> %.toLowerCase() |> %.replaceAll(" ", "-")
const user = timeout(() => retry(() => fetchUser(id), { times: 3 }), "2 seconds")
```

Rarely. Statements replace sequencing, error handling, and cleanup, so most pipelines disappear. The pipe operator, `x |> f(%)`, evaluates `x` once and passes its value (Chapter 5). A policy over a program, such as `retry`, takes the program as a function, so stacked policies nest.

#### How do I pattern match?

```ts es
data Shape {
  Circle { radius: number }
  Square { side: number }
}

function area(shape: Shape) {
  return match (shape) {
    when Shape.Circle { let radius }: Math.PI * radius ** 2;
    when Shape.Square { let side }: side ** 2;
  }
}
```

With `match` and `is`, from TC39's pattern matching proposal (D206): arms are tried in order, a match over a closed type such as a data type must handle every case (EK4701), and an arm can call Effect functions (Chapter 3, Chapter 11). Catch a failure with `catch (e)`, then use `match (e)` or `e is T` to narrow it (Chapter 3). TypeScript's narrowing keeps working: `switch` on `_tag`, `instanceof`, and `catch` narrowing on errors. Effect's `Match` module works unchanged; its handlers are plain functions, so they cannot pause (EK4301).

#### How do fibers, interruption, and cancellation work?

```ts es
function search(query: string) {
  const scan = fork slowIndexScan(query)
  const cached = SearchCache.lookup(query)
  if (cached !== undefined) {
    scan.interrupt()               // cancels the scan; its finally blocks run first
    return cached
  }
  return join scan
}
```

They are Effect's: `fork` starts a fiber owned by the function body, loop iteration, or region around it (Chapter 7), and `Fiber.join` and `Fiber.interrupt` work unchanged. Interruption runs every `finally` block and `using` release on the way out, and `catch` never catches it (Chapter 3). `Effect.uninterruptible(() => …)` protects a region, `Effect.onInterrupt` reacts to cancellation, and `Effect.timeout` and `Effect.race` interrupt the branches they discard. A Promise is cancelled through the `AbortSignal` that the `try` and `sync` hatches pass.

#### How do I wrap a callback API?

```ts es
function ready() {
  return callback<Sdk>((resume) => {
    onceReady((sdk) => resume(sdk))
  })
}
```

The `callback` hatch adapts it (D148): its register function is plain TypeScript, `resume(value)` succeeds, `resume.fail(error)` fails, and a function the register function returns runs on interruption. A callback API that delivers a resource, such as a socket, is adapted in TypeScript with the runtime's `suspend` and `Effect.acquireRelease(…, { interruptible: true })`, so a value that arrives after cancellation is released (Chapter 6). Node.js and browser callback APIs already have Effect modules (Chapter 11).

#### Can I mix `.ts` and `.vibe` files?

```ts es
import { findUser } from "./users-repo.ts"     // Effect.fn("findUser")(function* …)

export function title(id: string) {
  return findUser(id).name.toUpperCase()
}
```

Yes, in one program: `vibelang` checks both and the editor serves both (Chapter 28). A TypeScript function declared to return an `Effect` is called like a VibeLang function, and TypeScript sees a VibeLang function as one that returns a cold `Effect`, except a function with a plain return annotation, `: infer _` included, a protocol method, a method that implements a plain member, and an object literal's protocol member, which are plain (D397, D484, D500), and a producer, which returns a `Stream` (Chapter 10).

#### Is there anything from Effect I cannot use?

```ts es
const legacy = try(async (program, signal) => Effect3.runPromise(program, { signal }), (cause) => new LegacyError({ cause }), oldProgram)
```

Five things, each with a replacement:

- Generator-based APIs (`Effect.gen`, `Option.gen`) cannot be written in `.vibe` files; call them from TypeScript.
- Effectful handlers in `Option.match` or `Match` are rejected (EK4301); use `if` or `switch`.
- Runners inside code a fiber runs are rejected (EK1005); call the program, or `detach` it.
- A TypeScript function whose requirements include a control operation is rejected (EK4202).
- Effect 3 code, including `Micro`, runs only as foreign code behind a boundary, as above: an `async` hatch function waits for `runPromise`'s promise, and the mapper receives its rejection (Chapter 10).

Everything else in Effect is available; Appendix C lists it feature by feature.

#### How do I keep state that several fibers share?

```ts es
function countVisits(paths: ReadonlyArray<string>) {
  const visits = Ref.make(0)
  forEach(paths, (path) => {
    Visits.record(path)
    visits.update((n) => n + 1)
  }, { concurrency: 4 })
  return visits.get()
}
// number!VisitError!Visits
```

Local variables work inside one function, as in JavaScript. State shared between fibers uses Effect's `Ref`, `SynchronizedRef`, and `SubscriptionRef`, unchanged: `Ref.make(0)` returns an `Effect`, so the call runs it and gives you the `Ref`.
