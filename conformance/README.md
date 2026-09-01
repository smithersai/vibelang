# Smithers differential conformance harness

Smithers's semantics currently live in a TypeScript analysis instrument
(`poc/src/language`). They are moving into the Go TypeScript fork. This
directory is the equivalence oracle for that move: a corpus of small authored
`.sm` programs, each with a declared expectation, plus a runner that executes
the corpus against **both** implementations and diffs them.

The corpus is the contract. An expectation here is a statement about what the
language promises, not a snapshot of what either implementation happens to do.

```sh
node conformance/runner/run.mjs --backend js      # the reference; a real gate
node conformance/runner/run.mjs --backend go      # the migration target
node conformance/runner/run.mjs --backend both    # run both and diff them
node --test test/conformance.test.mjs             # gate JS, measure Go
node --test conformance/runner/selftest.mjs       # assert the HARNESS, not the language
```

`selftest.mjs` is also run by `scripts/node-test-gate.mjs`, so `npm test` covers
it. That is new as of 2026-08-26: it had been listed here as a manual command
and run by no gate at all, which meant its assertions — the ones written for
exactly the defects a differential corpus cannot see — were green and idle on
every release. It is listed in that gate's `EXTERNAL_TEST_FILES` rather than
discovered, and the gate refuses to start if the file is not where the list says
it is, so it cannot quietly drop out again.

## Layout

```
conformance/
  COVERAGE.md                              locked obligations vs. the corpus
  corpus/<NN>-<area>/<case>.sm             one authored program
  corpus/<NN>-<area>/<case>.expected.json  its declared expectation
  corpus/<NN>-<area>/<case>.mod.sm         an auxiliary module a case imports
  support/*.ts                             foreign TypeScript modules cases import
  assets/*                                 non-code files cases import (json/md/mdx/txt/…)
  interop/*.ts + *.expected.json           plain TypeScript that must not regress
  runner/                                  discovery, both backends, judging, CLI
  runner/selftest.mjs                      assertions about the harness itself
```

`<case>.sm` is pristine authored Smithers — no harness preamble, no directives.
Line 1 of the file is line 1 of the program. That is deliberate: a negative case
names the exact authored line and column of its diagnostic, and those numbers
must not move when someone edits the expectation. It also means any corpus file
can be handed straight to the CLI (`bun poc/src/language/cli.ts <case>.sm out.ts`).

## Expectation format

`<case>.expected.json` is a JSON object:

| field | meaning |
| --- | --- |
| `title` | one sentence stating the promise the case pins. Required. |
| `expect` | `"output"` or `"diagnostics"`. Required. |
| `stdout` | for `expect: "output"`, the exact lines the program must print, in order. |
| `diagnostics` | for `expect: "diagnostics"`, `[{ code, line, column }]` in **authored** 1-based coordinates, optionally with `file` and `messageContains` — see below. A code is a Smithers rule (`SMITHERS1205`), a compiler-owned comptime rule (`VCT1004`), or, for syntax Smithers shares with TypeScript and whose behavior it keeps, the stock TypeScript diagnostic itself (`TS2678`). `file` is the staged module the diagnostic fires in and defaults to the case's entry. |
| `modules` | extra `*.mod.sm` modules in the same directory that the case imports. |
| `typescript` | foreign modules from `conformance/support/` that the case imports. |
| `assets` | non-code files from `conformance/assets/` that the case imports — see "Staging a non-code asset" below. |
| `xfail` | `{ backends, reason, doc }` — see below. |
| `notes` | free text: rationale, doc citation, or a caveat a reviewer should read. **Required** when the case declares a `TS` code, because that is a claim about TypeScript's own behavior and is only as good as the evidence recorded behind it. |

Matching is exact in both directions:

- An **output** case must compile with zero error diagnostics, **survive a stock
  TypeScript check of the emitted module set**, exit 0, and print exactly
  `stdout`.
- A **diagnostics** case must be rejected with exactly the declared set of error
  diagnostics — same codes, same authored positions, no more and no fewer. A
  cascade that the language really does produce is declared in full rather than
  filtered out, because "which diagnostics fire" is part of the contract.

### A diagnostic in a `*.mod.sm` names its file

A declared diagnostic may carry an optional **`file`**: the staged path of the
module it fires in. Omitted, it means the case's entry — which is where every
declared diagnostic in the corpus lands today. The judge compares code, file,
line and column, and so does the cross-backend comparison, so a rule that fires
in the *wrong* module at coordinates that happen to match cannot satisfy a case,
and two backends diagnosing different files cannot print as agreeing.

**This paragraph asserted the opposite until 2026-08-28**, and the correction is
the interesting part. It said a declared diagnostic has no `file` field, that
both backends record one and `--json` prints it, and that the judge compares
code, line and column only — all four true, and the last one a fail-open the
document described as a design. Executed: a diagnostic carrying
`file: "wrong-module.sm"` scored `{"status":"pass"}` with an empty audit against
a real multi-module expectation, and the differential comparator reported
`{"agree":true}` between `main.sm` and `wrong-module.sm`. The paragraph's
consequence — *"if two diagnostics could collide on the same code and the same
line and column in two different files, the expectation cannot tell them apart —
move one, or split the case"* — was a workaround asking case authors to arrange
around a defect in the harness. There is nothing to arrange around now.

The example this paragraph gave was wrong too, in a way worth recording:
`05-context-rows/requirement-propagates-across-modules` was cited as a case
"whose companion module carries its own declared positions", and it is an
`expect: "output"` case that declares **no diagnostics at all**. It had replaced
`21-native-pin/a-pin-reaching-a-host-module-through-a-re-export-is-rejected`,
deleted with the portability withdrawal on 2026-08-23, and nothing checked that
the replacement demonstrated the thing being described. Re-derived on 2026-08-28:
of the 518 cases (510 when this was written; re-derived 2026-09-01), 24 declare `modules` and 10 of those are `diagnostics` cases —
and in all 10 every declared diagnostic lands in the **entry**, so the corpus has
**no instance of this pattern**. `file` is the mechanism that makes writing the
first one possible; until one exists, this section documents a capability rather
than a practice.

Two things to know before writing one. Give each `*.mod.sm` a name distinctive
enough to read in a route (they share one flat directory with every other case in
the area). And a declared `file` must name a file the case actually stages —
`corpus.mjs` refuses one that does not, because a file no backend can ever report
is an expectation that would read as a permanent divergence in both
implementations rather than as the typo it is.

> **If you write the first one, `scripts/oracle-differential.mjs` needs the same
> field.** Its `diagnosticKey` already prints a non-entry file, but `corpusAnswer`
> renders the declared side as `CODE@line:column` with no file, so the two sides
> would disagree for a spelling reason and the case would appear in the product
> divergence baseline as a `both-refuse` row that is really an artifact. Nothing
> is wrong today — zero cases declare a non-entry `file` — but that gate is
> outside this directory and will not notice on its own.

### `messageContains` — when the payload *is* the promise

A declared diagnostic may carry an optional `messageContains`: a **substring**
the diagnostic's message must contain. It is checked only where a case declares
it, so every case written before it behaves exactly as it did.

Message *wording* is not the contract — it legitimately differs between the two
backends, and `compareObservations` still diffs codes and positions only. But
some rules carry a payload that is the whole promise. The native pin is the one
this was added for: *"The diagnostic SHOULD show the dependency path that
introduced the requirement"*. **That rule was withdrawn on 2026-08-23 with the
portability targets, and every case that declared `messageContains` was in
`21-native-pin`.** The mechanism stays, because the reasoning that justified it
is not specific to the pin. A pin refused with an **empty** route satisfied a
code-and-position expectation exactly, so the route would be unpinned — and "an
empty result matching an empty expectation" is a fail-open in the harness rather
than in a backend.

The corpus declares **thirty-three** today (2026-08-27, second revision), and the count in this
paragraph had gone stale twice before it was re-derived — so re-derive it by
parsing the expectations rather than grepping, because the word also appears in
`notes` prose:

```sh
python3 -c 'import json,pathlib;print(sum(1 for p in pathlib.Path("conformance/corpus").rglob("*.expected.json") for d in json.loads(p.read_text()).get("diagnostics") or [] if "messageContains" in d))'
```

The distribution, re-derived the same way (`05-context-rows` 16, `06-layers` 3,
`09-foreign-calls` 8, `17-durable` 6):

