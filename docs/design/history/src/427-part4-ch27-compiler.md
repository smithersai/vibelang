## Part IV. The compiler

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

### 27. Compiler architecture

```ts dts
import { Effect } from "effect"
// a declaration writes the form the source wrote (D500)
export declare function double(n: number): number                 // double(n: number): number { … }
export declare const half: (n: number) => Effect.Effect<number>   // half(n: number) { … }, no annotation
```

The compiler writes ordinary TypeScript declarations with Effect contracts.
TypeScript consumers call an Effect-returning function; VibeLang consumers
run that Effect through an ordinary call, and call a plain function, which
the declaration writes with its own signature, as JavaScript does. The implementation is in
`typescript/tsc/internal/vibelang/`; `typescript/VIBELANG.md` lists its hooks,
acceptance cases, and remaining limitations.

#### The Go fork

The repository holds `microsoft/TypeScript` at `257e874`, the source of
`typescript@next` 7.1.0-dev.20261015.1, imported without upstream test baselines
(D60). The Go module requires Go 1.27. Build from the repository root:

```sh
cd typescript/tsc
CGO_ENABLED=0 GOFLAGS=-trimpath go build -o ../built/local/tsc ./cmd/tsc
```

`sh scripts/build-vibelang.sh` instead puts the native executable in
`packages/compiler/native/vibelang` for the package launcher. `-trimpath` lets jj
workspaces share Go build-cache entries. The compiler embeds its library
`.d.ts` files, so the executable needs no adjacent library directory.

VibeLang lives in-tree, uses no unsafe struct mirrors or `go:linkname`
bindings, and registers hooks through a blank import in `cmd/tsc/main.go`.
Upstream seams handle `.vibe` recognition, module resolution, checker queries
and extension state, diagnostics, compiler options, and transform registration.
They are small commits in the repository's jj history, not a separately
applied patch series.

#### Pipeline

```text
.vibe and .ts sources
  -> TypeScript parser and binder
  -> TypeScript checker with VibeLang hooks
       prelude and service keys
       call and program rules (Chapter 13)
       contracts, failures, requirements, provider graphs
       trust levels and diagnostics
  -> VibeLang AST transform under the checker lock
       Effect.fnUntraced generators and Effect regions
       runtime helpers and plain $direct variants
  -> TypeScript emit
       JavaScript, source maps, and ordinary .d.ts files
```

The parser extends TypeScript's grammar with VibeLang's contracts, declarations, expressions, and block forms. The checker resolves prelude names as
implicit imports from `vibelang-runtime`, `effect`'s other root exports as
implicit imports from `effect`, and the modules of its subpath packages as
implicit imports of their packages, such as `effect/http`, unless a local
declaration or import shadows them (D4, D48, D146, D310). Class hooks give a `service` declaration the class
Effect TypeScript writes, `Context.Service<X, Shape>()(key)`, its identifier and its shape (D1, D501).

Lowering runs before TypeScript's type erasure, queries the checker while
holding the checker lock, and rewrites the TypeScript AST directly. The
machine chapters' computation IR is a semantic model; the compiler builds no
separate IR.

A call runs where its callee is declared to return `Effect` (Chapter 13); a
callee declared to return `Config`, `Exit`, or another Effect subtype returns
data until that value is called. An Effect function, unannotated or with an
Effect contract, whose body performs no Effect operation gets a `$direct`
variant for its calls in Effect code and keeps its Effect form as its public
ABI (D10, D421); a plain return annotation, `: infer _` included, makes one
plain function (D67, D500).
Calls and operands keep source order. `throw` adds an expected failure; `try`,
`catch`, and `finally` become regions with completion records for jumps (D13,
D15, D46).

