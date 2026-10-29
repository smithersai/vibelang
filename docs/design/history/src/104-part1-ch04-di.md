### 4. Dependency injection: the R channel

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

Dependency injection is Effect's: services are `Context` keys, implementations are `Layer`s, and `Effect.provide` supplies them. VibeLang removes the ceremony and checks the dependency graph at compile time.

#### Declaring a service

```ts effect
class Users extends Context.Service<Users, {
  find(id: string): Effect.Effect<User, UserNotFound>
  rename(id: string, name: string): Effect.Effect<void, UserNotFound>
}>()("app/Users") {}
```

```ts es
service Users {
  find(id: string): User!UserNotFound
  rename(id: string, name: string): void!UserNotFound
}
```

`service Users { ... }` declares a service that does the job of the class on the left. Its members have no bodies (D128, D223). It is short for `abstract class Users { ... }` in which every member without a body is abstract and every value member is also readonly; static members, such as a layer, stay as written (D128). The older spelling `service class Users { ... }` still compiles, with warning EK2120. An abstract class whose instance members are all abstract is a service however it is written. The compiler checks each rule:

- **What makes a class a service.** In a `.vibe` file, a class is a service when it is `abstract`, has no `extends` clause and no type parameters, and every instance member is abstract: methods with full contracts, and `abstract readonly` values. Static members are allowed and stay on the class. An abstract class with a concrete instance member is an ordinary class.
- **Identity.** Effect identifies a service by its key string, and two services with the same string silently share a slot. The compiler derives the key from the package, module path, and class name (`@acme/app/src/users#Users`), unless the body writes one, `static readonly key = "app/Users"`, as a migrated service does to keep its key, and rejects a duplicate anywhere in the program (EK3001, D501). Two installed copies of one package version are one declaration to TypeScript (D427) and carry one key, so they are one service, as Effect's key string makes them at run time.
- **Each service is its own type.** TypeScript compares types by shape, so two services with the same members would be one type: providing one would type-check as providing the other, and the program would die at run time with `Service not found`. As a type, a service's name is Effect's identifier, whose key makes it nominal: nothing but that service satisfies it (below, D501).
- **Contracts are written out.** A service has no body to infer from, so each method states its contract, `A!E!R` or `Effect<A, E, R>` (EK2101, Chapter 14).
- **A service is a key, not a base class.** `extends Users` (EK3002), `new Users()` (EK3003), `instanceof Users` (EK3004), and a generic service class (EK3005) are errors. Implement a service with an object literal or a class that `implements Users`, which checks the class against the service's shape.

```text
error EK3002: A class cannot extend a service.
  users-memory.vibe:1:28   class UsersInMemory extends Users {
  Implement it instead:  class UsersInMemory implements Users { … }
```

The declaration compiles to the class Effect TypeScript writes, and its declaration file is that class's (D501):

```ts gen
export class Users extends Context.Service<Users, {
  find(id: string): Effect.Effect<User, UserNotFound>
  rename(id: string, name: string): Effect.Effect<void, UserNotFound>
}>()("@acme/app/src/users#Users") {}
```

#### What a service's name means

A service has two types, as every Effect `Context.Key<Identifier, Shape>` has. The rules [Rule] (D501):

- **The identifier.** As a type, `Users` is the service's identifier: the instance type of Effect's class, which carries the service's key as a literal type, `key: "@acme/app/src/users#Users"`, beside Effect's own `ServiceTypeId`. Only identifiers appear in R, in a layer's outputs, and in what a provider removes from R. That is a statement about assignability, not a separate check: a structural type in R is no service's identifier, so no provider removes it, and TypeScript's assignability error reports it where R must be discharged, at an entry or a caller's contract; no EK code reports it. A type is assignable to `Users` only if it carries `Users`'s key, so neither a structural type with the same members nor another service can stand for `Users`.
- **The shape.** `Users.Shape`, which Effect spells `Context.Service.Shape<typeof Users>` and declaration files write so, is the members alone, the type of an implementation; a `.vibe` file reads `S.Shape` that way for every service key `S`, a TypeScript one included, and accepts Effect's other spelling, `typeof S.Service`, as the same type. Where `S`'s own declaration, or a namespace merged with it, declares a type member named `Shape`, `S.Shape` is that member, as TypeScript reads it, and the shape is spelled `typeof S.Service` there (D519). `Layer.succeed(Users, impl)`, `Layer.effect(Users) { … }`, `Effect.provideService(p, Users, impl)`, `provide Users = impl`, and a service default check their implementation against it, and `implements Users` in a `.vibe` file checks the class against it and is emitted `implements Context.Service.Shape<typeof Users>`.
- **The key.** As a value, `Users` is Effect's class, a `Context.Key<Users, Users.Shape>`, so `Layer.succeed`, `Effect.provideService`, and `yield* Users` work as with any `Context.Service` class. `Users()` returns the implementation in effect, typed as the shape, as `yield* Users` gives it; a parameter that takes one is typed `Users.Shape`, and one typed `Users` takes the identifier, as in Effect TypeScript.
- **Same service, same key.** Two requirements are the same service exactly when their identifiers carry the same key. EK3001 makes a key name one declaration, so a requirement is discharged only by a provider of that declaration's key.

