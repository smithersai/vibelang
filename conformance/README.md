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
node --test conformance/runner/selftest.mjs       # assert the REQUEST, not the language
```

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
| `diagnostics` | for `expect: "diagnostics"`, `[{ code, line, column }]` in **authored** 1-based coordinates, optionally with `messageContains` — see below. A code is a Smithers rule (`SMITHERS1205`), a compiler-owned comptime rule (`VCT1004`), or, for syntax Smithers shares with TypeScript and whose behavior it keeps, the stock TypeScript diagnostic itself (`TS2678`). |
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

### A diagnostic in a `*.mod.sm` is declared by position alone

A declared diagnostic has no `file` field. Both backends record one on the
observation, and `--json` prints it, but the judge compares code, line, and
column only. A multi-module case therefore declares a companion diagnostic in an
auxiliary module by its authored line and column *in that module* — see
`05-context-rows/requirement-propagates-across-modules`, whose companion module
carries its own declared positions. (The example this paragraph used to give was
`21-native-pin/a-pin-reaching-a-host-module-through-a-re-export-is-rejected`,
deleted with the portability withdrawal on 2026-08-23.)

Two consequences worth knowing before writing one. Give each `*.mod.sm` a name
distinctive enough to read in a route (they share one flat directory with every
other case in the area). And if two diagnostics in a case could collide on the
same code *and* the same line and column in two different files, the expectation
cannot tell them apart — move one, or split the case.

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
`21-native-pin`, so the corpus currently declares none.** The mechanism stays,
because the reasoning that justified it is not specific to the pin. A
pin refused with an **empty** route satisfied a code-and-position expectation
exactly, so the route would be unpinned — and "an empty result matching an empty
expectation" is a fail-open in the harness rather than in a backend.

Declare the smallest fragment that carries the promise (`"-> launder.mod.sm ->
node:fs"`), never the sentence around it.

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
// string[]            -> printed one line each
// Result success      -> the success value is normalized and printed
// Result failure      -> one line, "error <ClassName>: <message>"
```

The two backends represent a Result differently at runtime — the JS instrument
returns the POC runtime's `ResultValue` (a `match` method, state held privately),
while the Go fork's internal lowering returns its prelude's `SmithersOk`/`SmithersErr`
(a public `ok` tag) — so the harness duck-types both into the same printed lines.
Normalizing the *representation* is what makes one declared expectation
legitimately comparable across two implementations. Nothing in the harness
normalizes the *semantics* under test.

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
and the `xfail` count is where the recorded ones live. The corpus carries **no
markers today**, so `0 divergent` and `0 xfail` currently mean the same thing;
that is a property of this moment, not of the scoreboard. Read the two numbers
together or the first one flatters.

`unmeasured` never merges into any other bucket. A crashed or refusing backend
scored as `unsupported` reads as migration progress that did not happen, and a
crashed reference scored as anything but a failure to measure would hide a
regression. Every `unmeasured` case is printed in full, with its reason, and
sets exit code 2 on any backend in any mode — `--report-only` does not suppress
it, because it is not a verdict.

The headline number for the migration is `pass / total` on the Go backend.

### The harness audits itself

Two things run on every invocation and are reported as `HARNESS INTEGRITY`
failures (exit 3), never as results:

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

`node --test test/conformance.test.mjs` additionally runs deliberately broken
expectations — a corrupted `stdout` line, a diagnostic shifted by one column, and
a program whose emitted TypeScript the stock checker rejects declared as a clean
compile — through the real backend, and requires the runner to score all three
`fail`. Disabling the emit check turns the third one green and that test red.

### Exit codes

| code | meaning |
| --- | --- |
| 0 | the backends asked to gate were green |
| 1 | a verdict failure (suppressed by `--report-only`) |
| 2 | a case could not be measured, or a requested backend could not be prepared |
| 3 | a harness-integrity failure |

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

**None.** The four markers this section listed were all `go`, all in
`21-native-pin`, and all in the fail-open direction: the fork granted a native
pin over a program the language required it to refuse. The portability pin, the
`TypeScript` requirement and the portable/required/forbidden classification were
withdrawn from the specification on 2026-08-23 and removed from both backends,
so area 21 is deleted and the four markers were **retired rather than fixed** —
a defect in granting a certification is moot once the certification does not
exist. Their evidence is preserved in the withdrawal record at the top of
[`COVERAGE.md`](./COVERAGE.md) and in the checkpoint branch
`poc/pre-withdrawal-checkpoint`.

A marker is still the right answer for a backend that contradicts the
specification: write the case from the documentation, record the citation in
`xfail.reason` / `xfail.doc`, and never soften the expectation instead.

**All four were only writable because the reference had just been fixed.** Every
one of these classes was a live *reference* fail-open within the last day, closed
in `poc/src/targets/classify.ts` by five consecutive lanes, and pinned by no case
at all. Writing the cases is what turned "the reference used to be wrong here"
into "the fork is wrong here now" — which is the whole argument for writing a
case for a rule both implementations already claim to have.

There are no `unsupported` rows either.
`23-asset-imports/a-type-only-asset-import-is-rejected` was the last one — the
fork reported a stock `TS2857` where the reference reports `SMITHERS5208` — and
it now owns that refusal under its own code. Read that zero precisely:
`unsupported` was never the dangerous bucket, because it means "no rule of my
own here yet", which is loud and honest. The dangerous bucket is the fork
accepting and running a program the language requires it to refuse, and that is
what the four markers above hold.

**Retired markers** are not restated here; the retirement is recorded in the
case's own `notes` so the history travels with the case rather than with this
list, which is how an earlier version of this table went four entries stale.

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
and no case probes — **twenty-seven** codes today — which is strictly worse,
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