**Nineteen are in `05-context-rows` and `06-layers`**, and all nineteen name a
capability. **Eight of those sixteen landed on 2026-08-27**, with the round-6 backlog cases, and they are listed here rather than described one by one because they are all the same use: a case that declares MANY diagnostics of one code at many positions is satisfied by code and position alone whatever capability the row actually named, so one fragment on the first diagnostic holds the whole set to the right capability. They are `05-context-rows/every-spelling-of-a-coercion-member-charges-the-same-row` (sixteen `SMITHERS2102`s), `…/a-computed-member-name-is-charged-to-the-scope-that-evaluates-it` (twelve), `…/a-parenthesised-ambient-coercion-callee-charges-the-same-row` (four), `…/a-toString-returning-an-object-falls-through-to-valueOf` (two), `…/an-invocation-with-no-call-expression-still-charges-its-row` (six), `…/a-coercion-row-is-not-subtracted-by-the-wrong-layer`, `06-layers/a-wrapped-layer-missing-a-capability-names-it` and `06-layers/a-laundering-assertion-does-not-change-which-capability-a-layer-provides`. The last three are the ones where the fragment carries the most: each is a single `SMITHERS2101` whose code and position are satisfied by a refusal naming the capability that WAS supplied, which is exactly what a backend computing the provided and required sets the wrong way round would say. All eight were verified enforced by mutating the declared name to the wrong capability and watching both backends print the message diff; two of them (`a-wrapped-layer-missing-a-capability-names-it`, `a-coercion-row-is-not-subtracted-by-the-wrong-layer`) are recorded with that mutation in their own notes.
The oldest is `an-unsatisfied-top-level-requirement-names-exactly-the-capability`,
which declares the capability's own name on its `SMITHERS2102` — the code and
position alone would be satisfied by a refusal naming the *wrong* requirement,
which is precisely the defect removed on 2026-08-24. The newest three are the
accessor-row cases added on 2026-08-25, where the risk is the same shape:
`06-layers/layer-provide-missing-a-capability-an-accessor-introduces` requires
two capabilities and is provided one, so a refusal naming the capability that
*was* supplied would satisfy code and position exactly. All three were verified
enforced by mutating the declared name to the wrong capability, watching both
backends print the message diff, and restoring it.

A seventh is `09-foreign-calls/miscased-trust-markers-do-not-confer-module-trust`,
which declares the marker the author has to write (`@module and @throws {never}`)
on the first of its three `SMITHERS1510`s. Code and position alone would be
satisfied by a refusal for some unrelated reason — a leading comment above the
JSDoc produces exactly that, which is why those support files have none — and
that is a case passing while observing nothing. Also verified by mutating the
fragment red and back.

Two more are
`09-foreign-calls/unwrap-or-cannot-reach-a-panicking-plain-return-type` and
`09-foreign-calls/recover-cannot-reach-a-panicking-plain-return-type`, and they
show the mechanism used on a **stock TypeScript** code rather than a Smithers
one. Each declares a `TS2339` and the fragment
`'unwrapOr' does not exist on type 'string'`. That fragment carries two promises
at once: the recovery member is unreachable, **and** the receiver kept its plain
type instead of being widened into a Result. Code and position alone would be
satisfied by a `TS2339` about some other member on some other type, which is a
different program passing the same expectation. Verified to be enforced rather
than assumed: changing the declared type in the fragment from `'string'` to
`'Result'` turns the case red on both backends with the message diff printed,
and restoring it turns it green. Both backends emit this message
byte-identically, because it is TypeScript's own.

**The newest two, added 2026-08-26, are a deliberate pair and show a use the
list above did not yet carry: a fragment that tells two cases apart from each
other.** `09-foreign-calls/a-never-claim-followed-by-a-declared-channel-is-refused`
and `…/a-declared-channel-followed-by-a-never-claim-is-refused-identically` are
the same two `@throws` claims in opposite source order, and their whole content
is that the verdict is the same either way — so their declared diagnostic sets
are identical, `SMITHERS1502@4:10` and `SMITHERS1101@3:1` in both. Code and
position therefore cannot observe that each case saw *its own* program: one
refusal would satisfy both, and `SMITHERS1502` covers a **second** rule (the
`@throws {never}` marker on an async binding) that fires at exactly this shape of
position. Each declares the two claims in the order its own source writes them —
`({never} and {TypeError})` and `({TypeError} and {never})` — which is the
evidence that the rule read *every* tag on the declaration rather than the first,
the defect the pair exists to pin; a backend that had read only the first would
still produce `SMITHERS1502` at column 10. The fragment names this program's
claims, not the rule, and it differs between the two cases, which is what makes
it legitimate under the worked counter-example below. Verified enforced by
swapping each case's fragment for the other's: both turn red on both backends
with the message diff printed, and both expectation files were restored
byte-identically (sha256 compared before and after).

> [!WARNING]
> **RETIRED 2026-09-01: the six cases this paragraph describes no longer declare
> any diagnostic, so none of the six fragments exists.** Migration step 11 felled
> the branch and loop walls; all six flipped from `expect: "diagnostics"` to
> `expect: "output"` with zero diagnostics and zero `messageContains`, measured
> by parsing their expectations. The paragraph is kept because **the technique it
> teaches is still the right one** and the corpus still holds 34 fragments across
> 34 cases — but do not go looking for these six, and note what their flip cost:
> `SMITHERS4111` is now spelled by both implementations and declared by no case
> at all. See `COVERAGE.md` §20 and the eighth re-derivation.

**The newest six, added later on 2026-08-26, were the largest single group and
showed the same use at a position where THREE expressions start at once.** They were
the `SMITHERS4111` cases in `17-durable` — `a-logical-or-fallback-on-a-durable-input-is-rejected`,
`a-nullish-coalescing-fallback…`, `strict-equality-against…`, `an-in-test-on…`,
`typeof-on…` and `logical-negation-of…`. Each program passes one operator
expression into an Action argument, and at the declared authored column the
identifier, the projection over it, and the operator expression over *that* all
begin. Code and position alone are therefore satisfied by a backend that refused
the **identifier** and never looked at the operator — a different program passing
the same expectation. The fragment is the SyntaxKind this program actually wrote
(`BinaryExpression`, `TypeOfExpression`, `PrefixUnaryExpression`), which is a
property of the source and not a name for the rule, and it differs across the
six. The smallest fragment carrying it is the **bare kind name**, because the two
backends word the sentence differently: the reference prints
`unsupported durable expression BinaryExpression` and the fork prints
`unsupported durable expression KindBinaryExpression`, so `BinaryExpression` is a
substring of both — measured on both backends rather than assumed. Verified
enforced by mutating each fragment to a different, plausible SyntaxKind
(`Identifier`, `StringLiteral`, and the two unary cases swapped for
`BinaryExpression`): all six turn red on both backends with the message diff
printed, and all six expectation files were restored byte-identically (sha256
compared before and after).

Declare the smallest fragment that carries the promise (`"Label"`, not the
sentence around it, and not a row rendering — the JS reference prints `Label`
where the Go fork prints `{Label}`).

**A worked example of when NOT to declare one**, because it is the shape that
tempts you and the count above is two lower than it would otherwise be. The two compiler-owned
prelude cases added on 2026-08-25 —
`01-result-lifting/the-compiler-owned-prelude-is-not-reachable-by-a-path` and
`…/a-star-re-export-of-the-compiler-owned-prelude-is-refused` — each declare one
`SMITHERS1510`, the same code the seventh case above declares *with* a fragment.
They declare none, and the reason was measured rather than assumed:

```
js  foreign module initialization can panic before a checked call boundary;
    './__smithers_prelude.ts' could not be resolved to a module carrying a leading
    JSDoc containing both @module and @throws {never}; …
go  statically loaded TypeScript/JavaScript module does not declare a leading
    @module and @throws {never} initialization trust claim
```

The fragment that would carry *those* cases' promise is the **specifier** — they
are about the path, not the marker — and only one backend prints it. The one
fragment the two messages share is `@module and @throws {never}`, which would
pass on both and is exactly the forbidden use: it **names the rule**. It is the
right fragment for `09/miscased-trust-markers…`, whose subject *is* the marker's
spelling, and the wrong one there. A fragment that would go green on both
backends is not sufficient reason to declare it; ask what a wrong-but-plausible
refusal would say, and declare the fragment only if it would differ.

### Acceptance is the frontend's own acceptance, in ordered stages

The `smithers` CLI composes compiler-owned comptime lowering before Smithers
lowering, then accepts a program only when the Smithers diagnostics and a stock
TypeScript check of the **emitted** TypeScript (`checkEmittedProject`) pass. The
JS backend runs those stages in that order. A comptime refusal is reported
directly at its authored position, and source maps from successful comptime and
Smithers lowering are composed before emitted-TypeScript diagnostics are mapped
back to authored coordinates. A lowering that produces TypeScript the stock
checker rejects has not compiled the program.

The comptime pass is whole-project when an authored module edge references
`smithers:comptime` or `smithers:schema`. A project with neither edge takes the
identity path into Smithers lowering. This preserves the pass's required inert
behavior when unused and prevents its deliberately bounded parser from claiming
syntax that belongs to a later Smithers stage.

