# Fork seam design: how Smithers becomes a real compiler inside the Go TypeScript fork

> [!IMPORTANT]
> **Specification drift — read `docs/DECISIONS.md` and
> `docs/src/pages/specification/**` first.**
> This document records implementation and measurement history. On 2026-08-23 the
> specification was substantially reduced and the code has not caught up, so parts
> of this document describe obligations the language no longer has:
>
> - the expression-form control-flow grammar, `defer`/`errdefer`, labeled value
>   breaks and loop `else` — grammar is now one form, `if (const x = f(); cond)`
> - `Optional<T>` — absence is now `T | undefined`
> - `.unwrap()` — propagation is now postfix `!`, and the TypeScript non-null
>   assertion is removed from `.sm`
> - the near-native/LLVM and Wasm compilation targets, the `TypeScript`
>   requirement, the portable/required/forbidden classification, and the
>   portability (native) pin — TypeScript is the only target
>
> **Concretely, on the diagnostic codes this document proposes to "retire"**
> (added 2026-09-01, because a reader met them here and reasonably concluded they
> exist): `SMITHERS1702`, `SMITHERS1704`, `SMITHERS1705`, `SMITHERS1706`,
> `SMITHERS1707`, `SMITHERS1708` and `SMITHERS1709` are implemented in **neither**
> backend. They were removed from the reference on 2026-08-23 by `4e1ff5c`, and
> the constructs they judged are now forbidden outright by
> `docs/src/pages/specification/control-flow.mdx` §No Expression-Form Grammar. So
> every sentence below that weighs a design against "the codes it retires" is
> weighing it against work that is already gone; nothing here is a live plan, and
> none of these codes is a feature the language has. The reference's retirement
> ledger is `poc/src/language/README.md`. The only surviving `17xx` codes are
> `SMITHERS1703` and `SMITHERS1717`.
>
> Retained and unaffected: the checked `panic` channel on unannotated foreign
> calls, and Zig/Rust imports through generated Wasm bindings. Where this document
> and the specification disagree, the specification wins.

Status: architecture analysis feeding immediate implementation. Every path, type,
function, and line number below was read out of the pinned checkout
`c087644e82dc3d48cf87e4c5519eeaaea9daf35c` (`smithersai/TypeScript`). Paths are
relative to the fork's `tsc/` module root unless stated otherwise. An implementer
should be able to work from this document without re-reading the fork.

Sizing convention throughout: every estimate is split into

