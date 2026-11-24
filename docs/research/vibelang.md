# VibeLang: prior art for EffectScript

> Historical research from before the October 2026 VIP rewrite. This page uses ‘EffectScript’ for the project now called VibeLang and may use ‘VibeLang’ for the earlier design. See the [current specification](../design/src/000-intro.md).

Researched 2026-10-15. Purpose: decide which VibeLang compiler architecture and
boundary-analysis ideas EffectScript can borrow without inheriting VibeLang's
execution model.

## Summary

VibeLang keeps authored functions eager, lifts `return`/`throw` into
`Result<A, E>` values, and infers a nominal capability row `R` from
`Capability.context()` calls. It never adopts Effect's computation model or
fiber runtime.

The repository holds three generations of the design. `main` (`c60eca97`,
2026-08-21) holds the normative Result/capability specification. Beside it sits
an M0 scaffold that compiles no `.vibe` source, plus two experiments
(`prototype/`, `poc/`) written in superseded syntax (`!T`, `throws`, `uses`,
`try`, `catch |e|`). An unmerged bookmark, `poc/pre-withdrawal-checkpoint`
(`ebe89a2b`, 2026-09-10, 254 commits ahead of `main`), contains three things:

- a working compiler built inside a pinned fork of the Go TypeScript compiler;
- a reduced language: postfix `!`, no `Optional<T>`, TypeScript as the only
  target;
- a compiler-owned one-shot delimited-continuation substrate.

vibelang.sh serves neither tip; its text matches revision `144d1034`
(2026-08-22).

For EffectScript, three parts of the checkpoint are the most valuable:

- the fork-seam analysis (`compiler/FORK-SEAM-DESIGN.md`);
- the foreign-boundary rules (`poc/src/language/README.md`);
- the one-shot continuation rules (`specification/effects.mdx`,
  `poc/src/runtime/effect.ts`).

Do not inherit VibeLang's execution model:

- eager functions with Result values;
- two calling conventions;
- a private handler loop beside the host;
- lean Layers.

---

## 1. Sources, revisions, and how to read this document

### 1.1 Revisions read

| Source | Exact revision | Date | How read |
| --- | --- | --- | --- |
| `smithersai/vibelang` `main` | `c60eca975b01a6778fdad81e5f54d72091481298` | 2026-08-21 02:15 -07:00 (pushed 09:16Z) | `jj git clone`; confirmed by `gh api repos/smithersai/vibelang/commits/main` |
| bookmark `poc/pre-withdrawal-checkpoint` | `ebe89a2bc72f1603059dea7b10e661bb0e5c7c49` | 2026-09-10 16:56 -07:00 | `jj file show` export of every file; not merged into `main` |
| vibelang.sh | matches `144d10347ba9` (on the checkpoint lineage) | 2026-08-22 13:32 -07:00 | WebFetch of `/`, `/specification/failures`, `/specification/type-system`; `/specification/effects` returns 404 |
| Upstream pin on `main` | `microsoft/TypeScript@c087644e82dc3d48cf87e4c5519eeaaea9daf35c` ("Downgrade too-new npm deps (#63925)") | 2026-08-20 | `gh api`; `tsc/go.mod` exists at that commit |
| Upstream pin on checkpoint | `microsoft/TypeScript@bf7f49d6f5ad3254d03ed83dd07ab510ae4e582a` ("Add independent VS Code extension releases (#64139)") | 2026-09-08 | `gh api`; `tsc/go.mod` exists at that commit |
| VibeLang upstream fork | `smithersai/TypeScript` (fork of `microsoft/TypeScript`, last push 2026-08-20T20:41Z) | | `gh api repos/smithersai/TypeScript` |

Evidence for the site attribution: the site's type-system "Foreign
Boundaries" paragraph is identical to `144d10347ba9:docs/src/pages/specification/type-system.mdx:60`.
The landing-page phrases "checker-backed, multi-module" and "Layers do not
supervise task lifetime" match `144d10347ba9:docs/src/pages/index.mdx:79,491`.
Neither tip contains that combination.

GitHub activity (`gh api repos/smithersai/vibelang/activity`) shows `main`
created 2026-08-21T04:03Z and last pushed 2026-08-21T09:16Z, with no force
push. The checkpoint bookmark was created 2026-08-27T22:47Z at `edc38aa17062`
and pushed through 2026-09-10T23:56Z. Commit `a43dcbea1f21` (2026-08-23) is
titled "checkpoint the POC before the specification withdrawal".

### 1.2 Tags used below

- **[main]**: the default branch at `c60eca97`.
- **[ckpt]**: the unmerged bookmark at `ebe89a2b`.
- **[site]**: vibelang.sh (= `144d1034`).
- **[hist]**: historical or superseded material, either self-declared or
  contradicted by a newer normative page.

Status labels **Locked / Direction / Open** are VibeLang's own
(`docs/DECISIONS.md:7-11`). Paths are repository-relative. Line numbers refer
to the tagged revision. Measured behavior quoted from **[ckpt]** documents is
VibeLang's own record; I did not execute those tests.

### 1.3 Timeline of the design

```text
2026-08-20  prototype/  regex lowering; `!NotFound`, `uses A, B`, `provide {}`      [hist]
2026-08-20  poc/        token-level risk spike; `!T`, `throws`, named `uses`, `try`  [hist]
2026-08-21  c60eca97    main HEAD: Result<A,E>, .unwrap(), Optional<T>, `TypeScript`
                        requirement, LLVM/Wasm targets, M0 scaffold (no .vibe)      [main]
2026-08-22  144d1034    + checked `panic` case and @throws trust; site deployed     [site]
2026-08-23  reduction   postfix `!`, no Optional, TS-only target, one grammar form   [ckpt]
2026-08-27  pivot       one-shot delimited continuations become the runtime primitive [ckpt]
2026-09-06  owner       durable = static Plans; Go is the only compiler; eval refused [ckpt]
2026-09-10  ebe89a2b    checkpoint tip (Go TypeScript 7.1.0-dev bridge, API 53)        [ckpt]
```

### 1.4 What is normative on `main`, and what is stale

On `main` the ledger wins conflicts: "When these pages conflict with the
ledger, the ledger wins until the specification is updated"
(`docs/src/pages/specification/index.mdx:41`). The ledger itself says it is
ahead of the pages: "The specification pages still need to be reconciled with
the compatibility and foreign-panic decisions below" (`docs/DECISIONS.md:14-15`).

| Material on [main] | Status |
| --- | --- |
| `docs/DECISIONS.md` | Normative (tie-breaker) |
| `docs/src/pages/specification/{type-system,failures,requirements,compatibility,control-flow,comptime,durable-execution}.mdx` | Normative; maturity marked per section |
| `docs/src/pages/guide/typed-failures.mdx`, `reference/function-channels.mdx`, `reference/errors.mdx` | Consistent with the spec |
| `docs/src/pages/guide/typescript-interop.mdx:16,64-83` | **Stale.** Uses `throws`, a postfix `catch`, and `unknown` for foreign failures, which contradicts `failures.mdx:58,109` |
| `guide/capabilities-and-layers.mdx:13,28,41`, `reference/capabilities.mdx:9,20` | **Half-updated.** Uses `.context()` (current) together with `throws` and prefix `try` (superseded) |
| `introduction/why-vibelang.mdx:41,79`, `introduction/philosophy.mdx:34-44` | **Stale.** Shows "checked recoverable failures without result wrappers" and `throws` in exported declarations |
| `guide/{features,concurrency,platforms-and-targets,runtime-validation,control-flow,agent-library,asset-imports,durable-execution}.mdx` | **Stale examples.** They use prefix `try` and `throws` |
| `skills/vibelang/SKILL.md:8,12,14,17` | **Stale.** Says "never introduce `Effect`, `Result`", and teaches `T throws E`, `try`, `?T`, and `unknown` |
| `reference/cli.mdx` | Describes only `prototype/` |
| `poc/` (including the required `poc/src/language/README.md`) | **[hist].** Predates the Result rewrite; see §8 |
| `prototype/` | **[hist].** Self-declared at `prototype/NOTES.md:6-10` |

Commit `c60eca97`, the last commit on `main`, introduced the Result model. It
rewrote `docs/DECISIONS.md` (+219 lines) and `failures.mdx` and `type-system.mdx`.
Before it, `322f6b52c4b2:docs/DECISIONS.md:49` read "**Direction:** `!T` denotes
an inferred checked failure set; `throws E` pins …". That timing explains why
`poc/` and most guide pages still use the `throws` model.

---

## 2. Compiler architecture (question 1)

### 2.1 Lineage and revision

VibeLang forks the **Go-native TypeScript compiler (TypeScript 7) as it now
lives under `tsc/` inside `microsoft/TypeScript`**. It does not fork the
JavaScript `src/compiler` and does not fork a separate `typescript-go`
repository.

- [main] "**Locked:** Build on the Go compiler now located under `tsc/` in
  `microsoft/TypeScript`, tracking upstream with a minimal diff."
  (`docs/DECISIONS.md:420-421`)
- [main] The pin is `typescript-fork.json:7` (`revision`), set to
  `c087644e82dc…`. The fork is `smithersai/TypeScript`, vendored at
  `vendor/typescript` "with a squashed Git subtree" (`docs/TYPESCRIPT_FORK.md:3-6`).
- [main] VibeLang's `docs/TYPESCRIPT_FORK.md:8-11` claims its fork did not yet
  exist. GitHub shows that VibeLang fork existed (last push
  2026-08-20T20:41Z). `main` has no `vendor/` directory.
- [ckpt] The pin moved to `bf7f49d6…` (`typescript-fork.json:7`). The Go module
  is `github.com/microsoft/TypeScript/tsc` on Go 1.26
  (`compiler/FORK-SEAM-DESIGN.md:131`). The native compiler reports version
  `7.1.0-dev` (`compiler/GO-MIGRATION.md:17`).
- [ckpt] `compiler/FORK-SEAM-DESIGN.md:93-96`: "The pinned revision has zero
  VibeLang delta … 'The fork' today is pristine upstream." VibeLang's changes
  live in the `vibelang` repository and are applied to a pristine checkout
  (§2.2).
