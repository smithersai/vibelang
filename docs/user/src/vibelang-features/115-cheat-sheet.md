# Cheat sheet

Every VibeLang change beside the Effect code it replaces: VibeLang and Effect 4 TypeScript in labeled tabs. The [specification](../../../design/src/000-intro.md) states the rules behind each. In a `.vibe` file, the Effect tab's error classes, services, schemas, Effect types, `Effect.succeed` and `Effect.fail`, catch combinators, and `withSpan` and `provide` calls draw warnings whose quick fixes, and `vibelang --fix`, write the VibeLang tab where it keeps the program's meaning ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)). Complete Effect tabs import their dependencies and are typechecked. Tabs marked `// fragment` use the declarations below or a surrounding `Effect.gen` body. Converted VibeLang blocks name the VIPs they need with `// pending:`. Support for the new forms arrives with the compiler's VIP implementation. The VibeLang examples share these declarations:

```vibe es
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-9, VIP-12, VIP-13, VIP-14
// run: provide Approval = { approve: (_request) => succeed(true) } { { const jsonValue = [try getUser("1"), try getOrders("1"), try release("v1")]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) } }
error NotFound { id: string }
interface User { id: string; name: string }

effect function getUser(id: string): User!NotFound!never {
  try sleep("5 millis")
  if (id === "missing") throw new NotFound({ id })
  return { id, name: "Ada" }
}

effect function getOrders(id: string): number!! {
  return id.length
}

service Approval { approve(request: string): boolean!! }

effect function release(version: string) {
  const approval = try Approval
  return (try approval.approve(`deploy ${version}`)) ? `released ${version}` : "declined"
}
// Output: [{"id":"1","name":"Ada"},1,"released v1"]
```

## Types

**Effect types**. `A!E!R` means exactly `Effect<A, E, R>`. Empty and omitted slots are `never`. Leave out the whole annotation to infer a function's type.

```ts effect
// fragment
type Find = (id: string) => Effect.Effect<User, NotFound>
type Release = (version: string) => Effect.Effect<string, never, Approval>
type Load = () => Effect.Effect<string>
const hello = (id: string): Effect.Effect<string, NotFound> =>
  Effect.map(getUser(id), (user) => `Hello, ${user.name}`)
```

```vibe es
// pending: VIP-1, VIP-3, VIP-5, VIP-14
// run: try Console.log(try hello("1"))
type Find = (id: string) => User!NotFound
type Release = (version: string) => string!!Approval
type Load = () => string!!
effect function hello(id: string): string!NotFound!never {
  return `Hello, ${(try getUser(id)).name}`
}
// Output: Hello, Ada
```

## Declarations

**Errors**.

```ts effect
import { Data } from "effect"

class Missing extends Data.TaggedError("Missing")<{ readonly id: string }> {}
class Timeout extends Data.TaggedError("Timeout") {}
```

```vibe es
// pending: VIP-13
error Missing { id: string }
error Timeout
```

**Errors are classes**. An `error` declaration supports fields, methods, and getters. Use an ordinary `Data.TaggedError` class when you need a constructor, inheritance, or a custom tag.

```ts effect
import { Data } from "effect"

class Invalid extends Data.TaggedError("Invalid")<{ readonly code: string }> {
  constructor(input: string) {
    super({ code: input.trim() })
  }
  get label(): string {
    return `invalid ${this.code}`
  }
}
class Failure extends Data.TaggedError("Failure" as string)<{ readonly code: string }> {}
class Refused extends Failure {
  override readonly _tag = "Refused"
}
```

```vibe es
// pending: VIP-5, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([new Invalid(" x ").label, new Refused({ code: "r" })._tag])))
class Invalid extends Data.TaggedError("Invalid")<{ readonly code: string }> {
  constructor(input: string) {
    super({ code: input.trim() })
  }
  get label(): string {
    return `invalid ${this.code}`
  }
}
class Failure extends Data.TaggedError("Failure" as string)<{ readonly code: string }> {}
class Refused extends Failure {
  override readonly _tag = "Refused"
}
// Output: ["invalid x","Refused"]
```

**Errors that encode**. Fields map to schemas as a `schema` declaration's do.

```ts effect
import { Schema } from "effect"

class Stored extends Schema.TaggedError<Stored>()("Stored", { key: Schema.String, attempts: Schema.optional(Schema.Number) }) {}
```

```vibe es
// pending: VIP-29
schema error Stored { key: string; attempts?: number }
```

**Services**. Members have no bodies. Write their contracts explicitly. `readonly` has its TypeScript meaning.

```ts effect
// fragment
class Users extends Context.Service<Users, {
  find(id: string): Effect.Effect<User, NotFound>
  readonly region: string
}>()("app/Users") {}
```

```vibe es
// pending: VIP-3, VIP-9
service Users {
  static readonly key = "app/Users"
  find(id: string): User!NotFound
  readonly region: string
}
```

