# Effect 4 structure and topic inventory

Pinned upstream: [`Effect-TS/website@9b2ad8c7569b7ca65562185052c1122167eae906`](https://github.com/Effect-TS/website/tree/9b2ad8c7569b7ca65562185052c1122167eae906).

Structure sources: [sidebar section ranks](https://github.com/Effect-TS/website/blob/9b2ad8c7569b7ca65562185052c1122167eae906/apps/web/src/content/docs/sidebar-config.json), [onboarding groups](https://github.com/Effect-TS/website/blob/9b2ad8c7569b7ca65562185052c1122167eae906/apps/web/src/content/docs/onboarding-groups.json), and [sidebar construction rules](https://github.com/Effect-TS/website/blob/9b2ad8c7569b7ca65562185052c1122167eae906/apps/web/src/lib/docs-sections.ts). The complete pinned repository tree supplies the page list.

Only page titles, navigation labels, paths, API identifiers, counts, and original topic summaries are retained. No upstream body prose or code examples are copied. The stubs are a plan for fresh VibeLang writing; the API column identifies upstream Effect APIs, not a promise that VibeLang exposes those names.

Order follows the two upstream sidebar views: onboarding first, then guides. Onboarding pages are excluded from guides, just as in the upstream navigation. Guide sections and root pages interleave by configured rank; pages within a section sort by frontmatter `sidebar.order`, then sidebar label. Labels may differ from page titles.

Local paths retain each upstream directory and page slug, replace `.mdx` with `.md`, and add a three-digit global reading-order prefix to the filename. The linked sidebar below defines navigation across directories and preserves onboarding groups without duplicating their pages. After the two upstream views, the VibeLang features view lists the original guides, and the Specification view lists one page per chapter of the specification in `docs/design/src`, grouped by part in the specification's order. The docs build fails if a specification chapter is missing from it.

Code example count: one example per fenced code block in the source body, including commands, configuration, and separately presented package-manager variants. Blocks explicitly marked `text`, `plaintext`, `output`, or `console` are excluded. Inline code, rendered output outside fences, and imported components are not counted. Counts describe source blocks, not distinct executable programs.

## V4 sidebar in order


### Onboarding

- **Start Here**
  - [Welcome](src/001-onboarding.md): `v4/onboarding.mdx`
  - [Why VibeLang?](src/getting-started/002-why-effect.md): `v4/getting-started/why-effect.mdx`
- **Learning Path**
  - [The Effect Type](src/getting-started/003-the-effect-type.md): `v4/getting-started/the-effect-type.mdx`
  - [Installation](src/getting-started/004-installation.md): `v4/getting-started/installation.mdx`
  - [Creating Effects](src/getting-started/005-creating-effects.md): `v4/getting-started/creating-effects.mdx`
  - [Two Types of Errors](src/error-management/006-two-error-types.md): `v4/error-management/two-error-types.mdx`
  - [Basic Concurrency](src/concurrency/007-basic-concurrency.md): `v4/concurrency/basic-concurrency.mdx`
- **Core Concepts**
  - [Effect's Modules](src/getting-started/008-importing-effect.md): `v4/getting-started/importing-effect.mdx`
  - [Running Effects](src/getting-started/009-running-effects.md): `v4/getting-started/running-effects.mdx`
  - [Sequencing Effects](src/getting-started/010-using-generators.md): `v4/getting-started/using-generators.mdx`
  - [Building Pipelines](src/getting-started/011-building-pipelines.md): `v4/getting-started/building-pipelines.mdx`
  - [Devtools](src/getting-started/012-devtools.md): `v4/getting-started/devtools.mdx`

### Setup

- [Set up VibeLang](src/setup.md)
- [Known limitations](src/setup/known-limitations.md)
- **Start a project**
  - [New project](src/setup/new-project.md)
  - [Existing project](src/setup/existing-project.md)
- **Build and test**
  - [vibelang CLI](src/setup/vibelang-cli.md)
  - [Vite and Vitest](src/setup/vite.md)
- **Format and lint**
  - [Format with dprint](src/setup/formatting.md)
- **Frameworks**
  - [React](src/setup/react.md)
  - [Vue](src/setup/vue.md)
  - [Svelte](src/setup/svelte.md)
  - [Foldkit](src/setup/foldkit.md)
- **Editors**
  - [VS Code and Cursor](src/setup/vscode.md)
  - [Neovim](src/setup/neovim.md)
  - [Zed](src/setup/zed.md)
  - [Other editors](src/setup/other-editors.md)
- **Upgrade**
  - [Release notes](src/setup/release-notes.md)

### Guides

- [Getting Started](src/013-getting-started.md): `v4/getting-started.mdx`
- **Error Management**
  - [Expected Errors](src/error-management/014-expected-errors.md): `v4/error-management/expected-errors.mdx`
  - [Unexpected Errors](src/error-management/015-unexpected-errors.md): `v4/error-management/unexpected-errors.mdx`
  - [Fallback](src/error-management/016-fallback.md): `v4/error-management/fallback.mdx`
  - [Matching](src/error-management/017-matching.md): `v4/error-management/matching.mdx`
  - [Retrying](src/error-management/018-retrying.md): `v4/error-management/retrying.mdx`
  - [Timing Out](src/error-management/019-timing-out.md): `v4/error-management/timing-out.mdx`
  - [Sandboxing](src/error-management/020-sandboxing.md): `v4/error-management/sandboxing.mdx`
  - [Error Accumulation](src/error-management/021-error-accumulation.md): `v4/error-management/error-accumulation.mdx`
  - [Error Channel Operations](src/error-management/022-error-channel-operations.md): `v4/error-management/error-channel-operations.mdx`
  - [Parallel and Sequential Errors](src/error-management/023-parallel-and-sequential-errors.md): `v4/error-management/parallel-and-sequential-errors.mdx`
  - [Custom Error Classes](src/error-management/024-yieldable-errors.md): `v4/error-management/yieldable-errors.mdx`
- **Requirements Management**
  - [Managing Services](src/requirements-management/025-services.md): `v4/requirements-management/services.mdx`
  - [Default Services](src/requirements-management/026-default-services.md): `v4/requirements-management/default-services.mdx`
  - [Managing Layers](src/requirements-management/027-layers.md): `v4/requirements-management/layers.mdx`
  - [Layer Memoization](src/requirements-management/028-layer-memoization.md): `v4/requirements-management/layer-memoization.mdx`
- **Resource Management**
  - [Introduction](src/resource-management/029-introduction.md): `v4/resource-management/introduction.mdx`
  - [Scope](src/resource-management/030-scope.md): `v4/resource-management/scope.mdx`
- **Observability**
  - [Logging](src/observability/031-logging.md): `v4/observability/logging.mdx`
  - [Metrics](src/observability/032-metrics.md): `v4/observability/metrics.mdx`
  - [Tracing](src/observability/033-tracing.md): `v4/observability/tracing.mdx`
  - [Tracking Fibers](src/observability/034-tracking-fibers.md): `v4/observability/tracking-fibers.mdx`
- [Configuration](src/035-configuration.md): `v4/configuration.mdx`
- [Runtime](src/036-runtime.md): `v4/runtime.mdx`
- **Scheduling**
  - [Using schedules](src/scheduling/037-using-schedules.md): `v4/scheduling/using-schedules.mdx`
  - [Choosing and combining schedules](src/scheduling/038-choosing-and-combining-schedules.md): `v4/scheduling/choosing-and-combining-schedules.mdx`
  - [Scheduling work with cron](src/scheduling/039-cron.md): `v4/scheduling/cron.mdx`
  - [Schedule cookbook](src/scheduling/040-cookbook.md): `v4/scheduling/cookbook.mdx`
- **State Management**
  - [Ref](src/state-management/041-ref.md): `v4/state-management/ref.mdx`
  - [SynchronizedRef](src/state-management/042-synchronizedref.md): `v4/state-management/synchronizedref.mdx`
  - [SubscriptionRef](src/state-management/043-subscriptionref.md): `v4/state-management/subscriptionref.mdx`
- [Batching](src/044-batching.md): `v4/batching.mdx`
- **Caching**
  - [Caching Effects](src/caching/045-caching-effects.md): `v4/caching/caching-effects.mdx`
  - [Cache](src/caching/046-cache.md): `v4/caching/cache.mdx`
- **Concurrency**
  - [Fibers](src/concurrency/047-fibers.md): `v4/concurrency/fibers.mdx`
  - [Deferred](src/concurrency/048-deferred.md): `v4/concurrency/deferred.mdx`
  - [Queue](src/concurrency/049-queue.md): `v4/concurrency/queue.mdx`
  - [PubSub](src/concurrency/050-pubsub.md): `v4/concurrency/pubsub.mdx`
  - [Semaphore](src/concurrency/051-semaphore.md): `v4/concurrency/semaphore.mdx`
  - [Latch](src/concurrency/052-latch.md): `v4/concurrency/latch.mdx`
- **Stream**
  - [Introduction](src/stream/053-introduction.md): `v4/stream/introduction.mdx`
  - [Creating Streams](src/stream/054-creating.md): `v4/stream/creating.mdx`
  - [Consuming Streams](src/stream/055-consuming-streams.md): `v4/stream/consuming-streams.mdx`
  - [Error Handling](src/stream/056-error-handling.md): `v4/stream/error-handling.mdx`
  - [Operations](src/stream/057-operations.md): `v4/stream/operations.mdx`
  - [Resourceful Streams](src/stream/058-resourceful-streams.md): `v4/stream/resourceful-streams.mdx`
- **Sink**
  - [Introduction](src/sink/059-introduction.md): `v4/sink/introduction.mdx`
  - [Creating Sinks](src/sink/060-creating.md): `v4/sink/creating.mdx`
  - [Operations](src/sink/061-operations.md): `v4/sink/operations.mdx`
  - [Leftovers](src/sink/062-leftovers.md): `v4/sink/leftovers.mdx`
- **Testing**
  - [TestClock](src/testing/063-testclock.md): `v4/testing/testclock.mdx`
- **Code Style**
  - [Guidelines](src/code-style/064-guidelines.md): `v4/code-style/guidelines.mdx`
  - [Dual APIs](src/code-style/065-dual.md): `v4/code-style/dual.mdx`
  - [Branded Types](src/code-style/066-branded-types.md): `v4/code-style/branded-types.mdx`
  - [Pattern Matching](src/code-style/067-pattern-matching.md): `v4/code-style/pattern-matching.mdx`
  - [Excessive Nesting](src/code-style/068-do.md): `v4/code-style/do.mdx`
  - [Control Flow Operators](src/code-style/069-control-flow.md): `v4/code-style/control-flow.mdx`
- **Data Types**
  - [BigDecimal](src/data-types/070-bigdecimal.md): `v4/data-types/bigdecimal.mdx`
  - [Cause](src/data-types/071-cause.md): `v4/data-types/cause.mdx`
  - [Chunk](src/data-types/072-chunk.md): `v4/data-types/chunk.mdx`
  - [Data](src/data-types/073-data.md): `v4/data-types/data.mdx`
  - [DateTime](src/data-types/074-datetime.md): `v4/data-types/datetime.mdx`
  - [Duration](src/data-types/075-duration.md): `v4/data-types/duration.mdx`
  - [Result](src/data-types/076-result.md): `v4/data-types/result.mdx`
  - [Exit](src/data-types/077-exit.md): `v4/data-types/exit.mdx`
  - [HashSet](src/data-types/078-hash-set.md): `v4/data-types/hash-set.mdx`
  - [Option](src/data-types/079-option.md): `v4/data-types/option.mdx`
  - [Redacted](src/data-types/080-redacted.md): `v4/data-types/redacted.mdx`
- **Trait**
  - [Equal](src/trait/081-equal.md): `v4/trait/equal.mdx`
  - [Hash](src/trait/082-hash.md): `v4/trait/hash.mdx`
- **Behaviour**
  - [Equivalence](src/behaviour/083-equivalence.md): `v4/behaviour/equivalence.mdx`
  - [Order](src/behaviour/084-order.md): `v4/behaviour/order.mdx`
- **Schema**
  - [Introduction](src/schema/085-introduction.md): `v4/schema/introduction.mdx`
  - [Getting Started](src/schema/086-getting-started.md): `v4/schema/getting-started.mdx`
  - [Basic Usage](src/schema/087-basic-usage.md): `v4/schema/basic-usage.mdx`
  - [Filters](src/schema/088-filters.md): `v4/schema/filters.mdx`
  - [Advanced Usage](src/schema/089-advanced-usage.md): `v4/schema/advanced-usage.mdx`
  - [Projections](src/schema/090-projections.md): `v4/schema/projections.mdx`
  - [Transformations](src/schema/091-transformations.md): `v4/schema/transformations.mdx`
  - [Annotations](src/schema/092-annotations.md): `v4/schema/annotations.mdx`
  - [Canonical Codecs](src/schema/093-canonical-codecs.md): `v4/schema/canonical-codecs.mdx`
  - [Error Messages](src/schema/094-error-messages.md): `v4/schema/error-messages.mdx`
  - [Error Formatters](src/schema/095-error-formatters.md): `v4/schema/error-formatters.mdx`
  - [Class APIs](src/schema/096-classes.md): `v4/schema/classes.mdx`
  - [Default Constructors](src/schema/097-default-constructors.md): `v4/schema/default-constructors.mdx`
  - [Effect Data Types](src/schema/098-effect-data-types.md): `v4/schema/effect-data-types.mdx`
  - [Standard Schema](src/schema/099-standard-schema.md): `v4/schema/standard-schema.mdx`
  - [Arbitrary](src/schema/100-arbitrary.md): `v4/schema/arbitrary.mdx`
  - [JSON Schema](src/schema/101-json-schema.md): `v4/schema/json-schema.mdx`
  - [Equivalence](src/schema/102-equivalence.md): `v4/schema/equivalence.mdx`
  - [Formatter](src/schema/103-formatter.md): `v4/schema/formatter.mdx`
  - [Schema Compilers](src/schema/104-compilers.md): `v4/schema/compilers.mdx`
- **Platform**
  - [Introduction](src/platform/105-introduction.md): `v4/platform/introduction.mdx`
  - [FileSystem](src/platform/106-file-system.md): `v4/platform/file-system.mdx`
  - [Path](src/platform/107-path.md): `v4/platform/path.mdx`
  - [PlatformLogger](src/platform/108-platformlogger.md): `v4/platform/platformlogger.mdx`
  - [Runtime](src/platform/109-runtime.md): `v4/platform/runtime.mdx`
  - [Terminal](src/platform/110-terminal.md): `v4/platform/terminal.mdx`
  - [Platform globals in VibeLang](src/platform/platform-globals.md)
  - [Cloudflare Workers](src/platform/cloudflare-workers.md)
  - [Alchemy](src/platform/alchemy.md)

### VibeLang features

- [Control operations and handlers](src/vibelang-features/111-control-operations-and-handlers.md)
- [Producers](src/vibelang-features/112-producers.md)
- [Building an HTTP API](src/vibelang-features/113-building-an-http-api.md)
- [VibeLang for Effect users](src/vibelang-features/114-vibelang-for-effect-users.md)
- [Cheat sheet](src/vibelang-features/115-cheat-sheet.md)
- [Pattern matching with match and is](src/vibelang-features/116-match-and-is.md)
- [Token counts](src/vibelang-features/117-token-counts.md)
- [Experimental platform APIs](src/vibelang-features/118-experimental-platform-apis.md)

### Specification

- [Introduction](../design/src/000-intro.md)
- **Part I. The language by example**
  - [1. A first look](../design/src/101-part1-ch01-first-look.md)
  - [2. Functions and calls](../design/src/102-part1-ch02-functions.md)
  - [3. Errors: the E channel](../design/src/103-part1-ch03-errors.md)
  - [4. Dependency injection: the R channel](../design/src/104-part1-ch04-di.md)
  - [5. Programs as values: retry, timeout, and pipe](../design/src/105-part1-ch05-programs.md)
  - [6. Resources](../design/src/106-part1-ch06-resources.md)
  - [7. Concurrency](../design/src/107-part1-ch07-concurrency.md)
  - [8. Producers: streams of values](../design/src/108-part1-ch08-producers.md)
  - [9. Handlers: defining your own effects](../design/src/109-part1-ch09-handlers.md)
  - [10. Working with TypeScript](../design/src/110-part1-ch10-typescript.md)
  - [11. The standard library](../design/src/111-part1-ch11-stdlib.md)
  - [12. Questions Effect users ask](../design/src/112-part1-ch12-faq.md)
- **Part II. The rules**
  - [13. What a call means](../design/src/213-part2-ch13-calls.md)
  - [14. Contracts and inference](../design/src/214-part2-ch14-contracts.md)
  - [15. Which functions compile to plain JavaScript](../design/src/215-part2-ch15-direct.md)
  - [16. Callbacks and higher-order functions](../design/src/216-part2-ch16-callbacks.md)
  - [17. Failures, defects, interruption, and cleanup](../design/src/217-part2-ch17-failures.md)
- **Part III. The runtime**
  - [18. Why a continuation runtime](../design/src/318-part3-ch18-why.md)
  - [19. The checkout trace, step by step](../design/src/319-part3-ch19-trace.md)
  - [20. The machine](../design/src/320-part3-ch20-machine.md)
  - [21. One-shot ownership and races](../design/src/321-part3-ch21-ownership.md)
  - [22. What resume restores](../design/src/322-part3-ch22-restore.md)
  - [23. Boundaries and finalization](../design/src/323-part3-ch23-boundaries.md)
  - [24. What Effect provides and what the kernel adds](../design/src/324-part3-ch24-effect.md)
  - [25. Implementation strategies and costs](../design/src/325-part3-ch25-strategies.md)
  - [26. What compiled code must guarantee](../design/src/326-part3-ch26-compiled.md)
- **Part IV. The compiler**
  - [27. Compiler architecture](../design/src/427-part4-ch27-compiler.md)
  - [28. Tooling](../design/src/428-part4-ch28-tooling.md)
- **Part V. Decisions**
  - [29. Decisions](../design/src/529-part5-ch29-decisions.md)
  - [30. Risks and experiments](../design/src/530-part5-ch30-risks.md)
- **Appendices**
  - [A. Evidence index and B. Prior art](../design/src/900-appendices.md)
  - [C. Every Effect feature in VibeLang](../design/src/901-appendix-c-coverage.md)

## Page inventory

Upstream paths are relative to the repository root. Section names identify the actual sidebar group; ungrouped guide links are marked as root pages.

| Upstream path | Page title | Section | Topics to cover in original VibeLang writing | Main upstream Effect APIs (names only) | Code examples |
| --- | --- | --- | --- | --- | ---: |
| `apps/web/src/content/docs/v4/onboarding.mdx` | Welcome to Effect | Onboarding / Start Here | why typed programs help; representing programs as composable values; errors, concurrency, resources, and telemetry; working with coding assistants; choosing a learning sequence; finding community support | `Effect.gen`, `Effect.succeed`, `Effect.log`, `Effect.runPromise` | 1 |
| `apps/web/src/content/docs/v4/getting-started/why-effect.mdx` | Why Effect? | Onboarding / Start Here | describing computations before executing them; reusing a shared application foundation; applying composable tools to production problems; learning through practical programs | `Effect.Effect`, `Effect.succeed`, `Effect.fail`, `Effect.runSync` | 2 |
| `apps/web/src/content/docs/v4/getting-started/the-effect-type.mdx` | The Effect Type | Onboarding / Learning Path | success, failure, and service type parameters; distinguishing descriptions from execution; extracting inferred success, error, and dependency types | `Effect.Effect`, `Effect.Success`, `Effect.Error`, `Effect.Services`, `Context.Service` | 2 |
| `apps/web/src/content/docs/v4/getting-started/installation.mdx` | Installation | Onboarding / Learning Path | runtime prerequisites; adding dependencies manually; setting up JavaScript runtimes; integrating a Vite and React application | `Effect.sync`, `Effect.runSync`, `Console.log` | 45 |
| `apps/web/src/content/docs/v4/getting-started/creating-effects.mdx` | Creating Effects | Onboarding / Learning Path | constructing successful and failed computations; tracking error types without throwing; wrapping synchronous operations; creating effects from promises; adapting callbacks and cancellation; suspending work for laziness, recursion, and type unification | `Effect.succeed`, `Effect.fail`, `Effect.sync`, `Effect.try`, `Effect.promise`, `Effect.tryPromise`, `Effect.callback`, `Effect.suspend`, `Effect.isEffect` | 22 |
| `apps/web/src/content/docs/v4/error-management/two-error-types.mdx` | Two Types of Errors | Onboarding / Learning Path | separating recoverable domain failures from defects; choosing which failures belong in the error type | None | 0 |
| `apps/web/src/content/docs/v4/concurrency/basic-concurrency.mdx` | Basic Concurrency | Onboarding / Learning Path | running work sequentially or with bounded or unbounded parallelism; interrupting computations; attaching interruption cleanup; propagating cancellation across concurrent work; racing computations under different winner rules; inspecting the winning result | `Effect.all`, `Effect.interrupt`, `Effect.onInterrupt`, `Effect.race`, `Effect.raceAll`, `Effect.raceFirst` | 19 |
| `apps/web/src/content/docs/v4/getting-started/importing-effect.mdx` | Importing Effect | Onboarding / Core Concepts | installing the core package; choosing module and namespace imports; composing standalone functions; eliminating unused imports during bundling; extending programs with reusable operators | `Effect.succeed`, `pipe` | 8 |
| `apps/web/src/content/docs/v4/getting-started/running-effects.mdx` | Running Effects | Onboarding / Core Concepts | executing synchronous computations; running promise-based computations; collecting complete execution results; starting and interrupting a fiber; selecting application execution boundaries | `Effect.runSync`, `Effect.runSyncExit`, `Effect.runPromise`, `Effect.runPromiseExit`, `Effect.runFork`, `Fiber.interrupt` | 8 |
| `apps/web/src/content/docs/v4/getting-started/using-generators.mdx` | Using Generators | Onboarding / Core Concepts | sequencing effects with generator syntax; relating generators to async functions; expressing branches and loops; yielding failures and stopping early; retaining the receiver in generator methods | `Effect.gen`, `Effect.fail`, `Effect.promise`, `Effect.succeed` | 9 |
| `apps/web/src/content/docs/v4/getting-started/building-pipelines.mdx` | Building Pipelines | Onboarding / Core Concepts | composing reusable function pipelines; mapping and replacing successes; sequencing dependent computations; integrating optional and result values; observing intermediate results; collecting multiple computations; avoiding discarded effects | `pipe`, `Effect.map`, `Effect.as`, `Effect.flatMap`, `Effect.andThen`, `Effect.tap`, `Effect.all`, `Effect.fromOption` | 19 |
| `apps/web/src/content/docs/v4/getting-started/devtools.mdx` | Devtools | Onboarding / Core Concepts | installing language tooling; inspecting inferred program information; using diagnostics, completions, and refactors; configuring compiler checks; integrating lint and build tools; debugging in supported editors | `Effect.log` | 36 |
| `apps/web/src/content/docs/v4/getting-started.mdx` | Getting Started | Guides / root pages | navigating guides and reference material; selecting a documentation version; finding subjects and in-page navigation; using documentation with language models; community entry points | None | 0 |
| `apps/web/src/content/docs/v4/error-management/expected-errors.mdx` | Expected Errors | Guides / Error Management | constructing typed failures; tracking several domain error cases; converting failures into result or optional values; recovering all or selected failures; filtering tagged and nested error reasons | `Effect.fail`, `Effect.result`, `Effect.option`, `Effect.catch`, `Effect.catchTag`, `Effect.catchTags`, `Effect.catchIf`, `Effect.catchFilter`, `Data.TaggedError` | 10 |
| `apps/web/src/content/docs/v4/error-management/unexpected-errors.mdx` | Unexpected Errors | Guides / Error Management | creating defects; promoting typed failures to defects; examining full execution results; recovering defects or complete failure causes | `Effect.die`, `Effect.orDie`, `Effect.exit`, `Effect.catchDefect`, `Effect.catchCause`, `Cause.isDieReason` | 6 |
| `apps/web/src/content/docs/v4/error-management/fallback.mdx` | Fallback | Guides / Error Management | recovering with another computation; supplying a default success; trying alternatives until one succeeds | `Effect.catch`, `Effect.orElseSucceed`, `Effect.firstSuccessOf` | 3 |
| `apps/web/src/content/docs/v4/error-management/matching.mdx` | Matching | Guides / Error Management | folding success and failure into values; choosing effectful branches; matching complete failure causes; discarding typed failures or all causes | `Effect.match`, `Effect.matchEffect`, `Effect.matchCause`, `Effect.matchCauseEffect`, `Effect.ignore`, `Effect.ignoreCause` | 4 |
| `apps/web/src/content/docs/v4/error-management/retrying.mdx` | Retrying | Guides / Error Management | retrying failed computations; selecting retryable domain errors; controlling retry timing and limits; supplying recovery after retries end | `Effect.retry`, `Effect.retryOrElse`, `Schedule.recurs` | 4 |
| `apps/web/src/content/docs/v4/error-management/timing-out.mdx` | Timing Out | Guides / Error Management | limiting execution duration; representing timeout as absence; choosing an alternate computation or custom failure; understanding interruption of protected work | `Effect.timeout`, `Effect.timeoutOption`, `Effect.timeoutOrElse` | 5 |
| `apps/web/src/content/docs/v4/error-management/sandboxing.mdx` | Sandboxing | Guides / Error Management | moving complete failure causes into the typed error channel; inspecting individual failure reasons; recovering selected cause variants; restoring causes after inspection | `Effect.sandbox`, `Effect.catch`, `Effect.failCause`, `Cause.isFailReason` | 2 |
| `apps/web/src/content/docs/v4/error-management/error-accumulation.mdx` | Error Accumulation | Guides / Error Management | validating independent computations without stopping at the first failure; partitioning successful and failed results | `Effect.validate`, `Effect.partition` | 2 |
| `apps/web/src/content/docs/v4/error-management/error-channel-operations.mdx` | Error Channel Operations | Guides / Error Management | mapping failures or both outcome channels; rejecting successes that fail a predicate; observing typed errors, tagged errors, causes, and defects; exposing errors as successful values; swapping success and failure channels | `Effect.mapError`, `Effect.mapBoth`, `Effect.filterOrFail`, `Effect.tapError`, `Effect.tapErrorTag`, `Effect.tapCause`, `Effect.tapDefect`, `Effect.flip` | 10 |
| `apps/web/src/content/docs/v4/error-management/parallel-and-sequential-errors.mdx` | Parallel and Sequential Errors | Guides / Error Management | representing multiple failures in a flat cause; combining reasons from concurrent or sequential work; separating runtime causes from domain error collections | `Cause.Fail`, `Cause.Die`, `Cause.Interrupt`, `Cause.combine`, `Cause.fail`, `Cause.die` | 2 |
| `apps/web/src/content/docs/v4/error-management/yieldable-errors.mdx` | Yieldable Errors | Guides / Error Management | defining errors that generators can yield; creating tagged error classes; recovering yielded failures by tag | `Data.Error`, `Data.TaggedError`, `Effect.gen`, `Effect.catchTag` | 2 |
| `apps/web/src/content/docs/v4/requirements-management/services.mdx` | Managing Services | Guides / Requirements Management | declaring typed service keys; requesting and supplying implementations; extracting service shapes; combining multiple dependencies; requesting optional services; handling dependencies between services | `Context.Service`, `Context.empty`, `Context.add`, `Effect.provideService`, `Effect.serviceOption`, `Effect.provide` | 19 |
| `apps/web/src/content/docs/v4/requirements-management/default-services.mdx` | Default Services | Guides / Requirements Management | using built-in clock, random, and console services; replacing default implementations; making random computations reproducible | `Clock.currentTimeMillis`, `Random.next`, `Random.withSeed`, `Console.log` | 2 |
| `apps/web/src/content/docs/v4/requirements-management/layers.mdx` | Managing Layers | Guides / Requirements Management | describing dependency graphs; preventing dependency types from leaking; constructing service layers; merging independent layers; wiring dependent layers; providing and building layers; observing initialization and recovering failures; declaring service factories and dependencies; replacing services in tests | `Context.Service`, `Layer.effect`, `Layer.succeed`, `Layer.merge`, `Layer.provide`, `Layer.launch`, `Effect.provide` | 28 |
| `apps/web/src/content/docs/v4/requirements-management/layer-memoization.mdx` | Layer Memoization | Guides / Requirements Management | sharing service acquisition across a dependency graph; requesting a fresh acquisition; understanding local provision boundaries; controlling memoization explicitly | `Layer.effect`, `Layer.provide`, `Layer.merge`, `Layer.fresh`, `Layer.makeMemoMap`, `Layer.buildWithMemoMap` | 5 |
| `apps/web/src/content/docs/v4/resource-management/introduction.mdx` | Introduction | Guides / Resource Management | guaranteeing cleanup after computation; finalizing based on execution outcome; cleaning up failed work; bracketing acquisition, use, and release | `Effect.ensuring`, `Effect.onExit`, `Effect.onError`, `Effect.acquireUseRelease` | 5 |
| `apps/web/src/content/docs/v4/resource-management/scope.mdx` | Scope | Guides / Resource Management | registering finalizers; opening and closing scopes explicitly; acquiring resources with automatic release; arranging nested resource lifetimes; sequencing scoped operations | `Effect.addFinalizer`, `Scope.make`, `Scope.close`, `Effect.acquireRelease`, `Effect.scoped` | 23 |
| `apps/web/src/content/docs/v4/observability/logging.mdx` | Logging | Guides / Observability | emitting structured log records; selecting severity thresholds; annotating logs and scoped regions; measuring log spans; disabling or configuring logging; defining custom output handlers; choosing text, structured, and JSON formats; sending records to multiple destinations | `Effect.log`, `Effect.logDebug`, `Effect.logInfo`, `Effect.logWarning`, `Effect.logError`, `Effect.logFatal`, `Effect.annotateLogs`, `Effect.withLogSpan`, `Logger.make`, `Logger.layer`, `References.MinimumLogLevel` | 32 |
| `apps/web/src/content/docs/v4/observability/metrics.mdx` | Metrics in Effect | Guides / Observability | recording counters and gauges; measuring distributions with histograms and summaries; timing computations; counting categorical events; attaching attributes to metrics or computation regions | `Metric.counter`, `Metric.gauge`, `Metric.histogram`, `Metric.timer`, `Metric.summary`, `Metric.frequency`, `Metric.withAttributes`, `Metric.value`, `Metric.withConstantInput`, `Metric.CurrentMetricAttributes`, `Effect.trackSuccesses` | 14 |
| `apps/web/src/content/docs/v4/observability/tracing.mdx` | Tracing in Effect | Guides / Observability | relating spans to traces; adding spans around computations; exporting spans with an SDK; inspecting failures and span attributes; representing logs as span events; nesting operations; viewing traces with local tooling; connecting external tracing services | `Effect.withSpan`, `Effect.annotateCurrentSpan`, `Effect.log`, `NodeSdk.layer` | 21 |
| `apps/web/src/content/docs/v4/observability/tracking-fibers.mdx` | Tracking Fibers | Guides / Observability | managing groups of running fibers; tracking fibers by key; removing completed work; interrupting tracked work when its scope closes | `FiberSet.make`, `FiberSet.run`, `FiberSet.add`, `FiberSet.size`, `FiberSet.join`, `FiberSet.awaitEmpty`, `Fiber.interrupt` | 1 |
| `apps/web/src/content/docs/v4/configuration.mdx` | Configuration | Guides / root pages | declaring typed configuration; parsing values with schemas; reading arrays and records; nesting and combining configuration; supplying defaults and fallbacks; transforming parsed values; protecting secrets; loading environment, object, and dotenv providers; remapping provider paths; composing and installing providers | `Config.String`, `Config.Port`, `Config.schema`, `Config.all`, `Config.nested`, `Config.withDefault`, `ConfigProvider.fromEnv`, `ConfigProvider.fromUnknown`, `ConfigProvider.fromDotEnv`, `ConfigProvider.fromDir`, `ConfigProvider.layer`, `Config.orElse`, `Config.map`, `Config.Redacted`, `Redacted.value` | 18 |
| `apps/web/src/content/docs/v4/runtime.mdx` | Introduction to Runtime | Guides / root pages | understanding execution infrastructure; running with an explicit service context; changing runtime behavior within a region; building and disposing managed runtimes; connecting runtime execution to application frameworks | `Context.make`, `Effect.runSyncWith`, `ManagedRuntime.make`, `Context.Service`, `Logger.layer` | 7 |
| `apps/web/src/content/docs/v4/scheduling/using-schedules.mdx` | Using schedules | Guides / Scheduling | repeating successful computations; stopping repetition based on a result; delaying the initial run; retrying failed computations; handling failures while repeating | `Effect.repeat`, `Effect.retry`, `Effect.schedule`, `Schedule.spaced`, `Schedule.recurs` | 6 |
| `apps/web/src/content/docs/v4/scheduling/choosing-and-combining-schedules.mdx` | Choosing and combining schedules | Guides / Scheduling | choosing repetition counts, intervals, backoff, or calendar rules; understanding how schedule steps advance; limiting duration or adjusting delays; requiring all timing rules; accepting any timing rule; switching rules in phases | `Schedule.recurs`, `Schedule.spaced`, `Schedule.fixed`, `Schedule.exponential`, `Schedule.cron`, `Schedule.upTo`, `Schedule.max`, `Schedule.min`, `Schedule.concat` | 9 |
| `apps/web/src/content/docs/v4/scheduling/cron.mdx` | Scheduling work with cron | Guides / Scheduling | defining calendar-based execution; selecting a time zone; validating cron expressions; previewing future execution times; starting and stopping a scheduled job | `Cron.parse`, `Cron.sequence`, `Schedule.cron`, `Effect.schedule` | 1 |
| `apps/web/src/content/docs/v4/scheduling/cookbook.mdx` | Schedule cookbook | Guides / Scheduling | honoring server retry hints; polling with response-dependent delays; bounding the whole retry operation; switching from rapid retries to slower retries; recording retry decisions | `Schedule.upTo`, `Schedule.exponential`, `Schedule.modifyDelay`, `Schedule.setInputType`, `Effect.retry`, `Clock.currentTimeMillis`, `TestClock.adjust` | 5 |
| `apps/web/src/content/docs/v4/state-management/ref.mdx` | Ref | Guides / State Management | creating shared mutable references; reading and atomically updating state; coordinating concurrent updates; supplying state as a service; sharing references across fibers | `Ref.make`, `Ref.get`, `Ref.update`, `Effect.provideServiceEffect` | 7 |
| `apps/web/src/content/docs/v4/state-management/synchronizedref.mdx` | SynchronizedRef | Guides / State Management | serializing effectful updates to shared state; reading synchronized references; keeping dependent asynchronous updates atomic | `SynchronizedRef.make`, `SynchronizedRef.get`, `SynchronizedRef.updateEffect` | 1 |
| `apps/web/src/content/docs/v4/state-management/subscriptionref.mdx` | SubscriptionRef | Guides / State Management | combining mutable state with change subscriptions; reading and updating observable references; consuming current and future values as a stream; coordinating concurrent subscribers | `SubscriptionRef.make`, `SubscriptionRef.get`, `SubscriptionRef.update`, `SubscriptionRef.changes` | 5 |
| `apps/web/src/content/docs/v4/batching.mdx` | Batching | Guides / root pages | modeling requests and domain errors; defining request resolvers; building queries from requests; combining compatible requests into batches; controlling batch execution; supplying resolver dependencies; sharing and tuning request caches | `RequestResolver.make`, `RequestResolver.fromEffect`, `RequestResolver.withCache`, `Effect.request`, `Effect.forEach`, `Context.Service`, `Data.TaggedError` | 17 |
| `apps/web/src/content/docs/v4/caching/caching-effects.mdx` | Caching Effects | Guides / Caching | memoizing parameterized computations; reusing a computed effect result; expiring cached results after a duration; invalidating cached effects explicitly | `Cache.make`, `Cache.get`, `Effect.cached`, `Effect.cachedWithTTL`, `Effect.cachedInvalidateWithTTL` | 4 |
| `apps/web/src/content/docs/v4/caching/cache.mdx` | Cache | Guides / Caching | building a lookup cache; sharing concurrent requests for one key; setting capacity and expiration; inspecting cache state; invalidating and refreshing entries | `Cache.make`, `Cache.get`, `Cache.size`, `Cache.keys`, `Cache.entries`, `Cache.refresh`, `Cache.has`, `Cache.invalidate`, `Cache.invalidateAll` | 3 |
| `apps/web/src/content/docs/v4/concurrency/fibers.mdx` | Fibers | Guides / Concurrency | understanding lightweight execution units; forking, joining, and awaiting fibers; handling asynchronous interruption; combining fiber results; supervising child lifetimes; selecting global or scoped lifetimes; understanding execution scheduling | `Effect.forkChild`, `Effect.forkDetach`, `Effect.forkScoped`, `Effect.forkIn`, `Effect.runFork`, `Fiber.join`, `Fiber.await`, `Fiber.interrupt`, `Effect.scoped`, `Effect.yieldNow` | 15 |
| `apps/web/src/content/docs/v4/concurrency/deferred.mdx` | Deferred | Guides / Concurrency | creating a one-time asynchronous result; waiting for completion; completing with success or failure; polling completion state; coordinating work across fibers | `Deferred.make`, `Deferred.await`, `Deferred.succeed`, `Deferred.fail`, `Deferred.poll`, `Deferred.isDone` | 6 |
| `apps/web/src/content/docs/v4/concurrency/queue.mdx` | Queue | Guides / Concurrency | choosing backpressure, dropping, sliding, or unbounded queues; offering single values or batches; taking, polling, and draining values; querying queue state; shutting down and awaiting closure; restricting producer and consumer capabilities | `Queue.bounded`, `Queue.dropping`, `Queue.sliding`, `Queue.unbounded`, `Queue.offer`, `Queue.offerAll`, `Queue.take`, `Queue.poll`, `Queue.takeBetween`, `Queue.shutdown`, `Queue.Enqueue`, `Queue.Dequeue` | 18 |
| `apps/web/src/content/docs/v4/concurrency/pubsub.mdx` | PubSub | Guides / Concurrency | broadcasting values to independent subscribers; selecting capacity and overflow behavior; managing scoped subscriptions; publishing batches; inspecting size and capacity; ending subscriptions and shutting down | `PubSub.bounded`, `PubSub.dropping`, `PubSub.sliding`, `PubSub.unbounded`, `PubSub.subscribe`, `PubSub.publish`, `PubSub.publishAll`, `PubSub.take`, `PubSub.capacity`, `PubSub.size` | 7 |
| `apps/web/src/content/docs/v4/concurrency/semaphore.mdx` | Semaphore | Guides / Concurrency | creating a permit pool; limiting concurrent access; acquiring permits around computations; releasing permits safely | `Semaphore.make`, `Semaphore.take`, `withPermits` | 3 |
| `apps/web/src/content/docs/v4/concurrency/latch.mdx` | Latch | Guides / Concurrency | waiting at a reusable gate; opening and closing the gate; creating a latch with an initial state; choosing a latch or a permit counter | `Latch.make`, `whenOpen`, `open`, `close`, `await`, `release` | 1 |
| `apps/web/src/content/docs/v4/stream/introduction.mdx` | Introduction to Streams | Guides / Stream | describing streams with element, error, and service types; choosing streaming use cases; relating streams to individual effects; understanding incremental production and backpressure | `Stream.empty`, `Stream.succeed`, `Stream.range`, `Stream.iterate`, `Stream.runCollect` | 2 |
| `apps/web/src/content/docs/v4/stream/creating.mdx` | Creating Streams | Guides / Stream | constructing finite and empty streams; producing successes and failures; adapting arrays, iterables, async iterables, effects, and callbacks; creating scoped sources; repeating values, streams, and effects; generating periodic elements; unfolding state and paginating responses; consuming queues and broadcasts; producing from schedules | `Stream.make`, `Stream.empty`, `Stream.range`, `Stream.fromEffect`, `Stream.fromIterable`, `Stream.fromAsyncIterable`, `Stream.fromEffectRepeat`, `Stream.unfold`, `Stream.paginate`, `Stream.callback`, `Stream.tick`, `Stream.fromQueue`, `Stream.fromPubSub`, `Stream.fromSchedule` | 25 |
| `apps/web/src/content/docs/v4/stream/consuming-streams.mdx` | Consuming Streams | Guides / Stream | collecting stream elements; executing per-element effects; stopping consumption conditionally; folding elements into an accumulator; running a sink over a stream | `Stream.runCollect`, `Stream.runForEach`, `Stream.runForEachWhile`, `Stream.runFold`, `Stream.run` | 4 |
| `apps/web/src/content/docs/v4/stream/error-handling.mdx` | Error Handling in Streams | Guides / Stream | recovering typed stream failures and defects; selectively handling errors; cleaning up after failures; retrying a failed source; narrowing error types; failing or switching sources after a timeout | `Stream.catch`, `Stream.catchCause`, `Stream.catchFilter`, `Stream.timeoutOrElse`, `Stream.fail`, `Stream.die` | 13 |
| `apps/web/src/content/docs/v4/stream/operations.mdx` | Operations | Guides / Stream | observing and taking elements; adapting to async iteration; mapping and flattening with effects or state; filtering, scanning, and detecting changes; zipping and indexing elements; combining Cartesian products; partitioning and grouping; concatenating, merging, and interleaving sources; inserting separators; broadcasting and buffering; debouncing and throttling; scheduling element delivery | `Stream.tap`, `Stream.take`, `Stream.map`, `Stream.mapEffect`, `Stream.mapAccum`, `Stream.flatMap`, `Stream.filter`, `Stream.scan`, `Stream.changes`, `Stream.zip`, `Stream.partition`, `Stream.groupBy`, `Stream.concat`, `Stream.merge`, `Stream.interleave`, `Stream.broadcastN`, `Stream.buffer`, `Stream.debounce`, `Stream.throttle`, `Stream.schedule` | 45 |
| `apps/web/src/content/docs/v4/stream/resourceful-streams.mdx` | Resourceful Streams | Guides / Stream | acquiring resources for a stream lifetime; releasing resources after consumption or interruption; registering stream finalizers | `Stream.scoped`, `Stream.ensuring`, `Effect.acquireRelease`, `Stream.fromIterableEffect` | 2 |
| `apps/web/src/content/docs/v4/sink/introduction.mdx` | Introduction | Guides / Sink | describing stream consumers and their result types; running a consumer against a source; understanding unconsumed elements | `Sink.take`, `Stream.run` | 1 |
| `apps/web/src/content/docs/v4/sink/creating.mdx` | Creating Sinks | Guides / Sink | constructing basic consumers; selecting first or last values; counting, summing, draining, and timing consumption; executing per-element work; producing successful or failed sinks; collecting with size, condition, uniqueness, or key limits; folding with termination and weight rules | `Sink.head`, `Sink.last`, `Sink.count`, `Sink.sum`, `Sink.take`, `Sink.drain`, `Sink.reduce`, `Sink.reduceWhile`, `Sink.fold` | 21 |
| `apps/web/src/content/docs/v4/sink/operations.mdx` | Sink Operations | Guides / Sink | adapting consumer input; mapping consumer output; composing input and output transformations; filtering elements before consumption | `Sink.mapInput`, `Sink.map`, `Stream.filter`, `Stream.transduce` | 3 |
| `apps/web/src/content/docs/v4/sink/leftovers.mdx` | Leftovers | Guides / Sink | collecting elements left after a sink completes; discarding leftover elements explicitly | `Sink.mapEnd`, `Sink.ignoreLeftover` | 2 |
| `apps/web/src/content/docs/v4/testing/testclock.mdx` | TestClock | Guides / Testing | controlling virtual time in tests; advancing recurring computations; checking clock-dependent behavior; coordinating timed waits and deferred results | `TestClock.adjust`, `TestClock.layer`, `Clock.currentTimeMillis`, `Effect.sleep` | 4 |
| `apps/web/src/content/docs/v4/code-style/guidelines.mdx` | Guidelines | Guides / Code Style | running application entry points; selecting runtime helpers for each platform; avoiding implicit argument forwarding in function composition | `NodeRuntime.runMain`, `Effect.scoped`, `Effect.addFinalizer` | 3 |
| `apps/web/src/content/docs/v4/code-style/dual.mdx` | Dual APIs | Guides / Code Style | calling operators with data first or last; using the same API directly or inside a pipeline | `Effect.map` | 6 |
| `apps/web/src/content/docs/v4/code-style/branded-types.mdx` | Branded Types | Guides / Code Style | distinguishing domain values with identical representations; creating nominal brands; validating refined brands; composing several brand constraints | `Brand.Brand`, `Brand.nominal`, `Brand.make`, `Brand.all` | 14 |
| `apps/web/src/content/docs/v4/code-style/pattern-matching.mdx` | Pattern Matching | Guides / Code Style | building matchers from types or values; selecting patterns by shape, predicate, or tag; negating patterns; fixing the return type; enforcing exhaustive handling; choosing defaults or optional and result outputs | `Match.type`, `Match.value`, `Match.when`, `Match.not`, `Match.tag`, `Match.withReturnType`, `Match.exhaustive`, `Match.orElse`, `Match.option`, `Match.result` | 12 |
| `apps/web/src/content/docs/v4/code-style/do.mdx` | Simplifying Excessive Nesting | Guides / Code Style | recognizing nesting in dependent pipelines; building named bindings with do notation; introducing derived values; expressing the same sequence with generators | `Effect.Do`, `Effect.bind`, `Effect.let`, `Effect.gen` | 8 |
| `apps/web/src/content/docs/v4/code-style/control-flow.mdx` | Control Flow Operators | Guides / Code Style | branching and conditionally running computations; combining two results; repeating work in loops; traversing collections and dropping intermediate values; collecting effects; choosing early termination or alternate collection modes | `Effect.when`, `Effect.zip`, `Effect.zipWith`, `Effect.whileLoop`, `Effect.forEach`, `Effect.all`, `Effect.as` | 19 |
| `apps/web/src/content/docs/v4/data-types/bigdecimal.mdx` | BigDecimal | Guides / Data Types | representing decimal values precisely; constructing decimals from scaled integers, strings, and numbers; using safe and unsafe constructors; performing arithmetic; comparing values; normalizing representations and checking equality | `BigDecimal.fromStringUnsafe`, `BigDecimal.make`, `BigDecimal.fromBigInt`, `BigDecimal.isInteger`, `BigDecimal.format`, `BigDecimal.toExponential`, `BigDecimal.fromNumberUnsafe`, `BigDecimal.sum`, `BigDecimal.multiply`, `BigDecimal.subtract`, `BigDecimal.divide`, `BigDecimal.divideUnsafe` | 11 |
| `apps/web/src/content/docs/v4/data-types/cause.mdx` | Cause | Guides / Data Types | representing typed failures, defects, interruptions, and empty causes; combining failure reasons; extracting causes from computations; identifying reason variants; formatting and inspecting errors | `Cause.fail`, `Cause.pretty`, `Cause.die`, `Cause.combine`, `Cause.isFailReason`, `Cause.empty`, `Cause.interrupt`, `Cause.isDieReason`, `Cause.hasFails`, `Cause.hasDies`, `Cause.hasInterrupts`, `Cause.hasInterruptsOnly` | 7 |
| `apps/web/src/content/docs/v4/data-types/chunk.mdx` | Chunk | Guides / Data Types | choosing immutable sequence storage; building chunks from values or iterables; understanding unsafe array reuse; concatenating and dropping elements; checking structural equality; converting to arrays | `Chunk.toReadonlyArray`, `Chunk.make`, `Chunk.empty`, `Chunk.fromIterable`, `Chunk.fromArrayUnsafe`, `Chunk.appendAll`, `Chunk.drop`, `Chunk.Chunk` | 8 |
| `apps/web/src/content/docs/v4/data-types/data.mdx` | Data | Guides / Data Types | creating values with structural equality; building ordinary and tagged classes; defining tagged unions with matching helpers; adding generic union cases; defining ordinary and tagged errors; preserving native error causes | `Data.TaggedEnum`, `Data.Class`, `Data.taggedEnum`, `Data.Error`, `Data.TaggedClass`, `Data.TaggedError` | 23 |
| `apps/web/src/content/docs/v4/data-types/datetime.mdx` | DateTime | Guides / Data Types | modeling UTC and zoned instants; constructing timestamps from supported inputs; reading current time; identifying timestamp variants; parsing and changing time zones; comparing and converting instants; accessing calendar components; performing calendar arithmetic and formatting; providing a default time zone | `DateTime.now`, `DateTime.make`, `DateTime.makeZoned`, `DateTime.zoneFromString`, `DateTime.setZone`, `DateTime.makeUnsafe`, `DateTime.makeZonedUnsafe`, `DateTime.zoneMakeNamedUnsafe`, `DateTime.isDateTime`, `DateTime.isUtc`, `DateTime.nowUnsafe`, `DateTime.distance` | 19 |
| `apps/web/src/content/docs/v4/data-types/duration.mdx` | Duration | Guides / Data Types | constructing finite and infinite durations; extracting values in chosen units; comparing durations; adding and scaling durations; converting and formatting durations | `Duration.fromInputUnsafe`, `Duration.millis`, `Duration.seconds`, `Duration.minutes`, `Duration.infinity`, `Duration.toMillis`, `Duration.nanos`, `Duration.toNanos`, `Duration.toNanosUnsafe`, `Duration.isLessThan`, `Duration.isLessThanOrEqualTo`, `Duration.isGreaterThan` | 9 |
| `apps/web/src/content/docs/v4/data-types/result.mdx` | Result | Guides / Data Types | representing synchronous success or failure; distinguishing results from execution exits; constructing and identifying variants; matching and mapping outcomes; converting results into effects; sequencing and combining results with generators | `Result.succeed`, `Result.fail`, `Result.map`, `Result.mapError`, `Result.mapBoth`, `Result.flatMap`, `Result.all`, `Result.gen`, `Result.Result`, `Effect.fromResult`, `Result.isFailure`, `Result.match` | 14 |
| `apps/web/src/content/docs/v4/data-types/exit.mdx` | Exit | Guides / Data Types | representing full execution outcomes; creating success and cause-based failure exits; matching exit variants; relating exits to results and effects | `Exit.match`, `Cause.pretty`, `Exit.succeed`, `Cause.fail`, `Exit.failCause`, `Exit.fail`, `Exit.Success`, `Exit.Failure` | 3 |
| `apps/web/src/content/docs/v4/data-types/hash-set.mdx` | HashSet | Guides / Data Types | choosing immutable or mutable hash-based sets; understanding equality and uniqueness; constructing and changing sets; querying membership and size; balancing performance and persistence; converting to JavaScript collections | `HashSet.add`, `Equal.equals`, `HashSet.make`, `HashSet.size`, `MutableHashSet.size`, `MutableHashSet.add`, `Equal.Equal`, `HashSet.empty`, `MutableHashSet.make`, `HashSet.remove`, `Equal.symbol`, `MutableHashSet.empty` | 8 |
| `apps/web/src/content/docs/v4/data-types/option.mdx` | Option | Guides / Data Types | representing optional values and properties; constructing and identifying variants; mapping, sequencing, and filtering present values; extracting values with defaults or exceptions; choosing fallback options; adapting nullable values; converting options into effects; combining options with generators; deriving equality and ordering | `Option.some`, `Option.none`, `Option.map`, `Option.flatMap`, `Option.match`, `Option.all`, `Option.gen`, `Option.Option`, `Option.fromNullishOr`, `Option.getOrNull`, `Option.getOrUndefined`, `Option.getOrElse` | 30 |
| `apps/web/src/content/docs/v4/data-types/redacted.mdx` | Redacted | Guides / Data Types | wrapping sensitive values; revealing values deliberately; wiping stored secrets; comparing protected values | `Redacted.make`, `Redacted.value`, `Redacted.wipeUnsafe`, `Redacted.makeEquivalence` | 4 |
| `apps/web/src/content/docs/v4/trait/equal.mdx` | Equal | Guides / Trait | checking structural equality; implementing the equality protocol; opting into reference identity; using custom equality in hash-based collections | `Equal.equals`, `Equal.Equal`, `HashSet.add`, `HashSet.size`, `Equal.symbol`, `Hash.symbol`, `Hash.hash`, `HashSet.empty`, `HashMap.set`, `HashMap.size`, `HashMap.get`, `Equal.byReference` | 8 |
| `apps/web/src/content/docs/v4/trait/hash.mdx` | Hash | Guides / Trait | connecting hashing to equality; implementing the hashing protocol; keeping equal values hash-consistent | `Equal.equals`, `Equal.Equal`, `Equal.symbol`, `Hash.symbol`, `Hash.hash` | 1 |
| `apps/web/src/content/docs/v4/behaviour/equivalence.mdx` | Equivalence | Guides / Behaviour | representing a reusable equality relation; choosing built-in relations; deriving comparisons through input projections | `Equivalence.String`, `Equivalence.Date`, `Equivalence.mapInput`, `Equivalence.Number` | 3 |
| `apps/web/src/content/docs/v4/behaviour/order.mdx` | Order | Guides / Behaviour | using built-in orderings; sorting values; deriving and combining comparison rules; reversing an ordering; checking comparisons; selecting extrema; clamping values and testing ranges | `Order.Number`, `Order.String`, `Order.mapInput`, `Order.BigInt`, `Order.isLessThan`, `Order.isGreaterThan`, `Order.isLessThanOrEqualTo`, `Order.isGreaterThanOrEqualTo`, `Order.min`, `Order.max`, `Order.combine`, `Order.flip` | 12 |
| `apps/web/src/content/docs/v4/schema/introduction.mdx` | Introduction to Effect Schema | Guides / Schema | configuring compiler prerequisites; understanding schemas and codecs; distinguishing decoded and encoded views; decoding or encoding unknown inputs; reasoning about conversion round trips | `Schema.Struct`, `Schema.optionalKey`, `Schema.String`, `Schema.decodeSync`, `Schema.FiniteFromString` | 3 |
| `apps/web/src/content/docs/v4/schema/getting-started.mdx` | Getting Started | Guides / Schema | declaring schemas; extracting decoded, encoded, and service types; understanding default immutability; choosing synchronous, result, or effect decoding; encoding values; handling schema failures; configuring excess-property and error collection behavior; deriving guards and assertions | `Schema.decodeUnknownSync`, `Schema.decodeUnknownResult`, `Schema.decodeUnknownEffect`, `Schema.encodeSync`, `Schema.Struct`, `Schema.String`, `Schema.Finite`, `Schema.Codec`, `Schema.Schema`, `Schema.FiniteFromString`, `Schema.decodeUnknownPromise`, `Schema.decodeTo` | 25 |
| `apps/web/src/content/docs/v4/schema/basic-usage.mdx` | Basic Usage | Guides / Schema | modeling primitives, symbols, literals, enums, and template strings; building unions and tagged alternatives; defining tuples with optional and rest elements; modeling mutable and nonempty arrays; declaring records and index signatures; creating structs and tagged structs; validating class instances; selecting, removing, and changing optional fields | `Schema.Struct`, `Schema.Record`, `Schema.Tuple`, `Schema.Union`, `Schema.TemplateLiteral`, `Schema.TaggedStruct`, `Schema.Finite`, `Schema.String`, `Schema.decodeUnknownSync`, `Schema.Literal`, `Schema.Literals`, `Schema.Boolean` | 75 |
| `apps/web/src/content/docs/v4/schema/filters.mdx` | Filters | Guides / Schema | defining predicate-based checks; annotating validation checks; assigning issue paths and reporting several issues; applying built-in string, numeric, collection, date, decimal, and duration constraints | `Schema.makeFilter`, `Schema.String`, `Schema.Finite`, `Schema.BigInt`, `Schema.BigDecimal`, `Schema.Date`, `Schema.Duration`, `Schema.isMinLength`, `Schema.isBetweenLength`, `Schema.isGreaterThanOrEqualTo`, `Schema.isInt`, `Schema.Array` | 14 |
| `apps/web/src/content/docs/v4/schema/advanced-usage.mdx` | Advanced Usage | Guides / Schema | declaring custom scalar and parameterized schemas; adding interpreter support; creating branded schemas; applying constructor defaults; distinguishing optional keys, optional values, null, and absence; mapping optional fields to options; transforming field presence; extending and renaming fields; modeling recursive and mutually recursive codecs | `Schema.decodeUnknownSync`, `Schema.Struct`, `Schema.String`, `SchemaGetter.transformOptional`, `Schema.FiniteFromString`, `Schema.optionalKey`, `Schema.encodeSync`, `Schema.decodeTo`, `Schema.Finite`, `Schema.Array`, `Schema.NullOr`, `Schema.encodeKeys` | 47 |
| `apps/web/src/content/docs/v4/schema/projections.mdx` | Schema Projections | Guides / Schema | projecting a codec to its decoded schema; projecting a codec to its encoded schema; retaining checks appropriate to each side | `Schema.Struct`, `Schema.Constraint`, `Schema.toType`, `Schema.isGreaterThanOrEqualTo`, `Schema.decodeUnknownSync`, `Schema.toEncoded`, `Schema.String`, `Schema.isMinLength`, `Schema.Trim`, `Schema.FiniteFromString`, `Schema.Finite`, `Schema.decodeTo` | 4 |
| `apps/web/src/content/docs/v4/schema/transformations.mdx` | Schema Transformations | Guides / Schema | defining reversible infallible and fallible conversions; understanding transformation inputs and outputs; running asynchronous conversions with dependencies; forbidding an encoding direction; composing transformations and effectful checks; converting string case, JSON, and binary encodings; parsing numeric, date, and decimal values | `Schema.decodeTo`, `SchemaTransformation.transform`, `SchemaGetter.transformEffect`, `Schema.decodeUnknownSync`, `Schema.String`, `Schema.decodeUnknownEffect`, `Schema.Literals`, `Schema.Array`, `SchemaGetter.passthrough`, `Schema.Boolean`, `Schema.FiniteFromString`, `Schema.encodeSync` | 26 |
| `apps/web/src/content/docs/v4/schema/annotations.mdx` | Schema Annotations | Guides / Schema | attaching built-in metadata; controlling decoding concurrency; recovering decoding failures with fallback values; defining custom schema annotations | `Schema.catchDecoding`, `Schema.String`, `Schema.decode`, `Schema.Tuple`, `Schema.decodeEffect`, `SchemaIssue.Issue`, `Schema.decodeUnknownSync`, `Schema.check`, `Schema.isNonEmpty`, `Schema.makeFilter`, `Schema.annotate`, `Schema.annotateEncoded` | 10 |
| `apps/web/src/content/docs/v4/schema/canonical-codecs.mdx` | Canonical Codecs | Guides / Schema | deriving standard JSON, string-tree, and identity codecs; supplying canonical conversions for custom declarations; relating canonical representations to JSON Schema output | `Schema.toCodecJson`, `Schema.toCodecStringTree`, `Schema.toCodecIso`, `Schema.encodeSync`, `Schema.decodeUnknownSync`, `Schema.Struct`, `Schema.Array`, `Schema.String`, `Schema.Finite`, `Schema.Date`, `Schema.URL`, `Schema.Int` | 6 |
| `apps/web/src/content/docs/v4/schema/error-messages.mdx` | Error Messages | Guides / Schema | understanding default validation messages; identifying schemas in error output; customizing messages for checks and conversions; assigning messages to scalar and compound values; explaining missing fields | `Schema.decodeUnknownSync`, `Schema.String`, `Schema.Struct`, `Schema.Finite`, `Schema.isMinLength`, `Schema.isMaxLength`, `Schema.annotateKey`, `Schema.decodeTo`, `SchemaGetter.transformEffect`, `SchemaIssue.InvalidValue`, `Schema.Union`, `Schema.isNonEmpty` | 16 |
| `apps/web/src/content/docs/v4/schema/error-formatters.mdx` | Error Formatters | Guides / Schema | rendering schema issues as readable strings; reporting several issues; formatting standard-schema validation errors; customizing leaf messages; connecting validation to form libraries | `Schema.Struct`, `Schema.String`, `Schema.decodeUnknownResult`, `SchemaIssue.makeFormatterStandardSchemaV1`, `Schema.Finite`, `SchemaIssue.defaultLeafHook`, `SchemaIssue.makeFormatterDefault` | 5 |
| `apps/web/src/content/docs/v4/schema/classes.mdx` | Class APIs | Guides / Schema | declaring validated classes; constructing and checking instances; bypassing checks deliberately; defining structural equality; adding getters and methods; using classes as codecs; annotating classes; modeling recursive classes; creating tagged variants and extending classes | `Schema.Class`, `Schema.TaggedClass`, `Schema.Finite`, `Schema.NonEmptyString`, `Schema.Array`, `Schema.String`, `Schema.suspend`, `Schema.FiniteFromString`, `Schema.Codec`, `Schema.decodeUnknownSync`, `Schema.Struct`, `Schema.Literal` | 22 |
| `apps/web/src/content/docs/v4/schema/default-constructors.mdx` | Default Constructors | Guides / Schema | constructing structs and records; applying filters and brands during construction; handling constructor failures; setting nested and lazy defaults; reusing defaults; initializing schema-backed classes | `Schema.withConstructorDefault`, `Schema.Finite`, `Schema.Struct`, `Schema.NonEmptyString`, `Schema.isBetween`, `Schema.String`, `Schema.FiniteFromString`, `Schema.Record`, `Schema.check`, `Schema.brand`, `Schema.Class` | 13 |
| `apps/web/src/content/docs/v4/schema/effect-data-types.mdx` | Effect Data Types | Guides / Schema | building configuration-compatible codecs; encoding options, results, and exits; supporting native and Effect collections; converting durations and protected values | `Schema.Option`, `Schema.Result`, `Schema.Exit`, `Schema.HashSet`, `Schema.HashMap`, `Schema.Duration`, `Schema.Redacted`, `Schema.decodeUnknownSync`, `Schema.encodeSync`, `Schema.FiniteFromString`, `Schema.toCodecJson`, `Schema.String` | 17 |
| `apps/web/src/content/docs/v4/schema/standard-schema.mdx` | Schema to Standard Schema | Guides / Schema | adapting codecs to the standard validation interface; choosing synchronous or asynchronous validation; handling defects during validation | `Schema.String`, `Schema.toStandardSchemaV1`, `Schema.Struct`, `Schema.decodeTo`, `Schema.NonEmptyString` | 3 |
| `apps/web/src/content/docs/v4/schema/arbitrary.mdx` | Schema to Arbitrary | Guides / Schema | generating schema-conforming random values; translating filters into generation constraints; handling opaque checks and transformed values; checking properties; composing generators and customizing shrinking; supporting custom declarations; diagnosing derivation failures | `Arbitrary.schema`, `Arbitrary.sampleEffect`, `Arbitrary.checkEffect`, `Schema.Int`, `Schema.isBetween`, `Schema.String`, `Schema.isPattern`, `Schema.Struct`, `Schema.NonEmptyString`, `Schema.isMinLength`, `Schema.isMaxLength`, `Schema.makeFilter` | 9 |
| `apps/web/src/content/docs/v4/schema/json-schema.mdx` | Schema to JSON Schema | Guides / Schema | exporting JSON Schema documents; selecting canonical JSON representations and specification drafts; carrying annotations and encoded-side metadata; exporting constraints and optional fields; emitting references for recursive definitions; adjusting document generation; describing JSON string codecs | `Schema.toJsonSchemaDocument`, `Schema.String`, `Schema.Struct`, `Schema.Finite`, `Schema.FiniteFromString`, `Schema.Tuple`, `JsonSchema.toDocumentDraft07`, `Schema.Trim`, `Schema.annotateEncoded`, `Schema.isMinLength`, `Schema.isMaxLength`, `Schema.isPattern` | 13 |
| `apps/web/src/content/docs/v4/schema/equivalence.mdx` | Schema to Equivalence | Guides / Schema | deriving equality from schemas; handling broad schemas and custom declarations; overriding generated comparison behavior | `Schema.toEquivalence`, `Schema.Struct`, `Schema.String`, `Schema.Finite`, `Schema.Array`, `Schema.instanceOf`, `Schema.overrideToEquivalence`, `Schema.Any`, `Schema.Unknown`, `Schema.ObjectKeyword` | 4 |
| `apps/web/src/content/docs/v4/schema/formatter.mdx` | Schema to Formatter | Guides / Schema | deriving value formatters from schemas; customizing formatting at selected syntax-tree nodes | `Schema.String`, `Schema.toFormatter`, `Schema.Struct`, `Schema.Finite`, `Schema.overrideToFormatter` | 3 |
| `apps/web/src/content/docs/v4/schema/compilers.mdx` | Schema Compilers | Guides / Schema | understanding optimized validation paths; enabling just-in-time compilation and fallback; generating and loading ahead-of-time validators; using lower-level compiler APIs; understanding specialized operations, registries, startup behavior, and optimization limits | `SchemaJITCompiler.enable`, `SchemaAST.toType`, `SchemaAST.flip`, `SchemaAOTCompilerBuild.build`, `SchemaAOTCompiler.compile` | 9 |
| `apps/web/src/content/docs/v4/platform/introduction.mdx` | Introduction to Effect Platform | Guides / Platform | choosing portable platform services; installing runtime-specific packages; writing platform-independent programs; supplying Node, Deno, or Bun implementations | `Path.Path`, `Path.layer`, `NodeRuntime.runMain`, `NodeServices.layer`, `BunRuntime.runMain`, `BunServices.layer` | 13 |
| `apps/web/src/content/docs/v4/platform/file-system.mdx` | FileSystem | Guides / Platform | requesting the file-system service; performing file operations; supplying platform implementations; replacing file-system behavior in tests | `FileSystem.FileSystem`, `NodeServices.layer`, `FileSystem.layerNoop` | 3 |
| `apps/web/src/content/docs/v4/platform/path.mdx` | Path | Guides / Platform | requesting the path service; manipulating paths portably; supplying a platform path implementation | `Path.Path`, `NodeServices.layer` | 2 |
| `apps/web/src/content/docs/v4/platform/platformlogger.mdx` | PlatformLogger | Guides / Platform | writing formatted logs to a file; supplying file-system dependencies; combining file and console output | `Logger.toFile`, `Logger.layer`, `NodeFileSystem.layer`, `Logger.formatLogFmt`, `Logger.consolePretty` | 2 |
| `apps/web/src/content/docs/v4/platform/runtime.mdx` | Runtime | Guides / Platform | running a platform application entry point; configuring runtime launch behavior; handling completion and failures | `NodeRuntime.runMain` | 4 |
| `apps/web/src/content/docs/v4/platform/terminal.mdx` | Terminal | Guides / Platform | requesting terminal services; writing standard output; reading standard input; handling terminal quit errors; building an interactive guessing program | `Terminal.Terminal`, `NodeTerminal.layer`, `Terminal.QuitError` | 4 |

## VibeLang feature inventory

These original pages supplement the 110 mirrored Effect pages. They have no upstream counterparts.

| Local page | Topics |
| --- | --- |
| [Control operations and handlers](src/vibelang-features/111-control-operations-and-handlers.md) | Declaration, performing, policies, resuming, abandonment, cleanup, fiber diagnostics |
| [Producers](src/vibelang-features/112-producers.md) | Lazy yields, services, early cleanup, Stream operators and iteration |
| [Building an HTTP API](src/vibelang-features/113-building-an-http-api.md) | Server layers, routing, Schema bodies, typed errors, socket-free testing |
| [VibeLang for Effect users](src/vibelang-features/114-vibelang-for-effect-users.md) | Idiom translation, programs, top-level declarations, platform work, expected failures |
| [Cheat sheet](src/vibelang-features/115-cheat-sheet.md) | Every VibeLang change beside the Effect code it replaces |
| [Pattern matching with match and is](src/vibelang-features/116-match-and-is.md) | `match` arms, every pattern kind, Option, Exit, and Result matchers, custom matchers, `is` bindings, exhaustiveness |
| [Token counts](src/vibelang-features/117-token-counts.md) | Tokens an agent loads: the skill, each page, and each cheat-sheet entry in Effect TypeScript and VibeLang |
| [Experimental platform APIs](src/vibelang-features/118-experimental-platform-apis.md) | What VibeLang adds where Effect lacks an API: `Experimental.FileSystem`, `Crypto`, `Process` and `Locks`, their layers, and how they leave |

## Counts by sidebar section

| View | Section or root page | Pages |
| --- | --- | ---: |
| Onboarding | Start Here | 2 |
| Onboarding | Learning Path | 5 |
| Onboarding | Core Concepts | 5 |
| Guides | Getting Started | 1 |
| Guides | Error Management | 11 |
| Guides | Requirements Management | 4 |
| Guides | Resource Management | 2 |
| Guides | Observability | 4 |
| Guides | Configuration | 1 |
| Guides | Runtime | 1 |
| Guides | Scheduling | 4 |
| Guides | State Management | 3 |
| Guides | Batching | 1 |
| Guides | Caching | 2 |
| Guides | Concurrency | 6 |
| Guides | Stream | 6 |
| Guides | Sink | 4 |
| Guides | Testing | 1 |
| Guides | Code Style | 6 |
| Guides | Data Types | 11 |
| Guides | Trait | 2 |
| Guides | Behaviour | 2 |
| Guides | Schema | 20 |
| Guides | Platform | 6 |
| VibeLang features | Original language guides | 8 |
| **Total** | | **118** |

## Counts by upstream directory

These counts preserve comparability with the preliminary attribution inventory; onboarding moves pages between sidebar views, not between source directories.

| Source directory under `v4/` | Pages |
| --- | ---: |
| (root pages) | 5 |
| behaviour | 2 |
| caching | 2 |
| code-style | 6 |
| concurrency | 7 |
| data-types | 11 |
| error-management | 12 |
| getting-started | 9 |
| observability | 4 |
| platform | 6 |
| requirements-management | 4 |
| resource-management | 2 |
| scheduling | 4 |
| schema | 20 |
| sink | 4 |
| state-management | 3 |
| stream | 6 |
| testing | 1 |
| trait | 2 |
| **Total** | **110** |

## Read failures

None. All 110 page sources were read at the pinned commit.
