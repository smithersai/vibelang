# VibeScript

**TypeScript with the missing parts compiled in: typed errors, capability-based DI, and comptime — no wrapper types, no runtime, no ceremony.**

VibeScript is a true superset of TypeScript (`.vs` / `.vsx`). Every `.ts` file is already a valid `.vs` file and behaves identically. On top of that, ordinary function types carry three channels — **what it returns, how it fails, and what it needs** — and the compiler infers, checks, and erases all of it.

```typescript
error NotFound { id: string }
error Timeout  { ms: number }

abstract class Db {
  abstract query(sql: string, params: unknown[]): Promise<Row[], Timeout>;
}
class Logger {                       // concrete body = its own default implementation
  info(msg: string) { console.log(msg); }
}

// Inferred type: (User, NotFound | Timeout, Db | Logger).
// No wrapper. No fiber. Nothing to .run(). It's just a function.
async function getUser(id: string): !User uses Db, Logger {
  const rows = try await Db.query("select * from users where id = ?", [id]);
  if (rows.length === 0) throw NotFound({ id });
  Logger.info(`hit user:${id}`);
  return User.from(rows[0]);
}

provide { Db: new PgDb(env.DATABASE_URL) } {   // Logger falls back to its default
  const user = await getUser("42") catch |e| switch (e) {
    NotFound => User.guest(),
    Timeout  => throw e,             // the switch must be exhaustive
  };
  render(user);
}
```

Delete the `provide` block and this is a **compile error**, not a 2 a.m. crash. Forget the `NotFound` arm and that's a compile error too.

---

## Why

