# Smithers decision ledger

This is the concise source of truth for decisions made during early design. It
records direction, not complete normative semantics; `SPEC.md` will eventually
replace it.

Status:

- **Locked** — explicitly accepted by the language designer.
- **Direction** — accepted principle whose detailed spelling or mechanics remain open.
- **Open** — discussed but not decided.

Last reconciled with the published specification pages: 2026-08-21.
Latest ledger decisions: 2026-08-21. The published specification pages reflect
the compatibility, foreign-panic, lean Layer, and Promise-lifetime decisions
below as of that date.

## Identity and compatibility

- **Locked:** The language is named **Smithers**.
- **Locked:** Smithers source uses `.sm`.
- **Open:** The JSX-capable extension has not been confirmed; `.smx` must not
  imply a stricter or sounder language mode.
- **Locked:** Smithers is not a syntactic superset of TypeScript. `.sm` has an
  intentionally TypeScript-derived grammar with a small set of deliberate,
  important differences such as failure handling and expression control flow.
- **Locked:** Smithers can directly import TypeScript and JavaScript modules.
  `.ts`, `.tsx`, and JavaScript sources retain their own syntax and semantics;
  they are interoperability inputs, not source that must parse as `.sm`.
- **Locked:** Syntax shared by Smithers and TypeScript keeps TypeScript behavior
  unless a divergence is explicitly accepted and documented. Smithers does not
  make gratuitous syntax changes.
- **Locked:** Smithers adds precision incrementally rather than imposing a
  globally sound type system. TypeScript escape hatches remain available and
  can be discouraged by lint rules.

## Function model

- **Locked:** Functions remain ordinary, eager functions. There is no
  `Effect<A, E, R>` value, interpreter, or `.run()` step.
- **Locked:** A function that can complete with an `Error` returns
  `Result<A, E>`. A fallible async function returns
  `Promise<Result<A, E>>`. Failure is represented by the ordinary return value,
  not an erased side channel.
- **Locked:** Plain `return value` inside a Result-returning function produces
  the success variant. `throw error` produces the error variant and exits the
  function. Authors do not write `Result.ok(...)` or `Result.err(...)`.
- **Locked:** Fallibility and requirements are inferred transitively whenever
  possible. `Result<A, E>` makes the public failure contract explicit;
  compiler-aware context types preserve `R` in editor and declaration
  signatures.
- **Locked:** Smithers does not introduce an Effect-style fiber runtime.
- **Direction:** If a compiled target is ever built it would have a Go-like runtime with garbage
  collection, while the TypeScript target lowers to ordinary TypeScript/JS.

## Typed failures

- **Locked:** Any ordinary class extending `Error` is a nominal recoverable
  error. Smithers does not require a `TaggedError("Name")` factory or separate
  error-declaration syntax. The compiler supplies stable identity and transport
  metadata without changing normal `Error` behavior.
- **Locked:** The `Result` type is built in. Its quality-of-life API is modelled
  on Dillon Mulroy's `better-result`: matching, transformation, sequencing,
  recovery, observation (including the `tap*` family and async variants),
  collection (`all`, `allAsync`, `partition`, `partitionAsync`), foreign
  adaptation (`try`, `tryPromise`), and codecs. Smithers omits `Result.ok`,
  `Result.err`, and `TaggedError` because ordinary `return`, `throw`, and
  `class ... extends Error` construct those, and omits `Result.gen`/`yield*`
  do-notation because postfix `!` already propagates.
- **Locked:** Postfix `!` is the spelling for propagating an error from a
  Result-returning function. `findUser(id)!` yields the success value or returns
  the enclosing function's error variant. The compiler tracks the error type and
  lowers the error path; it never throws a recoverable JavaScript exception.
  This is Zig's `try foo()` with an operator TypeScript already has.