This matters more than it sounds. Until C17 the JS backend called `compileProject`
and stopped, so no corpus case ever type-checked its own emitted output, and one
case was green purely because that check was missing (see
`11-expression-if-switch/statement-switch-keeps-typescript-fallthrough`). A
harness that omits a check reports the omission as a pass.

Emit-check diagnostics are mapped back through the compiler's own source map, so
a case declares them in the same authored 1-based coordinates as every other
diagnostic. An unmapped position is reported at its generated position with
`mapped: false` rather than anchored somewhere plausible-looking.

Frontend errors short-circuit the emit check, exactly as the CLI does: a
`diagnostics` case declaring `VCT` or `SMITHERS` codes never reaches the emitted
TypeScript stage, and a case declaring a `TS` code can only be satisfied there.

### Comptime diagnostic codes

`VCTnnnn` is a first-class corpus code because it is the reference comptime
frontend's public diagnostic family. The Go port predates that corpus support
and deliberately exposes the equivalent `VCT10xx` rules as `SMITHERS19xx`, with
the final two digits preserved: for example, `VCT1004` and `SMITHERS1904` are
the same unsupported-evaluation rule, while `VCT1012` and `SMITHERS1912` are the
same budget rule. The judge canonicalizes exactly `SMITHERS19xx` to `VCT10xx`
for expectation matching and backend agreement. It does not normalize any
other diagnostic family, and the machine-readable report retains the raw code
each backend emitted.

### How an output case is observed

An output case exports `main`, returning `string[]` or `Result<string[], E>`
(optionally as a `Promise`). The runner writes one small harness module beside
the emitted program:

```js
import * as program from "./<case>.js";
import { <identityAccessor> as __smithersIdentityOf } from "<the backend's own module>";
// string[]            -> printed one line each
// Result success      -> the success value is normalized and printed
// Result failure      -> one line, "error <identity>: <message>"
```

The two backends represent a Result differently at runtime — the JS instrument
returns the POC runtime's `ResultValue` (a `match` method, state held privately),
while the Go fork's internal lowering returns its prelude's `SmithersOk`/`SmithersErr`
(a public `ok` tag) — so the harness duck-types both into the same printed lines.
Normalizing the *representation* is what makes one declared expectation
legitimately comparable across two implementations. Nothing in the harness
normalizes the *semantics* under test.

**The failure line names the compiler-stable identity, not the constructor.**
Until 2026-08-25 it printed `error.constructor.name`, and
`specification/failures.mdx` §Error Prototype names exactly that as the wrong
key: "Handler selection MUST use compiler-stable nominal identity, not a
forgeable user `_tag` or minifier-sensitive constructor name in compiled
artifacts." The cost was not cosmetic. §Error Classes puts four obligations on
the compiler — stable nominal identity, matching metadata, serialization
evidence, and cross-realm transport metadata — the Go fork implemented exactly
one of them, and **no corpus case could see that in either direction**, because
`constructor.name` reads `Missing` on a backend that mints an identity and
`Missing` on a backend that mints none. Identity is a representation difference
of the same kind as the Result shape, so it is normalized the same way: each
backend hands `harnessText` its own accessor — `errorIdentity` from the POC
runtime for `js`, `smithersErrorIdentity` from the emitted
`__smithers_prelude.js` for `go` — read from the same module instance the
program registered into. The *value* is not normalized; it is the thing under
test, and the two backends have to mint it identically to satisfy one `stdout`
line (`04-nominal-errors/a-nominal-error-identity-names-its-declaring-module`).
The accessor is a required argument, and `runner/selftest.mjs` holds that
invariant, because a backend that quietly stopped supplying one would fall back
to the constructor name for every case at once. An Error the compiler never
registered has no identity and does fall back — that fallback cannot be mistaken
for an identity, because every identity contains a `:` and no constructor name
does.

What this does **not** reach is encode, decode, and an actual realm crossing.
`.sm` has no sanctioned path to the transport surface on either backend, and the
two backends' transport surfaces are different modules at different paths, so no
single `typescript:` support module can reach both. See `COVERAGE.md` §5.11.

Cases avoid ambient host globals (`.sm` refuses them, `SMITHERS1601`) and therefore
avoid `console.log`. Where a case genuinely needs foreign values — the
foreign-call area — it imports `conformance/support/foreign.ts`, whose leading
JSDoc carries the module-initialization trust claim `SMITHERS1510` requires.

### Staging a non-code asset

An asset import is a compiler-tracked file read, so a case that pins one has to
ship a real file at the path its `.sm` imports. `assets` does that, alongside
the `typescript` field it is modelled on:

```json
"assets": ["config.json", { "from": "reviewer.md", "path": "prompts/reviewer.md" }]
```

The source file lives in `conformance/assets/`; a bare string stages it under
its own name, and the object form stages it at another path so two cases can
share one file, or use one under the name their import expects. The staged path
is a relative POSIX path with no `.` or `..` segments, and it may not end in
`.sm`.

Both backends stage the same set from the same list, which is the whole point:
the JS backend writes each asset into its `mkdtemp` project root **before**
lowering — the source-asset compiler reads it from disk itself, tracks its bytes
in the cache identity, and reconciles its file identity against project code,
none of which an in-memory stub exercises — and the Go backend sends it in the
same `CompileRequest` as every other file.

Two limits are worth knowing before writing a case:

- **The Go wire protocol has two kinds, not three.** `FileKindAsset` exists in
  `compiler/api.go`, but the bridge's own switch accepts only `"smithers"` and
  `"typescript"` and errors on anything else — and an errored request is a
  *rejected* one, which is scored `unmeasured`, not measured. So an asset
  crosses the wire as `"typescript"` (the bridge's name for "not `.sm`"), at the
  same path and with the same bytes, and is deliberately left out of
  `rootNames`. The fork has no source-asset stage, so it will not resolve the
  import — that is the honest outcome, and it is why the file is sent at all
  rather than staged on one backend only.
- **Nothing can be staged outside the project root.** The bridge's
  `virtualFileName` refuses any input path that escapes its virtual project, so
  a file above the root would exist for the reference and not for the fork. A
  case about an escaping *specifier* is still writable (`23-asset-imports/an-asset-path-outside-the-project-root-is-rejected`);
  a case about a file that exists outside the root is not.

A satisfied verdict on a case that ships assets is audited: the JS backend
declares an `assets` stage and `auditVerdict` reports a `HARNESS INTEGRITY`
failure if the verdict was reached without it. A green asset case that never
opened the file would otherwise be green because a check was skipped.

### `xfail`

```json
"xfail": {
  "backends": ["js"],
  "reason": "what the implementation actually does, and why that is wrong",
  "doc": "the documentation sentence the case is written from"
}
```

An `xfail` case states what the **specification** says and records that a
backend does not do it yet. The expectation is never rewritten to match a bug.
If an `xfail` case starts passing, the runner reports `XPASS` so the marker is
retired deliberately rather than silently.

The `xfail`s currently in the corpus are listed at the bottom of this file.

## Backends

**`js` — the reference.** `poc/src/build`'s `compileComptimeIntrinsics` followed
by `poc/src/language`'s `compileProject`, run under bun (the instrument is
TypeScript). Each case gets a fresh comptime cache inside its unique `mkdtemp`
staging tree, which is deleted after the observation, so cases and runs cannot
share compiler state. Emitted TypeScript is written beside the case's foreign
modules and executed by bun. This backend is a real regression gate today.

**`go` — the migration target.** One protocol-v3 `CompileRequest` with
`lowering: "internal"` against `cmd/smithersc-go` and the pinned
smithersai/TypeScript checkout; emitted JavaScript is executed by node. Wiring
(bridge build, request shape, artifact decoding) reuses `scripts/fork-e2e.mjs`.

`lowering: "internal"` is the deliberate choice. The `"external"` mode that
`scripts/fork-e2e.mjs` drives has the JS instrument do the lowering and the fork
only check and emit it — that measures the JS instrument again, and could never
show whether the Go implementation has the semantics.

### Neither backend is the shipped product

Read the two entries above again and notice what is missing from both: `smithers`.
The corpus is routinely quoted as "the language contract", and a green scoreboard
is routinely read as a statement about the compiler people run. It is not one.

