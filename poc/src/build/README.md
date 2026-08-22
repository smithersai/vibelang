# Build POC

The compiler-facing comptime spike is exposed by `compileComptimeIntrinsics`.
It accepts an in-memory TypeScript/JavaScript/`.vibe` project and an existing
`ComptimeCompiler`, resolves calls against a private declaration for
`"vibelang:comptime"` with the TypeScript checker, and returns either completely
lowered sources or source-located `VCT1xxx` errors. Direct named imports, renamed
imports, and namespace imports work. An unrelated local function or property
with the same spelling is never granted compiler authority.

The POC intentionally evaluates a compiler-owned AST subset, not JavaScript.
Its value language includes canonical JSON values, project-local `const`
references, templates, conditionals, bounded binary/property/index operations,
and selected deterministic `JSON`, `Math`, `Object`, array, and string methods.
A function may be called immediately through `comptime(fn)(...)` or bound to
one private single-declaration `const`; parameters, `const` and `let` locals,
assignment and compound assignment, `++`/`--`, blocks, `if`, `while`,
`do-while`, classic `for`, `for-of` over arrays and strings, unlabeled
`break`/`continue`, `return`, and project-local pure helpers are interpreted.
Compile-time functions may call each other through their markers; a marked
call site inside a retained runtime function is itself lowered to its value.
Arrays and objects constructed during an evaluation are mutable through index
and property assignment, `push`, `pop`, and `splice`; module-level `const`
data is deep-frozen on first read, so mutating shared or foreign values fails
closed. The deterministic stdlib allowlist covers `Array.prototype`
`map`/`filter`/`reduce` (explicit initial value; inline or project-local
callbacks)/`slice`/`concat`/`join`/`includes`/`indexOf`,
`Object.keys`/`values`/`entries`/`fromEntries`, `JSON.parse`/`stringify`,
bounded `Math`, and `String.prototype` `trim`/`trimStart`/`trimEnd`/case
mapping/`includes`/`startsWith`/`endsWith`/`indexOf`/`lastIndexOf`/
`replaceAll`/`slice`/`split`/`repeat`/`padStart`/`padEnd`.

Every call tree shares hard budgets: 1,000,000 evaluation steps, 100,000
allocation nodes, 64 nested calls, and 1,000,000 UTF-16 units per string.
Exceeding any budget is the deterministic `VCT1012` diagnostic, never a hang.
Inline compile-time functions may use `comptime.target` and compiler-tracked
text `embed(...)`. Retained runtime functions cannot transitively capture
those phase-only operations. Getters, spread, arbitrary calls, ambient values
(`Date`, `Math.random`, `process.env`, and every other undeclared global),
untracked I/O, labeled control flow, `var`, destructuring, cyclic results, and
other unsupported syntax fail closed. Values are validated again as durable
JSON and stored through `ComptimeCompiler.evaluateStatic`, including verified
dependency snapshots, so this path shares the content-addressed, tamper-checked
cache without starting the Deno evaluator or executing an author module.
Identical inputs produce byte-identical lowered output on cold and warm runs.

On success the compiler-only imports are removed and calls become safe static
literals (including computed emission for `"__proto__"`). On any frontend
diagnostic no call is cached and no lowered source is returned; there is no
runtime fallback. `COMPTIME_RUNTIME_GUARD_SOURCE` is the virtual module source
for an ordinary runtime loader: it throws at dependency evaluation time, before
the importing module body can evaluate any call argument.

`result.loweredFiles[file]` is the composition contract for the next frontend
stage. It contains `code`, a deterministic canonical-JSON version-3
`sourceMap`, structured `provenance`, and a stable `identity` for downstream
cache keys. `loweredSources` remains as a compatibility view of the same code.
The map embeds exact authored `sourcesContent`; unchanged spans map exactly,
generated literals map to their argument or ultimate cross-file const
initializer, and the boundary after a replacement maps back to the authored
call. Provenance records erased intrinsic imports as zero-width generated edits
because a standard source map cannot describe removed ranges. Map and
provenance generation is validated before cache writes and fails closed with
`VCT1009` if the bounded POC emitter cannot represent the project.

