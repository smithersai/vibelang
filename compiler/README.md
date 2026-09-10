# Go compiler bridge POC — historical design notes

> [!IMPORTANT]
> **Specification drift — read `docs/DECISIONS.md` first.**
> This page records the early compiler POC, not the current implementation.
> The [Go-only migration record](GO-MIGRATION.md) and
> [implementation plan](IMPLEMENTATION-PLAN.md) describe the current native
> compiler and delivery status. The old temporary-hoisting/refusal discussion
> below predates delimited propagation; it is not a current restriction on `!`.
> As of 2026-08-23 the specification was substantially reduced, so parts of this
> page also describe features the language no longer defines: the
> expression-form control-flow grammar, `defer`/`errdefer`, labeled value
> breaks, `Optional<T>`, `.unwrap()` (now postfix `!`), the TypeScript non-null
> assertion, and the near-native/Wasm targets with their `TypeScript`
> requirement, feature classification, and portability pin. Where this document
> and the specification disagree, the specification wins.

The executable POC sends `.vibe` source through the real parser, binder,
checker, content-mapper span machinery, and emitter in the exact pinned Go
TypeScript compiler. It does not vendor or copy TypeScript internals into this
module. Multi-file root sets with relative `.vibe` imports are first-class,
an external frontend can supply pre-lowered TypeScript per `.vibe` file
whose source maps the bridge composes back to the authored text, and the
bridge itself can lower core VibeLang semantics in Go against the fork's own
checker, node factory, and printer.

## Running the executable proof

An exact checkout can be verified without network access:

```sh
node scripts/prepare-typescript-fork.mjs --source /path/to/smithersai-TypeScript
VIBELANG_TYPESCRIPT_FORK=/path/to/smithersai-TypeScript \
  go test ./compiler ./cmd/vibec-go -count=1
```

If no checkout is available, an explicit sparse fetch caches only the fork's
`tsc` tree at the manifest revision:

```sh
node scripts/prepare-typescript-fork.mjs --fetch --cache /path/to/cache
```

Without `--fetch`, that command never attempts the network. Building the Go
bridge can still require Go 1.26 or module downloads if the local Go caches do
not already contain them; those failures return `ErrForkUnavailable` rather
than selecting another compiler.

Library callers opt in explicitly:

```go
backend, err := compiler.NewPinnedFork(ctx, compiler.ForkConfig{
    CheckoutDirectory: checkout,
    CacheDirectory: cache,
})
result, err := backend.Compile(ctx, compiler.CompileRequest{
    RootNames: []string{"main.vibe", "util.vibe"},
    Files: []compiler.SourceFile{
        {Path: "main.vibe", Kind: compiler.FileKindVibeLang,
            Text: "import { seven } from \"./util.vibe\"\nexport const answer: number = seven;\n"},
        {Path: "util.vibe", Kind: compiler.FileKindVibeLang,
            Text: "export const seven: number = 7;\n"},
    },
})
```

`NewPinnedFork` verifies the checkout's exact Git revision, requires a clean
`tsc` tree, checks the nested Go module identity, and handshakes with the built
binary. It uses `go build -overlay` to replace the upstream `cmd/tsc` entry
point at build time, so it neither patches the checkout nor imports Go
`internal` packages across their visibility boundary. The generated binary is
cached by revision and bridge-source digest.

The same backend is directly invocable through the real Go compiler command:

```sh
go build -o /tmp/vibec-go ./cmd/vibec-go
/tmp/vibec-go \
  --fork-checkout /path/to/smithersai-TypeScript \
  --fork-cache /path/to/compiler-cache \
  --timeout 5m \
  main.vibe util.vibe
```

Compile attempts write one `CompileResult` JSON object to stdout, with empty
diagnostic/artifact collections encoded as arrays. A successful emit exits
zero; a compiler, infrastructure, or timeout error or skipped emit exits one;
the dependency-free scaffold without `--fork-checkout` retains exit two; flag
or missing-root usage errors exit 64 without JSON. `--help`, `--version`, and
`--api-version` are metadata output. Fork-backend selection is explicit through
`--fork-checkout`, and there is no JavaScript fallback. Cache and Go-tool flags
are optional; without them the API uses the user cache and resolves `go` (and
always `git`) through `PATH`. A caller-supplied cache is rejected if it overlaps
the checkout. Flags precede root names because this POC uses Go's standard flag
parser. The deadline is carried through preparation and compiler subprocesses;
in-process backends must cooperate with context cancellation, and it cannot
preempt an uninterruptible local filesystem read.
Operational failures also receive a `VIBELANG_GO_BACKEND` or `VIBELANG_GO_TIMEOUT`
diagnostic in the JSON result and are repeated on stderr. SIGINT/SIGTERM retain
the platform's default abrupt command behavior in this POC, so they do not
promise a final JSON envelope.

