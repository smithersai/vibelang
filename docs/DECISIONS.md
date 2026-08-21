# VibeLang decision ledger

This is the concise source of truth for decisions made during early design. It
records direction, not complete normative semantics; `SPEC.md` will eventually
replace it.

Status:

- **Locked** — explicitly accepted by the language designer.
- **Direction** — accepted principle whose detailed spelling or mechanics remain open.
- **Open** — discussed but not decided.

Last reconciled: 2026-08-20.

## Identity and compatibility

- **Locked:** The language is named **VibeLang**.
- **Locked:** VibeLang source uses `.vibe`.
- **Open:** The JSX-capable extension has not been confirmed; `.vibex` must not
  imply a stricter or sounder language mode.
- **Locked:** VibeLang is a true TypeScript superset on the TypeScript target.
  Existing `.ts` code remains valid and behaves as TypeScript.
- **Locked:** VibeLang adds precision incrementally rather than imposing a
  globally sound type system. TypeScript escape hatches remain available and
  can be discouraged by lint rules.

## Function model

- **Locked:** Functions remain ordinary, eager functions. There is no
  `Effect<A, E, R>` value, interpreter, or `.run()` step.
- **Locked:** Function types conceptually carry three inferred channels:
  return value `A`, typed failures `E`, and requirements `R`.
- **Locked:** Errors and requirements are inferred whenever possible, including
  transitively through calls. Explicit annotations pin/check the inferred row;
  they do not activate the feature.
- **Locked:** VibeLang does not introduce an Effect-style fiber runtime.
- **Direction:** The native target has a Go-like compiled runtime with garbage
  collection, while the TypeScript target lowers to ordinary TypeScript/JS.

## Typed failures

- **Locked:** Typed errors are optional. Inference-impossible TypeScript/JS
  boundaries default to `unknown`.
- **Locked:** Declared failures are tagged at runtime and distinct from defects.
- **Locked:** VibeLang catch expressions catch declared failures; defects keep
  unwinding. Existing JavaScript `try/catch` retains its normal behavior.
- **Locked:** Sync and async code share one error channel. `await` preserves and
  propagates the awaited operation's typed failures.
- **Direction:** `!T` denotes an inferred checked failure set; `throws E` pins an
  explicit set, especially at exported boundaries. Exact grammar remains to be
  finalized.
- **Locked:** `try` and `catch` are expressions, using Zig as the primary syntax
  inspiration.
- **Locked:** `defer` and `errdefer` are supported.

## Optionals and nullability

- **Locked:** VibeLang must add Zig-style optionals and nullability; this was
  missing from the original feature list.
- **Direction:** The surface includes `?T`, `null`, payload capture,
  `value orelse fallback`, and `value.?` for an asserted unwrap.
- **Locked:** Optional absence and typed failure are separate concepts.
- **Locked:** Existing TypeScript `undefined`, optional parameters, and optional
  properties remain supported for TypeScript compatibility.
- **Open:** The precise conversions between `?T`, `T | null`, and
  `T | undefined`, including nested optionals, need normative rules.

## Requirements and dependency injection

- **Locked:** Requirements are named context parameters, for example
  `uses db: Db, log: Logger`; the names are lexical bindings and service
  identity is nominal.
- **Locked:** Requirements propagate through callers by inference.
- **Locked:** Provider composition is imported from `vibelang:provider`, not
  expressed as a special `provide { ... }` block.
- **Locked:** VibeLang uses Effect-like layers for creating implementations and
  providing them to ordinary functions.
- **Direction:** A layer carries what it provides, how construction can fail,
  and what construction itself requires: `Layer<Provides, Error, Requires>`.
- **Open:** Layer acquisition, memoization, scoping, override, and disposal APIs
  need to be specified.
- **Open:** The JS lowering may use compiler-threaded hidden environment
  parameters; ambient context is not a locked implementation choice.

## Imports and platform dependencies

- **Locked:** JSON has a concise const-import form that needs no handwritten
  declaration or schema and produces a deeply readonly literal type. Existing
  TypeScript JSON imports retain their existing types and runtime behavior.
- **Locked:** Markdown and MDX are supported by built-in loaders. MDX is a
  general module format; libraries may supply component vocabularies and
  runtimes for domains such as agent prompts.
- **Locked:** Arbitrary file formats can be integrated through user-defined
  comptime loaders. A loader turns compiler-known input into a typed module;
  users do not duplicate its result type in a declaration file.
- **Direction:** File imports are first-class incremental build nodes. Their
  keys include the input content, loader implementation and options, target,
  and declared transitive dependencies.