- **Locked:** The TypeScript non-null assertion is removed from `.sm`. `x!` no
  longer asserts non-nullness, and the definite-assignment form `x!: T` is gone
  with it. Removing the old meaning entirely is what makes the slot safe to
  reuse: there is no ambiguity, and the assertion was an unsound escape hatch
  that most codebases already lint against.
- **Locked:** `??` and `?.` keep their ordinary nullish meaning and are never
  reinterpreted for failures. Absence and failure are separate axes: `!` is the
  error axis, `??`/`?.` are the absence axis, and both may appear in one
  expression.
- **Locked:** Reinterpreting existing TypeScript syntax is permitted only when
  three conditions hold together: the old meaning is removed entirely so nothing
  is ambiguous, the syntax is a type error or a no-op in the target position so
  no valid program changes behavior, and the form is already widely lint-banned
  so the removal costs real code nothing. `!` is the only form that has met all
  three so far.
- **Direction:** Each reinterpretation is a per-file dialect divergence that no
  editor, linter, or formatter will flag. The cost scales badly, so the budget
  is small and each use must earn its place.
- **Locked:** Result values are must-use: a Result must be returned, awaited when
  wrapped in a Promise, matched, transformed, explicitly inspected, or
  propagated with `!`. Silently discarding one is a compile error.
- **Locked:** `Error.prototype` has compiler-aware quality-of-life methods,
  initially `is`, `matches`, `match`, `matchPartial`, and `rootCause`.
  `error.match({...})` is exhaustive for a statically known error union and keys
  cases by compiler-stable nominal Error identity.
- **Locked:** There is no general `throws` clause, prefix `try` expression,
  postfix recovery expression, or `!T` marker. Smithers does have an explicit
  way to catch the distinguished `panic` channel; ordinary JavaScript
  `try/catch` remains available inside imported JavaScript and TypeScript.
- **Locked:** An unannotated function that reaches `throw error`, propagates an
  error Result with `!`, or returns a Result is inferred as `Result<A, E>`. Public,
  abstract, and declaration-only contracts spell fallibility directly as
  `Result<A, E>`.
- **Locked:** Every imported JavaScript or TypeScript runtime value is assumed
  capable of throwing unexpectedly or rejecting, even when its declared return
  type does not say so. Calling it therefore adds the distinguished, checked
  `panic` case to the Smithers failure channel by default. This also covers a
  foreign implementation violating its declared signature.
- **Locked:** A caller must propagate that `panic`, explicitly catch it, or call
  through a trusted adapter that catches and translates it. There is no
  unchecked direct use of an unannotated JavaScript or TypeScript function.
- **Locked:** `panic` is available from `smithers:exceptions` and accepts an
  optional message or underlying error. `Reflect.panic` and compiler/runtime
  invariant failures enter the same distinguished channel.
- **Locked:** The compiler recognizes JSDoc on JavaScript and TypeScript
  boundaries. `@throws {never}` is a trusted opt-out from the default `panic`
  case, while `@throws {T}` declares the stated foreign failure channel.
- **Direction:** Foreign `@throws` annotations are trust claims surfaced in
  declarations and tooling. Exact rules for overloads, multiple annotations,
  declaration merging, validation, and generic error types remain to be
  specified.
- **Locked:** Smithers does not add `defer` or `errdefer`. Cleanup uses TC39
  explicit resource management (`using`), which is already standard and already
  in TypeScript. Deferred cleanup was convenient but not a TypeScript pain point
  worth new grammar. Rollback on a Result error exit is written as ordinary code
  in the failure path. The unrelated TC39 `import defer` proposal is untouched by
  this decision.

## Absence and nullability

- **Locked:** Smithers has no built-in `Optional<T>`. Absence uses TypeScript's
  existing `T | undefined` unions with ordinary narrowing, optional chaining,
  and nullish coalescing. TypeScript already expresses this precisely, and every
  JavaScript consumer already understands it.
- **Locked:** Absence and typed failure remain separate concepts. A fallible
  function returns `Result<A, E>`; a lookup that can find nothing returns
  `T | undefined`; one that does both returns `Result<A | undefined, E>`.