Instead of positional disk roots, `--request request.json` submits one
`CompileRequest` JSON value with in-memory files, options, and the lowering
mode — the vehicle an external frontend uses to drive the pinned backend.
Unknown fields, trailing JSON, or an unreadable file are usage errors (exit
64) before any backend is prepared.

## Multi-file projects

The native embedding API also exposes read-only language analysis:

```ts
import { getNativeCompiler } from "vibelang/compiler";

const analysis = getNativeCompiler().analyzeLanguage({
  files: [{ path: "main.vibe", kind: "vibelang", text: "export function answer() { return 42 }" }],
});
```

This API runs native checked lowering with mandatory language options. It
publishes no artifacts and, by default, reads no external files. API v30 accepts
an optional absolute `resolutionRoot`: the native resolver can discover source,
declaration, package-metadata and asset dependencies beneath that directory.
Explicit request bytes win over disk. Discovered bytes are frozen before
checking; no tsconfig or module code is executed. Symbolic-link dependencies,
invalid UTF-8 and oversized closures are refused (1,024 sources, 2 MiB per source,
16 MiB combined). Foreign JavaScript contributes native/JSDoc types without
imposing VibeLang's implementation checking on that foreign body.

API v31 adds `explicitVibeLangSources`: foreign dependencies may still resolve,
but omitted authored `.vibe` files cannot be read from disk. Optional
`runtimeModules` address supplied TypeScript files through checker-only aliases.
Aliases are native forwarding modules, preserving exported symbol identity and
original source text. Their generated diagnostics keep a separate alias identity.
A `compilerData` claim requires native validation of an acyclic inert-data graph:
only supplied claimed-data dependencies, inferred types, const assertions, no
ambient references, and at most 128 dependency levels. A transport flag alone
cannot make executable code compiler-owned. These aliases produce no runtime
deployment; a separate emitter must map the supplied runtime outputs.

`checked` means the complete closure passed. Each requested authored file includes Error declarations and named functions,
UTF-16 source/body spans, failure/capability rows, and module-scope ownership.
Rows on a refused program are provisional editor information, not authenticated
implementation contracts. A parse/global refusal can leave `analyzed: false`
and empty declaration lists. A language refusal on a syntactically complete tree
can retain additional findings and provisional rows, but can never emit code or
authenticate an implementation. The Go equivalent is `LanguageAnalyzer.AnalyzeLanguage`.

The higher-level `analyzeSource`, `analyzeProject`, `parseErrors` and
`parseFunctions` operations now use this native query. Their `rootDir` bounds import resolution; for single-source operations its default
is cwd for relative source names and the containing directory for absolute names.
Supply a project root to resolve parent-directory imports. External findings are
anchored at the requested source and retain the dependency name in their message.
Project analysis keeps the supplied authored set explicit, preserves exact caller
file labels and validates generated runtime modules natively. Prefer an explicit
project root for portable multi-file nominal names; an absolute-only project
outside cwd otherwise uses its smallest common directory. Dependency findings
are attached to the first authored input with the native dependency name in the
message, without rereading disk to invent positions. The high-level compiler,
source tooling, comptime/schema/loaders and durable frontends now use the same
pinned Go compiler. There is no TypeScript 5.9 compiler-library fallback; see
[the completed Go-only migration](GO-MIGRATION.md). TypeScript runtime code and
thin process/data bindings are distinct from a JavaScript source compiler.

Requests may carry several `.vibe` and `.ts` roots with relative POSIX paths
(subdirectories included). Relative imports between them resolve in both the
checked and the emit Programs — `.vibe` files through the content-mapper
extension registration, and in the emit pass through virtual `<name>.vibe.ts`
file naming. Ordinary compile requests still require every project file to be
listed; optional disk discovery belongs to the analysis query above, not an
ambient fallback in compilation. Per-file artifacts are deterministic:

- `x.vibe` → `x.js`, `x.js.map`, and with `declaration` on `x.d.vibe.ts`
- `x.ts` → `x.js`, `x.js.map`, and with `declaration` on `x.d.ts`