**Services of any shape**. Use Effect's `Context.Service` directly for a primitive or an existing interface. A `service` declaration writes its members out.

```ts effect
import { Context, Effect } from "effect"

interface SearchApi {
  find(query: string): Effect.Effect<string>
}
class Search extends Context.Service<Search, SearchApi>()("app/Search") {}
class Prefix extends Context.Service<Prefix, string>()("app/Prefix") {}
```

```vibe es
// pending: VIP-3, VIP-14
interface SearchApi {
  find(query: string): string!!
}
class Search extends Context.Service<Search, SearchApi>()("app/Search") {}
class Prefix extends Context.Service<Prefix, string>()("app/Prefix") {}
```

**Layers**. A layer is Effect's own call: `effect { ... }` is the second argument to `Layer.effect(Users, effect { ... })` and is its Effect, runs once when the layer builds, and returns members typed by the service. Without setup, write `Layer.succeed(Users, { ... })`.

```ts effect
// fragment
const UsersLive = Layer.effect(Users, Effect.gen(function* () {
  const seen = new Set<string>()
  return Users.of({ find: (id) => getUser(id), region: "eu" })
}))
```

```vibe es
// pending: VIP-2, VIP-5, VIP-12, VIP-14
// run: provide UsersLive { const users = try Users; { const jsonValue = try users.find("1"); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(users.region) }
const UsersLive = Layer.effect(Users, effect {
  const seen = new Set<string>()
  return Users.of({
    find: (id) => getUser(id),
    region: "eu"
  })
})
// Output: {"id":"1","name":"Ada"}
// Output: eu
```

**Schemas**. One declaration gives the schema and its type.

```ts effect
import { Schema } from "effect"

const Account = Schema.Struct({
  id: Schema.String,
  nickname: Schema.optional(Schema.String),
  role: Schema.Literals(["admin", "member"])
})
type Account = typeof Account.Type
```

```vibe es
// pending: VIP-5, VIP-14, VIP-15
// run: { const jsonValue = try Schema.decodeUnknownEffect(Account)({ id: "1", role: "admin" }); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
schema Account {
  readonly id: string
  readonly nickname?: string
  readonly role: "admin" | "member"
}
// Output: {"id":"1","role":"admin"}
```

**Schema aliases**. A schema of any type the struct form maps, and the type, under one name.

```ts effect
import { Schema } from "effect"

const Role = Schema.Literals(["admin", "member"])
type Role = typeof Role.Type
```

```vibe es
// pending: VIP-5, VIP-14, VIP-15
// run: try Console.log(Schema.is(Role)("admin")); try Console.log(Schema.is(Role)("owner"))
schema Role = "admin" | "member"
// Output: true
// Output: false
```

**Data types**. A tagged union: Effect's `Data.TaggedEnum` type and its `Data.taggedEnum` constructors under one name. A variant without fields is a bare name.

```ts effect
import { Data } from "effect"

type Delivery = Data.TaggedEnum<{
  Waiting: {}
  Sent: { readonly tracking: string }
}>
const Delivery = Data.taggedEnum<Delivery>()
```

```vibe es
// pending: VIP-5, VIP-14, VIP-16
// run: try Console.log(try Effect.try(() => JSON.stringify([Delivery.Waiting(), Delivery.Sent({ tracking: "parcel-8" })])))
data Delivery {
  Waiting
  Sent { tracking: string }
}
// Output: [{"_tag":"Waiting"},{"tracking":"parcel-8","_tag":"Sent"}]
```

**Readonly members**. Use TypeScript's `readonly` modifier for a member that cannot be assigned.

```ts effect
interface Cart { readonly id: string; items: Array<string> }
```

```vibe es
interface Cart { readonly id: string; items: Array<string> }
```

## Programs

**Statements instead of generators.** Declare an effect function. Run each Effect with `try`.

```ts effect
// fragment
const greetUser = Effect.fn("greetUser")(function* (id: string) {
  const user = yield* getUser(id)
  yield* Console.log(`Hello, ${user.name}`)
  return user.name
})
```

```vibe es
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14
// run: try Console.log(try Effect.provide(greetUser("1"), Logger.layer([Logger.make(({ message }) => console.log(...(message as unknown[])))])))
effect function greetUser(id: string) {
  return try withSpan(effect {
    const user = try getUser(id)
    try Console.log(`Hello, ${user.name}`)
    return user.name
  }, "greetUser")
}
// Output: Hello, Ada
// Output: Ada
```

`Effect.fn("name")(body)` adds a named tracing span. Preserve it with `try withSpan(effect { ... }, "name")` inside an effect function. The block's result, failures, and requirements flow through.

**Programs as Effect values**. Calling an effect function returns an Effect. Pass it directly to combinators, then use `try` to run the combined Effect.