- **Locked:** Existing TypeScript `undefined`, optional parameters, and optional
  properties keep their ordinary meaning. Nothing is reinterpreted.
- **Locked:** The `?T`, payload-capture, `orelse`, and `.?` grammar is removed
  and does not return.
- **Direction:** An `Optional<T>` container may be reconsidered later as an
  ordinary standard-library type. It does not get compiler lifting, `!`
  propagation, or outside-in nesting rules if it does.
## Requirements and dependency injection

- **Locked:** A capability is an abstract class extending `Context` from
  `smthrs/context`. The class is both its service contract and nominal key,
  providing an Effect-inspired model with less generic ceremony.
- **Locked:** `Capability.context()` is a compiler-recognized library call. It
  returns the capability instance and adds its class to the enclosing function's
  inferred requirement row; no `uses` source-language grammar is needed.
- **Locked:** The inferred context is part of the function's static type. It is
  not an explicit argument that callers pass by hand.
- **Locked:** Requirements propagate through callers by inference.
- **Locked:** Provider composition is imported from `smthrs/provider`, not
  expressed as a special `provide { ... }` block.
- **Locked:** Layers package and provide implementations to ordinary functions;
  they are dependency environments, not task supervisors or implicit resource
  managers.
- **Locked:** The base public type is exactly `Layer<Provides>`. It receives
  already-acquired implementations, so initialization failures and construction
  requirements are not phantom Layer parameters; higher-level provider policy
  may model those concerns separately.
- **Locked:** `Layer.provide(layer, body)` keeps the layer environment active
  until `body` and the Promise it returns settle. It does not discover, register,
  cancel, or join other Promise work implicitly.
- **Locked:** Revocation happens at the returned Promise's state transition,
  before any queued reaction can reuse the environment. The runtime may reject
  a pre-existing Promise whose earlier observers make that boundary
  unverifiable; `async () => await existingPromise` is the explicit adapter.
  A host without a synchronous Promise-settlement hook must fail closed for an
  async Layer scope rather than leave authority live for an extra microtask.
- **Locked:** Resource acquisition and finalization are explicit ordinary code,
  initially using `using`. A Layer receives an already acquired service;
  it does not own that service's lifetime. Resource-owning Layer conveniences
  may be added later without changing this base rule.
- **Locked:** Fire-and-forget and detached work are initially unavailable in
  authored `.sm`. Every started Promise must be consumed by `await` or by a
  recognized combinator whose resulting Promise is itself consumed before the
  enclosing scope exits.
- **Locked:** Imported JavaScript or TypeScript that starts hidden background
  work owns that work. APIs needing caller-controlled lifetime must be adapted
  to expose an explicit completion and/or disposal handle.
- **Open:** Layer merging, nested override precedence, and requirement-
  environment lowering still need exact APIs and semantics.
- **Open:** The public declaration encoding of the context row and the JS
  lowering may use phantom function metadata, compiler-threaded hidden
  parameters, or ambient context. These choices must not change source calls.

## Imports and platform dependencies

- **Locked:** JSON `with { type: "json", mode: "const" }` needs no handwritten
  declaration or schema and produces a deeply readonly literal type. Existing
  TypeScript JSON imports retain their existing types and runtime behavior.
- **Locked:** Every non-code or foreign-source import uses standard import
  attributes to select its loader and mode. Examples include
  `with { type: "json", mode: "const" }`, `with { type: "text" }`,
  `with { type: "mdx" }`, and `with { type: "zig" }`. File extensions do not
  create a second implicit loader-selection grammar.
- **Locked:** Markdown and MDX are supported by built-in loaders. MDX is a
  general module format; libraries may supply component vocabularies and
  runtimes for domains such as agent prompts.
- **Locked:** Arbitrary file formats can be integrated through user-defined
  comptime loaders. A loader turns compiler-known input into a typed module;
  users do not duplicate its result type in a declaration file.