- **changed** — lines edited inside existing upstream files (this is the number
  `docs/DECISIONS.md`'s "minimal diff" goal actually constrains), and
- **new** — lines in new fork-owned files, which cost review but never cost a
  merge conflict.

---

## 0. Executive verdict

**The "narrow plugin interface" in `docs/DECISIONS.md` is not a thing we have to
build. Upstream already built it, and it is better than what we specified.** The
fork ships `internal/contentmapper` + `internal/spanmap`: a versioned JSON-RPC
plugin protocol for hosting non-TypeScript source languages, with authored-position
span mapping, per-language-service-feature fidelity gating, plugin-authored
diagnostics in authored coordinates, diagnostic suppression directives, supplemental
virtual files, content-addressed transform caching, and ~26 LSP capabilities
dynamically registered against a `**/*.sm` glob. `internal/ls` (41,158 lines) is
already threaded with `spanmap.Feature` end to end.

**But it is a plugin interface for *syntax*, not for *semantics*.** Three hard walls
stop Smithers from living entirely behind it:

1. Runtime JavaScript emit is *deliberately* switched off for content-mapped files
   (`internal/compiler/emitter.go:479`) and the printer's source-map writer is
   completely span-map-unaware. This is why the current POC needs two `Program`s
   and 500 lines of map composition in `compiler/forkbridge/main.go.txt`.
2. The content-mapper cache identity is a function of **one file's content**
   (`internal/project/parsecache.go:43`). Whole-program `E`/`R` row inference is a
   function of *every* file's content. You can have correctness or incrementality,
   not both, on that path.
3. `TypeFlags` is a `uint32` with **all 32 bits allocated**
   (`internal/checker/types.go:425-459`, bits 29-31 are `Reserved1/2/3` and two of
   them are already aliased in use). There is no room for a new first-class type
   kind. Rows have to be modelled *beside* the type system, not inside it.

So the honest answer to Q7 is: **a substantial fork, but a substantially *additive*
one.** The realistic end state is roughly **450-600 changed lines** spread over
~25 upstream files, plus **11,000-15,000 new lines** in fork-owned packages
(`internal/smithers/`, `internal/transformers/smitherstransforms/`, `cmd/smithersc/`,
`cmd/smithersmap/`). That is not a "minimal diff" by the letter of DECISIONS.md, but the
*upstream-merge* burden stays small, which is what that decision was actually
protecting. The one place where the letter of the decision fails outright is
grammar — and not for the reason we expected: **the AST is declarative
(`tools/scripts/tsc/ast.json`) so new node kinds are ~25-30 hand-written JSON lines
each with all Go generated, but `ast.json` and three of the five generators live
outside `tsc/`** (§3.3). That is a change to the *vendoring contract*, not to code.

Three findings worth more than any plan:

- **The pinned revision has zero Smithers delta.** `git log` in the checkout shows
  exactly one commit, `c087644e Downgrade too-new npm deps (#63925)`, an upstream
  microsoft/TypeScript merge. "The fork" today is pristine upstream. Every number
  in this document is therefore a *first* diff, not an incremental one.
- **The checkout is sparse (`git sparse-checkout list` → `tsc`).** `tools/`,
  `packages/`, and `src/` are absent from disk but present in git. What lives
  outside `tsc/` and that we need: `tools/scripts/tsc/ast.json` (175 KB, the AST
  source of truth), `generate-go-ast.ts`, `generate-encoder.ts`,
  `generate-ts-ast.ts`, `Herebyfile.mjs generate:enums`, and `tools/gen-proto`.
  **The vendoring work must vendor more than `tsc/` if we ever intend to change the
  AST**, and `go.work` already lists `./tools`, so the shape is expected.
- **`defer` is already a keyword in this fork** (`internal/scanner/scanner.go:55`,
  `KindDeferKeyword`, added for TC39 `import defer`), and `immediate` is a
  reserved-but-otherwise-unused keyword (`scanner.go:69`) proving a keyword can be
  added with zero grammar impact.

---

## 1. Ground truth about the checkout

```
tsc/internal (non-test Go)              312,218 lines
  checker/    60,456   (checker.go 32,296, relater.go 5,044, nodebuilderimpl.go 3,637)
  ls/         41,158   (completions.go 6,898, hover.go 1,095)
  transformers/ 24,399 (estransforms 11,251, declarations 4,217, tstransforms 3,889)
  lsp/        22,044   (server.go 2,542)
  ast/        21,168   (ast_generated.go 10,053, utilities.go 4,599, kind_generated.go 463)
  project/    11,976
  printer/    11,710   (printer.go ~6,200)
  parser/      9,093   (parser.go 6,850, jsdoc.go 1,354, reparser.go 748)
  compiler/    6,564   (program.go 2,395, emitter.go ~560, fileloader.go ~900)
  scanner/     4,332
  binder/      3,554
  contentmapper/ 1,989 (hostimpl.go 1,381, host.go 319, contentmapper.go 154, transform.go 135)
  tspath/      1,495
  sourcemap/   1,013
  spanmap/       778
cmd/tsc                                     492 lines (main.go is 33)
go.mod: module github.com/microsoft/TypeScript/tsc, go 1.26
```

The single most important structural fact for us: **`cmd/` is inside the module.**
`cmd/tsc/main.go` (33 lines) imports `internal/execute`, `internal/core`,
`internal/osutil` directly. Any new directory under `tsc/cmd/` gets full
`internal/*` access with **zero lines changed in any existing file**. That is the
zero-cost tier of this whole design, and it is what makes Stage 1 free.

---

## 2. Q1 — File recognition

### 2.1 Where extensions are decided

There is no `Extension` enum type. `internal/tspath/extension.go` holds untyped
string constants (`ExtensionTs = ".ts"` at :9 through `ExtensionDcts` at :21) and a
single `var (...)` block of grouping slices at :24-37:

| name | line | shape |
|---|---|---|
| `SupportedDeclarationExtensions` | 25 | `[]string` |
| `SupportedTSImplementationExtensions` | 26 | `[]string` |
| `supportedTSExtensionsForExtractExtension` | 27 | `[]string` |
| `AllSupportedExtensions` | 28 | `[][]string` — three priority groups |
| `SupportedTSExtensions` | 29 | `[][]string` |
| `SupportedTSExtensionsFlat` | 30 | `[]string` |
| `SupportedJSExtensions` / `Flat` | 31/32 | |
| `AllSupportedExtensionsWithJson` | 33 | |
| `SupportedTSExtensionsWithJson` / `Flat` | 34/35 | |
| `ExtensionsNotSupportingExtensionlessResolution` | 36 | |
| `extensionsToRemove` (unexported) | **43** | drives `RemoveFileExtension`, `ChangeExtension`, `TryGetExtensionFromPath` |

Script kind: `core.ScriptKind` is `int32` with six values in
`internal/core/scriptkind.go` (values 5 and 7 are explicitly *reserved*, formerly
`External` and `Deferred`). Derivation is
`core.GetScriptKindFromFileName(fileName) ScriptKind` at
`internal/core/core.go:527-544`: a `strings.LastIndex(".")` plus a five-arm switch;
anything unknown returns `ScriptKindUnknown`. There is a fork-relevant sibling,
`core.EnsureScriptKindFromFileName` at `internal/core/core.go:564-569`, which
defaults to `ScriptKindTS`; that is what the main program parse path uses
(`internal/compiler/host.go:97`). `parser.Parser.initializeState`
(`internal/parser/parser.go:291-294`) **panics** on `ScriptKindUnknown`.

Program-level rejection of unknown extensions happens in three places:

- `internal/compiler/filesparser.go:95-103` (inside `parseTask.load`), guarded by
  `!t.isContentMapperSupplemental && tspath.HasExtension(...)` at :79 and
  `!allowNonTsExtensions` at :82, using `fileLoader.isSupportedExtension`
  (`internal/compiler/fileloader.go:666-673`). Emits
  `diagnostics.File_0_has_an_unsupported_extension_The_only_supported_extensions_are_1`
  (**TS6054**, `internal/diagnostics/diagnostics_generated.go:2465`).
- `internal/compiler/fileloader.go:691` for `/// <reference path>` and root files.
- `internal/compiler/program.go:257-259`, silent (`// unsupported extensions are
  forced to fail`).

### 2.2 The runtime-extensible path already exists

`tsoptions.GetSupportedExtensions(compilerOptions, extraExtensions []string) [][]string`
(`internal/tsoptions/tsconfigparsing.go:2020-2042`) takes the builtin groups and
appends each `extraExtension` as its own single-element priority group.
`extraExtensions` is **always** `ParsedCommandLine.ContentMapperExtensions()`
(`internal/tsoptions/parsedcommandline.go:356-360`), threaded to:

- `internal/compiler/fileloader.go:155` (supported-extension set),
- `internal/compiler/fileloader.go:178` → `module.NewResolver(..., extraExtensions)`,
- `internal/compiler/emitHost.go:116` → `outputpaths.OutputPathsHost.ContentMapperExtensions()`,
- `internal/ls/string_completions.go:1031`.

Dispatch to the mapper is `internal/compiler/fileloader.go:404`:

```go
if tspath.FileExtensionIsOneOf(t.normalizedFilePath, p.contentMapperExtensions) {
    return p.parseContentMappedFile(parseOptions)
}
```

Resolution: `internal/module/resolver.go:1569-1575` tries the extra extension
directly and marks `resolved.resolvedUsingExtraExtensions = true`, which
short-circuits `GetResolutionDiagnostic` at `internal/module/util.go:154-156`.
`allowArbitraryExtensions` (`internal/core/compileroptions.go:21`) is **purely a
diagnostic gate** — the `./x` → `./x.d.<ext>.ts` lookup at
`internal/module/resolver.go:1578` is unconditional; without the flag you just get
TS6263 (`Module_0_was_resolved_to_1_but_allowArbitraryExtensions_is_not_set`) and
the file is dropped from the program at `internal/compiler/fileloader.go:894`.
Content-mapped files bypass all of it.

### 2.3 `contentmapper` is the better host — and the two paths are mutually exclusive

`internal/contentmapper/contentmapper.go:1-12` states the intent verbatim:

> Package contentmapper defines the types describing an external content mapper: a
> plugin that transforms otherwise unsupported file content (e.g. .vue) into virtual
> TypeScript during program construction. […] it spawns each mapper's package as a
> child process and talks to it over a JSON-RPC connection (reusing internal/ipc)

The declaration is tsconfig-level:

```go
type Definition struct {                     // contentmapper.go:30
    Package    string     `json:"package"`
    Extensions []string   `json:"extensions"`
    Options    json.Value `json:"options,omitempty"`
}
type Manifest struct {                       // contentmapper.go:39
    Name, Version   string
    Exec            []string
    CompilerOptions []string
    DynamicConfig   bool
}
```

The transform result is far richer than a source map:

```go
type Result struct {                         // host.go:170
    Text                 string
    VirtualExtension     string               // must be one of 9: contentmapper.go:57-59
    Diagnostics          []*ast.Diagnostic    // mapper-authored, in ORIGINAL coordinates
    Mappings             *spanmap.SpanMap
    DiagnosticDirectives []ast.MappedDiagnosticDirective
    Supplemental         []MappedResult
}
```

`spanmap` (`internal/spanmap/spanmap.go`) is the piece we would otherwise have had
to invent. Segments are `KindVerbatim` / `KindAtom` / `KindAlias` (:23-35); results
carry `FidelityExact` / `Atom` / `Approximate` / `None` (:70-99); a 20-bit `Feature`
mask (:42-65) lets a segment opt out of individual language-service operations
while **diagnostics are deliberately un-opt-out-able** (:37-39). `SpanMap.Validate`
(:192) is a hard contract: verbatim segments must match the original text
byte-for-byte, segments must be ordered and disjoint in virtual space, original
spans must not partially overlap. A violated map is a *structured* compiler
diagnostic, not silent drift.

Wiring: `contentmapper.TransformAndParse` (`transform.go:26`) → `ParseResult`
(`transform.go:47`) parses `result.Text` as `FileName + VirtualExtension` (i.e.
`/a/b.sm` + `.ts` → script kind derived from the string `/a/b.sm.ts`, `transform.go:59-64`)
and stamps `sourceFile.SetContentMapperInfo(ast.ContentMapperSourceFileInfo{...})`
(`internal/ast/ast.go:2631-2641`), which carries `VirtualFileName`, `OriginalText`,
`SpanMap`, `DiagnosticDirectives`, `SupplementalSourceFiles`.

Diagnostics map back automatically: `internal/diagnosticwriter/diagnosticwriter.go:98-99`
calls `file.SpanMap().VirtualToOriginalSpan(loc)`, and :141 prints the mapper name.
`internal/ast/diagnostic.go:138` uses `AliasForVirtualSpan` for renamed identifiers.

Emit naming is already what the POC observed:
`outputpaths.ChangeToDeclarationExtension` (`internal/outputpaths/outputpaths.go:148-151`)
produces `x.d.sm.ts` **because** `.sm` is a content-mapper extension.

**The exclusivity.** `internal/tsoptions/tsconfigparsing.go:1402, 1410-1411` rejects
any mapper extension that is in `core.Flatten(tspath.AllSupportedExtensionsWithJson)`
with `Content_mapper_file_extension_0_is_a_built_in_extension_and_cannot_be_registered_by_a_content_mapper`.
The same guard is at `internal/lsp/server.go:2529-2534` and
`internal/contentmapper/hostimpl.go:1121-1126`. So:

> `.sm` can be a content-mapper extension **XOR** a first-class `tspath` extension.
> Never both. Choosing the second is a one-way door (§7).

One friction point: content mappers require `--runExternalCode`
(`internal/tsoptions/tsconfigparsing.go:1424-1429`, mappers are dropped entirely
without it). But `RunExternalCode` is a plain `core.CompilerOptions` field
(`internal/core/compileroptions.go:155`), so a `cmd/smithersc` driver sets it
programmatically and the user never sees the flag.

### 2.4 Recommendation

**Host `.sm` as a content-mapper extension. Do not make it first-class until §7's
Stage 4, and only if grammar forces it.** Fork diff for the content-mapper path is
**0 changed lines** for file recognition. Everything — parse, resolve, program
construction, `.d.sm.ts` naming, diagnostic mapping, LSP registration — already
works.

### 2.5 Cost of the alternative (first-class `.sm`)

~20 required sites, **60-90 changed lines**, no new files. The three that break
everything silently if missed:

| # | site | why |
|---|---|---|
| 1 | `internal/tspath/extension.go:43` `extensionsToRemove` | without it `RemoveFileExtension` no-ops and every output becomes `main.sm.js` |
| 2 | `internal/module/resolver.go:1468-1583` `tryAddingExtensions` | without a `.sm` arm, `import "./x"` is unresolvable (~8-14 lines) |
| 3 | `internal/module/util.go:158-177` `GetResolutionDiagnostic` | without `.sm` in the always-allowed case, every `.sm` import gets TS6263 and the file is dropped at `internal/compiler/fileloader.go:894` |

Plus: `extension.go:26-35` (six slices), `extension.go:40` `ExtensionIsTs`,
`extension.go:137-152` `GetDeclarationEmitExtensionForPath`, `extension.go:195-208`
`GetPossibleOriginalInputExtensionForExtension`, `core/core.go:527`
`GetScriptKindFromFileName`, `ast/utilities.go:2571-2582`
`GetImpliedNodeFormatForFile`, `module/util.go:182-201` `TryGetJSExtensionForFile`,
`tsoptions/parsedcommandline.go:23-26,37` (glob patterns, two literals plus the
runtime list), `modulespecifiers/specifiers.go:642-700`
(`removeExtensionAndIndexPostFix`, `getJSExtensionForFile` — otherwise auto-import
writes broken specifiers), `outputpaths/outputpaths.go:116-129` `GetOutputExtension`
(free: `.sm` already falls to `default: → .js`), and
`ls/lsconv/converters.go:283-298` `LanguageKindToScriptKind` for a `"smithers"`
language id.

### 2.6 Emit-path naming under the content-mapper path — one real gap

`outputpaths.getOwnEmitOutputFilePath` (`internal/outputpaths/outputpaths.go:183-198`)
computes the JS path as `tspath.RemoveFileExtension(fileName) + GetOutputExtension(...)`.
`RemoveFileExtension` consults `extensionsToRemove` (`internal/tspath/extension.go:43`),
which does not know `.sm`, so `main.sm` → `main.sm` → **`main.sm.js`**. Today this
is invisible because content-mapped files get no JS path at all
(`outputpaths.go:57`). The moment we unsuppress JS emit (§5.2) we must add a
`ChangeToJSExtension`-style helper mirroring `ChangeToDeclarationExtension`
(`outputpaths.go:148-151`) that consults `host.ContentMapperExtensions()` first.
**~8 changed lines** in `internal/outputpaths/outputpaths.go`.

---

## 3. Q2 — Syntax extension

### 3.1 What the fork's AST actually is

**The AST is declarative and code-generated, and that makes grammar far cheaper to
*write* than it looks.** `internal/ast/ast_generated.go` (10,053 lines) and
`internal/ast/kind_generated.go` (463 lines) both begin with

```go
// Code generated by tools/scripts/tsc/generate-go-ast.ts. DO NOT EDIT.
```

The generator's input is **`tools/scripts/tsc/ast.json` (175 KB)**, the single
source of truth for kinds, range markers, base types, and node definitions.
`tools/` is in git and `go.work` already lists `./tools`; it is simply **not in
this sparse checkout** (§1). Read it with `git show HEAD:tools/scripts/tsc/ast.json`.
The generator family is:

| file | emits |
|---|---|
| `tools/scripts/tsc/generate-go-ast.ts` (43 KB) | `internal/ast/ast_generated.go`, `internal/ast/kind_generated.go` |
| `tools/scripts/tsc/generate-encoder.ts` | `internal/api/encoder/{encoder,decoder}_generated.go` + 3 files under `packages/typescript/src/api/node/` |
| `tools/scripts/tsc/generate-ts-ast.ts` | the TypeScript-side AST |
| `tools/scripts/tsc/generate.ts` | driver, run by `npx hereby generate:ast` (`Herebyfile.mjs:572-576`) |

A node definition is JSON. This is the whole of `IfStatement`
(`tools/scripts/tsc/ast.json:1295-1323`):

```json
"IfStatement": {
    "generateSubtreeFacts": true,
    "extends": ["StatementBase", "CompositeBase"],
    "members": [
        { "name": "Expression",    "type": "Expression" },
        { "name": "ThenStatement", "type": "Statement", "visit": "embeddedStatement" },
        { "name": "ElseStatement", "type": "Statement", "optional": true, "visit": "embeddedStatement" }
    ],
    "arena": true
}
```

From that, `ast_generated.go:816-863` generates the struct, `NewIfStatement`,
`UpdateIfStatement`, `ForEachChild`, `VisitEachChild`, `Clone`,
`computeSubtreeFacts`, `IsIfStatement`, the `ForEachChild` dispatch case
(`:8694-8695`), the `AsIfStatement()` cast (`:9059-9061`), the per-kind arena field
on `NodeFactory` (`:20-73`), and the stringer entry. **Zero manual `NodeFactory`
edits.**

So: **one new AST node type costs ~25-30 hand-written lines, all in `ast.json`.**
Nodes are one Go struct per kind embedding a base, behind a single `Node`
(`internal/ast/ast.go:179-186`) with an unexported `nodeData` interface
(`ast.go:1181-1202`, 20 methods) whose defaults come from `NodeDefault`
(`ast.go:1206-1245`). Only `JSDocNameReference` and `SourceFile` are
`"handWritten": true`; do not take that path.

**Kind insertion: END is free numerically but semantically wrong; MIDDLE is right
and also cheap.** `Kind` is `int16`, pure `iota`, `KindCount = 351`
(`kind_generated.go:8, 391`). Nothing in the Go tree hardcodes a numeric kind, so
inserting mid-enum shifts constants harmlessly — everything downstream regenerates.
The two real traps are:

1. **Range membership, not numeric shift.** A kind appended after
   `KindNotEmittedTypeElement` falls **outside** `KindFirstStatement`
   (`= KindVariableStatement`) `.. KindLastStatement` (`= KindDebuggerStatement`),
   so `ast.IsStatement` (`ast/utilities.go:695`), `ast.IsPotentiallyExecutableNode`
   (`ast/utilities.go:4245`), and `binder/binder.go:1656` will silently not treat it
   as a statement. New statement kinds must go **inside** the statement block.
   Same for keywords: put them at the end of the keyword block and bump the
   `LastKeyword` / `LastContextualKeyword` markers (`kind_generated.go:399, 422`,
   declared in `ast.json` under `"markers"`).
2. **The API wire protocol.** `internal/api/encoder/encoder.go` encodes `Kind`
   *numerically* and shares it with the TypeScript client. Go and TS sides must be
   regenerated **together** or the LSP/API breaks silently. `encoder.go:17-18` also
   `panic`s at init if `KindLastUnaryOperator > 0x3f` — there is 6-bit packing of
   unary operators, so do not insert kinds before `KindTildeToken`.

Minor: `internal/format/rulesmap.go:42` sizes a formatter table as
`(KindLastToken+1)²` buckets, so bumping `LastKeyword` grows a squared table.
Complete list of range-marker consumers is in the appendix.

**Blast radius of one new statement kind**, measured by `grep -rln KindTryStatement`:
16 files, of which 5 are generated (`ast_generated.go`, `kind_generated.go`,
`kind_stringer_generated.go`, `api/encoder/encoder_generated.go`,
`api/encoder/decoder_generated.go`) and 11 are hand-written:
`ast/utilities.go`, `binder/binder.go`, `checker/checker.go`, `checker/flow.go`,
`format/indent.go`, `format/rulecontext.go`, `ls/folding.go`, `printer/printer.go`,
`transformers/declarations/transform.go`, `transformers/estransforms/async.go`,
`transformers/moduletransforms/commonjsmodule.go`. Budget **~80-150 changed lines**
for full downstream support of one new statement kind (binder `bind`
`binder.go:572`, checker `checkSourceElementWorker` `checker.go:2260`, printer
`printer.go:4164`, transformers, `format/`, `ls/`).

### 3.1a Dialect gating: three options, one recommendation

**(a) `NodeFlags` context bit — recommended.** `ast.NodeFlags` is `uint32` with
bits 0-28 used (`internal/ast/nodeflags.go:3-73`); **bits 29, 30, 31 are free**.
`NodeFlagsJavaScriptFile = 1 << 16` is already exactly this pattern, included in
`NodeFlagsContextFlags` (`nodeflags.go:57`), set in `initializeState`
(`parser.go:305-312`), stamped onto every node by `finishNode` (`parser.go:5953`),
and saved/restored by `mark`/`rewind`. Manipulators: `setContextFlags`
(`parser.go:6401`), `doInContext[T]` (`parser.go:6409`). **~4 changed lines.**

**(b) A new `ScriptKind`.** `internal/core/scriptkind.go:6-20` explicitly reserves
values **5 and 7** (formerly `External` and `Deferred`) — free numeric slots.
`ScriptKind` reaches the parser through `ParseSourceFile(opts, text, scriptKind)`
(`parser.go:135`) → `initializeState` (`parser.go:291-316`) →
`getLanguageVariant` (`internal/parser/utilities.go:11-17`). The precedent for a
*whole alternate grammar* selected this way is `parseJSONText`
(`parser.go:156`, ~90 lines, dispatched at `parser.go:140`). **~10 changed lines**,
but it also means touching `core.GetScriptKindFromFileName` and every
`ScriptKindUnknown` guard, and `parser.initializeState` `panic`s on
`ScriptKindUnknown` (`parser.go:292-294`).

**(c) The `checkJSSyntax` pattern — good messages, wrong gate.**
`(*Parser).checkJSSyntax(node)` (`parser.go:6765`, called from ~30 sites) parses
TypeScript syntax *unconditionally* and then emits "X can only be used in
TypeScript files". Tempting for Smithers, and it would give far better errors than
option (a) does for `defer x` in a `.ts` file. **But it changes the `.ts` parse
tree**, which breaks `poc/FINDINGS.md`'s P0 gate ("keep an upstream TypeScript
corpus unchanged in `.ts`/`.tsx` interop tests"). Use (a) for acceptance; accept
that `defer x` in a `.ts` file keeps producing today's `';' expected`.

Also worth knowing: `p.isIdentifier()` is `p.token > ast.KindLastReservedWord`
(`parser.go:6312`, and `isBindingIdentifier` at :6317). Any keyword placed **after**
`KindWithKeyword` — i.e. in the contextual range — remains usable as an ordinary
identifier automatically. Existing `.ts` code using `defer` or `errdefer` as a
variable name keeps working with no extra work.

### 3.1b Parser landmarks

`parseStatement` (`internal/parser/parser.go:1063-1122`) is a flat 58-line switch
falling through to `parseExpressionOrLabeledStatement` at :1121. Statement parsers:
`parseIfStatement` :1240, `parseWhileStatement` :1278,
`parseForOrForInOrForOfStatement` :1292 (there is **no** separate
`parseForStatement`), `parseBreakStatement` :1338, `parseContinueStatement` :1349
(no combined break/continue), `parseSwitchStatement` :1436,
`parseExpressionOrLabeledStatement` :1519, `parseVariableDeclarationList` :1554.

Recovery and speculation: `parseErrorAt` :322, `parseErrorAtCurrentToken` :326,
`parseExpected` :997, `parseExpectedMatchingBrackets` :974, `parseOptional` :989,
`isListElement(kind, inErrorRecovery)` :824 (**not** `parseListElement`),
`parseListIndex` :613, `isListTerminator` :916,
`abortParsingListOrMoveToNextToken` :731, `parsingContextErrors` :755,
`mark()`/`rewind()` :352/:365, `lookAhead(callback)` :377, `canParseSemicolon`
:6065, `tryParseSemicolon` :6071, `finishNode` :5953, `nodePos` :409.

There is **no generic `tryParse` and no `speculationHelper`** — `lookAhead` always
rewinds, and "commit on success" is written out by hand (see
`tryParseParenthesizedArrowFunctionExpression` :4369).

`ParsingContext` / `ParsingContexts` (`parser.go:19-51`, 26 contexts, `PCCount`
= 48) is list-recovery scope, **not** a dialect gate.

### 3.1c The reparse list is a real parse-time desugar host

`internal/parser/reparser.go` (748 lines) turns JSDoc into *synthetic TypeScript
AST nodes* at parse time. The mechanics generalize:

- `(*Parser).reparseTags(parent, jsDoc)` :54 → `reparseUnhosted` :70 (creates
  standalone statements) and `reparseHosted` :342 (mutates the host node).
- `finishReparsedNode(node, locationNode)` :13 stamps
  `p.contextFlags | ast.NodeFlagsReparsed` (`nodeflags.go`, bit 3) and copies `Loc`
  from the source node — **synthetic nodes inherit authored positions**.
- Injection: `p.reparseList = append(p.reparseList, result)` (:99, :118, :133, :137),
  consumed in `parseListIndex` (`parser.go:613-643`), which splices the buffer into
  the statement list **immediately before the statement being parsed, at whatever
  nesting level you are in**, and *propagates outward* anything that cannot live in
  a nested scope. Flushed at file end at `parser.go:445-448`; index accounting at
  `parseToplevelStatement` :500-506.
- Second precedent: `reparseTopLevelAwait` (`parser.go:517`, driven from :452-458)
  re-parses recorded statement spans with different context flags.

This is exactly the "hoist a temporary before the containing statement" primitive
the POC implements as a 256-construct, 32-round textual pre-parse pass — available
at parse time with exact node provenance and correct nesting.

**One hazard, and it is real.** `NodeFlagsReparsed` nodes are deliberately *skipped*
in ~16 places in `internal/astnav/tokens.go` (:76, :104, :135, :146, :157, :165,
:173, :176, :354, :375, :393, :497, :501, :631, :641, :744) because their `Loc`
overlaps real source. `astnav` is the position→token mapping the language service
depends on (`ls/hover.go:44` `astnav.GetTouchingPropertyName`). Desugaring at parse
time therefore requires an audit of `astnav/tokens.go`, or hover and go-to-definition
will silently miss the desugared regions. Budget **~40-80 changed lines** there.
`grammarchecks.go` has ~20 more `NodeFlagsReparsed` checks.

### 3.2 Per-form analysis

#### `defer expr` / `errdefer expr`

**The `defer` token already exists.** `internal/scanner/scanner.go:55` has
`"defer": ast.KindDeferKeyword`, and `KindDeferKeyword` is both `KindLastKeyword`
and `KindLastContextualKeyword` (`kind_generated.go:399, 422`). Upstream added it
for TC39 `import defer` (`parser.go:2297, 2305, 2312, 5243, 6105, 6154, 6177`).
Because it is contextual it still parses as an identifier in expression position,
so today `defer cleanup()` is exactly the JS instrument's situation.

Better still, **there is an existence proof that a keyword costs nothing**:
`"immediate": ast.KindImmediateKeyword` (`scanner.go:69`) is referenced by exactly
two places in the whole tree — the keyword map and
`api/encoder/decoder_generated.go:195`. It is a reserved-but-unused keyword with
zero grammar impact.

Hard constraint to respect — `scanner.GetIdentifierToken` (`scanner.go:2214-2221`):

```go
if len(str) >= 2 && len(str) <= 12 && str[0] >= 'a' && str[0] <= 'z' {
    keyword := textToKeyword[str]
    ...
```

**A keyword must be 2-12 ASCII characters starting `a`-`z`, or it silently never
matches.** `defer` (5) and `errdefer` (8) both qualify.

- Scanner: **0 lines for `defer`**; `errdefer` is 1 line in `textToKeyword`
  (`scanner.go:36-122`) plus 3 lines in `ast.json` (kind element at the end of the
  keyword block + bump `LastKeyword` and `LastContextualKeyword`). `textToToken`
  picks it up automatically via `maps.Copy` at `scanner.go:188`.
- Parser: two `case` arms in `parseStatement` (`parser.go:1063`) plus two ~12-line
  parse functions modelled on `parseThrowStatement`/`parseReturnStatement`
  (`parser.go:1367-1379`), gated on `p.contextFlags & ast.NodeFlagsSmithers`.
- AST: two new statement kinds inside the statement range, each
  `{ StatementBase; Expression }` — ~20 lines in `ast.json` each.
- **Recommendation: real grammar.** The cheapest of the five forms, and the one
  where pre-parse recovery is most fragile (`SMITHERS1710` exists precisely because
  textual recovery cannot see block structure).
- Size: **changed ~25** (scanner 1, parser dispatch 4, parse functions ~24, the 11
  hand-written kind switches), **new ~45 in `ast.json`**.

#### `break :label value`

`parseBreakStatement` (`parser.go:1338-1347`) is 10 lines:
`parseExpected(KindBreakKeyword)` → `parseIdentifierUnlessAtSemicolon()` →
`parseSemicolon()`. **`:` after `break` is currently unambiguously an error**, so
`p.parseOptional(ast.KindColonToken)` before the identifier plus
`if !p.canParseSemicolon() { value = p.parseExpressionAllowIn() }` after it is a
conflict-free extension.

Add a `Value` member to the existing `BreakStatement` node in `ast.json`
(`ast.json:1424-1435`) rather than a new kind — `Label` is already
`optional`, the node is small, and the printer/binder/checker switches for
`KindBreakStatement` are few. (`ContinueStatement` stays untouched.)

- **Recommendation: real grammar.** The JS instrument's textual rewrite of
  `break :label value` into `{ value; break label; }` cannot survive nested
  constructs — that is what `SMITHERS1714`'s cross-construct escape rule is refusing.
- Size: **changed ~6 parser lines + ~15 downstream** (binder label handling
  `binder.go:639, 1691`; printer `printer.go:4186`; `ls/documenthighlights.go`,
  `ls/findallreferences.go`), **new ~8 in `ast.json`**.

#### Loop `else`

**This is cheaper than it first appears, because there is no `parseLabeledStatement`.**
Labels are parsed opportunistically inside `parseExpressionOrLabeledStatement`
(`parser.go:1519-1543`): parse an expression, and if it is an `Identifier` followed
by `:`, build a `LabeledStatement`. So a loop `else` attaches to the
**`LabeledStatement`**, not to the five loop node types:

```go
if expression.Kind == ast.KindIdentifier && p.parseOptional(ast.KindColonToken) {
    result := p.finishNode(p.factory.NewLabeledStatement(expression, p.parseStatement()), pos)
    // + if p.parseOptional(ast.KindElseKeyword) { ... }
```

Add an optional `ElseStatement` member to `LabeledStatement`
(`ast.json:1602-1617`) and ~5 lines here. That matches the language design anyway:
`poc/src/language/README.md` defines loop values only through *labeled* break
values plus the loop `else`, and explicitly keeps unlabeled loop expressions
fail-closed (`SMITHERS1702`).

The remaining cost is **control flow**, and it is real. The binder builds the flow
graph (`internal/ast/flow.go`, `internal/binder/binder.go`); `internal/checker/flow.go`
(2,764 lines) walks it. A loop `else` is a genuine new edge — taken on normal
completion and on plain `break label`, not on a value break — and
`checkAllCodePathsInNonVoidFunctionReturnOrThrow` (`checker.go:3736`) and
`functionHasImplicitReturn` (`checker.go:20418`) both read that graph.

- **Recommendation: real grammar, but last.** Keep the wrapper-block recovery
  (`SMITHERS1715`) until the rest of the grammar has landed and the binder work can be
  a focused change.
- Size: **changed ~12 parser + ~60-90 binder/checker flow + ~20 printer/format**,
  **new ~7 in `ast.json`**.

#### `if (const x = f(); cond)`

`parseIfStatement` (`parser.go:1240-1256`) is 17 lines. The template is right next
door — `parseForOrForInOrForOfStatement` (`parser.go:1292-1336`), specifically the
initializer sniff at :1298-1308:

```go
if p.token == ast.KindVarKeyword || p.token == ast.KindLetKeyword || p.token == ast.KindConstKeyword ||
    p.token == ast.KindUsingKeyword && p.lookAhead(...) ||
    p.token == ast.KindAwaitKeyword && p.lookAhead(...) {
    initializer = p.parseVariableDeclarationList(true /*inForStatementInitializer*/)
}
```

`parseVariableDeclarationList(true)` (`parser.go:1554-1596`) already sets
`NodeFlagsLet/Const/Using/AwaitUsing` from the token and sets
`NodeFlagsDisallowInContext` while parsing (:1589-1592), and
`isListTerminator(PCVariableDeclarations)` (`parser.go:928-937`) already stops at
`;` via `canParseSemicolon()`. **It needs no changes.**

`IfStatement` gains an optional `Initializer` member and `"LocalsContainerBase"` in
its `extends` list (`ast.json:1295-1323`), exactly mirroring `ForStatement`
(`ast.json:1358-1387`). The scoping the POC calls "provisional" (`SMITHERS1717`: the
binding *is* visible in `else`) becomes **provable** — the binder creates the
container — which is a genuine correctness upgrade over the block rewrite.

- **Recommendation: real grammar.** Stock TypeScript cannot parse this form *at
  all*; there is no recovery shape to lean on, which is exactly why the JS
  instrument must do a textual block rewrite and refuse every unprovable shape.
- Size: **changed ~10 parser + ~50-80 downstream** (`binder.go:1671`,
  `checker.go:2337` `checkIfStatement`, `printer.go:3464` `emitIfStatement` and
  `:4164`, `format/`), **new ~7 in `ast.json`**.

#### Value-position `if` / `switch`

**Recommendation: do *not* make these expressions. Desugar them onto the labeled
forms above.** Making `if`/`switch` expressions means expression-position node
kinds plus a checker join rule in `checker.go`'s expression dispatch
(`checkExpression*`) — the single most merge-hostile code in the tree, inside a
32,296-line file.

Instead: **`break :label value` and loop `else` are the grammar; value `if`/`switch`
is sugar.** The desugaring target already exists in the language design (a labeled
block whose value breaks carry the branch results), and the fork gives us the
mechanism: `p.reparseList` (§3.1c) splices synthesized statements into the
containing statement list before the statement being parsed, at the right nesting
level, with authored `Loc` inherited via `finishReparsedNode` (`reparser.go:13`) —
which is precisely "hoist the construct and every impure earlier operand into
compiler temporaries before the statement".

Doing this at parse time with real node provenance retires, as a class:
`SMITHERS1707` (order-unpreservable placements), `SMITHERS1708` (callee stability via a
whole-module write scan), `SMITHERS1709` (braceless branches in expression position),
the 256-construct / 32-edit-round budget, and the "prove the extent through the
parser's own recovery shape, then mask it" pass. **This is the single biggest
simplification available in the whole migration.**

- Cost: the desugar itself is **new ~600-900** in a fork-owned
  `internal/smithers/desugar` (or in `reparser.go`-style parser methods), plus the
  `astnav/tokens.go` audit from §3.1c (**~40-80 changed**), because the language
  service currently skips `NodeFlagsReparsed` nodes.

### 3.3 The generator problem — grammar is cheap to write, expensive to vendor

Adding grammar is **not** expensive in lines. The table below is the whole cost of
the five forms in hand-written source:

| change | hand-written lines | where |
|---|---|---|
| new contextual keyword (`errdefer`) | ~4 | `ast.json` ×3, `scanner/scanner.go` ×1 |
| new `Kind` inside the statement range + marker bump | ~3 | `ast.json` |
| new AST node type (3 members) | ~25-30 | `ast.json` **only** — all Go generated |
| new `parseStatement` case | ~2 | `parser.go:1063-1122` |
| new `if`-shaped statement parse function | ~18 | `parser.go` |
| `break :label value` | ~15 | `ast.json`, `parser.go:1338` |
| labeled loop `else` | ~12 | `ast.json`, `parser.go:1519-1532` |
| `if (const x = f(); cond)` | ~60-90 | `ast.json`, `parser.go:1240`, `binder.go:1671`, `checker.go:2337`, `printer.go:3464/4164` |
| dialect gate (`NodeFlags` bit 29) | ~4 | `nodeflags.go`, `parser.go:305-312` |
| new diagnostic message | ~5 | `diagnostics/diagnosticMessages.json` or `extraDiagnosticMessages.json` |
| full downstream support per new statement kind | ~80-150 | binder, checker, printer, transformers, format, ls |

**The expense is the build contract, not the code.** The regeneration chain is:

```
npx hereby generate:ast          # tools/scripts/tsc/generate.ts -> ast_generated.go, kind_generated.go,
                                 #   api/encoder/{encoder,decoder}_generated.go, packages/typescript/src/api/node/*
go generate ./internal/ast       # stringer -> kind_stringer_generated.go
go generate ./internal/diagnostics   # diagnostics_generated.go, loc_generated.go
npx hereby generate:enums        # kind_generated.go -> packages/typescript/src/enums
go -C ./tools run ./gen-proto    # internal/api/proto.go -> packages/typescript/src/api/proto.generated.ts
npx dprint fmt
```

That requires Node, the repo's npm tree (`npm ci`), and **`tools/`, `Herebyfile.mjs`,
`package.json`, `package-lock.json`, and `packages/typescript/`** — none of which
are in the current `tsc`-only sparse checkout.

**Concrete requirement for the vendoring work:** `vendor/typescript` must include
at minimum `tools/`, `Herebyfile.mjs`, `package.json`, `package-lock.json`, and
`go.work` (which already lists `./tools`), not only `tsc/`. Otherwise Stage 4 is
blocked on a repo-shape change at exactly the moment it is most expensive to make.
`internal/diagnostics/{diagnosticMessages,extraDiagnosticMessages}.json` and
`internal/diagnostics/generate.go` are the happy exception — all three live *inside*
`tsc/` and `go generate` needs nothing else, so **SMITHERS diagnostic codes are a
self-contained, in-`tsc` change.** `extraDiagnosticMessages.json` (346 lines,
codes from 100000) is the fork-owned host that avoids conflicting with upstream's
8,559-line `diagnosticMessages.json`.

---

## 4. Q3 — Type-level rows

### 4.1 Where function types are computed and cached

All in `internal/checker/checker.go`:

| function | line | cache |
|---|---|---|
| `getTypeOfSymbol` | 16587 | `valueSymbolLinks` |
| `getTypeOfVariableOrParameterOrProperty` | 16638 | |
| `getTypeOfFuncClassEnumModule` | 16998 | |
| `getSignatureFromDeclaration` | **19950** | `c.signatureLinks.Get(declaration).resolvedSignature` |
| `getReturnTypeOfSignature` | **20115** | `sig.resolvedReturnType` |
| `getReturnTypeFromAnnotation` | 20169 | |
| `getReturnTypeFromBody` | **20240** | |
| `checkAndAggregateReturnExpressionTypes` | **20373** | |
| `newSignature` / `cloneSignature` | 25370 / 19424 | |

`getReturnTypeOfSignature` is the exact template for a row computation, including
cycle breaking:

```go
func (c *Checker) getReturnTypeOfSignature(sig *Signature) *Type {
    if sig.resolvedReturnType != nil { return sig.resolvedReturnType }
    if !c.pushTypeResolution(sig, TypeSystemPropertyNameResolvedReturnType) { return c.errorType }
    ...
    t = c.getReturnTypeFromAnnotation(sig.declaration)
    if t == nil {
        if !ast.NodeIsMissing(sig.declaration.Body()) {
            t = c.getReturnTypeFromBody(sig.declaration, CheckModeNormal)
        } else { t = c.anyType }
    }
    if !c.popTypeResolution() { ... }
```

`pushTypeResolution` / `popTypeResolution` / `findResolutionCycleStartIndex` are the
checker's built-in fixed-point machinery — precisely what the POC re-implemented
by hand for cross-module row propagation. `TypeSystemPropertyName` is a plain iota
enum at `checker.go:57-66`; adding `TypeSystemPropertyNameResolvedFailureRow` is
**1 changed line**.

Body traversal already exists with the right scoping:
`ast.ForEachReturnStatement` (`internal/ast/utilities.go:1157`) walks statements
and **deliberately does not descend into nested functions**. A sibling
`ForEachThrowStatement` with the same `switch` is ~15 new lines and gives throw
aggregation with identical per-function scoping. Note the checker currently
*discards* thrown types: `checkThrowStatement` (`checker.go:4233`) is 8 lines and
calls `c.checkExpression(throwExpr)` for its side effects only. That is the
cheapest single hook for collecting the throw side of an `E` row.

### 4.2 Where rows can and cannot live

**Cannot: `TypeFlags`.** `internal/checker/types.go:425` is `uint32` and every bit
is allocated through `TypeFlagsIntersection = 1 << 28`, then `Reserved1/2/3` at
29/30/31, of which `Reserved1` and `Reserved2` are already aliased as
`TypeFlagsIncludesConstrainedTypeVariable` / `TypeFlagsIncludesError`. The header
comment explicitly warns that the *numeric order* determines `CompareTypes` and
therefore union constituent order — so widening to `uint64` is not mechanical, it
is a correctness- and performance-sensitive change across 60,456 lines.
`ObjectFlags` (`types.go:593`) is `uint32` with bit 30 used and bits 22-30
overloaded three ways by type kind; only bit 31 is nominally free and taking it is
risky.

**Can, cheaply: `SignatureFlags`.** `types.go:1266` is `uint32` with only bits 0-8
used. 23 free bits for markers like "this signature has a computed row".

**Can, cheaply: the links mechanism.** `internal/core/linkstore.go` provides
`LinkStore[K, V]` with lazy `Get`. `Checker` declares ~30 of them at
`checker.go:676-707`. Adding

```go
smithersRowLinks core.LinkStore[*ast.Node, SmithersRowLinks]
```

next to `signatureLinks` is **2 changed lines** (field + struct definition) with
zero initialization code. Alternatively add two fields to `Signature`
(`types.go:1290`) — also one line each, and `cloneSignature` (`checker.go:19424`)
is a struct copy so instantiated signatures inherit them automatically (which is
either exactly right or exactly wrong for polymorphic row templates; decide
deliberately and clear them in `cloneSignature` if instantiation must re-derive).

There is **no map anywhere keyed by `*Signature`**, but signatures come from
`c.signatureArena` (`checker.go:670`) so pointers are stable and a
`map[*Signature]Row` on `Checker` is also viable.

### 4.3 Getting rows across module boundaries and into `.d.ts`

Declaration emit: `transformers/declarations/transform.go`, entry
`NewDeclarationTransformer` (:104), driven from `compiler/emitter.go:60-66, 78-88, 221`.
It reaches the checker only through `printer.EmitResolver`
(`internal/printer/emitresolver.go:77-129`), specifically the node-construction
methods at :117-127 (`CreateTypeOfDeclaration`, `CreateReturnTypeOfSignatureDeclaration`, …),
called from `DeclarationTransformer.ensureType` (`transform.go:1636`). Those route
into `checker.NodeBuilder` (`internal/checker/nodebuilder.go:10`), whose
`SerializeReturnTypeForSignature` (:117) *has the `*Signature` in hand* at the exact
moment it builds the `.d.ts` return-type node — the ideal attach point.

**`@smithersEffects` as a JSDoc carrier works, and there is exact precedent.**
`printer.EmitContext.AddSyntheticLeadingComment(node, kind, text, hasTrailingNewLine)`
(`internal/printer/emitcontext.go:1018`) is already used by
`DeclarationTransformer.preservePartialJsDoc` (`transform.go:1613`) with the
`ast.KindMultiLineCommentTrivia` + leading-`*` trick that makes the printer emit
`/** … */`. Critically, synthetic comments go through
`(*Printer).emitLeadingSyntheticCommentsOfNode` (`internal/printer/printer.go:5466`),
which **bypasses `shouldWriteComment`** (`printer.go:745`) entirely — so
`OnlyPrintJSDocStyle: true` (set for declaration emit at `compiler/emitter.go:256`)
cannot drop it. Only `--removeComments` (`printer.go:189`) and an
`EFNoComments`/`EFNoNestedComments` emit flag on an ancestor suppress it; note
`DeclarationTransformer.removeAllComments` (`transform.go:1629`) sets exactly that,
so avoid nodes it touches.

Read-back: there is **no `ast.GetJSDocTags`**. The pattern is
`node.JSDoc(file)` (`internal/ast/ast.go:1560`) → `jsdoc.AsJSDoc().Tags.Nodes`,
canonically via the unexported `getAllJSDocTags` (`internal/checker/jsdoc.go:83`,
the whole file is 100 lines — copy or export it). `@smithersEffects` lands as
`ast.KindJSDocUnknownTag` and we parse the payload ourselves. Two caveats:

- For TS/TSX files including `.d.ts`, **JSDoc is parsed lazily**
  (`internal/parser/jsdoc.go:60`): `withJSDoc` sets `NodeFlagsHasJSDoc` and returns
  without parsing unless the comment has `@see`/`@link`. First access triggers
  `(*SourceFile).resolveJSDoc` (`ast/ast.go:2758`), mutex-guarded and memoized into
  `jsdocCache`. Reading rows back from a `.d.sm.ts` therefore costs a one-time lazy
  parse per node — cheap, thread-safe, but not free.
- The reparser (`internal/parser/reparser.go:54`) does **not** run for TS files, so
  the tag will never become typed syntax automatically.

### 4.4 Is there existing extensibility? No.

Exhaustive grep for `plugin|hook|Registry|registerTransform|extensib` across
`tsc/internal` (non-test) returns exactly three things:

1. `internal/tsoptions/commandlineoption.go:133-136` — the `plugins` tsconfig key
   exists **only so `tsconfig.json` does not error**. Nothing reads it. This is Go;
   there is no dynamic loader.
2. `internal/printer/printer.go:55` `type PrintHandlers struct` — one live hook,
   `HasGlobalName func(string) bool`. `OnEmitNode`, `IsEmitNotificationEnabled`, and
   `SubstituteNode` — the Strada extension points — are **commented out with the
   codebase's `// !!!` NYI marker**, and both `emitJSFile` (`compiler/emitter.go:216`)
   and `emitDeclarationFile` (:272) pass an empty struct.
3. `internal/project/configfileregistry.go` — an LSP tsconfig cache, unrelated.

There is no diagnostic-rule registry either; diagnostics are generated constants
in `internal/diagnostics/` reported by hardcoded `c.error(...)` calls.

**The one genuine seam is `printer.EmitResolver`** (`internal/printer/emitresolver.go:77`),
because the declaration transformer talks to the checker *only* through it. A
decorator around `EmitResolver` is the least-invasive way to inject row data into
declaration emit without touching `transform.go` at all.

### 4.5 The out-of-process escape hatch, and why it is not enough

`internal/api/` (9,391 lines) is a full out-of-process API server exposing the real
checker: `getTypeAtLocation`, `getSymbolAtPosition`, `getResolvedSignature`,
`getTypeOfSymbol`, `getSignaturesOfType`, `transpileModule`, `parseConfigFile`
(`internal/api/proto.go:62-110`). Combined with the fact that `cmd/` is inside the
module (§1), this means a Smithers content mapper built as `tsc/cmd/smithersmap` can
build its **own** `compiler.Program` over the lowered TypeScript and run real
checker-backed row inference — exactly what the POC's `analyzeProject` does with
`typescript-js` — with **zero fork diff**.

**And that is where the content-mapper path hits its hard wall.** The transform
cache key is

```go
key := contentMappedParseCacheKey(parseOptions, fh.Hash(), transformIdentity, diagnosticLocale)
                                                // internal/project/compilerhost.go:130-131
```

where `transformIdentity` is `combinedIdentity(mapper, configIdentity, compilerOptions)`
(`internal/contentmapper/hostimpl.go:641-651`) — mapper version, mapper options,
the mapper's *declared* compiler options, and `ConfigIdentity`. **It does not
include any other file's content.** A cross-module row change in `b.sm` will not
invalidate the cached transform of `a.sm`.

The only escape is `Manifest.DynamicConfig` + `OpenProjectResult.WatchedFiles`
(`hostimpl.go:75-84, 683-692`): a mapper that declares every project `.sm` file as
a watched file and folds their content hashes into `ConfigIdentity`. That is
correct — and it invalidates **every** file's cached transform on **any** `.sm`
edit. In batch `tsc` that is acceptable. In the LSP it is O(N) full re-transforms
per keystroke.

> **This is the load-bearing finding of §4.** Rows can be *computed* out of process
> with zero fork diff, and that is the right thing to do first. But rows can never
> be *incrementally* computed out of process, because the plugin cache identity is
> per-file by construction. Whole-program `E`/`R` inference must eventually move
> into the checker, where `pushTypeResolution` and the link stores already provide
> exactly the fixed-point and invalidation machinery it needs.

### 4.6 Recommended shape

- **Now (0 changed lines):** rows computed in `cmd/smithersmap`'s own Program; emitted
  into the virtual TypeScript as explicit `Result<A, E>` annotations so the main
  Program checks them structurally; `@smithersEffects` written into `.d.sm.ts` by the
  mapper's own declaration pass.
- **Later (~60 changed, ~2,000 new):** `Signature.resolvedFailureRow` +
  `TypeSystemPropertyNameResolvedFailureRow` + `getFailureRowOfSignature` mirroring
  `getReturnTypeOfSignature` + `ast.ForEachThrowStatement` + a new
  `internal/checker/vibrows.go`, with `@smithersEffects` emitted from
  `NodeBuilder.SerializeReturnTypeForSignature` (`checker/nodebuilder.go:117`).
- **Never:** a new `TypeFlags` bit. There isn't one.

---

## 5. Q4 — Lowering

### 5.1 Exact insertion point

`getScriptTransformers` — **`internal/compiler/emitter.go:112-179`**, driven by
`(*emitter).runScriptTransformers` (:68-76, tracing marker literally
`"transformNodes"`) from `emitJSFile` (:181-219, call at **:200**). The ordered
list:

```
[EmitDecoratorMetadata] MetadataTransformer
                        TypeEraserTransformer          // emitter.go:145
[importElision]         ImportElisionTransformer
                        RuntimeSyntaxTransformer       // enum/namespace/param props
[experimentalDecorators] LegacyDecoratorsTransformer
[jsx]                   JSXTransformer
                        estransforms.GetESTransformer  // ES downlevel chain
                        UseStrictTransformer
                        getModuleTransformer(...)      // emitter.go:90-110
[!isolatedModules]      ConstEnumInliningTransformer
```

**Insert the Smithers transform between the `opts` literal (ends `emitter.go:135`)
and the `// transform TypeScript syntax` block (`:137`)** — before
`NewTypeEraserTransformer` at :145, so the transform still sees TypeScript type
annotations, which is what a `Result<A, E>` lowering needs.

```go
tx = append(tx, smitherstransforms.NewSmithersTransformer(&opts))
```

**Changed: 2-4 lines** (one append plus an import).

Declaration emit is a separate pipeline: `getDeclarationTransformers`
(`emitter.go:60-66`) → `NewDeclarationTransformer` → `NewSupplementalReferencesTransformer`,
driven from `emitDeclarationFile` (:221, transform call at :238).

`Transformer` is a **struct, not an interface** (`internal/transformers/transformer.go:8-41`);
transforms embed it and call `NewTransformer(visit, emitContext)`. Composition is
`transformers.Chain` (`chain.go:38-62`), sequential over whole source files.

### 5.2 Can a transform consult the checker? Only through a narrow, type-free window.

`TransformOptions` (`internal/transformers/chain.go:26-32`) carries
`Resolver binder.ReferenceResolver` and `EmitResolver printer.EmitResolver`.
**It does not carry `*checker.Checker`, and `printer.EmitResolver`
(`internal/printer/emitresolver.go:77-129`) exposes no `*checker.Type` at all** —
no `GetTypeAtLocation`, no `TypeToString`, no assignability. The closest thing to a
type query in the whole interface is
`GetTypeReferenceSerializationKind(name, serialScope) TypeReferenceSerializationKind`
(:88), a 12-value enum used only for decorator metadata
(`tstransforms/typeserializer.go:26`).

So: **a Smithers transform that needs "is this type a `Result<A, E>`" must extend
`printer.EmitResolver`.** Concretely — add the method to the interface
(`internal/printer/emitresolver.go`), implement it on `checker.EmitResolver`
(`internal/checker/emitresolver.go:34`) under `r.checkerMu` following the pattern
at :53-57 and :950, and decide whether it belongs to the `...Unsafe` family
(:117-119) that may recurse into checking. Also note `getScriptTransformers`
substitutes a **checker-free** `binder.NewReferenceResolver` when nothing needs type
info (`emitter.go:122-127`) — force `emitResolver` on whenever Smithers is active.

**Changed for one new resolver method: ~15-25 lines** across two files. This
number scales linearly with how many distinct type questions the lowering asks,
which is the main reason to keep the type-level work in the checker (§4) and let
the transform ask only coarse yes/no questions.

Precedent for the transform itself: there is **no single existing transform that
both consults the checker and rewrites control flow.** Model the *structure* on
`estransforms/async.go` (984 lines — ES2017 async→Promise downlevel: three node
visitors, a context-flag stack `asyncContextFlags` at :12-17, `super`/`this`/
`arguments` capture, zero checker use), the *resolver plumbing* on
`tstransforms/runtimesyntax.go` (995 lines, holds both resolvers at :27-28), and the
*resolver extension* on `tstransforms/metadata.go` + `typeserializer.go`. The
closest all-round analogue is `estransforms/classfields.go` (3,618 lines): large
control-flow rewrite plus symbol-level resolver queries. `estransforms/using.go`
(799 lines) — the `using`/`await using` downlevel that wraps a block in
try/finally with a disposal stack — is the direct structural template for
`defer`/`errdefer`.

Realistic size for a Smithers lowering package covering Result lifting,
`.unwrap()` propagation, and `defer`/`errdefer`: **new 1,500-3,000 lines** in
`internal/transformers/smitherstransforms/`.

### 5.3 What constrains source-map fidelity

The printer's source-map path is `Write` (`internal/printer/printer.go:5069`) →
`enterNode`/`exitNode` (:6121-6140) → `emitSourceMapsBeforeNode` (:5899) →
`emitSourcePos` (:5870) → `emitPos` (:5833) → `sourcemap.Generator.AddSourceMapping`
(`internal/sourcemap/generator.go:273`).

**Four gates. A synthesized node must pass all four or it silently gets no
mapping at all:**

1. `shouldEmitSourceMaps(node)` (`printer.go:812`) — not disabled, source set, not
   the source file, not JSON.
2. `printer.go:5907-5912` — `!IsNotEmittedStatement`, `emitFlags & EFNoLeadingSourceMap == 0`,
   `p.currentSourceFile != nil`, and **`!ast.PositionIsSynthesized(loc.Pos())`**.
3. `emitPos` (:5834) bails on `PositionIsSynthesized(pos)`.
4. `AddSourceMapping` (`generator.go:274-288`) errors on a backtracking *generated*
   line, and the printer **panics** on that error (`printer.go:5846`).

Gate 2 is the trap. `EmitContext.SourceMapRange(node)` (`emitcontext.go:623-628`)
falls back to `node.Loc`, and a fresh `NodeFactory` node has `Pos() == -1`. So
**every synthesized node emits with no mapping, and the previous mapping simply
runs on through the generated text.** To get fidelity, the transform must call
`SetSourceMapRange` (`emitcontext.go:631`) or `AssignSourceMapRange`/
`AssignCommentAndSourceMapRanges` (:638, :643) per node. `SetOriginal`
(`emitcontext.go:479-496`) does **not** by itself create a mapping — it exists for
resolver lookups, not for maps.

Three further hard constraints:

- **Ranges are positions into `p.currentSourceFile.Text()`** — `emitSourceMapsBeforeNode`
  calls `scanner.SkipTrivia(p.currentSourceFile.Text(), loc.Pos())` (`printer.go:5911`).
  You cannot point at another file's coordinates through this path.
- **Names are not supported.** `Generator.AddNamedSourceMapping` exists
  (`generator.go:294`) but both printer call sites are commented out
  (`printer.go:5850-5868`, :5885-5897, `// TODO: Support emitting nameIndex for
  source maps`). A renamed Smithers temporary cannot carry its authored identifier
  into the map. This matches the POC's own "names/scopes are not encoded" limit.
- **Generated positions must be monotonic**; source positions may backtrack
  (`isBacktrackingSourcePosition`, `generator.go:132`). Reordering source
  constructs is fine; reordering *output* is a panic.

### 5.4 The content-mapper emit wall, and its four-site fix

`sourceFileMayBeEmitted` — **`internal/compiler/emitter.go:474-481`**:

```go
// Runtime output for content-mapped files is owned by the external content mapper or build tool. Only
// include them in the emit set when their transformed TypeScript can produce declarations.
if sourceFile.ContentMapper() != "" && !forceDtsEmit && !options.GetEmitDeclarations() {
    return false
}
```

and **`internal/compiler/emitter.go:227-230`**:

```go
// Declaration files for content-mapped files don't get source maps because the mapped positions would point into
// transformed TS content that exists only in-memory during the build. As a future improvement, it may be possible
// to double-map the positions using the content-mapped file's spanmap.
emitDeclarationMap := e.emitOnly != EmitOnlyBuilderSignature && options.DeclarationMap.IsTrue() && sourceFile.ContentMapper() == ""
```

**Upstream names our exact fix in its own comment.** The four sites:

| # | site | change | changed lines |
|---|---|---|---|
| 1 | `internal/compiler/emitter.go:479` | gate the suppression on a new mapper capability (`Manifest.OwnsRuntimeEmit bool`) or `core.CompilerOptions` field | ~4 |
| 2 | `internal/outputpaths/outputpaths.go:57` | same gate for the JS output path | ~3 |
| 3 | `internal/outputpaths/outputpaths.go:183-198` | `ChangeToJSExtension` consulting `host.ContentMapperExtensions()`, mirroring `ChangeToDeclarationExtension` (:148-151) — else `main.sm` → `main.sm.js` (§2.6) | ~8 |
| 4 | `internal/printer/printer.go:5833` `emitPos` + a `contentMappedSource` implementing `sourcemap.Source` (a 3-method interface: `Text()`, `FileName()`, `ECMALineMap()`, `internal/sourcemap/source.go:5-9`) | map `pos` through `SpanMap.VirtualToOriginalPosition` and `return` on `FidelityNone`; `setSourceMapSource` (`printer.go:5805`) then registers the authored file name and text | ~30 changed + ~60 new |
| 5 | `internal/compiler/emitter.go:230` + `internal/outputpaths/outputpaths.go:65` | enable declaration maps through the same double-mapping | ~5 |

**Total: ~50 changed, ~60 new.** In exchange this deletes, from
`compiler/forkbridge/main.go.txt`, the entire second `Program`
(`newEmitProgram`, `runEmitProgram`), `composeEmittedMap`, `adjustGeneratedColumn`,
`planSpecifierEdits`, `applySpecifierEdits`, `rewriteSourceMapURL`,
`decodeSuppliedMap`, `mapLoweredPosition`, `mapLoweredSpan`, and the whole
`LoweredSource` / `LoweringExternal` protocol in `compiler/api.go` — roughly
**900 lines of Smithers-owned code retired**, and it removes the POC's honest
admission that "authored columns advance one-for-one within a mapping run …
approximate inside replaced tokens", because `spanmap` distinguishes verbatim from
atom segments *by construction* and `Validate` enforces it.

---

## 6. Q5 — Language service

**`smithers lsp` needs almost nothing from the fork.**

`internal/lsp/server.go:408-472`, `RegisterContentMapperExtensions`:

```go
filters := make([]lsproto.TextDocumentFilterLanguageOrSchemeOrPattern, 0, len(extensions))
for _, ext := range extensions {
    filters = append(filters, lsproto.TextDocumentFilterLanguageOrSchemeOrPattern{
        Pattern: &lsproto.TextDocumentFilterPattern{
            Pattern: lsproto.PatternOrRelativePattern{Pattern: new("**/*" + ext)},
        },
    })
}
selector := lsproto.DocumentSelectorOrNull{DocumentSelector: &filters}
```

That one `selector` drives ~26 dynamic capability registrations at
`internal/lsp/server.go:487-677`: didOpen, didChange, didClose, diagnostic, hover,
signatureHelp, definition, typeDefinition, implementation, references,
documentHighlight, completion, rename, semanticTokens, documentSymbol,
foldingRange, selectionRange, inlayHint, codeLens, codeAction, formatting,
rangeFormatting, onTypeFormatting, linkedEditingRange, prepareCallHierarchy,
willRenameFiles. Selection is by **glob**, not language id. Prerequisite:
`clientCapabilities.TextDocument.Synchronization.DynamicRegistration`
(`server.go:413-415`); per-feature gating is `supportsContentMapperRegistration`
(:352-406).

The service is already fidelity-aware end to end. `internal/ls/source_map.go:18-33`
is the central dispatch, with the rule stated in its own doc comments:

> LS features should use this for cross-file results instead of calling
> getMappedLocation or lsconv.ToLSPLocation directly. This unfiltered form is
> appropriate for diagnostics and text edits. […] It applies content-mapper feature
> filtering and follows declaration source maps. Do not use it for diagnostics or
> text edits.

Every feature threads a `spanmap.Feature`: `FeatureHover` (`ls/hover.go:38`),
`FeatureCompletion` (`ls/completions.go:50`), `FeatureDefinition`
(`ls/definition.go:39`), `FeatureRename`/`FeatureReferences`
(`ls/findallreferences.go:655-659`), `FeatureFormatting` (`ls/format.go:62`),
`FeatureCallHierarchy`, `FeatureFoldingRanges`, `FeatureCodeActions`,
`FeatureInlayHints`, `FeatureSemanticTokens`, `FeatureAutoInsert`. Hover bails
unless `positions[0].Fidelity.IsSingleSegment()` (`ls/hover.go:39`) and re-targets
to the virtual file at :42. Diagnostics deliberately bypass feature filtering
(`spanmap.go:37-39`, `ls/diagnostics.go:90`).

`internal/project/` has 156 content-mapper references and a dedicated
`contentmapper_test.go` (991 lines); `internal/lsp/` has 31 plus
`server_contentmapper_test.go`. There is a shared harness at
`internal/testutil/contentmappertest/`.

**So: real diagnostics, hover, completion, go-to-definition, references, rename,
and formatting for `.sm` cost 0 changed lines.** SMITHERS diagnostics ride the mapper's
own `Diagnostic{Start, Length, Code, MessageText}` in **original** coordinates
(`internal/contentmapper/hostimpl.go:212-218`) under a mapper-declared
`diagnosticSource` (:59-60, validated non-empty and not `"typescript"`/`"tsc"` at
:1115-1120). `DiagnosticDirectives` with `MappedDiagnosticDirectivePolicyIgnore`
(`internal/ast/ast.go:2615-2626`) suppress TypeScript diagnostics that land in
lowering glue — which is precisely the mechanism the POC lacks.

**What is not free: rows in hover.** The chain is
`ProvideHover` (`ls/hover.go:28`) → `getQuickInfoAndDocumentationForSymbol` (:128) →
`getQuickInfoAndDeclarationAtLocation` (**:380-882**), which builds display parts
through three closures — `writeTypeClassified` (:398-418, non-VS path is
`dpw.Write(c.TypeToStringEx(t, enclosing, flags, vc))` at :401),
`writeSignatureClassified` (:421-456, `c.SignatureToStringEx(...)` at :424), and
`writeSymbolClassified` (:459-467). Checker side: `TypeToString`
(`internal/checker/printer.go:43`), `TypeToStringEx` (:55), `SignatureToStringEx`
(:183).

Three insertion points, cheapest first:

1. **`ls/hover.go:516`** (after `writeSignatureClassified` inside `writeSignatures`)
   and **`ls/hover.go:692`** (the variable/call-site path). ~10 changed lines, gets
   a row suffix on function hovers only.
2. **`ls/hover.go:398-418`** inside `writeTypeClassified` — the single chokepoint
   for every type in hover. Must handle **both** branches (`:401` plain and
   `:404-417` VS-classified) or Visual Studio silently loses rows.
3. **`checker/printer.go:55`/`:183`** — deepest; also fixes signature help
   (`ls/signaturehelp.go`), inlay hints, completion detail, and error messages.
   Structural (non-string-concatenation) rendering belongs in
   `checker/nodebuilder_hover.go` (597 lines).

`checker.VerbosityContext` (`ls/hover.go:57-64`: `Level`, `MaxTruncationLength`
default 500, `CanIncreaseVerbosity`, `Truncated`) is the natural knob for
"elide the row at verbosity 0, expand at 1", matching the existing type-parameter
expansion at `ls/hover.go:678-693`.

**Total for row-aware hover: ~10-40 changed lines**, depending on depth. Everything
else in the language service is free.

---

## 7. Q6 — The staged plan

Each stage is independently shippable and independently testable. The highest-risk
unknown is proved in Stage 2, before any upstream file is touched.

### Stage 0 — today (baseline)

JS instrument computes everything; `compiler/fork.go` builds a replacement
`cmd/tsc/main.go` via `go build -overlay`; identity content mapper + external
lowering; two `Program`s; ~900 lines of Smithers-owned map composition.
Fork diff: **0 changed, 0 new** (the overlay writes nothing into the checkout).

### Stage 1 — own the entry point, delete the overlay

**Moves:** `compiler/forkbridge/main.go.txt` becomes a real directory
`tsc/cmd/smithersc/` in the fork (plus `tsc/cmd/smithersc/lsp.go` modelled on
`cmd/tsc/lsp.go`, 115 lines, and `api.go` modelled on `cmd/tsc/api.go`, 82 lines).
`compiler/fork.go` builds `./cmd/smithersc` instead of overlaying `./cmd/tsc`; the
`-overlay` flag, `forkBridgeSource` embed, and the digest-in-cache-key logic all go
away. `PinnedTypeScriptRevision` verification and the `--revision` handshake stay.

**Stays:** everything semantic. Identity mapper, external lowering, the JS
instrument, the whole `compiler/api.go` transport.

**Why first:** it unblocks the vendoring work (a vendored subtree becomes
`go build ./cmd/smithersc`, an ordinary Go build with no overlay machinery) and it
removes the "we neither patch the checkout nor import internals across their
visibility boundary" contortion, because `cmd/smithersc` is *inside* the module and
legitimately sees `internal/*`.

**Test:** `compiler/fork_integration_test.go`, `fork_lowering_integration_test.go`,
`fork_protocol_test.go`, `cmd/smithersc-go` — all unchanged, all must still pass.

**Fork diff: 0 changed, ~1,600 new.** Risk: none.

### Stage 2 — Smithers as a real content mapper (**highest-risk unknown, proved here**)

**Moves:** the `identityProject` stub in `forkbridge/main.go.txt:134-152` is
replaced by a real `contentmapper.Mapper` whose implementation is a second fork
binary, `tsc/cmd/smithersmap`, speaking `contentmapper` protocol v1 over JSON-RPC
(`internal/contentmapper/hostimpl.go:31-218`). It emits virtual TypeScript plus a
`spanmap.SpanMap` and SMITHERS diagnostics in authored coordinates. Because it lives
inside the module it builds its own `compiler.Program` and uses the **real Go
checker** for row inference — the JS instrument's `analyzeProject` ported to Go.

**The unknown being proved:** *can Smithers's lowering be expressed as spanmap
segments at the fidelity the POC's source maps achieve?* `spanmap.Validate`
(`internal/spanmap/spanmap.go:192`) is strictly stronger than a source map — every
`KindVerbatim` segment must match the original text byte-for-byte, segments must be
ordered and disjoint in virtual space, original spans must not partially overlap.
If Smithers's return/throw lifting, unwrap propagation, and defer nesting cannot be
segmented this way, **the entire content-mapper path collapses and we are forced
straight to first-class `.sm` (Stage 4) with none of the intermediate wins.** Prove
it before touching anything upstream.

**Stays:** the JS instrument as the *reference implementation* for differential
testing. Every `.sm` fixture must produce identical diagnostics and identical
authored spans from both.

**Test:** port `poc/src/language/*.test.ts` fixtures to a Go corpus; run
`tsc --noEmit` and assert authored spans; `spanmap.Validate` catches every mapping
mistake as a structured error, so the test is "no `MappingError`, and every
diagnostic's mapped span equals the JS instrument's". Ship `smithers check` and
`smithers lsp` with real diagnostics/hover/completion for `.sm`.

**Fork diff: 0 changed, ~4,000-6,000 new** (`cmd/smithersmap` + `internal/smithers/`).

**Known limitation to document, not fix, here:** cross-module row correctness
requires `DynamicConfig` + `WatchedFiles` folding every `.sm` file into
`ConfigIdentity`, which costs O(N) re-transforms per edit (§4.5). Acceptable for
batch; measure it in the LSP and record the number.

### Stage 3 — unsuppress runtime JS emit and make source maps span-aware

**Moves:** the five sites in §5.4. Runtime emit for `.sm` becomes single-Program.
The `LoweredSource` / `LoweringExternal` protocol in `compiler/api.go:43-96` and
the whole composition layer in `forkbridge` are deleted.

**Stays:** everything else.

**Test:** `compiler/fork_lowering_integration_test.go`'s existing assertions —
`action` → `function` with an inserted helper line, authored positions preserved,
helper-line mappings source-less — retargeted at the single-Program path. Add a
regression asserting `main.sm` → `main.js` (not `main.sm.js`). Gate: an unchanged
upstream TypeScript corpus must still emit byte-identically, since sites 1, 2, 3,
and 5 are all behind `sourceFile.ContentMapper() != ""` and site 4 is behind a nil
span map.

**Fork diff: ~50 changed, ~60 new.** First upstream files touched:
`internal/compiler/emitter.go`, `internal/outputpaths/outputpaths.go`,
`internal/printer/printer.go`. All three changes are narrow, all are guarded by an
existing content-mapper predicate, and all are individually revertible.

### Stage 4 — first-class `.sm` and real grammar (**the point of no return**)

**Moves:** §2.5's 20 sites make `.sm` a `tspath` extension; §3.2's parser and AST
work adds `defer`, `errdefer`, `break :label value`, `if (const x = f(); cond)`,
and loop `else` behind `NodeFlagsSmithers`; value `if`/`switch` desugars onto the
labeled forms through `p.reparseList` (§3.1c), which also requires the
`internal/astnav/tokens.go` audit.

**Prerequisite that must land in the vendoring work, not here:** `vendor/typescript`
must carry `tools/`, `Herebyfile.mjs`, `package.json`, `package-lock.json`, and
`packages/typescript/` (§3.3). Without them `ast_generated.go` is un-regenerable
and will drift.

**Stays:** row inference still in `cmd/smithersmap`'s Program — no, it cannot. Making
`.sm` first-class **removes the content mapper**, because
`internal/tsoptions/tsconfigparsing.go:1410` forbids registering a built-in
extension. So Stage 4 forces Stage 5's checker work to land with it or immediately
after. This coupling is the main reason Stage 4 is expensive.

**Why this is the true point of no return — three coupled one-way doors:**

1. **Extension identity.** `.sm` as a content-mapper extension and `.sm` as a
   builtin are mutually exclusive by explicit upstream guard (§2.3). Flipping means
   the `**/*.sm` LSP registration path, the `x.d.sm.ts` naming rule
   (`outputpaths.go:148-151`), the `resolvedUsingExtraExtensions` bypass
   (`module/util.go:154`), and every downstream cache key all change at once. There
   is no A/B, no gradual rollout, no fallback.
2. **The vendoring contract.** `ast_generated.go` and `kind_generated.go` are
   generated by `tools/scripts/tsc/generate-go-ast.ts`, which is **outside `tsc/`**
   and outside the current sparse checkout (§3.3). Every upstream rebase after this
   point is a regenerate-and-diff operation, not a text merge, and requires Node
   plus the repo's npm tree.
3. **Published artifacts.** Once `.d.sm.ts` files with fork-defined shape are
   published to a registry, downstream consumers are pinned to our resolution and
   naming rules.

Stages 1-3 are all revertible in an afternoon. Stage 4 is not.

**Test gate (from `poc/FINDINGS.md` P0):** an unmodified upstream TypeScript
conformance corpus must stay byte-identical for `.ts`/`.tsx`, enforced by
`NodeFlagsSmithers` gating on every new grammar rule — which is why we reject the
`checkJSSyntax` pattern (§3.1a option c) despite its better error messages. Plus a
separate `.sm` corpus for shared syntax and intentional divergences. A second gate
is mandatory here and easy to forget: **regenerate the Go and TypeScript sides of
`api/encoder` together** and assert the LSP/API round-trip, because `Kind` crosses
that boundary numerically (§3.1).

**Fork diff: ~300-450 changed** (of which ~60-90 is `.sm` file recognition, ~120-200
is grammar downstream support, ~40-80 is the `astnav` audit), **~700 new in
`ast.json` and parser methods, ~600-900 new in the desugar pass**, plus generator
input changes outside `tsc/`.

### Stage 5 — rows in the checker

**Moves:** §4.6's later half. `Signature.resolvedFailureRow` /
`resolvedRequirementRow`, `TypeSystemPropertyNameResolvedFailureRow`,
`getFailureRowOfSignature` mirroring `getReturnTypeOfSignature`
(`checker.go:20115`), `ast.ForEachThrowStatement` mirroring `ForEachReturnStatement`
(`ast/utilities.go:1157`), a `core.LinkStore[*ast.Node, SmithersRowLinks]` on `Checker`
(`checker.go:~677`), row emission from `NodeBuilder.SerializeReturnTypeForSignature`
(`checker/nodebuilder.go:117`) as a synthetic `@smithersEffects` JSDoc comment
(`emitcontext.go:1018`, precedent `declarations/transform.go:1613`), read-back
through `ast.KindJSDocUnknownTag`.

**Stays:** `@smithersEffects` remains the explicitly-unstable carrier. The eventual
decision to make rows *real syntax* in `.d.sm.ts` is a separate, later,
compatibility-breaking choice.

**Test:** the POC's `generic-rows.test.ts`, `qualified-rows.test.ts`,
`nominal-errors.test.ts` fixtures, ported; plus an incremental-checking suite that
Stage 2 cannot pass (edit `b.sm`, assert `a.sm`'s row changes without re-checking
the world) — that suite is the *reason* for this stage.

**Fork diff: ~60 changed, ~2,000-3,000 new.**

### Stage 6 — lowering moves into the fork's transform pipeline

**Moves:** `internal/transformers/smitherstransforms/`, inserted at
`internal/compiler/emitter.go:137` (§5.1), plus whatever `printer.EmitResolver`
methods it needs (§5.2). `cmd/smithersmap` is deleted.

**Test:** every emitted-JS execution test the POC runs (`project.test.ts` writes
modules to disk, stock-checks them, and runs the entry under a real Node loader),
retargeted at fork-emitted output.

**Fork diff: ~40 changed** (transformer insertion + resolver methods), **~1,500-3,000 new**.

### Summary

| stage | changed | new | revertible | ships |
|---|---|---|---|---|
| 1 entry point | 0 | ~1,600 | yes | overlay deleted, vendorable build |
| 2 real content mapper | 0 | ~4,000-6,000 | yes | `smithers check` + `smithers lsp`, real diagnostics/hover |
| 3 JS emit + span maps | ~50 | ~60 | yes | single-Program emit, ~900 Smithers lines retired |
| **4 first-class `.sm` + grammar** | **~300-450** | **~1,300-1,600** | **no** | real syntax; `SMITHERS1702`/`1707`/`1708`/`1709` retired |
| 5 rows in checker | ~60 | ~2,000-3,000 | mostly | incremental cross-module rows |
| 6 fork-owned lowering | ~40 | ~1,500-3,000 | yes | one pipeline, one Program |
| **total** | **~450-600** | **~11,000-15,000** | | |

---

## 8. Q7 — The honest verdict

### The goal as written is half-right and half-wrong

`docs/DECISIONS.md` says: *"The fork should make TypeScript extensible/configurable
through a narrow plugin interface rather than embedding every Smithers feature
directly throughout upstream code."*

**Half-right, and better than we knew.** The narrow plugin interface exists,
upstream, today: `internal/contentmapper` + `internal/spanmap` + the LSP's dynamic
`**/*.sm` registration + the `tsc/cmd/` module-internal escape hatch. It is a
*versioned, validated, cached, out-of-process, LSP-integrated* language-hosting
protocol, and it is materially better than the `compiler.Extension` interface
sketched in `compiler/api.go:152-159`. We should delete that sketch and adopt
theirs. Stages 1 and 2 deliver a working `smithers check` and `smithers lsp` with **zero
changed upstream lines**, which is a stronger result than the decision anticipated.

**Half-wrong, in three specific places, and no amount of design avoids them:**

1. **Emit.** Upstream *chose* to delegate runtime JavaScript to the mapper
   (`internal/compiler/emitter.go:477-481`) and *chose* not to double-map through
   the span map (:227-230). Smithers is a language with a compiler, not a
   build-tool plugin; we must own emit. That is a ~50-line change to three upstream
   files. There is no plugin-shaped alternative — the printer's source-map writer
   (`internal/printer/printer.go:5805-5848`) has no concept of a span map, and the
   only other option is what the POC does today: a second `Program` plus 900 lines
   of map composition on our side of the boundary.

2. **Incrementality.** The plugin cache identity is per-file by construction
   (`internal/project/parsecache.go:43`, `internal/contentmapper/hostimpl.go:641`).
   `E`/`R` rows are whole-program. This is not a gap to be worked around; it is the
   protocol's design. A mapper can be *correct* (fold every `.sm` into
   `ConfigIdentity` via `DynamicConfig`) or *incremental*, never both. The moment
   Smithers has a project of nontrivial size in an editor, rows must live in the
   checker.