The JS reference reaches the frontend through `conformance/runner/js-lower.mjs`,
a driver that exists only here. That driver turns the source-asset stage on **only
when a case ships assets** (`backend-js.mjs`: "A non-empty list is also what turns
the source-asset stage on"), skips the comptime frontend entirely for a case with
no `smithers:comptime` / `smithers:schema` edge, and implements **its own durable
pipeline** (`js-lower.mjs:62-127`, `:286-337`) — it locates the `durable(...)` call
site by hand, runs `compileDurableFlow`, splices in the Flow descriptor — a
static Plan when the legacy lowerer can still hold the body, an Effect Manifest
when it cannot — and erases the `smithers:flows` import, all before
`compileProject` sees anything.

`bin/smithers.js` does none of that in that order. `src/cli.ts:753-777` runs a
source-asset preflight and a runtime-graph resolver over **every** `.sm` before the
semantic stage, runs comptime unconditionally, and has no durable stage in `check`
or `run` at all — the durable frontend is reached only from
`smithers plan --bindings` (`src/cli.ts:1940+`), which lowers one file and neither
checks nor runs the program. That command still reports a PLAN, so a Flow whose
body left the Plan's static subset has nothing for it to print; retargeting it at
the Manifest is step 12 of `MIGRATION-PLAN.md`.

So a green "N cases, 0 divergent" line is a statement about `compileProject` plus
`js-lower.mjs`. Measured against the CLI, some of those cases disagree, and every
one of them is recorded, with which side is wrong, in
`conformance/product-divergence.json`.

**Do not quote the numbers from this paragraph — re-derive them.** Every figure
here has been wrong at least once, and this section previously carried two
mutually contradictory counts in consecutive paragraphs. Three commands settle
it, and they are the only authority:

```sh
git ls-files 'conformance/corpus/*.expected.json' | wc -l   # the corpus size
node scripts/oracle-differential.mjs --jobs 6                # the divergence set
node -e "const d=require('./conformance/product-divergence.json');const b={};for(const r of d.divergences)b[r.direction]=(b[r.direction]||0)+1;console.log(d.total,d.divergent,b)"
```

Re-derived 2026-08-28: **507** tracked cases and **59** disagreements at 01:35,
and the measured set equalled `product-divergence.json` exactly; **508** and
**60** fifteen minutes later, after a concurrent lane landed one case in
`17-durable`. Both readings were correct when taken. That is the half-life of a
number in this file, and it is why the commands above are the authority and this
sentence is only an example of one.

Read the count with its buckets, not as one number. The one that would be
alarming — **the product ACCEPTING what the corpus refuses — is 0**, and has
been across every re-derivation: no corpus green certifies a rule the shipped
compiler fails to enforce. The rest split into the product refusing what the
corpus accepts, and both refusing at a different code or position.

One operational note, because it looks like a regression and is not: the gate
measures the corpus **on disk**, not the corpus in git. An untracked
work-in-progress case in `conformance/corpus/` raises the measured total and is
reported as a `NEW divergence` against the record. Check
`git status --porcelain conformance/corpus/` before concluding that the set
moved.

    node scripts/oracle-differential.mjs             # gate: measured set must equal the record
    node scripts/oracle-differential.mjs --jobs 8    # ~1 minute at 6-8 jobs
    node scripts/oracle-differential.mjs --filter 17-durable
    node scripts/oracle-differential.mjs --update    # re-measure, then REVIEW THE DIFF

The gate stages each case byte-for-byte the way `backend-js.mjs` stages it, runs
`node bin/smithers.js check <entry> --format json`, and judges the answer with the
corpus's own relation — diagnostic code plus authored line and column, as a sorted
multiset, exactly as `judge.mjs` compares them. A case whose expectation is
`output` is required only to be **accepted**: `smithers run` executes an emitted
module directly and never calls the `main()` this harness calls, so the gate does
not claim to compare printed output. The harness still owns that half.

It fails in **both** directions. A case that diverges and is not in the record is
a new divergence. A case in the record that no longer diverges is a fixed one
whose row must be deleted, so the file cannot decay into a list of things that
used to be broken. A row whose divergence changed shape is reported as both.
`conformance/runner/selftest.mjs` additionally gates the record's integrity for
free on every run: a row naming a deleted case, a duplicate, or a row that
`--update` regenerated and nobody gave a verdict to is a failure there.

The three directions the record distinguishes, worst first:

| `direction` | meaning | today |
| --- | --- | --- |
| `product-accepts` | the corpus requires a refusal and the CLI **compiled the program**. A green corpus row is certifying a rule the shipped compiler does not enforce. | **0** |
| `product-refuses` | the corpus certifies a program that compiles and runs, and the CLI cannot process it | 10 |
| `both-refuse` | both refuse, with a different code or a different position — the corpus row rests on a diagnostic no user ever sees | 50 |

The "today" column is a snapshot taken 2026-08-28 at 01:50 and it goes stale
within the hour; the third command above regenerates all three rows from the
record in one line. Only the `product-accepts` **0** is a standing claim, and
`selftest.mjs` gates it.

`product-accepts` being empty is the reason this is a recorded divergence rather
than a stop-the-line defect, and `selftest.mjs` asserts it stays empty.

### Verdicts

| status | meaning |
| --- | --- |
| `pass` | the backend's observable behavior is exactly the declared expectation |
| `fail` | the backend completed and contradicted the expectation |
| `unsupported` | the backend could not process the case at all |
| `xfail` | marked `xfail` for this backend, and indeed did not match |
| `xpass` | marked `xfail` for this backend but matched anyway — retire the marker |
| `unmeasured` | **no observation was obtained**: the backend crashed, refused the request, or could not be run. Not a result at all. |

`unsupported` is reserved for "not implemented yet": the bridge rejected the
request, or it reported stock TypeScript codes on an authored `.sm` file (which
means it parsed or checked Smithers syntax it has no handling for), or the
emitted program crashed on a runtime hook that was never emitted. Only a `SMITHERS`
code is the fork claiming a language rule of its own.

`fail` on the Go backend is therefore the loud category, and today it is almost
entirely **fail-open**: the fork accepted and ran a program the language
requires it to reject. That is more dangerous than an unimplemented construct,
so it is not filed under `unsupported`. The table marks it `FAIL` and the
summary calls it `divergent`; both words appear in both places, so filtering the
output for either one finds the rows and the tally.

**But a fail-open that carries an `xfail` marker is scored `xfail`, not
`divergent`**, because the marker says the specification and the backend were
already known to disagree. So `0 divergent` does **not** mean "no backend
accepts a program the language forbids" — it means "no *unrecorded* one does",
and the `xfail` count is where the recorded ones live. So `0 divergent` and
`0 xfail` do not mean the same thing here, and reading only the first number
would once have reported a green tree over a fork that compiled and ran a
program discarding two checked failures. Read the two numbers together or the
first one flatters.

**There is now a third number, and it is the one to read first.** Every run
prints `Markers holding a fail-open: N` — the count of marked backends that
accepted, compiled and *ran* a case the corpus requires them to reject, derived
from the observations already in hand and naming each row when it is non-zero.
`0 divergent` plus `Markers holding a fail-open: 0` is the statement people
have been reading `0 divergent` alone as, and only the pair of them says it.

**The count in this paragraph was two revisions stale when it was corrected on
2026-08-25**: it said "eight markers today, two of them fail-opens" while the
register below listed thirteen and recorded that both fail-opens had been
retired. The lesson is the one this file keeps repeating about its own tables, so
the number is no longer restated here — **`## Current `xfail`s` below is the one
place the count lives**, and it is derived by parsing the expectations:

```sh
python3 -c 'import json,pathlib;print(sum(1 for p in pathlib.Path("conformance/corpus").rglob("*.expected.json") if json.loads(p.read_text()).get("xfail")))'
```

The reasoning above stands whatever that number is, and it is the reasoning that
matters: a marker can hold a fail-open, so the two numbers must be read together.

**Whether any marker holds one right now is not restated here either, for exactly
the same reason the count is not**, and the sentence that used to stand in this
spot is the worked example. It read "None of the markers holds one today", it was
true when written, it silently became false on 2026-08-26 when a fail-open marker
landed — and the revision that added that marker corrected the register at the
bottom of this file and left this sentence alone, so for one day the page asserted
both. Then the fail-open was closed and the *correction* went stale in turn.

**So it is no longer written down anywhere. The run derives it and prints it**,
on every invocation, including when it is zero:

```
Markers holding a fail-open: 0 (no marked backend accepts and runs a program the corpus requires it to reject)
```

It costs no extra measurement — the predicate is the case's own `expect:
"diagnostics"` (the language requires this program to be rejected) met with an
observation of `kind: "output"` (the backend ran it) on a backend the case marks
`xfail`, and both halves are already in hand when the verdict is scored. A
non-zero count names each row and its exit code. This is exactly the number that
was wrong twice, and it is now the one thing on this page that cannot be: it is
derived from the same observations the table prints. **Verified non-vacuous
rather than assumed:** run against a reconstructed pre-fix tree where four of
today's markers did hold fail-opens, the same code prints `Markers holding a
fail-open: 4` and names all four.

A marked `expect: "output"` case is deliberately not counted — those are the
accepted-and-wrong class further down, which the language does not require any
backend to reject. That is a real and harder class, and folding it in here would
inflate a number that must stay meaningful.

The **direction column** of `## Current `xfail`s` still carries the finer
judgement — fail-closed, divergent position, documentation gap,
accepted-and-wrong — and that half is prose, so it can still go stale. Update it
in the same edit that changes a marker.

`unmeasured` never merges into any other bucket. A crashed or refusing backend
scored as `unsupported` reads as migration progress that did not happen, and a
crashed reference scored as anything but a failure to measure would hide a
regression. Every `unmeasured` case is printed in full, with its reason, and
sets exit code 2 on any backend in any mode — `--report-only` does not suppress
it, because it is not a verdict.

The headline number for the migration is `pass / total` on the Go backend.

### The harness audits itself

Four things run on every invocation and are reported as `HARNESS INTEGRITY`
failures (exit 3), never as results. (This said "two" until 2026-08-28; (3) and
(4) are new. The count is stated here and re-derived from the list below rather
than left to be inferred, because the parallel list of exit-2 conditions in
`run.mjs` said "three" and named two.)

1. **Every satisfied expectation is audited against the work behind it.** Each
   backend declares the stages a verdict depends on (`requiredStages`), each
   observation records the stages it actually completed, and a `pass` whose
   observation did not run them is a defect in the harness. An `output` case
   scored `pass` without an `execute` stage, or without the JS backend's
   `emit-check` stage, is exactly the shape of the bug this audit exists for.
   The same rule covers assets: a case declaring `assets` cannot be satisfied on
   a backend that declares an `assetStage` unless that stage ran.
2. **The summary is recounted from the rows the table printed.** Every status is
   printed, including the zero ones, and the classes must sum to the number of
   judged rows. A previous summary computed `pass + xpass` over a total and
   simply never mentioned the other buckets.
3. **No satisfied verdict rests on a position the harness could not map.** The
   JS backend maps emit-check diagnostics back through the compiler's own source
   map and, where it cannot, keeps the *generated* position and records
   `mapped: false` rather than anchoring it somewhere plausible-looking. Nothing
   read that field, so an authored line and column that happened to coincide with
   a line and column in emitted TypeScript satisfied the case. This is an
   integrity failure rather than a `fail` for the same reason (1) is: no backend
   disagreed with anything — the harness failed to resolve what it was comparing,
   and calling that a divergence would blame a backend for it. Driven by a
   capability each backend declares (`reportsMapping`), because the fork checks
   the authored `.sm` directly and has nothing to map. Measured on 2026-08-28:
   across all 510 cases the reference emits 470 diagnostics, exactly one of which
   is `mapped: false`, and it sits on an `xfail` row — so nothing satisfied rests
   on one today, which is precisely the state in which this would have gone live
   silently.
4. **No diagnostic is scored against a file the harness could not relate to the
   staged project.** Each backend stages a case in a private temporary directory
   and the harness maps the compiler's reported paths back to the
   project-relative names the corpus stages. When that mapping fails the path
   arrives absolute — and `corpus.mjs` refuses an absolute declared `file`, so
   such a diagnostic cannot match any expectation that can be written. It is not
   a divergence; it is a comparison the harness could not set up. Concretely: on
   macOS `os.tmpdir()` yields `/var/folders/...` while the compiler reports the
   realpath `/private/var/folders/...`, the two do not relativize against each
   other, and the runner reported **12 divergent, agreement 479/510** — every one
   in `23-asset-imports`, none of them a disagreement between the two compilers.
   The staging root is realpath'd now (as `scripts/oracle-differential.mjs`
   already did, with a comment naming this same hazard), but that is a property
   of one line, so the property that actually has to hold is checked instead: any
   future spelling that escapes the relation exits 3 with the path in hand rather
   than manufacturing divergences in a backend that is behaving correctly.