```ts effect
// fragment
const user = yield* getUser("1")
const first = yield* Effect.race(getUser("1"), getUser("2"))
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log((try fastest()).name)
effect function fastest() {
  const user = try getUser("1")
  return try race(getUser("1"), getUser("2"))
}
// Output: Ada
```

**Providing layers**. `return` inside the block returns from the function.

```ts effect
// fragment
const program = Effect.gen(function* () {
  const users = yield* Users
  return yield* users.find("1")
}).pipe(Effect.provide(UsersLive))
```

```vibe es
// pending: VIP-1, VIP-5, VIP-12
// run: { const jsonValue = try program(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function program() {
  provide UsersLive {
    const users = try Users
    return try users.find("1")
  }
}
// Output: {"id":"1","name":"Ada"}
```

**Providing one service**. `provide Key = value` supplies an implementation. Mix layers and service bindings in one list. Use the service key, such as `Random.Random`.

```ts effect
import { Effect, Logger, Random } from "effect"

const seeded = { nextIntUnsafe: () => 4, nextDoubleUnsafe: () => 0.5 }
const roll = Random.nextInt.pipe(
  Effect.provideService(Random.Random, seeded),
  Effect.provide(Logger.layer([]))
)
```

```vibe es
// pending: VIP-1, VIP-3, VIP-5, VIP-12, VIP-14
// run: try Console.log(try roll())
const seeded = { nextIntUnsafe: (): number => 4, nextDoubleUnsafe: (): number => 0.5 }

effect function roll(): number!! {
  provide Logger.layer([]), Random.Random = seeded {
    return try Random.nextInt
  }
}
// Output: 4
```

**Catching by tag**. Catch the failure and `match` on it. A match naming every failure needs no rethrow; `default: throw e` passes on the rest.

```ts effect
// fragment
const describe = (id: string) =>
  Effect.map(getUser(id), (user) => user.name).pipe(
    Effect.catchTag("NotFound", (e) => Effect.succeed(`no user ${e.id}`))
  )
```

```vibe es
// pending: VIP-1, VIP-2, VIP-5, VIP-7, VIP-14
// run: { const jsonValue = [try describe("1"), try describe("missing")]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function describe(id: string) {
  return effect {
    return (try getUser(id)).name
  } catch (e) => match (e) {
    when NotFound: `no user ${e.id}`;
  }
}
// Output: ["Ada","no user missing"]
```

**Falling back in an expression**. `x catch () => fallback` runs the Effect and gives the fallback after a typed failure. Defects and interruption propagate.

```ts effect
// fragment
const nameOrGuest = (id: string) =>
  Effect.map(getUser(id), (user) => user.name).pipe(
    Effect.orElseSucceed(() => "guest")
  )
```

```vibe es
// pending: VIP-1, VIP-2, VIP-5, VIP-14
// run: { const jsonValue = [try nameOrGuest("1"), try nameOrGuest("missing")]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function nameOrGuest(id: string) {
  return effect { return (try getUser(id)).name } catch () => "guest"
}
// Output: ["Ada","guest"]
```

**Catching in an expression**. `x catch (e) => …` passes the failure to a handler, which can `match` on it; a match naming every failure removes them all.

```ts effect
// fragment
const nameOrReason = (id: string) =>
  Effect.map(getUser(id), (user) => user.name).pipe(
    Effect.catch((e) => Effect.succeed(`no user ${e.id}`))
  )
```

```vibe es
// pending: VIP-1, VIP-2, VIP-5, VIP-7, VIP-14
// run: { const jsonValue = [try nameOrReason("1"), try nameOrReason("missing")]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function nameOrReason(id: string) {
  return effect { return (try getUser(id)).name } catch (e) => match (e) {
    when NotFound: `no user ${e.id}`;
  }
}
// Output: ["Ada","no user missing"]
```

**Entry point**. Call a runner explicitly at the module top level. `await runPromise(main())` waits for the returned Promise. A Node application can use `NodeRuntime.runMain(main())`.

```ts effect
// fragment
// main.ts
export const main = Effect.log("Hello")
// run.ts
NodeRuntime.runMain(main)
```

```vibe es
// main.vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Effect.provide(main(), Logger.layer([Logger.make(({ message }) => console.log(...(message as unknown[])))]))
export effect function main() {
  try log("Hello")
}
// Output: Hello
```

```vibe
// run.vibe
// pending: VIP-6, VIP-26
import { main } from "./main.vibe"

await runPromise(main())
```

## Causes, exits, and interruption

**Catch every cause**. `match` on `exit(…)`: a `Failure` exit's cause also holds defects and interrupts.

```ts effect
// fragment
const safe = (id: string) =>
  Effect.map(getUser(id), (user) => user.name).pipe(
    Effect.catchCause((cause) => Effect.succeed(`failed: ${Cause.pretty(cause)}`))
  )
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-7, VIP-14
// run: try Console.log(try safe("1")); try Console.log((try safe("missing")).includes("NotFound"))
effect function safe(id: string) {
  return match (try exit(getUser(id))) {
    when Exit.Success(let user): user.name;
    when Exit.Failure(let cause): `failed: ${Cause.pretty(cause)}`;
  }
}
// Output: Ada
// Output: true
```