- **Open:** The exact loader registration syntax and the default module shapes
  for Markdown and MDX remain to be specified. The exact const-JSON import
  grammar is also open; see `docs/ASSET_LOADERS.md`.
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
  filesystem requirement can be supplied by Node, Bun, Deno, native, WASI, or
  a test implementation when available.
- **Locked:** Importing Zig and Rust through generated, strongly typed Wasm or
  native bindings should be exceptionally easy; Bun is an interoperability
  inspiration.
- **Direction:** Existing C, Zig, Rust, Bun, Deno, or libuv implementations may
  be reused behind providers where technically and legally suitable.

## TypeScript and native classification

- **Locked:** The TypeScript target supports the complete TypeScript language.
- **Locked:** VibeLang also targets near-native code through LLVM and should
  support Wasm.
- **Locked:** Features are classified in three ways:
  1. portable and implemented on TypeScript and native targets;
  2. valid but adding the built-in `TypeScript` requirement;
  3. forbidden in authored `.vibe` code.
- **Locked:** The `TypeScript` requirement propagates transitively through
  callers like every other requirement.
- **Locked:** A function explicitly pinned as native is a checked assertion. It
  is a compile error if any transitive operation or provider requires
  `TypeScript`; diagnostics must show the dependency path.
- **Locked:** Using `any` adds the `TypeScript` requirement rather than being
  globally forbidden. General VibeLang guidance may still lint against it.
- **Locked:** `eval` remains usable but adds the `TypeScript` requirement.
- **Direction:** Normal classes, fixed fields, methods, and statically known
  inheritance should work on both targets. Prototype mutation and other dynamic
  class behavior will either require `TypeScript` or be forbidden.
- **Locked:** Arbitrary dynamic import expressions are initially unavailable in
  native code. A future bundler-style implementation may make finite,
  enumerable import sets portable.
- **Direction:** VibeLang owns a GC/runtime for native code; closures, classes,
  generics, unions, and async functions are not rejected merely because they
  require runtime support.
- **Open:** The exact per-feature classification table remains to be designed.
  In particular, `Proxy`, prototype APIs, reflective descriptors, weak
  references, custom thenables, and Promise subclassing are not yet locked.
- **Open:** Type assertion semantics need a final decision. Current candidate:
  safe assertions erase; reifiable assertions may check and defect on failure;
  assertions that cannot be made safe add `TypeScript`. Native casts must never
  reinterpret memory unsafely.
- **Open:** Exact spelling for the native pin is undecided.

## Comptime and runtime validation

- **Locked:** Comptime follows Zig: the compiler evaluates code automatically
  when possible, and explicit `comptime` forces compile-time evaluation.
- **Locked:** Comptime may generate types.
- **Locked:** Comptime I/O follows Zig's model. Compiler-known imports/embedding,
  including JSON used to derive types, are supported; arbitrary unavailable
  runtime operations are not silently performed during compilation.
- **Locked:** There is no `runtime type` declaration modifier.
- **Locked:** Validators, codecs, schemas, equality, hashing, and similar
  artifacts are derived at comptime from ordinary types.
- **Locked:** External data remains `unknown` until parsed or validated, as a
  best practice rather than a globally enforced rule on the TypeScript target.

## Expression-oriented language

- **Locked:** Blocks, `if`, `switch`, `while`, and `for` can be expressions.
- **Locked:** Expression control flow follows Zig where new syntax is needed,
  while staying as close to TypeScript as possible.
- **Direction:** Labeled `break` values and loop `else` are part of the design.
- **Locked:** Throw expressions and declarations in conditionals are adopted
  early from TC39 work.

## Concurrency

- **Locked:** Prefer relevant TC39 concurrency work instead of inventing a fiber
  abstraction.
- **Locked:** Typed workers/module expressions, source-phase imports, shared
  structs, governors, bounded unordered async iteration, typed joins such as
  `await.all`, keyed joins, cancellation, and cross-realm typed failure
  transport are adopted directions.
- **Locked:** Cancellation is visible in typed failures and is provided through
  the dependency model rather than manually threaded tokens.
- **Direction:** Promise behavior that prevents efficient or sound native
  compilation may require `TypeScript`; the exact supported Promise subset is
  still open.

## Durable execution

- **Locked:** Durable execution is a language-level feature, not merely an
  observability library.
- **Locked:** VibeLang's durable execution supersedes the need to build the
  separate `~/flows` library. That implementation is prior art and reusable
  runtime machinery, not the required user API.
- **Locked:** An Action is an abstract runtime operation with an open,
  replaceable provider implementation and a closed typed signature.
- **Locked:** An Action implementation is an ordinary function or callback.
  There is no separate Effect value in VibeLang and no Action implementation
  wrapper beyond the policy/provider object that installs the function.