`node --test test/conformance.test.mjs` additionally runs deliberately broken
expectations — a corrupted `stdout` line, a diagnostic shifted by one column, and
a program whose emitted TypeScript the stock checker rejects declared as a clean
compile — through the real backend, and requires the runner to score all three
`fail`. Disabling the emit check turns the third one green and that test red.

### Exit codes

| code | meaning |
| --- | --- |
| 0 | the backends asked to gate were green |
| 1 | a verdict failure on a backend asked to gate (suppressed by `--report-only`) |
| 2 | a case could not be measured, a **requested** backend could not be prepared (`--backend both` requests both), or **no case was measured at all** |
| 3 | a harness-integrity failure |
| 64 | a usage error — an unknown option, or a `--backend` that is not `js`/`go`/`both` |

**`--backend both` gates on BOTH backends, the fork included**, in both of the
ways a backend can fail to be green.

1. A Go **verdict failure** exits 1 even when the reference is entirely green —
   measured, not asserted: a case scored `js pass / go FAIL` under
   `--backend both` exits 1, and the same run under `--report-only` exits 0.
2. A Go backend that could not be **prepared** exits 2. `both` asked for the
   fork, so a run in which the fork never compiled a case is not a measurement
   of the fork.

Neither was always true, and the order in which they were fixed is the point.
(1) landed on 2026-08-26: `--backend both` used to reach `return 0` however far
the two backends had drifted, because the `go` arm was reached only by
`--backend go`. (2) landed on 2026-08-28, and until then this sentence promised
more than the runner delivered — the availability arm was still written once per
backend and enforced the reference under `js`/`both` but the fork only under
`go`. So `--backend both` with an absent fork checkout printed
`go: unavailable — <reason>`, `JS reference: 510/510 pass`, `0 divergent`,
`Markers holding a fail-open: 0`, and **exited 0**.

That gap was worse than the one it survived. `both` is the DEFAULT mode, so the
bare `node conformance/runner/run.mjs` that this file and every gate quote
degraded silently into `--backend js` on any machine without a fork checkout,
while still printing a scoreboard that reads like a two-backend run. And the
asymmetry was backwards on its own terms: after (1), *"we looked at the fork and
found a divergence"* exited 1 while *"we never looked at the fork at all"* exited
0. Both arms now iterate one `requestedBackends()` list, so a backend cannot be
enforced in one and forgotten in the other. `conformance/runner/selftest.mjs`
holds the whole matrix — three modes against each backend being unpreparable,
including the four cells that were already right, because the defect was an
inconsistency *between* cells.

**What an exit-0 `--backend both` run now proves about the fork.** That the
pinned, digest-verified, forkpatch-applied fork was built, handshaken and asked
every case in the corpus, and that no case it answered contradicted its declared
expectation. Read the printed `Go fork match: N/510` line for how much of the
corpus it *implements* — `unsupported` is not a failure and does not gate — and
the `Markers holding a fail-open: N` line for what its `xfail`s are holding.
Exit 0 no longer has the "…or the fork never ran" branch it silently had, so it
is now safe to quote as evidence that the fork was measured. Any claim about the
fork dated before 2026-08-28 that rests on this runner's exit code is quoting a
number that could not distinguish a green fork from an absent one; re-measure it
rather than repeating it.

A caller who wants the reference gate on a machine with no fork checkout asks for
it by name — `--backend js` is documented above as exactly that, is unaffected by
any of this, and is what the JS-only gate uses.

## Using this harness as a fork implementer

1. `node conformance/runner/run.mjs --backend go --filter <area>` while you work.
   Anything that moves from `unsup` to `pass` is real progress; anything that
   moves to `FAIL` means the fork now answers a question wrongly rather than not
   at all.
2. `node conformance/runner/run.mjs --backend both --filter <case>` when a case
   is close. The `diff:` column compares the two backends' raw observations,
   independently of the expectation, so you see the exact divergence.
3. `--json` gives the full report, including each backend's raw observation
   (stdout, diagnostics with codes and authored positions) per case.
4. When you add a semantic to the fork, do not add a case for it here to match
   what you built. Add the case from the documentation first, watch it fail, and
   then make it pass.
5. `--only-interop` is the boundary check: plain TypeScript through the fork must
   keep producing identical output as Smithers handling is added. It is cheap;
   run it often.

## Adding a case

1. Write the smallest `.sm` program that pins one promise, from
   `docs/DECISIONS.md`, `docs/src/pages/specification/*`, or
   `poc/src/language/README.md`.
2. Write `<case>.expected.json` from the documentation, before running anything.
3. Run `node conformance/runner/run.mjs --backend js --filter <case>`.
4. If the instrument disagrees, decide which one is wrong. If the documentation
   is right, mark the case `xfail` with the citation. If your case was wrong,
   fix the case — never the promise.

## Current `xfail`s