Names the lowering introduces are hygienic. An Effect function's plain
variant, `$direct`, and its `$recur`, `$stack` and `$eager` variants, a region's generator name such as
`work$try`, and a declaration file's `Users_base` are spelled by no identifier
of the file: the name takes a `$1`, `$2`, ... suffix when the source spells it.
So no source binding captures generated code, and generated code captures no
source binding; where generated code inside a plain function must name the
function or its variant and the body shadows that name, it calls a forwarder of fresh name. A module that exports a name spelled like a variant, such as
`double$direct` beside an Effect function `double`, exports the variant as
`double$direct$1`, and its importers compute the same name from its exports.
The parser's names follow the same rule: the const or parameter that holds a
`match` or `is` subject (`$match1`, `$is2`), an extractor's values and the
labels it writes take the next free number when the file spells theirs.
The prelude exports that the parser's forms call or extend, such as `$is`,
`$awaitAll` or `TaggedError`, are intrinsics: they mean the prelude's export
whatever the file declares. Where a source binding of another meaning would
capture one, the emitted JavaScript reaches the export through the lowering's
own import, as `runtime.$is`. Likewise, where a binding around a call shadows
a failure class its contract lists, the generated test reaches a global such
as `SyntaxError` through the runtime's `$global`, and a class of the file
through an alias declared after the class.
An Effect function's generator carries the function's name for stack traces
(D36) but binds none: a named function expression that refers to itself, in
its body or a parameter default, forwards to the generator as a declaration
does, so the name stays the function its callers call.

#### Settings belong to the source package

A `.vibe` file uses the VibeLang settings of the package that owns it (D297): trusted packages, diagnostic categories, and tracing. The nearest `package.json` that names a package identifies the owner. Files in the compiled project's package use the compiled tsconfig's settings, including changes in a test config that extends the package's config. Files in another package use the nearest `tsconfig.json` above them, including its extended settings. If none exists, they use the compiled project's settings.

With `--ignoreConfig` or files named on the command line, the program has no package of its own, so every package's `.vibe` files use their own package settings. TypeScript's own compiler options still apply to every file in the program. The checker therefore agrees with the loader and bundler that emit each package's files. Case `foreign-project-settings` covers this boundary.

#### One checker pass

Overload resolution is TypeScript's, from the arguments' types: a function
literal is typed once, as TypeScript types it, by the first candidate
TypeScript checks it against, takes the form that candidate's destination
gives it, and no other candidate's typing is compared (D450, D482, D500); a
function with no required parameters converts to a program only when no
candidate accepts the arguments as they are, with a candidate that takes it
as a function preferred to one that converts it (rule F, D380). The hooks
check each argument against the picked signature in the form Chapter 13
gives the argument, a literal typed in that form, its return type wrapped
as `Effect<A, E, R>` where the form is Effect (D510). The order of overloads
never decides when an argument other than a function is evaluated; where it
decides a function literal's typing, and with it the literal's form, it
decides whether the literal compiles and, for a literal whose body compiles
in either form, whether the receiver's call runs its body or builds a
program, rule F's rough edge (D482, D494, D500, D510). A return in a program is checked
against the Effect's success type. Function values, and the elements of
array and object literals, convert to Effects where a parameter expects them
(D7, D49, D423). Conversion runs no body when it happens; it decides whether
the receiver's call of the function runs the body or builds a cold program
whose runs do, as rule F specifies (D447), and it traverses no collection
that an argument only names. D10's plain variants are a greatest fixpoint
over the callee group, an optimization that decides no form (D421, D500).
An intrinsic call such as Effect's `pipe` or the runtime's `wire` is
recognized by the declaration its callee resolves to, through import aliases
and namespace members, never by its spelling.

D52 requires recursive E and R inference inside a call-graph component; the
acceptance cases and `typescript/VIBELANG.md` record current coverage. No
whole-program iterative lowering pass runs.

The earlier `prototype/esc`, an executable reference, uses TypeScript 5.9.3 and
repeated checks; its 46 examples are now native-compiler acceptance cases under
`typescript/vibelang/cases/`. `prototype/single-pass/RESULTS.md` records the
experiments behind D56. The native implementation doesn't duplicate source
text per lambda form.

#### Runtime boundary

