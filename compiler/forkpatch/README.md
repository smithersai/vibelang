# forkpatch — how this repository carries changes to upstream files

`compiler/forkpatch` is the mechanism for Smithers changes that **modify files
the pinned TypeScript fork already owns**. It is the third injection mechanism in
this repository, and the first one that can express a modification rather than an
addition.

| mechanism | owner | what it can inject | what it cannot do |
|---|---|---|---|
| `go build -overlay` | `compiler/fork.go` + `compiler/forkbridge/**` | a whole Go file into a package the fork already has | modify an upstream file; add a new package directory; touch a non-Go file |
| checkout population | `scripts/build-smithersc.mjs` + `cmd/smithersc/forksrc/**` | whole new Go files, new package directories | modify an upstream file — it **refuses** when the target already exists (`build-smithersc.mjs:301`) |
| **`compiler/forkpatch`** | this directory | modifications to any upstream file, plus new fork-owned files | nothing that is not expressible as a diff against the pinned revision |

Grammar needs the third. `defer expr;` changes `internal/parser/parser.go`,
`internal/printer/printer.go`, `internal/checker/checker.go`,
`internal/ast/ast.go`, `internal/ast/utilities.go`, `internal/ast/nodeflags.go`,
`internal/scanner/scanner.go`, ten generated files — and
`tools/scripts/tsc/ast.json`, which is not Go and which no Go mechanism can
reach at all.

## The shape

An **ordered series of unified diffs, checked in as plain text, applied by
`git apply` to a checkout verified to be at the pinned revision, gated on
SHA-256 digests of every file before and after.**

```
compiler/forkpatch/
  forkpatch.mjs       the driver: status | apply | unapply | verify | record
  series.json         the manifest: revision, ordered patches, pre/post digests
  summaries.json      per-patch human description (input to `record`)
  patches/
    0100-defer-errdefer-grammar.patch        hand-written  (+124 / −1)
    0200-break-label-value-grammar.patch     hand-written  (+53 / −3)
    0300-if-conditional-declaration-grammar.patch
                                             hand-written  (+80 / −8)
    0400-loop-else-completion-grammar.patch  hand-written  (+81 / −11)
    0500-value-position-if-switch-grammar.patch
                                             hand-written  (+359 / −6)
    0600-labeled-expression-values-grammar.patch
                                             hand-written  (+245 / −15)
    0700-switch-expression-flow-analysis.patch
                                             hand-written  (+155 / −53)
    0750-value-clause-statements-and-braceless-if-grammar.patch
                                             hand-written  (+235 / −19)
    0800-regenerate-ast.patch                generated     (+822 / −269)
    0900-smithers-grammar-tests.patch        fork-owned    (+2,730)
  forkpatch.test.mjs  tests for this mechanism
```

`0100`-`0600` are grammar: they add node kinds and members, so `0800` is their
regenerated output. **`0700` and `0750` add no AST member and no node kind** and
touch no generated file, which is why `0800` is byte-identical across both.

Patch order is apply order and is lexical, so a new form is a new number: the
hand-written patches run first, then the single regenerated patch, then the
fork-owned tests. The hand-written patches never touch a generated file, which
is what lets `0800` be re-derived wholesale rather than amended per feature.
`0750` uses a ten-step insert rather than the hundred-step convention because
`0800` and `0900` are reserved for the generated and fork-owned patches and
renumbering them would churn every digest in `series.json` for nothing.

```bash
node scripts/prepare-typescript-fork.mjs --cache /tmp/fork --full-tsc
node compiler/forkpatch/forkpatch.mjs apply   --checkout /tmp/fork/<revision>
node compiler/forkpatch/forkpatch.mjs status  --checkout /tmp/fork/<revision>
node compiler/forkpatch/forkpatch.mjs unapply --checkout /tmp/fork/<revision>
```

`status`, `apply`, and `unapply` are **offline and need only `git`** — no Node
modules, no Go toolchain, no formatter. That is deliberate: applying the series
must never depend on being able to run a code generator.

## The four properties this had to have

### 1. Our changes live in this repository as reviewable source

Every byte is a text diff under `patches/`. `series.json` labels each patch
`handwritten`, `generated`, or `forkowned`, so a reviewer knows that the 1,332
hand-written lines are the change, and that the generated patch (+822 / −269,
of which +195 / −189 is `Kind` enum renumbering in the stringer) is a derived
artifact they can re-derive rather than read.

### 2. Applying is deterministic and verifiable