- [main] The npm package depends on `typescript@7.0.2` (the native compiler)
  and on `typescript-js` = `typescript@5.9.3` for a JavaScript-API
  compatibility facade (`package.json:165-168`, `docs/COMPATIBILITY_API.md:11-24`).
  [ckpt] removed the 5.9 facade: "The Go compiler is the sole compiler and
  tooling implementation … do not retain a second semantic core or a JavaScript
  fallback" (`docs/DECISIONS.md:1198-1204`).

### 2.2 Integration with the fork

**Why a fork is needed** ([main] `docs/TYPESCRIPT_FORK.md:15-19`; also
`compiler/README.md:7-14`):

> "The TypeScript Go compiler is a nested module under `tsc/`, and its useful
> compiler packages are under `tsc/internal`. Go only permits packages within
> the parent `tsc` module path to import those packages."

**[main] Plan (not built).**

- A "narrow fork-owned extension seam" at `tsc/internal/vibelang/` and an entry
  point at `tsc/cmd/vibec/` (`docs/TYPESCRIPT_FORK.md:21-35`).
- The root module "must not copy TypeScript internals or use `replace`
  directives". It invokes the fork-built compiler "through the process
  protocol represented by `compiler`" (`:32-35`).
- The protocol is `compiler/api.go:67-101`: `CompileRequest`/`CompileResult`
  as JSON, diagnostics with UTF-16 spans (`:47-61`), and an
  `Extension` interface with `Parse`/`Check`/`Lower` over `any`.
- The only implementation returns `VIBE0001` "not implemented"
  (`compiler/notimplemented.go:28-43`, `cmd/vibec-go/main.go`).
- Fork updates must "Land a patch in the fork first, then refresh the
  subtree" (`docs/TYPESCRIPT_FORK.md:59-61`).

**[ckpt] What was built.**

1. **Build overlay for fork-owned code.** `go build -overlay` places 65
   fork-owned Go files from `compiler/forkbridge/*.go.txt` into the fork's
   `cmd/tsc/` package. `compiler/fork.go` lists 66 `cmd/tsc/...` overlay
   targets, starting at line 309. The overlay works because
   "**`cmd/` is inside the module.** … Any new directory under `tsc/cmd/` gets
   full `internal/*` access with **zero lines changed in any existing file**"
   (`compiler/FORK-SEAM-DESIGN.md:134-138`).
2. **An ordered patch series for edits to upstream files.**
   `compiler/forkpatch/series.json` lists five patches:
   - `0200` content-mapper extension resolution;
   - `0300` `if (const x = f(); cond)` grammar (+89/-9);
   - `0800` regenerated AST;
   - `0900` and `0950` fork-owned tests.

   Every touched file is gated by SHA-256 pre-image and post-image digests.
   `verify --regenerate` proves the generated patch is derived. A mixed
   checkout is a hard failure (`compiler/GRAMMAR-SPIKE.md` §7.2, lines
   646-667; `compiler/forkpatch/README.md`).
3. **Offline source capsule instead of a subtree.** `vendor/typescript/`
   holds a complete-object Git bundle plus a Go module proxy. "this is not
   presented as an actual subtree" (`docs/TYPESCRIPT_FORK.md:79-98`).
4. **A minimal-diff seam table.** Every fork change belongs to one of seven
   seams (`docs/TYPESCRIPT_FORK.md:60-77`):
   - source kind and parser;
   - binder and checker;
   - flow analysis;
   - comptime;
   - durable emission;
   - emitter;
   - language service.

   The same document says: "VibeLang MUST NOT copy large TypeScript
   subsystems into parallel packages or maintain a second parser/checker as
   the product path."
5. **The content mapper as the hosting seam.** Upstream already ships
   `internal/contentmapper` and `internal/spanmap`: "a versioned JSON-RPC
   plugin protocol for hosting non-TypeScript source languages, with
   authored-position span mapping … and ~26 LSP capabilities dynamically
   registered against a `**/*.vibe` glob" (`compiler/FORK-SEAM-DESIGN.md:53-61`).
   ".vibe stayed a content-mapper extension": the dialect gate matches
   `.vibe` and the virtual `.vibe.ts` name (`compiler/GRAMMAR-SPIKE.md:757-764`).

**The three walls of the content-mapper path**
(`compiler/FORK-SEAM-DESIGN.md:63-77`; verdict at 1395-1508). EffectScript
should plan for these up front.

1. Runtime JavaScript emit is switched off for content-mapped files
   (`internal/compiler/emitter.go:479`), and the printer's source-map writer is
   unaware of span maps. The fix touches about five sites, roughly 50 changed
   lines (`:1062-1102`).
2. The content-mapper cache identity is per file
   (`internal/project/parsecache.go:43`), while whole-program `E`/`R` inference
   depends on every file. "You can have correctness or incrementality, not
   both, on that path" (`:70-73`, `:883-920`).
3. "`TypeFlags` is a `uint32` with **all 32 bits allocated** … Rows have to be
   modelled *beside* the type system, not inside it" (`:74-77`). The
   recommended carriers are `Signature` fields or a `core.LinkStore`, with the
   fixed point driven by the checker's own
   `pushTypeResolution`/`popTypeResolution` (`:736-817`).

**Staged plan with measured costs** (`compiler/FORK-SEAM-DESIGN.md:1381-1391`):

```text
stage                          changed upstream lines   new lines        revertible
1 own entry point (cmd/vibec)  0                        ~1,600           yes
2 real content mapper + LSP    0                        ~4,000-6,000     yes
3 JS emit + span-aware maps    ~50                      ~60              yes
4 first-class .vibe + grammar  ~300-450                 ~1,300-1,600     NO (one-way door)
5 rows in the checker          ~60                      ~2,000-3,000     mostly
6 fork-owned lowering          ~40                      ~1,500-3,000     yes
```

The same document recommends deleting `main`'s `compiler.Extension` sketch:
"The fork has no such seam and never will … The real seams are, in order of
narrowness: `contentmapper.Result`, `printer.EmitResolver`,
`nodebuilder.SymbolTracker`, and `getScriptTransformers`'s slice"
(`:1479-1486`). The grammar spike showed that "grammar is cheap to write and
expensive to vendor". `defer`/`errdefer` cost 124 hand-written lines with zero
regressions across 132,873 upstream subtests
(`compiler/GRAMMAR-SPIKE.md:76-86`). The language later withdrew those forms.

### 2.3 Intermediate representation

- [main] **Direction**: "Content mappers are useful for the earliest prototype
  and editor support, but LLVM/Wasm likely require a shared checked VibeLang IR"
  (`docs/DECISIONS.md:431-432`). `compiler/api.go:91-93` reads: "Concrete
  checked IR types remain intentionally absent". `poc/FINDINGS.md:65-81` sketches
  a "shared checked VibeLang IR: A/E/R rows, reified types, symbolic
  expressions" feeding TS/JS emit, LLVM/Wasm, asset IR, and Plan IR.
- [ckpt] There is no separate IR. TypeScript is the only target, so lowering
  goes TypeScript AST to TypeScript AST inside the fork, using the checker, the
  `printer.NodeFactory`, and `NodeVisitor`. Its own description:
  "No step inspects source text" (`compiler/README.md:203-228`).
- [ckpt] The ledger's direction: "semantic phases share one checked VibeLang IR
  rather than parallel frontend models" (`docs/DECISIONS.md:1244-1246`). The
  ledger also withdrew one IR: "The shared Plan/expression IR this item
  previously named is withdrawn with the plan" (`:1377-1378`).
- [ckpt] Rows are side-table facts plus provisional `@vibelangEffects`
  declaration metadata (`poc/src/language/README.md:96-102`). Durable Flows
  compile to keyed Plan graphs (`docs/TYPESCRIPT_FORK.md:154-168`).

### 2.4 Emission and declarations

- [main] The TypeScript backend "lowers VibeLang constructs into TypeScript
  before the ordinary TypeScript pipeline completes checking and emission where
  feasible" (`docs/DECISIONS.md:428-430`; `compatibility.mdx:16`).
  "Requirement metadata SHOULD erase … infallible, non-optional functions MUST
  NOT be wrapped" (`compatibility.mdx:18`).
- [ckpt] The emitted shape keeps the public function eager. It wraps an
  internal generator delimited by a Result frame (`poc/src/language/language.test.ts:95-114`):

  ```text
  return __vsRunResult(function* () { const value = yield* __vsPropagate(leaf(id), …); return __vsResultSuccess(value + 1) })
  ```

  "Public calls stay eager; the emitted calling convention is compiler-owned"
  (`specification/effects.mdx:107-112`).
- [ckpt] The planned insertion point for fork-owned lowering is
  `getScriptTransformers`, before `TypeEraserTransformer`, "so the transform
  still sees TypeScript type annotations". A transform can ask type questions
  only through `printer.EmitResolver`, so each new question means extending
  that interface (`compiler/FORK-SEAM-DESIGN.md:939-1019`).
- [ckpt] Declarations are emitted as `.d.vibe.ts` under the content mapper
  (`compiler/README.md:408-416`). They carry:
  - Result contracts and requirement rows;
  - "**and each exported function's emitted calling convention**", described
    as "a published ABI" (`docs/DECISIONS.md:1239-1243`;
    `specification/compatibility.mdx:579-581`).

  Go module headers declare `runtimeABI: "vibelang-go-eager@1"`. An
  unrepresentable exported capability identity fails publication with
  `VIBE1810` (`compiler/README.md:431-451`). An emitted declaration can
  carry `__vsResumable<A>` (`docs/DECISIONS.md:458-467`).
- [ckpt] Commit: "atomic whole-project emission after all generated artifacts
  validate" (`docs/TYPESCRIPT_FORK.md:55`). For the full pipeline see
  `docs/TYPESCRIPT_FORK.md:136-152`.

### 2.5 Source maps