3. **Grammar.** A content mapper receives text and returns text. Smithers has forms
   stock TypeScript cannot parse, and today we recover them with a bounded textual
   pass (256 constructs, 32 edit rounds, `SMITHERS1702`/`SMITHERS1707`-`SMITHERS1717` refusing
   every shape whose extent is not textually provable). That is not a foundation for
   a language; it is a foundation for a POC, and `poc/src/language/README.md` says
   so.

   The pleasant surprise: **grammar is cheap to write and expensive to vendor.**
   The AST is declarative — `tools/scripts/tsc/ast.json` — so a new node type is
   ~25-30 hand-written JSON lines and *all* the Go (struct, factory, `ForEachChild`,
   `VisitEachChild`, `Clone`, `SubtreeFacts`, casts, guards, arena field, stringer,
   API encoder) is generated. `defer` is already a token; a new contextual keyword
   is ~4 lines; `.ts` code using `defer`/`errdefer` as identifiers keeps working for
   free because `isIdentifier()` is `token > KindLastReservedWord`
   (`parser.go:6312`). The cost is that `ast.json` and three of the five generators
   live **outside `tsc/`**, so the vendored subtree has to grow — and after that,
   every upstream rebase is a regenerate-and-diff with Node in the loop.

### What the fork's architecture makes impractical