Diagnostics attribute to the file that produced them with authored spans.
Artifact-name collisions (for example `x.vibe` next to `x.ts`) are rejected
fail-closed rather than silently overwritten.

## Externally lowered input

`CompileRequest.Lowering: "external"` (API `LoweringExternal`) switches to the
compatibility mode where an explicit external frontend has
already lowered every `.vibe` file. Each `FileKindVibeLang` source then carries
both its authored text and a `LoweredSource`: the generated TypeScript plus a
version-3 source map from the authored file to that TypeScript. The bridge
checks the lowered TypeScript through one fork Program, emits declarations and
runtime JavaScript from it, and composes the fork's emitted maps with the
supplied authored maps so every artifact maps to the authored `.vibe`.

The supplied map is validated exactly (see `LoweredSource` in `api.go`):
strict field set, version 3, sources naming exactly the authored file,
`sourcesContent` (when present) equal to the authored text, decodable VLQ
mappings, in-range indices, and in-bounds positions — on both sides of the
process boundary. Position semantics are delta-adjusted runs: a lowered
position maps through the greatest mapping at or before it on the same line,
advancing the authored column one-for-one within the run. Lowered spans with
no authored origin stay unmapped in composed maps, and diagnostics inside them
attach to the authored file without a span. Composed maps carry no `names`
entries.

## Go-native lowering

`CompileRequest.Lowering: "internal"` (API `LoweringInternal`) is the mode
where the bridge lowers VibeLang semantics itself, in Go, inside the pinned
fork. `Lowered` fields must be absent: the bridge produces both the lowered
TypeScript and its authored source map.

The pass is compiled into the fork's `cmd/tsc` package through the same build
overlay as the bridge entry point (`compiler/forkbridge/lowering.go.txt`), so
it drives the fork's own machinery rather than reimplementing any of it:

| Step | Fork API |
| --- | --- |
| parse + bind authored `.vibe` | `compiler.NewProgram` with the `contentmapper.Mapper` extension |
| resolve `Result`/Context identity | `compiler.Program.GetTypeChecker`, `checker.Checker.GetSymbolAtLocation`, `GetMergedSymbol` |
| decide from types | `checker.Checker.GetTypeAtLocation`, `GetTypeFromTypeNode`, `checker.Type.Alias`, `checker.Type.Symbol`, `checker.Type.Flags` |
| look through `Promise` | `checker.Checker.GetPromisedTypeOfPromise` |
| resolve a case label binding | `checker.Checker.ResolveName`, `GetAliasedSymbol` |
| build replacement nodes | `printer.NewEmitContext` → `printer.NodeFactory` (`ast.NodeFactory`) |
| walk and rewrite | `printer.EmitContext.NewNodeVisitor` → `ast.NodeVisitor` |
| keep authored positions | `printer.EmitContext.AssignCommentAndSourceMapRanges` / `AssignSourceMapRange`, `scanner.SkipTrivia` |
| emit lowered TypeScript | `printer.NewPrinter` → `Printer.Write` with a `sourcemap.Generator` |

No step inspects source text. The lowered TypeScript is then checked and
emitted through exactly the pipeline externally lowered input uses, so
diagnostics and every emitted source map land on authored `.vibe` positions.

### The compiler-owned prelude

The bridge inserts compiler-owned support modules. `__vibelang_prelude.ts`
implements the Result variants, panic/error intrinsics, nominal Context lookup,
and opaque Layers. Its ambient declarations publish `Result<A, E>` and the
compiler-recognized operations; authored code cannot import the private prelude
or construct its Result variants. Absence uses ordinary `T | undefined`, not
the withdrawn Optional runtime.

Recognition is by resolved symbol identity, never by name spelling. The pass
locates the prelude's own declaration nodes once, resolves their symbols
through the checker, and at every use site compares the *resolved* symbol
(merged-symbol pointer equality, falling back to declaration-node identity)
against them. A file that declares its own `Result` therefore resolves to a
different symbol and is left untouched.

Each lowered file imports exactly the prelude exports it used, under
compiler-owned local aliases, resolved relative to that file's directory.

Result transformations and inspections execute against that runtime. Propagation
and `expect` use compiler-selected delimiters at the authored expression site;
they are not ordinary method calls with unchecked throw behavior.