- [main] None exist yet. `poc/FINDINGS.md:158-160` lists "source maps,
  declarations, and language service support" as P0.
- [ckpt] The printer path drops a mapping silently unless all four gates pass.
  "**every synthesized node emits with no mapping**" unless the transform calls
  `SetSourceMapRange`. Names are unsupported. Generated positions must stay
  monotonic, or the printer panics (`compiler/FORK-SEAM-DESIGN.md:1021-1060`).
- [ckpt] Span maps serve editor fidelity and printer source maps serve emitted
  artifacts. "The two are complementary" (`compiler/README.md:389-406`).
- [ckpt] Limits: "names/scopes are not encoded"; maps are capped at
  1,000,000 UTF-16 units and 16 MiB (`poc/src/language/README.md:941-950`).
  The bundler plugin "MUST … emit a source map for every transformed file",
  which matters more because "Authored code and emitted code now diverge
  structurally wherever a function has a non-empty effect row"
  (`specification/compatibility.mdx:551-556`).

### 2.6 Editor and LSP

- [main] `vibe lsp` returns `NOT_IMPLEMENTED` (`src/cli.ts:127-136`). The
  tsserver plugin is a pass-through, because "TypeScript language-service
  plugins affect editor operations only; they cannot extend parsing, type
  checking, or command-line emit. Those capabilities belong in the Go
  compiler/LSP fork" (`docs/COMPATIBILITY_API.md:52-56`).
- [ckpt] Through the content mapper, "real diagnostics, hover, completion,
  go-to-definition, references, rename, and formatting for `.vibe` cost 0
  changed lines". Showing rows in hover costs about 10-40 lines
  (`compiler/FORK-SEAM-DESIGN.md:1106-1197`). An implemented server,
  `poc/src/language/lsp.ts`, speaks JSON-RPC over stdio and is "driven by the
  real frontend". The end state is a native compiler that "owns … formatting
  and editor queries" (`compiler/GO-MIGRATION.md:616-618`).

---

## 3. Type system (question 2)

### 3.1 Function type and requirement rows

- [main] "A VibeLang function has: an ordinary return type, which is
  `Result<A, E>` when the function can fail; an inferred set `R` of nominal
  capability requirements. Functions MUST remain eager."
  (`specification/type-system.mdx:13-18`)
- [main] **Inference**: `R` comes "from `Capability.context()` calls and
  transitive callees" (`type-system.mdx:26`). The call "MUST return the
  receiving capability's instance type and add that class's nominal identity to
  the enclosing function's inferred `R` row". "Callers MUST NOT pass a context
  argument by hand", and "The implementation MUST NOT expose an untyped service
  locator" (`specification/requirements.mdx:34-40`). Inference is transitive,
  and duplicates collapse (`:44-46`).
- [main] **Declaration**: `R` has no source syntax. "The context row MUST be
  part of the function's static type even though it is not written with
  dedicated function-declaration syntax" (`requirements.mdx:38`). The row is
  preserved in exported declarations, but its encoding is open. "a phantom
  `Context.Function<Fn, R>` representation is a candidate" (`:48`), sketched
  at `src/context.ts:22-27`.
- [main] **Identity**: a capability is an abstract class extending `Context`.
  It is "both the service contract and its nominal context key".
  "Two structurally identical context subclasses MUST remain different
  requirements" (`requirements.mdx:7-21`).
- [ckpt] **Rows on values and subsumption.** "The row MUST be part of the
  function's static type, MUST be preserved in exported declarations, and MUST
  be carried by a function **value** … Assigning a function with a non-empty
  row where a function with a smaller row is expected MUST be a type error. An
  unannotated function type carries the empty row." (`type-system.mdx:50-54`,
  `effects.mdx:96-105`)
- [ckpt] **Static key precondition.** "A reference to a capability's `context`
  member that is not an immediate call on a statically determined `Context`
  subclass MUST be rejected" (`requirements.mdx:38`). Measured hazard: TypeScript
  subtype-reduces a union of structurally identical classes, so
  "`(flag ? Db : Log).context()` recorded `["Db"]` … and the program panicked
  with `capability 'Log' was not provided`". The fix resolves receivers from
  syntax first (`VIBE2106`). Detached `Db.context` references are `VIBE2107`
  (`poc/src/language/README.md:359-393`).
- [ckpt] **Implicit calls charge rows.** "An accessor access is an ordinary
  call": getters, setters, destructuring, and `using`/`await using` disposers
  contribute their requirements (`README.md:667-683`; `requirements.mdx:50-76`).

### 3.2 Result lifting

- [main] Inside a function inferred or declared to return `Result<A, E>`:
  "`return value` MUST produce the success variant; `throw error` MUST produce
  the error variant and exit the function; returning an existing compatible
  Result MUST preserve it without nesting". "Authors MUST NOT need to write
  `Result.ok(...)` or `Result.err(...)`". "A function with no fallible path MUST
  continue to return its ordinary success type" (`specification/failures.mdx:35-45`).
- [main] `E` is inferred "from reachable Error throws, Result propagation,
  returned Results, and foreign boundaries". Non-empty `E` forces the return
  type to `Result<A, E>`, or `Promise<Result<A, E>>` for async functions
  (`type-system.mdx:22-28`). Result composition never nests, and "An ignored
  Result MUST be a compile error" (`:48-54`).
- [main] Propagation is `Result.unwrap()`. "The emitted error path MUST return
  the enclosing error variant rather than throw a recoverable JavaScript
  exception" (`failures.mdx:62-71`). The uncompiled fallback throws, so a
  missed lowering fails visibly (`src/result.ts:181-188`).
- [ckpt] Propagation is postfix `!`, and `.unwrap()` is refused (`VIBE1206`).
  The TypeScript non-null assertion and `x!: T` are removed from `.vibe`
  (`failures.mdx:62-87`, `:210`). `!` is accepted in any expression position.
  It is refused only in three cases, each with its own code (`:89-127`):
  - there is no Result channel;
  - the operand's provenance is not a Result;
  - the `!` sits inside a `try` that has a `catch`.
- [ckpt] An explicit non-Result annotation on a function with a reachable
  recoverable exit is a compile error (`failures.mdx:47`; `type-system.mdx:32`).
- [main] and [ckpt]: VibeLang "MUST NOT add `throws E`, `!T`, or another
  failure-annotation grammar" (`type-system.mdx:44` [main], `:46` [ckpt]).

### 3.3 Generic contracts and higher-order functions

- [main] The specification has no rule. `poc/FINDINGS.md:93-95` names the
  problem: "Fixed-point set propagation is straightforward once call resolution
  exists. The hard work is attaching rows to all TypeScript call shapes and
  preserving them through declarations, generics, callbacks, overloads, and
  module edges." The [main] poc puts "higher-order calls, generic row
  polymorphism" outside its scope (`poc/src/language/README.md:34-37`).
- [ckpt] **Polymorphic row templates.** "A generic function whose declared
  `Result` error mentions its own type parameters is a polymorphic row
  template. Every checker-resolved direct static call instantiates it." Two
  call sites never merge rows (`poc/src/language/README.md:650-666`).
  Fail-closed codes (`:279-300`):
  - `VIBE1802`: a function value escapes direct-call analysis.
  - `VIBE1803`: a row template cannot be instantiated.
  - `VIBE1806`: a callback's explicit contract cannot cover the instantiated
    row.
- [ckpt] **Callbacks.** Rules at `README.md:333-356, 394-410`:
  - `VIBE1303`: an inferred-fallible function crosses a callback boundary
    without an explicit Result contract.
  - `VIBE1404`: an async callback has no recognized owner.
  - The `R` row is now wired through the same value edges, after
    "`xs.map((x) => Db.context().find(x))` published `requirements: []`".
  - Still open: "a closure RETURNED from a function carries its requirement
    invisibly, because the function type has no row to carry".
- [ckpt] Foreign higher-order use: "Any callback passed into foreign code is
  rejected until a VibeLang-owned Result/task adapter defines its invocation and
  lifetime" (`README.md:748-753`). See also `VIBE1508`/`VIBE1509` (`:484-486`).

### 3.4 Recursion

- [main] No specification rule. The poc infers rows to a fixed point over
  direct calls, which handles mutual recursion (`poc/src/language/analyze.ts:319-351`).
- [ckpt] The project API "propagates direct-call Error/Context rows through
  cycles to a fixed point" (`poc/src/language/README.md:66-68`). For the Go
  checker, the seam document points at `pushTypeResolution`/`popTypeResolution`
  as "the checker's built-in fixed-point machinery: precisely what the POC
  re-implemented by hand" (`compiler/FORK-SEAM-DESIGN.md:769-773`).
- Durable Flows only: [main] "Inline recursive Flow expansion is rejected"
  (`docs/DURABLE_EXECUTION.md:109`). [ckpt] withdrew recursion in Flow bodies
  (`docs/DECISIONS.md:52`).

### 3.5 Overloads

- [main] No rule.
- [ckpt] Trust claims bind to the resolved overload. "A trust claim belongs to
  the **resolved signature**, never to the symbol … one marked overload [could]
  certify the unmarked, throwing overload a call actually resolved to." Merged
  property declarations require unanimity (`poc/src/language/README.md:475-483`).
  The specification leaves the rest open: "Exact overload, declaration-merging,
  generic, and multiple-tag rules remain open" (`failures.mdx:250`).

### 3.6 Exported declarations

- [main] "Public, abstract, ambient, and declaration-only contracts MUST express
  fallibility directly with `Result<A, E>` or `Promise<Result<A, E>>`"
  (`failures.mdx:56`). "Public API authors should spell `Result<A, E>` explicitly
  for stability" (`reference/function-channels.mdx:62`). `R` is preserved, but
  its encoding is open (`type-system.mdx:46`). The [main] poc only warned
  (`VIBE1004`/`VIBE1005`, "should pin") (`poc/src/language/analyze.ts:83-105`).
