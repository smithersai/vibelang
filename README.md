# VibeLang

**TypeScript-shaped application code with explicit Results, capability-based DI, comptime, and statically planned durable execution.**

> **Implementation status:** this repository is a bounded architecture POC,
> not a production compiler. The core-model examples below describe the
> intended language; the [Status](#status) section distinguishes what the
> current package and CLI actually execute and what remains design work.

VibeLang uses the TypeScript toolchain and familiar JavaScript syntax while giving the compiler enough information to analyze what a function returns, how it can fail, and what capabilities it requires. Compiler intrinsics are imported functions, not new keywords.

```ts
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"

class NotFound extends Error {
  constructor(readonly id: string) {
    super(`User not found: ${id}`)
  }
}

class Timeout extends Error {}

abstract class Db extends Context {
  abstract query(
    sql: string,
    params: unknown[],
  ): Promise<Result<Row[], Timeout>>
}

abstract class Logger extends Context {
  abstract info(message: string): void
}

async function getUser(
  id: string,
): Promise<Result<User, NotFound | Timeout>> {
  const db = Db.context()
  const log = Logger.context()
  const rows = (await db.query(
    "select * from users where id = ?",
    [id],
  )).unwrap()

  if (rows.length === 0) throw new NotFound(id)
  log.info(`hit user:${id}`)
  return User.from(rows[0])
}

const App = Layer.merge(
  Layer.succeed(Db, new PgDb(settings.databaseUrl)),
  Layer.succeed(Logger, new ConsoleLogger()),
)

await Layer.provide(App, async () => {
  const user = (await getUser("42")).match({
    ok: user => user,
    error: error => error.match({
      NotFound: () => User.guest(),
      Timeout: error => { throw error },
    }),
  })
  render(user)
})
```

Removing the `Db` provider is a compile error. Omitting a known error from `error.match` is also a compile error.

## Core model

### Results and ordinary Errors

Expected failure lives in an ordinary return value:

```ts
function loadConfig(
  path: string,
): Result<Config, NotFound | ParseFailed> {
  const raw = readFile(path).unwrap()
  return Config.parse(raw).unwrap()
}
```

Inside a Result-returning function, plain `return value` becomes success and `throw new ErrorSubclass()` becomes error. Returning an existing compatible Result does not nest it. This keeps function bodies natural without adding `Result.ok`, `Result.err`, a failure annotation, prefix propagation syntax, or a postfix catch expression.

Use `Result.match`, `map`, `mapError`, `andThen`, `recover`, `unwrap`, and `unwrapOr` to compose. Ordinary Error subclasses gain `is`, `matches`, `match`, `matchPartial`, and `rootCause` helpers; the compiler derives stable nominal identity and checks exhaustive matching.

Fallible async functions return `Promise<Result<A, E>>`. `await` unwraps only the Promise and leaves the Result. Authored `.vibe` code cannot call Promise instance `.then()`, `.catch()`, or `.finally()`; imported TypeScript and JavaScript may use them internally.

### Built-in optionals

Absence uses the analogous built-in `Optional<T>`:

```ts
function findCached(id: string): Optional<User> {
  const user = cache.get(id)
  if (user === undefined) return undefined
  return user
}

const label = findCached(id).match({
  some: user => user.displayName,
  none: () => "Guest",
})
```

Plain values and nullish returns are lifted inside Optional-returning functions. `Optional` provides `match`, `map`, `andThen`, `filter`, `unwrap`, `unwrapOr`, and `toResult`; there are no public `some`/`none` constructors or optional-specific grammar.

### Capabilities and Layers

A capability is an abstract `Context` class whose class value is its nominal identity. Calling its inherited `context()` method adds the capability to the enclosing function's inferred requirement channel:

```ts
abstract class Mailer extends Context {
  abstract send(message: Message): Result<Receipt, MailError>
}

function notify(message: Message): Result<Receipt, MailError> {
  const mailer = Mailer.context()
  return mailer.send(message)
}

const Production = Layer.succeed(Mailer, new SesMailer(credentials))
Layer.provide(Production, () => notify(message))
```

Requirements propagate through calls until a Layer provides them. Tests supply fakes without module replacement or a container lookup API.

### Comptime

Compile-time evaluation is an imported intrinsic:

```ts
import { comptime } from "vibelang:comptime"

const schema = comptime(JSON.parse(embed("./routes.json")))
const Routes = comptime(deriveRoutes(schema))
const generated = comptime(function generated(input: Input) {
  return specialize(input)
})
```

Passing a value evaluates it hermetically during compilation. Passing a function marks and returns a comptime function without invoking it. `comptime.target` supports target-specific dead-code elimination.

### Import attributes for assets and foreign source

Every non-code or foreign-source import uses standard import attributes:

```ts
import config from "./config.json" with { type: "json" }
import literals from "./config.json" with { type: "json", mode: "const" }
import prompt from "./prompt.md" with { type: "text" }
import { hash } from "./simd.zig" with { type: "zig" }
import { tokenize } from "./parser.rs" with { type: "rust" }
```

Attribute values are strings. The attributes select built-in or user-defined comptime loaders and participate in the incremental cache key. Ordinary code imports need no attribute.

### Durable execution without executing a Flow to plan it

An Action has a closed Result signature and a replaceable runtime implementation. `durable(functionValue)` marks a function whose checked body the compiler lowers to Plan IR:

```ts
import { durable } from "vibelang:flows"

abstract class Compile extends Action<
  (input: CompileInput) => Result<CompileOutput, CompileError>
> {}

abstract class Package extends Action<
  (input: PackageInput) => Result<Artifact, PackageError>
> {}

const Build = durable(function Build(
  input: BuildInput,
): Result<Artifact, CompileError | PackageError> {
  const compiled = Compile.run({ source: input.source }).unwrap()
  return Package.run({ code: compiled.code })
})
```

Plan and preview modes read emitted Plan IR. They do not load or execute the Flow function and never call Actions with proxies to discover the graph. Runtime providers supply Action implementations; the executor journals adopted outcomes before exposing them downstream.

The bounded runtime POC can sign the exact Plan and deployment manifest with
Ed25519 and require a verifier-issued proof before constructing workers. That
authenticates pinned deployment metadata under an out-of-band trust root; it is
not yet worker-bundle, transport, sandbox, freshness, or revocation attestation.
Non-local signed sandboxes additionally require an exact host-issued transport
token so they cannot silently fall back to the in-process worker; the host still
has to ensure that factory enforces the sandbox it declares.

See [the durable design](https://github.com/smithersai/vibelang/blob/main/docs/DURABLE_EXECUTION.md).

### Runtime validation

Types are comptime values, so validators and codecs can be derived without a second declaration language:

```ts
import { comptime } from "vibelang:comptime"

type SignupRequest = { email: string; age: number }
const SignupRequestSchema = comptime(Schema.derive<SignupRequest>())

function handleSignup(
  body: unknown,
): Result<User, ValidationError | CreateUserError> {
  const request = SignupRequestSchema.parse(body).unwrap()
  return createUser(request)
}
```

### Concurrency

VibeLang uses ordinary async functions, typed workers, and structured library operations rather than a universal fiber runtime. Promise instance chaining is banned; concurrency is started with static/library combinators and consumed with `await`:

```ts
const results = await Promise.all([
  worker.crunch(samples),
  fetchMetadata(id),
])
const [stats, metadata] = Result.all(results).unwrap()
```

Cancellation remains an explicit capability and an expected Error where applicable.

## Design principles

1. **TypeScript-shaped source.** `.vibe` has a TypeScript-derived grammar and reuses the TypeScript frontend, but VibeLang semantics are opt-in by file boundary. Imported `.ts` and `.js` retain JavaScript behavior.
2. **Expected failures are values.** `Result<A, E>` and `Optional<T>` are ordinary runtime representations with compiler-assisted return, throw, and propagation lowering.
3. **No universal fiber runtime.** Ordinary functions remain eager calls. Durable Flow execution is explicit.
4. **Compiler intrinsics are imports.** `comptime(...)` and `durable(...)` look like normal calls and are recognized by resolved module identity.
5. **Plan from code, never by running it.** Durable bodies are checked and lowered to Plan IR at compile time.
6. **Platform as dependency.** Filesystem, network, clock, randomness, and similar host access arrive through capabilities.
7. **Inference inside, explicit contracts at boundaries.** Implementations may infer success/error/requirement information; exported APIs spell ordinary `Result` types.

## Architecture

VibeLang pins an exact revision of the [`smithersai/TypeScript`](https://github.com/smithersai/TypeScript) fork, which tracks the Go compiler under [`microsoft/TypeScript`](https://github.com/microsoft/TypeScript/tree/main/tsc). The executable Go bridge POC verifies an exact sparse checkout with a clean `tsc` tree and reuses the upstream content mapper, parser, checker, declaration emitter, runtime emitter, and source-map generator. Its transform is still identity-only; the production plan is to vendor a reviewed snapshot and land narrow fork-owned VibeLang IR/lowering hooks. The separate checked JavaScript frontend currently proves compile-time evaluation and durable lowering contracts.

```text
.ts / .vibe / assets / Zig / Rust
                 │
                 ▼
 TypeScript frontend + VibeLang semantic passes
                 │
                 ▼
 content-addressed incremental build graph
      ┌──────────┼──────────────┐
      ▼          ▼              ▼
 TypeScript/JS  LLVM/Wasm   Plan IR + worker artifacts
```

The fork workflow is documented in [docs/TYPESCRIPT_FORK.md](docs/TYPESCRIPT_FORK.md).

## Status

This repository now contains a production-oriented architecture POC, not a
production compiler. The checked `.vibe` project frontend implements the
highest-risk Result, Optional, panic/foreign-boundary, capability/Layer,
must-consume, cross-module row, declaration, and source-map paths. The package
also includes hardened runtime/wire values, hermetic comptime and asset-loader
sandboxes, Zig/Rust build spikes, enforced target classification, a static
nonexecuting durable source compiler plus canonical Plan/SQLite executor, and a
confined coding-agent turn loop. The root CLI can `check`, `compile`, `run`,
`test`, `inspect`, and statically emit a durable `plan` for the supported subset
while preserving raw TypeScript compiler compatibility.

The boundaries are intentional and fail closed where practical: generic row
polymorphism, general block/loop/labeled expression control flow, type-producing
comptime, stable Context-row declaration encoding, incremental/editor support,
formatter, native backend, and distributed execution are not implemented. The
POC does lower bounded nested `if`/`switch` joins and `defer`/`errdefer`, and it
statically evaluates bounded checker-resolved `comptime(...)` calls without
executing authored modules. Durable source lowering covers static values,
Actions, conditionals, one timer, a schema-checked external signal, and one
stable-key single-Action fan-out form; general loops, multi-step fan-out,
queues/children, and recurring/calendar timers remain open. Foreign provenance,
Layer inference, schemas, target classification, and sandbox isolation cover
the architecture-driving subset rather than every language or adversarial
case. Unfinished CLI commands return explicit errors.

Run `npm test`, `cd poc && bun test && bun run check`, and
`cd docs && npm run build` for the current release gates. Exact supported and
deferred surfaces are recorded in the repository's
[production-readiness audit](https://github.com/smithersai/vibelang/blob/main/poc/PRODUCTION_READINESS.md),
[decision ledger](https://github.com/smithersai/vibelang/blob/main/docs/DECISIONS.md), and
[docs/COMPATIBILITY_API.md](docs/COMPATIBILITY_API.md).

After `npm ci`, plain `npm pack` is supported from a checkout with no generated
`dist` trees: its non-recursive `prepack` lifecycle runs the root test/build.
`npm run verify:pack` proves that clean lifecycle first, then uses
`npm pack --ignore-scripts` for two byte-compared archives so verification
cannot recursively invoke itself.

## Roadmap

- **M0 — Compiler seam and parser.** Track upstream, recognize `.vibe`, and establish source maps and editor support.
- **M1 — Result and Optional semantics.** Return/throw lifting, inference, propagation, must-use checking, exhaustive Result/Error matching, async Result checking, and Promise chaining diagnostics.
- **M2 — Requirements.** Capability inference, Layers, missing-dependency diagnostics, and environment lowering.
- **M3 — Comptime and loaders.** Hermetic evaluation, type generation, import-attribute loaders, incremental asset nodes, and polyglot compilation.
- **M4 — Durable execution.** Actions, `durable(...)`, non-executing planning, Plan IR, codecs, journaling, recovery, timers/signals, and a local executor.
- **M5 — Distributed/native execution.** LLVM/Wasm backends, deployment manifests, tree-shaken worker artifacts, placement, and remote scheduling.
- **M6 — Agent library and interop.** MDX prompt components, confined code execution, durable agent turns, and adapters for existing TypeScript applications.

## Inspirations

- [Effect.ts](https://effect.website) for typed application errors, requirements, schemas, and platform services.
- [Better Result](https://better-result.dev) for an ergonomic Result-oriented API, with VibeLang-specific compiler lifting and ordinary Error subclasses.
- [TypeScript](https://www.typescriptlang.org) for the frontend, ecosystem, and gradual adoption model.
- [Zig](https://ziglang.org) for comptime, explicit control flow, and cleanup semantics.
- [Go](https://go.dev) for the toolchain ethos.
- [Bun](https://bun.sh) for treating foreign inputs as native build-graph nodes.
- [Flows](https://github.com/smithersai/flows) for durable Actions, planning, journaling, caching, and recovery.

VibeLang is not affiliated with those projects or their maintainers.