Generated JavaScript imports only `effect` and `vibelang-runtime` (D30). The
runtime holds the continuation kernel and the helpers the compiler emits; it
runs on Effect's fiber, Context, and Scope and adds no scheduler. It checks for
`effect@4.0.6` at load time and rejects other versions.

| Runtime helper | Purpose |
| --- | --- |
| `$programs` | Convert the functions a spread supplies to an array or object literal where programs are expected, as the spread reads them (D423) |
| `$catch`, `$finally` | Expected-failure handling and cleanup |
| `$expected`, `$caught`, `$finallyFailure` | A plain function's throw, which wraps its operand as an expected failure whatever the operand is (D406), its catch's filter that rethrows defects, and its finally block's failure joined to the one in flight (D15, D54, D282); with them the combining form that a failing `finally` or iterator close uses in plain code, which carries two defects across a JavaScript frame as a `SuppressedError` (D340, D341); `$finallyFailure` is also the close helper of every native `for...of`, in plain code and frames, whose body and head failures leave the loop by `break` so that a failing `return()` reaches it (D404, D424) |
| `$region`, `$using`, `$fork` | Block-owned scopes, resources, and children |
| `$service`, `$reference`, `$control` | Service keys, defaults, and control operations |
| `$trusted`, `$trustedPlain` | Classify listed foreign exceptions |
| `handle`, `resume`, `$tailResume` | Continuation handling |
| `$produce`, `$yield`, `$forOf`, `$forStream` | Producers: a producer value is a `Stream` whose channel is the adapter and whose `$produce` property is its program (D402) |
| `acquireRelease`, `acquireDisposable` | Effect's acquisitions, which also record the value whose release they registered, so `using` adds no second release (D401); a `.vibe` reference to Effect's own denotes these |
| `$iteratorFrame` | Effect ownership of native iterator cleanup across suspension: the runtime loop's adapter, which unwinds a frame Effect abandons (D356) |
| `$plainSync`, `$joinedFrame` | The Effect form of an Effect function built over its plain variant (Chapter 15), and a generated frame, both turning a `SuppressedError` the runtime made back into the cause it stands for where it reaches an Effect frame (D340, D341) |

The runtime's README lists the full ABI. Compiler and helper changes belong in
one commit. The smoke harness builds the runtime and links every case to that
workspace's package, so incompatible versions can't pass unnoticed.

#### Declarations and the ABI

A `.vibe` module's declaration file is its ABI: what a consumer compiled
against it may rely on [Rule] (D366).

1. **The same program.** For every export, a consumer compiled against the
   emitted `.d.ts` calls the same runtime operation, with the same success,
   error, and requirement types, the same service and control identities, and
   the same legal uses of its callbacks, as a consumer compiled from the
   source. An exported function returns a cold `Effect`, one with a plain
   return annotation, `: infer _` included, is a plain function (D500), and a
   producer returns a `Stream`,
   the same producer value a VibeLang caller receives: a TypeScript consumer
   pulls it through the adapter, and a VibeLang consumer of the declaration
   that iterates it with `for...of` runs it on the loop's fiber, as a source
   consumer does (Chapter 10, D402). Declaration emit writes a signature
   from an inferred type as TypeScript infers it, which is the type rules R
   and F read in the source, since they read a type as TypeScript writes
   it, so the consumer's call runs or returns data, and a function value has
   the form, as the source's does, with no alias (Chapter 13, D458, D491,
   D492).
2. **More conservative, never different.** A declaration cannot prove what a
   body does: that a plain function never throws, or that a function whose R
   names a control operation never moves it to another fiber. A consumer that
   sees only declarations treats such a function as foreign code (EK4401,
   EK4202) where a consumer of the source would not, except a module the
   compiler's manifest lists (rule 3): it calls the plain functions and plain
   methods of the exports the manifest lists as plain calls, in plain code too unless a return type
   is definitely an Effect, as a consumer of the source does (Chapter 13,
   D445, D480), an exception of a class a `trusted` value's type lists is an
   expected failure (D399, D400), and any other is a defect (D282, D500). It
   never runs or types a call differently.