- [ckpt] "Public fallible functions require explicit `Result<A, E>` contracts"
  (`poc/src/language/README.md:684-686`). The declaration encoding "MUST
  additionally carry whether the function is effectful, because a cross-module
  caller cannot lower its call site without that fact" (`type-system.mdx:48`).
  "A cross-package caller that cannot read a callee's calling convention fails
  closed" (`docs/DECISIONS.md:1239-1243`).

---

## 4. Failures (question 3)

### 4.1 Three classes

| Class | [main] | [ckpt] / [site] |
| --- | --- | --- |
| Expected failure | Any named `Error` subclass, with nominal identity supplied by the compiler and no `_tag` (`failures.mdx:23-33`). Lives in `E` of `Result<A, E>`. | Same, plus `class X extends Error` emitted with `interface X extends NominalError<"<stableId>">` and module-qualified row names `Name@module/path` (`poc/src/language/README.md:784-811`). |
| Defect / panic | "`Reflect.panic` is reserved for compiler/runtime invariants and MUST bypass recoverable Result handling" (`failures.mdx:113`). | `panic` from `vibelang:exceptions`, `Reflect.panic`, and invariant failures share one "distinguished panic channel. Ordinary Result recovery MUST NOT swallow panic implicitly" (`failures.mdx:237-252`). "Calling `panic(...)` MUST NOT force a function's return type to widen into `Result<A, Panic>`"; an author MAY annotate `Result<A, Panic>` to materialize one (`:254-262`). Panic "MUST unwind past every handler" (`effects.mdx:47-55`). |
| Foreign exception | "An unknown thrown value MUST be wrapped in `UnhandledException`, which is an `Error` subclass retaining the original cause" (`failures.mdx:109`; class at `src/result.ts:22-30`). Rejections become an error Result (`:123`). | "Calling any TypeScript, JavaScript, or other foreign runtime implementation MUST add the distinguished checked `panic` case by default … includes Promise rejection and a runtime implementation violating its declared signature" (`failures.mdx:239`). The caller must propagate, catch, or adapt (`:241`). `Result.try` does **not** discharge `Panic`: "a panic raised inside a foreign call must not be silently swallowed by an adapter" (`guide/typescript-interop.mdx:71-98`). |

JavaScript `try/catch`: "remains valid where JavaScript interoperability
requires it … its presence MUST NOT change a function's Result contract
implicitly" ([main] `failures.mdx:125-127`).

Cleanup:

- [main] Locks `defer`/`errdefer` (`failures.mdx:129-136`).
- [ckpt] Replaces them with `using`/`await using`
  (`failures.mdx:278-296`) and adds **abandonment**: a declined continuation
  disposes live `using` scopes in reverse order and runs `finally`, but not
  `catch`.

### 4.2 Exhaustiveness and must-use

- "`match` MUST require both success and error branches." "A Result MUST be
  treated as a must-use value" ([main] `failures.mdx:84-86`).
- "For a statically known error union, `error.match({...})` MUST be exhaustive
  and MUST narrow each handler argument to its nominal `Error` subclass."
  Selection uses "compiler-stable nominal identity, not a forgeable user `_tag`
  or minifier-sensitive constructor name" ([main] `failures.mdx:96-105`).
- [ckpt] lowers `error.match` to `instanceof` dispatch. Coverage is "held in a
  side table keyed by resolved class symbol: never in a `TypeFlags` bit"
  (`compiler/README.md:307-323`).
- [ckpt] Must-consume extends to started Promises and to containers. "A
  `return` is a **transfer**, not a discharge" (`poc/src/language/README.md:757-783`).

### 4.3 Diagnostics

- [main] The specification defines no codes. The transport shape is
  `{code, category, message, file, span (UTF-16), phase}` (`compiler/api.go:47-61`).
  The [main] poc codes use superseded syntax (`analyze.ts:47-104, 365-499`):
  - `VIBE1001`: naked failing call.
  - `VIBE1002`: non-exhaustive catch.
  - `VIBE1003`: undeclared failures.
  - `VIBE2001`: `Layer.provide` is missing a capability.
  - `VIBE3xxx`: unsupported control flow.
  - `VIBE4001`/`4002`: ambient host global, and `Module<…>` warning.
- [ckpt] There are stable codes per refusal condition: `VIBE1101/1104/1201/1204/1205/1206`,
  `1251-1254`, `1301/1303`, `1401/1402/1404`, `1502-1511`, `1601-1605`,
  `1703/1717`, `1802/1803/1806/1810`, `2102/2105/2106/2107`, and `6001-6003`
  (`compiler/README.md:358-373`; `poc/src/language/README.md:133-620`).
  Principles:
  - "A rejected `!` MUST be a diagnostic, never a silent lowering"
    (`failures.mdx:125`).
  - Lowered-type messages are "restate[d] … in VibeLang's own vocabulary";
    "every other message is reported verbatim" (`compiler/README.md:379-387`).
  - "The convention MUST NOT be named in a diagnostic" (`effects.mdx:220`).
  - [main] Unsafe extraction "MUST be visually distinct in API naming or
    diagnostics" (`failures.mdx:73`).

---

## 5. Compatibility and foreign boundaries (question 4)

### 5.1 How `.ts`/`.tsx` imports keep their semantics

- [main] "`.ts`, `.tsx`, and JavaScript modules MUST retain their own complete
  syntax and behavior when imported by VibeLang. Shared syntax MUST retain
  TypeScript behavior unless the VibeLang specification explicitly assigns
  different semantics." `.vibe` is not a syntactic superset
  (`specification/compatibility.mdx:7-10`; `docs/DECISIONS.md:23-31`).
- [main] "Imported TypeScript and JavaScript modules retain ordinary Promise
  behavior internally" (`failures.mdx:119`).
- [ckpt] "The VibeLang checker attaches boundary facts when values cross from
  those modules; it does not reinterpret their bodies as `.vibe`"
  (`docs/TYPESCRIPT_FORK.md:197-199`).
- [ckpt] "Imported `.ts` and `.tsx` keep their own configuration. The
  escape-hatch guarantee in this page protects those files, not `.vibe`."
  `.vibe` has mandatory options (`compatibility.mdx:348-373`):
  - `strict`
  - `noUncheckedIndexedAccess`
  - `exactOptionalPropertyTypes`
  - `isolatedModules`
  - `verbatimModuleSyntax`
  - `useDefineForClassFields`

  The three emit-shaping options are applied to checking only, because forcing
  `verbatimModuleSyntax` onto emit "RAN the named module's initializer"
  (`:474-486`).

### 5.2 Classifying foreign calls

**[main]** classifies foreign calls in three ways:

1. Runtime use of a TS/JS value adds the `TypeScript` requirement.
2. "A potentially throwing call MUST also return a Result whose error includes
   `UnhandledException` unless trusted metadata or an adapter supplies a more
   precise Error type" (`type-system.mdx:56-60`).
3. Every dynamic feature is "portable", "valid but contributing the
   `TypeScript` requirement", or "forbidden". `any` and `eval` contribute
   `TypeScript` (`compatibility.mdx:28-38`).

**[ckpt]** classifies foreign calls by provenance and by call shape:

- An unannotated foreign call adds `panic` (§4.1).
- Foreign provenance follows "namespace selection, local aliases, immutable
  object/array storage, methods, and explicitly propagated factory results"
  (`poc/src/language/README.md:731-736`).
- Call-like forms with no call expression need `@throws {never}` (`VIBE1504`,
  `README.md:417-424`):
  - `new Foreign()`;
  - tagged templates;
  - `class X extends Foreign {}`;
  - decorators.
- **Implicit invocation** is one predicate over expression position
  (`VIBE1506`, `README.md:425-457`): `for…of`, spread, `yield*`,
  destructuring, template interpolation, coercing operators,
  `instanceof`/`in`, and computed keys. "enumerating sites is how this class
  kept reopening … asking the position a single question makes the answer
  total over the grammar".
- **Module initialization** is checked separately from calls. A foreign module
  edge needs a leading `@module @throws {never}` JSDoc, matched by the scanner
  and not by substring. The rule covers `import()` too (`VIBE1510`,
  `README.md:552-595`).

### 5.3 What "foreign requirement" means

- [main] The `TypeScript` requirement is the foreign requirement: "Using a
  value from TypeScript or JavaScript code MUST add a runtime requirement
  representing that compatibility boundary. A type-only import MUST NOT add that
  requirement. The built-in requirement is currently named `TypeScript`. The
  requirement MUST propagate through callers like any other requirement"
  (`compatibility.mdx:20-26`). A native pin rejects any transitive `TypeScript`
  requirement and shows the dependency path (`:64-70`). Host modules add an
  exact `Module<"node:fs">` requirement as a Direction (`:46-54`).
- [ckpt] Both are withdrawn. "VibeLang has no `TypeScript` requirement.
  TypeScript is the only target, so every program depends on the JavaScript
  runtime and a requirement recording that fact would carry no information"
  (`compatibility.mdx:28`). "There is no `Module<…>` requirement: measured
  2026-08-28 … the host constraint is carried by the panic channel"
  (`guide/typescript-interop.mdx:24-43`).

### 5.4 How unknown effects are represented

- [main] An unknown failure is `UnhandledException` in `E`. Unknown runtime
  dependence is `TypeScript` in `R`.
- [ckpt] An unknown failure is `Panic`, a distinguished case outside
  recoverable `E` semantics. Unknown or unresolvable code is **refused rather
  than assumed**:
  - "A call whose callee the compiler cannot resolve, and whose callee type
    carries no row, MUST be rejected rather than lowered with an assumed
    convention" (`effects.mdx:105`; `type-system.mdx:54`).
  - `eval`, the `Function` constructor, and `constructor` on a callable are
    `VIBE1604`, because "one `eval` makes a function's failure row and
    requirement row unknowable for every caller above it"
    (`compatibility.mdx:36-49`).
  - Determinism-hostile globals (`WeakRef`, `FinalizationRegistry`,
    `SharedArrayBuffer`, `Atomics`) are `VIBE1605` (`compatibility.mdx:61-84`).

### 5.5 Trusted contracts