`series.json` records a SHA-256 for every file the series touches, twice: the
`preImage` it must have at the pinned revision, and the `postImage` it must have
after the whole series. `apply` refuses to start unless every pre-image matches
and refuses to succeed unless every post-image matches, so the applied tree is
**bit-identical on every machine**, not merely "the patches applied".

That was checked across three independently materialized checkouts of the pinned
revision: all 35 files byte-identical.

The generated patch is not trusted by fiat. `verify --regenerate` re-runs
`tools/scripts/tsc/generate.ts` and the `Kind` stringer inside an applied
checkout and requires the tree to be **unchanged**. Given Node ≥ 22.6 and
`dprint@0.55.1` (the version `.dprint.jsonc` pins) that regeneration is
byte-exact — confirmed by regenerating a *pristine* checkout and getting an empty
`git status`. So `patches/0800-regenerate-ast.patch` has the same trust status as
the hand-written patches: a reviewer does not have to read it, they have to run
one command.

### 3. A mismatched or dirty upstream tree fails closed

Five independent gates, in order:

1. `series.json.revision` must equal `typescript-fork.json.revision`. Bumping the
   pinned fork makes every `forkpatch` command fail until the series is
   re-recorded.
2. The checkout's `HEAD` must be that revision.
3. Every file the series touches must be **materialized**. A sparse checkout that
   omits `tools/` or `packages/` is rejected by name, rather than producing a
   confusing `git apply` error.
4. The checkout is classified `pristine` / `applied` / `mixed` purely by digest.
   `mixed` — a partially applied series, a hand edit, a drifted upstream — is
   always a hard failure that names the divergent files. Nothing is ever patched
   over.
5. `git apply --check` runs before every real `git apply`, so a rejected patch
   never leaves a half-applied tree. `git apply` matches context exactly; there
   is no fuzz and no `--3way` fallback.

### 4. Reverting is trivial

`unapply` reverse-applies in reverse order, deletes the files the series created,
and then asserts the checkout is byte-identical to the pinned revision again
(`git status --untracked-files=all` empty). Dropping the whole idea is deleting
this directory. Dropping the *last* feature is deleting its two patches and
re-recording.

## Alternatives considered and rejected

**Whole-file overlays of the modified files** — the existing `go build -overlay`
and checkout-population style, extended to upstream files. Rejected: it cannot
touch `ast.json` at all (not Go), it cannot add a package directory (proved in
`poc/C3-REPORT.md`), it would put ~500 KB of upstream-derived code in this repo
(`ast_generated.go` alone is 10,053 lines), a reviewer could not see what
changed, and — worst — on an upstream bump it would **silently discard**
upstream's changes to those files instead of conflicting. A patch conflicts
loudly; a whole-file copy wins silently.

**A fork branch on `smithersai/TypeScript` populated from here.** Rejected: it
moves the source of truth out of this repository, so review happens somewhere
other than where the justifying tests live; it needs network and push rights to
be verifiable; and it contradicts the capsule contract, where
`vendor/typescript/typescript.bundle` pins exactly one revision and every gate
asserts `HEAD == revision`. Revert becomes a remote operation. The one thing it
buys — real `git merge` on an upstream bump — is recoverable from a patch series
with `git apply --3way`, deliberately left as a manual, opt-in step rather than
something the automated path can reach.

**Regenerating the capsule with our commits inside it.** Rejected: it destroys
the ability to distinguish upstream from ours, which is the whole point of
`vendor/typescript` carrying `LICENSE.typescript` and `typescript-fork.json`
carrying `upstreamBaseline`; it makes a 34 MB binary bundle the review artifact;
and it changes what `npm run smithersc:verify-reproducible` proves, from "our build
is deterministic given pinned upstream" to "our build is deterministic given
a tree we also produced".

**Regenerating the generated files at apply time instead of carrying them.**
Rejected as the *only* path: regeneration needs Node ≥ 22.6, `execa`, and
`dprint@0.55.1`. Without real `dprint` the TypeScript-side output churns ~5,500
lines of pure formatting (measured: regenerating the pristine tree with a
`gofmt` substitute rewrites `packages/typescript/src/ast/ast.generated.ts` by
2,285 lines), so apply-time regeneration would not be deterministic across
machines. Carrying the bytes *and* offering `verify --regenerate` gets both
properties at once.

## Authoring a new grammar form