**Rethrow a cause**. Use `try failCause(cause)` to fail with the whole cause. `throw cause` would make the Cause object a typed failure.

```ts effect
// fragment
const logged = getUser("1").pipe(
  Effect.catchCause((cause) => Effect.andThen(Effect.logError(cause), Effect.failCause(cause)))
)
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-7, VIP-14
// run: { const jsonValue = try logged(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function logged() {
  const outcome = try exit(getUser("1"))
  if (outcome is Exit.Failure(let cause)) {
    try logError(cause)
    return try failCause(cause)
  }
  return outcome.value
}
// Output: {"id":"1","name":"Ada"}
```

**Run on every exit**. `onExit` runs its callback without interruption and passes the complete `Exit`, including the success value.

```ts effect
// fragment
const tracked = getUser("1").pipe(
  Effect.onExit((exit) => Effect.log(`lookup ${exit._tag}`))
)
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: const user = try Effect.provide(tracked(), Logger.layer([Logger.make(({ message }) => console.log(...(message as unknown[])))])); try Console.log(user.name)
effect function tracked() {
  return try onExit(getUser("1"), (outcome) => log(`lookup ${outcome._tag}`))
}
// Output: lookup Success
// Output: Ada
```

**Exit, yield, and interrupt**. Pass the Effect directly to `exit`. `yieldNow` and `interrupt` are Effect values. Run them with `try`.

```ts effect
// fragment
const result = yield* Effect.exit(getUser("1"))
yield* Effect.yieldNow
if (result._tag === "Failure") yield* Effect.interrupt
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-7, VIP-14
// run: try Console.log((try outcome())._tag)
effect function outcome() {
  const result = try exit(getUser("1"))
  try yieldNow
  if (result is Exit.Failure) try interrupt
  return result
}
// Output: Success
```

**Interruption**. `uninterruptible { … }` masks interruption for its statements, and `restore { … }` inside it restores the interruptibility from before the mask. `interruptible { … }` allows interruption inside masked code. They are ordinary blocks, so `return` inside one returns from the effect function.

```ts effect
// fragment
const guarded = Effect.uninterruptibleMask((restore) =>
  Effect.gen(function* () {
    const user = yield* getUser("1")
    const orders = yield* restore(getOrders(user.id))
    return { user, orders }
  })
)
const cancellable = Effect.interruptible(getOrders("1"))
```

```vibe es
// pending: VIP-1, VIP-5, VIP-22
// run: { const jsonValue = [try guarded(), try cancellable()]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function guarded() {
  uninterruptible {
    const user = try getUser("1")
    restore {
      const orders = try getOrders(user.id)
      return { user, orders }
    }
  }
}

effect function cancellable() {
  interruptible {
    return try getOrders("1")
  }
}
// Output: [{"user":{"id":"1","name":"Ada"},"orders":1},1]
```

## Calls

A tagged template is a call of its tag. If `sql` returns an Effect, the statement ``try sql`CREATE TABLE example (id TEXT)` `` runs it, and ``const rows = try sql`SELECT * FROM example` `` gets its success value. Plain tags keep JavaScript behavior. To pass one as a program, write ``sql`...` ``, as for an Effect-returning call.

**No imports from `effect` or its subpath packages**.

```ts effect
import { Console } from "effect"
import { Hex } from "effect/encoding"

const ready = Console.log(Hex.encode("ready"))
```

```vibe es
// pending: VIP-1, VIP-5, VIP-14, VIP-33
// run: try ready()
effect function ready() {
  try Console.log(Hex.encode("ready"))
}
// Output: 7265616479
```

**Look up platform services**. Get the implementation with `try FileSystem.FileSystem`, then run its Effect members with `try`.

```ts effect
import { Effect } from "effect"
import { FileSystem } from "effect/FileSystem"

const size = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem
    const text = yield* fs.readFileString(path)
    return text.length
  })
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14, VIP-33
// run: provide FileSystem.layerNoop({ readFileString: () => succeed("hello") }) { try Console.log(try size("notes.txt")) }
effect function size(path: string) {
  const fs = try FileSystem.FileSystem
  return (try fs.readFileString(path)).length
}
// Output: 5
```

**Common functions without the `Effect.` prefix**: `sleep`, `log`, `retry`, `repeat`, `timeout`, `race`, `all`, `forEach`, `die`, `withSpan`, and the `log` levels.

```ts effect
// fragment
const patient = Effect.gen(function* () {
  yield* Effect.sleep("10 millis")
  return yield* Effect.timeout(Effect.retry(getUser("1"), Schedule.recurs(2)), "1 second")
})
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: { const jsonValue = try patient(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function patient() {
  try sleep("10 millis")
  return try timeout(retry(getUser("1"), Schedule.recurs(2)), "1 second")
}
// Output: {"id":"1","name":"Ada"}
```