Frontend composition order is comptime first, then Vibe lowering. Feed each
`loweredFiles[file].code` to the Vibe project compiler under the same logical
file name. Compose the Vibe map (Vibe output to comptime-lowered input) as the
outer map with this comptime map (comptime-lowered input to authored source) as
the inner map. TypeScript/JavaScript emit maps are then composed as the next
outer layer. Keep `provenance` alongside the build report: generic version-3
map composition preserves coordinates and `sourcesContent`, but is not expected
to retain the custom `x_vibelang_comptime` metadata field.

## Comptime type production

A binding shaped exactly `const Name = comptime(...)` (optionally `export`, one
declaration, module top level, both the plain-argument and immediately-called
block forms) may be used in type position: `function f(a: Name)`. The frontend
detects type uses through the checker — a type reference to a value-only
binding resolves as a declaration-less transient symbol, which is attributed
back through each file's visible-name scope (the declaring file plus named
imports of the binding) — and lowers the binding to BOTH the value const and a
same-named `type Name = <deep readonly literal type>;` alias. TypeScript
declaration merging makes the const/type pair legal, and the alias is derived
from the evaluated value's structure with the SAME literal-type shape the
`as const` value emission produces, so checking, declarations, diagnostics, and
editors all see one consistent type. When every project use of a non-exported
binding is a type, the runtime const is erased and only the alias is emitted;
`typeof Name`, any value read, an `export` modifier, an export specifier, or a
named import all retain the const. The alias lands in the declaring file (an
exported const emits `export type`), so a value import of the binding carries
the type meaning to consumers automatically.

Type production fails closed with `VCT1013` when the binding is a
`Schema.derive` reification (its descriptor value is not the authored type),
when the declaring file is JavaScript-family, or when the generated alias text
exceeds 100,000 characters. Qualified-name type references through a namespace
import are not attributed and surface as ordinary downstream type errors.
`VCT1012` is the shared evaluation-budget diagnostic for steps, allocation
nodes, call depth, and string growth. Provenance records the alias as a
`type-alias` edit: a zero-width insert after the statement in the merged form,
or a whole-statement replacement in the erased form.

## Comptime type reification

`comptime(Schema.derive<T>())` is the second compiler-owned intrinsic in the same
frontend. `Schema` comes from a new compiler-owned virtual module,
`"vibelang:schema"`. That import spelling is **provisional**: the specification
fixes reification semantics but has never fixed the import, so the POC claims
this name to exercise the authoring form end to end. Recognition is by checker
symbol identity against a private ambient namespace, so direct, renamed, and
namespace imports all work while an unrelated local `Schema` with a `derive`
method never gains compiler authority. `SCHEMA_RUNTIME_GUARD_SOURCE` is the
loader-facing source for the virtual module and throws at dependency evaluation
time, exactly like the comptime guard.

`Schema.derive<T>()` is legal only as the entire argument of an explicit
`comptime(...)` root. Parentheses and type-only wrappers are transparent;
nesting it inside a larger comptime value, calling it bare, or letting `Schema`
escape into runtime code are all source-located errors.

The derivation resolves `T` through the TypeScript checker — not the declaration
AST — and lowers it to this canonical structural descriptor:

| Descriptor | Reified from |
| --- | --- |
| `{ kind: "string" \| "number" \| "boolean" \| "null" }` | the matching primitive |
| `{ kind: "literal", value }` | a string, number, or boolean literal type |
| `{ kind: "array", element }` | `T[]` and `readonly T[]` |
| `{ kind: "tuple", elements }` | a fixed tuple with only required elements |
| `{ kind: "union", variants }` | a union, flattened and deduplicated |
| `{ kind: "object", properties }` | an exact object type; `properties` is `{ name, optional, value }` sorted by name |

`true | false` collapses back to `boolean`, `x?: T` strips exactly the
`undefined` the optional flag already carries, and property order is canonical
rather than authored, so reordering a declaration is not a cache miss. Bounds
are 16 levels of depth, 512 descriptor nodes, 128 properties, 64 tuple
elements, and 64 union variants.

Everything else fails closed with a stable `VCT12xx` code:

| Code | Meaning |
| --- | --- |
| `VCT1200` | `Schema.derive` outside an explicit `comptime(...)` root, or a compiler-owned schema value escaping into runtime code |
| `VCT1201` | malformed derive call: value arguments, no or many type arguments, optional chaining |
| `VCT1202` | a `.derive<T>()` inside a comptime root that does not resolve to the compiler intrinsic |
| `VCT1203` | malformed `"vibelang:schema"` import: default import, unknown export, type-only, or a JavaScript-family source |
| `VCT1204` | the type is not reifiable |
| `VCT1205` | the file already binds the reserved `__vsSchema` lowering identifier |
| `VCT1206` | compiler-owned schema module identities could not be established |
| `VCT1207` | the derived descriptor exceeded a bounded POC budget |

`VCT1204` covers `any`, `unknown`, `never`, `void`, `undefined`, the
non-primitive `object` keyword, `bigint`, `symbol`, enums, free type
parameters, unresolved type operators (`keyof`, indexed access, conditional,
template literal), intersections, index signatures, function and constructor
types, class instance types, methods and accessors, non-public members,
symbol-keyed properties, tuples with optional/rest/variadic elements, and
recursive types. Nothing degrades to an unchecked cast.

Lowering replaces the call with `__vsSchema<T>({ ...descriptor literal })`,
where `T` is the authored type argument text, so checking and declaration emit
see `Result<T, ValidationError>` for `parse` — a widened annotation on the
result is a type error, not a silent success. Every descriptor key is a fixed
compiler identifier and authored property names only ever appear as string
values, so no authored name reaches a generated key position. The deriving file
gains exactly one generated module edge, a zero-width prepended
`schema-runtime-import` edit whose specifier comes from
`schemaRuntimeImport` (default `"vibelang/schema-runtime"`); files that only
consume a derived schema gain nothing. Descriptor bytes are the value stored
through `ComptimeCompiler.evaluateStatic`, so they participate in the existing
content-addressed comptime identity and identical inputs produce byte-identical
lowered output.

`schema-runtime.ts` is the runtime half. It re-validates the descriptor it is
handed, then `parse(value: unknown)` returns the runtime's `Result`: success
carries a deeply frozen validated snapshot built with `Object.defineProperty`
(so a `__proto__` property name stays data), failure carries a
`ValidationError extends Error` with a structured `path`, a rendered `pointer`,
and a `reason`, registered through the runtime's public `registerErrorCodec`
as `vibelang:ValidationError@1`. Objects are exact: an undeclared property, a
borrowed prototype, an accessor, a non-enumerable slot, a sparse or
extra-property array, and a non-finite number are all rejected. `build/schema.ts`
remains as the earlier declaration-AST spike used by the asset example; the
checker-driven path above supersedes it.

The source-asset seam accepts three authored forms, all of which must spell
their attributes literally:

```ts
import config from "./config.json" with { type: "json", mode: "const" }
export { default as config } from "./config.json" with { type: "json", mode: "const" }
export * as bundle from "./config.json" with { type: "json", mode: "const" }
const config = (await import("./config.json", { with: { type: "json", mode: "const" } })).default
```

A re-exporting module participates in the graph exactly like an importing one,
and a literal dynamic import lowers to a dynamic import of the same generated
module. One asset is one generated module no matter how many importers,
re-exporters, dynamic importers, or loaders reach it, so every one of them must
agree on the attribute shape; a disagreement is the existing conflict
diagnostic. Still fail-closed on purpose: bare `export * from` an asset, any
type-only import/re-export/`import()` type query, side-effect-only imports,
legacy `assert { ... }`, a computed dynamic specifier, an `assert:` options key,
spread or non-literal dynamic attributes, and more than two `import()`
arguments.

`compileSourceAssetModules` discovers these forms from syntax without loading
an author module, resolves each asset beneath the real project root, invokes
`AssetCompiler`, and admits only generated pure-data modules. The admitted
grammar is static `const` data, a default export, safe scalar/array/object
literals, a `Uint8Array` constructed only from a literal bounded byte list, and
the generated-module imports described below. Prototype-mutating object
literals, computed allocation sizes, calls, getters, spreads, shorthand
properties, functions, arbitrary statements, and malformed loader output fail
closed before the module receives compiler provenance. That provenance is
process-local and nominal: copying a generated-source object, or supplying the
same marker text through the public structural seam, loses authority and is
analyzed as foreign JavaScript.

A loader may build a nested module graph instead of inlining a dependency's
bytes. It declares the edge through the tracked context (`context.import`) and
emits a sibling import of the child's deterministic generated module:

```ts
// inside a loader's emitted TypeScript
import schema from "./<child logicalKey>.ts";
const value = { entries: { region: "us-west" }, schema: schema };
export default value;
```

Every generated module lives at `.vibelang-generated/assets/<logicalKey>.ts`,
so `./<logicalKey>.ts` is the only admitted reference spelling. The referenced
key must be an `kind: "asset"` dependency of that same build, which is why the
edge cannot name a module the loader never requested through compiler
authority. The compiler then admits the child through the identical path,
identity, hard-link, code-overlap, and budget preflight, recompiles it from its
own declared attributes, and requires the rebuilt logical and content keys to
equal the ones the parent recorded. Four nested levels are supported
(`VIBE5219` beyond that); type-only imports, namespace bindings, import
attributes, modifiers, non-generated specifiers, and undeclared keys inside a
generated module all fail closed. Cache identity already contains the nested
edge — a parent's content key hashes its dependency list, whose `digest` is the
child's content key — so editing an inner asset invalidates every module above
it while the content-independent logical keys, and therefore the generated
module paths, stay stable. `AssetDependency` now carries the child's `options`
on asset edges so the edge is self-describing, which is what makes the
recompile-and-reconcile check possible; the compiler identity moved to
`vibelang-assets@4` for that record change.

The preflight bounds authored source strings before TypeScript parsing, rejects missing or legacy assertions, nonliteral attributes,
type-only/side-effect imports, unsupported re-export and dynamic import forms,
paths outside
the root, symbolic aliases, hard-link aliases, conflicting attribute shapes,
and any code/asset path or file-identity overlap. The exact device/inode, size,
mtime, ctime, canonical path, and compiler-returned path are reconciled after
loader execution, so a preflight-to-loader path swap cannot receive provenance.
It currently permits at most 1,024 authored files and top-level assets, 2 MiB
per authored source, asset, or generated module, and 16 MiB in each top-level
source/asset set. The underlying compiler separately bounds loader-tracked
dependencies and cache reads. Within one top-level compilation it snapshots
each canonical regular file once, returns copies to byte consumers, uses fatal
UTF-8 decoding for text consumers, and rejects files that change during the
read, hard-link aliases, compiler-cache reads, or transitive file/byte budget
exhaustion. The defaults are 2 MiB per file, 1,024 files and 16 MiB per graph;
all are configurable positive limits included in build identity. Cache entries
are independently capped at 64 MiB on both read and write. Cache revalidation
inherits the top-level snapshot's inode ownership and refuses noncanonical or
compiler-cache dependency metadata. A valid result whose
envelope exceeds that operational cache limit is returned but deliberately not
cached. One canonical asset shape is shared by every importer.

`SourceAssetCompilation.modules` is a flat list: an authored asset and every
generated module reachable from it. Each entry adds `references` (the logical
keys it imports, sorted) and `depth` (0 for an authored form, 1..4 for a module
first reached through a loader edge; issuance follows canonical asset-path
order, so the value is deterministic). Every diagnostic is still located in an
authored source file, including one raised while admitting a nested module.

The root CLI composes asset discovery before the checked Program in `check`,
`compile`, `run`, `inspect`, and `test`. The runtime graph assigns generated
modules deterministic content-addressed `.mjs` paths, keeps them in declaration
and source-map emit, and strips `with { ... }` only from compiler-mapped asset
imports in the AST emitter so Node never sees an attribute for generated
JavaScript. `--noEmit` performs the same checks without creating the output
tree. A failed batch commits no project output; successful independent cache
nodes may already have been warmed before a later loader diagnostic.

Three integrations have not caught up with the widened asset graph, so the
authored forms above are currently checked and issued by this seam without an
end-to-end `.vibe` lowering. The Vibe emitter rewrites and strips attributes
only on `ImportDeclaration`, so an asset re-export or dynamic import keeps its
authored specifier and attributes in emitted JavaScript; the semantic module
graph does not yet resolve a binding re-exported from a generated asset module
(`VIBE1804`); and the root relative runtime graph rejects a Vibe dynamic-import
edge, allows only a static import binding for a compiler-generated asset, and
refuses any module edge inside a generated asset module — which is exactly the
nested form. Only a project with a custom loader can produce nested modules, so
the CLI's builtin-loader path is unchanged today.

