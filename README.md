# VibeLang

**TypeScript with the missing parts compiled in: typed errors, capability-based DI, comptime, and durable distributed execution — no wrapper types or effect interpreter.**

VibeLang is a true superset of TypeScript (`.vibe`). Every `.ts` file is already a valid `.vibe` file and behaves identically. On top of that, ordinary function types carry three channels — **what it returns, how it fails, and what it needs** — and the compiler infers, checks, and erases all of it.

```typescript
import { Layer } from "vibelang:provider";

error NotFound { id: string }
error Timeout  { ms: number }

abstract class Db {
  abstract query(sql: string, params: unknown[]): Promise<Row[], Timeout>;
}
abstract class Logger {
  abstract info(msg: string): void;
}

// Inferred type: (User, NotFound | Timeout, Db | Logger).
// No wrapper. No fiber. Nothing to .run(). It's just a function.
async function getUser(id: string): !User uses db: Db, log: Logger {
  const rows = try await db.query("select * from users where id = ?", [id]);
  if (rows.length === 0) throw NotFound({ id });
  log.info(`hit user:${id}`);
  return User.from(rows[0]);
}

const App = Layer.merge(
  Layer.succeed(Db, new PgDb(settings.databaseUrl)),
  Layer.succeed(Logger, new ConsoleLogger())
);

await Layer.provide(App, async () => {
  const user = await getUser("42") catch |e| switch (e) {
    NotFound => User.guest(),
    Timeout  => throw e,             // the switch must be exhaustive
  };
  render(user);
});
```

Remove the `Db` provider and this is a **compile error**, not a 2 a.m. crash. Forget the `NotFound` arm and that's a compile error too.

---

## Why