**Eleven, as of 2026-08-28 (third revision that day)**, re-derived with the
command above rather than by subtracting from the previous figure. All eleven
name `go`; one of them also names `js`. **None of the eleven is a fail-open** —
but read `Markers holding a fail-open: N` on the run rather than this sentence,
per the paragraph below. Every expectation below is written from the
documentation and none was softened.

**The third 2026-08-28 revision retired six and added none**, and it is the
largest retirement this table has recorded in one pass:
`04-nominal-errors/an-ambient-error-declaration-is-not-registered` (js),
`02-unwrap-propagation/postfix-bang-in-a-labeled-statement-body-is-accepted` (js),
`02-unwrap-propagation/postfix-bang-in-a-concise-arrow-body-is-accepted` and
`07-must-consume/a-fallible-callback-in-a-map-argument-needs-a-contract` (one
defect, two rows), `07-must-consume/a-result-parameter-is-consumed-by-an-unwrap-inside-a-callback`,
and `09-foreign-calls/an-untrusted-foreign-result-bound-to-a-name-is-charged-at-the-binding`.
**Every one of the four fixes behind them was a shared seam rather than a site**,
and each was measured to have members no case had registered: the arrow-body fix
covered two of the fork's three hoisting sites and the third was probed and
cleared; the parameter-ownership fix moved that walk onto the same per-file
identifier index the binding rule already used and closed a second shape —
consumption in a sibling parameter's default — nobody had filed; the foreign-lift
fix routed the lift through the must-consume ownership walk and closed two more,
including the missing `SMITHERS1301` on
`09-foreign-calls/a-trusted-union-with-a-promise-constituent-keeps-its-rejection-channel`,
which no one had asked it to touch; and the labeled-statement fix taught
`statementMayFallThrough` one arm and closed three unregistered siblings
(`while (true)`, `for (;;)`, and a nested label). **A marker's stated cause was
wrong in one of the six** — the labeled-statement row blamed the guard's
placement, and the guard was already in the right place — which is the argument
for re-deriving a `reason` against the backend before acting on it.

**The three rows this table carried for the `01-result-lifting` Result-member
reachability gap were also removed**, having been retired in the corpus at the
previous revision without this table being updated:
`result-flatten-collapses-one-level-of-nesting`,
`result-tap-both-observes-whichever-variant-is-active`, and
`a-stringified-result-carries-its-own-type-tag`. The table is now derived from
the corpus row for row; a mismatch between the two is itself the defect.

**Standing at the previous revision (2026-08-26, second that day):** eighteen,
sixteen naming `go`. The one fail-open this table carried since 2026-08-25 —
`09-foreign-calls/a-foreign-index-signature-read-through-a-property-access-needs-an-adapter`
— was closed then, and its marker survives in the **fail-closed** direction
because the fork now refuses the program at the reference's position and only the
row charge is still missing.

**Do not read that sentence as durable — read the run instead.** It has now been
wrong in both directions inside twenty-four hours: the register asserted no
marker held a fail-open while one did, was corrected, and the correction went
stale within the day when the fail-open closed. So the fail-open half of it is no
longer a claim this file makes: `run.mjs` derives it from the observations it
already has and prints `Markers holding a fail-open: N` on every run, naming each
row when N is non-zero. If this paragraph and that line ever disagree, **the line
is right and this paragraph is the stale copy.** The rest of the direction column
is still a hand-maintained judgement; whoever changes a marker's direction
changes it in the same edit.

Read the direction column carefully, because the fourth revision introduced a
direction the table had not carried before. Until then every marker was
fail-closed, a position disagreement, or a documentation gap — all of them
programs at least one backend refuses. Three of that revision's five new markers
were **accepted-and-wrong-at-run-time**: the program compiles clean and then
either selects the wrong handler or dies while it is still loading. That is not a
fail-open by this table's definition, because the language does not require any
of those three programs to be rejected. It is worse to *find*, though, for the
same reason: nothing refuses it, so nothing but a case that runs the program can
report it. All three are `expect: "output"` cases for exactly that reason.

**The fifth revision retired the wrong-handler one of those three** — the only
one a fix could close, since the other two await a sentence rather than an
implementation — and wrote five more `output` cases around it, because the fix
closed a whole class of forgeries and one case can only observe one member of a
class. Two of the eighteen remained in the accepted-and-wrong direction; **as of
the third 2026-08-28 revision one does**, `04-nominal-errors/a-function-local-error-class-cannot-be-declared-twice`,
the other having been the ambient-Error row retired that day.

**The first 2026-08-26 revision added three and retired none.** All three came
out of the foreign-boundary work: two are diagnostic-set divergences on the same
pre-existing union handling and retire together, and the third was the fail-open.
None of the three is caused by that work — each was re-measured on a tree with
none of it applied and reproduced identically there, which is what lets them be
called pre-existing rather than assumed to be.

**The second 2026-08-26 revision added three more, retired none, and moved one
row's direction.** The three additions —
`…/a-foreign-index-signature-read-through-an-element-access-needs-an-adapter`,
`…/a-library-declared-member-of-a-foreign-value-still-needs-an-adapter` and
`…/destructuring-a-foreign-value-runs-its-accessors` — are the same single
omission as the two row-charge rows above them and retire with those; all five
now say so. The row that moved is the fail-open, and the way it moved is worth
the paragraph. The lane that closed it deleted the fork's second gate — the one
that asked where the **member** was declared — so the property rule now asks the
**receiver's** provenance alone, which is what the fork's own comment had claimed
the rule was all along. A correct verdict resting on a stale reason is a shape
this repository has hit before, and it is exactly why the three new rows exist:
the fail-open case alone could not tell a rule that reads the receiver from a
rule that happens to refuse `keyed.width`. The element-access spelling, a member
declared only in `lib.es5.d.ts`, and a binding pattern with no member expression
at all are the three shapes that can. On the pre-fix tree the fork **compiled,
ran and exited 0** on all three; it now refuses all three at the reference's
positions. That is why they arrive as markers rather than as passes: the refusal
they pin is present, and only the `SMITHERS1101` row charge is not.