- **Direction:** File imports are first-class incremental build nodes. Their
  keys include the input content, loader implementation and options, target,
  and declared transitive dependencies.
- **Open:** The exact loader registration API and the default module shapes for
  Markdown and MDX remain to be specified; see `docs/ASSET_LOADERS.md`.
- **Locked:** Platform-specific functionality is always represented by strongly
  typed requirements.
- **Locked:** `process`, `window`, `document`, filesystem, network, and similar
  host facilities are unavailable as ambient globals. They must be supplied as
  dependencies.
- **Locked:** Only facilities present in every JavaScript environment may be
  unconditional globals. Host-sensitive operations on otherwise universal
  objects still need capabilities where applicable, such as clock or random.
- **Locked:** Using a value from TypeScript/JavaScript code is modeled as a
  dependency. Type-only imports do not create runtime requirements.
- **Direction:** Direct host-module usage carries an exact module requirement,
  such as `Module<"node:fs">`, rather than only a coarse platform bit.
- **Locked:** A capability may have different implementations by target. A
  filesystem requirement can be supplied by Node, Bun, Deno, or a test
  implementation when available.
- **Locked:** Importing Zig and Rust through generated, strongly typed Wasm
  bindings should be exceptionally easy; Bun is an interoperability inspiration.
  This is a loader that produces a module the JavaScript host calls, not a
  compilation target.
- **Direction:** Existing C, Zig, Rust, Bun, Deno, or libuv implementations may
  be reused behind providers where technically and legally suitable.

## TypeScript target

- **Locked:** TypeScript is the only compilation target. The TypeScript target
  accepts and interoperates with complete TypeScript in imported `.ts`/`.tsx`
  modules. Authored `.sm` follows the intentionally distinct Smithers grammar.
- **Locked:** A compiled near-native target through LLVM is **withdrawn**. It was
  previously locked as a MUST, was never implemented, and was the largest unmet
  obligation in the repository.
- **Locked:** Wasm as a compilation target is **withdrawn**. Wasm remains
  available as a *library* format: a `.sm` program running on a JavaScript host
  may import Zig or Rust through generated Wasm bindings, which is an asset
  loader rather than a target.
- **Locked:** The built-in `TypeScript` requirement, the portable /
  `TypeScript`-required / forbidden feature classification, and the portability
  pin are all **withdrawn** with it. With a single target, every program depends
  on the JavaScript runtime, so the requirement carried no information and the
  pin had nothing to assert.
- **Locked:** The checked `panic` channel on unannotated foreign calls is
  independent of the above and is retained. It exists because JavaScript can
  throw, not because a second target exists.
- **Locked:** `any` and `eval` remain usable in `.sm`. General Smithers guidance
  may lint against them; the language does not forbid them.
- **Locked:** Arbitrary dynamic import expressions remain available, since there
  is no target that cannot resolve them.
- **Open:** Type assertion semantics need a final decision. Current candidate:
  safe assertions erase, and reifiable assertions may check and defect on
  failure. The TypeScript non-null assertion is already removed, because `!` is
  the Result propagation operator.
- **Direction:** A future compiled or portable target is an undocumented plan,
  not a commitment. If one is ever pursued, the classification machinery removed
  here is what it would need back.
## Comptime and runtime validation

- **Locked:** Comptime follows Zig: the compiler evaluates code automatically
  when possible, while an imported compiler intrinsic forces compile-time
  evaluation.
- **Locked:** Comptime is not a language keyword. Source imports `comptime` from
  `smithers:comptime` and passes it a value or function. The compiler recognizes
  the resolved binding rather than its local spelling, so aliases work and
  unrelated functions named `comptime` remain ordinary.
- **Locked:** `comptime(value)` forces evaluation of the argument during
  compilation. `comptime(functionValue)` marks and returns a compile-time
  function; it does not invoke the function merely because it was passed.