As of 2026-09-06, the Go runtime's eager-call Layer bridge uses
`node:async_hooks` and `node:util/types`, as the reference runtime does. It keeps
the exact body Promise, isolates sibling scopes, and revokes the environment on
completion or rejection without owning hidden child work. Duplicate merge keys
and nested overrides remain refused while their precedence is unspecified.
The current runtime therefore requires Node-compatible host modules. Browser/edge
runtime linking, shared Go/reference runtime identity, and full structural
request lowering remain implementation work, not host-dependent source rules or
completed package interoperability.

### The lifted return contract

Every lowering decision inside a body comes from one *shape* derived from the
declared return type annotation by symbol identity:

| Declared return type | Lifted channels |
| --- | --- |
| `Result<A, E>` | Result |
| `Optional<A>` | Optional |
| `Result<Optional<A>, E>` | Result outside, Optional inside |
| `Promise<…>` on an `async` function | the same, applied to the awaited type |

`Promise` is only looked through for an `async` function, and only through the
checker's own `GetPromisedTypeOfPromise`, so a plain function that hands back a
promise value is never lifted.

### What is lowered

Inside a function, method, or arrow with one of those shapes:

- `throw e` becomes `return new __vibelangErr(e)` (Result channel only; an
  Optional-only owner has no error channel and keeps its authored `throw`).
- `return v` is lifted outside in: an already-compatible value passes through,
  otherwise the Optional lift runs first and the Result wrapper goes around it.
  For the Optional lift, `return null` / `return undefined` become
  `new __vibelangNone()`, a statically non-nullish value becomes
  `new __vibelangSome(v)`, and a value that *may* be nullish goes through
  `__vibelangOptional(v)` rather than being guessed at.
- A concise arrow body `=> v` is lifted the same way.
- `r.unwrap()` — recognized through the resolved symbol of the `unwrap` method
  and the checker type of its receiver — becomes a checked early return:

  ```js
  const __vibelangUnwrapped0 = r;
  if (!__vibelangUnwrapped0.ok)
      return __vibelangUnwrapped0;
  … __vibelangUnwrapped0.value …
  ```

  The discriminant narrowing is what makes both the propagated variant and the
  extracted value check in the lowered program. On an Optional receiver the
  discriminant is `.some` and the guard returns the *owner's* absent value:
  `new __vibelangNone()`, or `new __vibelangOk(new __vibelangNone())` in a
  `Result<Optional<A>, E>` owner.
- `error.match({ NotFound: …, Timeout: … })` becomes constructor-keyed
  dispatch:

  ```js
  error instanceof NotFound ? ((e: NotFound) => …)(error)
      : error instanceof Timeout ? ((e: Timeout) => …)(error)
          : __vibelangMatchFailed(error)
  ```

  Each case label is resolved to the class *binding* it names
  (`Checker.ResolveName` + `GetAliasedSymbol`), so an import alias covers the
  class it aliases and two same-named classes in different modules stay
  distinct. Coverage is checked against the statically known error union, held
  in a side table keyed by resolved class symbol — never in a `TypeFlags` bit,
  which is a full `uint32` the fork owns. An unannotated single-parameter
  handler is given the case's nominal type so the lowered program checks the
  handler body against the class the case selects.

### Order preservation and refusals

Propagation hoists a temporary out of the statement that contained it, so it is
only sound while everything evaluated ahead of it in that statement is
effect-free, and never inside a subexpression that may not be evaluated. The
pass tracks both and refuses otherwise. Nothing is ever approximated: a refused
construct is left byte-for-byte intact and reported at its authored span as a
`lower`-phase diagnostic, and (under `noEmitOnError`) the request emits nothing.

Placement itself is **not** a refusal condition. The statement-walk that used to
decide it — parentheses, `await`, `as`, a property read, the sole declarator of a
single-declarator variable statement, and nothing else — was withdrawn by
`specification/failures.mdx` §Refusal Conditions on 2026-08-30, because the
failure exit is an expression in every position. What survives is not a rule
about placement but a fact about the shipped early-`return` lowering, which
hoists a guard to the front of the enclosing statement. Hoisting preserves the
authored order exactly where the operand is evaluated unconditionally and once,
so three residual conditions are refused, and they apply to postfix `!` and
`Result.expect()` alike:

| Predicate | Refused because | Measured on this backend with the guard removed |
| --- | --- | --- |
| `repeatedlyEvaluatedPosition` | a `while`/`do`/`for` condition or a `for` incrementor runs once per iteration; the guard would run a different number of times | `while (next()!) {}` never terminates |
| `conditionallyEvaluatedPosition` | the right side of `&&`/`\|\|`/`??`, either arm of a ternary, anything after a `?.` link, or a `case` label may not be evaluated at all | `maybe ?? r!` evaluates the skipped operand and propagates its failure |
| `precededByUnhoistedEffect` | the guard jumps over anything to its left that is not hoisted with it | `g() + r!` calls the producer of `r` before `g()` |

A member call, an element access, a call argument, a compound operand, a `for`
initializer and a `for…of` iterable are each unconditional and once, and are
lowered. `a()! + b()!` is **accepted** and order-preserving: both guards hoist,
and they hoist in authored order. These are the same three predicates the
TypeScript instrument applies, verified by running both backends over the same
programs rather than by reading its source.

| Code | Refusal |
| --- | --- |
| `VIBE1101` | a `Result.unwrap()` whose owner declares a contract that cannot carry the failure (reported at the declaration) |
| `VIBE1202` | `Result.unwrap()` with no enclosing function to carry the failure at all |
| `VIBE1204` | a propagation point in a conditionally evaluated operand, or preceded by an unhoisted effect in the same statement |
| `VIBE1703` | a propagation point in a repeated loop header |
| `VIBE1205` | a propagation point inside a `try` with a `catch`, whose failure exit unwinds past the `catch`; and, in its own sentence, a `panic(...)` or `Result.expect()` there, whose panic exit an ordinary `catch` is the wrong observer for |
| `VIBE1206` | `Optional.unwrap()` with no Optional-capable owner |
| `VIBE1251` | `Error.match` without a single object-literal argument |
| `VIBE1252` | a case that is not a static Error class name with a function handler |
| `VIBE1253` | a non-exhaustive match, or a receiver that is not a closed union of Error classes |
| `VIBE1254` | a case outside the checked union |
| `VIBE1301` | a statement that discards a Result |
| `VIBE1401` | `.then()` / `.catch()` / `.finally()` on a Promise instead of `await` |
| `VIBE1402` | a statement that discards a started Promise |
| `VIBE1511` | a top-level `throw`, which module initialization has no checked channel to carry |

Inside a `try` that has a `catch` clause, a `throw` keeps JavaScript throw
behavior instead of being lifted, because the authored `catch` is what handles
it. The `catch` and `finally` blocks are not themselves guarded by that clause.

### Diagnostic vocabulary

The lowered variant classes are an implementation detail, so the bridge
restates the assignability failures that name them in VibeLang's own
vocabulary: `Type 'VibeLangOk<string>' is not assignable to type
'Result<number, RangeError>'.` is reported as `Type 'string' is not assignable
to the success type 'number' of 'Result<number, RangeError>'.` Only exactly
recognized shapes are rewritten; every other message is reported verbatim
rather than approximated. Spans are unchanged either way.

### Positions

Rewritten statements carry the authored statement's source-map range, so a
diagnostic on a lowered statement reports the exact authored span. Purely
synthesized code — the injected prelude import, the `unwrap` guard's `return`
— has no authored origin and stays unmapped rather than pointing somewhere
misleading.

Positions travel as a source map rather than a `spanmap.SpanMap` on purpose.
`spanmap` is the richer representation — segment kinds, a stronger `Validate`,
authored-coordinate plugin diagnostics — but it is the *content mapper's*
representation, and runtime JavaScript emit is deliberately suppressed for
content-mapped files (`tsc/internal/compiler/emitter.go:479`: a file with a
`ContentMapper()` is excluded from the emit set unless declarations are being
produced). Expressing this lowering as span-map segments would therefore move
it onto the one path that cannot emit the runtime JavaScript this mode exists
to produce. The two are complementary: `spanmap` for editor and diagnostic
fidelity, the printer's source map for the emitted artifact.

## `.vibe` import rewriting

In runtime JavaScript output, a relative specifier ending in `.vibe` that
names a project `.vibe` input is rewritten to the emitted `./x.js` name. The
emitted file is parsed with the fork's own parser, so only real import,
re-export, and dynamic-import specifiers rewrite; composed source maps account
for the column shifts. Declarations deliberately keep the authored
`./x.vibe` specifier next to their `x.d.vibe.ts` naming, which is exactly the
pair TypeScript's `allowArbitraryExtensions` resolution expects.