- [main] "A trusted adapter MAY map the boundary to a more precise `Error`
  subtype. JSDoc and declaration metadata MAY provide that trusted contract, but
  MUST NOT cause an actual foreign throw to escape the VibeLang Result
  boundary" (`failures.mdx:111`). The adapters are `Result.try` and
  `Result.tryPromise` (`src/result.ts:75-107`).
- [ckpt] "`@throws {never}` removes the default panic case; `@throws {T}`
  declares the stated foreign error channel. These annotations are trust claims
  and MUST remain visible in declarations and tooling" (`failures.mdx:250`).
  The implementation sharpens this (`poc/src/language/README.md:460-483,
  731-736`):
  - `@throws {SomeError}` validates the foreign value and exposes
    `SomeError | Panic`.
  - Several distinct `@throws` tags are refused.
  - `@throws {never}` on an async function is refused, because the function
    "does not throw at the call, it rejects afterwards".
  - The claim binds to the resolved overload.
- [ckpt] Open: the `@module @throws {never}` marker does two jobs (module
  initialization trust, and prelude access control by specifier). "a future
  edit that 'tidies up' the unmarkedness would look like a cleanup and be a
  forgery hole" (`docs/DECISIONS.md:1331-1363`).

### 5.6 Host globals and determinism walls ([ckpt])

- **Allowlist.** "an **allowlist**, not a list of forbidden spellings". 22 of
  38 sibling globals compiled under the earlier denylist; `import.meta` is
  refused as host authority (`poc/src/language/README.md:146-183`).
- **Charge or refuse.** An ambient operation either charges a requirement row
  or is refused. "the ambient spelling is *additionally* refused only where
  the capability has a source-language surface the author could write instead"
  (`compatibility.mdx:61-84`):
  - `Date.now()` is refused with `VIBE1602`, pointing at `Clock.context()`.
  - `Promise.race`/`any` charge `Scheduler`.
  - ICU members charge `Locale`.
- **Uniform walls.** "These walls MUST be uniform across all `.vibe` code and
  MUST NOT be scoped to Flow bodies … a per-file dialect" (`compatibility.mdx:334`).

---

## 6. The checkpoint's one-shot continuation substrate (context for question 7)

On 2026-08-27 VibeLang made one-shot delimited continuations the runtime
primitive: "Typed failures, dependency injection, and durable execution are now
handlers over that one mechanism rather than three separate lowerings. Nothing
an author writes changed" ([ckpt] `docs/DECISIONS.md:24-33`). The mechanism is
private: "Nothing on this page is spellable in `.vibe`"
(`specification/effects.mdx:17-24`).

Normative rules ([ckpt] `specification/effects.mdx`):

- **Requests** have a key, an input, a site identity with an occurrence index,
  and an answer type. There are three kinds (`:26-45`):
  - `get`: MUST resume with the capability.
  - `perform`: resume with an answer, or do not resume.
  - `abort`: MUST NOT resume.
- **One-shot** (`:57-65`):
  - "A continuation MUST be resumable **at most once** … MUST treat a second
    resumption of the same continuation as an invariant failure."
  - Continuations are never reified in source.
  - The representation is a "compiler-owned calling convention".
- **Handlers** (`:67-74`):
  - The innermost handler that accepts the key answers.
  - Other handlers forward the request "outward unchanged".
  - An unhandled request at the top level is a panic.
- **Abandonment** (`:76-86`): "every live `using` and `await using` scope … MUST
  be disposed, in reverse acquisition order, and every `finally` block MUST
  run. `catch` clauses MUST NOT run."
- **Extent is structural** (`:88-94`): the handler holds its environment on
  its own stack, so "no revocation step, promise-settlement observation, or
  host hook is required".
- **Propagation** "is an Abort Request" (`:165-179`). **`Layer.provide`
  installs a handler** (`:181-191`).
- **What the page does not add** (`:213-222`): no `Effect<A, E, R>` value, no
  `Result.gen`, no `.run()`, and no user-visible fiber. An authored
  `function*` "MUST NOT declare or infer a non-empty effect row".

Implementation ([ckpt] `poc/src/runtime/effect.ts`), generator-based:

```text
handler method   driver call   body sees         catch     finally/using
resume(a)        next(a)       the answer        -         -
raise(e)         throw(e)      a throw at site   runs      runs
abandon(r)       return()      nothing           skipped   runs
```

(`effect.ts:122-160`.)

- A `RESUMPTION_MATRIX` covers request kind × resume/raise/abandon. It is
  typed so that a missing cell fails to compile (`:306-365`).
- `OneShotContinuation` panics on a second take, and also on a stashed
  continuation used "after `answer` returns" (`:367-419`).
- `unwind()` loops `gen.return()` because "a `yield` inside a `finally` block
  honours the yield first and leaves the generator suspended". During cleanup
  it answers capability reads and fails closed on other requests (`:262-297`).
- Panics are never offered to a handler and never raised inward
  (`:381-388`, `:480-487`).

Defects found in this substrate and fixed on 2026-08-28 are useful
regressions (`effects.mdx:132-161`):

- the failure key could be forged through `error.constructor`;
- a handler could answer `abort` with `raise` and swallow a declared failure;
- recovery depended on handler nesting depth.

Self-declared gaps:

- "cross-function async effect delegation and the durable body calling
  convention are still being integrated" (`effect.ts:18-20`);
- `AsyncLocalStorage` remains a compatibility bridge for eager calls
  (`requirements.mdx:154-159`);
- cleanup-completion precedence is undecided (`effects.mdx:128-130`).

Measured costs of keeping this convention private behind eager calls:

- **Per-call-site convention choice.** Each call site chooses `yield* f()` or
  `f()` from the callee's published row (`docs/DECISIONS.md:280-329`). A
  `.d.ts` exemption caused a fail-open (`:321-328`).
- **Bundler blast radius.** Transform-only bundling fails closed on 21.5% of
  call sites in multi-module programs (`docs/DECISIONS.md:1293-1317`).
- **ABI.** The published `.d.ts` becomes an ABI (`:450-477`).

---

## 7. `docs/DECISIONS.md` (question 5)

### 7.1 Every decision on [main] (139: 101 Locked, 25 Direction, 13 Open)

`Not stated` means neither the ledger nor the [main] specification pages state a reason.
"L" is the line in [main] `docs/DECISIONS.md`.

**Identity and compatibility**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 19 | Locked | Name is VibeLang | Not stated |
| 20 | Locked | Source extension `.vibe` | Not stated |
| 21 | Open | JSX extension unconfirmed; `.vibex` must not imply a sounder mode | Avoid a stricter dialect chosen by extension (stated) |
| 23 | Locked | Not a syntactic superset; TS-derived grammar with deliberate differences | "deliberate, important differences such as failure handling and expression control flow" |
| 26 | Locked | Import TS/JS directly; they keep their own syntax and semantics | They are "interoperability inputs, not source that must parse as `.vibe`" |
| 29 | Locked | Shared syntax keeps TS behavior unless a divergence is documented | "does not make gratuitous syntax changes" |
| 32 | Locked | Incremental precision, no globally sound type system; escape hatches remain | Adoption is incremental (`introduction/philosophy.mdx:7-9`) |

**Function model**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 38 | Locked | Eager functions; no `Effect<A, E, R>` value, interpreter, or `.run()` | Avoid "a second execution vocabulary" (`introduction/why-vibelang.mdx:30`); "eager call with an ordinary stack" (`philosophy.mdx:23`) |
| 40 | Locked | Fallible returns `Result<A, E>`; async returns `Promise<Result<A, E>>` | Failure is "the ordinary return value, not an erased side channel" |
| 44 | Locked | `return` gives success, `throw` gives error; no `Result.ok/err` | Ordinary `return`/`throw` already construct the variants |
| 47 | Locked | Infer `E` and `R` transitively; `Result` is the explicit public failure contract | Not stated |
| 51 | Locked | No Effect-style fiber runtime | Prefer TC39 concurrency work over a fiber abstraction (L255) |
| 52 | Direction | Native target: Go-like GC runtime; TS target lowers to TS/JS | Not stated |

**Typed failures**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 57 | Locked | Any `Error` subclass is a nominal recoverable error; no `TaggedError` | Keep normal `Error` behavior; compiler supplies identity |
| 61 | Locked | Built-in `Result` with Better Result-inspired methods, minus `ok`/`err` | `return`/`throw` construct the variants |
| 65 | Locked | `Result.unwrap()` is the propagation spelling | An ordinary call rather than new grammar (stated as "ordinary-call spelling") |
| 68 | Locked | Results are must-use; discarding is a compile error | Not stated |
| 71 | Locked | `Error.prototype` gets `is/matches/match/matchPartial/rootCause`; exhaustive `match` | Nominal keys, not a forgeable `_tag` (`failures.mdx:105`) |
| 75 | Locked | No `throws`, prefix `try`, postfix `catch`, `!T`, or panic-catch grammar | Not stated |
| 79 | Locked | Unannotated functions infer `Result<A, E>`; public contracts spell it | "a public signature is a contract" (`philosophy.mdx:39`) |
| 83 | Locked | Foreign throws and rejections become `UnhandledException` unless an adapter maps them | Avoid "an untyped rejection escaping the declared return contract" (`failures.mdx:123`) |
| 86 | Locked | `Reflect.panic` is the non-recoverable defect | Reserved for compiler and runtime invariants (`failures.mdx:113`) |
| 88 | Locked | `defer` and `errdefer` supported | Not stated |

**Optionals and nullability**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 92 | Locked | Built-in `Optional<T>` with Result-like methods | Not stated |
| 95 | Locked | `return value` → present; `return null/undefined` → absent | Not stated |
| 98 | Locked | Generic and method syntax; `?T`, payload capture, `orelse`, `.?` removed | Not stated |
| 102 | Locked | Absence and failure are separate | Not stated |
| 103 | Locked | TS `undefined`, optional params, and optional properties keep working | TypeScript compatibility (stated) |
| 105 | Open | `Optional<T>` ↔ `T \| null \| undefined` conversions | Not stated |