- **Locked:** `smithers:comptime` is a compiler-owned virtual module. Recognized
  imports and calls are lowered or erased, and uncompiled execution must fail
  while loading the virtual module rather than evaluating arguments at runtime.
- **Locked:** Comptime may generate types.
- **Locked:** Comptime I/O follows Zig's model. Compiler-known imports/embedding,
  including JSON used to derive types, are supported; arbitrary unavailable
  runtime operations are not silently performed during compilation.
- **Locked:** There is no `runtime type` declaration modifier.
- **Locked:** Validators, codecs, schemas, equality, hashing, and similar
  artifacts are derived at comptime from ordinary types.
- **Locked:** External data remains `unknown` until parsed or validated, as a
  best practice rather than a globally enforced rule on the TypeScript target.

## Control flow

- **Locked:** Smithers adds no expression-form control-flow grammar. Blocks,
  `if`, `switch`, `while`, and `for` are TypeScript statements and keep
  TypeScript behavior. A value-position `if` is a ternary, and a value-position
  `switch` is a function call or a lookup — neither is a TypeScript pain point
  worth new grammar.
- **Locked:** Smithers does not add labeled `break` values, loop `else`
  completion, labeled block or loop values, `defer`, `errdefer`, a braceless
  value `if`, or an arrow-arm switch. None of these is a TC39 proposal.
- **Locked:** The one accepted grammar addition is declarations in conditionals,
  adopted early from the TC39 Stage 1 proposal of that name. It is accepted
  because it is standards-track, not because it is convenient.
- **Locked:** Smithers does not add a throw-expression grammar in the initial
  scope. Ordinary `throw` statements produce Result errors; expression-form
  throw may be reconsidered when the TC39 proposal is available upstream.
- **Locked:** A future grammar addition requires an active TC39 proposal. Value
  semantics that TypeScript can already express belong in the type system, the
  standard library, or a compiler-recognized imported intrinsic — never in the
  parser.

## Concurrency

- **Locked:** Prefer relevant TC39 concurrency work instead of inventing a fiber
  abstraction.
- **Locked:** Smithers follows TC39's module-expression, source-phase import,
  shared-struct, concurrency-governor, and cancellation work where it fits.
  A governor limits fan-out; it does not own child-task lifetimes.
- **Locked:** Smithers does not add special Promise or join grammar. Static or
  library combinators start concurrent work, `await` consumes the resulting
  Promise, and Result combinators collect expected outcomes.
- **Direction:** A structured-concurrency library combinator may own child
  lifetimes, cancel siblings, and wait for cleanup without changing the parser.
- **Locked:** Cancellation is visible in typed failures and is provided through
  the dependency model rather than manually threaded tokens.
- **Locked:** Authored `.sm` code must transitively consume every started
  Promise with `await`: either directly or through a recognized combinator such
  as `Promise.all` whose result is awaited. Promise instance chaining through
  `.then()`, `.catch()`, or `.finally()` is a compile error. Imported
  TypeScript/JavaScript modules retain normal Promise behavior internally.
- **Locked:** Awaiting a fallible async operation produces its
  `Result<A, E>`; `await` does not silently unwrap or discard the Result.
- **Direction:** Promise behavior that prevents efficient or sound
  compilation may require `TypeScript`; the exact supported Promise subset is
  still open.

## Durable execution

- **Locked:** Durable execution is a language-level feature, not merely an
  observability library.
- **Locked:** Smithers's durable execution supersedes the need to build the
  separate `~/flows` library. That implementation is prior art and reusable
  runtime machinery, not the required user API.
- **Locked:** An Action is an abstract runtime operation with an open,
  replaceable provider implementation and a closed typed signature.
- **Locked:** An Action implementation is an ordinary function or callback.
  There is no separate Effect value in Smithers and no Action implementation
  wrapper beyond the policy/provider object that installs the function.
- **Locked:** Action signatures return `Result<A, E>` or
  `Promise<Result<A, E>>`; input, success, Error, and requirement information
  comes from that ordinary function signature. Persistence schemas/codecs are
  compiler-derived rather than repeated as schema arguments.