The root CLI also composes the comptime stage into project `check`, `compile`,
`run`, and `test`, reports provenance and tracked dependencies, and remaps later
diagnostics through the comptime map. Generated TypeScript/`.vibe` replacements
use `as const`, proving that value-derived deep literal types reach checking and
declaration emit; JavaScript output stays valid JavaScript. Deferred on purpose:
general author-code evaluation, implicit evaluation, computed types beyond
value-derived literal aliases (mapped/conditional results, generics), nested
`comptime(...)` inside an evaluated body, closures and higher-order compile-time
functions as values, exact formatting preservation, and one unified incremental
graph. Those require the real frontend IR and effect/capability design rather
than an unbounded AST interpreter in this POC.

## Provisional source-level loader registration

`docs/ASSET_LOADERS.md` open question 2 ("loader declaration and registration
APIs, including conflict precedence") is unanswered, and the `comptime.loader`
spelling there is explicitly a proposal. `loader-registration.ts` implements a
labelled-**provisional**, deliberately bounded candidate: a project file whose
**default export** is `comptime.loader(<type literal>, <function>)` registers a
loader for one import-attribute `type`.

```ts
// yaml-loader.ts
import { comptime } from "vibelang:comptime"

const load = async (asset, context) => {
  const schema = (await context.import("./app.schema.json", { type: "json", mode: "const" })).module.value
  // ... returns { format, value, emittedTypeScript, declaration, diagnostics, spans }
}

export default comptime.loader("yaml", load)
```

```ts
// app-config.vibe
import config from "./app.yaml" with { type: "yaml" }
```

Two rules are not provisional. `comptime` is resolved by **TypeScript checker
identity** against the compiler-owned `"vibelang:comptime"` declaration — the
same declaration text the comptime lowering frontend uses, exported as
`COMPTIME_PRELUDE` and extended with the registration surface — so a local
object with a `loader` method never acquires compiler authority. And the loader
file is **never imported or executed in the compiler process**: recognition is
purely AST/checker level, and execution happens only inside the existing
no-permission Deno sandbox. Built-in loaders stay in process; a custom loader is
always sandboxed.

Because the sandbox resolves no modules at all, recognition also produces the
lowered module the sandbox receives: the compiler-owned import is erased and the
registration statement becomes `export default <the loader function>`, which is
the shape `loader-runner.js` invokes. Everything else in the file is a
byte-for-byte slice of authored source. `createSandboxedLoader` gained one
option, `loweredSource`, for exactly this; it still snapshots the **authored**
file and hashes those bytes (plus the lowering) into `implementationDigest`, so
editing the loader file changes the asset's logical key and content key and is a
hard cache miss. An ordinary sandboxed loader's digest is unchanged.

Discovery has two entry points. `compileSourceAssetModules` accepts a
`loaders: [paths]` option naming registration files explicitly, and it also
auto-discovers any file in `sources` that spells the registration. The
auto-discovery trigger is spelling-only (a `"vibelang:comptime"` mention plus a
default-exported `*.loader(...)` call) and grants nothing; every candidate still
has to survive checker-identity recognition. Because the sandbox snapshots the
file on disk, a registration must be a real project file: an in-memory-only
source, or a compiled source that disagrees with the bytes on disk, fails
closed. Loader files also participate in the same code/asset file-identity
reconciliation as any other project code.

Precedence, as implemented:

1. A compiler-owned built-in always wins. A registration that shadows one is
   inert and reported as a `VCT1310` **warning**, never a silent disappearance.
2. Two project files registering one `type` are a fail-closed `VCT1311` error.
3. Otherwise the registration owns that `type`. Re-running the preflight against
   the same `AssetCompiler` is idempotent when the id and implementation digest
   match; a different implementation for an already-bound type is `VCT1312`.

Every registration is registered, not only the ones an authored import selects,
so a loader-declared nested `context.import(..., { type })` edge resolves too.
Registration prepares the sandbox; it does not run the module. A loader file
with a top-level `throw` is still discovered, and the throw surfaces only when
an asset actually selects its type, as the existing `VIBE5213` loader-failure
diagnostic located in the authored importer.

`VCT13xx` is the loader-registration diagnostic family:

| Code | Meaning |
| --- | --- |
| `VCT1300` | the loader file does not parse |
| `VCT1301` | module shape: a non-comptime import, import-equals, re-export, dynamic import, a file that is not real/regular/inside the root, a non-`.ts`/`.js` family extension, or an oversized file |
| `VCT1302` | registration shape: not exactly one `export default`, an `export =`, or a default export that is not a call |
| `VCT1303` | the call does not resolve to `comptime.loader` from `"vibelang:comptime"` |
| `VCT1304` | the call has no imported compiler identity at all |
| `VCT1305` | call shape: optional chaining, explicit type arguments, or an arity other than two |
| `VCT1306` | compiler-owned comptime module identities could not be established |
| `VCT1307` | the type is not a plain lowercase string literal — globs and extension patterns are rejected with their own message |
| `VCT1308` | the loader function is not inline and is not one same-file top-level `const`/`function` declaration |
| `VCT1309` | a compiler-owned comptime value is used anywhere else in the file (one file registers exactly one loader) |
| `VCT1310` | **warning**: a compiler-owned built-in already owns this type; the registration is ignored |
| `VCT1311` | two project files register one type |
| `VCT1312` | the sandboxed loader could not be prepared or registered |
| `VCT1313` | the compiled source and the on-disk loader file disagree |

Bounded on purpose: at most 64 loader files and 1 MiB per loader file. Still
**open**, and deliberately not implemented here: glob and extension selectors
(`"*.yaml"`), more than one registration per file, loaders distributed through
packages rather than project files (which is what "loader identity must be
stable across machines… package resolution and its lock file are part of the
loader implementation graph" ultimately requires), per-registration loader
options and configuration, extension-based selection for custom loaders (they
own `type` only), and whether a rejected registration should ever degrade to a
warning instead of failing the batch. `poc/examples/assets/yaml-loader.ts` plus
`app.yaml`/`app.schema.json` are the end-to-end example, exercised by
`examples/assets/demo.ts`.

## Provisional Markdown and MDX modules

`docs/ASSET_LOADERS.md` locks two things about these formats and leaves the
rest open: a `.md` import with `{ type: "text" }` has a `string` default
export, and `.mdx` produces a typed component module. The shapes below are
**provisional** candidates for the open slots ("additional parsed-document or
frontmatter exports", "frontmatter typing, component injection, and the default
export shape"). They are implemented, tested, and deliberately narrow, but they
are not a ledger decision yet. The built-in loader identities moved to
`vibelang:builtin/markdown@2` and `vibelang:builtin/mdx@2` for the change.

`{ type: "text" }` is untouched: it still returns the exact source string and
emits `const value = "..."; export default value;`.

**Provisional** `{ type: "markdown" }` (also the default for a `.md`
extension) emits a pure-data module with `export default source` — the byte-for-byte
authored source, so the zero-ceremony prompt case is unchanged — plus
`frontmatter`, `body` (the source after the front-matter block), `headings`,
and `source`. `frontmatter` and `headings` are emitted `as const`, so they
reach checking as deep literal types the same way `{ type: "json", mode:
"const" }` does, and the declaration points at the generated module
(`typeof import("./asset.generated.ts").frontmatter`) rather than widening to
`Record<string, string>`.

**Provisional** front-matter grammar, shared by both formats: an opening `---`
line at offset 0 and a closing `---` line. Inside it, blank lines and full-line
`#` comments are ignored, and each entry is `key: value` with an
`[A-Za-z_][A-Za-z0-9_-]*` key. A value is one scalar, or a block indented by
exactly two spaces holding either `- item` list entries or one level of nested
`key: value` pairs. Scalars are `true`/`false`, a JSON-shaped number
(`-?(0|[1-9][0-9]*)(\.[0-9]+)?`), a `"…"` string with only `\\`, `\"`, `\n`,
and `\t` escapes, a `'…'` string with the `''` escape, or a plain string.
Everything else is a **source-located diagnostic, never a silently different
value**: tabs, wrong indentation, two levels of nesting, a block mixing list and
map entries, duplicate keys, a missing value, an unterminated block, flow
collections (`{a: 1}`, `[a]`), anchors/aliases/block scalars, and the YAML
scalars whose readers disagree — `yes`, `no`, `on`, `off`, `null`, `~`, `Yes`,
`TRUE`, `.inf`, `.nan`, `0x10`, `007`, `1_000`, `1e5`, `+5`, `.5` — which must
be quoted to become strings. List items use the same scalar grammar, so a list
of strings is the intended shape but `- 3` is the number 3.

`headings` is a readonly array of `{ level, text, offset }` for ATX headings
(`#`…`######`, up to three leading spaces, optional closing `#` run), skipping
fenced code blocks. Setext headings are out of scope. `offset` is the UTF-16
offset of the heading's first `#` in the **authored** source, and the emitted
module carries a `spans` entry mapping each generated heading literal back to
that offset, which is how the loader satisfies the "Markdown and MDX MUST
preserve source locations" requirement.

**Provisional** `{ type: "mdx" }` (also the default for `.mdx`) emits the same
`frontmatter`, plus `source`, `body`, `components`, `expressions`, and a
`tree`, with `export default tree`. The render tree is the ordered top-level
node list; every node is one of:

| Node | Shape |
| --- | --- |
| element | `{ kind: "element", name, props, children }` |
| text | `{ kind: "text", value }` |
| expression | `{ kind: "expression", placeholder }` |

`props` holds literal attributes only: `x="s"`, `x='s'`, bare `x` (`true`), and
`x={2}` / `x={true}` for number and boolean literals. `x={value}` is a
diagnostic, not an evaluation. **Expressions are never evaluated**: a `{name}`
hole becomes a named placeholder that a consuming library substitutes, which is
exactly what the agent library's `mdxPrompt` does for `{task}`. A hole must
name one identifier; `{a + b}` is a located error rather than smuggled comptime
JavaScript. Fenced code blocks and inline code spans are literal text, so a
prompt may show `<Component>` or `{braces}` in a sample without becoming
structure. `components` (capitalized element names, first-appearance order) and
`expressions` (placeholders in document order) are kept from the earlier
simplified loader, as are `source` and `body`, so the existing agent renderer
keeps working against the same fields.

Both loaders fail closed on a malformed authored asset by throwing
`AssetSourceError`, which carries `path`, `offset`, `line`, `column`, an
`issues` array (the front-matter parser reports every bad line, the MDX scanner
stops at the first), and an equivalent `diagnostics` array. `AssetDiagnostic`
can only travel inside a module the loader managed to produce, so a source
error that prevents a module reports its locations here instead of degrading to
an unlocated message. MDX errors cover an unclosed element, a mismatched or
unexpected closing tag, an unterminated tag, expression, or attribute value, a
duplicate attribute, and a non-literal attribute — each at the authored offset.

Both emitted modules are pure data under the admission grammar above (`const`
data, literal objects/arrays with computed string keys so a `__proto__`
attribute or front-matter key stays a data property, and a default export), and
both are byte-deterministic: regeneration from the same bytes produces an
identical module and content key. Bounded on purpose: 256 front-matter entries,
4,096 MDX nodes, and 32 levels of element nesting.

`ForeignCompiler` is a separate bounded Zig/Rust-to-Wasm graph spike. It reads
each discovered canonical regular source once, rejects root/cache escapes and
hard-link aliases, and caps per-file bytes, total bytes, and file count. Rust
literal modules/includes and Zig literal source imports/embedded files are
copied into a private snapshot tree; the external compiler never receives an
original project path. The key includes relative source bytes, the exact build
profile, host/target, fatal-UTF-8 version evidence, a SHA-256 identity for the
resolved compiler executable, and the complete sanitized environment actually
passed to the process. Ambient variables are absent unless explicitly supplied
through `environment`, in which case their snapshotted values enter the key.

Foreign processes receive bounded output and a deadline and own a POSIX process
group that is killed on both failure and successful leader exit. The resolved
compiler executable is size-capped, content-hashed at resolution, and re-hashed
after every invocation, so a tool swapped or modified during a build fails the
build; returned builds are defensive clones whose mutation cannot reach cache
internals. Wasm and cache
metadata reads are bounded, no-follow regular-file snapshots; metadata is the
last atomic cache commit marker, and poisoned, oversized, or symlinked objects
are cache misses. This does not make an external compiler untrusted code: the
compiler may still read its standard library/toolchain installation, and the
POC's regex dependency discovery and ABI extraction intentionally fail closed
for several dynamic forms rather than claiming complete compiler metadata.