`service Name: Type` follows the same rules with `Type` as the shape, `Context.Service<Name, Type>()(key)`, and `Name()` returns the shape.

Effect's class form is the output because it already makes R nominal: the key's literal type is part of the identifier, so `Effect<number, never, { get(): number!! }>` cannot be relabeled as a requirement of either of two services with that method (D361, D501). Earlier versions wrote an interface of the shape's members plus a VibeLang brand, so that a parameter typed `db: Users` took an implementation; that changed every migrated service's declaration, and D501 replaced it.

The syntax takes nothing from TypeScript: calling an abstract member through its class (`Users.find(id)`) is error TS2339 today, and calling a class without `new` (`Users()`) is TS2348, so VibeLang gives both a meaning. Fully abstract classes are also rare: Smithers has none in 4,461 files, and opencode has five in 3,235, whose only fully abstract one extends another class.

A `Context.Service` written in TypeScript, as a class or as a value like Effect's `FileSystem`, is also a service, used the same way.

#### A service of any shape

```ts effect
class Prefix extends Context.Service<Prefix, string>()("app/Prefix") {}
class Search extends Context.Service<Search, SearchApi>()("app/Search") {}
```

```ts es
service Prefix: string
service Search: SearchApi {
  static readonly layer = Layer.succeed(Search, searchApi)
}
```

`service Name: Type` declares a service whose implementation has any type: an interface declared elsewhere, a primitive, or a function type (D281). It does the job of the class on the left, with the key derived as above (D93). The body is optional and holds only static members, such as a layer; an instance member there is EK2103, because the shape already states what an implementation has. Reading is unchanged: `Prefix()` returns the implementation and `Search.find(q)` calls a member of the shape (D41, D90). For a service whose shape is a function type, `service Format: (n: number) => string`, `Format()` returns the function and `Format()(3)` calls it; `Format(3)` is EK3007, since the key's call takes no arguments (D415). The type `Search` is the service's identifier and `SearchApi` its shape, by the rules above. A generic service is EK3005, and a static member named like a member of the shape is EK3006. The declaration is the class on the left, `class Search extends Context.Service<Search, SearchApi>()(key) {}`, and its declaration file is that class's; a service with a static default is Effect's `Context.Reference<Shape>(key, { defaultValue })` instead (D40, D501).

#### Using a service

Call its methods. Using a service adds it to R.

```ts effect
const users = yield* Users
const user = yield* users.find(id)
```

```ts es
const user = Users.find(id)
```

Calling the service with no arguments, `Users()`, returns its implementation object, like `yield* Users`. Use it inside providers and to read a service's value members:

```ts es
service Settings {
  baseUrl: string
  scale(): number!!
}

function apiUrl(path: string) {
  return `${Settings().baseUrl}/${path}`
}
// string!!Settings
```

Calling any member through the service looks the service up, so the service joins R whatever the member returns: `Path.join(a, b)`, from Effect's `Path` service, returns a string and still adds `Path`. A member that is itself an `Effect` value runs when called: `Terminal.readLine()`. A member the service declares wins over the key's own members, such as `pipe`, `use`, and `key`, so `Rpc.call(…)` reaches the service even though the key, a class, has its own `call`. A static member named like a service member is EK3006.

#### Writing a provider