- **Locked:** Action input, success, failure, and requirement information comes
  from its function signature. Persistence schemas/codecs are derived by the
  compiler; source code never repeats those types as schema arguments.
- **Locked:** A Flow is a closed comptime program that emits a statically
  analyzable execution-plan template from Action calls.
- **Locked:** Calling `Action.run` while compiling a Flow emits a node rather
  than performing the operation. Its typed symbolic result creates data edges
  through ordinary projections and argument passing.
- **Locked:** A Flow callback disappears after the compiler emits the plan
  template, schemas, requirements, error set, identities, and debug map.
- **Locked:** Runtime-dependent control flow is legal only when represented
  explicitly in Plan IR; it may not secretly inspect an Action result while
  constructing the plan.
- **Locked:** Durable Actions and Flow executions can run across processes,
  sandboxes, and machines. Deployment builds can emit multiple TypeScript,
  native, or Wasm worker artifacts plus a coordinator and routing manifest.
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
  environment by default; VibeLang adds no agent-specific sandbox syntax,
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
  Effect's standard library while presenting ordinary VibeLang APIs.
- **Locked:** Platform is a universal dependency and platform implementations
  are selected through capabilities and comptime.
- **Direction:** Compute-heavy portable components may use Wasm, especially
  implementations written in Zig, but JS/Wasm boundaries are chosen by
  measurement rather than ideology.
- **Direction:** The standard library includes typed schema/validation,
  collections, configuration, streams, schedules, batching, platform services,
  and structured concurrency without copying Effect's wrapper/combinator
  ceremony.

## TC39 policy already accepted

- **Locked:** Adopt early where suitable: module expressions; source-phase
  imports; structs/shared structs; governors; async iterator helpers including
  unordered operation; `await.all`/`race`/`any`/`allSettled`; keyed joins; throw
  expressions; declarations in conditionals; discard bindings; Import Text and
  Import Bytes; cheap stack capture; `Reflect.panic`; cancellation; and a worker
  failure protocol.
- **Locked:** Capabilities subsume AsyncContext for compiled dependency
  propagation; an interop adapter may exist at TypeScript boundaries.
- **Locked:** VibeLang owns expression-form control-flow grammar while leaving
  future pattern-matching syntax room to converge with TC39.
- **Locked:** Forked platform declarations must be audited for typed failures,
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
- **Locked:** The fork should make TypeScript extensible/configurable through a
  narrow plugin interface rather than embedding every VibeLang feature directly
  throughout upstream code.
- **Locked:** The TypeScript backend lowers VibeLang constructs into TypeScript
  before the ordinary TypeScript pipeline completes checking and emission where
  feasible.
- **Direction:** Content mappers are useful for the earliest prototype and
  editor support, but LLVM/Wasm likely require a shared checked VibeLang IR.
- **Open:** The exact compiler seams and plugin ABI require an architecture
  audit of current upstream TypeScript.
- **Locked:** The toolchain should follow Go's batteries-included model:
  compiler, formatter, test tooling, language service, and build integration in
  one coherent distribution.
- **Direction:** Comptime loaders and their imported assets participate in the
  compiler's content-addressed incremental graph, forming an early part of the
  broader build-machine design without requiring loader authors to use a
  separate build language.
- **Direction:** The compiler should grow into a Bazel-like incremental build
  machine. Parsing, checking, comptime evaluation, loaders, generated code,
  custom linters, Flow planning, foreign compilation, bundling, and deployment
  partitioning are explicit graph work with content identities and declared
  dependencies.
- **Open:** The build graph, rule/plugin contract, remote cache/execution
  boundary, and integration seams with TypeScript's existing incremental state
  require their own architecture design.

## Immediate unresolved design work

1. Assign every dynamic TypeScript/JavaScript feature to portable,
   `TypeScript`-required, or forbidden.
2. Finalize checked versus TypeScript-only semantics for `as`.
3. Specify `?T` interoperability with TypeScript null and undefined unions.
4. Define `Layer` lifecycle and the lowering of requirement environments.
5. Resolve the durable execution questions in `docs/DURABLE_EXECUTION.md`, one
   at a time.
6. Define the shared Plan/expression IR and then map it onto current TypeScript
   compiler seams.
7. Specify the comptime loader registration API and the built-in Markdown/MDX
   module shapes.
8. Design the agent library's minimal prompt, turn, execution, and passed-
   function interfaces; this is library work, not language grammar.
9. Design the compiler's incremental build graph and plugin contracts for
   generators, linters, foreign tools, Flow planning, and bundle partitioning.