Three things in the current design should change, and saying so is worth more than
a plan that accommodates them:

- **A new `TypeFlags` bit for rows is impossible.** `internal/checker/types.go:425`
  is a `uint32` with all 32 bits allocated and an explicit comment that the numeric
  *order* is load-bearing for `CompareTypes` and union constituent ordering.
  Widening to `uint64` is a change across 60,456 lines of performance-sensitive
  code. **Rows must be side-table state (`LinkStore` / `Signature` fields), never a
  type kind.** Any design that says "`E` and `R` are part of the type" needs to be
  rewritten as "`E` and `R` are computed and cached beside the signature, and
  *rendered* into types where they must cross a boundary."

- **Value-position `if`/`switch` as grammar is the wrong trade.** Making them
  expressions means a checker join rule in `checker.go`'s expression dispatch — the
  most merge-hostile code in the tree, inside a 32,296-line file. `break :label
  value` and loop `else` are cheap grammar (~15 and ~12 hand-written lines
  respectively, and loop `else` attaches to `LabeledStatement`, not to the five
  loop node types, because there is no `parseLabeledStatement` —
  `parser.go:1519-1543`); value `if`/`switch` should desugar onto them through
  `p.reparseList` (`parser.go:613-643`), which already does exactly the
  "splice synthesized statements before the containing statement, propagating
  outward when the nesting level cannot host them" job the POC's textual pass
  approximates. That single decision retires `SMITHERS1702`, `SMITHERS1707`, `SMITHERS1708`,
  `SMITHERS1709`, the 256-construct/32-round budget, and the callee-stability
  whole-module write scan, all as a class. Its price is an audit of
  `internal/astnav/tokens.go`, which currently skips `NodeFlagsReparsed` nodes in
  16 places.

