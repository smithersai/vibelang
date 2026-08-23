# TypeScript compatibility API, POC subpaths, and CLI

> [!IMPORTANT]
> **Specification drift — read `docs/DECISIONS.md` first.**
> This document reports what the implementation does. As of 2026-08-23 the
> specification was substantially reduced and the code has not caught up, so
> parts of this page describe features the language no longer defines: the
> expression-form control-flow grammar, `defer`/`errdefer`, labeled value
> breaks, `Optional<T>`, `.unwrap()` (now postfix `!`), the TypeScript non-null
> assertion, and the near-native/Wasm targets with their `TypeScript`
> requirement, feature classification, and portability pin. Where this document
> and the specification disagree, the specification wins.

Status: the root package integrates the checked `.sm` TypeScript instrument,
an opt-in Go implementation inside the pinned TypeScript fork, runtime and
architecture APIs, and TypeScript compatibility surfaces. These entry points
are usable implementation evidence, not a stable or conforming production SDK.

## Package entry points

The package intentionally keeps TypeScript's compatibility API separate from
Smithers additions:

| Import | Current contract |
| --- | --- |
| `smthrs` | Complete TypeScript 5.9 JavaScript compiler, factory, transform, watch, language-service, `ts.server`, and protocol API |
| `smthrs/tsserverlibrary` | Compatibility alias for the historical tsserver library entry point |
| `smthrs/plugin` | Pass-through TypeScript language-service `PluginModuleFactory` |
| `smthrs/smithers` | Smithers-specific extension contracts and remaining placeholders |
| `smthrs/language` | No-write single-file and project `.sm` analysis/lowering, declaration emit, source-map composition, and emitted-project validation |
| `smthrs/runtime` | Checked POC runtime used by generated `.sm` modules |
| `smthrs/schema-runtime` | Runtime interpreter and `ValidationError` for compiler-derived `Schema.derive<T>()` descriptors |
| `smthrs/result` and `smthrs/optional` | Hardened Result/Optional values, compiler hooks, matching, and compatibility aliases |
| `smthrs/exceptions` | Checked panic constructors, catch adapters, and guards |
| `smthrs/context` and `smthrs/provider` | Async-scoped Context/Layer environment; provider also retains provisional Action/Flow compatibility types |
| `smthrs/build` | Programmatic hermetic assets, comptime evaluator, loader sandbox, and foreign-tool adapters |
| `smthrs/targets` | Conservative portability analysis and bounded canonical-IR/Wasm backend proof |
| `smthrs/platform` | Provisional platform capability library: time/configuration, host and test services, schedules, and platform Layers |
| `smthrs/data` | Provisional pure data library: Chunk, HashMap, HashSet, Data, Match, Equivalence, and Hash |
| `smthrs/concurrency` | Node-safe joins, governors, unordered helpers, cancellation, Stream, Queue, Semaphore, and Channel |
| `smthrs/concurrency/bun` | Complete Bun concurrency surface, adding the typed-worker host and bootstrap listener |
| `smthrs/agent` | Node-safe coding-agent compiler, sandbox, bindings, prompt/model helpers, Action tools, and fakes |
| `smthrs/agent/bun` | Complete Bun agent surface, adding SQLite journaling and durable Flow tools |
| `smthrs/durable/authoring` | Provisional explicit Plan-authoring API |
| `smthrs/durable/artifact` | Static Plan artifact validation and loading |
| `smthrs/durable` | Node-safe static durable source compiler, Plan artifact facade, and canonical Ed25519 deployment-envelope verifier |
| `smthrs/durable/source-compiler` | Direct static `durable(...)` source-lowering API |
| `smthrs/durable/bun` | Bun SQLite executor/store, start/resume handles, HMAC-gated signals, wakeups, authenticated coordinator factory, and local/Deno-isolated worker protocols |
| `smthrs/unstable/*` | Direct wrappers for TypeScript 7's published unstable sync, async, filesystem, protocol, and AST APIs |

The package root is an identity re-export instead of a handwritten facsimile.
This preserves all public functions, enums, factories, nested namespaces,
compiler hosts, language-service methods, server protocol types, watch/build
APIs, and patch-level additions from the wrapped TypeScript 5.9 package.

```ts
import ts = require("smthrs")

const source = ts.createSourceFile(
  "example.ts",
  "export const value: number = 1",
  ts.ScriptTarget.Latest,
)
```

TypeScript 7 has not replaced that ecosystem JavaScript API. Its package root
currently exposes its version plus APIs under `typescript/unstable/*`;
Smithers mirrors those subpaths separately so consumers can migrate
deliberately.

## Checked frontend API

The `smthrs/language` subpath performs no writes. The acceptance helper
checks both Smithers diagnostics and generated TypeScript diagnostics:

```ts
import { compileAndCheckSmithers } from "smthrs/language"

const checked = compileAndCheckSmithers(sourceText, {
  fileName: "/absolute/input.sm",
  outputFileName: "/absolute/input.generated.ts",
  sourceName: "input.sm",
})

if (!checked.ok) {
  console.error(checked.result.analysis.diagnostics)
  console.error(checked.emitDiagnostics)
}
```

Lower-level exports include `analyzeSource`, `compileSmithers`,
`checkEmittedTypeScript`, `analyzeProject`, `compileProject`,
`checkEmittedProject`, `emitProjectDeclarations`, and `composeSourceMaps`.
Project APIs consume an explicit in-memory source set and perform no writes.

## Language-service plugin

Configure the pass-through plugin with:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "smthrs/plugin" }]
  }
}
```

The plugin uses the `typescript` instance injected by tsserver and decorates
the supplied `LanguageService`, matching TypeScript's plugin ABI. It does not
add `.sm` grammar and remains pass-through. The separate `smithers lsp` command
provides the bounded compiler-backed `.sm` editor surface described below.

## Commands

The root `smithers` CLI checks and emits `.sm`. `check`, `compile`, and `run`
default to the TypeScript instrument and accept the explicit Go backend:

```sh
smithers check src/index.sm
smithers check src/index.sm --backend go
smithers compile src/index.sm --outDir build
smithers compile src/index.sm --backend go --outDir build-go
smithers compile src/index.sm --outDir build --declaration --sourceMap
smithers run src/index.sm
smithers run src/index.sm --backend go
smithers test test/example.sm --format json
smithers inspect src/index.sm --format json
smithers plan flows/build.sm --bindings actions.json --outFile build.plan.json
smithers format src/index.sm --check
smithers lsp
smithers doctor --format json
```

`.sm` project commands discover relative `.sm` dependencies plus the
reachable foreign runtime graph. The bounded foreign stager accepts relative
`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs` static imports
and re-exports, literal dynamic imports from ESM-shaped foreign modules, and
literal `require(...)` edges from `.cts`/`.cjs`. It rewrites every resolved
relative edge and stages foreign output under deterministic
`__smithers_foreign__/` paths without executing the graph during build.
Checker-resolved type-only dependencies participate in checking but produce no
runtime artifact.

Because ESM initialization runs before a generated call adapter can catch a
panic, each static `.sm`-to-foreign runtime edge must resolve to a source with
file-leading JSDoc containing both `@module` and `@throws {never}`. This trust
requirement follows the static initialization closure, not a subtree reachable
only through a literal dynamic import inside a trusted async foreign adapter.

`compile` supports `--outDir`, `--rootDir`, `--noEmit`, `--declaration`, and
`--sourceMap`. It emits `.mjs`, optional `.d.mts`, staged ESM/CJS foreign
modules, and composed authored-source maps. Unchanged positions map exactly;
transformed tokens use conservative AST/text provenance, compiler-only text is
explicitly unmapped, and multi-source composition retains authored content
under deterministic bounds. The complete validated output set is staged before
commit. Unsupported or ambiguous graph edges, unsafe portability pins, root or
identity violations, budget violations, and colliding outputs fail before
commit. TypeScript/JavaScript-only `compile` and `check` invocations delegate to
the native TypeScript compiler. `build` and `init` are also TypeScript-backend
commands.

`test` runs exported zero-argument `test*` functions in a timeout/output-bounded
Node child and keeps `--format json` machine-readable. `plan` statically lowers
the bounded durable source subset without evaluating author modules. `format`
drives the TypeScript language-service formatter for `.sm` and non-JSX
TypeScript/JavaScript sources and admits only whitespace edits; it writes in
place by default and supports
`--check`, `--stdout`, and `--indentSize 1..8` (default 2). `--check` and
`--stdout` are mutually exclusive. `lsp` runs JSON-RPC 2.0 over stdio with
full-document sync, diagnostics, failure/requirement-row hover, project-local
definition, and whole-document formatting. It is deliberately bounded to one
workspace folder and the relative-`.sm` closure of open documents, with no
completion, rename, references, file watching, or incremental text sync.

`smithersc` and the compatibility `tsc` bin forward every raw argument,
in its original order, to the installed native TypeScript 7 compiler. The
`smithers-tsserver` and compatibility `tsserver` bins run the JavaScript TypeScript 5.9
server:

```sh
smithersc --project tsconfig.json --noEmit
smithersc --build --verbose
smithers-tsserver
```

This separate path preserves exact `tsc` spellings, boolean-value forms,
repeated options, and exit codes that the structured `smithers` command parser may
otherwise interpret.

### Pinned Go compiler backend and command

The product path is explicit and never falls back:

```sh
smithers check src/main.sm --backend go
smithers compile src/main.sm --backend go --outDir build-go
smithers run src/main.sm --backend go
```

The CLI requires an exact-revision checkout whose complete digest-gated
`compiler/forkpatch` series is applied with no post-image divergence. It sends
one protocol-v3 in-memory request with internal lowering selected. The Go pass
runs inside the fork and uses its parser, checker, AST factory, printer, and
source-map machinery to implement Result/Optional lifting, `.unwrap()`
propagation, async `Promise<Result<...>>`, nominal error matching, all nine
surface-grammar forms, and bounded versions of `smithers:comptime` and
`smithers:flows`.

The repository-only `cmd/smithersc-go` command exposes the same fork bridge
directly. It is not an npm compatibility bin:

```sh
go build -o /tmp/smithersc-go ./cmd/smithersc-go
/tmp/smithersc-go \
  --fork-checkout /path/to/smithersai-TypeScript \
  --fork-cache /path/to/compiler-cache \
  --timeout 5m \
  src/main.sm