Internal lowering also rewrites a source-free `./x.vibe` runtime edge when its
`x.d.vibe.ts` input carries a validated compiler module envelope. Ordinary
foreign declarations cannot authorize that rewrite. The API supports the
`allowArbitraryExtensions` and `removeComments` boolean options; removing user
comments never strips the callable contracts from published declarations.

The `lib` option accepts upstream's bundled library names (for example,
`["es2022", "dom", "esnext.disposable"]`) independently of the emit target.
Unknown names and paths are refused. An explicit empty set does not restore
default libraries; missing globals produce ordinary TypeScript diagnostics.
`ConfigFile` supplies source-preserving legality diagnostics, while `Options`
supplies the resolved option values.

### Source-free callable publication

With `declaration: true`, internal lowering preserves callable rows and eager
calling conventions through stock TypeScript declaration serialization.
Returned closures, methods, constructors, overloads, default exports, imported
aliases and forwarding packages retain their contracts. A generated type-only
requirement table retains private Context constructors and references dependency
tables by identity; it does not add requirements to any function.

Callable tags use the existing version-2 format. Go module headers use version 3
with `runtimeABI: "vibelang-go-eager@1"`. This distinction is necessary because a
module path and similarly named exports do not establish compatible Result
brands or capability environments. Older readers, including the JS reference,
refuse this module envelope. The Go reader requires the known ABI and a runtime
location resolving to its own prelude. Current execution tests place separately
compiled producer and consumer modules alongside that same prelude instance;
arbitrary installed-package/shared-runtime linking is still implementation work.

Unrepresentable exported capability identities fail publication with `VIBE1810`;
the emitter does not silently publish an empty row. Both runtime and declaration
source maps retain authored positions after the mandatory metadata is inserted.

## What the integration tests prove

All through the process protocol:

- A valid `.vibe` input is transformed by an upstream `contentmapper.Project`,
  checked, and emitted as `main.js` plus a source map whose source and
  embedded content are the authored `main.vibe`; declarations emit as
  `main.d.vibe.ts`.
- An invalid `.vibe` input produces upstream `TS2322` with its file and exact
  identifier span mapped back to the authored file; `noEmitOnError`
  suppresses all artifacts. This holds for multi-file projects (the error
  attributes to the root that contains it) and for externally lowered input
  (the span maps through the supplied non-identity map).
- Multi-file identity projects emit per-file artifacts, rewrite runtime
  `.vibe` imports, and keep exact authored positions in composed maps.
- Internal lowering rewrites a real `.vibe` file's `throw`, `return`, and
  `unwrap()` into Result variant construction; the emitted JavaScript is then
  **executed with `node`**, and the observed values confirm that a `throw`
  returns an error variant, a plain `return` returns a success variant, and
  `unwrap()` propagates the error variant out of the calling function.
- Absence retains ordinary TypeScript `T | undefined` semantics. A user-defined
  `Optional` class and nullable shapes are left untouched, including when an
  Optional instance is a Result success payload; execution tests reject an
  accidental second container or implicit absence propagation.
- `Promise<Result<A, E>>`-returning `async` functions are lowered and
  **executed with `node`**: `throw` and `return` lift through the awaited type,
  a forwarded promise of a Result is not wrapped a second time, and a non-async
  function of the same declared type is left alone. `await` unwraps only the
  Promise, so `await f(x).unwrap()` is not a Result unwrap and is rejected at
  the authored `unwrap` span.
- Nominal error matching is lowered and **executed with `node`**: the emitted
  dispatch keys on the constructor, an import alias covers the class it
  aliases, and a same-named class from a different module neither covers a
  union member nor belongs to it (`VIBE1253`).
- Internal lowering follows resolved symbols, not names: a file declaring its
  own `Result` or `Optional` is untouched while a sibling using the
  compiler-owned ones is lowered, class methods and concise arrows are lowered,
  and a nested non-Result function keeps its authored `throw`.
- A propagation point in a conditionally evaluated operand or preceded by an
  unhoisted effect is refused (`VIBE1204`), and one in a repeated loop header
  is refused (`VIBE1703`), each with the authored call left intact; a
  propagation point inside a catch-guarded `try` is refused (`VIBE1205`)
  rather than emitting a program whose `catch` is silently dead, and a
  `panic(...)` or `Result.expect()` there is refused by the same code under its
  own sentence.
