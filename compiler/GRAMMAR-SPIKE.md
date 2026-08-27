# Grammar spike: what real Smithers syntax actually costs in the fork

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
> Retained and unaffected: the checked `panic` channel on unannotated foreign
> calls, and Zig/Rust imports through generated Wasm bindings. Where this document
> and the specification disagree, the specification wins.

> **Landed, and now measured against the right yardstick.** Sections 0-6 are
> C7's throwaway spike, kept verbatim as the measurement record. §7 is what the
> first landing lane shipped (`defer` / `errdefer`, `break :label value`); §8 is
> the second (`if (const x = f(); cond)`, loop `else`, value-position `if` /
> `switch`); §9 is the third (expression-position labeled block and loop values)
> — and **§9.8's "the surface syntax is complete" was measured against
> `poc/examples`, not against `conformance/corpus`, and was wrong.** §10 is flow
> analysis for the value `switch`, and it is what found the two corpus cases that
> still did not parse. **§11 is the current state**: those two cases, closed with
> **no node kind and no AST member**, plus the three further enumerated switches
> they reached — one of which was emitting wrong JavaScript with a clean compile.
> Read §11 first, then §10, then §9.
>
> **Completeness statement, measured with the conformance runner's own corpus and
> not with fixtures: 92 of the 96 `conformance/corpus/**` cases parse under the
> patched fork. The four that do not are the four negative cases whose
> `expected.json` says `expect: "diagnostics"`, i.e. the grammar refusing them is
> the contract.**
>
> **Do not quote the `poc/examples/language/*.sm` diagnostic tables in §8.7 and
> §9.8 as coverage.** They count the *fork's* parse of seven forms, six of which
> the language has since retired; §9.8's "Zero." is a zero against a grammar the
> current language rejects. `expression-flow.sm`, one of the four files those
> tables read over, has been deleted for demonstrating only retired constructs.
> §8.7.1 carries what the surviving fixtures measure today, through
> `smithers check`.

Status: **executed spike, measured numbers, source settled.** Everything below was
produced by building and running the pinned fork revision
`c087644e82dc3d48cf87e4c5519eeaaea9daf35c` (`smithersai/TypeScript`) in a throwaway
copy at `/private/tmp/c7-spike/ts`. No repo file outside this document was touched,
and the shared checkout at `/private/tmp/smithers-ts-fork-cache/...` was never
modified.

This document exists to size `FORK-SEAM-DESIGN.md`'s **Stage 4** — "`.sm` as a
first-class extension with real grammar", the stage that document calls the TRUE
POINT OF NO RETURN.

## 0. Headline

**The grammar is not the point of no return. The grammar is the cheap part.**

A complete, working, end-to-end addition of **two new statement kinds**
(`defer expr;` and `errdefer expr;`) — new keyword, new AST node kinds, dialect
gate, parser, printer, checker — cost **124 hand-written added lines and 1 modified
line**, regenerates in **5.5 seconds**, and produced **zero regressions across the
fork's own 132,873-subtest baseline corpus**.

The genuinely expensive and irreversible parts of Stage 4 are elsewhere: the
`.sm`-builtin-XOR-content-mapper guard, and the vendoring contract. This spike
reduces the vendoring problem to **a one-line edit costing 3.7 MB**.

Two of `FORK-SEAM-DESIGN.md`'s load-bearing claims are **refuted** by measurement
(§3.3, §6). One is confirmed and improved on (§3.1).

---

## 1. Task 1 — The sparse checkout, and the exact fix

### 1.1 What the prepare script does, and why `tools/` is missing

`scripts/prepare-typescript-fork.mjs` has two materialization paths, and **both**
set the same cone:

| path | lines | cone |
|---|---|---|
| `materializeFromCapsule` | 163-164 | `sparse-checkout init --cone` + `set tsc` |
| `fetchCheckout` | 196-197 | `sparse-checkout init --cone` + `set tsc` |

When `--full-tsc` is not passed, both then *narrow further* with `--no-cone` using
`compilerSparsePatterns` (lines 24-35), every entry of which is under `/tsc/`.

**`tools/` is not excluded for a reason. It was simply never in the cone.** There is
no guard, no comment, and no size justification anywhere in the script. Cone mode
includes top-level *files* automatically — which is exactly why `Herebyfile.mjs`,
`package.json`, `package-lock.json` and `go.work` are already present in the shared
checkout while `tools/` and `packages/` are not.

### 1.2 The repository is far smaller than assumed

The pinned revision has **exactly three top-level directories**. There is no `src/`
and no `tests/` (this is a typescript-go-shaped repo, not microsoft/TypeScript):

| directory | size |
|---|---|
| `tsc/` | 392 MB (of which `tsc/testdata/` is 329 MB) |
| `packages/` | 2.9 MB |
| `tools/` | 804 KB |

So the current exclusion saves **3.7 MB out of ~396 MB — 0.9%**. Measured working
trees: `set tsc` → 442 MB total incl. `.git`; `set tsc tools packages` → 447 MB.

### 1.3 The fix (verified, not proposed)

I created a fresh checkout with the proposed patterns and confirmed it produces a
complete, generator-capable tree:

```
git sparse-checkout set tsc tools packages
```

In `scripts/prepare-typescript-fork.mjs` that is **two one-line edits**, at
lines 164 and 197:

```diff
-      run("git", ["-C", staging, "sparse-checkout", "set", "tsc"]);
+      run("git", ["-C", staging, "sparse-checkout", "set", "tsc", "tools", "packages"]);
```

For the default `--no-cone` compiler path, `compilerSparsePatterns` needs these
added (root files are *not* automatic in no-cone mode):

```js
"/tools/scripts/tsc/",
"/tools/go.mod",
"/tools/go.sum",
"/packages/typescript/src/",
"/Herebyfile.mjs",
"/package.json",
"/package-lock.json",
"/go.work",
"/.dprint.jsonc",
```

**Minimal alternative**, if 2.9 MB of `packages/` is objectionable: vendor
`tsc` + `tools` only (**+804 KB**) and add a 2-line fork-owned driver that calls
`generateGoAST()` alone. Verified working — it regenerates `ast_generated.go` and
`kind_generated.go` with `packages/` absent. The cost is that
`internal/api/encoder/{encoder,decoder}_generated.go` and the five TypeScript-side
files are **not** regenerated, so the numerically-encoded API/LSP wire protocol
silently drifts. I do not recommend it; 2.9 MB is not worth that class of bug.

### 1.4 A `go.work` trap worth knowing

`go.work` lists `./tools`. With `tools/` absent, `go build` inside `tsc/` fails
outright:

```
go: cannot load module ../tools listed in go.work file: open ../tools/go.mod: no such file or directory
```

The repo already works around this by setting `GOWORK=off` everywhere it builds the
fork (`scripts/vendor-typescript.mjs:160,192`, `scripts/build-smithersc.mjs:330`,
`compiler/fork.go:357-358`). Vendoring `tools/` makes `go.work` consistent for the
first time. `GOWORK=off` remains compatible — I verified the stringer regeneration
step runs correctly under it.

---

## 2. Task 2 — The AST generator, measured

### 2.1 It runs offline in 5.5 seconds with no `npm ci`

`Herebyfile.mjs:572-576` defines `generate:ast` as:

```js
run: () => $`node --experimental-strip-types --no-warnings ./tools/scripts/tsc/generate.ts`
```

That is bare Node with native type-stripping. `generate.ts` imports only
`generate-encoder.ts`, `generate-go-ast.ts`, `generate-ts-ast.ts`, and across all
three the **only** third-party import is `execa` — used at exactly three call sites,
all of which do nothing but `execaSync("dprint", ["fmt", filePath])`.

I ran the whole generator with a 12-line `execa` shim that substitutes `gofmt` for
`dprint`, no `node_modules` otherwise. Requirements in practice:

- Node **≥ 22.6** for `--experimental-strip-types` (the repo's own `.nvm` default,
  v22.4.1, is too old; Homebrew's v24.4.1 works).
- `gofmt` (or real `dprint` for byte-exact upstream fidelity).

**Reproducibility check:** regenerating from the *pristine* `ast.json` reproduced
`kind_generated.go`, `encoder_generated.go` and `decoder_generated.go`
**byte-for-byte**. `ast_generated.go` differed by 18 lines, all of which are pure
gofumpt-vs-gofmt cosmetics (`var (...)` grouping, `struct{}` vs `struct {\n}`). I
therefore committed a regenerated baseline and measured **generated-vs-generated**
throughout, so formatter choice cancels out of every number below.

Timings:

| step | command | time |
|---|---|---|
| AST + encoder + TS AST | `node ... generate.ts` | **5.0 s** |
| `Kind` stringer | `go tool golang.org/x/tools/cmd/stringer -type=Kind ./internal/ast` | **0.5 s** |
| full `go build ./...` | | 42 s cold |

### 2.2 To add one AST node kind, exactly this changes

Adding a statement node is **three edits to one file**, `tools/scripts/tsc/ast.json`:

1. one line in `kinds.elements` (the kind),
2. a node definition in `nodes.definitions` (13 lines for a one-member statement),
3. nothing else.

The whole `DeferStatement` definition:

```json
"DeferStatement": {
    "generateSubtreeFacts": true,
    "extends": ["StatementBase", "CompositeBase"],
    "members": [{ "name": "Expression", "type": "Expression" }]
}
```

From those **14 JSON lines per node**, the generator emits: the Go struct,
`NewDeferStatement`, `UpdateDeferStatement`, `ForEachChild`, `VisitEachChild`,
`Clone`, `computeSubtreeFacts`, `IsDeferStatement`, the `ForEachChild` dispatch
arm, the `AsDeferStatement()` cast, the `NodeFactory` arena field, the stringer
entry, the encoder child-property mask, the decoder entry, and five TypeScript-side
files.

**Verdict on the recon's "~25-30 hand-written JSON lines each with all Go
generated": the second half is exactly right; the first half is ~2x too high.**
Measured: **14 JSON lines per statement node.** My 29 ast.json lines bought *two*
node kinds *plus* a new keyword.

### 2.3 Marker bumps are avoidable entirely

`FORK-SEAM-DESIGN.md` §3.1 says new keywords must go "at the end of the keyword
block" with `LastKeyword`/`LastContextualKeyword` bumped. **Inserting *before* the
current last element is strictly cheaper and equally correct**, and costs zero
marker edits:

- `"ErrdeferKeyword"` inserted immediately **before** `DeferKeyword` (which carries
  `LastKeyword`/`LastToken`/`LastContextualKeyword`) → markers untouched.
- `"DeferStatement"`, `"ErrdeferStatement"` inserted **before** `DebuggerStatement`
  (which carries `LastStatement`) → markers untouched.

Total marker edits in this spike: **0**.

### 2.4 What regenerates, and the one non-obvious dependency

`kind_stringer_generated.go` is **not** produced by `generate:ast`. It comes from a
separate `go:generate` directive at `kind_generated.go:5`. Inserting a kind
mid-enum renumbers every subsequent entry, so this file *must* be regenerated or
the `internal/ast` package **fails to compile** with ~200 errors of the form
`invalid argument: index 1 out of bounds [0:1]`. It is a loud failure, not a silent
one. 0.5 s to fix.

The second directive on that line is `npx dprint fmt kind_stringer_generated.go`,
which needs `npm ci`; `gofmt` is an adequate substitute.

---

## 3. Task 3 — The spike: `defer` / `errdefer` as real grammar

### 3.1 It works, end to end

Chosen because the recon correctly identified it as the lowest-risk/highest-value
form: `defer` is **already a keyword** in this fork (`scanner.go:55`,
`KindDeferKeyword`, added upstream for TC39 `import defer`), so keyword cost is
provably near zero.

`tsc` compiled from the spike tree, run on a real file:

```ts
// main.sm.ts
declare function open(): { close(): void };
export function work(): number {
    const h = open();
    defer h.close();
    errdefer h.close();
    return 42;
}
```

produces, with **no errors**, a correct `main.sm.js` and a correct
`main.sm.d.ts` (`export declare function work(): number;`). Parse → bind → check →
JS emit → declaration emit all work. Lowering is deliberately not implemented
(another lane owns semantics), so the statements pass through to JS verbatim —
which is precisely the expected "additive, no-transformer-yet" behaviour.

`internal/printer/smithers_spike_test.go` (112 new lines, fork-owned) asserts
round-tripping for 7 forms, node shape, `ForEachChild` reachability, authored
positions, printer idempotence, and the dialect gate. All pass.

### 3.2 The measured diff

**Hand-written: 124 added, 1 modified, across 8 files.**

| file | added | what |
|---|---|---|
| `tools/scripts/tsc/ast.json` | 29 | 1 keyword, 2 kinds, 2 node definitions (declarative) |
| `internal/parser/parser.go` | 55 | dialect gate (5), 2 dispatch arms (8), 2 parse functions (38), comments |
| `internal/printer/printer.go` | 22 | 2 dispatch arms, 2 emit functions |
| `internal/checker/checker.go` | 9 | 1 dispatch arm, `checkDeferStatement` |
| `internal/ast/ast.go` | 4 | 2 arms in `Node.Expression()` |
| `internal/ast/nodeflags.go` | 2 (+1 mod) | `NodeFlagsSmithers = 1 << 29`, added to `NodeFlagsContextFlags` |
| `internal/ast/utilities.go` | 2 | 2 arms in `isStatementKindButNotDeclarationKind` |
| `internal/scanner/scanner.go` | 1 | `"errdefer": ast.KindErrdeferKeyword` |

**Generated: 309 added / 192 removed (Go), 76 added / 2 removed (TypeScript).**
Of the Go figure, `kind_stringer_generated.go` accounts for 192/189 and is almost
entirely enum renumbering churn; real new generated content is ≈ +117 Go lines.

Ratio: **124 hand-written lines produced 385 generated lines.** The generator is
doing the work, exactly as the recon claimed.

### 3.3 Two corrections to `FORK-SEAM-DESIGN.md`, both found by running the code

**(a) `ast.IsStatement` is NOT a range check. The recon's stated remedy does not
work.**

§3.1 trap 1 says a new kind "must go **inside** the statement block" so that
`ast.IsStatement` treats it as a statement. I did exactly that — and
`ast.IsStatement(deferStmt)` still returned **false**.

`ast.IsStatement` (`ast/utilities.go:695`) delegates to
`isStatementKindButNotDeclarationKind` (`utilities.go:657-681`), which is an
**explicit 18-arm `switch`**, not a range comparison. Range membership is irrelevant
to it. In the entire tree only **two** sites actually use the
`KindFirstStatement..KindLastStatement` range: `binder/binder.go:1656` and
`ast/utilities.go:4245` (`IsPotentiallyExecutableNode`).

Inserting inside the statement range is still worth doing — it buys those two sites
for free — but it is **not sufficient**, and anyone following the recon's advice
literally would have shipped a silently-broken node kind. Cost of the actual fix: 2
lines.

**(b) Missing hand-written arms fail in two distinct ways, and one is silent.**

*Silent (dangerous).* `checkSourceElementWorker` (`checker.go:2260`) has **no
`default:` arm and no panic**. Before I added the checker case, this compiled and
ran with zero complaints:

```ts
defer h.nonExistentMethod();
errdefer totallyUndefinedIdentifier();
```

→ **0 errors**. The identical code outside a `defer` produces TS2339 and TS2304.
The entire subtree was silently unchecked. After adding a 9-line checker case, both
errors are reported correctly.

*Loud (safe).* `Node.Expression()` (`ast/ast.go:383`) is a hand-written switch that
**panics** on an unknown kind:
`panic: Unhandled case in Node.Expression: KindDeferStatement`. There are **21** such
generic accessors in `ast.go` (`Expression`, `Arguments`, `StatementList`,
`Initializer`, `Label`, `TypeArguments`, …), each with a panicking default. A node
only needs arms in the accessors matching its member names — 4 lines here.

The practical rule this yields: **budget for an audit of the enumerated switches,
not for the range markers.** `grep -rln KindTryStatement` over non-generated,
non-test Go returns **11 files** — `ast/utilities.go`, `binder/binder.go`,
`checker/checker.go`, `checker/flow.go`, `format/indent.go`,
`format/rulecontext.go`, `ls/folding.go`, `printer/printer.go`,
`transformers/declarations/transform.go`, `transformers/estransforms/async.go`,
`transformers/moduletransforms/commonjsmodule.go`. My spike needed 4 of them.

### 3.4 The dialect gate works and is cheap

`NodeFlags` bits 29-31 are free, as the recon said. `NodeFlagsSmithers = 1 << 29`
added to `NodeFlagsContextFlags` (so `mark`/`rewind` save and restore it), set in
`initializeState` from the file extension. **3 lines in `nodeflags.go`, 5 in
`parser.go`.**

The P0 interop gate holds, and is asserted in the test:

- `defer close();` in a `.ts` file still parses as an `ExpressionStatement` with
  the same diagnostics upstream produces today — **the `.ts` parse tree is
  unchanged**.
- `const errdefer = 1; const defer = 2; errdefer + defer;` parses clean in **both**
  `.ts` and `.sm`, because both keywords sit after `KindLastReservedWord` and
  `p.isIdentifier()` is `p.token > ast.KindLastReservedWord` (`parser.go:6312`).
  Existing code using these as variable names keeps working with zero effort.

---

## 4. Task 4 — Do upstream tests still pass? Yes.

`go test ./...` on the spike tree:

- **61 packages ok.**
- `internal/testrunner` — the full compiler/conformance baseline corpus against
  `tsc/testdata/` — **132,873 subtests, 0 FAIL, 2,130 SKIP.**
- `internal/fourslash/tests` (language-service baselines) — **ok.**
- `internal/parser`, `internal/printer`, `internal/scanner`, `internal/ast`,
  `internal/binder`, `internal/checker`, `internal/transformers/*` — **ok.**

**One package fails: `internal/astnav`.** It is **not a regression.** It shells out
to Node and requires `node_modules/typescript/lib/typescript.js` from `npm ci`,
which I never installed:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../node_modules/typescript/lib/typescript.js'
```

I verified this by `git stash`-ing the entire spike and re-running that package at
the pristine baseline: it fails identically, with the same `ERR_MODULE_NOT_FOUND`.

**Additive or invasive? Additive.** Every hand edit is an *added* case arm or an
*added* function. Exactly **one** line is modified in place (appending
`| NodeFlagsSmithers` to `NodeFlagsContextFlags`). The merge-conflict surface is 8
hunks in stable, rarely-edited switch statements. Nothing was deleted, no signature
changed, no control flow rerouted.

---

## 5. Task 5 — Verdict on desugaring value-position `if`/`switch` via `p.reparseList`

### **Verdict: not viable. Do not build on it.**

`FORK-SEAM-DESIGN.md` §3.2 calls this "the single biggest simplification available
in the whole migration" and claims it retires SMITHERS1707, SMITHERS1708, SMITHERS1709, the
braceless-branch rule, and the 256-construct / 32-round budget. I tested it rather
than reasoned about it, and it does not hold.

### 5.1 How I tested it

I wired a throwaway construct through the exact mechanism the recon proposes. In
Smithers mode, `immediate E` in primary-expression position synthesizes
`const __tN = E;`, pushes it onto `p.reparseList` via `finishReparsedNode` (so it
inherits authored positions, as the recon specifies), and evaluates to `__tN`. That
is a faithful model of a value-position `if`/`switch` desugar. I then parsed and
printed it in 10 syntactic positions.

### 5.2 Results

| # | position | result |
|---|---|---|
| A | statement level — `const x = immediate f();` | correct |
| C | arrow block body | correct |
| J | inside `if` branch block | correct |
| F | after a type alias | correct |
| H | object literal value | correct *in isolation* |
| **B** | **call argument** — `g(a(), immediate f(), b())` | **silently wrong** |
| **E** | **parameter default** — `function g(a = immediate f())` | **silently wrong** |
| **I** | **arrow parameter default** | **silently wrong** |
| **D** | **class property initializer** — `class C { p = immediate f(); }` | **PANIC** |
| **G** | **switch case expression** — `case immediate f():` | **PANIC** |

The panics, verbatim:

```
unexpected ClassElement: KindVariableStatement
unhandled CaseOrDefaultClause: KindVariableStatement
```

Case B printed `var __t1 = f();` **before** the statement, so `f()` now evaluates
before `a()` — evaluation order inverted, **no diagnostic**. Cases E and I hoisted
the default-value computation **out of the function entirely**, so it evaluates once
at module load instead of per call — **no diagnostic**.

### 5.3 Why — four independent structural reasons

**(1) The splice point is the nearest enclosing `parseListIndex`, which is often not
a statement list.** Only 8 parsing contexts route through `parseList`/`parseListIndex`:

- statement lists: `PCSourceElements`, `PCBlockStatements`, `PCSwitchClauseStatements`
- **not** statement lists: `PCClassMembers`, `PCTypeMembers`, `PCHeritageClauses`,
  `PCJsxAttributes`, `PCSwitchClauses`

Outward propagation exists but is **hardcoded to two node kinds**
(`parser.go:632`): `ast.IsJSTypeAliasDeclaration(e) || ast.IsJSImportDeclaration(e)`.
There is no general escape hatch. A `Statement` spliced into `PCClassMembers` is an
invalid tree, and the printer crashes on it.

**(2) `parseDelimitedList` is transparent to `reparseList`** — it never saves,
clears, or restores it. So a hoist from inside `PCParameters` propagates past the
function to the enclosing statement list. That is why parameter defaults break, and
it is *silent* because the resulting tree is perfectly valid — just wrong.

**(3) `mark()`/`rewind()` do not save `reparseList`.** `parser.go:359-382` saves
`scannerState`, `contextFlags`, diagnostics lengths, `jsdocInfos`, **`reparsedClones`**
— and *not* `reparseList`. A speculative parse that hoists and is then rewound
leaves orphaned nodes in the buffer. Value position is exactly where the parser
speculates most (`tryParseParenthesizedArrowFunctionExpression`, type-argument
disambiguation). JSDoc reparsing is safe today only because it runs off committed
nodes, never inside speculation.

**(4) Authored positions make the printer emit the *original source text*.** This
one is fundamental and I did not expect it. `finishReparsedNode` (`reparser.go:13`)
copies `Loc` from the source node — the very property that makes parse-time
desugaring attractive for diagnostics and source maps. But
`printer.getTextOfNode` (`printer.go:238`) computes

```go
canUseSourceFile := p.currentSourceFile != nil && node.Parent != nil && !ast.NodeIsSynthesized(node)
```

and takes text straight from the source file for any node with real positions.
Observed: my synthesized reference to `__t1` printed as **`immediate f()`** — the
original text. JSDoc reparsing escapes this only because its nodes are type-only and
erased before JS emit. A value-position desugar must reach JS emit, so it cannot.
You can strip positions to fix emit — at which point you have thrown away the
source-map fidelity that motivated parse-time desugaring in the first place.

**Bonus:** the recon budgets "~40-80 changed lines" for an `astnav/tokens.go` audit
of `NodeFlagsReparsed`. Actual count: **83 references across 20 files**
(16 in `astnav/tokens.go`, plus `checker/grammarchecks.go`, `checker/checker.go`,
`transformers/declarations/*`, `format/span.go`, and six `internal/ls/*` files).

### 5.4 What this means for the diagnostics it was supposed to retire

`reparseList` does not eliminate SMITHERS1707/1708/1709 or the construct budget. It
**relocates** them from a text pre-pass into the parser, and in doing so changes the
failure mode from *fail-closed diagnostic* (what the POC does today, and correctly)
to *crash or silent miscompile*. That is strictly worse.

**What `reparseList` is genuinely good for:** the positions where it works — A, C,
J — are exactly statement-level and block-level. It is a sound mechanism for
statement-level desugars (hoisting before the enclosing statement inside a block),
which is where `defer`/`errdefer` and labeled-block lowering live. Use it there.
Do not use it for arbitrary expression positions.

**Recommendation:** keep value-position `if`/`switch` as it is today — sugar with
fail-closed diagnostics — or give it real expression grammar later as a deliberate,
separately-budgeted decision. Do not treat it as a freebie that falls out of Stage 4.

---

## 6. Revised Stage 4 estimate

`FORK-SEAM-DESIGN.md` estimates Stage 4 at **~300-450 changed upstream lines +
~1,300-1,600 new**.

### 6.1 Where the recon was wrong, in both directions

| claim | recon | measured | verdict |
|---|---|---|---|
| hand-written JSON per node | 25-30 | **14** | ~2x too high |
| `defer`/`errdefer` total | ~25 changed + ~45 new JSON = ~70 | **124** | ~1.8x too low |
| `ast.IsStatement` fixed by range insertion | yes | **no** | refuted |
| regeneration feasible without `npm ci` | implied hard | **5.5 s, execa shim only** | too pessimistic |
| `NodeFlagsReparsed` audit surface | ~36 sites | **83 across 20 files** | ~2.3x too low |
| value `if`/`switch` via `reparseList` | "biggest simplification available" | **crashes in 2 of 10 positions, silently miscompiles in 3** | refuted |

The per-form underestimate came from omitting the printer (22 lines), the checker
(9), `Node.Expression()` (4), and `isStatementKindButNotDeclarationKind` (2) — i.e.
from the enumerated-switch audit the recon mis-modelled as a range check. The JSON
overestimate partly cancels it.

### 6.2 Revised numbers

Extrapolating from the one form I actually built, for the four **statement-level**
divergent forms:

| form | estimate | basis |
|---|---|---|
| `defer` / `errdefer` | **124** | **measured, not estimated** |
| `break :label value` | 40-60 | adds a member to an existing node; no new kind, no new keyword |
| `if (const x = f(); cond)` | 80-120 | new member + `LocalsContainerBase`; binder container, checker, printer |
| loop `else` | 150-250 | member on `LabeledStatement` is trivial; the cost is a **real new flow-graph edge** in `binder/binder.go` + `checker/flow.go` (2,764 lines) |
| **total, statement-level grammar** | **~400-550 changed** | |
| new fork-owned non-test lines | **~0** | grammar *generates* code; it does not require new packages |
| tests | ~400-600 | fork-owned, no merge cost |

Value-position `if`/`switch` as real expression grammar, if ever wanted: **300-500
more**, genuinely merge-hostile (touches `checker.go`'s expression dispatch inside a
32,296-line file). Not recommended now — see §5.

**So: the recon's "~300-450 changed" is about right in magnitude for the grammar,
arrived at through two compensating errors. Its "~1,300-1,600 new" is far too high
for grammar specifically** — that figure only makes sense if it includes the
~600-900-line `internal/smithers/desugar` package built on `reparseList`, which §5
says should not be built.

### 6.3 The actual point of no return

Stage 4 bundles three things. They should be un-bundled, because they have wildly
different risk:

| | reversible? | cost |
|---|---|---|
| **new grammar** (this spike) | **yes** — purely additive, deletable, mechanically verifiable, 5.5 s to regenerate | 400-550 changed lines |
| **vendoring contract** (`tools/`, `packages/`) | **yes** | 2 one-line edits, +3.7 MB |
| **`.sm` as a builtin `tspath` extension** | **NO** | 60-90 changed lines — *and* it permanently forecloses the content-mapper path by explicit upstream guard, and pins downstream consumers via published `.d.sm.ts` |

Grammar is not a one-way door. **The extension-registration choice is the only
one-way door in Stage 4**, and it is independent of grammar: the dialect gate in
this spike keys off the file name, and works identically for `.sm` and for the
content-mapper's `.sm.ts` virtual file name. Real Smithers grammar can ship
**while `.sm` remains a content-mapper extension**.

**Recommendation: take the grammar. Defer the extension decision.** They were only
ever coupled by assumption.

---

## 7. What landed

Everything in §0-6 was a throwaway tree. This section is the repository state.

### 7.1 The sparse-checkout fix, verified

`scripts/prepare-typescript-fork.mjs` now materializes `tools/` and `packages/`
on **both** paths: cone mode is `sparse-checkout set tsc tools packages`
(lines 181 and 214), and `compilerSparsePatterns` gained `/tools/`,
`/packages/typescript/src/`, `/Herebyfile.mjs`, `/package.json`,
`/package-lock.json`, `/go.work`, and `/.dprint.jsonc` — root files are not
automatic in `--no-cone` mode.

The default (non-`--full-tsc`) checkout goes from 757 to 924 materialized files
and 82 MB. In that checkout, running the generator over the **pristine** tree
leaves `git status` completely empty — all ten generated files reproduce
**byte-for-byte**, Go and TypeScript alike, in 5.5 s.

**This corrects §2.1.** C7 measured with a `gofmt` shim and reported an 18-line
cosmetic drift in `ast_generated.go`. With real `dprint@0.55.1` — the version
`.dprint.jsonc` pins — there is no drift at all. `npm ci` is still not needed:
the generator's only third-party import is `execa`, and installing just
`dprint@0.55.1` and `execa@9.6.1` in a directory *above* the checkout is enough,
and keeps the checkout clean. Without real `dprint` the TypeScript side churns
~5,500 formatting-only lines, which is why the mechanism carries generated bytes
rather than regenerating at apply time.

The old cone (`set tsc`) is now provably insufficient rather than merely
wasteful: `forkpatch apply` against a checkout built the old way fails with
`does not materialize 6 file(s) the series needs`.

### 7.2 The mechanism: `compiler/forkpatch/`

An ordered series of unified diffs, applied by `git apply` to a checkout verified
at the pinned revision, gated on SHA-256 digests of every touched file before and
after. Full rationale and the rejected alternatives are in
`compiler/forkpatch/README.md`. Headline properties:

- `status` / `apply` / `unapply` are **offline and need only `git`**.
- `apply` refuses unless every recorded pre-image matches, and refuses to succeed
  unless every post-image matches — so the applied tree is bit-identical
  everywhere. Verified across two independently materialized checkouts: all 21
  files byte-identical.
- `verify --regenerate` re-runs the generator inside an applied checkout and
  requires the tree to be unchanged, so the generated patch is *derived*, not
  asserted. It passes.
- `unapply` restores a byte-identical pinned tree (`git status
  --untracked-files=all` empty).
- A `mixed` checkout — partially applied, hand-edited, or drifted upstream — is
  always a hard failure naming the divergent files.
- `series.json.revision` must equal `typescript-fork.json.revision`, so bumping
  the pinned fork disables the series until it is re-recorded.

### 7.3 Cost of each form, measured from the landed patches

| patch | kind | added | modified |
|---|---|---|---|
| `0100-defer-errdefer-grammar.patch` | hand-written | **124** | 1 |
| `0200-break-label-value-grammar.patch` | hand-written | **53** | 3 |
| `0800-regenerate-ast.patch` | generated | 423 | 209 |
| `0900-smithers-grammar-tests.patch` | fork-owned tests | 448 | 0 |

`defer` / `errdefer` reproduces C7's 124 + 1 exactly, from a clean re-application
of the spike diff to a freshly prepared pristine checkout.

**`break :label value` cost 53 hand-written lines — 43 % of `defer`.** It beat
the recon's 40-60 estimate at the top of the range and beat `defer` outright,
because it adds a member to an existing node instead of a kind: no new `Kind`, no
enum renumbering, no `IsStatement` arm, no printer dispatch arm, no checker
dispatch arm, no accessor arm (`Value` is not one of the 21 accessor names), and
one existing caller of `NewBreakStatement` in the whole tree.

Per-file: `ast.json` +8/−1 (`CompositeBase`, `generateSubtreeFacts`, the optional
`Value` member), `parser.go` +18/−2, `printer.go` +10, `binder.go` +8,
`checker.go` +9.

**The cost curve is real and it bends the right way.** Grammar that reuses an
existing node kind is roughly half the price of grammar that introduces one.

### 7.4 One trap the recon and the spike both missed

`binder.bindBreakStatement` does **not** bind children generically — it binds only
`node.Label()` and then calls `bindBreakOrContinueStatement`, which sets
`currentFlow = unreachableFlow`. A new expression member therefore has to be bound
**explicitly, and before that call**.

Getting the order wrong is silent and is a *miscompile*, not a crash. With the
bind moved after, `break :outer takesString(x)` where `x: string | number`
reports **no error at all** — TS2345 disappears, because the argument is checked
against an unreachable flow node. Proved by mutation:
`TestSmithersBreakValueFlowAnalysis` goes from green to `[]int32{ − 2345 }`.

Add it to the sweep list: **enumerated switches in the binder are as dangerous as
the ones in the checker.**

### 7.5 Trap sweep, proved by mutation

Each trap has a test that goes red when the arm is removed:

| trap | mutation | test that catches it |
|---|---|---|
| missing checker arm (silent) | delete the `KindDefer/ErrdeferStatement` case | `TestSmithersCheckerReportsErrorsInsideNewStatements/{defer,errdefer}` → 0 diagnostics instead of TS2304+TS2339 |
| missing checker arm, value break (silent) | delete the `Value` check | `.../break_value` and `TestSmithersBreakValueFlowAnalysis` |
| missing `Node.Expression()` arms (loud) | delete both arms | `TestSmithersAccessorParity` → `panic != *ast.Node` |
| missing `isStatementKindButNotDeclarationKind` arms | delete both arms | `TestSmithersNodeShape` → `ast.IsStatement` false |
| binder bind order | move the bind after the flow update | `TestSmithersBreakValueFlowAnalysis` → TS2345 vanishes |

`TestSmithersAccessorParity` is a **generic** sweep rather than a hand-written
list: it calls all 21 panicking accessors on each new node and on an upstream node
with the same member shape (`ThrowStatement` for `defer`/`errdefer`, a valueless
`BreakStatement` for the value break) and requires return-versus-panic parity. It
also asserts the accessor count is still 21, so a 22nd upstream accessor forces a
re-sweep instead of passing silently.

### 7.6 Upstream health

`go test ./...` inside `tsc/`, pristine versus patched, on independently prepared
`--full-tsc` checkouts:

| | pristine | patched |
|---|---|---|
| packages ok | **62** | **62** |
| packages FAIL | **0** | **0** |
| `internal/testrunner` | **130,743 PASS / 0 FAIL / 2,130 SKIP** | **130,743 PASS / 0 FAIL / 2,130 SKIP** |

Package-level results are byte-identical between the two runs apart from timings.
130,743 + 2,130 = 132,873, matching §4's baseline exactly.

**This corrects §4 on one point.** C7 reported `internal/astnav` as a
pre-existing failure. It is not a fork defect and it is not unavoidable: the test
shells out to Node and needs `node_modules/typescript/lib/typescript.js`.
Installing `typescript@6.0.3` (which `package.json` already pins as `^6.0.3`)
makes it pass on **both** trees, so the honest baseline is 62/62 green, not
"61 ok + 1 known failure". `node_modules/` is gitignored in the fork, so the
checkout stays clean.

End to end from the patched tree, `tsc` on a `.sm.ts` file using all three forms
with `strict: true`: **zero diagnostics**, correct `.js`, correct
`.d.ts` (`export declare function work(n: number): number;`). The new statements
pass through to JavaScript verbatim, which is the expected additive
no-transformer-yet behaviour — lowering belongs to the semantic lane.

### 7.7 `.sm` stayed a content-mapper extension

No `tspath` extension was registered. The dialect gate keys off the file name and
matches both `.sm` and `.sm.ts` — the virtual name `contentmapper.ParseResult`
produces — so real grammar shipped without touching the one-way door. The checker
tests run entirely on `.sm.ts`, which is a legal TypeScript extension for program
construction *and* a Smithers file for the parser; that is the whole reason the
semantic proof needs no extension registration.

### 7.8 What grammar remains

| form | status | estimate |
|---|---|---|
| `defer` / `errdefer` | **landed**, 124 lines | — |
| `break :label value` | **landed**, 53 lines | — |
| `if (const x = f(); cond)` | not started | 80-120; new member + `LocalsContainerBase`, binder container, checker, printer |
| loop `else` | not started | 150-250; the cost is a real new flow-graph edge in `binder.go` + `checker/flow.go` |
| value-position `if` / `switch` | **do not build on `reparseList`** (§5) | 300-500 as real expression grammar, genuinely merge-hostile |

The two landed forms cost **177 hand-written lines combined**, inside §6.2's
164-184 estimate for the pair. The two remaining statement-level forms are
**230-370** on the same basis, against §6.2's 400-550 for all four. The
extrapolation held.

Also still open, and independent of grammar: **lowering**. Nothing here gives
`defer` or a value break runtime semantics; they reach JavaScript verbatim.

---

## Appendix — reproducing this

Throwaway tree: `/private/tmp/c7-spike/ts` (pinned revision, full checkout, plus a
local baseline commit that regenerates with `gofmt` so all measurement is
generated-vs-generated).

Saved artifacts in `/private/tmp/c7-spike/`:

| file | contents |
|---|---|
| `spike-handwritten.diff` | the 124-line hand-written diff (269 lines with context) |
| `spike-full.diff` | everything including generated output (1,107 lines) |
| `smithers_spike_test.go` | the 112-line round-trip / node-shape / dialect-gate test |
| `reparse_probe_test.go.keep` | the §5 `reparseList` probe harness |
| `parser-with-probe.diff` | the throwaway `immediate` parser probe |
| `fulltest-clean.log` | full `go test ./...` output for the final spike |

```bash
# complete tree (17 s, 447 MB)
git init ts && git -C ts remote add origin https://github.com/smithersai/TypeScript.git
git -C ts sparse-checkout init --cone && git -C ts sparse-checkout set tsc tools packages
git -C ts fetch --depth=1 --filter=blob:none origin c087644e82dc3d48cf87e4c5519eeaaea9daf35c
git -C ts checkout --detach FETCH_HEAD

# regenerate (5.5 s total); needs Node >= 22.6 and an execa->gofmt shim
node --experimental-strip-types --no-warnings ./tools/scripts/tsc/generate.ts
cd tsc && go tool golang.org/x/tools/cmd/stringer -type=Kind -output=internal/ast/kind_stringer_generated.go ./internal/ast
```

---

## 8. The remaining grammar, landed

§7 left three forms outstanding. All three are now in the series. Every number
below is measured from the checked-in patches, not estimated.

### 8.1 Cost per form, against §6.2's estimates

| patch | form | measured | estimate | files |
|---|---|---|---|---|
| `0100` | `defer` / `errdefer` | **+124 / −1** | — | 8 |
| `0200` | `break :label value` | **+53 / −3** | 40-60 | 5 |
| `0300` | `if (const x = f(); cond)` | **+80 / −8** | 80-120 | 14 |
| `0400` | loop `else` | **+81 / −11** | **150-250** | 7 |
| `0500` | value-position `if` / `switch` | **+359 / −6** | 300-500 | 10 |
| | **all five, hand-written** | **+697 / −29** | 400-550 + 300-500 | |
| `0800` | regenerated | +727 / −269 | — | 11 |
| `0900` | fork-owned tests | +1,040 | 400-600 | 2 |

Of the generated patch, `kind_stringer_generated.go` is +194 / −189 and is pure
enum renumbering from the two new expression kinds.

**§6.2's loop-`else` estimate was about 2x too high, for a locatable reason.**
C7 assumed the `else` value would hang off the iteration statements, which is
five node kinds and therefore four separate `bind*Statement` functions to
rewire. Putting it on **`LabeledStatement`** instead costs one bind function,
and it makes the grammar itself enforce the reference's rule that a loop value
requires a label — an unlabeled loop expression becomes unrepresentable rather
than diagnosable (the reference's `SMITHERS1702` case). The flow-graph edge C7
correctly identified as the real cost is 41 added lines in `binder.go`, not 150.

**The value-`if`/`switch` estimate held, and §5's warning was the reason.** Real
expression grammar came in at 359 lines with zero upstream regressions.
`p.reparseList` was not used anywhere.

### 8.2 What each form is, as grammar

- **`if ( VariableDeclarationList ; Expression ) …`** — an optional `Initializer`
  member on `IfStatement`, which also gains `LocalsContainerBase`. The binding is
  scoped to the `if` node itself, exactly as `for (const i = …; …)` is scoped to
  the `for` node. That gives the reference's provisional semantics for free and
  as a *proved* property rather than a text-rewrite artifact: the binding is
  visible in the `then` branch and in every `else` / `else if` branch, is
  narrowed independently in each, and is gone after the construct. `var` needs no
  refusal — it binds to the enclosing function container, which is what `var`
  means. The `let` form is behind a binding-identifier lookahead, so `if (let > 3)`
  still parses as a comparison.
- **`Identifier : IterationStatement else Expression ;`** — an optional
  `ElseValue` member on `LabeledStatement`. The `else` is claimed only for an
  iteration statement, so `label: { … } else x` stays a stray `else` and fails
  closed with an existing diagnostic. A labeled `if` keeps its own `else`.
- **`if ( Expression ) { Expression } else { Expression }`** and
  **`switch ( Expression ) { case E : Expression … }`** — two new expression
  kinds, `IfExpression` and `SwitchExpression`, plus an optional `Value` member on
  the existing `CaseOrDefaultClause`. Braced branches and a mandatory `else`
  branch are grammar, so `SMITHERS1709` (braceless branch in expression context) and
  `SMITHERS1705` (no value branch) become parse errors rather than diagnostics.
  `SMITHERS1707` and `SMITHERS1708` do not arise at all: there is no hoisting, so there
  is no evaluation order to preserve and no callee-stability proof to make.

### 8.3 The flow-graph edge, concretely

`label: loop else value` needs two exits from the label, not one:

```
                       ┌─ break :label v ─────────────────────────┐
                       │                                          v
loop ──┬── normal completion ──┐                            postStatementLabel
       ├── break              ─┼──> preElseLabel ──> else value ──┘
       └── break label        ─┘
```

`ActiveLabel` gains a `valueBreakTarget`; `bindBreakStatement` selects it when
the break carries a value. Each direction is observed in the tests through
narrowing, so a wrong edge changes the reported diagnostics rather than passing
silently.

The value `switch` deliberately creates **no** `FlowSwitchClause` node. Those
carry the switch node into `checker/flow.go`, where six sites read it back with
`AsSwitchStatement()`; a `SwitchExpression` there would panic. The cost is that
the scrutinee is not narrowed inside a clause value — conservative rather than
wrong, and recorded for the semantic lane.

### 8.4 Two new traps, both found by mutation rather than by reading

**Lazy type resolution masks a missing checker arm.** The obvious proof for the
conditional declaration — an undefined identifier in the declaration, referenced
in the branch — **passes with `checkIfStatement`'s initializer arm deleted**,
because referencing the binding resolves its symbol's type and that resolution
reports the error anyway. The arm is still required; only diagnostics that
nothing else asks for expose it. All three of these drop to zero without it:

| probe | with the arm | without |
|---|---|---|
| `if (const ignored = totallyUndefined(); true) {}` | TS2304 | — |
| `if (const n: string = 42; n) {}` | TS2322 | — |
| `if (const n; true) {}` | TS1155 + TS7005 | TS7005 |

**Accessor parity alone does not prove reachability.** C7's parity sweep compares
a new node against a same-shaped upstream node and requires return-versus-panic
agreement. That is necessary but not sufficient: if the *reference* node also
panics, the two agree and the test is green. `Node.Initializer()` on an
`IfStatement` panicked for both the new and the old shape. A second, positive
test is needed — the accessor returns the member itself, by pointer identity.
It immediately found a real hole: `SwitchExpression` has an `Expression` member
and had no arm in `Node.Expression()`.

### 8.5 Trap sweep

**28 mutations, 28 red.** Every arm added by any of the five forms has a test
that was verified to fail when the arm is removed, including the five C9-era
traps re-verified against the new code. The list is in `C11-report.md`; the
mutations themselves are mechanical deletions of the added arm.

### 8.6 Upstream health

`go test ./...` inside `tsc/`, on a checkout materialized fresh and patched by
`forkpatch apply`:

| | pristine | patched |
|---|---|---|
| packages ok | **62** | **62** |
| packages FAIL | **0** | **0** |
| `internal/testrunner` | **130,743 PASS / 0 FAIL / 2,130 SKIP** | **130,743 PASS / 0 FAIL / 2,130 SKIP** |

The ok-package list is identical. `apply` on a second, independently
materialized checkout produces all 32 files byte-identical to the first.
`verify --regenerate` passes. `unapply` restores a byte-identical pinned tree
(`git status --untracked-files=all` empty, `git diff HEAD` empty).

`tsc` built from the patched tree, on a `.sm.ts` file using all five forms under
`strict: true`: **zero diagnostics**, and a fully correct `.d.ts` — including
`describe(grade: Grade): string`, whose return type is inferred *through* a
switch expression. The `.js` still carries the constructs verbatim, because
nothing lowers them yet.

### 8.7 What grammar remains

> **HISTORICAL — six of the seven forms below have since been RETIRED from the
> language, and this table's fixture measurements MUST NOT be quoted as
> coverage.** Everything in §8 and §9 measures a *fork of `tsc`* against a
> grammar the Smithers language no longer has. Only `if (const x = f(); cond)`
> survives; `defer`/`errdefer`, `break :label value`, loop `else`, value-position
> `if`/`switch`, the labeled block value and the labeled loop value are all
> pinned as **rejected** by `conformance/corpus/19-retired-syntax/`
> (`SMITHERS1001`), per `specification/control-flow.mdx`, "No Expression-Form
> Grammar". See §8.7.1 for what the fixtures measure today.

| form | status |
|---|---|
| `defer` / `errdefer` | landed, +124 |
| `break :label value` | landed, +53 |
| `if (const x = f(); cond)` | landed, +80 |
| loop `else` | landed, +81 |
| value-position `if` / `switch` | landed, +359 |
| **labeled block value in expression position** (`const k = verdict: { … break :verdict v … }`) | **not started** |
| **labeled loop value in expression position** (`const f = search: for (…) { … } else −1`) | **not started** |

That list was measured, not guessed, **against the grammar as it stood on the
day**. Running the POC's own divergent-syntax fixtures through the patched `tsc`
as `.sm.ts` and counting only syntactic (TS1xxx) diagnostics gave, at that time:

| fixture (as it stood then) | lines | syntactic diagnostics |
|---|---|---|
| `poc/examples/language/demo.sm` | 68 | **0** |
| `poc/examples/language/conditional-declarations.sm` | 45 | **0** |
| `poc/examples/language/divergent-forms.sm` | 97 | 7 |
| `poc/examples/language/expression-flow.sm` | 45 | 7 |

All 14 were the same two constructs — `const kind = verdict: { … }` and
`const found = search: for (…) { … } else -1` — and nothing else in the fixture
set failed to parse *the fork's grammar*.

Both `divergent-forms.sm` and `expression-flow.sm` were fixtures **for forms that
have since been withdrawn**, so neither row describes a file that exists in the
shape it was measured in. `divergent-forms.sm` was ported to current syntax and
`expression-flow.sm` was deleted; see §8.7.1.

The two outstanding forms are the same construct in a different position: the
statement form of each is landed, and only the expression placement is missing.
They should be one patch, and on the measured curve they are the cheap kind of
work — a `LabeledStatement` in expression position, reusing the flow shape that
already exists — not a new node kind each.

Still open and independent of grammar: **lowering**. All five forms reach
JavaScript verbatim.

### 8.7.1 What those fixtures measure today

The table above and the one in §9.8 count diagnostics from the *patched fork*,
not from Smithers. The fork's grammar and the language's grammar are no longer
the same thing, so neither table says anything about current coverage. Six of
the seven forms are retired; the fixtures were cleaned up to match.

`poc/examples/language/expression-flow.sm` **has been deleted.** Every construct
it demonstrated is now retired or rejected — the value-position `switch` and the
braced value-position `if`
(`19-retired-syntax/{switch-expression,braced-if-expression}-is-retired`), the
expression-position labeled block value and labeled loop value with `else`
(`19-retired-syntax/{labeled-block-value,labeled-loop-value,loop-else-completion}-is-retired`),
and `combine(checkedScore(score)!, …)`, a postfix `!` in a call argument
(`02-unwrap-propagation/postfix-bang-in-a-call-argument-is-rejected`,
`SMITHERS1204`). It did not `check`: 18 `TS1xxx` parse diagnostics, and the
formatter refused it with `SMITHERS1901`. Each replacement the corpus names is
ordinary TypeScript, and `divergent-forms.sm` already demonstrates every one of
them under the same four function names (`describe`, `weighted`, `classify`,
`firstPassing`), so a port would have produced a duplicate of a file that already
exists.

The surviving fixture set, measured through `smithers check`, which is the tool
the language contract is defined against:

| fixture | lines | `smithers check` | formatter |
|---|---|---|---|
| `poc/examples/language/demo.sm` | 69 | `ok: true`, **0** diagnostics | accepted, idempotent |
| `poc/examples/language/conditional-declarations.sm` | 44 | `ok: true`, **0** diagnostics | accepted, idempotent |
| `poc/examples/language/divergent-forms.sm` | 83 | `ok: true`, **0** diagnostics | accepted, idempotent |

Between them they demonstrate the one surviving grammar addition,
`if (const x = f(); cond)`, and postfix `!` Result propagation in the placements
the specification accepts. No example in the tree demonstrates a retired form.

---

## 9. The last two forms, landed — the surface syntax is complete

§8 left the two expression-position labeled values outstanding. Both are now in
the series, as **one** patch, and every construct in the POC's reference corpus
parses. Every number below is measured from the checked-in patches.

### 9.1 Cost, against §8's prediction

| patch | form | measured | §8's estimate | files |
|---|---|---|---|---|
| `0600` | labeled block value **and** labeled loop value, in expression position | **+245 / −15** | 80-150 combined | 8 |
| | **all seven, hand-written** | **+942 / −44** | | |
| `0800` | regenerated | +822 / −269 | — | 11 |
| `0900` | fork-owned tests | +1,609 | — | 2 |

```
0600  ast.json +19   parser +93/−6   printer +19/−1   binder +17/−2
      checker +44    ast/utilities +47/−3   ast/precedence +4/−3   ast.go +2
```

**§8's 80-150 estimate was low, and the reason is worth recording**: it assumed
the work was a placement change on an existing node. It is not — an expression
position needs a node that `ast.IsStatement` answers *false* for, and a
`LabeledStatement` cannot be that node without making an illegal state
representable. So a new expression kind was unavoidable. What the estimate got
right is the *class* of work: one expression kind at +245 sits well below §8's
+359 for two of them, and the reuse is what bought the difference.

### 9.2 The leverage: one kind that delegates, not two that restate

The obvious shape is two new expression kinds — `LabeledBlockExpression` and
`LabeledLoopExpression` — each restating a label, a body, and (for the loop) an
`else` completion value. On §8's measured curve that is the +359 band twice over,
and it would have needed its own label binding, its own flow graph, and its own
printer.

What landed is **one** kind whose only member is the `LabeledStatement` that
already exists:

```go
type LabeledExpression struct {
	Statement          *LabeledStatementNode
	CompletionFlowNode *FlowNode // goOnly
}
```

That is the same trick §8 used when it put `ElseValue` on `LabeledStatement`
instead of on five iteration kinds, applied one level up: instead of adding a
member to an existing node, add a node whose member *is* an existing node.
Everything below the wrapper is code that was already written and already tested:

| what it needs | where it comes from |
|---|---|
| label binding, `ActiveLabel`, unused-label check | `binder.bindLabeledStatement`, unchanged apart from 17 lines |
| the two-exit flow graph | §8's loop-`else` edge, reused verbatim |
| `break :label value` | §7's `BreakStatement.Value` member |
| the loop `else` completion value | §8's `LabeledStatement.ElseValue` member |
| checking the body | `checker.checkLabeledStatement` |
| printing | `printer.emitLabeledStatement`, split into a worker taking one bool |

The binder needed **no new dispatch arm at all**: `bindChildren`'s default
`bindEachChild` visits the wrapper's single child and lands in
`bindLabeledStatement`. The parser needed no `isStartOfLeftHandSideExpression`
arm either, because the construct starts with an identifier and that predicate
already returns `p.isIdentifier()` — so every list-shaped expression position
(arguments, array elements, object property values) was open before the first
line was written. Those two are the entire reason a second expression kind cost
68 % of what the first two cost together.

Two illegal states are unrepresentable rather than diagnosable, both of which
the reference has to detect and report:

- **`SMITHERS1702`** — an unlabeled block or loop in expression position. The label
  is the first token of the production, so there is nothing to diagnose.
- **`SMITHERS1715`** — a value loop with no `else` completion. The `else` is required
  by the grammar in expression position (and only there: the statement form may
  still simply end).

### 9.3 What each form is, as grammar

- **`Identifier : Block`** — an expression whose value is the join of the
  `break :label value` exits inside it. **`SMITHERS1714`** — "a block that may
  complete normally without reaching any `break :label value`" — is enforced by
  the **type system**, not a new diagnostic: the binder splits the label's
  normal-completion exit from its value exit and records the completion flow
  node on the wrapper, and the checker appends `undefined` to the type when that
  node is reachable. Under `strict` the resulting `T | undefined` is reported by
  ordinary assignability at the use site. That is exactly the mechanism §8 used
  for a value `switch` with no `default`.
- **`Identifier : IterationStatement else AssignmentExpression`** — the same
  node with the loop's `else` completion value filled in, so the value is the
  join of the value breaks *and* the else value. Value breaks skip the else;
  normal completion, `continue`, an unlabeled `break` and a plain `break label`
  all flow into it. The completion value is an `AssignmentExpression` rather than
  an `Expression`, so it stops at a comma and the construct composes with
  argument lists and array literals.

### 9.4 The ambiguity, and why it is keyed on a position

`Identifier :` in expression position collides with **three** productions that
parse an expression and then claim the following `:` for themselves:

| production | what breaks without suppression |
|---|---|
| labeled statement | `outer: { … }` stops being a `LabeledStatement` |
| `case` clause label | `case a: { … }` stops parsing — in both the statement `switch` and §8's value `switch` |
| conditional `whenTrue` | `c ? a : { k: 1 }` stops parsing |

All three break **ordinary TypeScript**, not the new form, which is what makes
this the expensive half of the patch (93 of the 245 lines are parser).

A context flag is the obvious mechanism and is the wrong one: it would also
disable the construct for every nested expression, so `f(verdict: { … })` at
statement level would stop working, and it would then need explicit clearing at
every bracketed position. What landed is a single `int` on the parser holding
the one position at which the construct is suppressed, set around the expression
that *starts* at each of the three sites. A nested expression begins at a later
position and is unaffected. Upstream already keys `notParenthesizedArrow` the
same way, so the shape is idiomatic rather than invented.

### 9.5 A third enumerated expression-kind switch, found by sweeping

`ast.IsExpressionNode` is not `isExpressionKind` and does not delegate to it.
`isExpressionKind` → `isUnaryExpressionKind` → `isLeftHandSideExpressionKind` is
one chain, so a single arm covers all three; `IsExpressionNode` restates the list
independently, and it is what `getTypeOfNode`, `getSymbolAtLocation`,
`isInExpressionContext` and the type/symbol baseline writer all go through.

**`KindIfExpression` and `KindSwitchExpression` were missing from it** — a live
hole left by §8, now closed for all three Smithers expression kinds. It is
completely silent: with the arm deleted, every Smithers diagnostic test, every
round-trip test and every shape test still passes, and the only symptom is that
asking a value `if` for its type answers with no type at all. Proved by
mutation: deleting the arm turns exactly one test red and nothing else.

**Generalised rule for the sweep list: a new expression kind needs an arm in
`isLeftHandSideExpressionKind` AND in `IsExpressionNode`. The first is what makes
it an expression; the second is what makes it have a type when asked.**

### 9.6 Trap sweep

**25 mutations, 25 red.** Every arm added by this patch has a test that was
verified to fail when the arm is deleted, plus three C11-era traps re-verified
against the changed `bindLabeledStatement` and `emitLabeledStatement`. Three of
the 25 were GREEN on the first pass and the tests were strengthened until they
were red:

- the value-switch case-label suppression — the probe's clause value did not
  begin with `{`, so nothing was ambiguous;
- the function-boundary stop in `ForEachValueBreakStatement` — the probe rebound
  the label inside the function, so the *rebound-label* stop masked it and either
  could have been deleted undetected;
- the `isLeftHandSideExpressionKind` mutation itself, which matched two sites
  once `IsExpressionNode` carried the same kind list.

The second is the sharpest and generalises: **when two independent stop
conditions can both fire on the same probe, the sweep proves only that at least
one of them exists.** Give each its own probe.

### 9.7 Upstream health

`go test ./...` inside `tsc/`, on checkouts materialized fresh from the vendored
capsule:

| | pristine | patched |
|---|---|---|
| packages ok | **62** | **62** |
| packages FAIL | **0** | **0** |
| `internal/testrunner` | **130,743 PASS / 0 FAIL / 2,130 SKIP** | **130,743 PASS / 0 FAIL / 2,130 SKIP** |

`tsc` built from the patched tree, on one `.sm.ts` using **all seven forms**
under `strict: true, declaration: true`: **exit 0, zero diagnostics**, and a
`.d.ts` whose return types are inferred *through* the new constructs —
`classify(input: string): string` through a labeled block value,
`firstPassing(scores: number[]): number` through a labeled loop value, and
`composed(…): string` through a labeled block value whose break value is itself a
value `if`.

### 9.8 The surface syntax is complete

> **Corrected by §11. This section measured against `poc/examples/language/*.sm`
> — fixtures — and not against `conformance/corpus/**`, which is the contract.
> Two corpus cases did not parse; §10.8 found them and §11 closed them. The
> table below is still true of what it measured, and that is the point: it was
> the wrong thing to measure.**
>
> **Corrected again, and more sharply: six of the seven forms below are now
> RETIRED, so the "Zero." reading is a measurement of a grammar the language
> rejects and MUST NOT be quoted as coverage.** The zero counts the *fork's*
> parse of forms that `conformance/corpus/19-retired-syntax/` now pins as
> `SMITHERS1001` errors. `poc/examples/language/expression-flow.sm`, one of the
> four files it reads over, has been deleted — every construct in it is retired
> or rejected, and it did not `check` (18 `TS1xxx`) nor format
> (`SMITHERS1901`). §8.7.1 carries the current measurement of the surviving
> fixtures through `smithers check`, which is what current coverage means.

The POC's own divergent-syntax fixtures through the patched `tsc` as `.sm.ts`,
counting only syntactic (TS1xxx) diagnostics, **as the files and the fork stood
on the day**:

| fixture (as it stood then) | lines | §8 | then |
|---|---|---|---|
| `poc/examples/language/demo.sm` | 68 | 0 | **0** |
| `poc/examples/language/conditional-declarations.sm` | 45 | 0 | **0** |
| `poc/examples/language/divergent-forms.sm` | 97 | 7 | **0** |
| `poc/examples/language/expression-flow.sm` (deleted) | 45 | 7 | **0** |

**Zero — against the fork's grammar of the day, which is not the language's.**
The 26 diagnostics that remained across the four files were all TS2304 / TS2307 /
TS2339 / TS7006 for `Result`, `smthrs/context`, `smithers:exceptions` and the
other standard-library names that have no TypeScript declarations in this
harness; not one was a grammar error. What the number does not say is that six of
the seven forms it cleared were later withdrawn: today the same four files would
be a very different measurement, and two of them no longer exist in the shape
measured here. For the current numbers see §8.7.1.

| form | status | today |
|---|---|---|
| `defer` / `errdefer` | landed, +124 | **retired** |
| `break :label value` | landed, +53 | **retired** |
| `if (const x = f(); cond)` | landed, +80 | **survives — the only one** |
| loop `else` | landed, +81 | **retired** |
| value-position `if` / `switch` | landed, +359 | **retired** |
| labeled block value in expression position | landed | **retired** |
| labeled loop value in expression position | landed, +245 for the pair | **retired** |

Still open and independent of grammar: **lowering**. All seven forms reach
JavaScript verbatim.

---

## 10. Flow analysis: what grammar left behind

§9 closed the last grammar gap. This section is the first patch in the series
that adds **no AST member and no node kind** — `0700` is checker and flow
analysis only, which is why `0800-regenerate-ast.patch` is byte-identical across
it. Everything below is measured from the checked-in patches.

### 10.1 The statement-`switch` fallthrough case is upstream TypeScript, not us

`conformance/corpus/11-expression-if-switch/statement-switch-keeps-typescript-fallthrough`
parses and then reports **TS2678** for its second `case`. The prior lane recorded
this as "the pinned checker narrows the discriminant to the first literal". It
does not narrow anything, and it is not ours:

| what was run | result |
|---|---|
| **pristine** pinned checkout, **zero** patches applied | `TS2678` at 7:10 |
| the patched tree, all nine patches | `TS2678` at 7:10 — byte-identical |
| stock `typescript@7.0.2` from npm, on the same source as plain `.ts` | `TS2678` at 7:10 |
| the JS reference instrument's own `checkEmittedTypeScript` | `TS2678` at 7:10 |

`checker.go:checkSwitchStatement` does `expressionType := c.checkExpression(node.Expression())`
and then, per clause, `checkTypeComparableTo(caseType, expressionType, …)`. The
scrutinee is the literal `"a"`, so its type *is* `"a"`, and `case "b"` is not
comparable to it. No flow node is involved. Two control probes confirm the
mechanism: the same switch with **no fallthrough at all** reports the same error,
and widening the scrutinee (`x: string`, or `let s = "a"`) makes it disappear.

So the fork already obeys the locked compatibility rule — "syntax shared by
Smithers and TypeScript keeps TypeScript behavior unless a divergence is
explicitly documented". Reporting TS2678 here *is* TypeScript's behavior.
**Suppressing it would be the divergence**, and it was therefore not touched.

The conformance case passes on the JS reference for a reason worth recording:
`conformance/runner/backend-js.mjs` calls `compileProject` and never calls
`checkEmittedProject`, so that path never type-checks the emitted TypeScript at
all. The reference's own CLI, which does, reports the same TS2678. The case is
green by omission of a check, not by a semantic difference.

### 10.2 What the value `switch` was actually missing — three defects, not one

§8 recorded one deliberate conservatism: no `FlowSwitchClause`, so no narrowing.
Two more were underneath it, and both were worse than conservative.

| defect | symptom | how visible |
|---|---|---|
| no `FlowSwitchClause` per clause | the scrutinee keeps its declared type in a clause value | the documented one |
| `bindCaseOrDefaultClause` never binds `clause.Value` | every identifier in a clause value has a **nil flow node**, so narrowing established *outside* the switch is lost too | silent |
| `bindSwitchExpressionFlow` never sets `preSwitchCaseFlow` | a case **label** expression is bound at whatever flow an enclosing switch statement left behind, or at nil | silent |

The second is the sharp one. `bindChildren` dispatches `bindCaseOrDefaultClause`
rather than `bindEachChild`, and that function enumerates the clause's members.
A member it does not name is not bound at all — so
`if (typeof s === "string") { switch (1) { case 1: s.length } }` reported
TS2339. That is not "the switch does not narrow"; it is "nothing narrows".

### 10.3 The abstraction: one accessor, not six casts

The six `checker/flow.go` sites reachable from a `FlowSwitchClause` split into
three groups once looked at:

| group | sites | what was needed |
|---|---|---|
| reads the scrutinee — `data.SwitchNode.Expression()` | `getTypeAtSwitchClause`, `computeExhaustiveSwitch` | **nothing.** `Node.Expression()` already had a `KindSwitchExpression` arm from §8's accessor sweep. It was latent then; it is load-bearing now. |
| caches per switch node — `c.switchStatementLinks.Get(node)` | 3 | **nothing.** The cache is keyed by `*ast.Node`. |
| reads the clause list — `node.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes` | `narrowTypeBySwitchOnTypeOf`, `narrowTypeBySwitchOnTrue`, `getSwitchClauseTypes`, `getSwitchClauseTypeOfWitnesses` | **one accessor** |

So the whole "six sites would panic" problem is **four identical expressions**,
and the honest fix is one kind-aware accessor rather than a cast at each:

```go
func SwitchCaseBlock(node *Node) *CaseBlockNode {
	switch node.Kind {
	case KindSwitchStatement:  return node.AsSwitchStatement().CaseBlock
	case KindSwitchExpression: return node.AsSwitchExpression().CaseBlock
	}
	panic("Unhandled case in ast.SwitchCaseBlock: " + node.Kind.String())
}
```

It **panics** rather than returning an empty list, for the same reason the 21
generic accessors do: an empty clause list is a plausible-looking wrong answer
that makes every switch look non-narrowing and non-exhaustive at once.

`FlowSwitchClauseData.SwitchStatement` was renamed to **`SwitchNode`**. The
rename is the point: a field named `SwitchStatement` holding a
`KindSwitchExpression` is precisely how the next lane writes
`AsSwitchStatement()` and ships a panic. It is ten sites in three files, and the
compiler re-types every one of them.

**Exhaustiveness is now one function for both kinds**, not two.
`isExhaustiveSwitchExpression` was deleted and `checkSwitchExpression` calls
`isExhaustiveSwitch(node)`. That is not tidiness: the binder's no-default bypass
edge is judged reachable by `isExhaustiveSwitch` and by nothing else, while the
expression's *type* carries `undefined` from the same question. Two copies could
disagree — and did, in the obvious way: the value-switch-only copy handled only a
literal-union scrutinee, so `switch (typeof x) { case "string": … case "number": … }`
over `string | number` carried `undefined` in its type while its own flow graph
called the bypass unreachable. Sharing the function fixed the `typeof` case for
free.

### 10.4 A FOURTH enumerated expression switch — and it panicked

§9.5 found `ast.IsExpressionNode`. It answers for an `Identifier` or a literal by
delegating to **`ast.IsInExpressionContext`**, which switches on the **parent's**
kind and asks whether the node is the member that parent evaluates. That makes it
the first of these switches a new *member* trips even when no node kind is added,
which is how it survived all six grammar patches.

Every Smithers member holding an expression was missing from it:

| member | before |
|---|---|
| `DeferStatement.Expression`, `ErrdeferStatement.Expression` | `IsExpressionNode` false, `GetTypeAtLocation` → `any` |
| `BreakStatement.Value` | false → `any` |
| `LabeledStatement.ElseValue` | false → `any` |
| `CaseOrDefaultClause.Value` on a `case` clause | false → `any` |
| `CaseOrDefaultClause.Value` on a **`default:`** clause | **`panic: Unhandled case in Node.Expression: KindDefaultClause`** |

The panic is upstream's own arm, `case KindCaseClause, KindDefaultClause: return
parent.Expression() == node`, which is safe only while a default clause's
children are all statements — a statement never reaches
`IsInExpressionContext`. A value clause puts an expression there and the arm
reads a member `Node.Expression()` has no case for. Asking the language service
for the type of an identifier used as a `default:` value crashed the process.

The replacement arm compares against the specific members
(`clause.Expression == node || clause.Value == node`) rather than answering
`true` for any child, because the **label** of a `LabeledStatement` and of a
`break :label value` is an identifier with that same parent and is not an
expression. Two mutations in the sweep are exactly that: turn each arm into
`return true` and watch the label assertion go red.

### 10.5 A statement-kind allowlist that a value construct walks straight past

`ast.ForEachReturnStatement` is a 15-arm allowlist of statement kinds. It is
complete for ordinary TypeScript because a `return` is only legal in a statement
position — so the walk never enters an expression, and gets "do not descend into
a nested function" for free.

An expression-position labeled value hangs statements off an expression:

```ts
export function f(x: number) {
  const k: number = verdict: {
    if (x > 0) { return "early"; }
    break :verdict 1;
  };
  return k;
}
```

`KindVariableStatement` is not in the allowlist at all, so the `return "early"`
was invisible to `checkAndAggregateReturnExpressionTypes`. **Measured before the
fix: `export declare function f(x: number): number;`** — a `.d.ts` that denies a
value the function actually returns, with no diagnostic anywhere. After:
`number | "early"`.

The walk now continues through every child, stopping at
`IsFunctionLikeOrClassStaticBlockDeclaration`, **gated on `NodeFlagsSmithers`**.
That gate is not shyness: it makes the change provably inert for ordinary
TypeScript — the flag is a parser context flag set only on nodes from a `.sm` or
`.sm.ts` file, so no upstream traversal changes shape or cost, and the
130,743-subtest baseline cannot move. §9's `ForEachValueBreakStatement` solved
the same problem in the same shape and is where the function-boundary stop comes
from.

### 10.6 Trap sweep

**22 mutations, 22 RED** — 21 by test failure and one caught by the Go compiler
(deleting the per-clause `createFlowSwitchClause` leaves the loop index unused).
Scripted, repeatable, and re-run end to end after every test change. Six are
mutations on prior-lane arms that this patch made load-bearing, `Node.Expression()`'s
`KindSwitchExpression` arm chief among them: §8 added it for accessor parity and
nothing called it, and `getTypeAtSwitchClause` now does on every clause.

### 10.7 Upstream health

`go test ./...` inside `tsc/`, on checkouts materialized fresh from the vendored
capsule, with the series applied by `forkpatch apply`:

| | pristine | patched |
|---|---|---|
| packages ok | **62** | **62** |
| packages FAIL | **0** | **0** |
| `internal/testrunner` | **130,743 PASS / 0 FAIL / 2,130 SKIP** | **130,743 PASS / 0 FAIL / 2,130 SKIP** |

Both measured on this machine, ok-package lists identical by diff.

### 10.8 What is still not reasoned about

> **Both cases below are closed in §11**, with no node kind and no AST member.

Two conformance-corpus forms do **not parse**, so §9.8's "surface syntax is
complete" holds against `poc/examples/language/*.sm` but not against
`conformance/corpus/**`:

| case | what it needs |
|---|---|
| `11-expression-if-switch/switch-case-final-expression-is-the-value` | a value clause that is *statements followed by a final expression*, not a single expression. The grammar is `case E : Expression`. |
| `11-expression-if-switch/braceless-if-in-a-variable-initializer` | a braceless value `if` in the bounded host of a variable initializer. The grammar requires braces everywhere; the corpus wants SMITHERS1709 only in general expression placements. |

Everything else in the 96-case corpus parses: the only other TS1xxx diagnostics
are the four negative cases that are *supposed* to be parse errors.

Both are grammar, not flow analysis — but the first is flow-analysis-shaped once
written, because a clause whose value is a statement sequence with a completion
value is the same problem the labeled block value already solves.

---

## 11. The corpus, not the fixtures — the last two forms

§9.8 declared the surface syntax complete against `poc/examples/language/*.sm`.
That was the wrong yardstick: `conformance/corpus/**` is the contract, and §10.7
found two of its 96 cases that did not parse. Both are closed here, in one patch
that adds **no node kind and no AST member** — `0800-regenerate-ast.patch` is
byte-identical across it for the second time running.

### 11.1 The two cases, diagnosed before anything was written

| case | what the corpus expects | what the patched fork did | class |
|---|---|---|---|
| `switch-case-final-expression-is-the-value` | `expect: "output"`, `["met the bar", "resit scheduled", "pass,retry"]` — the clause's `record(...)` runs *and* the final expression is the value | `TS1130 'case' or 'default' expected` at 11:34, plus four cascade errors | **grammar** |
| `braceless-if-in-a-variable-initializer` | `expect: "output"`, `["yes","no"]` for `const value = if (enabled) "yes" else "no"` | `TS1005 '{' expected` at 2:30 | **grammar** |

**Neither corpus case is wrong.** The first is a direct instantiation of
`docs/src/pages/specification/control-flow.mdx`: *"In expression position, a
switch MUST return the selected case's final expression"* — and "final" is only
meaningful if statements may precede it. The second is the spelling the
specification itself uses one section earlier, `const value = if (condition)
consequent else alternate`, and the corpus is internally consistent about it: the
sibling case `if-expression-with-a-braceless-branch-is-rejected` requires
**SMITHERS1709** for the same spelling in a *call-argument* placement. So the rule is
placement-conditional, not "braceless is illegal" and not "braceless is legal".

### 11.2 Neither one was a shape problem, and that is the whole cost story

**The value clause already had both members it needed.** `CaseOrDefaultClause`
carries upstream's `Statements` *and* §8's `Value`; `parseValueCaseOrDefaultClause`
was simply constructing an empty statement list every time. So "a clause that is
statements followed by a final expression" is a **parser** change, and the binder
was already correct — §10's `bindCaseOrDefaultClause` binds `Statements` and then
`Value`, in that order, which is exactly what narrowing into a clause body needs.

**The value `if` was a parser-*entry* problem, not a shape problem.** §9's note
that `IfExpression{Condition,WhenTrue,WhenFalse}` was shaped like
`ConditionalExpression` is right, and it is why nothing about the node changed:
what changed is which parse function the branch goes through.

### 11.3 The leverage: an illegal state that has no node

SMITHERS1709 — "a braceless branch in a general expression placement" — is not
diagnosed. It is **unrepresentable**, in the same way §9.2 made SMITHERS1702 and
SMITHERS1715 unrepresentable: the branch brace is *required* outside the bounded
host, so the shape never parses and there is nothing to report on. That removes a
diagnostic, a checker arm, a message, and a position from the budget.

The bounded host is a single `int` on the parser, `bracelessValueIfPos`, set
around a variable declaration's initializer and compared for equality at the `if`
keyword — the same position-keyed memo §9.4 used for the labeled-value colon
suppression, and the one upstream already uses for `notParenthesizedArrow`.
Position equality is what makes every other placement fail for one reason:

| placement | braceless accepted? |
|---|---|
| `const x = if (b) 1 else 2` | **yes** |
| `let x = …`, a `for` initializer, the second declarator in a list | **yes** |
| `const x = if (a) 1 else if (b) 2 else 3` — the chain inherits the host | **yes** |
| `f(a, if (b) 1 else 2)` | no — SMITHERS1709's placement |
| `return if (b) 1 else 2`, an array element, an object property value | no |
| `x = if (b) 1 else 2` (assignment), `const x = (if (b) 1 else 2)` | no — the `if` starts one token later |
| a parameter default, a class property initializer | no — they go through `parseInitializer`, not `parseVariableInitializer` |
| a `.ts` file, braceless or braced | no — the dialect gate is unchanged |

A branch that starts with `{` still takes the braced path, so admitting the
braceless one takes nothing away. The branch is an `AssignmentExpression`, not an
`Expression`, so it stops at a comma and `const a = if (c) x else y, b = 2` still
declares two bindings — the same reason §8's loop `else` value is one.

### 11.4 The clause body: the expression parse gets the first look

```go
state := p.mark()
value := p.parseExpressionAllowIn()
p.parseOptional(ast.KindSemicolonToken)
if len(p.diagnostics) == state.diagnosticsLen && p.isListTerminator(PCSwitchClauseStatements) {
    return emptyList, value          // the single-expression clause, unchanged
}
p.rewind(state)
statements := p.parseList(PCSwitchClauseStatements, (*Parser).parseStatement).Nodes
// the trailing ExpressionStatement's EXPRESSION becomes the clause value
```

The ordering is load-bearing rather than an optimisation. `parseStatement` claims
a statement-initial `if` / `switch` / `for`, so `case "a": if (p) { 1 } else { 2 }`
— which §8 made legal and which nothing in the corpus exercises — is a value `if`
**only while the expression parse gets the first look**. Parsing statements first
would have silently demoted it to an `if` statement and left the clause with no
value. That is mutation M9.

Two conditions guard the speculative accept and each has its own probe: the
expression must reach a clause terminator (`case` / `default` / `}` / EOF), and
it must produce **no new diagnostics** — without the second, `case "a":` with an
empty body is "accepted" carrying a parse error instead of falling back.

The value is the trailing statement's **expression**, not the statement, so it
lands exactly where a single-expression clause puts it. `p.finishNode` re-parents
every immediate child, so the discarded `ExpressionStatement` leaves no stale
pointer. One shape means one code path in the binder (`b.bind(clause.Value)`), in
the checker (one union member), in `ast.IsInExpressionContext` and in
`transformers.IsIdentifierReference` — the alternative, leaving the statement in
place and having each consumer find it, is four enumerated decisions instead of
one.

**A clause with no final expression is legal and is not silent.** `case "a":
throw e` diverges and contributes nothing; `case "a":` or a clause ending in an
`if` statement *completes* and contributes `undefined`, so the switch's type is
`T | undefined` and ordinary assignability reports it at the use site — §8's
missing-`default` rule, applied one level down. Which of the two it is, is a
reachability question, and the binder already had the member to answer it:
`CaseOrDefaultClause.FallthroughFlowNode` means "the flow node control leaves
this clause's body at", which is the same fact `NoFallthroughCasesInSwitch` reads
it for.

### 11.5 Three more enumerated switches, all keying on the PARENT

§9.5 found a third expression-kind switch and §10.4 a fourth. All three below are
fifth, sixth and seventh, all of them switch on the **parent's** kind, and all
three were live defects in landed work rather than anything this patch
introduced. That is now the pattern worth stating outright: **a new member is
invisible to every switch that enumerates the node's own kind, so the
parent-keyed ones are where to look first.**

| # | switch | missing arms | measured symptom |
|---|---|---|---|
| 5 | `checker.getContextualType` | `KindIfExpression`, `KindCaseClause`/`KindDefaultClause` | **spurious errors on correct programs.** `const f: (n: number) => number = if (c) { (n) => n } else { (n) => n + 1 }` → TS7006 ×2; the identical conditional expression is clean |
| 6 | `transformers.IsIdentifierReference` | `KindDefaultClause`, `KindDeferStatement`, `KindErrdeferStatement`, `KindBreakStatement`, `KindLabeledStatement`, `KindIfExpression`, `KindSwitchExpression`, and `KindCaseClause`'s `Value` | **wrong emitted JavaScript, exit code 0.** `exports.viaIf = if (flag) { alpha } else { beta }` against `dep_1.flag ? dep_1.alpha : dep_1.beta` one line below |
| 7 | `binder.isStatementCondition` | `KindIfExpression` | **narrowing lost.** `if (a !== null && b !== null) { a.length + b }` in value position → TS18047 ×2 |

The sixth is the sharpest thing found in this lane. `IsIdentifierReference` is
what `CommonJSModuleTransformer.visitIdentifier` and the enum/namespace
transformer gate identifier *substitution* on: a `false` answer is not a
diagnostic and not a type, it is a `ReferenceError` at run time from a program
that compiled clean. `KindCaseClause` was in the "only an `Expression()` child"
group, which answered for the case *label* and never for a clause value, and
`KindDefaultClause` was in no group at all. Every Smithers member added since
`0100` was affected; the whole-program emit test in the checker package is the
proof, and it also asserts the negative — a jump-target label is an identifier
with the same parent and must **not** become `dep_1.verdict`.

The seventh is a two-call-deep interaction and is worth the shape rather than the
detail. `bindIfExpressionFlow` sets the enclosing true/false targets and then
binds the condition; `bindBinaryExpressionFlow` asks
`isTopLevelLogicalExpression` whether it is the top of its own condition, and if
it thinks so it **replaces** those targets with a fresh post-expression label.
`KindConditionalExpression` was in the predicate and `KindIfExpression` was not,
so the value `if` set up its narrowing and had it discarded one call later.

Also closed, and on the known list rather than new: a value clause may declare
bindings, and `checkSwitchExpression` never registered its `CaseBlock` for
`registerForUnusedIdentifiersCheck`, so `noUnusedLocals` never looked inside a
value `switch`. `ast.IsBlockScope` and `binder.GetContainerFlags` already agreed
the table exists — **the table existing is not the same fact as the table being
checked.**

### 11.6 Trap sweep

**38 mutations, 38 RED**, plus **C14's 25 re-run against the changed code, 25
RED** — 63 in total, scripted, and re-run end to end after the final `gofmt`
pass. Every arm this patch adds has a test verified to fail when the arm is
removed, and every member comparison has a mutation that widens it to "any child"
and goes red on the negative assertion (the condition of a value `if`, a `case`
label, a jump-target label).

One deliberate exception, recorded rather than hidden: the save/restore around
`p.bracelessValueIfPos` in `parseVariableInitializer` has **no red mutation**.
Deleting the restore is behaviourally undetectable, because a position is only
ever compared for equality against a token the parser is at *now*, and positions
increase monotonically within a declaration — so a stale value can never collide.
It is kept for symmetry with `parseColonClaimingExpression` and because a field
that lies about its meaning is how the next lane ships a bug, but no probe
distinguishes it and this document says so rather than claiming 39/39.

### 11.7 Cost

| patch | measured | files |
|---|---|---|
| `0750-value-clause-statements-and-braceless-if-grammar` | **+235 / −19** | 5 |
| | all hand-written, cumulative | **+1,332 / −116** |
| `0800` regenerated | **unchanged** — no AST member, no node kind | 11 |
| `0900` fork-owned tests | +2,730 (was +2,030) | 2 |

```
0750  parser +99/−14   checker +71/−2   transformers/utilities +30/−2
      binder +18       printer +17/−1
```

Against §9's cost curve: the cheapest **new expression kind** measured in this
series was +245 and the most expensive pair +359. Two whole conformance forms
here cost **+235** — and roughly a third of that (+101 across `checker.go`,
`transformers/utilities.go` and `binder.go`) is the three enumerated switches,
which were pre-existing defects rather than either form's own cost. **The forms
themselves cost about +134.** The member-vs-Kind leverage did not apply because
there was nothing to add: both members already existed, and the second form
needed neither. That is the endpoint of the curve §7.3 started — a form whose
marginal AST cost is zero.

### 11.8 Upstream health

`go test ./...` inside `tsc/`, on checkouts materialized fresh from the vendored
capsule, with the series applied by `forkpatch apply`:

| | pristine | patched |
|---|---|---|
| packages ok | **62** | **62** |
| packages FAIL | **0** | **0** |
| `internal/testrunner` | **130,743 PASS / 0 FAIL / 2,130 SKIP** | **130,743 PASS / 0 FAIL / 2,130 SKIP** |

Both measured on this machine, ok-package lists identical by diff. Three
independently materialized checkouts produced all 35 post-image files
byte-identical; `verify --regenerate` passes; `unapply` leaves an empty
`git status --untracked-files=all` and an empty `git diff HEAD`.

`tsc` built from the applied series, on one `.sm.ts` using **all nine forms**
under `strict: true, declaration: true`: **exit 0, zero diagnostics**, and a
`.d.ts` including `earlyExit(grade: Grade): string | 0` — a return type inferred
through a `return` written inside a value clause's statements.

### 11.9 Completeness, against the corpus

| | cases | measured with |
|---|---|---|
| `conformance/corpus/**` that parse | **92 / 96** | every `.sm` compiled as `.sm.ts` by the patched `tsc`, counting TS1xxx |
| that do not | **4** | all four are `expect: "diagnostics"` negative cases |

The four are `if-expression-with-a-braceless-branch-is-rejected` (SMITHERS1709),
`unlabeled-loop-expression-is-rejected` (SMITHERS1702),
`labeled-block-value-break-inside-a-nested-function-is-rejected` (SMITHERS1714) and
`loop-value-without-an-else-is-rejected` (SMITHERS1715). Each is a shape the grammar
makes unrepresentable, so refusing it *is* the contract — the fork reports a
TS1xxx where the reference reports a SMITHERS17xx, and mapping one to the other is
the bridge lane's job, not the grammar's.

**So: every conformance-corpus case that is meant to compile, parses.** That is
the honest completeness statement, and it is not the same claim §9.8 made.

### 11.10 What is still not reasoned about

- **Diagnostic identity.** The grammar refuses SMITHERS1702 / SMITHERS1709 / SMITHERS1714 /
  SMITHERS1715 with TS1005 / TS1107 / TS1109. Whether the corpus contract wants the
  SMITHERS codes emitted by the fork, or mapped by the runner, is a language decision.
- **`statement-switch-keeps-typescript-fallthrough`** still fails on the Go
  backend for §10.1's reason — it is upstream TypeScript's own TS2678 — and needs
  a language decision, not a fork change.
- **`extendAssignmentPosition`** still has no defer/errdefer arm (§10.8).
- **Language services** still do not know the two switch kinds apart (§10.8).
- **A braceless value `if` outside a variable initializer.** `return if (c) a
  else b` is equally bounded and is *not* accepted, because the corpus names only
  the variable initializer. Widening the host is a language decision; the
  mechanism is one more call site.
- **Lowering.** Unchanged and untouched: all nine forms still reach JavaScript
  verbatim. The `IsIdentifierReference` fix above matters most to that lane —
  before it, every Smithers value position emitted unqualified module bindings.