[Effect.ts](https://effect.website) is the most important diagnosis of TypeScript ever produced. It identified, precisely, where the language comes up short for serious applications:

- errors are untyped — `catch (e: unknown)` is the whole story,
- dependencies are invisible — nothing in a signature says "this needs a database",
- runtime validation is a bolt-on library, not a language capability,
- the platform (`node:fs`, `fetch`, timers) is hardcoded everywhere, so code isn't portable or testable.

Effect fixes all of this — as a library. The price is `Effect<A, E, R>` wrapping every value, a fiber runtime interpreting your program, `pipe`/generator ceremony around every function, and a parallel universe of combinators to learn.

**VibeLang's bet: everything Effect.ts proves TypeScript needs, built into the compiler, with Zig's soul.** We have a compiler instead of a library, so `A`, `E`, and `R` become extra rows on *normal function types* instead of a wrapper around values. Ordinary execution stays eager. Syntax stays TypeScript. Inference does the bookkeeping — like Zig's inferred error sets — and the rows erase at emit time. Durable execution is an explicit opt-in.

Legacy TypeScript functions keep their TypeScript behavior: they return `T`, may fail with `unknown`, and using their runtime values adds the built-in `TypeScript` requirement. That's why the superset is *true* on the TypeScript target while native compatibility remains statically visible.

---

## Feature tour

### Typed errors, inferred like Zig

`error` declarations compile to `_tag`-discriminated `Error` subclasses carrying a runtime failure brand. Error sets are **inferred** from function bodies; you write `!T` and the compiler computes the set. Exported functions declare their set explicitly, because a public API is a contract:

```typescript
error NotFound  { id: string }
error ParseFail { line: number }

// Internal: error set inferred from the body — this is (Config, NotFound | ParseFail, ∅).
function loadConfig(path: string): !Config {
  const raw = try readFile(path);        // `try` propagates the callee's failures
  return try Config.parse(raw);
}

// Exported: the set is declared, and the compiler checks the body against it.
export function getConfig(path: string): Config throws NotFound | ParseFail {
  return try loadConfig(path);
}
```

Handling is an **expression**. `catch` catches typed failures only — defects (bugs, panics) keep unwinding, exactly the failure/defect split Effect made famous:

```typescript
const port = parsePort(env.PORT) catch 3000;             // fallback value

const cfg = loadConfig("app.json") catch |e| switch (e) {  // exhaustive over the set
  NotFound  => Config.default(),
  ParseFail => throw e,
};
```

### One error channel across sync and async

`Promise` carries the error row: `Promise<T, E>`. `await` re-raises typed failures, so `try await` reads exactly like `try`:

```typescript
async function fetchUser(id: string): !User {     // (User, NotFound | Timeout, ∅), inferred
  const res = try await http.get(`/users/${id}`); // http.get: Promise<Response, Timeout>
  if (res.status === 404) throw NotFound({ id });
  return try res.json(User);
}
```

No colored error handling. No `.catch()` vs `try/catch` split-brain.

### Dependency injection: capabilities, not containers

A capability uses a class as its nominal identity. Functions receive named
context parameters with `uses`; layers supply their implementations:

```typescript
abstract class Mailer {
  abstract send(to: string, body: string): !void;
}

function notify(user: User): !void uses mailer: Mailer, clock: Clock {
  try mailer.send(user.email, `It is ${clock.now()}. Wake up.`);
}
```

Requirements propagate up call chains **by inference, exactly like error sets** — call `notify` and your function silently requires `Mailer | Clock` too, until a layer provides them. Provider composition is imported from `vibelang:provider`; a missing dependency is a **compile error**:

```typescript
import { Layer } from "vibelang:provider";

const Production = Layer.merge(
  Layer.succeed(Mailer, new SesMailer(creds)),
  Layer.succeed(Clock, SystemClock)
);
Layer.provide(Production, () => try notify(user));

// Tests provide fakes. No mocking framework, no module hijacking.
const Test = Layer.merge(
  Layer.succeed(Mailer, RecordingMailer.new()),
  Layer.succeed(Clock, TestClock)
);
Layer.provide(Test, () => try notify(testUser));
```

The backend may lower this to a scoped environment, compiler-threaded hidden
parameters, or direct native parameters without changing the source model.

### Expression-oriented control flow

`if`, `switch`, `while`, `for`, and blocks are expressions. Labeled blocks yield values with `break :label value`; loops take an `else` for the no-break path, like Zig. `defer` and `errdefer` handle cleanup:

```typescript
const tier = if (score > 90) "gold" else if (score > 50) "silver" else "bronze";

const firstEven = blk: for (const n of numbers) {
  if (n % 2 === 0) break :blk n;
} else -1;                                  // runs when the loop finishes without break

function writeReport(path: string): !void uses fs: FileSystem {
  const f = try fs.open(path, "w");
  defer f.close();                          // runs on every exit path
  errdefer fs.remove(path);                 // runs only when exiting with a failure
  try f.write(render());
}
```

### Comptime: run real code, get real types

Hermetic, deterministic compile-time execution — and it can **generate types**. Derive a `Routes` type from an embedded JSON schema by actually running the derivation at build time:

```typescript
const schema = comptime JSON.parse(embed("./routes.json"));
type Routes = comptime deriveRoutes(schema);   // a real type, checked everywhere it's used

const transport = comptime.target === "browser" ? fetchTransport : socketTransport;
// comptime.target ∈ node | bun | deno | browser | edge — dead branches are never emitted
```

### Typed assets and comptime loaders

JSON, Markdown, and MDX import as checked modules without declaration-file
ceremony. JSON has a concise const form that preserves deeply readonly literal
types while existing TypeScript JSON imports retain their normal behavior:

```typescript
import config from "./config.json" as const; // illustrative syntax
import readme from "./README.md";
import Prompt from "./coding-agent.mdx";

config.features.agents; // checked from the JSON itself
```

Applications can define comptime loaders for any other file format. The input,
loader implementation, target, options, and declared dependencies become a
content-addressed incremental build node, and the loader's result is an
ordinary typed module.

### Durable and distributed execution

An **Action** has a closed typed signature and a replaceable runtime
implementation. A **Flow** is a comptime program that turns Action calls into a
typed execution-plan template:

```typescript
abstract class Compile extends Action<
  (input: CompileInput) => CompileOutput throws CompileError
> {}

abstract class Package extends Action<
  (input: PackageInput) => Artifact throws PackageError
> {}

const Build = comptime Flow((input: BuildInput) => {
  const compiled = Compile.run({ source: input.source });
  return Package.run({ code: compiled.code });
});
```

At comptime, `Compile.run` emits a node and `compiled.code` creates a typed
dependency edge; no compiler runs. At runtime, provider layers supply the real
implementations. A deployment build can emit a coordinator plus separate,
tree-shaken TypeScript, native, or Wasm artifacts for different worker pools,
sandboxes, and machines. Schemas, RPC bindings, routing, retries, persistence,
and dependency checks are compiler-derived from the Action's ordinary function
signature.

Every resolved Action exit is adopted into the execution's journal before it
is exposed downstream, including memo/content hits. Across executions, an
Action may select nondeterministic memoization—where the first atomically
committed success for a key and generation becomes canonical—or deterministic
content caching. The distinction lets an LLM response be durably reused without
falsely claiming that rerunning the model must reproduce it.

See the [durable execution design](docs/DURABLE_EXECUTION.md).

### Code-writing agents as a library

The agent library uses MDX for prompts and makes custom agents small
compositions. Its standard agent writes ordinary TypeScript on every turn,
compiles it, and runs it with only the functions the caller passed:

```typescript
const agent = Agent.make({
  model,
  prompt: Prompt,
  functions: {
    readFile: ReadFile,
    editFile: EditFile,
    build: Build,
    github: GitHubCall,
  },
});
```

Those functions may be callbacks, Actions, compiled Flows, or typed tool/MCP
adapters. Generated code is otherwise confined by the library's sandbox, so
the agent requires no language-level sandbox feature or separate effect model.
Model calls, code compilation, and turns can opt into Actions and Flows for
caching and recovery, but the agent abstraction remains an ordinary library.

See the [coding agent library design](docs/AGENT_LIBRARY.md).

### Runtime validation derived at comptime

Ordinary types are comptime values, so the compiler can derive validators and
codecs without a second kind of `runtime type`. Validation failures are
ordinary typed failures in `E`:

```typescript
type SignupRequest = {
  email: string;
  age: number;
};

const SignupRequestSchema = comptime Schema.derive<SignupRequest>();

function handleSignup(body: unknown): !User {
  const req = try SignupRequestSchema.parse(body);
  return createUser(req);
}
```

### Platform as a universal dependency

The stdlib never hardcodes `node:fs`. Platform services — `FileSystem`, `HttpClient`, `Clock`, and the rest — are capabilities like any other. `comptime.target` selects compatible implementations at build time (implementations for other platforms are never emitted), and tests supply fakes through layers:

```typescript
import { FileSystem } from "std/platform";
import { Layer } from "vibelang:provider";

function loadConfig(): !Config uses fs: FileSystem {
  return try Config.parse(try fs.readText("app.json"));
}

const Test = Layer.succeed(FileSystem, FakeFs.with({
  "app.json": '{"port": 3000}'
}));
Layer.provide(Test, () => assert((try loadConfig()).port === 3000));
```

### A real standard library

Batteries included, Go-style: one toolchain binary, and a stdlib replicating the breadth of Effect's — `Schema`, `Data`, `Match`, `Config`, `Duration`, and on. Compute-heavy cores are WASM (likely written in Zig) with thin TypeScript shims, so the stdlib is fast *and* portable across every target.

### Polyglot imports

Bun taught us foreign things should feel native. Import Zig or Rust directly; the compiler drives the Zig/Cargo toolchain to WASM, derives typed bindings, and caches the result:

```typescript
import { hash }     from "./simd.zig";
import { tokenize } from "./parser.rs";

const digest = hash(bytes);        // it's just a function call
```

### Concurrency without fibers

No fiber runtime — ever. Instead: typed workers via TC39 module expressions, shared structs over `SharedArrayBuffer`, and bounded structured concurrency with governors and `using`/`defer` task scopes. `await.all` joins in parallel and unions the error rows. Cancellation is a capability with a typed `Cancelled` failure:

```typescript
const worker = spawn module {
  export function crunch(data: Float64Array): !Stats { /* ... */ }
};

using scope = TaskScope.bounded(8);            // governor caps concurrency; scope closes on exit
const [stats, meta] = try await.all(
  scope.run(() => worker.crunch(samples)),     // Promise<Stats, CrunchError>
  scope.run(() => fetchMeta(id)),              // Promise<Meta, Timeout>
);                                             // failure row: CrunchError | Timeout | Cancelled
```

---

## Design principles

1. **True superset.** Rename `.ts` to `.vibe` and it must behave identically on the TypeScript target. Runtime use of legacy code carries `unknown` failures and the inferred `TypeScript` requirement; migration is incremental.
2. **Typed-channel erasure.** `E` and `R` annotations erase like TypeScript types. Provider environments and explicit durable Flows have runtime representations; ordinary function results do not become wrapper values.
3. **No universal fiber runtime.** Ordinary functions are eager calls with ordinary stacks. Durable Flow execution is explicit and uses the durable scheduler; it does not reinterpret every VibeLang function.
4. **Backend-appropriate compilation.** Ordinary TypeScript-target constructs lower locally and predictably. Native compilation, comptime Flow planning, and deployment bundle partitioning may use checked whole-program information.
5. **Platform as dependency.** The stdlib takes the platform as a capability; comptime picks defaults per target; tests provide fakes. Portability and testability are the same feature.
6. **Inference inside, declaration at boundaries.** Error sets and requirements are inferred through bodies and call chains (Zig-style); exported APIs state them explicitly.
7. **Library before language.** Domain abstractions such as agents and their confined code evaluator remain libraries when ordinary functions, comptime, and durable Actions already provide the required semantics.

---

## Architecture

VibeLang tracks the Go compiler under
[`microsoft/TypeScript`](https://github.com/microsoft/TypeScript/tree/main/tsc)
with a minimal set of narrow extension seams. The TypeScript backend reuses the
upstream parser, checker, language service, and emitter. VibeLang adds shared
checked IR where comptime planning or a non-TypeScript backend needs more than
local syntax lowering.

```text
.ts / .vibe / JSON / MDX / Zig / Rust
                 │
                 ▼
 TypeScript frontend + VibeLang extension passes
                 │
                 ▼
 content-addressed incremental build graph
      ┌──────────┼──────────────┐
      ▼          ▼              ▼
 TypeScript/JS  LLVM/Wasm   Plan IR + worker artifacts
```

Parsing, checking, comptime loaders, generated code, custom linting, foreign
compilation, Flow planning, and deployment partitioning become explicit graph
work. The goal is one Go-like toolchain with Bazel-like incrementality, while
ordinary TypeScript-target emit remains predictable.

---

## Status

**Early design phase.** The specification is under active development and nothing is implemented yet beyond prototypes. Every code sample in this README is design-spec: it shows committed direction, not shipped behavior, and details of syntax may still change. Do not build anything on VibeLang today — but do open issues about the design; this is exactly the moment feedback is cheapest.

Accepted decisions and explicitly unresolved questions are tracked in
[`docs/DECISIONS.md`](docs/DECISIONS.md).
The current durable and distributed execution design is in
[`docs/DURABLE_EXECUTION.md`](docs/DURABLE_EXECUTION.md).
Typed asset imports and comptime loaders are specified in
[`docs/ASSET_LOADERS.md`](docs/ASSET_LOADERS.md). The library-level code-writing
agent is specified in [`docs/AGENT_LIBRARY.md`](docs/AGENT_LIBRARY.md).

## Roadmap

- **M0 — Compiler seam + parser.** Track the upstream Go compiler; add `.vibe`, narrow extension interfaces, identity lowering, source maps, and editor support.
- **M1 — Error channel.** `error` declarations, `!T` with Zig-style set inference, `try`, `catch`-expressions, `throws` on exports, exhaustive `switch` over error sets, `Promise<T, E>` and `await` re-raising, failure/defect split.
- **M2 — Requirements channel.** Named capability parameters, requirement inference up call chains, provider layers, missing-dependency compile errors, and the scoped environment lowering.
- **M3 — Comptime and loaders.** Hermetic deterministic interpretation, type generation, `comptime.target`, const JSON imports, built-in Markdown/MDX, user-defined typed loaders, and incremental asset nodes; polyglot imports ride this infrastructure.
- **M4 — Durable execution.** Typed Action capabilities, comptime Flow planning, Plan IR, derived codecs, journaling, retries, timers/signals, memo/content reuse, and a local executor.
- **M5 — Distributed and native execution.** LLVM/Wasm backends, deployment manifests, tree-shaken worker artifacts, placement, sandbox transports, and remote scheduling.
- **M6 — Agent library and interop.** MDX prompt components, the TypeScript-every-turn agent loop, passed-function sandboxes, and adapters for Effect.ts applications.

---

## Inspirations

- **[Effect.ts](https://effect.website)** — the diagnosis. Typed errors, the requirements channel, Schema, the failure/defect split, platform services: Effect proved TypeScript application code needs all of it. VibeLang exists to move that diagnosis from library to language — same fixes or better, because a compiler can infer, check exhaustively, and erase.
- **[TypeScript](https://www.typescriptlang.org)** — the host. Syntax and semantics stay as close to TS as possible; the superset discipline is non-negotiable. TS proved gradual adoption is how languages actually win.
- **[Zig](https://ziglang.org)** — the soul, and the best-language inspiration for every piece of new syntax: inferred error sets, `try`/`catch`-expressions, comptime, expression-oriented control flow, `defer`/`errdefer`, no hidden control flow.
- **[Go](https://go.dev)** — the toolchain ethos: one boring fast binary, batteries-included stdlib, syntax that optimizes for the reader. Also, literally, the implementation language of the upstream TypeScript compiler we extend.
- **[Bun](https://bun.sh)** — the conviction that foreign things should feel native: polyglot imports, zero-config toolchain, speed as a feature.
- **[Flows](https://github.com/smithersai/flows)** — the prior art for durable Actions, statically analyzable Flows, journaling, fencing, caching, recovery, and the code-writing agent that VibeLang moves into compiler and library primitives.

---

*VibeLang is not affiliated with Microsoft, the Effect maintainers, the Zig Software Foundation, Google, or Oven. It just owes them all.*