**Operators on Effect's data types**. Use the module's functions, directly or through `.pipe`.

```ts effect
import { Stream } from "effect"

const hot = Stream.take(
  Stream.map(Stream.filter(Stream.make(18, 25, 30), (c) => c >= 25), (c) => `${c} C`),
  2
)
```

```vibe es
// pending: VIP-5, VIP-14
// run: { const jsonValue = try Stream.runCollect(hot()); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
function hot() {
  return Stream.make(18, 25, 30).pipe(
    Stream.filter((c) => c >= 25),
    Stream.map((c) => `${c} C`),
    Stream.take(2)
  )
}
// Output: ["25 C","30 C"]
```

Stream transformations construct a Stream. Run it with a Stream consumer such as `Stream.runCollect`, or iterate it with `for try`.

**The pipe operator**. `%` is the value on the left, evaluated once. Effects remain values in a pipe: `try (getUser("1") |> retry(%, policy) |> timeout(%, "1 second"))`.

```ts effect
// fragment
const user = yield* getUser("1")
const shout = pipe(user.name, (name) => name.toUpperCase(), (name) => `${name}!`)
```

```vibe es
// pending: VIP-1, VIP-5, VIP-14, VIP-23
// run: try Console.log(try shout())
effect function shout() {
  return (try getUser("1")).name |> %.toUpperCase() |> `${%}!`
}
// Output: ADA!
```

## TC39 forms

**Fail on a missing value.**

```ts effect
// fragment
const findUser = (users: Map<string, User>, id: string) =>
  Effect.fromNullishOr(users.get(id)).pipe(Effect.mapError(() => new NotFound({ id })))
```

```vibe es
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log((try findUser(new Map([["1", { id: "1", name: "Ada" }]]), "1")).name); try Console.log((try result(findUser(new Map<string, User>(), "missing")))._tag)
effect function findUser(users: Map<string, User>, id: string) {
  const user = users.get(id)
  if (user === undefined) throw new NotFound({ id })
  return user
}
// Output: Ada
// Output: Failure
```

`throw` is a statement. In an effect function, it fails the Effect with a typed error.