[Effect.ts](https://effect.website) is the most important diagnosis of TypeScript ever produced. It identified, precisely, where the language comes up short for serious applications:

- errors are untyped — `catch (e: unknown)` is the whole story,
- dependencies are invisible — nothing in a signature says "this needs a database",
- runtime validation is a bolt-on library, not a language capability,
- the platform (`node:fs`, `fetch`, timers) is hardcoded everywhere, so code isn't portable or testable.

Effect fixes all of this — as a library. The price is `Effect<A, E, R>` wrapping every value, a fiber runtime interpreting your program, `pipe`/generator ceremony around every function, and a parallel universe of combinators to learn.

**VibeScript's bet: everything Effect.ts proves TypeScript needs, built into the compiler, with Zig's soul.** We have a compiler instead of a library, so `A`, `E`, and `R` become extra rows on *normal function types* instead of a wrapper around values. Execution stays eager. Syntax stays TypeScript. Inference does the bookkeeping — like Zig's inferred error sets — and everything erases at emit time.

Legacy TypeScript functions simply type as `(T, unknown, ∅)`: return `T`, might fail with anything, requires nothing. That's why the superset is *true* — all existing TypeScript code works unchanged, and gets more precise as you migrate.

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

A capability is a class. A **concrete** class body is its own default implementation; an **abstract** class must be provided. Functions declare `uses X` — and inside the body, the tag *is* the ambient instance:

```typescript
abstract class Mailer {
  abstract send(to: string, body: string): !void;
}

function notify(user: User): !void uses Mailer, Clock {
  try Mailer.send(user.email, `It is ${Clock.now()}. Wake up.`);
}
```

Requirements propagate up call chains **by inference, exactly like error sets** — call `notify` and your function silently requires `Mailer | Clock` too, until someone provides them. `provide` satisfies requirements at any scope. A missing dependency is a **compile error**:

```typescript
provide { Mailer: new SesMailer(creds) } {
  try notify(user);            // Clock is concrete → default used; Mailer satisfied here
}

// Tests provide fakes. No mocking framework, no module hijacking.
provide { Mailer: RecordingMailer.new() } {
  try notify(testUser);
}
```

The runtime cost is a tiny scoped ambient context. That's the entire mechanism.

### Expression-oriented control flow

`if`, `switch`, `while`, `for`, and blocks are expressions. Labeled blocks yield values with `break :label value`; loops take an `else` for the no-break path, like Zig. `defer` and `errdefer` handle cleanup:

```typescript
const tier = if (score > 90) "gold" else if (score > 50) "silver" else "bronze";

const firstEven = blk: for (const n of numbers) {
  if (n % 2 === 0) break :blk n;
} else -1;                                  // runs when the loop finishes without break

function writeReport(path: string): !void uses FileSystem {
  const f = try FileSystem.open(path, "w");
  defer f.close();                          // runs on every exit path
  errdefer FileSystem.remove(path);         // runs only when exiting with a failure
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

### Runtime-checked types as a language feature

Mark a type `runtime` and the compiler derives the validator — what Zod, Effect Schema, and friends do in userland, built in. Validation failures are ordinary typed failures in `E`:

```typescript
runtime type SignupRequest = {
  email: string;
  age: number;
};

function handleSignup(body: unknown): !User {
  const req = try SignupRequest.parse(body);   // fails with SignupRequest.ParseError
  return createUser(req);
}
```

### Platform as a universal dependency

The stdlib never hardcodes `node:fs`. Platform services — `FileSystem`, `HttpClient`, `Clock`, and the rest — are capabilities like any other. `comptime.target` selects the default implementations at build time (implementations for other platforms are never emitted), and tests override with `provide`:

```typescript
import { FileSystem } from "std/platform";

function loadConfig(): !Config uses FileSystem {
  return try Config.parse(try FileSystem.readText("app.json"));
}

provide { FileSystem: FakeFs.with({ "app.json": '{"port": 3000}' }) } {
  assert((try loadConfig()).port === 3000);
}
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

1. **True superset.** Rename `.ts` to `.vs` and it must behave identically. Legacy functions type as `(T, unknown, ∅)`; precision is opt-in, migration is incremental.
2. **Erasure principle.** `E` and `R` are typechecking, not runtime. Emit strips them the way TypeScript strips types. The only runtime footprint in the whole design: the failure brand on `error` classes and the tiny scoped ambient context behind `provide`.
3. **No fiber runtime.** Execution is eager. A function call is a function call. There is nothing to `.run()`, no interpreter between you and your code, and stack traces are your stack traces.
4. **Syntax-directed emit.** Every VibeScript construct lowers locally and predictably to plain TypeScript. No whole-program transforms, no magic — you can read the output.
5. **Platform as dependency.** The stdlib takes the platform as a capability; comptime picks defaults per target; tests provide fakes. Portability and testability are the same feature.
6. **Inference inside, declaration at boundaries.** Error sets and requirements are inferred through bodies and call chains (Zig-style); exported APIs state them explicitly.

---

## Architecture

VibeScript is a **minimal-diff fork of [typescript-go](https://github.com/microsoft/typescript-go)** — the Go-native TypeScript 7 compiler. The fork adds exactly one thing: a plugin host. VibeScript itself is implemented as Go plugins that lower `.vs`/`.vsx` to plain TypeScript, after which the stock TS pipeline continues untouched.

```
 .vs / .vsx
     │
     ▼
 ┌───────────────────────────────────────────────┐
 │ VibeScript plugins (Go)                       │
 │   • superset parser + expression lowering     │
 │   • error-channel inference        (E rows)   │
 │   • requirements inference         (R rows)   │
 │   • comptime interpreter (hermetic, det.)     │
 │   • polyglot import driver (zig/cargo → wasm) │
 └───────────────────────────────────────────────┘
     │  plain TypeScript AST
     ▼
 stock typescript-go pipeline ──► .js + .d.ts + sourcemaps
```

Staying a minimal diff means we inherit TypeScript's checker, language service, and release cadence instead of re-implementing them — and the emit stays syntax-directed, honoring the erasure principle. Ships as one binary: compiler, stdlib, test runner, polyglot toolchain driver.

---

## Status

**Early design phase.** The specification is under active development and nothing is implemented yet beyond prototypes. Every code sample in this README is design-spec: it shows committed direction, not shipped behavior, and details of syntax may still change. Do not build anything on VibeScript today — but do open issues about the design; this is exactly the moment feedback is cheapest.

## Roadmap

- **M0 — Parser + expressions.** Superset parser for `.vs`/`.vsx`; `if`/`switch`/loops/blocks as expressions, `break :label`, loop `else`, `defer`/`errdefer`; syntax-directed lowering to plain TS through the plugin host.
- **M1 — Error channel.** `error` declarations, `!T` with Zig-style set inference, `try`, `catch`-expressions, `throws` on exports, exhaustive `switch` over error sets, `Promise<T, E>` and `await` re-raising, failure/defect split.
- **M2 — Requirements channel.** Capability classes (concrete defaults, abstract must-provide), `uses`, `provide`, requirement inference up call chains, missing-dependency compile errors, the scoped ambient context.
- **M3 — Comptime.** Hermetic deterministic interpreter, type generation from comptime values, `comptime.target`, platform selection with dead-platform elimination; polyglot imports ride this infrastructure.
- **M4 — Effect.ts interop.** `Effect<A, E, R>` values map onto `(A, E, R)` function rows and back, so Effect codebases can adopt VibeScript incrementally — and VibeScript code can live inside an Effect app.

---

## Inspirations

- **[Effect.ts](https://effect.website)** — the diagnosis. Typed errors, the requirements channel, Schema, the failure/defect split, platform services: Effect proved TypeScript application code needs all of it. VibeScript exists to move that diagnosis from library to language — same fixes or better, because a compiler can infer, check exhaustively, and erase.
- **[TypeScript](https://www.typescriptlang.org)** — the host. Syntax and semantics stay as close to TS as possible; the superset discipline is non-negotiable. TS proved gradual adoption is how languages actually win.
- **[Zig](https://ziglang.org)** — the soul, and the best-language inspiration for every piece of new syntax: inferred error sets, `try`/`catch`-expressions, comptime, expression-oriented control flow, `defer`/`errdefer`, no hidden control flow.
- **[Go](https://go.dev)** — the toolchain ethos: one boring fast binary, batteries-included stdlib, syntax that optimizes for the reader. Also, literally, the compiler — we build on the Go-native typescript-go.
- **[Bun](https://bun.sh)** — the conviction that foreign things should feel native: polyglot imports, zero-config toolchain, speed as a feature.

---

*VibeScript is not affiliated with Microsoft, the Effect maintainers, the Zig Software Foundation, Google, or Oven. It just owes them all.*