- A propagation in a member call, an element access, a call argument, a compound
  operand or a `for…of` iterable is lowered and runs, and two propagations in one
  compound expression hoist in authored order.
- The Result and Optional operation surface is executed with `node`: `match`,
  `map`, and `unwrapOr` run on both variants of both channels.
- A diagnostic raised on a statement the internal lowering rewrote reports the
  exact authored span in the authored `.vibe` file, restated in VibeLang's
  vocabulary, with no lowered variant name left in the message.
- An externally lowered file with a real non-identity region (`action` →
  `function`) and an inserted helper line round-trips authored positions
  through the composed runtime map, while the helper line's mappings stay
  source-less.

There are two upstream `Program` instances in identity mode by design.
TypeScript content mappers intentionally own parsing/checking and declaration
emit, while their runtime JavaScript output is delegated to the external
mapper or build tool. The bridge therefore checks the mapped `.vibe` Program,
then feeds the lowered (for identity, verbatim) TypeScript into a second
upstream Program for runtime emit and composes its source maps back to the
authored `.vibe`. Externally lowered mode uses a single Program: checking and
emit both happen on the lowered TypeScript, and the bridge owns the mapping
back to authored positions. Identity lowering is expressed as a synthesized
per-line identity map, so both modes share one emit pipeline. Internal
lowering uses the mapped `.vibe` Program for parsing, binding, and type
resolution only, then hands its printed output to the externally lowered
path; semantic diagnostics for `.vibe` files therefore come from the lowered
program, which is the program whose meaning the language actually defines.

## Deliberate POC limits

- All three modes accept only the TypeScript-shaped surface syntax: internal
  lowering rewrites *semantics* on the parsed AST, but VibeLang's own keywords
  still need parser work or an external frontend. `defer` / `errdefer` are the
  concrete case: `defer` is already a scanner keyword in the fork (from TC39
  `import defer`), but `parseStatement` never routes it, so `defer cleanup();`
  is `TS1434 Unexpected keyword or identifier.` A statement form needs an
  upstream parser change; the bridge does not fake one with text substitution.
- Internal lowering covers the Result, Optional, `Result<Optional<…>>`, async
  Result, and nominal `Error.match` channels, and refuses the discarded-channel
  and residual-hoisting shapes above. It does not implement the cross-function
  row analysis (`VIBE1302` parameter consumption, `VIBE1802`/`VIBE1803`
  generic rows, `VIBE1806` callback coverage), foreign-module trust
  (`VIBE1510`), capability/layer injection, or comptime.
- A TypeScript module is imported by its authored `./x.ts` spelling, which is
  what the module-trust check resolves, so `allowImportingTsExtensions` is on by
  default and paired with `rewriteRelativeImportExtensions` for runtime emit.
- A shape is only recognized through an explicit return type annotation that
  resolves directly to `Result` or `Optional`. A user alias in between
  (`type Outcome = Result<A, E>`) is not lowered.
- `unwrap()` propagation hoists its receiver into a temporary before the
  statement, and is refused (`VIBE1204`) when anything effectful is evaluated
  ahead of it in that statement or when it sits in a conditionally evaluated
  subexpression. Property and element reads count as effectful, so the rule is
  conservative by design.
- `Error.match` case ordering is the authored case order, so with an Error
  subclass hierarchy the first matching `instanceof` wins.
- Composition trusts the producer's map inside a run: authored columns advance
  one-for-one within a mapping run (clamped to the authored line end), which
  is exact for verbatim runs and approximate inside replaced tokens.
- The in-memory project has a small compiler-option allowlist and does not yet
  parse `tsconfig`, discover projects, or resolve packages.
- Inputs use relative POSIX-style logical paths. Project roots, path
  canonicalization, and case behavior need a real host.
- The exact checkout is verified, but the local binary cache is not signed or
  independently digest-attested. It is not a production supply-chain boundary.
- Cold-cache builders isolate temporary files and atomically install a binary;
  interrupted build directories are not yet garbage-collected.
- `compiler.New()` remains the dependency-free M0 scaffold. `cmd/vibec-go`
  selects the executable pinned seam only with `--fork-checkout`; production
  wiring must still choose how signed, pinned binaries are distributed.

These limits are intentionally fail-closed: unsupported options, missing
files, dirty or mismatched checkouts, malformed protocol data, malformed
supplied source maps, emit-name collisions, and unavailable toolchains return
structured errors instead of silently falling back to the JavaScript compiler.