| case | backend | direction | what the backend does instead |
| --- | --- | --- | --- |
| `04-nominal-errors/a-function-local-error-class-cannot-be-declared-twice` | **js + go** | **accepted, cannot run — a shared latent defect** | both compile clean, run the first call, and die on the second with the identical `TypeError: stable Error identity …:Inner is already registered`. Each invocation mints a new constructor claiming the same module-local identity. A **documentation gap**: either such a class is ordinary TypeScript whose behaviour `.sm` keeps, or it cannot receive a stable identity — `SMITHERS1150`'s own sentence — and the compiler must refuse it, in which case the *case* is retired rather than an implementation fixed. The marker does not pick a side. |
| `09-foreign-calls/a-callback-handed-to-an-untrusted-host-is-still-rejected` | go | fail-closed (missing row charge) | reports the declared `SMITHERS1301` and `SMITHERS1509` but not the `SMITHERS1101`: its `checkForeignBoundaries` reports without charging Panic to the enclosing row, where the reference calls `recordForeignBoundary` beside its report. **Both backends refuse the program**, so this is a diagnostic-set divergence and not a soundness one. Localized rather than guessed: the fork charges the row correctly for the neighbouring `SMITHERS1508`, which `09-foreign-calls/a-foreign-callable-handed-to-a-trusted-binding-is-still-rejected` declares and passes on both. |
| `09-foreign-calls/a-module-trust-claim-is-not-a-call-site-opt-out` | go | fail-closed (missing row charge) | the same omission on the same rule, reached through a module that carries only the initialization claim. The two retire together. |
| `09-foreign-calls/a-bare-panic-type-resolves-without-an-import` | go | **documentation gap** | adds `SMITHERS1104` because it does not resolve a bare `Panic` type. **Neither backend should be changed on the strength of this marker** — no sentence says whether the type `Panic` is ambient. The marker records the question at the place it bites. |
| `09-foreign-calls/a-fallible-getter-in-an-argument-still-needs-a-contract` | go | **documentation gap** | reports only `SMITHERS1303@8:19` where the reference reports `SMITHERS1105@8:19` beside it, because **the fork implements no `SMITHERS1105` and no `SMITHERS1106` at all** — neither code exists anywhere in it. **Both backends refuse the program**, so this is not a fail-open; they disagree only about how loudly. The specification names neither code, so the marker records the asymmetry instead of picking a side. |
| `09-foreign-calls/an-untrusted-union-return-is-an-executable-foreign-value-on-one-backend-only` | go | fail-closed (missing extra) | reports `SMITHERS1301@5:23` alone and omits the `SMITHERS1508@6:10` the reference reports for returning a value whose type has a foreign `Promise` constituent (`string \| Promise<string>`). **Both backends refuse the program.** The binding carries no `@throws` claim of any kind, which is the point of the case: it is the control that localizes the row below to `containsForeignExecutableValue`'s union handling rather than to any trust rule. |
| `09-foreign-calls/a-trusted-union-with-a-promise-constituent-keeps-its-rejection-channel` | go | fail-closed (missing extra) | the same omitted `SMITHERS1508@6:10`, on the same union shape, with a `@throws {never}` marker added. Both backends report `SMITHERS1502` at the same position, so the refusal the case exists to pin is identical and only the cascade differs. The two rows retire together, and the row above is the evidence that the cause is the union handling and not the marker. |
| `09-foreign-calls/a-foreign-index-signature-read-through-a-property-access-needs-an-adapter` | go | fail-closed (missing row charge) — **was FAIL-OPEN until 2026-08-26** | reports `SMITHERS1506@4:17` — the reference's code at the reference's position — and **refuses the program**; it omits the `SMITHERS1101@3:1`, because its property rule reports without charging Panic to the enclosing row. Same omission as the two row-charge rows above and the three below; all six retire together. **What this row used to say, and why the change matters more than the row does:** until 2026-08-26 the fork compiled this program with zero diagnostics, ran it and exited 0 printing `3`. Its property rule reached a member through that member's declarations, an index-signature member has none, and an empty declaration list was treated as nothing to object to — so a foreign accessor could run inside a function whose row read `failures: []`. That gate is gone and the rule now asks the receiver's provenance alone. **The case was renamed on 2026-08-28**, from `a-foreign-index-signature-read-is-refused-on-one-backend-only`, whose whole claim had been false since the fix: the read is refused on both backends and only the row charge is one-sided. Every citation of the old identity was updated in the same change; see its `notes`. |
| `09-foreign-calls/a-foreign-index-signature-read-through-an-element-access-needs-an-adapter` | go | fail-closed (missing row charge) | reports `SMITHERS1506@4:17` and refuses the program; omits the `SMITHERS1101@3:1`. The deliberate pair of the row above — `keyed["width"]` against `keyed.width` — and the pair is the only thing in the corpus that can tell a receiver-keyed rule from one keyed on `ts.PropertyAccessExpression`. On the pre-fix tree the fork compiled this, ran it and exited 0 printing `3`. |
| `09-foreign-calls/a-library-declared-member-of-a-foreign-value-still-needs-an-adapter` | go | fail-closed (missing row charge) | reports `SMITHERS1506@4:17` and refuses the program; omits the `SMITHERS1101@3:1`. `constructor` is declared only in `lib.es5.d.ts`, which is why this row is the one that shows the member's declaring **file** was never the question either: a foreign object may serve `constructor`, `length` or `toString` from a throwing getter. On the pre-fix tree the fork compiled this, ran it and exited 0 printing `false`. |
| `09-foreign-calls/destructuring-a-foreign-value-runs-its-accessors` | go | fail-closed (missing row charge) | reports `SMITHERS1506@4:9` — at the binding **pattern**, agreeing with the reference on the position as well as the code — and refuses the program; omits the `SMITHERS1101@3:1`. A property read with no property-access node to see, which is why it is a separate row from the two above. On the pre-fix tree the fork compiled this, ran it and exited 0 printing `3`. |

**All eleven pin current behaviour rather than a regression**, and each says so
in its own `reason`. The two rows that were a live over-reach in a rule that had
moved — the arrow-body pair — were the first of this revision's retirements; what
is left is the **six** row-charge rows, the two union rows and the three
documentation gaps, every one of them pre-existing and newly *measured* rather
than newly caused. The distinction is load-bearing: "a gap the fork has not
reached yet", "a rule the fork had and lost last night", and "a question the
specification never answered" call for three different repairs.

**The six row-charge rows are one omission, not six**, and they are listed
separately on purpose: each names a different way to reach it — a callback handed
to an untrusted host, a module-level trust claim, an index-signature read spelled
with a dot, the same read spelled with an element access, a member declared only
by the standard library, and a binding pattern. One row would have been enough to
track the omission and not enough to notice if a fix closed only one spelling.
They retire in one edit or the fix was partial.

**Three of the eleven are the documentation, not a backend.** For those the marker
does not pick a side: it names both observations, says which sentence is missing,
and states the condition under which the *case* should be retired instead of an
implementation "fixed". That is the required shape whenever the documentation
does not settle a disagreement — say so inside the marker rather than choosing
quietly.

The `SMITHERS1105` row is the newest of the three and was invisible until the
fourth revision, for a reason worth repeating: those two codes are ones the **reference
implements, the fork does not, and no case probed**. A rule in that state
produces no divergence in either direction, ever, so nothing in the corpus could
report it. It surfaced only because the panic non-widening rule removed
`SMITHERS1101` from the *panicking* half of the accessor/generator class, leaving
the ordinary-`Error` half exposed as the residual. Closing a rule made an
unmeasured one visible; that is the ordinary shape of progress, and the cost of
recording it is one marker.

A marker is the right answer for a backend that contradicts the specification:
write the case from the documentation, record the citation in `xfail.reason` /
`xfail.doc`, and never soften the expectation instead.

There are no `unsupported` rows.
`23-asset-imports/a-type-only-asset-import-is-rejected` was the last one — the
fork reported a stock `TS2857` where the reference reports `SMITHERS5208` — and
it now owns that refusal under its own code. Read that zero precisely:
`unsupported` was never the dangerous bucket, because it means "no rule of my
own here yet", which is loud and honest. The dangerous bucket is a backend
accepting and running a program the language requires it to refuse, and **no
marker holds one as of the second 2026-08-26 revision**: the one that did —
`09-foreign-calls/a-foreign-index-signature-read-through-a-property-access-needs-an-adapter`
— was closed, and its row moved to fail-closed rather than being retired.

**This spot has now been wrong twice in a day, once in each direction, and that
is the durable lesson rather than the current value.** For a day it said no
marker held a fail-open while one did; then it was corrected; then the fail-open
closed and the correction was stale by morning. Both errors have the same cause,
and it is not carelessness: the fact was written down in two places (here and the
direction column) and hand-maintained in both, so an edit that touched one left
the other asserting the opposite. **The fix was to stop writing it down.**
`run.mjs` now derives it and prints `Markers holding a fail-open: N` on every
run, from the same observations the table prints — a marked backend whose
observation is `kind: "output"` on a case whose `expect` is `"diagnostics"` — and
names each row when N is non-zero. Read that line; this paragraph is prose about
it and inherits the staleness the line cannot have.

What does not change with the value: `0 divergent` means "no *unrecorded* backend
accepts a program the language forbids", never "none does". A full run reporting
`0 divergent` and exit 0 is compatible with a compile-clean fail-open sitting
inside it under a marker, because a marker is where a recorded one lives — the
first 2026-08-26 revision was the worked example, and the fact that the example
lasted less than a day does not make it hypothetical. Read `0 divergent`, the
`xfail` count and the direction column together.

**And now read the direction column for a second thing.** The fourth 2026-08-25
corpus revision added three markers on programs that *are* accepted and run and
are nevertheless wrong: two die at load or on the second call, and one silently
selected the wrong handler. **That last one is retired as of the fifth revision**
— the only one of the three a fix could close — so two remain. None of them is a
fail-open, because the language requires none of them to be rejected — which is
exactly why they are the hardest class to find. A fail-open is discovered by a case that declares a diagnostic; an
accepted-and-wrong program is discovered only by a case that runs it and reads
what it printed. If a later revision reports `0 divergent` and a shrinking
`xfail` count, that is still no statement about this class unless the corpus
grew `output` cases to look for it.

**Retired markers** are not restated here; the retirement is recorded in the
case's own `notes` so the history travels with the case rather than with this
list, which is how an earlier version of this table went four entries stale.

The second 2026-08-26 revision retired **none** and added **three**, all `go`,
all in the row-charge class, all described in the table above — and it moved one
existing row out of the **FAIL-OPEN** direction into fail-closed without retiring
it, which is a movement this list had not recorded before. The three additions
were each demonstrated **failing against a reconstructed pre-fix tree** rather
than merely pinned: the fork compiled, ran and exited 0 on all three there. The
pre-fix tree was verified to be the right tree before it was trusted — it differs
from the working tree in exactly the four files the closing lane touched, carries
none of the symbols that lane introduced, and still contains the deleted
member-declaration gate.

The first 2026-08-26 revision retired **none** and added **three**, all `go`, all
described in the table above and all re-measured on a pre-change tree before
being called pre-existing.

