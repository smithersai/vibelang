# Default Services

Effect gives the clock, random generation, console output, configuration sources, and tracing live defaults. VibeLang uses them, so using these adds no application service requirement.

[Upstream page](https://effect.website/docs/v4/requirements-management/default-services)

## Using the clock, random, and console

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-12, VIP-14
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

`Clock.currentTimeMillis` and `Random.next` are Effect values, so run them with `try`; `Console.log` returns an Effect, so run its result with `try` too. Use these modules, not `Date.now()`, `Math.random()`, or the browser console, so tests and local overrides control the behavior.

Default references include `Clock.Clock`, `ConfigProvider.ConfigProvider`, `Console.Console`, `Random.Random`, `Tracer.Tracer`, and `Scheduler.Scheduler`; their modules need no import in `.vibe` files. These defaults are why the example's `R` is `never` though it reads time and random state.

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14
// run: provide ConfigProvider.layer(ConfigProvider.fromUnknown({})) { try Console.log(try configuredPort()) }
const Port = Config.withDefault(Config.Port("PORT"), 3000)

effect function configuredPort() {
  return try Port
}
// number!Config.ConfigError!
// Output: 3000
```

`Config.Port` and `Config.withDefault` build configuration data without reading the environment; `try Port` reads it through the default configuration provider. A call returning a `Config`, an `Exit`, or a Context key leaves it as data; running the held Effect value with `try` executes it.

## Replacing default implementations

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try fixedRandomSample())
effect function fixedRandomSample() {
  return try provideService(Random.next, Random.Random, {
    nextDoubleUnsafe: () => 0.25,
    nextIntUnsafe: () => 12
  })
}
// Output: 0.25
```

`Effect.provideService` overrides a default reference for its program. The implementation has Effect 4's synchronous `Random` interface; both callbacks only return constants, so they qualify as plain JavaScript functions. Override any other default reference the same way, with a complete implementation.

An override holds across pauses, is inherited by new child fibers, and leaves unrelated programs unchanged. Prefer a module helper when it supplies the behavior without implementing a whole service.

```vibe
// pending: VIP-1, VIP-5, VIP-9, VIP-12, VIP-14
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

A service with `static readonly defaultValue = () => implementation` compiles to a `Context.Reference`, so using it adds nothing to `R`; override it with `Effect.provideService` as above. Effect's own `Context.Reference(key, { defaultValue })` works unchanged and returns a key as data. A service that declares `static readonly default` draws `EK4855`; its fix, which `vibelang --fix` applies, renames it to `defaultValue` and wraps its value in a thunk.

## Reproducible random computations

```vibe
// pending: VIP-1, VIP-5, VIP-14
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

Each `withSeed` call installs a new deterministic generator, so both pairs hold the same sequence. Reads in one seeded region advance the generator; they don't repeat one value. When a test depends on the sequence, keep consumption order stable: concurrent consumers can change which task gets which number.

## Coming from Effect

Default services behave as in Effect. Effect values such as `Random.next` run with `try Random.next`; provision and seed helpers take an Effect value such as `pair()`.