**Requirements and dependency injection**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 110 | Locked | Capability = abstract class extending `Context`; class is contract and key | "Effect-inspired model with less generic ceremony" |
| 113 | Locked | `Capability.context()` is compiler-recognized and adds to the row | "no `uses` source-language grammar is needed" |
| 116 | Locked | Context is part of the static type, not a hand-passed argument | Not stated |
| 118 | Locked | Requirements propagate by inference | Not stated |
| 119 | Locked | Provider composition from `vibelang/provider`, no `provide {}` | Not stated |
| 121 | Locked | Effect-like layers create and provide implementations | Not stated |
| 123 | Direction | `Layer<Provides, Error, Requires>` | A layer carries what it provides, how construction fails, and what construction needs (stated) |
| 125 | Open | Layer acquisition, memoization, scoping, override, disposal | Not stated |
| 127 | Open | Does a provided Layer own an implicit structured lifetime (join/cancel children)? | Recorded as the current recommendation |
| 132 | Open | Declaration encoding and JS lowering of the row (phantom, hidden params, ambient) | Must not change source calls (stated) |

**Imports and platform dependencies**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 138 | Locked | JSON const import gives a deeply readonly literal type | No handwritten declaration or schema |
| 141 | Locked | Non-code imports use import attributes to pick the loader | No second import grammar |
| 146 | Locked | Built-in Markdown and MDX loaders | Libraries supply vocabularies, for example agent prompts |
| 149 | Locked | User-defined comptime loaders | Users do not duplicate result types |
| 152 | Direction | File imports are incremental build nodes with content keys | Not stated |
| 155 | Open | Loader registration API; Markdown/MDX module shapes | Not stated |
| 157 | Locked | Platform functionality is always a typed requirement | "Portability and testability become the same feature" (`philosophy.mdx:48-58`) |
| 159 | Locked | No ambient `process`/`window`/`document`/fs/network | Same |
| 162 | Locked | Only universal facilities are ambient; clock and random still need capabilities | Host-sensitive (stated) |
| 165 | Locked | Using a TS/JS value is a dependency; type-only imports are not | Represents "that compatibility boundary" (`compatibility.mdx:22`) |
| 167 | Direction | Exact `Module<"node:fs">` requirement | "a provider or target may satisfy one host contract without satisfying another" (`compatibility.mdx:54`) |
| 169 | Locked | Capability implementations vary by target (Node, Bun, Deno, native, WASI, test) | Not stated |
| 172 | Locked | Zig/Rust via generated typed Wasm/native bindings | Bun as inspiration |
| 175 | Direction | Reuse C/Zig/Rust/Bun/Deno/libuv behind providers | "where technically and legally suitable" |

**TypeScript and native classification**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 180 | Locked | TS target accepts complete TS in imported modules | Not stated |
| 183 | Locked | Near-native target through LLVM; should support Wasm | Not stated |
| 185 | Locked | Features are portable, `TypeScript`-required, or forbidden | Not stated |
| 189 | Locked | `TypeScript` requirement propagates transitively | Not stated |
| 191 | Locked | Native pin is a checked assertion with dependency-path diagnostics | Not stated |
| 194 | Locked | `any` adds `TypeScript` instead of being forbidden | TypeScript compatibility; lint may still discourage |
| 196 | Locked | `eval` usable but adds `TypeScript` | Not stated |
| 197 | Direction | Ordinary classes portable; prototype mutation is `TypeScript` or forbidden | Not stated |
| 200 | Locked | No arbitrary dynamic import in native code at first | Not stated |
| 203 | Direction | VibeLang owns a native GC runtime | Not stated |
| 206 | Open | Per-feature classification table (Proxy, descriptors, weak refs, thenables) | Not stated |
| 209 | Open | Type assertion semantics | Not stated |
| 213 | Open | Native pin spelling | Not stated |

**Comptime and runtime validation**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 217 | Locked | Comptime follows Zig: automatic when possible, intrinsic to force | Not stated |
| 220 | Locked | `comptime` imported from `vibelang:comptime`; recognized by resolved binding | "aliases work and unrelated functions named `comptime` remain ordinary" |
| 224 | Locked | `comptime(value)` evaluates; `comptime(fn)` marks without invoking | Not stated |
| 227 | Locked | Compiler-owned virtual module; uncompiled load fails | Instead of "evaluating arguments at runtime" |
| 230 | Locked | Comptime may generate types | Not stated |
| 231 | Locked | Comptime I/O only through compiler-known imports | Hermetic, reproducible builds (`philosophy.mdx:60-64`) |
| 234 | Locked | No `runtime type` modifier | Not stated |
| 235 | Locked | Validators, codecs, and schemas derived at comptime from ordinary types | Not stated |
| 237 | Locked | External data `unknown` until validated (best practice) | Not stated |

**Expression-oriented language**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 242 | Locked | Blocks, `if`, `switch`, `while`, and `for` can be expressions | Not stated |
| 243 | Locked | Switch keeps `case`; the final expression is its value | Not stated |
| 245 | Locked | Stay close to TS; borrow from Zig only where TS has no form | Stated |
| 247 | Direction | Labeled `break` values and loop `else` | Not stated |
| 248 | Locked | Declarations in conditionals adopted early from TC39 | Not stated |
| 249 | Locked | No throw-expression grammar at first | Wait for the TC39 proposal upstream |

**Concurrency**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 255 | Locked | Prefer TC39 concurrency work over a fiber abstraction | Stated |
| 257 | Locked | Follow TC39 module expressions, shared structs, governors, cancellation | A governor limits fan-out and does not own lifetimes |
| 260 | Direction | Structured typed joins (`await.all`) own, cancel, and wait for children | Not stated |
| 264 | Locked | Cancellation in typed failures, provided by the dependency model | Not stated |
| 266 | Locked | Promises consumed only with `await`; `.then/.catch/.finally` are errors | Not stated |
| 270 | Locked | `await` yields the Result and never unwraps it | Not stated |
| 272 | Direction | Promise behavior that blocks native compilation may need `TypeScript` | Not stated |

**Durable execution**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 278 | Locked | Durable execution is a language feature | Not stated |
| 280 | Locked | Supersedes the earlier standalone flows library | That library is prior art |
| 283 | Locked | Action = abstract op with a replaceable provider and a closed signature | Not stated |
| 285 | Locked | Action implementation is an ordinary function; no Effect wrapper | Not stated |
| 288 | Locked | Action I/O, failures, and requirements come from its signature; codecs derived | Source never repeats types as schema arguments |
| 291 | Locked | `durable` imported from `vibelang:flows`; resolved binding | Not stated |
| 294 | Locked | `durable(...)` becomes a Flow descriptor over Plan IR | Not a runtime callback wrapper |
| 298 | Locked | A Flow is a statically analyzable plan template | Not stated |
| 301 | Locked | No proxy evaluation; `Action.run` lowers to plan node | Not stated |
| 305 | Locked | Source function disappears after emission | Plan/preview runs no implementation |
| 309 | Locked | Four phases: template, deployment build, plan/preview, execution | Not stated |
| 312 | Locked | Runtime-dependent control flow only when explicit in Plan IR | Not stated |
| 315 | Locked | Actions/Flows run across processes and machines | Not stated |
| 318 | Direction | Placement belongs to provider/deployment layers | Not stated |
| 321 | Direction | Lifecycle, retries, timers, journal, idempotency, fencing, compensation | Not stated |
| 324 | Direction | Cross-machine values need compiler-checked codecs | Not stated |
| 326 | Direction | Journal atomic with runtime state only; external safety needs destination help | Stated |
| 330 | Locked | Sealing and compensation are not exactly-once | Stated |
| 333 | Direction | Recovery safety and cache eligibility are separate | Not stated |
| 336 | Locked | Every resolved node adopted into run-local state first | Restart independent of cache entries (stated) |
| 340 | Locked | Memoization differs from deterministic content caching | Stated |
| 345 | Direction | Four distinct identity keys | Not stated |
| 349 | Direction | Eviction affects performance only; memo expiry opens a new generation | Not stated |
| 352 | Open | Loops, fan-out, IDs, wire format, migration, sequencing | Not stated |

**Asset-backed prompts and agents**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 358 | Locked | MDX prompts are library APIs, not syntax | Not stated |
| 361 | Locked | Standard agent writes TypeScript each turn | Not stated |
| 364 | Locked | Generated code calls only explicitly passed functions | Not stated |
| 367 | Locked | Agent and sandbox are library-level | Not stated |
| 371 | Direction | Small composable agent primitives | Not stated |
| 375 | Direction | Wrap model calls in Actions/Flows | Not stated |
| 379 | Open | Agent APIs and sandbox backends | Not stated |

**Standard library**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 384 | Locked | Match or exceed Effect's stdlib breadth with ordinary APIs | Not stated |
| 386 | Locked | Platform is a universal dependency | Not stated |
| 388 | Direction | Wasm/Zig for compute-heavy parts | Chosen by measurement, not ideology |
| 391 | Direction | Schema, streams, schedules, and more "without copying Effect's wrapper/combinator ceremony" | Stated |

**TC39 policy**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 398 | Locked | Adopt listed TC39 proposals early | Not stated |
| 405 | Locked | Capabilities subsume AsyncContext | Not stated |
| 407 | Locked | VibeLang owns expression control-flow grammar | Not stated |
| 409 | Locked | Forked platform declarations audited for failures, defects, requirements | Not stated |
| 411 | Locked | Standing rejections (Block Params, Record & Tuple, eventual send, others) | Not stated |
| 415 | Direction | Shared structs later | Lower-risk features first |

**Compiler and delivery**