1. Prepare a pristine checkout (`--full-tsc`, so the fork's own tests are present).
2. Edit `tools/scripts/tsc/ast.json` and the hand-written Go.
3. Regenerate:
   ```bash
   node --experimental-strip-types --no-warnings ./tools/scripts/tsc/generate.ts
   (cd tsc/internal/ast && go tool golang.org/x/tools/cmd/stringer -type=Kind -output=kind_stringer_generated.go .)
   dprint fmt tsc/internal/ast/kind_stringer_generated.go
   ```
   `generate.ts` needs only `execa` and `dprint` on the path — not a full
   `npm ci`. Installing those two packages in a directory *above* the checkout
   keeps the checkout clean while Node still resolves `execa`.
   `kind_stringer_generated.go` is a **separate** `go:generate` directive and is
   not produced by `generate.ts`; skipping it fails loudly with ~200 compile
   errors, never silently.
4. Split the work into one hand-written patch per feature plus one regenerated
   patch, by replaying onto a pristine tree and taking `git diff` between
   consecutive states. Name them so lexical order is apply order.
5. Describe them in `summaries.json`, then:
   ```bash
   node compiler/forkpatch/forkpatch.mjs record --checkout <pristine checkout>
   ```
   `record` applies the series to a genuinely pristine checkout and writes
   `series.json` from the digests it observes, so recording *is* the end-to-end
   proof that the series applies and produces one determinate tree.
6. Run the mechanism tests and the fork's own tests:
   ```bash
   SMITHERS_FORKPATCH_TEST_CHECKOUT=<checkout> node --test compiler/forkpatch/forkpatch.test.mjs
   (cd <checkout>/tsc && go test ./...)
   ```

### Traps every new node kind — or new *member* — must be swept through

Seven of the entries below (`IsInExpressionContext`, `getContextualType`,
`IsIdentifierReference`, `isStatementCondition`, the member-enumerating `bind*`
function, `ForEachReturnStatement`, and "two functions deciding one fact") are
ones a **member** hits even when no node kind is added at all, which is how they
survived six grammar patches undetected. Four of the seven switch on the
**parent's** kind, which is the shape to look for first: a new member is invisible
to every switch that enumerates the node's own kind.

Measured, not assumed — each one below has a mutation test in
`tsc/internal/{printer,checker}/smithers_grammar_test.go` that fails when the arm
is removed.

- **`ast.IsStatement` is not a range check.** It delegates to
  `isStatementKindButNotDeclarationKind`, an explicit 18-arm switch. Inserting a
  kind inside `KindFirstStatement..KindLastStatement` buys only two call sites
  (`binder.go`, `IsPotentiallyExecutableNode`); the switch arm is still required.
- **`checkSourceElementWorker` has no `default` arm and does not panic.** A node
  kind without a checker case is *silently not type-checked* — the whole subtree
  produces zero diagnostics.
- **Lazy type resolution masks a missing checker arm.** This is the sharpest
  trap in the list, because it makes the obvious test pass. An undefined
  identifier inside a new construct is still reported when the construct's
  binding is *referenced*, because resolving the symbol's type checks the
  initializer anyway. A missing arm only shows up in diagnostics that nothing
  else asks for: an **unreferenced** binding, assignability of an initializer
  against its own annotation, or a grammar error such as TS1155. Write the proof
  with those, not with a referenced name.
- **The 21 generic accessors in `ast.go` panic on unknown kinds.** A node needs an
  arm in each accessor whose name matches one of its members. Parity against a
  same-shaped node is not sufficient on its own: if the reference node panics
  too, the two agree and the test passes. Assert the positive invariant as well —
  the accessor returns the member, by pointer identity.
- **The binder does not bind children of specially-cased statements.** Adding an
  expression to a node with a `bind*Statement` case means binding it explicitly,
  *before* any flow manipulation, or narrowing inside it is computed against the
  wrong flow node and real type errors disappear.
- **`ast.IsBlockScope` and `binder.GetContainerFlags` must agree.** They are two
  independent enumerated switches deciding the same thing: whether a node owns a
  locals table. `GetContainerFlags` decides whether the table is created,
  `IsBlockScope` decides where `GetEnclosingBlockScopeContainer` stops. Getting
  only one of them is silent — the binding leaks into the enclosing scope and
  stays visible after the construct.
- **A locals container also needs the unused-identifier plumbing.** Two more
  arms: `registerForUnusedIdentifiersCheck` in the node's check function, and the
  node's kind in `checkUnusedIdentifiers`. Without both, `noUnusedLocals` never
  looks at the new scope.
- **A new *expression* kind has roughly twice the enumerated-switch surface of a
  new statement kind.** Measured on the pinned revision, over non-generated,
  non-test Go: `KindTryStatement` appears at 15 sites in 11 files, while
  `KindSatisfiesExpression` appears at 32 sites in 17 files and
  `KindConditionalExpression` at 21 sites in 10 files. Budget for
  `isLeftHandSideExpressionKind`, `GetOperatorPrecedence`, the printer's
  `emitExpression` dispatch, `checkExpressionWorker`, and the parser's
  `isStartOfLeftHandSideExpression` — the last of which is what every
  *list-shaped* expression position (call arguments, array elements, object
  property values) gates on before parsing anything.
- **`ast.IsExpressionNode` is a THIRD enumerated expression-kind switch.**
  `isExpressionKind` delegates to `isUnaryExpressionKind` which delegates to
  `isLeftHandSideExpressionKind`, so one arm covers all three. `IsExpressionNode`
  does not delegate to any of them — it restates the list — and it is what
  everything asking "what is the type of the node under the cursor" goes through:
  `getTypeOfNode`, `getSymbolAtLocation`, `isInExpressionContext`, and the
  type/symbol baseline writer. A new expression kind missing from it still
  parses, binds, type-checks and reports every diagnostic it should while
  answering with no type at all. Nothing in a diagnostic-shaped test can see
  that: assert `IsExpressionNode` and `GetTypeAtLocation` on the node directly.
- **Three productions parse an expression and then claim the following `:`.**
  A labeled statement, a `case` clause label, and the `whenTrue` of a
  conditional. Any new expression form that can begin `Identifier :` is
  ambiguous with all three, and getting it wrong breaks ordinary TypeScript
  rather than the new form — `case a: { … }` and `c ? a : { … }` stop parsing.
  Suppress by the *position* the expression starts at, not by a context flag:
  a flag would also disable the form for every nested expression, and the
  position is what makes `f(verdict: { … })` legal at statement level. Upstream
  already keys `notParenthesizedArrow` the same way.
- **Reusing a node kind across two constructs drags its consumers along.**
  `CaseOrDefaultClause` is shared by the statement `switch` and the value
  `switch`; `bindCaseBlock` reaches its parent and calls `AsSwitchStatement()`
  and `Expression()` on it. Reuse is cheap in the node table and expensive at
  every site that assumed the old parent.
- **`ast.IsInExpressionContext` is a FOURTH enumerated switch, and it switches
  on the PARENT.** `IsExpressionNode` answers for an `Identifier` or a literal by
  delegating to it, and it asks "is this node the member that parent evaluates?"
  So a new *member* that holds an expression needs an arm there even when no new
  node kind is involved. A missing arm is silent in the same way `IsExpressionNode`
  is — `getTypeOfNode` answers `any` — and it can be worse: the upstream arm for
  `KindCaseClause, KindDefaultClause` reads `parent.Expression()`, which has no
  `KindDefaultClause` case, so asking for the type of an identifier used as a
  value clause's `default:` value **panicked**. That arm was safe upstream only
  because a default clause's other children are statements and a statement never
  reaches `IsInExpressionContext`. Write the arm against the specific member
  (`clause.Value == node`), never as `return true`: the label of a
  `LabeledStatement` and of a `break :label value` are identifiers with those
  same parents and are *not* expressions.
- **A `bind*` function that enumerates members silently drops a new one.**
  `bindChildren` dispatches `bindCaseOrDefaultClause` instead of `bindEachChild`,
  and that function named `Expression` and `Statements`. A clause `Value` it did
  not name was **never bound at all**, so every identifier in it carried a nil
  flow node — not merely unnarrowed by the switch, but unnarrowed by anything,
  including an `if` wrapped around the whole construct. Prove it with narrowing
  established entirely *outside* the construct, so the construct itself
  contributes nothing and only the binding is under test.
- **`ast.ForEachReturnStatement` is an allowlist of statement kinds and never
  enters an expression.** That is complete for ordinary TypeScript, where a
  `return` is only legal in a statement position. An expression-position labeled
  value hangs statements off an expression, so a `return` inside one sits under a
  `VariableStatement` the allowlist does not even enter — and the symptom is a
  wrong *inferred return type* and a wrong `.d.ts`, not a diagnostic. Any new
  form that puts statements under an expression has to revisit every
  statement-allowlist walk, and has to add the function-boundary stop the
  allowlist got for free by never entering an expression.
- **Two functions deciding one fact will disagree.** Exhaustiveness is decided
  once, by `isExhaustiveSwitch`, for both switch kinds: `checkSwitchExpression`
  reads it to decide whether the expression's type carries `undefined`, and
  `isReachableFlowNodeWorker` reads it to decide whether the binder's bypass edge
  for the same node can be taken. A value-switch-only copy would handle only a
  literal-union scrutinee, so a `typeof` switch covering every witness would
  carry `undefined` in its type while its own flow graph called the bypass
  unreachable.
- **`checker.getContextualType` is a FIFTH enumerated switch, and it also keys
  on the PARENT.** It has an arm for `KindConditionalExpression` and had none for
  the value `if`, the value `switch`, or a clause's `Value`, so every branch and
  every clause value was checked with **no contextual type at all**. Measured
  symptom on correct programs: `const f: (n: number) => number = if (c) { (n) =>
  n } else { … }` reports TS7006 on both parameters, and a discriminated-union
  object literal widens instead of matching. Write the arm against the specific
  member: the condition of a value `if` and a `case` label are not contextually
  typed, exactly as for a conditional expression.
- **`transformers.IsIdentifierReference` is a SIXTH, keys on the PARENT, and its
  failure is WRONG EMITTED JAVASCRIPT.** It is what `CommonJSModuleTransformer.
  visitIdentifier` and the enum/namespace transformer gate identifier
  *substitution* on. `KindCaseClause` sat in the "only an `Expression()` child"
  group — so it answered for the case label and never for a clause value — and
  `KindDefaultClause`, `KindDeferStatement`, `KindErrdeferStatement`,
  `KindBreakStatement`, `KindLabeledStatement`, `KindIfExpression` and
  `KindSwitchExpression` were in no group at all. Measured before the fix, with
  `import { alpha } from "./dep"`: `exports.viaIf = if (flag) { alpha } else {
  beta }` — every name unqualified, against `dep_1.flag ? dep_1.alpha :
  dep_1.beta` for the identical conditional one line below. Exit code 0, zero
  diagnostics, `ReferenceError` at run time. Name the member here too: a
  jump-target label is an identifier with the same parent and must not be
  rewritten.
- **`binder.isStatementCondition` is a SEVENTH, keys on the PARENT, and it costs
  NARROWING.** `isTopLevelLogicalExpression` reads it to decide whether a `&&` /
  `||` / optional chain creates its own post-expression flow label *instead of*
  binding against the enclosing true/false targets. `KindConditionalExpression`
  is in it; `KindIfExpression` was not, so `bindIfExpressionFlow` set the targets
  and `bindBinaryExpressionFlow` threw them away one call later. `if (a !== null
  && b !== null) { a.length + b }` in value position reported TS18047 twice on a
  correct program while the identical conditional expression was clean.
- **A construct that puts statements under an expression needs the locals
  plumbing even when the container already existed.** A value `switch`'s clauses
  hang off `KindCaseBlock`, which `ast.IsBlockScope` and `binder.GetContainerFlags`
  already agree owns a locals table — but `checkSwitchExpression` never called
  `registerForUnusedIdentifiersCheck`, so `noUnusedLocals` never looked inside a
  value `switch` at all. The table existing is not the same fact as the table
  being checked.
- **Marker bumps are avoidable.** Insert a kind *before* the element carrying
  `LastKeyword` / `LastStatement` rather than after it. The `Kind` markers in
  `kind_generated.go` are symbolic aliases rather than positional, so an
  expression kind can be inserted mid-enum with no marker edit at all — only the
  stringer renumbers.

## Not yet wired into a build

`forkpatch` is a standalone, tested tool. It is deliberately not called from
`scripts/build-smithersc.mjs` or `compiler/fork.go`, both of which are owned by other
live lanes. The two integration points, for whoever takes them:

- `compiler/fork.go` builds against a prepared checkout; an `apply` before the
  build and an `unapply` after it is the whole change.
- `scripts/build-smithersc.mjs` materializes its own checkout with a much narrower
  `buildSparsePatterns` (seven directories under `tsc/`). Applying the series
  there additionally requires `tools/` and `packages/` in that list, exactly as
  `scripts/prepare-typescript-fork.mjs` now has them — plus every `tsc/internal/`
  directory the series touches, which as of `0750` includes `ast`, `binder`,
  `checker`, `ls`, `parser`, `printer`, `scanner`, `api/encoder`,
  `transformers`, `transformers/estransforms` and
  `transformers/moduletransforms`. `scripts/prepare-typescript-fork.mjs` needs no
  change: its `compilerSparsePatterns` already includes `/tsc/internal/`
  wholesale, and `compiler/fork.go`'s `//go:embed forkpatch/patches/*.patch` is a
  glob, so a new patch number is picked up with no edit and the "series.json patch
  count does not match the embedded patch set" gate stays satisfied because both
  sides move together.