A provider is a `Layer`. Build one with Effect's own `Layer.effect`, passing a function; in VibeLang the function is a block after the call, which is always the last argument (block params, D188, D376): `Layer.effect(Users) { ... }` is `Layer.effect(Users, () => { ... })`. It runs its statements once, when the layer is built, and returns the implementation, an object whose members the service types (D221). Without setup, write `Layer.succeed(Users, { ... })`. The older `layer UsersLive: Users { ... }` declaration (D129) still compiles, with warning EK2121 and a quick fix that rewrites it.

```ts effect
const UsersLive = Layer.effect(Users, Effect.gen(function* () {
  const db = yield* Database
  return Users.of({
    find: Effect.fn("Users.find")(function* (id) {
      const rows = yield* db.query("select * from users where id = $1", [id]).pipe(Effect.orDie)
      if (rows.length === 0) return yield* new UserNotFound({ id })
      return toUser(rows[0])
    }),
    rename: Effect.fn("Users.rename")(function* (id, name) {
      yield* db.execute("update users set name = $1 where id = $2", [name, id]).pipe(Effect.orDie)
    })
  })
}))
// Layer<Users, never, Database>
```

```ts es
const UsersLive = Layer.effect(Users) {
  const db = Database()              // runs once, when the layer is built
  return {
    find(id) {
      const rows = Effect.orDie(() => db.query("select * from users where id = $1", [id]))
      if (rows.length === 0) throw new UserNotFound({ id })
      return toUser(rows[0])
    },
    rename(id, name) {
      Effect.orDie(() => db.execute("update users set name = $1 where id = $2", [name, id]))
    }
  }
}
// Layer<Users, never, Database>
```

`Database()` captures the implementation in `db` when the layer is built, so `Database` is a requirement of *building* `UsersLive`, not of calling `Users.find`. Code that calls `Users.find` needs only `Users`.

The compiler checks each method against the service's contract. Without the `Effect.orDie`, the database's `DbError` would escape:

```text
error EK2001: DbError can escape UsersLive.find, but Users.find's contract allows only UserNotFound.
  users-live.vibe:5:20   const rows = db.query("select * from users where id = $1", [id])
                                    ^^^^^^^^ can fail with DbError
  Handle it, add DbError to Users.find's contract, or make it a defect with Effect.orDie.
```

Effect 4 code often keeps the default Layer on the service class as `static readonly layer`. A service can too, because static members stay on the class:

```ts es
service Users {
  find(id: string): User!UserNotFound
  rename(id: string, name: string): void!UserNotFound

  static readonly layer = Layer.effect(Users) {
    const db = Database()
    return {
      find(id) { … },
      rename(id, name) { … }
    }
  }
}
```

An implementation can also be a class that `implements` the service; its methods are VibeLang methods, checked against the service's contracts:

```ts es
class UsersInMemory implements Users {
  readonly #rows = new Map<string, User>()

  find(id: string) {
    const user = this.#rows.get(id)
    if (user === undefined) throw new UserNotFound({ id })
    return user
  }

  rename(id: string, name: string) {
    this.#rows.set(id, { ...this.find(id), name })
  }
}

const UsersInMemoryLive = Layer.sync(Users, () => new UsersInMemory())
// Layer<Users, never, never>
```

#### Constructors and defaults

Effect 4's `make` option becomes a static method, and a service that should work without any provider declares a default:

```ts es
service Sessions {
  get(token: string): Session | undefined!!
  set(token: string, session: Session): void!!

  static make(): Sessions.Shape {                // plain by its annotation: Layer.sync calls it synchronously (D500)
    const entries = new Map<string, Session>()
    return {
      get: (token: string) => entries.get(token),
      set: (token: string, session: Session) => { entries.set(token, session) }
    }
  }

  static readonly layer = Layer.sync(Sessions, () => Sessions.make())
}

service FeatureFlags {
  newCheckout: boolean
  static readonly default: FeatureFlags.Shape = { newCheckout: false }
}

function checkoutPage(cartId: string) {
  return FeatureFlags().newCheckout ? newCheckout(cartId) : classicCheckout(cartId)
}
// FeatureFlags is not in R: it always has a value
```