- **Locked:** Durable declaration is not a language keyword. Source imports
  `durable` from `smithers:flows` and passes it a statically resolvable function.
  The compiler recognizes the resolved binding rather than its local spelling.
- **Locked:** `smithers:flows` is a compiler-owned virtual module. A recognized
  `durable(...)` call becomes a serializable Flow descriptor referencing emitted
  Plan IR, not a runtime callback wrapper; uncompiled execution fails while
  loading the virtual module.
- **Locked:** A Flow is the closed program produced by lowering the checked
  syntax, control flow, and data flow of a function passed to `durable(...)`
  into a statically analyzable execution-plan template.
- **Locked:** The compiler does not invoke the durable source function with
  proxies or symbolic JavaScript values to discover its graph. An `Action.run`
  expression lowers to a plan node and typed symbolic value; Action
  implementations do not run during template compilation or planning.
- **Locked:** The durable source function disappears after the compiler emits
  the plan template, schemas, requirements, Result error union, identities, and debug
  map. Plan/preview loads emitted Plan IR without loading or invoking that
  function or any Action implementation.
- **Locked:** Durable execution distinguishes template compilation, deployment
  build, plan/preview, and execution. Unknown runtime branches and fan-out stay
  explicit in Plan IR during plan/preview.
- **Locked:** Runtime-dependent control flow is legal only when represented
  explicitly in Plan IR; it may not secretly inspect an Action result while
  constructing the plan.
- **Locked:** Durable Actions and Flow executions can run across processes,
  sandboxes, and machines. Deployment builds can emit multiple TypeScript,
  worker artifacts plus a coordinator and routing manifest.
- **Direction:** Placement belongs to provider/deployment layers rather than
  the abstract Action, allowing multiple target and location implementations
  of one closed signature.
- **Direction:** Durable execution includes persisted lifecycle, attempts,
  retries and deadlines, cancellation, timers/signals, child executions,
  journal/history, idempotency, fencing, compensation, and recovery.
- **Direction:** Cross-machine Action values must satisfy a compiler-checked
  durable schema/codec contract. Large values use typed artifact references.
- **Direction:** Journal and runtime state can commit atomically with each
  other, not with an arbitrary external service. External retry safety requires
  destination-side idempotency/deduplication, a fencing or transaction protocol
  the destination enforces, or an explicit compensation strategy.
- **Locked:** Sealing is a content-cache guarantee, and compensation repairs
  consequences; neither one independently provides exactly-once external
  effects.
- **Direction:** Recovery safety and cache eligibility are separate Action
  policy dimensions. `sealed` means hermetic/deterministic/shared-cache-safe,
  not merely “implemented.”
- **Locked:** Every resolved Action node is adopted into run-local durable state
  before exposure downstream, including cache hits, successes, typed failures,
  and defects. Restart does not depend on a cross-execution cache entry still
  existing.
- **Locked:** Cross-execution reuse distinguishes nondeterministic memoization
  from deterministic content caching. Memoization atomically makes the first
  committed success canonical for an explicit key, scope, and generation;
  content caching asserts that an equivalent result can be reproduced from the
  complete content key.
- **Direction:** Run-local node identity, downstream idempotency identity,
  nondeterministic memo identity, and deterministic content identity are four
  distinct keys. Content keys include canonical inputs, implementation and
  policy versions, relevant dependency/toolchain facts, and explicit salts.
- **Direction:** Content-cache eviction changes performance only. Memo expiry
  or reset opens a new semantic generation while existing runs retain the
  generation and value digest they adopted.
- **Open:** Plan loop/fan-out semantics, provider and deployment syntax, stable
  persisted IDs, wire encoding, migration, and explicit sequencing syntax are
  specified as open questions in `docs/DURABLE_EXECUTION.md`.

## Asset-backed prompts and agents