- **`compiler.Extension` in `compiler/api.go:152-159` should be deleted.** It
  specifies `Parse`/`Check`/`Lower` over `any`. The fork has no such seam and never
  will — there is no plugin registry (`internal/printer/printer.go:55`'s
  `OnEmitNode`/`SubstituteNode` are commented out with the codebase's `// !!!` NYI
  marker; `internal/tsoptions/commandlineoption.go:133-136`'s `plugins` key is a
  parse-only no-op). The real seams are, in order of narrowness:
  `contentmapper.Result`, `printer.EmitResolver`, `nodebuilder.SymbolTracker`, and
  `getScriptTransformers`'s slice. Specify against those.

### The verdict

**Hosting Smithers requires a substantial fork — but the substance is additive, and
the merge-facing surface stays small.** Roughly 450-600 changed lines across ~25
upstream files, and 11,000-15,000 new lines in fork-owned packages (plus a larger
vendored subtree). That is a real fork, not a plugin. But:

- The first two stages, which deliver a checking compiler and a working language
  server, cost **zero changed lines**.
- The single largest category of new code (`smitherstransforms`, `internal/smithers`)
  never conflicts on rebase.
- The changed lines cluster in three files (`compiler/emitter.go`,
  `outputpaths/outputpaths.go`, `printer/printer.go`) plus the AST generator, and
  every one of them is guarded by an existing predicate
  (`sourceFile.ContentMapper() != ""`, `NodeFlagsSmithers`, a nil span map), so
  upstream conformance is protected by construction rather than by testing alone.