A service with `static readonly default` compiles to Effect's `Context.Reference`, `const FeatureFlags = Context.Reference<{ readonly newCheckout: boolean }>(key, { defaultValue: () => … })`, with its shape written in place, and its declaration file writes that constant (D501). It declares a value and no identifier type, as Effect's reference does: `FeatureFlags.Shape` in a `.vibe` file names the shape it holds, and `FeatureFlags` written as a type, in a contract's R or an `implements` clause, is TypeScript's TS2749, since a reference never enters R (D519). Code using it never needs a provider; `Effect.provideService(() => …, FeatureFlags, { newCheckout: true })` overrides it for a region. Effect's own `Context.Reference("app/Flag", { defaultValue: () => false })` also works unchanged: the call's declared return type is a key, not `Effect`, so the call returns the key without running it (Chapter 13).

The default is an implementation like any other [Rule]. Its initializer is checked against the service's shape as `Layer.succeed`'s argument is: a value whose type does not fit the shape is TS2322, and a member whose failures or call-time requirements exceed its contract is EK2001 or EK3101. The service leaves R only because the default supplies it, so a default that does not fit leaves the program rejected, never running with a value of the wrong type (D362).

#### Providers that hold resources

A provider can acquire a resource that lives as long as the layer, such as a connection pool. Acquire it without `using`:

```ts effect
const DatabaseLive = Layer.effect(Database, Effect.gen(function* () {
  const config = yield* DatabaseConfig
  const pool = yield* Postgres.connect(config.url)
  return Database.of({
    query: (sql, params) => pool.query(sql, params),
    execute: (sql, params) => pool.execute(sql, params)
  })
}))
// Layer<Database, ConnectError, DatabaseConfig>
```

```ts es
const DatabaseLive = Layer.effect(Database) {
  const pool = Postgres.connect(DatabaseConfig().url)    // no `using`: the pool lives as long as the layer
  return {
    query(sql, params) { return pool.query(sql, params) },
    execute(sql, params) { return pool.execute(sql, params) }
  }
}
// Layer<Database, ConnectError, DatabaseConfig>
```

`Postgres.connect` returns `Pool!ConnectError!Scope`. Without `using`, the pool belongs to whoever supplies the `Scope` (Chapter 6); `Layer.effect` supplies the layer's own Scope, as in Effect today, so the pool closes when the program that provided `DatabaseLive` finishes. `using pool = …` would close it when the provider's block returned, before any query ran: a block that declares `using` owns that resource, a layer's setup block included (Chapter 6). D222 said otherwise; the block rule stands (D344).

#### Requirements that would leak

Sometimes a method looks up another service on each call instead of capturing it when the layer is built. That lookup happens in the *caller's* context, so its requirement belongs to the caller, and the service contract must say so. The compiler catches the mismatch:

```ts es
const UsersAudited = Layer.effect(Users) {
  const db = Database()
  return {
    find(id) {
      Audit.record(`users.find ${id}`)    // looked up on every call
      return findIn(db, id)
    },
    rename(id, name) { renameIn(db, id, name) }
  }
}
```

```text
error EK3101: UsersAudited.find looks up Audit each time it is called, but
  Users.find(id: string): Effect<User, UserNotFound, never>
  allows no call-time requirements.
  users-audited.vibe:5:7   Audit.record(`users.find ${id}`)
  Capture it once:      const audit = Audit()   …   audit.record(…)
  Or declare it:        abstract find(id: string): Effect<User, UserNotFound, Audit>
```

Either fix is honest: capturing makes `Audit` a requirement of building the layer; declaring it makes every caller of `Users.find` provide `Audit`.

#### Composing an application

```ts effect
const AppLive = Layer.mergeAll(UsersLive, MailerLive).pipe(
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(DatabaseConfigLive)
)
```

```ts es
const AppLive = wire(UsersLive, MailerLive, DatabaseLive, DatabaseConfigLive)
// Layer<Users | Mailer | Database | DatabaseConfig, ConfigError | ConnectError, never>
```

`wire` reads each provider's inputs and outputs from its `Layer<Out, E, In>` type, orders them, and generates the composition on the left; the argument expressions still run in the order written, each once. Its value is the errors: today Effect reports a missing provider only as a leftover requirement where you run the program, silently picks one of two providers for the same service, and hangs on some cycles. `wire` reports all three at compile time:

```text
error EK3201: Nothing provides Smtp, which this program needs.
  welcome → Mailer.send → MailerLive needs Smtp
error EK3202: Two providers for Users: UsersLive (src/users.vibe:12) and UsersTest (test/fakes.vibe:3). Pass one.
error EK3203: These providers form a cycle: SessionsLive → Database → DatabaseLive → Sessions → SessionsLive.
```

The contract is bounded by what Layer types say [Rule]:

- **Recognized by symbol.** A call is `wire` when its callee resolves to the runtime's `wire`, through an import alias or a namespace member as well as the bare name (D363). Any other use of the name, such as storing `wire` in a variable or passing it as an argument, is EK3208: no function value can order layers by their types, and a value that silently skipped the ordering would type a graph it does not build.
- **Arguments are evaluated once, in order.** Each argument expression is evaluated once, left to right, as any call's arguments are (Chapter 13). Ordering applies to the layers those expressions produced, never to the expressions, so a layer factory with side effects runs in the order written.
- **A layer never provides its own input.** The result needs every input that no other argument provides: with arguments `L1 … Ln`, its `In` is the union over each `Li` of `Li`'s inputs minus the outputs of the other arguments. A layer that needs `S` and also provides `S`, as a decorator does, still needs `S` from another argument or from the result's `In`. `wire(L)` is `L`, with `L`'s type.
- **Partial graphs.** Inputs that no argument provides stay in the result's `In`, as with `Layer.provide`, so you can wire part of a graph. EK3201 is reported where the program's requirements must be empty: at a runner, or at a contract whose R excludes them.
- **Spread arguments.** A spread argument whose type is a tuple contributes its elements, as if written in place. A spread of an array type names no outputs and is EK3204.
- **Unknown outputs.** An argument whose type does not name its outputs, such as a value typed `Layer<any>`, is EK3204: compose it with `Layer.provide`. A Layer chosen at run time with `Layer.unwrap` has a proper type and wires normally.
- `wire` is the function its callee resolves to, however it is spelled: `import { wire as compose } from "vibelang-runtime"` and a namespace import's `Runtime.wire` are ordered as `wire` is. A spread array literal, `wire(...[UsersLive, DatabaseLive])`, and a spread tuple constant list their layers one by one; a spread whose layers `wire` cannot list, such as a call that returns a tuple, is EK3204.
- `Layer.provide`, `Layer.merge`, and the rest keep working; `wire` is optional.

#### Running with providers

```ts es
function main() {
  const name = Effect.provide(() => welcome("42"), AppLive)
  log(`welcomed ${name}`)
}
// void!UserNotFound | MailError | ConfigError | ConnectError!
```

`main`'s contract shows what providing costs: `ConfigError` and `ConnectError` come from building the layers. The layers are built when `Effect.provide` runs, shared by everything inside it, and released in reverse order when it finishes. If building a layer fails, the program fails with that error and releases anything already acquired.

`provide AppLive { ... }` provides a layer to a block (D130, D172); the keyword matches `Effect.provide`. It is short for `Effect.provide(() => { ... }, AppLive)`, except that its statements are code of the enclosing function: `return` returns from the function, and `break` and `continue` leave its loops. Its errors are the block's and the layer's; its requirements are the block's that the layer does not provide, plus the layer's own. Like `Effect.provide`, it accepts a layer, a non-empty list of layers, or a `Context`, and nothing else (below). A `provide` block at a module's top level would run a program there, so it is EK1001.

```ts es
function main() {
  provide AppLive {
    log(`welcomed ${welcome("42")}`)
  }
}
```

A provider written `Key = value` provides one service without a layer, and comma-separated providers share one block (D173). `provide AppLive, Mailer = fakeMailer { ... }` provides `Mailer` as `Effect.provideService` does and builds only `AppLive` with `Effect.provide`, so the block's requirements drop `Mailer` as well as what `AppLive` provides. A block with only `Key = value` providers builds no Layer: no Scope and no Layer MemoMap surround its statements. The providers evaluate in the order the block lists them; a later entry for one key replaces an earlier one, and an entry wins over a layer in the same list that provides its key. An effect module whose same-named export is a service key stands for that key, resolved through the module's declarations as D311 resolves it: `provide Clock = testClock` provides `Clock.Clock`, and `provide Scheduler = fifo` installs a scheduler (D174). `provide(AppLive, Mailer = fakeMailer) { ... }`, with the provider list in parentheses, is the same statement. The analyzer reads a provider list element by element, because the list's own type merges its layers into one union, which collapses to `Layer<never>` for a layer that provides nothing (D175).

