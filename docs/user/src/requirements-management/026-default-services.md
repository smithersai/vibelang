# Default Services

Effect supplies live defaults for the clock, random generator, console, configuration, tracing, and scheduler, so using them adds nothing to `R`. Override them locally with `provide` or module helpers whenever tests or subsystems require deterministic behavior.

[Upstream page](https://effect.website/docs/v4/requirements-management/default-services)

| Default service | Module access | Replaces |
| --- | --- | --- |
| `Clock.Clock` | `Clock.currentTimeMillis`, `sleep` | `Date.now()`, timers |
| `Random.Random` | `Random.next`, `Random.withSeed` | `Math.random()` |
| `Console.Console` | `Console.log` | `console.log` |
| `ConfigProvider.ConfigProvider` | `Config.*` | `process.env` |
| `Tracer.Tracer` | Tracing spans | Ad-hoc instrumentation |
| `Scheduler.Scheduler` | Fiber execution | Direct event-loop scheduling |

## Using the clock, random, and console

```vibe
// run: const liveClock = try Clock.Clock; provide Random.Random = { nextDoubleUnsafe: () => 0.25, nextIntUnsafe: () => 12 }, Clock.Clock = { ...liveClock, currentTimeMillis: succeed(1000), currentTimeMillisUnsafe: () => 1000 } { try startupMessage() }
effect function startupMessage() {
  const started = try Clock.currentTimeMillis
  const sample = try Random.next
  try Console.log(`Started at ${started}; sample=${sample}`)
}
// void!!

effect function stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}
// Output: Started at 1000; sample=0.25
```

`Clock.currentTimeMillis` and `Random.next` are Effect values, and `Console.log` returns an Effect—run each with `try`. All six default-service modules are in scope in `.vibe` files with no import, and because they have built-in defaults, `startupMessage` keeps `R = never`. Prefer them over `Date.now()`, `Math.random()`, and global `console` so tests and local overrides stay deterministic.

```vibe
// run: provide ConfigProvider.layer(ConfigProvider.fromUnknown({})) { try Console.log(try configuredPort()) }
const Port = Config.withDefault(Config.Port("PORT"), 3000)

effect function configuredPort() {
  return try Port
}
// number!Config.ConfigError
// Output: 3000
```

`Config.Port` and `Config.withDefault` construct configuration descriptions without reading the environment; `try Port` evaluates that description against the active `ConfigProvider`. Calls returning a `Config`, `Exit`, or context key produce data until executed with `try`.

## Replacing default implementations

```vibe
// run: try Console.log(try fixedRandomSample())
effect function fixedRandomSample() {
  provide Random.Random = { nextDoubleUnsafe: () => 0.25, nextIntUnsafe: () => 12 } {
    return try Random.next
  }
}
// Output: 0.25
```

`provide Random.Random = …` replaces a default reference within its block. Effect 4's `Random` interface is synchronous, so constant-returning callbacks are plain JavaScript functions.

Overrides persist across suspensions, propagate to child fibers forked inside the block, and leave outside code untouched. When a module offers a targeted helper such as `Random.withSeed`, prefer it over supplying a full service object.

```vibe
// run: try Console.log(try defaultLabel(17)); provide DisplaySettings = { prefix: "Order" } { try Console.log(try defaultLabel(17)) }
service DisplaySettings {
  prefix: string
  static readonly defaultValue = () => ({ prefix: "Ticket" })
}

effect function defaultLabel(id: number) {
  const settings = try DisplaySettings
  return `${settings.prefix} ${id}`
}
// string!!
// Output: Ticket 17
// Output: Order 17
```

A `service` declaring `static readonly defaultValue = () => implementation` compiles to a `Context.Reference` and exports its `Shape` type in `.d.ts` output, adding nothing to `R`; override it with `provide Key = value`. Effect's `Context.Reference(key, { defaultValue })` also works directly and returns a key value.

Declaring `static readonly default = implementation` instead emits `EK4855`: that field is ordinary cached static data evaluated once at declaration, not a `Context.Reference` fallback, so unprovided lookups still fail. Keep a native `Context.Service` class (referencing its shape via `Context.Service.Shape<typeof S>`) when you intentionally want cached static data, or declare `static readonly defaultValue` for fallback behavior.

## Reproducible random computations

```vibe
// run: const pairs = try reproduciblePairs(); try Console.log(try stringify(pairs.first) === try stringify(pairs.second), pairs.first[0] !== pairs.first[1])
effect function pair() {
  return [try Random.next, try Random.next]
}

effect function reproduciblePairs() {
  const first = try Random.withSeed(pair(), "documentation-seed")
  const second = try Random.withSeed(pair(), "documentation-seed")
  return { first, second }
}
// Output: true true
```

Each `Random.withSeed` installs a fresh deterministic generator, so identical seeds produce identical sequences while successive reads inside one call advance the generator. Keep consumption order sequential when tests assert exact outputs, since concurrent reads can interleave.

## Coming from Effect

Default services follow Effect's exact rules: execute Effect values like `Random.next` with `try`, and pass unexecuted Effects like `pair()` to helpers such as `Random.withSeed`.

`static readonly defaultValue` is evaluated at a class-field boundary even inside an `effect function`, so it cannot execute `try e` inline (`EK0501`). Compute any effectful factory in the surrounding effect body first, then assign `static readonly defaultValue = factory`.

A whole-shape default service—`service Name: Type { static readonly defaultValue = () => value }`—checks the factory against `() => Type`, compiles to `Context.Reference<Type>`, allows only `key` and `defaultValue` in its body, and emits no `Name.Shape` namespace; refer to `Type` or `Context.Service.Shape<typeof Name>` externally (a member-body service keeps its `Shape` alias). See [Declaring a service of any shape](025-services.md#declaring-a-service-of-any-shape).