| L | Status | Decision | Rationale |
| --- | --- | --- | --- |
| 420 | Locked | Build on the Go compiler under `tsc/`; minimal diff | Internal packages need in-module code (`TYPESCRIPT_FORK.md:15-19`); the TS 7 preview "has no JavaScript compiler API" (`poc/FINDINGS.md:14-17`) |
| 422 | Locked | Canonical fork `smithersai/TypeScript`; squashed subtree; pinned manifest | Source in every checkout without a network dependency (`TYPESCRIPT_FORK.md:3-6`) |
| 425 | Locked | Narrow plugin interface, not features spread through upstream | Not stated |
| 428 | Locked | Lower to TS before the stock pipeline checks and emits | Not stated |
| 431 | Direction | Content mappers for early prototype and editor; shared IR for LLVM/Wasm | Not stated |
| 433 | Open | Exact seams and plugin ABI need an upstream audit | Not stated |
| 435 | Locked | Go-style batteries-included toolchain | Not stated |
| 438 | Direction | Loaders and assets in a content-addressed incremental graph | Not stated |
| 442 | Direction | Compiler grows into a Bazel-like build machine | Not stated |
| 447 | Open | Build graph, rule contract, remote cache, TS incremental seams | Not stated |

`docs/DECISIONS.md:451-469` lists nine "Immediate unresolved design work"
items:

1. dynamic-feature classification;
2. `as` semantics;
3. `Optional` interop;
4. the Layer child-work rule and lowering;
5. durable questions;
6. the shared Plan/expression IR mapped onto compiler seams;
7. loader API;
8. the agent library;
9. the build graph.

### 7.2 What the [ckpt] ledger changes (about 180 entries plus three pending blocks)

These items matter to EffectScript. Lines are in [ckpt] `docs/DECISIONS.md`.

- **Reduction, 2026-08-23** (`:17-23`):
  - one grammar form;
  - postfix `!` replaces `.unwrap()`;
  - `Optional<T>` withdrawn;
  - TypeScript is the only target;
  - LLVM/Wasm, the `TypeScript` requirement, classification, and the pin
    withdrawn (`:739-755`).

  Grammar policy: "A future grammar addition requires an active TC39
  proposal" (`:891-894`).
- **Continuations, 2026-08-27** (`:24-33`, `:248-329`): authored functions stay
  eager. A function with a non-empty row "may [be] emit[ted] … in a
  **resumable calling convention**". Rows live on function values. "A function
  whose row is empty is never emitted in the resumable calling convention."
  PR-1 to PR-3 (durable manifest, journal key, version divergence) are marked
  pending ratification (`:70-187`). The withdrawn sentences are kept in an
  amendment record (`:1387-1464`).
- **Failures** (`:330-554`):
  - postfix `!`, plus a three-condition rule for reinterpreting TypeScript
    syntax (`:361-366`);
  - the `panic` channel, `@throws` trust, and "panic does not widen";
  - `defer` replaced by `using`;
  - Open: an error-extraction form (`:378-383`).
- **Requirements** (`:571-662`):
  - Base Layers are exactly `Layer<Provides>`: "dependency environments, not
    task supervisors or implicit resource managers".
  - Fire-and-forget is unavailable, and every started Promise must be
    consumed.
  - Open: R1 subclass substitution at a capability receiver (`:630-661`).
- **Owner decisions, 2026-09-06**:
  - durable execution "works exactly like Smithers 1.0" (static keyed Plans)
    (`:38-67`);
  - "the Go compiler is the only compiler" (`:1217-1227`);
  - `eval` refused (`:759-765`).
- **Delivery** (`:1239-1317`):
  - `.d.ts` carries the calling convention;
  - mandatory `.vibe` compiler options;
  - unplugin delivery;
  - measured transform-only blast radius.

---

## 8. `poc/src/language/README.md` (question 6)

### 8.1 [main] version (45 lines): a superseded risk spike

**What it implements** (`poc/src/language/README.md:17-28`):

- "token-aware recognition of `error`, `!T`, `throws`, named `uses`, `try`, and
  typed catch expressions";
- "fixed-point failure/requirement inference over direct function calls";
- "exported-row checks, naked-failing-call checks, exhaustive catch checks, and
  syntactic `Layer.provide` closure checks";
- "branded failure classes and sync/async failure-only catch behavior";
- "nominal layers with nested override and `AsyncLocalStorage` scoping";
- "simple `?T`, `orelse`, `.?`, throw expressions, and expression-arm `if`";
- "the locked `any`/`eval` => `TypeScript` classification and rejection of
  ambient host globals".

**Rejected with diagnostics** (`:30-32`): payload-capturing optionals, compound
optional types, block/switch/loop expressions, `defer`, and `errdefer`. "Those
need typed control-flow IR rather than another source rewrite."

**Stated limits** (`:34-45`):

- "The analyzer is syntactic: aliases, methods, higher-order calls, generic row
  polymorphism, layer acquisition failures, source maps, and editor integration
  are outside this spike."
- The next step is to replace call resolution "with the real TypeScript
  checker while preserving the row fixed point".
- "This is a regression fence, not a parser claim: overloads,
  destructured/shadowed bindings, nested lexical scopes, cross-module symbols,
  generic calls, and full expression precedence remain illustrative".

**Its parent README adds** (`poc/README.md:39-72`):

- "This is not a fork or plugin for the Go compiler."
- "`Layer` proves overlapping async lookup scopes, not resource lifetime".
- The suite passes 56 tests.

**Verdict: superseded.** Line 7 calls it "the current-spec demo", but its
syntax was current only before `c60eca97`. [main]'s locked spec now forbids
`throws`, `!T`, `try`, and postfix `catch` (`failures.mdx:58`;
`DECISIONS.md:75-78`) and removes `?T`/`orelse`/`.?` (`type-system.mdx:95`).
Its runtime contradicts [main]'s execution rule:

- typed failures are thrown as branded exceptions and caught by
  `catchFailure` (`poc/src/runtime/failure.ts:56-69`);
- `Promise<A, E>` is accepted with `E` erased (`language.test.ts:64-73`).

The spec requires the error path to "return the enclosing error variant rather
than throw" (`failures.mdx:71`) and forbids "a second Promise type parameter"
(`:19`). `prototype/` is older still: `prototype/NOTES.md:6-10` says "This is
a historical syntax experiment, not the current design".

### 8.2 [ckpt] version (953 lines): the "Checked `.vibe` frontend POC"

It is current for the checkpoint language (`Result`, postfix `!`, `Context`,
`panic`). Its own words: "Public source/project analysis and compilation …
use the pinned native Go compiler … there is no TypeScript 5.9
compiler-library dependency or fallback" (`:1-12`).

**What it proves** (`:643-893`):

- cross-module fixed-point rows through checker symbol identity;
- polymorphic row templates;
- accessors treated as calls;
- `panic` does not widen;
- foreign provenance and `@throws` trust;
- module-initialization trust;
- must-consume transfers;
- module-qualified nominal identities;
- type-only nominal Error branding;
- declarations in conditionals by block rewrite (`VIBE1717`);
- source maps with explicit unmapped glue.

Retired syntax (`error`, `throws`, `uses`, `!T`, `?T`, `try`, postfix `catch`,
`orelse`, `.unwrap()`, `defer`, and more) gets the migration diagnostics
`VIBE1001`/`VIBE1000` (`:867-893`).

**Stated gaps** (`:895-953`):

- "This is still a POC, not a sound whole-program compiler".
- in-memory APIs only; no tsconfig paths or package resolution for `.vibe`;
  "editor integration, and an incremental graph remain future work";
- `@vibelangEffects` is "a strict versioned POC carrier";
- cross-module propagation covers only direct static calls; "Higher-order
  function escapes stay diagnostics";
- foreign provenance is "bounded declaration/data flow, not arbitrary heap
  taint";
- "Layer acquisition failures, opaque/generic layers, scoped ownership, and
  general cross-module provider graphs are not modeled";
- source maps do not encode names or scopes.

The ledger separately states the alpha-0 goal "is not complete"
(`compiler/GO-MIGRATION.md:75`).

---

## 9. Borrow / Adapt / Do not inherit (question 7)

EffectScript premises:

- Effect fibers with one-shot delimited continuations;
- every function participates in one computation model;
- explicit contracts `Effect<A, E, R>`;
- `throw` contributes to `E`;
- DI through Effect `Context` and `Layer`.