The decision in `docs/DECISIONS.md` to "track upstream with a minimal diff" survives
if we read it as *minimal changed lines*, which is the property that actually
governs rebase cost. It does not survive if we read it as *no fork-owned compiler
code*, and it should be amended to say so.

---

## Appendix — index of load-bearing locations

All paths relative to `<fork>/tsc/`.

**File recognition**
- `internal/tspath/extension.go:8-22` extension constants; `:24-37` grouping vars; `:43` `extensionsToRemove`
- `internal/core/core.go:527` `GetScriptKindFromFileName`; `:564` `EnsureScriptKindFromFileName`
- `internal/core/scriptkind.go:6-19` `ScriptKind`
- `internal/tsoptions/tsconfigparsing.go:2020` `GetSupportedExtensions`; `:1402,1410` builtin-extension guard; `:1424` `runExternalCode` requirement
- `internal/compiler/fileloader.go:404` mapper dispatch; `:418` `parseContentMappedFile`; `:34` `maxContentMapperFailures = 5`; `:666` `isSupportedExtension`
- `internal/compiler/filesparser.go:95` TS6054
- `internal/module/resolver.go:1569-1578` extra-extension + `.d.<ext>.ts` resolution
- `internal/module/util.go:147-177` `GetResolutionDiagnostic`, TS6263
- `internal/outputpaths/outputpaths.go:47` `GetOutputPathsFor`; `:57,65` content-map guards; `:116` `GetOutputExtension`; `:148` `ChangeToDeclarationExtension`; `:183` `getOwnEmitOutputFilePath`