- **Locked:** Prompt authoring with MDX is provided by the agent library on top
  of the general MDX loader. Prompt components and model-specific rendering are
  library APIs, not language syntax.
- **Locked:** The initial standard agent follows the existing code-writing
  design: on every turn the model produces ordinary TypeScript, which the
  library compiles and runs.
- **Locked:** Generated code can call only the functions explicitly passed into
  its execution environment. Passed functions may be ordinary callbacks,
  durable Actions, compiled Flows, or typed adapters around tools and MCPs.
- **Locked:** The code-writing agent and its sandbox are entirely library-level
  features. The agent library supplies an otherwise confined execution
  environment by default; Smithers adds no agent-specific sandbox syntax,
  effect system, or runtime requirement.
- **Direction:** The reusable agent primitives cover prompt rendering, model
  invocation, turn/history state, TypeScript compilation and execution,
  function-surface binding, and completion. They should make custom agents
  small compositions rather than framework implementations.
- **Direction:** Model calls, generated-code compilation, and execution may be
  wrapped in Actions and assembled with Flows to inherit journaling, caching,
  retries, inspection, and recovery without making those concerns intrinsic to
  the agent API.
- **Open:** Exact agent APIs and sandbox backends are library design work; see
  `docs/AGENT_LIBRARY.md`.

## Standard library

- **Locked:** The standard library should match or improve on the breadth of
  Effect's standard library while presenting ordinary Smithers APIs.
- **Locked:** Platform is a universal dependency and platform implementations
  are selected through capabilities and comptime.
- **Direction:** Compute-heavy components may call into Wasm modules, especially
  implementations written in Zig, but JS/Wasm boundaries are chosen by
  measurement rather than ideology.
- **Direction:** The standard library includes typed schema/validation,
  collections, configuration, streams, schedules, batching, platform services,
  and structured concurrency without copying Effect's wrapper/combinator
  ceremony.

## TC39 policy already accepted

- **Locked:** Adopt early where suitable: module expressions; source-phase
  imports; structs/shared structs; governors; async iterator helpers including
  unordered operation; `Promise.allKeyed`/`allSettledKeyed`; declarations in
  conditionals; discard bindings; Import Text and Import Bytes;
  cheap stack capture; `Reflect.panic`; cancellation; and a worker failure
  protocol. Smithers does not add Promise or structured-join parser syntax.
- **Locked:** Capabilities subsume AsyncContext for compiled dependency
  propagation; an interop adapter may exist at TypeScript boundaries.
- **Locked:** Smithers owns expression-form control-flow grammar while leaving
  future pattern-matching syntax room to converge with TC39.
- **Locked:** Forked platform declarations must be audited for Result errors,
  defects, and requirements.
- **Locked:** Standing rejections include Block Params, reinterpretation of
  existing negated `in`/`instanceof`, partial application that conflicts with
  capability calling conventions, cancelable Promises, withdrawn Record &
  Tuple, and distributed-promise/eventual-send designs.
- **Direction:** Shared structs are adopted but can be implemented after lower
  risk concurrency features.

## Compiler and delivery

- **Locked:** Build on the Go compiler now located under `tsc/` in
  `microsoft/TypeScript`, tracking upstream with a minimal diff.
- **Locked:** The canonical compiler fork is `smithersai/TypeScript`. Smithers
  vendors an exact fork revision at `vendor/typescript` as a squashed Git
  subtree; fork revisions are pinned in `typescript-fork.json`.
- **Locked:** The fork should make TypeScript extensible/configurable through a
  narrow plugin interface rather than embedding every Smithers feature directly
  throughout upstream code.
- **Locked:** The TypeScript backend lowers Smithers constructs into TypeScript
  before the ordinary TypeScript pipeline completes checking and emission where
  feasible.
- **Direction:** Content mappers are useful for the earliest prototype and
  editor support, but a production compiler likely requires a shared checked
  Smithers IR.
