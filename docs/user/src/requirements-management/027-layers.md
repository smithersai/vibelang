# Managing Layers

A layer describes how to build services: their dependencies, initialization errors, and resources. Build the application graph once around an entry point so its services share one managed lifetime.

[Upstream page](https://effect.website/docs/v4/requirements-management/layers)

## Describing a dependency graph

```vibe
// pending: VIP-1, VIP-3, VIP-4, VIP-5, VIP-6, VIP-9, VIP-12, VIP-14
// run: provide Reports = { render: effect (title) => `report/${title}` } { try Console.log(try report("Inventory")) }
service Settings {
  prefix: string
}
service Printer {
  print(text: string): void!!
}
service Reports {
  render(title: string): string!!
}

effect function report(title: string) {
  const reports = try Reports
  return try reports.render(title)
}
// string!!Reports

effect function stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}
// Output: report/Inventory
```

On this page, `Printer` depends on `Settings`, and `Reports` on both. `Layer.Layer<Out, E, In>` gives the services produced, construction failures, and construction requirements; the global `Layer` namespace holds the constructors and that type.

Do not break immediately before or after a provider-separating comma (`EK1202`). Line breaks inside a provider expression remain allowed; use `Layer.mergeAll(...)` for multiline composition.

A `provide` block takes layers and `Key = value` entries, separated by commas, and Effect's own `provide` types them. Any construction errors and requirements that `Effect.provide` leaves unsatisfied remain in the enclosing Effect's type. Provider expressions run once, in source order, before any layer builds; repeating the same layer value builds it once. Support for diagnostics on the new provider forms arrives with the compiler's VIP implementation.

## Preventing dependency leakage

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-12, VIP-14
// run: provide Settings = { prefix: "test" } { provide PrinterLive { const printer = try Printer; try printer.print("ready") } }
const PrinterLive = Layer.effect(Printer, effect {
  const settings = try Settings
  return {
    effect print(text) {
      try Console.log(`${settings.prefix}: ${text}`)
    }
  }
})
// Layer<Printer, never, Settings>
// Output: test: ready
```

`Layer.effect(Printer, effect { ... })` builds a `Printer`: `effect { ... }` is the layer's Effect, passed as an ordinary argument to `Layer.effect`. Its statements, `try Settings` included, run once when the layer builds. The returned object is the implementation; the service types its members, so `effect print(text)` needs no annotation. The method captures the `Settings` implementation, so callers need `Printer` but not `Settings`. A layer without setup is `Layer.succeed(Printer, { ... })`. Looking up a service inside a method instead makes it a call-time requirement, which the member's full contract must list.

Keep method requirements at `never` when dependencies are implementation details, so a test can provide a simple fake without recreating the production graph.

## Constructing service layers

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-12, VIP-14
// run: provide SettingsLive { provide PrinterLive { provide ReportsLive { try Console.log(try report("Inventory")) } } }
const SettingsLive = Layer.succeed(Settings, {
  prefix: "reports"
})
// Layer<Settings, never, never>

const ReportsLive = Layer.effect(Reports, effect {
  const settings = try Settings
  const printer = try Printer
  return {
    effect render(title) {
      try printer.print("Rendering report")
      return `${settings.prefix}/${title}`
    }
  }
})
// Layer<Reports, never, Settings | Printer>
// Output: reports: Rendering report
// Output: reports/Inventory
```

Use `Layer.succeed` for an existing implementation or constant factory, `Layer.effect` for a factory that performs Effect operations, and `Layer.sync` for a plain synchronous constructor, such as `(): Users.Shape => …`, that needs no Effect work. Constructing a layer value doesn't run its initialization program.

A factory can register `try addFinalizer(...)` or acquire with `try acquireRelease(...)`; `Layer.effect` supplies the construction scope and removes `Scope` from the layer's input requirements. Acquire a returned service's resources with `try acquireRelease(...)`; a lexical `using` releases a TypeScript disposable when the factory returns.

## Merging independent layers

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14
// run: provide SettingsLive { provide PrinterLive { provide Merged { const printer = try Printer; try printer.print("merged") }; provide Many { try Console.log(try report("many")) } } }
const Merged = Layer.merge(SettingsLive, PrinterLive)
// Layer<Settings | Printer, never, Settings>

const Many = Layer.mergeAll(SettingsLive, PrinterLive, ReportsLive)
// Layer<Settings | Printer | Reports, never, Settings | Printer>
// Output: reports: merged
// Output: reports: Rendering report
// Output: reports/many
```

Merging combines outputs and inputs and can initialize independent branches concurrently. It doesn't feed one sibling's output into another's input, so `Merged` still needs `Settings` to build `PrinterLive`, though a sibling produces it.

## Wiring dependent layers

```vibe
// pending: VIP-5, VIP-12, VIP-14
// run: provide PrinterReady { const printer = try Printer; try printer.print("ready") }; provide PrinterAndSettings { try Console.log((try Settings).prefix) }; provide ReportsReady { try Console.log(try report("wired")) }; provide AppLive { try Console.log(try report("app")) }
const PrinterReady = Layer.provide(PrinterLive, SettingsLive)
// Layer<Printer, never, never>

const PrinterAndSettings = Layer.provideMerge(PrinterLive, SettingsLive)
// Layer<Printer | Settings, never, never>

const ReportsReady = Layer.provide(ReportsLive, PrinterAndSettings)
// Layer<Reports, never, never>

const AppLive = ReportsLive.pipe(Layer.provideMerge(PrinterAndSettings))
// Layer<Reports | Printer | Settings, never, never>
// Output: reports: ready
// Output: reports
// Output: reports: Rendering report
// Output: reports/wired
// Output: reports: Rendering report
// Output: reports/app
```

`Layer.provide(consumer, dependencies)` feeds dependency outputs into the consumer and keeps the consumer's outputs; `provideMerge` also keeps the dependency outputs. Here `PrinterAndSettings` supplies the dependencies of `ReportsLive`, and `AppLive` retains all three services.

Inputs the composition doesn't provide stay in the resulting layer's `In`, so a partial graph is valid; a layer that needs the service it provides still needs it from outside. At a runner, missing providers report `EK3201` with the unsatisfied inputs. A written contract that excludes a remaining requirement reports `EK9202`, an interim code.

Reuse one layer value when several paths need a shared instance: equivalent reconstructed layer values have different memoization identities.

## Providing and building layers

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14
// run: try Console.log(try stringify(try main())); try Console.log(try withBuiltContext())
effect function main() {
  provide AppLive {
    const first = try report("Inventory")
    const second = try report("Forecast")
    return [first, second]
  }
}
// string[]!!

effect function withBuiltContext() {
  return try scoped(effect {
    const context = try Layer.build(AppLive)
    return try Effect.provide(report("Inventory"), context)
  })
}
// Output: reports: Rendering report
// Output: reports: Rendering report
// Output: ["reports/Inventory","reports/Forecast"]
// Output: reports: Rendering report
// Output: reports/Inventory
```

`provide AppLive { ... }` builds the layer once, shares its implementations with every call inside, and releases its resources when the block exits. The statements belong to the enclosing function, so the `return` inside returns from `main`. The block is `yield* Effect.provide(Effect.gen(…), AppLive)` around its statements, with a `return`, `break` or `continue` inside carried out where the block stands. It takes layers and `Key = value` entries, or a single `Context`. Pass an array of layers to `Effect.provide` directly. Separate provision boundaries acquire separately; use `ManagedRuntime` when several entry points need one application lifetime.

`Layer.build` produces a `Context` and requires a `Scope`, here from `scoped(effect { ... })`; consume resource-owning services inside that scope. For an application that is entirely a layer, `Layer.launch(AppLive)` builds it and keeps its resources alive until interruption.

## Observing initialization and recovering failures

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-12, VIP-13, VIP-14, VIP-23
// run: provide ResilientReports { try Console.log(try report("Inventory")) }
error InitializationFailed

const ReportsUnavailable = Layer.effect(Reports, effect {
  throw new InitializationFailed()
})

const ReportsFallback = Layer.succeed(Reports, {
  effect render(title) { return `Offline report: ${title}` }
})

const ObservedReports = ReportsUnavailable
  |> Layer.tap(%, () => Console.log("Reports initialized"))
  |> Layer.tapError(%, (error) => Console.log(`Reports initialization failed: ${error._tag}`))

const ResilientReports = Layer.catch(ObservedReports, () => ReportsFallback)
// Output: Reports initialization failed: InitializationFailed
// Output: Offline report: Inventory
```

`Layer.tap` observes successful acquisition; `Layer.tapError` observes typed construction failures. Observers can add their own errors or requirements, so log infallibly to keep the original signature. `Layer.catch` recovers construction errors with another layer, not errors from later service calls.

When a larger graph fails to initialize, acquired resources still release. Initialization diagnostics should name services and safe failure tags, not configuration secrets.

## Declaring service factories and dependencies

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-9, VIP-12, VIP-14
// run: provide BannerLive { const banner = try Banner; try Console.log(try banner.text("Orders")) }
service Banner {
  text(title: string): string!!
}

effect function makeBanner(): Banner.Shape!!Settings {
  const settings = try Settings
  return { text: effect (title) => `${settings.prefix}: ${title}` }
}

const BannerWithoutDependencies = Layer.effect(Banner, makeBanner())

const BannerLive = Layer.provide(BannerWithoutDependencies, SettingsLive)
// Output: reports: Orders
```

A service declares only its members, besides `static readonly key` and `defaultValue`, so the factory and its layers are ordinary declarations beside it. `makeBanner()` returns an Effect that builds the implementation, replacing Effect 4's service `make` option. `BannerWithoutDependencies` needs `Settings`, and `BannerLive` provides it. The compiler generates no layer, and a module can export several layer values for different configurations or runtimes.

## Replacing services in tests

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-12, VIP-14
// run: try Console.log(try stringify([try testBannerDependency(), try testBannerDirectly(), try testBannerWithInlineSettings()]))
const SettingsTest = Layer.succeed(Settings, {
  prefix: "test"
})
const BannerWithTestSettings = Layer.provide(BannerWithoutDependencies, SettingsTest)
const BannerTest = Layer.succeed(Banner, {
  effect text(title) { return `fixture/${title}` }
})

effect function testBannerDependency() {
  provide BannerWithTestSettings {
    return try (try Banner).text("Orders")
  }
}

effect function testBannerDirectly() {
  provide BannerTest {
    return try (try Banner).text("Orders")
  }
}

effect function testBannerWithInlineSettings() {
  provide Settings = { prefix: "inline" } {
    provide BannerWithoutDependencies {
      const banner = try Banner
      return try banner.text("Orders")
    }
  }
}
// Output: ["test: Orders","fixture/Orders","inline: Orders"]
```

Replace a dependency to exercise the real factory, or the service itself to isolate its consumers. If a test needs different construction inputs, change a layer that already includes production dependencies at its exposed factory boundary. For a small local override, `provide Key = value` provides one implementation without a layer. Put construction dependencies in an outer block so they exist while the inner layer builds: providers in one list supply the block together and don't feed one another's construction dependencies.

## Coming from Effect

`service` declarations, with layer constants beside them, replace hand-written key classes, and `effect { ... }` replaces generator-based factories. The Layer graph, memoization, and resource semantics stay Effect 4's. `Effect.provide` wrappers currently draw EK4836 and have a quick fix to write a `provide` block. Support for the new forms arrives with the compiler's VIP implementation.