**Content mapper / span map**
- `internal/contentmapper/contentmapper.go:30` `Definition`; `:39` `Manifest`; `:57` virtual extensions; `:103` `TransformIdentity`
- `internal/contentmapper/host.go:170` `Result`; `:277` `Project`; `:299` `Host`
- `internal/contentmapper/transform.go:26` `TransformAndParse`; `:47` `ParseResult`; `:59-64` virtual file naming; `:97` `SetContentMapperInfo`
- `internal/contentmapper/hostimpl.go:31` `ProtocolVersion = 1`; `:59` `DiagnosticSource`; `:75-84` `OpenProjectResult`; `:212` `Diagnostic`; `:641` `combinedIdentity`
- `internal/spanmap/spanmap.go:23-35` `Kind`; `:42-65` `Feature`; `:70-99` `Fidelity`; `:104` `Segment`; `:192` `Validate`; `:256` `VirtualToOriginalSpan`; `:327` `VirtualToOriginalPosition`
- `internal/ast/ast.go:2615` `MappedDiagnosticDirectivePolicy`; `:2631` `ContentMapperSourceFileInfo`
- `internal/project/parsecache.go:43` `contentMappedParseCacheKey`; `internal/project/compilerhost.go:130`
- `internal/diagnosticwriter/diagnosticwriter.go:98` authored-span diagnostics