3. **Written forms, and the manifest.** A plain function, one with a plain
   return annotation or `: infer _` (Chapter 13, rule F, D500), is declared
   with its TypeScript signature, as TypeScript's declaration emit writes it
   for the same function written in TypeScript; an Effect function, one with
   no return annotation or an Effect contract, with its Effect signature,
   `(…) => Effect.Effect<A, E, R>`; and a class's method by its annotation,
   or, unannotated, by D397's reading. No runtime type marks a form, so a
   consumer reads a function's form from its declared type exactly as a
   source consumer does: a function type whose return type is definitely an
   Effect is an Effect function, and any other a plain function. A
   declaration cannot say that a plain function was compiled from VibeLang,
   and so never fails with an expected failure and needs no service, so the
   compiler records it outside the declarations, which stay what TypeScript
   would emit: beside the declaration files it emits, in the
   declaration output's root directory, it writes `vibelang.manifest.json`,
   whose `declarations` object maps each declaration file it emitted from a
   `.vibe` file, relative to that directory, to the names of the exports the
   trust covers: each export the `.vibe` file binds by a function or class
   declaration, or by a `const` or `let` whose initializer is a function
   literal or an object literal, written in that file (D516). A re-export,
   `export { parse } from "./legacy.ts"`, and a binding initialized from any
   other expression, `export const parse = legacyParse`, are not listed, since
   the compiler did not compile them from VibeLang, so a declaration consumer
   reads them as foreign code (EK4401) and never trusts more than the source
   shows. A consumer finds the manifest after TypeScript's module resolution,
   `exports` conditions, `typesVersions`, and symlinked installs included: for
   the declaration file TypeScript resolved, `.d.ts`, `.d.mts`, or `.d.cts`,
   it takes the file's real path, reads the nearest `vibelang.manifest.json`
   in that file's directory or above it, up to its package's root, and trusts
   each listed export of a listed file as `trustedPackages` trusts a package
   (D261). A declaration file no manifest lists, such as one a tool like
   `api-extractor` rolled up from the emitted ones, is foreign code. The
   manifest is the producing package's assertion, as its declaration files
   are (Chapter 26's trusted base). A package publishes the manifest with its
   declarations. A plain export of a package without a manifest is foreign
   code to a declaration consumer (EK4401), never a silent difference. A
   function with an Effect contract is declared with its Effect signature
   alone, even where the compiler gives it a plain variant for its calls, so
   passing it where a plain function is expected is EK4301 to both consumers
   (D421). A `trusted(impl, [Errors])` value is one plain function, whose
   type is the runtime's `Trusted<F, Errors>`, `F` with its listed error
   classes, so a declaration consumer reads its form and its list from the
   type, as a source consumer does (D400, D514). No generated function, such as a direct
   variant, a region, or a helper, is a public export.
4. **Standard TypeScript.** A declaration file is TypeScript that stock
   TypeScript checks with `skipLibCheck: false`: an Effect type is written
   `Effect.Effect<A, E, R>`, never in the `!` form, and no VibeLang keyword
   appears. Effect's own modules, the prelude's `Effect`, `Layer`, `Schema`
   and `Scope` included, are imported from `effect`, as Effect TypeScript
   imports them, `import { Effect, Scope } from "effect"`, and their types
   written as `effect` declares them, `Scope.Scope`, never through the
   runtime's re-exports or aliases. A `!` form is written as Effect
   TypeScript writes it: an empty slot at its end, which is `never`,
   Effect's default, is left out (`number!!` is `Effect.Effect<number>`,
   `User!NotFound!` is `Effect.Effect<User, NotFound>`), and so are
   dependencies that a return annotation leaves for the body to supply
   when they come to `never`; a slot the source fills stays.