**Blocks as values** ([do expressions](https://github.com/tc39/proposal-do-expressions)). The value is the last statement's.

```ts effect
// fragment
const label = (id: string) =>
  Effect.map(getUser(id), (user) => (user.name.length > 3 ? user.name : "short"))
```

```vibe es
// pending: VIP-1, VIP-2, VIP-5, VIP-14
// run: try Console.log(try label("1"))
effect function label(id: string) {
  const name = do {
    const user = try getUser(id)
    if (user.name.length > 3) user.name
    else "short"
  }
  return name
}
// Output: short
```

A `do` expression uses `const` or `let`, never `var` (`EK1019`; quick fix: `let`). Its `break` and `continue` stay inside that expression (`EK1019`); `return` is `TS1108`.

**Effect blocks as arguments**. Pass `effect { ... }` as an ordinary argument. A test API takes a callback that returns the Effect, such as `it.live("name", () => effect { ... })`.

```ts effect
// fragment
const loaded = Effect.withSpan(
  Effect.gen(function* () {
    const user = yield* getUser("1")
    return user.name
  }),
  "load"
)

it.live("finds a user", () =>
  Effect.gen(function* () {
    const user = yield* getUser("1")
    assert.strictEqual(user.name, "Ada")
  }))
```

```vibe es
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14
// run: try Console.log(try loaded())
effect function loaded() {
  return try withSpan(effect {
    const user = try getUser("1")
    return user.name
  }, "load")
}
// Output: Ada
```

```vibe
// pending: VIP-2, VIP-5, VIP-6
import { assert, it } from "@effect/vitest"

it.live("finds a user", () => effect {
  const user = try getUser("1")
  try Effect.try(() => assert.strictEqual(user.name, "Ada"))
})
// Output:
```

`it.live` uses the live clock, because this page's `getUser` sleeps. Under `it.effect`'s test clock, a sleeping test must advance it with `TestClock.adjust`.

## Pattern matching

From the TC39 [pattern matching](https://github.com/tc39/proposal-pattern-matching) proposal (stage 1). See [Pattern matching with match and is](116-match-and-is.md).

**Match a value**. `match` is exhaustive: without `default`, a match that misses a case of a finite union is EK4701, as with `Match.exhaustive`. Leave out the second arm below and the compiler reports `This match does not handle every case of "draft" | "published": "published" is left.`

```ts effect
import { Match } from "effect"

const phaseLabel = (phase: "draft" | "published") =>
  Match.value(phase).pipe(
    Match.when("draft", () => "Draft"),
    Match.when("published", () => "Published"),
    Match.exhaustive
  )
```

```vibe es
// pending: VIP-5, VIP-7, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([phaseLabel("draft"), phaseLabel("published")])))
function phaseLabel(phase: "draft" | "published") {
  return match (phase) {
    when "draft": "Draft";
    when "published": "Published";
  }
}
// Output: ["Draft","Published"]
```

**Match errors by class**. An `error` class matches its `_tag`. `and { let id }` binds a property.

```ts effect
// fragment
const describeFailure = (failure: NotFound | Timeout) =>
  Match.value(failure).pipe(
    Match.tag("NotFound", (e) => `no user ${e.id}`),
    Match.tag("Timeout", () => "retry"),
    Match.exhaustive
  )
```

```vibe es
// pending: VIP-5, VIP-7, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([describeFailure(new NotFound({ id: "7" })), describeFailure(new Timeout())])))
function describeFailure(failure: NotFound | Timeout) {
  return match (failure) {
    when NotFound(let e): `no user ${e.id}`;
    when Timeout: "retry";
  }
}
// Output: ["no user 7","retry"]
```

**Match a data type's variants**. Use an object pattern on `_tag` and bind the fields you need.

```ts effect
// fragment
const deliveryLabel = Delivery.$match({
  Waiting: () => "waiting",
  Sent: ({ tracking }) => `sent ${tracking}`
})
```

```vibe es
// pending: VIP-5, VIP-7, VIP-14
// run: try Console.log(try Effect.try(() => JSON.stringify([deliveryLabel(Delivery.Waiting()), deliveryLabel(Delivery.Sent({ tracking: "parcel-8" }))])))
function deliveryLabel(delivery: Delivery) {
  return match (delivery) {
    when { _tag: "Waiting" }: "waiting";
    when { _tag: "Sent", let tracking }: `sent ${tracking}`;
    default: "unknown";
  }
}
// Output: ["waiting","sent parcel-8"]
```

**Option, Exit, and Result**. Arms can run Effect functions.

```ts effect
// fragment
const greet = (name: Option.Option<string>) =>
  Option.match(name, { onNone: () => "Hello", onSome: (n) => `Hello, ${n}` })
const failed = (outcome: Exit.Exit<User, NotFound>) => Exit.isFailure(outcome)
```

```vibe es
// pending: VIP-5, VIP-7, VIP-14
// run: try Console.log(greet(Option.some("Ada"))); try Console.log(greet(Option.none())); try Console.log(failed(Exit.fail(new NotFound({ id: "7" })))); try Console.log(failed(Exit.succeed({ id: "1", name: "Ada" })))
function greet(name: Option.Option<string>) {
  return match (name) {
    when Option.Some(let n): `Hello, ${n}`;
    when Option.None: "Hello";
  }
}

function failed(outcome: Exit.Exit<User, NotFound>) {
  return outcome is Exit.Failure
}
// Output: Hello, Ada
// Output: Hello
// Output: true
// Output: false
```

**Test and bind**. Bindings in an `is` work in an `if` or `while` condition.

```ts effect
// fragment
const firstFailure = (outcome: Exit.Exit<User, NotFound>) =>
  Exit.isFailure(outcome) && Cause.hasFails(outcome.cause) ? Cause.pretty(outcome.cause) : "ok"
```

```vibe es
// pending: VIP-5, VIP-7, VIP-14
// run: try Console.log(firstFailure(Exit.succeed({ id: "1", name: "Ada" }))); try Console.log(firstFailure(Exit.fail(new NotFound({ id: "7" }))).includes("NotFound"))
function firstFailure(outcome: Exit.Exit<User, NotFound>) {
  if (outcome is Exit.Failure(let cause) && Cause.hasFails(cause)) return Cause.pretty(cause)
  return "ok"
}
// Output: ok
// Output: true
```

## Wrap TypeScript calls

**Wrap TypeScript calls**. Call a known nonthrowing function directly. Wrap a potentially throwing function with `Effect.try`. Use `sync` for a function that can't throw; when a function may throw and its failure should be a defect, use `orDie(Effect.try(() => …))`. Always wrap Promises: `tryPromise` for a function that may throw, `promise` for one that can't. Callback arrows capture locals normally.

**Built-in exceptions.** VibeLang ships `@throws` annotations for JavaScript's globals: `JSON.parse` throws `SyntaxError`, and `decodeURI` and `decodeURIComponent` throw `URIError`. Wrap these calls with `Effect.try` before running them with `try` in an effect function. Use its `catch` option to map the error. Inside TypeScript's `Effect.gen`, a plain `JSON.parse` throw is a defect.

Use injected services for platform APIs that Effect covers. Keep `node:*` value imports and Node.js globals in a `.ts` companion file. The following companions supply the foreign APIs for this comparison:

```ts
// node-apis.ts
// types: node
export { uptime } from "node:os"
export { statfs } from "node:fs/promises"
import { EventEmitter } from "node:events"

/** @throws {never} */
export function makeTicker() {
  const ticker = new EventEmitter()
  ticker.on("newListener", () => queueMicrotask(() => ticker.emit("tick", 7)))
  return ticker
}

/** @throws {never} */
export function onceTick(ticker: EventEmitter, listener: (n: number) => void): void {
  ticker.once("tick", listener)
}

/** @throws {never} */
export function offTick(ticker: EventEmitter, listener: (n: number) => void): void {
  ticker.off("tick", listener)
}
```

```ts
// web-apis.ts
export function generateKey() {
  return crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"])
}
```

```ts effect
// fragment
import { uptime } from "node:os"
import { statfs } from "node:fs/promises"
const up = Effect.try(() => uptime())
const parsed = Effect.try({ try: () => JSON.parse(text), catch: (error) => new BadJson({ error }) })
const key = Effect.tryPromise(() => crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]))
const free = Effect.tryPromise({ try: async () => (await statfs(path)).bavail, catch: (error) => new NoDisk({ error }) })
const tick = Effect.callback<number>((resume) => {
  const listener = (n: number) => resume(Effect.succeed(n))
  ticker.once("tick", listener)
  return Effect.sync(() => ticker.off("tick", listener))
})
const name = await Effect.runPromise(greetUser("1"))
```

```vibe es
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-12, VIP-13, VIP-14, VIP-33
// run: provide Logger.layer([Logger.make(({ message }) => console.log(...(message as unknown[])))]) { const ticker = try sync(() => makeTicker()); const value = try wrappedCalls('{"ok":true}', ".", ticker); try Console.log(try Effect.try(() => JSON.stringify({ ...value, up: typeof value.up, key: value.key.type, free: typeof value.free }))) }
import { makeTicker, offTick, onceTick, statfs, uptime } from "./node-apis.ts"
import type { EventEmitter } from "node:events"
import { generateKey } from "./web-apis.ts"

error BadJson { error: unknown }
error NoDisk { error: unknown }

effect function wrappedCalls(text: string, path: string, ticker: EventEmitter) {
  const up = try Effect.try(() => uptime())
  const parsed = try Effect.try({ try: () => JSON.parse(text), catch: (error) => new BadJson({ error }) })
  const key = try tryPromise(() => generateKey())
  const free = try tryPromise({ try: async () => (await statfs(path)).bavail, catch: (error) => new NoDisk({ error }) })
  const tick = try callback<number>((resume) => {
    const listener = (n: number) => resume(succeed(n))
    onceTick(ticker, listener)
    return sync(() => offTick(ticker, listener))
  })
  const name = try tryPromise(() => greetFromTypeScript())
  return { up, parsed, key, free, tick, name }
}

async function greetFromTypeScript() {
  return await runPromise(greetUser("1"))
}
// Output: Hello, Ada
// Output: {"up":"number","parsed":{"ok":true},"key":"secret","free":"number","tick":7,"name":"Ada"}
```

**TypeScript companion files**. Import a `.ts` file normally. Plain functions and `async` functions keep their TypeScript behavior. This helper matches the Effect comparison:

```ts
// links.ts
// types: node
import { lstatSync } from "node:fs"
/** @throws {never} */
export function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
```

```ts effect
// fragment
// links.ts
import { lstatSync } from "node:fs"
export function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
// main.ts
import { isSymbolicLink } from "./links.ts"
const linked = (path: string) => Effect.sync(() => isSymbolicLink(path))
```

```vibe es
// pending: VIP-5, VIP-6, VIP-14
// run: try Console.log(try linked("."))
import { isSymbolicLink } from "./links.ts"

const linked = (path: string) => sync(() => isSymbolicLink(path))
// Output: false
```

## Fibers

**Fork and join**. `fork` creates a child owned by the current fiber. The child is interrupted when its parent ends. Join each fiber with `join`.

```ts effect
// fragment
const user = yield* Effect.forkChild(getUser("1"))
const orders = yield* Effect.forkChild(getOrders("1"))
return [yield* Fiber.join(user), yield* Fiber.join(orders)]
```

```vibe es
// pending: VIP-1, VIP-5, VIP-14, VIP-17
// run: { const jsonValue = try both(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function both() {
  const user = fork getUser("1")
  const orders = fork getOrders("1")
  return [join user, join orders]
}
// Output: [{"id":"1","name":"Ada"},1]
```

**Wait for several**. `try.all` behaves like `Promise.all`: it starts each element in its own fiber, keeps the array's shape, and a failure interrupts the rest. Use `try all(record, { concurrency: "unbounded" })` to keep object keys.

```ts effect
// fragment
const [user, orders] = yield* Effect.all([getUser("1"), getOrders("1")], { concurrency: "unbounded" })
const pair = yield* Effect.all({ user: getUser("1"), orders: getOrders("1") }, { concurrency: "unbounded" })
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-18
// run: { const jsonValue = try many(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function many() {
  const [user, orders] = try.all [getUser("1"), getOrders("1")]
  const pair = try all({ user: getUser("1"), orders: getOrders("1") }, { concurrency: "unbounded" })
  return { user, orders, pair }
}
// Output: {"user":{"id":"1","name":"Ada"},"orders":1,"pair":{"user":{"id":"1","name":"Ada"},"orders":1}}
```

**First success, all outcomes**. `try.any` waits for the first success. `try.allSettled` returns each element's full outcome as an `Exit`: success, typed failure, defect, or interruption. The whole never fails, as `Promise.allSettled` never rejects. The explicit equivalent is `try.all [exit(a()), exit(b())]`.

```ts effect
// fragment
const fastest = yield* Effect.raceAll([getUser("1"), getUser("2")])
const outcomes = yield* Effect.all([Effect.exit(getUser("1")), Effect.exit(getOrders("1"))], { concurrency: "unbounded" })
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-18
// run: const value = try outcomes(); try Console.log(value.fastest.name); try Console.log(try Effect.try(() => JSON.stringify(value.results.map((result) => result._tag)))); { const jsonValue = (try.allSettled [getUser("missing"), getOrders("1")]).map((result) => result._tag); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; { const jsonValue = (try.all [exit(die("defect")), exit(getOrders("1"))]).map((e) => e._tag); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function outcomes() {
  const fastest = try.any [getUser("1"), getUser("2")]
  const results = try.allSettled [getUser("1"), getOrders("1")]
  return { fastest, results }
}
// Output: Ada
// Output: ["Success","Success"]
// Output: ["Failure","Success"]
// Output: ["Failure","Success"]
```

**Fork scoped work**. `fork.scoped` attaches a fiber to the current Scope. `scoped` closes that scope and interrupts the worker when the operation ends.

```ts effect
// fragment
const withHeartbeat = Effect.scoped(Effect.gen(function* () {
  yield* Effect.forkScoped(Effect.forever(Effect.andThen(Effect.log("tick"), Effect.sleep("1 second"))))
  return yield* getUser("1")
}))
```

```vibe es
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-17
// run: provide Logger.layer([]) { try Console.log((try withHeartbeat()).name) }
effect function withHeartbeat() {
  return try scoped(effect {
    fork.scoped forever(andThen(log("tick"), sleep("1 second")))
    return try getUser("1")
  })
}
// Output: Ada
```

**Detached and scoped fibers**.

```ts effect
// fragment
yield* Effect.forkDetach(getUser("1"))
const scope = yield* Scope.make()
const fiber = yield* Effect.forkIn(getUser("2"), scope)
```

```vibe es
// pending: VIP-1, VIP-5, VIP-14, VIP-17
// run: try Console.log(Exit.isFailure(try Fiber.await(try background())))
effect function background() {
  fork.detached getUser("1")
  const scope = try Scope.make()
  const fiber = fork.in(scope) getUser("2")
  try Scope.close(scope, Exit.void)
  return fiber
}
// Output: true
```

**Wait for a Deferred**. Run the Effect returned by `Deferred.await` with `try`.

```ts effect
// fragment
const ready = yield* Deferred.make<string>()
yield* Deferred.succeed(ready, "go")
const value = yield* Deferred.await(ready)
```

```vibe es
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try signal())
effect function signal() {
  const ready = try Deferred.make<string>()
  try Deferred.succeed(ready, "go")
  return try Deferred.await(ready)
}
// Output: go
```

**Race**. `try.race` behaves like `Promise.race`: the first to finish wins, success or failure, and the rest are interrupted. Use Effect blocks when a branch needs several statements; poll with `Queue.poll` and an `if`.

```ts effect
// fragment
const next = yield* Effect.raceFirst(
  Effect.map(Queue.take(jobs), (job) => `ran ${job}`),
  Effect.as(Effect.sleep("1 second"), "timeout")
)
```

```vibe es
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-18
// run: try Console.log(try next())
effect function next() {
  const jobs = try Queue.unbounded<string>()
  try Queue.offer(jobs, "build")
  return try.race [
    effect { return `ran ${try Queue.take(jobs)}` },
    effect {
      try sleep("1 second")
      return "timeout"
    }
  ]
}
// Output: ran build
```

**A concurrent loop**. At most `n` items run at once, and all finish before the loop ends.

```ts effect
// fragment
yield* Effect.forEach(ids, (id) => Effect.flatMap(getUser(id), (user) => Effect.log(user.name)), {
  concurrency: 8,
  discard: true
})
```

```vibe es
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-19
// run: try Effect.provide(logAll(["1", "2"]), Logger.layer([Logger.make(({ message }) => console.log(...(message as unknown[])))]))
effect function logAll(ids: string[]) {
  for concurrent(8) (const id of ids) {
    try log((try getUser(id)).name)
  }
}
// Output: Ada
// Output: Ada
```

