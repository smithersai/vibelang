# Managing Services

A service is a named capability a program uses without passing an implementation through every function. `service` declares its key and members' contracts; looking up its implementation with `try` adds the identifier to the `R` channel. A layer or a `provide` block supplies the implementation.

[Upstream page](https://effect.website/docs/v4/requirements-management/services)

## Declaring typed service keys

```vibe
// run: provide Sequence = { next: effect () => 17 }, Reporter = { write: (message) => Console.log(message) } { const sequence = try Sequence; const reporter = try Reporter; try reporter.write(`ticket-${try sequence.next()}`) }
service Sequence {
  next(): number!!
}

service Reporter {
  write(message: string): void!!
}

effect function stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}
// Output: ticket-17
```

A service body lists members as a TypeScript `interface` does: methods and properties, separated by `;`, a newline or `,`. Write an Effect-returning member as `read(): number!!`; a member can also have a plain type, such as `lookup(): number`, as a `Context.Service` shape can. `readonly` value members are allowed, and other value members are mutable. A service holds only contracts: implement its members in a layer, and keep layers and helpers in ordinary declarations beside it.

Export a service with `export service Counter { readonly value: number }`, or declare it and write `export { Counter as default }`.

## Declaring a service of any shape

```vibe
// run: provide Prefix = "> ", Search = { find: effect (query) => `hit:${query}` } { try Console.log(try lookup("vibe")) }
interface SearchApi {
  find(query: string): string!!
}

service Search: SearchApi { static readonly key = "app/Search" }
service Prefix: string { static readonly key = "app/Prefix" }

effect function lookup(query: string) {
  const prefix = try Prefix
  const search = try Search
  return `${prefix}${try search.find(query)}`
}
// Output: > hit:vibe
```

Write `service Name: Type { … }` when the implementation has a type declared elsewhere, a primitive such as `string`, a function, or another TypeScript type. The annotation supplies the whole shape, and the body holds only `static readonly key` and `static readonly defaultValue`.

Read the implementation with `const search = try Search`, then run an Effect-returning member with `try search.find(q)`; `try Prefix` returns the string implementation. The type `Search` is the service's identifier; use `SearchApi` or `Context.Service.Shape<typeof Search>` for its implementation. The Effect TypeScript counterpart, `class Search extends Context.Service<Search, SearchApi>()("app/Search") {}`, has the same explicit key.

## Requesting and supplying implementations

```vibe
// run: try Console.log(try fixedLabel()); provide Sequence = { next: effect () => 23 } { try Console.log(try nextLabel(), try readImplementation()) }
// expect-warning: EK4836
effect function nextLabel() {
  const sequence = try Sequence
  return `ticket-${try sequence.next()}`
}
// string!!Sequence

effect function fixedLabel() {
  return try provideService(nextLabel(), Sequence, {
    next: effect () => 17
  })
}
// string!!

effect function readImplementation() {
  const sequence = try Sequence
  return try sequence.next()
}
// number!!Sequence
// Output: ticket-17
// Output: ticket-23 23
```

`try Sequence` looks up the implementation, to capture it or read value members; `try sequence.next()` runs its Effect-returning method. Supply every requirement before running the program.

`provideService` removes the dependency only within its program. Nested overrides are local, a captured implementation stays the same object across later overrides or pauses, and forked fibers inherit the context present when they start.

```vibe
// run: provide Settings = { baseUrl: "https://example.test" } { try Console.log(try endpoint("tickets")) }
service Settings {
  baseUrl: string
}

effect function endpoint(path: string) {
  const settings = try Settings
  return `${settings.baseUrl}/${path}`
}
// string!!Settings
// Output: https://example.test/tickets
```

Read value members from the implementation, as `settings.baseUrl` after `const settings = try Settings`. Looking up a service adds it to `R` whatever its members return, including when a `catch` handles a member's typed failure or a pipe transforms its Effect: `const path = try Path.Path; path.join(a, b)` returns a plain string and still requires Effect's `Path` service. Wrap a synchronous member call that may throw with `Effect.try` and run it with `try`; wrap a Promise with `tryPromise` and run it with `try`. A member that is itself an Effect value runs with `try`, as in `try terminal.readLine`.

The key is not the implementation. `Users.find(id)` does not look up an implementation and reports TypeScript's missing-property error; `Users.name` and `Users.key` still read the key. Write `(try Users).find(id)` to build a member's Effect, and `try (try Users).find(id)` to run it. The member program can also be the operand of `catch` or `|>`; the service lookup still happens explicitly.

## Service identifiers and shapes

```vibe
type SequenceImplementation = Sequence.Shape
type SameImplementation = Context.Service.Shape<typeof Sequence>
```

A service has two types, as an Effect `Context.Key` has, because it is Effect's own `Context.Service` class. As a type, `Sequence` is the service's identifier, which carries its key, so neither another service with the same members nor a structural type such as `{ next(): number!! }` can stand for it in `R`. `Sequence.Shape`, which Effect spells `Context.Service.Shape<typeof Sequence>`, is the members alone, the type of an implementation. `Layer.succeed`, `Layer.effect`, `provideService`, `provide Sequence = …`, and a `defaultValue` factory check an implementation against the shape, and `implements Sequence.Shape` in a `.vibe` file checks a class against it.

`try Sequence` returns the implementation typed as the shape, as `yield* Sequence` does. The same lookup works for imported keys and inside exported `effect` functions. Type a parameter or a default implementation `Sequence.Shape`; a parameter typed `Sequence` takes the identifier, as in Effect TypeScript. A TypeScript class implements the emitted service with `implements Context.Service.Shape<typeof Sequence>`. The emitted declarations also export `Sequence.Shape`, so TypeScript callers can use that name directly.

Providers infer and check the implementation from the key argument, so most layers don't need either name. At a TypeScript boundary, the shape describes the emitted implementation's Effect-returning methods.

## Combining multiple dependencies

```vibe
// run: { const jsonValue = try testAnnouncement(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
effect function announceTicket() {
  const label = try nextLabel()
  const reporter = try Reporter
  try reporter.write(`Created ${label}`)
  return label
}
// string!!(Sequence | Reporter)

const SequenceTest = Layer.succeed(Sequence, {
  effect next() { return 17 }
})
const ReporterTest = Layer.succeed(Reporter, {
  effect write(_message) {}
})

effect function testAnnouncement() {
  provide Layer.merge(SequenceTest, ReporterTest) { return try announceTicket() }
}
// Output: "ticket-17"
```

A union in `R` needs both capabilities. Layers supply the group together; `Layer.merge` combines independent layers, and `Layer.provide` feeds one layer's outputs into another's construction requirements. Inputs no argument provides stay requirements of the resulting layer, reported as missing where a runner or contract needs them satisfied. For a small local override, nest direct service provision.

```vibe
// run: try Console.log(try testWithContext())
const testContext = Context.add(
  Context.make(Sequence, { next: effect () => 17 }),
  Reporter,
  { write: effect (_message) => {} }
)

effect function testWithContext() {
  provide testContext { return try announceTicket() }
}
// Output: ticket-17
```

A `Context` holds existing implementations; a `Layer` describes how to build them. A `provide` block takes layers and `Key = value` entries, or a single `Context`, as `testWithContext` shows. `provide` is a statement, not an expression: return the value from inside its block. Keep resource-owning implementations within the lifetime that created them.

An implementation retrieved with `try Service` or typed as `Service.Shape` can be spread into another object. The spread retains its method signatures; replacements must still satisfy the declared result types. Ordinary class prototype methods are not copied by object spread.

## Requesting optional services

```vibe
// run: try Console.log(try optionalAnnouncement("hello")); provide Reporter = { write: (message) => Console.log(message) } { try Console.log(try optionalAnnouncement("hello")) }
effect function optionalAnnouncement(message: string) {
  const reporter = try serviceOption(Reporter)
  if (Option.isNone(reporter)) return false
  try reporter.value.write(message)
  return true
}
// boolean!!
// Output: false
// Output: hello
// Output: true
```

`serviceOption` returns `None` when an application service is absent and `Some(implementation)` when present, without adding the service to `R`. Calling a found implementation still carries the method errors and call-time requirements the service declares.

## Handling dependencies between services

```vibe
// run: provide ReportSettings = { prefix: "audit" } { provide ReporterLive { const reporter = try Reporter; try reporter.write("ready") } }
service ReportSettings {
  prefix: string
}

const ReporterLive = Layer.effect(Reporter, effect {
  const settings = try ReportSettings
  return {
    effect write(message) {
      try Console.log(`${settings.prefix}: ${message}`)
    }
  }
})
// Layer<Reporter, never, ReportSettings>
// Output: audit: ready
```

Capture construction dependencies in the layer factory: `try reporter.write(...)` then requires only `Reporter`, because the implementation retains `settings`. Looking up `try ReportSettings` inside `write` would add a call-time requirement, which its declared `R = never` rejects.

## Service keys

Services are nominal: the compiler derives the key from package, module path, and declaration name, so two services with identical members are different dependencies. A derived key concatenates the string package name, `/`, the package-relative file path without its final extension, `#`, and the service name.

To keep a key, such as one a `Context.Service` class wrote before migrating, write it in the body: `static readonly key = "app/Users"`. When migrating, preserve every original explicit key; deriving a new key can break providers across package boundaries or persisted identities.

Derived keys require a module-scope declaration in a package whose `package.json` has a string `name`. A local or block-scoped service, or one outside a named package, needs an explicit key (`EK0903`). [Keys](#keys) below lists the rules.

## Default implementations

A service can declare `static readonly defaultValue = () => implementation` to supply an implementation without a provider. It compiles to a `Context.Reference`. The returned implementation is checked against the service shape, as with `Layer.succeed`. [Defaults](#defaults) below lists the rules.

## Coming from Effect

`service` declarations replace hand-written `Context.Service` declarations in `.vibe` files. A `Context.Service` class there draws `EK4831`, which suggests the `service` declaration, keeping the class's key as `static readonly key`, when its members are written in the class's type argument ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)). For a class the module exports, it suggests `service Name: { … } { static readonly key = … }` with the type argument unchanged, so the package's declarations stay what they were; a class the module keeps to itself becomes `service Name { … }`. `try ServiceName` replaces yielding the key in a TypeScript generator to get its implementation; `try implementation.method()` runs an Effect-returning method.

For a class written as `class Database extends Context.Service<Database, DatabaseService>()("BetterAuth.Database") {}`, write the whole shape: `service Database: DatabaseService { static readonly key = "BetterAuth.Database" }`. It keeps the existing shape type and runtime key, without adding a shape helper or namespace.

An ordinary native `class Key extends Context.Service<…>` declares no `Key.Shape` namespace. Extract its implementation with `Context.Service.Shape<typeof Key>`, or use an explicitly declared TypeScript namespace. A member-body `service` declaration supplies its public `Shape` alias.

Service members follow TypeScript interface typing, so no Effect return type is required ([Members](#members)).

Older service forms, `service class` and `static readonly default`, are on [Migrating retired forms](../setup/migrating-retired-forms.md#legacy-service-forms).

## Rules

The rules below complete the sections above. Each names the diagnostic the compiler reports.

### Members

A service has no superclass or type parameters, and every instance member is abstract. Methods and properties declare the service's shape as in a TypeScript `interface`. Write intended types; a default factory does not infer missing member types. An omitted member type follows TypeScript, as in an interface: under `noImplicitAny`, `read()` is `TS7010` and an untyped property is `TS7008`; with the option off they are `any`. Explicit `read(): any` is valid under strict checking. VibeLang adds no diagnostic of its own and infers no Effect contract; fix `TS7010` by writing the intended return type.

Two members on one line need a separator: `a: number b: string` is `EK0908`. Insert `;` before the second member and its comments. A trailing comma is allowed. Formatting accepts every separator and preserves the member types and comments, including commas inside tuple, generic and function types.

An instance method body, a value initializer, or an accessor is `EK0902`; declare the member's contract and implement it in a layer. The same diagnostic covers:

- class-only modifiers such as `public`, `private`, `protected`, `abstract`, `declare`, `accessor`, `override`, `async` and `effect`, private names such as `#count`, and definite assignment assertions such as `count!: number`. Remove the modifier or assertion; a private name needs a public name. `readonly` belongs only on a property, not a method;
- `effect read(): number!!`: remove `effect` and keep the return type `read(): number!!`;
- constructors and index signatures, such as `[name: string]: Value`. Declare named properties and methods instead. For a dictionary implementation, declare its type separately and use an explicit `Context.Service` class, or a whole-shape service;
- construct signatures, such as `new(): T!!` and `new<T>(value: T): T!!`. Declare a named factory method or a property whose value is a constructor. A method literally named `new` can use a quoted name, `"new"(): T!!`;
- call signatures, such as `(value: string): string`, including when the service has a written shape. Declare a named method, or a property whose type is a function, such as `format: (value: string) => string`;
- a `get` or `set` accessor without a body, such as `get value(): number`, with or without a modifier such as `abstract`. Declare a property, such as `readonly value: number`, or a method;
- static members other than `static readonly key` and `static readonly defaultValue`: other static fields, methods, accessors and initialization blocks.

Rejected static members, signatures, constructors and index signatures still report independent TypeScript errors in their written types, initializers and bodies, such as an unknown name or a wrong argument type. An instance implementation or initializer does not hide errors on other static members, and independent errors in a rejected call signature's key or type parameters are still reported.

A member can have a symbol key, such as `[Symbol.iterator](): Iterator<number>`. It is part of `Name.Shape`, as in a TypeScript interface; end the member before it with `;`, because `[` otherwise continues that member.

A service's shape may have properties named `key` or `defaultValue`. They are ordinary implementation members and can coexist with the service's `static readonly key` and `static readonly defaultValue`. Read them from the implementation returned by `try Effect.service(ServiceName)`.

Service members form an object type, so a written `this` type there gets TypeScript's `TS2526` rather than referring to a service instance. For recursive members, name the implementation type; a separately declared interface can use its ordinary polymorphic `this` type and become a service's shape. Ordinary classes keep their `this` types.

Service contracts work with `noUnusedLocals` and `noUnusedParameters`. Their bodyless signatures describe an implementation; unused checks still apply to actual private implementation members.

### Declaration forms

A service needs its body, even an empty one: `service Users` alone is `EK0906`. A whole-shape declaration also needs braces: write `service Prefix: string {}` or `service Format: (value: string) => string!! {}` in a named package. A service creates a run-time key, so it cannot be ambient: `declare service Users { … }`, or a service inside a `declare namespace` or `declare module`, is `EK0907`.

A service declaration takes no `extends` or `implements` clause (`EK0904`): its identity is its key. Compose shapes with types instead, such as `find: Base.Shape["find"]`.

`export default service Counter { }` reports `EK0905`; an ordinary expression whose variable is named `service` can still follow `export default`.

Write the `service` keyword without Unicode escapes: an escaped keyword is `TS1260`. Escaped service names and ordinary identifiers keep working.

### Generic capture

A custom `service` has one key across every instantiation of its enclosing function or class. Its implementation contract must therefore use concrete types: a service cannot declare type parameters or capture an enclosing type parameter in a member contract (`EK3005`), including in a whole-shape annotation such as `service S: { value: T } { ... }`. Different specializations would share one runtime key. Use a concrete contract, or give individual members their own generic parameters independent of outer parameters.

These count as captures:

- a foreign callable's written `@throws` contract;
- explicit `this` parameter types, including in callable properties, nested types, aliases and whole-shape annotations; a member-local generic receiver remains allowed;
- conditional branches: `U extends string ? T : number` captures an enclosing `T` even when `U` belongs to the member;
- type guards and assertion signatures: `value is T` and `asserts value is T` capture an enclosing `T`, even though their ordinary return types are `boolean` or `void`.

An unused argument does not capture a type parameter: `Phantom<T>` is allowed when `interface Phantom<U> { n: number }` never uses `U`.

A rejected member does not create a service contract and does not hide `EK3005` on the declaration's type parameters; capture checks continue on the other valid contracts. For a whole-shape service, only the written shape participates in capture checking.

### Keys

A `key` that is not `static readonly` with a quoted string literal is `EK0901`. A type annotation is allowed, as in `static readonly key: string = "app/Users"`; a template literal or computed initializer is not. A malformed key reports `EK0901` without a redundant error about the generated class's static side; independent type and name errors in its initializer and type annotation remain. Each member is checked independently: an invalid member does not hide `EK0901` on a separate malformed key.

An explicit string-literal key keeps its value, including `""`. It is used for runtime lookup, the emitted key type, and duplicate-key checks; an empty literal does not request a derived key. An explicit key works in each scope, including outside every package.

An empty package name is still a string: `service Users` in `src/users.vibe` derives `/src/users#Users` when `package.json` contains `"name": ""`.

A local or block-scoped service, or one outside a named package, reports `EK0903` when it omits `static readonly key`; write an explicit key that keeps the identity its providers use. A namespace at module scope can still derive its services' keys. A function-local service still needs an explicit key when `noEmit` is enabled or `declaration` is disabled.

Without a type annotation, `Users.key` retains its string literal type when returned from a plain or `effect` function, as the native `Context.Service` key does. If a local `let value = Users.key` is reassigned to another string, write `let value: string = Users.key` to keep the mutable binding. A written key type and a `defaultValue` reference keep their existing types.

The `key` and `defaultValue` headers allow only `static readonly`, without `public`, `private`, `protected`, `declare`, optional `?` or definite `!` markers. Malformed headers report `EK0902`; invalid key literals or a missing `readonly` on `key` report `EK0901` instead. These rules also apply to a written whole shape, `service Name: Type { … }`. Remove the extra modifiers and markers, and keep an existing `readonly` initializer and type.

An `abstract class` is an ordinary TypeScript class; one written as a service draws `EK4854`: write a `service` declaration with its members and key. Implement a service with an object literal or a class that `implements` its `.Shape`.

### Defaults

`defaultValue` needs an initializer; a missing factory needs an explicit implementation. For `Layer.succeed` and a `defaultValue` factory, the compiler reports a shape mismatch as a TypeScript error, an excess member as `EK9201`, and an undeclared call-time requirement as `EK3101`.

A `defaultValue` initializer has ordinary class-field context, even when its service is declared inside an effect function. A `try` expression there is `EK0501`. Compute an effectful input before the service declaration, then capture the resulting value in its `() => Shape` default factory.

A reference declared with a member body has `Flags.Shape` for its implementation and `typeof Flags` for its key value, but no `Flags` identifier type. Writing `let value: Flags` reports `TS2749`, as for Effect's `Context.Reference`; references do not appear in `R`. An import type such as `import("./flags.vibe").Flags` reports `TS2694`; use `typeof import("./flags.vibe").Flags` for the key value.

### Whole-shape declarations

`service Database: DatabaseService { static readonly key = "app/Database" }` uses an existing type directly. The annotation can name any TypeScript type. For a service without a default, it may mention the service identifier type itself, as in `service Node: { next?: Node } { static readonly key = "app/Node" }`, or through an array, callable or type alias. Its body contains only `key` and `defaultValue`. Index signatures and constructors in that body report `EK0902`: write an index signature in the supplied shape type, and put initialization in the layer that creates the implementation.

The written type passes directly to `Context.Service<Name, Type>`, or `Context.Reference<Type>` for a default, preserving its name and modifiers, without a private shape helper or a public `Database.Shape` namespace. Outside the declaration, write the type or `Context.Service.Shape<typeof Database>`; within its own body, `Database.Shape` denotes the annotation. Body-only services keep their public `Shape` namespace. The same distinction applies to a reference declared with `defaultValue`. Key, default, ambient and generic-capture rules apply as for other services.

### Service identity

The key is a value: don't construct, extend, or use `instanceof` on it. Construction is `EK3003`, inheritance is `EK3002`, and `instanceof` or a class pattern is `EK3004`. Obtain the implementation with `try Users` and inspect its members instead. A rejected service base still reports independent TypeScript errors in its expression and type arguments, and a rejected call to a service key keeps independent TypeScript errors in its arguments, such as a nested call with missing arguments. The `EK3004` class-pattern message suggests a member pattern with a separate binding, such as `when { default: let value }` for a property named `default`.

These restrictions follow the key's identity through:

- a copy into a `const` or an object property, and parentheses;
- an intersection type such as `typeof Users & { readonly extra?: number }`;
- a generic parameter constrained to the key's value type, such as `Key extends typeof Users`, including chained constraints, intersection bounds and object properties;
- an indexed access such as `Box["key"]`, where `Box extends { key: typeof Users }`, including tuple and array element constraints;
- a union whose alternatives are all service-key value types;
- conditional aliases, including a conditional with the same key in both branches and `Extract<…>`, when every possible value is a service key;
- narrowing away `null` and `undefined`, a non-null assertion, or `NonNullable<Key>`, which also keep any unique key identity.

A union containing an ordinary constructor keeps TypeScript's own checks. The identifier type `Users` in `R` is distinct from `typeof Users`: combining that identifier with an ordinary callable or constructor, or constraining a type parameter to it, does not make a value a service key.

### Shape names and declaration output

At module or namespace scope, `Users.Shape` names a service's implementation type, so service contracts can refer to their own or another service's `.Shape`. A function or block cannot declare that companion namespace: write `Context.Service.Shape<typeof Users>` for a local service instead. Within the service's own instance member type, `Users.Shape` remains a type-only self-reference. A member-local type parameter named `Users` shadows that service name, as in TypeScript.

The key and the public `Shape` alias share a private named member type, preserving recursive shapes and their `readonly` members.

Namespace services keep native key helpers such as `Tools.Users.of(implementation)`. Their emitted declarations also keep an explicit `Context` import when they use it.

A service declaration keeps a written namespace import for `effect/Context` in its declaration file, including aliases such as `import * as Ctx from "effect/Context"`. Its generated base type then uses `Ctx.ServiceClass`. A locally shadowed alias uses a visible binding instead. Declaration output gives generated `Context` imports a free local name when a nested namespace or type shadows `Context`; authored namespace members keep their names.

The same declaration-import checks run with `noEmit` or `declaration: false`, because every VibeLang module has a sidecar.