5. **What Effect TypeScript declares.** A `service`, `schema`, or `error`
   declaration's declaration file is the one TypeScript emits for the Effect
   TypeScript the declaration stands for (D501): `service X` writes
   `declare class X extends Context.Service<X, Shape>()("<key>") {}` in
   TypeScript's emitted form, with its key; a service with a default writes
   `declare const X: Context.Reference<Shape>`; `schema P` writes the
   schema constant and `type P = typeof P.Type`; and `error E` writes what
   `class E extends Data.TaggedError("E")<{ … }> {}` emits, with no member,
   marker, or namespace of VibeLang's. A declaration consumer reads a
   service's identity from Effect's key type and an error class's
   tag set from its `_tag` type, which a class arm tests (Chapter 3, D515). Each declaration emits the same declarations inside a
   `namespace` as at a file's top level. A `control` declaration, which no
   Effect TypeScript declares, keeps the runtime's control key.
6. **Hygienic.** A name that declaration emit adds, such as a key's base
   constant or a prelude import's alias (D123), is fresh against every name
   the file declares or imports (Chapter 13, rule H6).

A round-trip suite holds the compiler to rule 1: it compiles a stock
TypeScript consumer and a VibeLang consumer of each case's emitted
declarations alone, across aliases and re-exports, recursive inference,
generic callbacks, services and providers, data variants, and error families,
and, for the rules the third review and D500 added, an Effect-annotated,
an unannotated, and a plain-annotated function passed to `map`, a
contextually typed `(x) => x.run()`, a class with plain methods, an exported
object with an unannotated method and a protocol method, a method of a
returned object, a `let` that holds a plain function, a `: infer _` export,
a callback parameter written with its channels, and exported compositions
and extracted methods (D421, D458, D484, D500).

Services emit as Effect's own class, as Effect TypeScript declares them
(D501), so ordinary TypeScript provides a service and implements its shape
exactly as it does a `Context.Service` written in TypeScript:

```ts dts
import { Context, Effect } from "effect"
declare const Users_base: Context.ServiceClass<Users, "@acme/app/src/users#Users", {
    find(id: string): Effect.Effect<User, UserNotFound>;
}>
export declare class Users extends Users_base {}
```

A service with a default is `export declare const FeatureFlags:
Context.Reference<{ readonly newCheckout: boolean }>` (D501).
Declaration transforms add imports for prelude names, joining an import of
the same module that the file keeps, name an effect module that an
inferred type comes from through the name the source reaches it by, as
Effect TypeScript that imports the module does (`Option.Option<string>`,
not `import("effect/Option").Option<string>`; the Effect module always),
write each callback parameter's type as the source writes it, and write
source specifiers as `.js` (Chapter 26). TypeScript consumers need only the
`.js`, `.d.ts`, `effect`, and runtime packages. A TypeScript class
implements the service's shape, `implements Context.Service.Shape<typeof
Users>`, and a `.vibe` class written `implements Users` is emitted so
(D501).

Trusted TypeScript contracts use `trusted(impl, [Errors])` (D249, Chapter 10).
The older D23 declaration tags still affect the native compiler and draw
EK4406 where their contract affects lowering.

#### Other renderings

The compiler this chapter describes, which lowers by the checker's types, defines the language [Rule] (D366). The text projector (D248-D254), which reads one file at a time without types, and any later renderer are implementations: on every program the compiler accepts, a renderer produces the same observations (Chapter 26) or reports an error at that program (EK9100). It never gives a program another meaning. The decisions that describe the projector's run-time checks are notes on how it meets this rule, not rules of the language.

#### Acceptance checks

```sh
cd typescript
sh vibelang/smoke.sh --status
```

The harness compiles cases in parallel, runs successful programs on Node, and
checks expected failure codes and optional diagnostic positions. A `pending`
case reports its responsible compiler component and doesn't fail the suite. Source-map
and tracing cases check original `.vibe` frames and generated spans (D34, D36).
The docs checker, `bun docs/tools/check-snippets.ts` run from the repository
root, checks user-guide snippets independently.