The revision before it retired **one**, `go`:
`04-nominal-errors/a-case-class-that-lies-about-instanceof-must-not-capture-a-sibling`,
where the fork used to compile the program clean, run it, and print `timeout`
where the reference prints `notfound:k` — the wrong-handler member of the
accepted-and-wrong class above. It scored `XPASS` in one
`--backend both --jobs 4` run and was re-measured with `--filter … --json`
(identical `stdout` and `agreement.agree: true` on both backends) before the
marker was deleted; what the fork used to do is in the case's own `notes`.
**Retiring it was the smaller half of the work.** The fix — a nominal brand
merged beside each Error class, then the compiler's own predicate in place of
`instanceof` — closed a whole class of forgeries at once, and one case observes
one member of a class, so five more `output` cases were written from the same
sentence: `matchPartial` with a lying case class, a class that **denies** its own
instances (which used to abort the fork with `non-exhaustive Error match`), a
class whose **base** lies (a static member is inherited), and a lying
`@throws {T}` admitting an unrelated throw into a declared foreign channel — plus
two that pin what the fix *costs*, since the sound predicate narrows by
assignability and can over-subtract a sibling to `never`. A marker retired on a
class-wide fix without those leaves every other spelling free to reopen unseen.

Two revisions ago **all eight** markers its predecessor listed were retired — seven `go`
and one `js`, **including both fail-opens** — in a single measurement. Every one
scored `XPASS` in one `--backend both --jobs 4` run before its marker was
deleted, and each case's `notes` now carries what the backend used to do and what
changed. Two of the eight are worth knowing about here because they were the
dangerous ones: `07-must-consume/an-array-literal-of-results-that-is-never-consumed-is-refused`,
where the fork compiled and ran a program that discarded two checked failures at
run time with nothing reported before or during execution; and
`09-foreign-calls/a-dynamic-import-of-an-untrusted-foreign-module-is-refused`,
where the reference initialized a foreign module with no trust claim through
`import()` while refusing the byte-identical static edge. Neither is a rule
either backend had to invent — both were rules it already claimed to have and
did not reach in one spelling, which is exactly what a case is for.

The revision that pinned the portability analyzer retired the one marker its
predecessor left: `23-asset-imports/a-non-literal-dynamic-asset-import-is-rejected`,
where the fork used to compile a compile-time asset load into a runtime
`import()` and the emitted program exited 1 under node with `ERR_MODULE_NOT_FOUND`
for a file the case stages. The fork now routes literal dynamic asset sites
through the same loader and admission pipeline as a static asset edge and refuses
computed specifiers before emit. It was measured `XPASS` in a `--backend both`
run and then re-measured with `--backend go --json`, which reports the identical
code, position **and message** as the reference.

The revision before that retired **all five** markers this table used to list —
the export-declaration finding. The fork now walks export declarations and
follows a referenced value through imports, named/star/namespace re-exports,
local aliases, bindings, destructuring, default exports, project-module chains
and cycles until it reaches the real runtime edge. Each of the five was measured
`XPASS` in one `--backend both` run before it was deleted, and four of them had
to reproduce a declared `messageContains` **dependency route** to do it, not
merely the right code at the right position.

The revision before that retired **all fourteen** markers *its* table listed —
thirteen `go` and one `js`. Twelve were in `23-asset-imports`: the fork gained a
source-asset stage with real JSON, const-JSON, text, bytes, Markdown and MDX
loaders, owns the missing-`type`, legacy-`assert` and outside-root refusals under
their own codes, and no longer charges a compile-time constant as a runtime
platform dependency — and neither does the reference, which is the `js` half of
the last one. The thirteenth was
`08-promise-chaining/promise-then-on-a-bound-promise-is-rejected`, where the fork
ported the bound/unbound must-consume split.

Earlier retirements: `01-result-lifting/top-level-expect-is-rejected` (the fork
used to accept a top-level `Result.expect(...)` and run it),
`22-source-text-fidelity/diagnostic-columns-survive-non-ascii-source-text` (the
fork used to report diagnostic columns as UTF-8 byte offsets), and four `js`
markers — the two `11-expression-if-switch` arrow-arm cases,
`21-native-pin/a-pin-over-an-async-function-is-accepted` (deleted with the
portability withdrawal), and
`22-source-text-fidelity/a-non-ascii-error-class-name-is-a-nominal-error`. All of
the surviving ones now pass on both backends. Keep every one of those cases: they
are the only rows that would notice any of those defects returning.

## Harness self-tests

```sh
node --test test/conformance.test.mjs          # gate JS, measure Go, and check the runner itself
node --test conformance/runner/selftest.mjs    # assertions about the REQUEST, not about the language
```

The second file exists because of a defect class the corpus is structurally
unable to see. Every case travels through one `CompileRequest`, so **a field
that request always sets the same way is a field no case can vary, and a field
it omits is a code path no case can reach.**

It now holds two subjects, and the second one arrived by the first one's own
logic. Beyond the request shape, it asserts that the judge's comptime code alias
is **scoped to the fork**: the Go port numbers its comptime rules `SMITHERS19xx`
where the reference frontend uses `VCT10xx`, but the reference *also* spells
`SMITHERS1900`/`1901`/`1902` — there the formatter's mask-budget,
overlapping-mask and overlapping-edit rules. While the translation was
unconditional it applied to the reference too, folding two unrelated rules onto
one contract code, and the pre-fix judge was measured returning `pass` for a
case declaring the comptime rule `VCT1001` against a reference emitting the
formatter's `SMITHERS1901`. No corpus case could reach it — the formatter is
only reachable through `smithers format`, never `compileProject` — which is
exactly why it belongs here and not in the corpus. `auditVerdict` now reports a
harness-integrity failure if a reference observation ever carries a
`SMITHERS19xx`, so the collision cannot go live unnoticed.

The worked example is `lowering`. `compiler.LoweringIdentity` used to be the
empty string — the zero value of `LoweringMode` — and `cmd/smithersc-go` built
its positional request with no `Lowering` field, so every positional invocation
selected identity lowering, which runs the stock TypeScript checker and applies
**no Smithers rule at all**. A zero value that is also a legal value is not a
default; it is a fail-open. It is fixed at both ends (`compiler/api.go:54`,
`compiler/lowered.go:19`), and `backend-go.mjs` always sent a mode explicitly —
which is precisely why no corpus case could ever have caught it, before the fix
or after it.

`selftest.mjs` asserts both halves:

- **source-level** — every `CompileRequest` in `backend-go.mjs` reads the one
  named `loweringMode` constant from `corpus.mjs`, and no mode is spelled as a
  string literal. Verified to catch a regression: restoring one
  `lowering: "internal"` literal turns the test red.
- **live** — the real bridge, sent four real requests: an omitted mode is
  refused (`lowering mode is required`), an unknown mode is refused,
  `"internal"` reports `SMITHERS1510` + `SMITHERS1301` on a two-file program,
  and `"identity"` compiles that **same** program clean, exit 0, zero
  diagnostics. That last one is the original defect's consequence measured
  rather than argued, and it needed nobody's fix reverted.

Add to this file when the thing that could regress is how the harness *asks* its
question. Add to `conformance/corpus/` when it is what the language *answers*.

## Coverage matrix

[`COVERAGE.md`](./COVERAGE.md) is the census: every **Locked** entry in
`docs/DECISIONS.md` and every normative sentence in
`docs/src/pages/specification/*`, mapped to the case that pins it or to the
reason no case can. Read it before claiming an area is covered, and update it
when you add a case. It also records the harness's own observation gaps — each
with what the harness would need to close it — the `xfail` register above with
full evidence, the Go `unsupported` rows, and the documentation conflicts.

It carries **two** code-set subtractions, and the second one is the one to read
first. The older section finds rules the reference implements and the fork does
not — five codes today. The newer one finds rules **both** implementations spell
and no case probes — **nineteen** codes today (this sentence said twenty-seven for three
revisions after that figure was superseded by the corrected derivation on the page
itself; re-derived 2026-08-27 with the page's own commands and unchanged at
nineteen) — which is strictly worse,
because a reference-only rule at least produces a divergence the moment someone
writes a case, while a shared unprobed rule produces nothing in either direction,
ever.

**Check the commands before you quote the totals.** For three revisions the fork
half of both subtractions was computed by a grep for literal `SMITHERS[0-9]{4}`
strings under `compiler/`, which counted a code named only in two design
documents that say it is *retired* and could not see the nineteen durable codes
the bridge builds by concatenating a prefix constant with a digit suffix. The
totals it produced looked stable, which is precisely what made them look
trustworthy. Both commands are corrected in the page, and it prints the diff
between the old method and the new one so a reader can check the correction
rather than the result.

It states the date, tree, and command every figure came from, because those
figures move. **Re-derive it rather than patching a line**: a reason recorded
there can go stale as fast as a number can. Recent revisions found three
obligations recorded as permanently `unwritable` whose recorded reason had since
become false, one recorded reference defect that was already fixed, and two
rules recorded as *covered* that appeared nowhere in the corpus at all — that
last error concealed the two unmeasured rules for a full revision.