```

Flags precede root names. Compile attempts emit exactly one `CompileResult`
JSON value on stdout. For the built binary, exit zero means emitted
successfully, one means a compiler/infrastructure/timeout failure or skipped
emit, two is the explicit
dependency-free scaffold when no checkout is selected, and 64 is a usage error
with no JSON. (`go run` masks nonzero child codes as one.) The deadline is
propagated through bridge preparation and compiler subprocesses, but cannot
preempt an uninterruptible local filesystem read or a noncooperative injected
backend. The cache must not overlap the checkout. Besides positional disk roots,
`--request request.json` submits one full `CompileRequest` value. Internal
lowering performs the Go implementation described above. External lowering
remains available for a frontend that supplies generated TypeScript and an
authored source map per `.sm` file; the bridge validates and composes those maps
rather than guessing positions. The command is a source-checkout proof, not a
signed production compiler distribution. Infrastructure and
deadline failures carry `SMITHERS_GO_BACKEND`/`SMITHERS_GO_TIMEOUT` in JSON and repeat
detail on stderr. SIGINT/SIGTERM still use abrupt default process behavior and
do not promise a final JSON envelope.

The conformance corpus changes as obligations and backend fixes land. It is a
contract rather than a census; use the live
[`conformance/COVERAGE.md`](https://github.com/smithersai/smithers/blob/main/conformance/COVERAGE.md)
obligation-to-case matrix instead of copying a scoreboard here.

## Known gaps

- Concrete Error and Context rows propagate across the explicitly supplied
  `.sm` project graph. Generic row polymorphism, incremental checking, watch
  mode, a stable Context-row declaration encoding, and the candidate `.smx`
  extension remain unimplemented. The working `smithers lsp` is deliberately
  bounded and is not an incremental/watch compiler.
- Foreign provenance is checker-backed and deliberately conservative, but the
  complete JavaScript heap/data-flow problem is not claimed. Unsupported or
  unprovable boundary shapes fail closed. Static foreign module initialization
  occurs before a generated call-level panic adapter can run, so a runtime
  TS/JS import requires file-leading JSDoc containing both `@module` and
  `@throws {never}`. Type-only imports and compiler intrinsics are exempt. A
  trusted async foreign adapter may defer dynamic loading so rejection enters
  its ordinary checked panic boundary. The module marker is a provisional
  trust claim rather than runtime proof or a final declaration/tooling format.
- The mixed-project path is a staging prototype, not a bundler or complete Node
  package-mode implementation. It deliberately treats `.js`, `.jsx`, `.ts`,
  and `.tsx` as ESM; leaves bare/package/platform imports external; rejects
  nonliteral loads and unsupported ESM/CJS crossings; and uses provisional
  no-check declaration facades for JSX/CJS where inference is incomplete.
  Columns after rewritten foreign specifiers are conservative rather than
  claimed exact.
- Common ambient host bindings are rejected. Checker-resolved wall/monotonic
  clock and entropy operations on `Date`, `performance`, `Math`, and `crypto`
  also add `Clock`/`Random` requirements in both language and target analysis,
  while lexical shadows remain ordinary values. This is a bounded classifier,
  not a claim that every Web/Node host API has been enumerated.
- Layer inference recognizes a bounded set of concrete built-ins. Opaque or
  generic layers and cross-module provider graphs are outside the current
  checker. Base Layers intentionally have only a `Layer<Provides>` row and do
  not model acquisition or resource ownership.
- Control-effect lowering is statement-safe and deliberately conservative.
  Lexical-tail `defer`/`errdefer` is executable for a bounded direct-statement
  syntax, Result-error exit, provisional LIFO ordering, and one narrow async
  cleanup shape. Braced `if`/`switch` expressions now lower in proven general
  expression positions; labeled block values, labeled `for`/`while` values with
  `else`, and closed-literal-union switch exhaustiveness are also implemented.
  Order-unpreservable hosts, unstable callees, braceless general-placement
  branches, unsafe label/loop shapes, generators, repeated effectful loop
  headers, and unlabeled loop expressions still fail closed.
- The compiler-owned `smithers:comptime` and `smithers:flows` virtual modules
  are not npm runtime entry points. Checker-identity-based comptime and durable
  source lowerers exist, and root `check`, `compile`, `run`, and `test` compose
  comptime before Smithers lowering. The bounded interpreter now includes local
  mutation, `while`/`do-while`/`for`/`for-of`, unlabeled break/continue,
  interpreter-owned container mutation, a deterministic stdlib allowlist, and
  hard VCT1012 budgets. A top-level comptime const used as a type emits a
  value-derived literal alias (and erases the const when it is non-exported and
  type-only); VCT1013 rejects unsupported type production. It is still not
  general JavaScript or arbitrary computed/mapped/generic type evaluation.
  Static attributed source assets lower through compiler-issued pure-data
  modules in every root project command. Attributed named/namespace re-exports,
  literal dynamic asset imports, and loader-generated module graphs through
  depth four now pass through the Smithers emitter, semantic binding, and root
  relative runtime graph as well as the programmatic `smthrs/build` seam.
  Type-only and side-effect asset forms, bare star re-exports, nonliteral
  dynamic imports/attributes, general executable generated modules, and one
  unified incremental graph remain future work.
  The opt-in Go compiler independently recognizes and lowers both virtual
  modules. Its comptime subset does not yet receive tracked `embed` assets or
  provide schema/loader/cache parity, and its durable subset fails closed on
  fan-out, child Flows, general statement control flow, loops, broadcast, and
  queues.
- `smthrs/provider` has a working Context/Layer environment, but its
  async lifetime boundary currently requires Node's synchronous V8 Promise
  settlement hooks and a Promise created during the provider body. Existing
  Promises use `async () => await promise`; unsupported hosts fail closed.
  Action/Flow exports remain compatibility scaffolding. Use the durable
  subpaths only as explicit POC APIs.
- Durable Action input/success/Error codecs and static Flow input/projected-
  success/reachable-error codecs are now checker-derived for a bounded
  structural type set and validated at coordinator/worker/replay/cache
  boundaries. They are not yet the shared compiler descriptor used by ordinary
  validators, declarations, loaders, RPC, and provider contracts; the exact
  Error/wire encoding remains provisional. A separate bounded implementation
  contract derives `E`/`R` from a closed `.sm` source project and requires
  exact provider grants plus equality between recoverable `E` and the Action's
  nominal failure schema, but does not prove declared-error reachability or
  attest lexical closures/remote bundles. Legacy callback-authored
  Plan artifacts retain weaker generic JSON schemas for compatibility.
- Native and general Wasm code generation are not implemented. The target
  subpath provides conservative classification plus a bounded checker-authored
  single-module portable IR with a TypeScript-host evaluator and real
  import-free `wat2wasm` output. Plain, Optional, Result, boolean, and finite
  `f64` exits have cross-runtime wire/hash tests, as do intra-module calls
  (recursion rejected, depth capped), locals and assignment, `if`/`while`/`for`
  under a fixed loop-fuel budget whose exhaustion is a canonical defect in both
  runtimes, scalar error payloads, and interned printable-ASCII string literals
  with pooled equality and length. Imports, Context, objects, closures,
  generics, async, GC, host ABI design, whole-project partitioning, string
  parameters, string concatenation, and non-ASCII strings remain outside that
  proof; the external tool is bounded and hashed but still trusted.
- The TypeScript language-service plugin remains pass-through. `smithers lsp` is a
  bounded full-document server rather than a complete editor implementation:
  it has no completion, rename, references, workspace-folder updates, file
  watching, or incremental text synchronization, and definition lookup uses
  declared names inside the loaded relative-`.sm` closure rather than checker
  symbol identity.
- TypeScript 7 marks its new API subpaths unstable; wrappers may change with
  upstream. `typescript-fork.json` pins the exact fork revision. The
  `NewPinnedFork` integration proof exercises the upstream Go content mapper,
  Program/checker, mapped declaration emit, runtime emit, multi-file projects
  with `.sm` import rewriting, and composed authored source maps for both
  internal and externally lowered input. Internal mode now runs the Go-owned
  Smithers lowering in the fork; `cmd/smithersc-go --fork-checkout` and root
  `--backend go` exercise it. The patch series is reviewable and digest-gated,
  but it is not vendored into the distribution or signed; a package host with
  complete `tsconfig`/module resolution and a signed distributed compiler
  binary are still absent. `.sm` remains a content-mapper extension rather than
  a built-in source kind.