**Parser / AST**
- Generator input (git, outside the sparse checkout): `tools/scripts/tsc/ast.json`
  (175 KB), `ast.schema.json`, `schema.ts`, `generate-go-ast.ts`,
  `generate-encoder.ts`, `generate-ts-ast.ts`, `generate.ts`;
  `Herebyfile.mjs:572-576` `generate:ast`
- `internal/ast/kind_generated.go:8` `type Kind int16`; `:391` `KindCount` (351);
  `:392-425` all 34 range markers (`FirstStatement` :414, `LastStatement` :415,
  `LastKeyword` :399 = `KindDeferKeyword`, `LastContextualKeyword` :422)
- Marker consumers: `ast/utilities.go:113, 695, 748, 756, 2030, 2074, 2105, 2168,
  2704, 2999, 3253, 3780, 4140, 4245`; `ast_generated.go:9812, 9824, 9828, 9856, 9868`;
  `binder/binder.go:726, 1309, 1656`; `parser/parser.go:6312, 6317, 6442`;
  `format/rules.go:11-12, 39-40`; `format/rulesmap.go:35, 42`;
  `api/encoder/encoder.go:17-18` (6-bit unary packing, `panic`s at init);
  `ls/completions.go:3843-3844`; `ls/definition.go:196`; `ls/lsutil/children.go:51, 120`;
  `scanner/scanner.go:2255-2256` (`tokenToText [ast.KindCount]string`)
- `internal/ast/ast.go:179-186` `Node`; `:1181-1202` `nodeData` (20 methods);
  `:1206-1245` `NodeDefault`; `:60-119` factory plumbing
- `internal/ast/ast_generated.go:20-73` `NodeFactory` (generated); `:816-863` `IfStatement`;
  `:8694` `ForEachChild` dispatch; `:9059` `AsIfStatement`
- `internal/ast/nodeflags.go:3-73` `NodeFlags uint32`, bits 29-31 free; `:10`
  `NodeFlagsReparsed`; `:47` `NodeFlagsReparserTransformedLiteral`; `:57` `NodeFlagsContextFlags`
- `internal/ast/precedence.go:7` `OperatorPrecedence`; `:223` `GetOperatorPrecedence`
- `internal/core/scriptkind.go:6-20` (values **5 and 7 free**);
  `internal/core/languagevariant.go:6-11`
- `internal/scanner/scanner.go:36-122` `textToKeyword` (`"defer"` :55,
  `"immediate"` :69); `:124-190` `textToToken`; `:2214-2221` `GetIdentifierToken`
  (**2-12 chars, `a`-`z` initial**); `:1013-1367` the nine `ReScan*` methods;
  `:284-301` `Mark`/`Rewind`/`ResetPos`
- `internal/parser/parser.go:66-99` `Parser`; `:135` `ParseSourceFile`; `:140`
  JSON grammar dispatch; `:156` `parseJSONText`; `:291-316` `initializeState`;
  `:431` `parseSourceFileWorker`; `:445-448` reparse flush; `:500-506`
  `parseToplevelStatement`; `:517` `reparseTopLevelAwait`; `:613-643` `parseListIndex`
  (**reparse-list splice**); `:824` `isListElement`; `:916` `isListTerminator`;
  `:928-937` `PCVariableDeclarations` terminators; `:1063-1122` `parseStatement`;
  `:1240` `parseIfStatement`; `:1278` `parseWhileStatement`; `:1292-1336`
  `parseForOrForInOrForOfStatement` (:1298-1308 initializer sniff); `:1338`
  `parseBreakStatement`; `:1436` `parseSwitchStatement`; `:1519-1543`
  `parseExpressionOrLabeledStatement` (**labels are parsed here; there is no
  `parseLabeledStatement`**); `:1554-1596` `parseVariableDeclarationList`;
  `:4623-4708` binary precedence climbing; `:6312/6317` `isIdentifier`/`isBindingIdentifier`;
  `:6401` `setContextFlags`; `:6409` `doInContext`; `:6765` `checkJSSyntax`
- `internal/parser/utilities.go:11-17` `getLanguageVariant`
- `internal/parser/reparser.go:13` `finishReparsedNode`; `:54` `reparseTags`;
  `:70` `reparseUnhosted`; `:342` `reparseHosted`
- `internal/astnav/tokens.go:76, 104, 135, 146, 157, 165, 173, 176, 354, 375, 393,
  497, 501, 631, 641, 744` — `NodeFlagsReparsed` skips (the desugar hazard)
- `internal/diagnostics/extraDiagnosticMessages.json` (346 lines, codes from 100000)
  — the fork-owned SMITHERS diagnostic host; `internal/diagnostics/generate.go`

**Checker**
- `internal/checker/checker.go:57-66` `TypeSystemPropertyName`; `:585` `Checker`; `:676-707` link stores; `:4233` `checkThrowStatement`; `:19950` `getSignatureFromDeclaration`; `:20115` `getReturnTypeOfSignature`; `:20240` `getReturnTypeFromBody`; `:20373` `checkAndAggregateReturnExpressionTypes`
- `internal/checker/types.go:425` `TypeFlags` (full); `:593` `ObjectFlags`; `:680` `Type`; `:1266` `SignatureFlags` (23 bits free); `:1290` `Signature`; `:419` `SignatureLinks`
- `internal/checker/flow.go:77,117` control-flow entry
- `internal/checker/nodebuilder.go:117` `SerializeReturnTypeForSignature`; `:267` `TypeToTypeNode`
- `internal/checker/printer.go:43,55,183` type/signature to string
- `internal/checker/jsdoc.go:83` `getAllJSDocTags`
- `internal/core/linkstore.go:7` `LinkStore`

**Transformers / emit**
- `internal/transformers/transformer.go:8` `Transformer`; `internal/transformers/chain.go:26` `TransformOptions`
- `internal/compiler/emitter.go:112` `getScriptTransformers`; `:137` insertion point; `:200` `runScriptTransformers`; `:227-230` declaration-map suppression; `:474-481` `sourceFileMayBeEmitted`
- `internal/printer/emitresolver.go:77` `EmitResolver`; `internal/checker/emitresolver.go:34` implementation
- `internal/printer/emitcontext.go:547` `emitNode`; `:611,620` comment ranges; `:631,638` source-map ranges; `:1018` `AddSyntheticLeadingComment`
- `internal/printer/printer.go:745` `shouldWriteComment`; `:812` `shouldEmitSourceMaps`; `:5466` synthetic-comment emit; `:5805` `setSourceMapSource`; `:5833` `emitPos`; `:5899` `emitSourceMapsBeforeNode`
- `internal/printer/emitflags.go:3-38` `EmitFlags`
- `internal/sourcemap/source.go:5` `Source`; `internal/sourcemap/generator.go:273` `AddSourceMapping`
- `internal/transformers/declarations/transform.go:104` `NewDeclarationTransformer`; `:1608` `preserveJsDoc`; `:1613` `preservePartialJsDoc`; `:1629` `removeAllComments`; `:1636` `ensureType`
- `internal/transformers/estransforms/using.go` (799) — `defer` template; `async.go` (984) — structure template; `classfields.go` (3,618) — closest all-round analogue

**Language service**
- `internal/lsp/server.go:408` `RegisterContentMapperExtensions`; `:464-472` `**/*<ext>` selector; `:487-677` 26 capability registrations; `:2529` extension validation
- `internal/ls/source_map.go:18-33` central location dispatch
- `internal/ls/hover.go:28` `ProvideHover`; `:380` `getQuickInfoAndDeclarationAtLocation`; `:398` `writeTypeClassified`; `:421` `writeSignatureClassified`; `:498` `writeSignatures`
- `internal/ls/diagnostics.go:32,90`
- `internal/ls/languageservice.go:15` `LanguageService`

**Entry points**
- `cmd/tsc/main.go:14-32` (33 lines); `cmd/tsc/lsp.go` (115); `cmd/tsc/api.go` (82)
- `internal/execute/tsc.go:53` `CommandLine`; `:297,394` content-mapper host wiring
- `internal/api/proto.go:62-110` out-of-process checker methods