```ts es
const fakeMailer = { send: (to: string, text: string) => log(`to ${to}: ${text}`) }

function preview() {
  provide AppLive, Mailer = fakeMailer {
    log(`welcomed ${welcome("42")}`)
  }
}
// void!UserNotFound | MailError | ConfigError | ConnectError!
```

Each `Effect.provide` builds its layers once, so two sibling `provide` calls build them twice:

```ts es
function counts() {
  const users = Effect.provide(() => countUsers(), AppLive)      // opens a database pool
  const orders = Effect.provide(() => countOrders(), AppLive)    // opens a second pool
  return users + orders
}
```

Provide the application layer once, at `main`. A program with several entry points, such as a web server whose framework calls each handler, builds one `ManagedRuntime` from the layer and runs every entry point through it (Chapter 12).

#### What a provider provides

A provider removes from R only the services it provides on every path through the program. The same rule covers a `provide` block, `Effect.provide`, and `Effect.provideService`; Effect's own types accept no more (`Effect.provide` takes a layer, a non-empty tuple of layers, or a `Context`). The rules [Rule] (D362):

| Provider | What it provides | What it adds to E and R |
| --- | --- | --- |
| A value of type `Layer<Out, E, In>` | `Out` | `E` and `In` |
| A value of type `Context<S>` | `S` | Nothing |
| `Key = value` | `Key`'s identifier; `value` is checked against `Key`'s shape | Nothing |
| A list, written `provide A, B { … }` or as an array literal | What each element provides, read element by element (D175); a spread element provides what each required element of its tuple type provides, and a spread of an array type provides nothing | The union of the elements' |
| A value of a non-empty tuple type | What each element the tuple type requires provides | The union of the elements' |
| A value whose type is a union, such as `flag ? UsersLive : UsersTest` | Only the services that every member of the union provides | The union of every member's |
| Anything else: an array type that may be empty, such as `Layer<A>[]`, a value that is neither a layer nor a `Context`, `any`, or `unknown` | Nothing: EK3207 | |

A union provides the intersection of its members' outputs because only one member is there when the program runs: `provide (flag ? AliceLive : BobLive) { … }` provides neither `Alice` nor `Bob` unless both layers provide both. An empty list provides nothing, so a provider that may be empty cannot discharge a requirement.

Each provider expression is evaluated once, in the order written, before any layer is built; the block's statements run after the layers are built. A layer value that appears twice in one provider is built once (D21).

#### Testing with fake services

```ts effect
const UsersTest = Layer.succeed(Users, Users.of({
  find: (id) => Effect.succeed({ id, name: "Ada", email: "ada@example.com" }),
  rename: () => Effect.void
}))

it.effect("welcome returns the user's name", () =>
  Effect.gen(function* () {
    const name = yield* welcome("42").pipe(Effect.provide(Layer.mergeAll(UsersTest, MailerTest)))
    assert.strictEqual(name, "Ada")
  }))
```

```ts es
const UsersTest = Layer.succeed(Users, {
  find(id) { return ({ id, name: "Ada", email: "ada@example.com" }) },
  rename() {}
})

it.effect("welcome returns the user's name") {
  const name = Effect.provide(() => welcome("42"), wire(UsersTest, MailerTest))
  assert.strictEqual(name, "Ada")
}
```

To replace one service for part of a program, provide it around that part; the override applies only inside:

```ts es
function welcomeQuietly(id: string) {
  return Effect.provideService(() => welcome(id), Mailer, { send: () => {} })
}
```

#### What a function sees, and when

- A service call uses the providers in effect where the call runs. Code inside `welcomeQuietly` sees the quiet `Mailer`; code outside does not.
- After a pause (`Effect.sleep`, a network call), a function sees the same providers it saw before.
- A forked fiber starts with the providers of the code that forked it (Chapter 7).
- An implementation you captured, `const db = Database()`, stays that implementation even if `Database` is overridden later.