- **Open:** The exact compiler seams and plugin ABI require an architecture
  audit of current upstream TypeScript.
- **Locked:** The toolchain should follow Go's batteries-included model:
  compiler, formatter, test tooling, language service, and build integration in
  one coherent distribution.
- **Locked:** `.sm` soundness configuration is mandatory and identical on every
  target: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `isolatedModules`, `verbatimModuleSyntax`, and `useDefineForClassFields`.
  Making soundness target-conditional would mean a file valid for TypeScript is
  inconsistent across builds. Imported `.ts` keeps its own configuration.
- **Locked:** Deprecated and superseded compiler options are rejected rather
  than ignored, including `keyofStringsOnly`, `suppressImplicitAnyIndexErrors`,
  `noStrictGenericChecks`, `out`, `charset`, `importsNotUsedAsValues`,
  `preserveValueImports`, `experimentalDecorators`, and
  `emitDecoratorMetadata`. TypeScript's `erasableSyntaxOnly` set is treated as
  guidance about which forms are dying.
- **Locked:** Emit, module, and library options select output rather than
  legality. They remain configurable, since a `.sm` program may be emitted for
  Node, Bun, Deno, a browser, or an edge runtime.
- **Locked:** Decorators are not the mechanism for `comptime`, `durable`, or
  `native`. The Stage 2.7 proposal attaches only to classes, methods,
  accessors, fields, and auto-accessors — never to free function declarations,
  which is where those intrinsics apply. Free-function and parameter decorators
  are separate Stage 1 proposals. The imported-intrinsic call form also gives
  resolved-binding-identity recognition, which decorators cannot.
- **Locked:** Smithers must work inside existing JavaScript builds without
  adopting a Smithers-specific build system. `.sm` compiles to TypeScript before
  any other build tool processes it, so every downstream plugin sees ordinary
  TypeScript.
- **Locked:** That integration ships as an `unplugin` factory, giving Vite,
  Rollup, webpack, esbuild, Rspack, Rolldown, Farm, and the Bun bundler one
  implementation instead of one hand-maintained adapter each. The plugin runs
  first in the host pipeline, emits source maps, and resolves `.sm` specifiers.
- **Locked:** The plugin is delivery, not semantics. The same lowering the CLI
  performs is what a bundler gets; nothing may behave differently because it was
  built by a bundler.
- **Direction:** Because Smithers inference is whole-program and a bundler
  transform is per-file, the plugin offers a checked mode that drives a real
  program and a transform-only mode for fast rebuilds. Transform-only fails
  closed on anything needing cross-module information and is not a conforming
  implementation.
- **Direction:** Comptime loaders and their imported assets participate in the
  compiler's content-addressed incremental graph, forming an early part of the
  broader build-machine design without requiring loader authors to use a
  separate build language.
- **Direction:** The compiler should grow into a Bazel-like incremental build
  machine. Parsing, checking, comptime evaluation, loaders, generated code,
  custom linters, durable Plan IR lowering and analysis, foreign compilation, bundling, and deployment
  partitioning are explicit graph work with content identities and declared
  dependencies.
- **Open:** The build graph, rule/plugin contract, remote cache/execution
  boundary, and integration seams with TypeScript's existing incremental state
  require their own architecture design.

## Immediate unresolved design work

2. Finalize checked versus TypeScript-only semantics for `as`.
4. Define Layer merge/override rules and requirement-environment lowering; base
   Layers do not own resources or child work.
5. Resolve the durable execution questions in `docs/DURABLE_EXECUTION.md`, one
   at a time.
6. Define the shared Plan/expression IR and then map it onto current TypeScript
   compiler seams.
7. Specify the comptime loader registration API and the built-in Markdown/MDX
   module shapes.
8. Design the agent library's minimal prompt, turn, execution, and passed-
   function interfaces; this is library work, not language grammar.
9. Design the compiler's incremental build graph and plugin contracts for
   generators, linters, foreign tools, durable plan analysis, and bundle partitioning.