| Verdict | VibeLang idea | Source | EffectScript action |
| --- | --- | --- | --- |
| **Borrow** | Fork the Go compiler under `microsoft/TypeScript` `tsc/`, pinned by full SHA; add fork-owned code under `tsc/cmd/` via `go build -overlay`; carry upstream edits as an ordered, digest-gated patch series; vendor an offline capsule | [ckpt] `docs/TYPESCRIPT_FORK.md:60-113`; `compiler/fork.go:309-333`; `compiler/GRAMMAR-SPIKE.md:646-667` | Copy the mechanics. Start at zero changed upstream lines. Treat a pin update as a reviewed migration with pristine and patched health gates (`TYPESCRIPT_FORK.md:215-247`) |
| **Borrow** | Content mapper plus spanmap as the first hosting seam for a new extension: check, diagnostics, and about 26 LSP features at 0 changed lines | [ckpt] `compiler/FORK-SEAM-DESIGN.md:53-61, 218-302, 1106-1166` | Ship `check` and LSP on this path first. Plan the five-site emit fix (`:1062-1102`). First-class extension status is a one-way door (`:1294-1330`) |
| **Borrow** | Keep row inference state beside the type system (`Signature` fields or `LinkStore`) with the checker's own cycle machinery; never a `TypeFlags` bit | [ckpt] `FORK-SEAM-DESIGN.md:736-933, 1454-1461` | Use for inferring `E`/`R` of unannotated bodies. Render the result into `Effect<A, E, R>` (see Adapt) |
| **Borrow** | Lowering inserted before `TypeEraserTransformer`; type questions through an extended `printer.EmitResolver`; source-map gates (`SetSourceMapRange` per node, monotonic output, no names) | [ckpt] `FORK-SEAM-DESIGN.md:937-1060` | Same insertion point. Budget for map fidelity, since every computation's emitted shape diverges from source |
| **Borrow** | Recognize intrinsics by resolved symbol identity and an exact specifier registry; never by spelling or prefix | [ckpt] `compiler/README.md:239-244`; `poc/src/language/README.md:816-819`; `docs/DECISIONS.md:1331-1341` | Apply to `Effect`, `Context` service classes, `Layer`, and EffectScript intrinsics |
| **Borrow** | One-shot rules: at most once; a second resumption is an invariant failure; a stale continuation fails; abandonment runs `finally` and disposal but not `catch`; innermost accepting handler; forward unchanged; unhandled request panics | [ckpt] `specification/effects.mdx:57-94` | Adopt as EffectScript conformance tests on Effect fibers |
| **Borrow** | Resumption matrix typed so a missing kind × decision cell fails to compile; `gen.return()` loop that survives `yield` in `finally`; panics never raised into a suspended body | [ckpt] `poc/src/runtime/effect.ts:262-419` | Use the matrix shape for EffectScript's operation kinds. Test the `finally` behavior against Effect 4's generator driver, which the EffectScript brief records as dropping the iterator without `return()` (unconfirmed) |
| **Borrow** | Panic/defect is never offered to a handler and never swallowed by typed recovery; `panic` does not widen the success contract | [ckpt] `effects.mdx:47-55`; `failures.mdx:252-262` | Maps directly onto `Cause.die` versus `Cause.fail` and interruption |
| **Borrow** | Reject an unresolvable callee whose type carries no row, instead of assuming a convention | [ckpt] `effects.mdx:105`; `type-system.mdx:54` | Same rule for calls whose computation contract is unknown |
| **Borrow** | Foreign provenance and one implicit-invocation predicate over expression position (iteration, spread, coercion, templates, destructuring, `instanceof`/`in`, computed keys) | [ckpt] `poc/src/language/README.md:425-457, 731-753` | Every such site is a possible foreign throw, so it is a defect site in EffectScript |
| **Borrow** | Trust claims bind to the resolved signature; merged properties need unanimity; refuse conflicting tags and sync-only claims on async functions; module-initialization trust is separate from call trust and covers `import()` | [ckpt] `README.md:460-483, 552-595`; `docs/DECISIONS.md:1331-1363` | Same discipline for whatever marks a TS function as total or non-throwing |
| **Borrow** | Resolve service receivers syntactically before the checker type, because TS subtype reduction merged structurally identical classes; refuse detached and computed-key access | [ckpt] `README.md:359-393, 503-517` | Check whether union reduction hits structurally identical `Context.Service` classes; VibeLang measured a run-time panic from it |
| **Borrow** | Mandatory soundness options for the new extension; deprecated options rejected with codes; emit-shaping options kept off the emit Program | [ckpt] `specification/compatibility.mdx:348-524` | Same, scoped to EffectScript sources |
| **Borrow** | Evidence discipline: corpus with expected JSON, differential backends, `(SA-n)`/`(IA-n)` gap markers, mutation-proved trap tests, fail-open audits | [ckpt] `specification/index.mdx:56-93`; `GRAMMAR-SPIKE.md` §7.5 | Use from the first commit |
| **Borrow** | New syntax only with an active TC39 proposal; cleanup through `using` | [ckpt] `specification/control-flow.mdx:39-65`; `docs/DECISIONS.md:885-894` | Matches EffectScript's "new syntax must earn its place" |
| **Adapt** | Fixed-point inference of `(E, R)` over checker-resolved calls; rows on function values; subsumption | [ckpt] `type-system.mdx:50-54`; `README.md:645-666` | Render rows as `Effect<A, E, R>` in types, so TS-authored Effect code consumes them directly |
| **Adapt** | `return`/`throw` lifting | [main] `failures.mdx:35-45` | `throw` adds to `E` as a typed failure; `return` is success. No Result value and no propagation operator |
| **Adapt** | Capability = nominal class; `X.context()` adds `X` to `R`; no untyped locator | [main] `requirements.mdx:7-48` | Use Effect service classes (`Context.Service`). A call to a service method adds that service |
| **Adapt** | Generic row templates and fail-closed codes (`VIBE1802/1803/1806`) | [ckpt] `README.md:279-300, 650-666` | With `Effect<A, E, R>` in function types, TS generics carry `E`/`R`. Keep the fail-closed refusals where the checker cannot resolve a row variable |
| **Adapt** | Callback boundary rules (`VIBE1303`, `VIBE1404`, `R` through value edges; callbacks into foreign code refused) | [ckpt] `README.md:333-356, 394-410, 748-753` | A computation passed to a non-Effect higher-order function (`Array.prototype.map`) needs a rule: refuse it, or route it to Effect combinators |
| **Adapt** | Foreign throws enter a distinguished `panic` case in the failure row; `@throws` trust removes or narrows it | [ckpt] `failures.mdx:237-252` | Effect defects live in `Cause`, not `E`. Track "may die" as a separate static fact, and make trusted narrowing explicit |
| **Adapt** | Charge determinism-sensitive ambient operations as requirements, or refuse them where a capability exists | [ckpt] `compatibility.mdx:51-84` | Effect provides `Clock` and `Random` as default services. Decide whether ambient `Date.now()` is refused in favor of `Clock` |
| **Adapt** | Declarations carry the calling convention and an "effectful" bit separate from rows; unreadable conventions fail closed | [ckpt] `type-system.mdx:48`; `compatibility.mdx:579-581` | EffectScript's settled decision 4 (empty `E`/`R` proves nothing) requires a separate convention fact if any function is emitted without the computation wrapper |
| **Adapt** | Must-consume for Results and started Promises; `return` is a transfer | [ckpt] `README.md:757-783` | The analog is a constructed Effect value that is never run, returned, or composed |
| **Adapt** | Transform-only bundling fails closed when convention needs whole-program facts | [ckpt] `compatibility.mdx:558-573` | Make the convention decidable from the import (EffectScript module versus foreign), so per-file transforms stay valid |
| **Do not inherit** | Eager functions; failures as `Result<A, E>` values; no `Effect` value, no `.run()` | [main] `DECISIONS.md:38-46`; [ckpt] `effects.mdx:218` | EffectScript programs are cold Effect values that can be stored, retried, and composed |
| **Do not inherit** | Two calling conventions (plain versus resumable generator) chosen per call site, with "empty row ⇒ plain" | [ckpt] `effects.mdx:102-105`; `DECISIONS.md:280-329` | Contradicts EffectScript decision 4. It also creates the `.d.ts` ABI and bundler blast radius VibeLang measured |
| **Do not inherit** | A private handler loop and deterministic scheduler beside the host, plus an `AsyncLocalStorage` bridge for eager calls | [ckpt] `effect.ts:15-41`; `requirements.mdx:154-159` | Continuations must run on Effect's fiber runtime: scheduler, interruption, Context, Scope |
| **Do not inherit** | `Layer<Provides>` with no acquisition, failure, lifetime, or child-work ownership | [ckpt] `requirements.mdx:92-120`; `DECISIONS.md:584-593` | EffectScript decision 5 needs acquisition failures, scoped sharing and release, and residual requirements |
| **Do not inherit** | Cancellation as "the handler declines to resume"; no fibers; fire-and-forget banned; Promise-only `await` concurrency | [ckpt] `DECISIONS.md:609-618, 896-938` | Use Effect interruption, `forkChild`/`forkIn`, and Scope |
| **Do not inherit** | Postfix `!` (reinterpreted non-null assertion) and `.unwrap()` propagation | [ckpt] `failures.mdx:62-87`; [main] `failures.mdx:60-73` | EffectScript calls expose success values without markers |
| **Do not inherit** | `Panic` materialized into `Result<A, Panic>` | [ckpt] `failures.mdx:254-262` | Defects stay in `Cause` |
| **Do not inherit** | Durable execution designs (replay through handlers, then static Plans) | [ckpt] `effects.mdx:7-15`; `DECISIONS.md:35-67` | Out of scope; VibeLang reversed course twice in ten days |
| **Do not inherit** | A second semantic core on the TS 5.9 JavaScript API | [ckpt] `DECISIONS.md:1217-1227` ("an unapproved shortcut, not a product path") | Build in Go from the first line |
| **Do not inherit** | Token/regex lowering (`prototype/`, [main] `poc/`) | [main] `poc/src/language/README.md:39-45`; `poc/FINDINGS.md:18-21` | Not a foundation; own the parser path |
| **Do not inherit** | `Optional<T>`; native/LLVM/Wasm targets; the `TypeScript` requirement and native pin | [main] `type-system.mdx:76-99`; `compatibility.mdx:56-70` | VibeLang itself withdrew all of these ([ckpt] `DECISIONS.md:555-570, 741-755`) |

---

## 10. Position and next action

VibeLang's checkpoint reached the same foundation EffectScript is told to start
from: one-shot delimited continuations as the single runtime primitive. It
paid for keeping that primitive private behind eager functions:

- two calling conventions;
- a convention ABI in `.d.ts`;
- a fifth of call sites refusing per-file transforms;
- an `AsyncLocalStorage` bridge;
- an unfinished async delegation path.

**Position (falsifiable).** EffectScript should copy VibeLang's compiler path
through Stage 3 (overlay entry point, content mapper with checker-backed
inference, single-Program emit with span-aware maps). It should also copy
VibeLang's one-shot and abandonment rules as tests. It should copy none of
VibeLang's lowering. The position is wrong if an EffectScript prototype cannot
pass VibeLang's abandonment vectors on Effect 4 fibers with a single emitted
convention (every function returns an Effect). In that case a second
convention, and VibeLang's ABI machinery, becomes necessary.

**Next action.** Port `specification/effects.mdx` §One-Shot, §Handlers, and
§Abandonment plus the `effect.ts` `RESUMPTION_MATRIX` cases into an
`experiments/` test that drives an Effect 4 fiber over a generator body.
Measure whether `finally` and `using` run on typed failure, defect, and
interruption.

## Appendix: evidence gaps

- I did not run VibeLang's suites. All measured claims tagged [ckpt] are
  VibeLang's own records.
- The bookmark name "pre-withdrawal" matches commit `a43dcbea1f21` ("checkpoint
  the POC before the specification withdrawal"). No document states why the
  later work was never merged into `main`.
- vibelang.sh is pinned to `144d1034` by text comparison of three passages, not
  by deployment metadata.
