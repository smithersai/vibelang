# Coverage matrix — locked language obligations vs. the conformance corpus

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
>   (**this one has now been removed from the code; see the withdrawal record
>   immediately below**)
>
> Retained and unaffected: the checked `panic` channel on unannotated foreign
> calls, and Zig/Rust imports through generated Wasm bindings. Where this document
> and the specification disagree, the specification wins.
>
> **A second revision landed on 2026-08-27** — one-shot delimited continuations —
> which withdrew `failures.mdx` §Accepted Placements outright and renamed
> §Propagation. Every citation of those headings in this file was repointed; see
> **§Citation record — `failures.mdx` section renames, 2026-08-27**. That record
> also names the two places where the corpus and the product now agree with each
> other and disagree with the specification, which is a shape no gate can see.

## Withdrawal record — the portability targets, 2026-08-23

The fourth bullet above is no longer drift. The machinery was removed the same
day, so every verdict in this page that rests on it is **history, not a live
measurement**. The rest of the page has not been re-derived against the smaller
corpus and its per-row prose still describes the tree as it was; read a
portability row as a record of what was once measured.

**Removed from the corpus:** all 27 cases of `21-native-pin` (plus its 16
`*.mod.sm` auxiliary modules), `18-typescript-requirement/with-statement-is-forbidden`
(the only case for the withdrawn *forbidden* classification bucket), and
`23-asset-imports/an-asset-import-adds-no-runtime-platform-requirement`. Corpus
size **260 → 231 cases across 22 areas**; both backends re-measured at
231/231 pass, **0 divergent**, and — because the four `xfail go` markers were all
in `21-native-pin` — **0 xfail**. Those four were retired rather than fixed: each
recorded a fork fail-open in granting a pin, and there is no pin to grant.

**Kept, with citations moved rather than the cases deleted:**
`18/any-is-usable-and-not-forbidden` and `18/eval-is-usable-and-not-forbidden`
pinned "MUST contribute `TypeScript`"; compatibility.mdx keeps the other half of
that sentence — "`any` and `eval` remain usable … the language does not forbid
them" — which is exactly what their observables already measured.
`18/type-only-import-adds-no-requirement` cited the removed "Runtime TypeScript
Dependency" section and now cites type-system.mdx "Foreign Boundaries", which
still says type-only imports add no runtime requirement.
`18/class-static-block-is-rejected` was never a portability case (SMITHERS1107 is
a function-channel ownership rule) and the whole of `20-host-globals` is the
**capability system**, not portability: SMITHERS1601/1602/1603 come from the
frontend and compatibility.mdx keeps "Host Globals" verbatim. The area directory
is still named `18-typescript-requirement` for its history; nothing in it pins a
`TypeScript` requirement any more.

**Coverage LOST, and it is a real regression, not a tidy-up.** §17.11 — "loading
happens during compilation and adds no runtime platform requirement"
(ASSET_LOADERS.md, Locked) — was observable *only* through the pin, which was the
one channel that reported a transitive requirement graph to a `.sm` program. Its
case is deleted and the obligation is now **uncovered**, with no writable
replacement: the surviving frontend charges nominal Context capabilities only, so
a program cannot observe whether a compile-time asset edge contributed a platform
requirement. It is still asserted at the unit level
(`compiler/fork_asset_test.go`, and the asset specifier's absence from the
runtime artifact in `compiler/fork_reexport_test.go`). The same is true of every
other row below whose observation channel was `SMITHERS3001`.

**Rows superseded by the withdrawal** — read as history: §8.14, §8.21, §10.6,
§10.6b, §10.7, §10.8, §10.9, §10.10 (its `with` half), §10.11, §10.13, §10.14,
§10.15–§10.20, §17.11, §22.3, the `messageContains` census, and the entire
`xfail` register. §10.13's finding stands but is no longer a gap: the LLVM MUST
was withdrawn rather than implemented, so **F1 is closed by the specification**,
not by code.

**The list above was incomplete, and the omission was measured — 2026-08-26.**
Every case a **table row** cites was parsed and resolved against
`conformance/corpus/`. The census is scoped to table rows on purpose: those are
the cells a reader treats as evidence, and prose that has to *name* a deleted
case in order to retire it — this paragraph, the two section banners below —
would otherwise inflate the count it is reporting. To reproduce it, take the
lines of this file beginning with `|`, match `` `NN/name` `` and
`` `NN-area/name` ``, and look each name up on disk.

**637 table-row citations; 85 do not resolve.** 36 name `21-native-pin`, which
does not exist. 47 name `10-defer`, `11-expression-if-switch`,
`12-labeled-block-values` or `13-loop-values`, which are **empty directories** —
0 `.sm` files each, as is `03-optionals`. 2 name a case in a live area, and both
sit in rows this list already supersedes (§10.10 and §17.11).

Most of the 85 are in rows the list above already covers. The rows that still
read as **live coverage** and were not covered are now added to it: **§1.4,
§1.5, §7.3, §8.20, §9.5, §10.1, §10.3, §10.4, §10.5, the whole of §13, the whole
of §14, Q1, Q2, Q4**, and the two SMITHERS code-census rows marked "**WRITTEN
this revision**" for `SMITHERS1713` and `SMITHERS3005` — both of those cases
went with their directories. §13 and §14 carry their own banners as well,
because they are the two sections in which **every** row is superseded and a
reader landing on a single obligation would otherwise never reach this note.

Outside table rows the page cites further names that do not resolve, and every
one of them is already told as history and is **correct**: the withdrawal record
above naming what it removed, the "Documentation conflicts" and revision-history
entries, and the old name of a case this page itself records as *renamed*
(`09-foreign-calls/a-panic-in-an-if-body-still-needs-the-panic-channel` →
`…-keeps-a-plain-return-type`, stated at §"How and when this page was
measured"). Those are left as written: a dated record of a past measurement must
keep the name the measurement used.

## Withdrawal record — the `TypeScript` requirement member, 2026-08-24

The record above removed the portability half. It did **not** reach the
frontend's own requirement rows, which are a different code path in
`poc/src/language/semantic.ts` and kept charging a `TypeScript` requirement at
eight sites. That reached users directly: `smithers compile` printed
`requirements[1]: TypeScript` on ordinary functions, and `smithers run` refused
an ordinary program with `SMITHERS2102 top-level call has unsatisfied
requirements TypeScript`. No gate caught it, and the corpus could not: no case
made a top-level call into a function that imported a foreign module, which is
the one shape where the member is observable. The two backends had **silently
disagreed** about it since the portability removal — the Go bridge stopped
computing it then, the JS reference did not.

**Only the member was withdrawn.** The requirement-row mechanism, nominal
`Context` rows, `Layer` provision and subtraction, `Clock`/`Random`/`Host`
charging for ambient host globals, transitive propagation, durable contract
derivation, and `SMITHERS2102` itself are the capability system and are
untouched.

**Added to the corpus**, all three passing on both backends with 0 divergent:

- `18-typescript-requirement/a-trusted-foreign-import-adds-no-requirement` — the
  acceptance direction, observed through a top-level call, which is legal only
  when the callee's row is empty. Measured divergent before the fix
  (`SMITHERS2102@15:1`, `SMITHERS2102@16:1` on the JS reference; the Go fork
  already passed).
- `18-typescript-requirement/a-provided-capability-row-closes-completely-around-a-foreign-import`
  — the reduced reproduction: one capability provided by a layer plus a trusted
  foreign import, with a top-level call. Also measured divergent before the fix
  (`SMITHERS2102@29:17` on the JS reference).
- `05-context-rows/an-unsatisfied-top-level-requirement-names-exactly-the-capability`
  — the refusal direction, with `messageContains` on the capability's own name.
  The removal direction is trivially satisfiable by a frontend that stopped
  charging requirements altogether, so the refusal is pinned in the same lane.

`18/any-is-usable-and-not-forbidden` and `18/eval-is-usable-and-not-forbidden`
kept their observables; only their in-source comments, which still described the
withdrawn charge, were corrected. **§10.1 and §10.5 below are now history in
both directions**: their obligations were withdrawn on 2026-08-23 and the
implementation caught up on 2026-08-24.

This is the audit that lets someone judge whether "feature complete" is true. It
walks `docs/DECISIONS.md`'s **Locked** entries and every normative sentence in
`docs/src/pages/specification/*`, and records, for each obligation, whether the
corpus pins it.

The corpus is a contract, not a census. This page is the census: it names the
obligations that have **no case**, so the gap is visible instead of implied.

Status vocabulary:

| status | meaning |
| --- | --- |
| **covered** | at least one case pins the obligation and is green on the JS reference (a `pass`, or an `xfail` whose marker is the finding) |
| **partial** | some of the obligation is pinned; the named remainder is not |
| **uncovered** | an implementation surface exists and no case reaches it. The reason says *why*, and it is a work item, not an excuse |
| **xfail** | a case written from the doc that a backend contradicts, kept with its citation |
| **unwritable** | no case can be written honestly today, for the recorded reason |

`partial` is used only where a named piece is pinned and a named piece is not.
Where nothing is pinned, the row says **uncovered** and names the cause — a row
that reads "partial" when the corpus reaches none of it is the softening this
page exists to prevent.

**"Unwritable" is not an excuse bucket.** Each such entry names the specific
thing that is missing — a spelling the specification leaves **open**, an
implementation surface that exists in neither backend, or an observation channel
the harness cannot reach. **That reason is the work item, and the recorded
reason is the least reliable text on this page.** Three entries the revision
before last had written off turned out to have wrong or expired reasons
(§7.15, §10.6, dynamic import in native code); this revision closed §17 by
doing the work its reason named, and found two more reasons that were wrong:
§11.10's ("no implementation surface" — a too-narrow grep) and §11.11's ("both
backends stage flat" — the real blocker is module resolution). **Re-test an
`unwritable` reason before quoting it.** Every reason below now says whether it
was re-measured or carried over.

Case ids are relative to `conformance/corpus/`. **Bold** ids were added by the
revision that produced this file.

## Citation record — `failures.mdx` section renames, 2026-08-27

The 2026-08-27 specification revision (one-shot delimited continuations) renamed
and deleted headings this page cites by name. The linker cannot see a prose
citation, so they were regrepped by hand and repointed. **No case was edited, no
expectation was changed, and no row's verdict moved.** Only citations moved.

**Deleted — `failures.mdx` §Accepted Placements.** The whole placement rule (five
conditions, seven enclosing forms, the repeated-loop-header condition, the
statement-walk rationale, the worked rejections) was withdrawn and replaced by
§Refusal Conditions, which makes placement **unrestricted** and leaves three
refusals: no enclosing Result channel, non-Result operand provenance, and an
enclosing `catch`. The withdrawn text is quoted verbatim in that page's
§Amendment Record, so the citations point somewhere real.

- **§4.12, §4.13, §4.14, §4.15, §4.16** cited the withdrawn rule and now say so.
  Their obligation is no longer live. The rows are **kept** because the cases are
  still green and still measure something true: they pin **current compiler
  behavior**, which now disagrees with the specification.
- **§4.17** ("a rejected placement MUST be a diagnostic, never a silent
  lowering") **survives verbatim** and is repointed to §Refusal Conditions.
- **§4.18, §4.19** are repointed to §Refusal Conditions. Their *verdicts*
  survive and are strengthened — under unrestricted placement a concise arrow
  body and a labeled statement body are accepted a fortiori — while the walk that
  produced those verdicts is withdrawn with the rest of the rule.
- The prose citations in the `xfail` register (`02/postfix-bang-in-a-labeled-statement-body-is-accepted`,
  `02/postfix-bang-in-a-concise-arrow-body-is-accepted`,
  `08/postfix-bang-on-an-unawaited-promise-result-is-not-a-result-operand`) and
  the "nineteen pin current behaviour" paragraph carry the same note.

**Renamed — `failures.mdx` §Propagation → §Failure Propagation.** Eleven
citations updated (§3.9, §3.10, §4.1, §4.2, §4.2a, §4.3, §4.4, §4.8, §4.10,
§6.3, §12.5b). Nothing about those obligations changed.

**The gap this leaves is real and is recorded rather than papered over.**
Measured 2026-08-27 against the conformance JS reference backend over `poc/src`:
of the six placements §Refusal Conditions lists as accepted, **two compile**
(`r!.length`, `r! ?? "fallback"` — each with its own certifying case here) and
**four are refused** with `SMITHERS1204`, the withdrawn statement-walk rule still
being enforced. Five cases in `02-unwrap-propagation` certify those refusals
(`postfix-bang-before-a-member-call-is-rejected`,
`postfix-bang-before-an-element-access-is-rejected`,
`postfix-bang-as-a-nullish-right-operand-is-rejected`,
`postfix-bang-in-a-call-argument-is-rejected`,
`unwrap-in-a-compound-expression-is-rejected`).

`conformance/product-divergence.json` has no row for this and correctly so: that
file measures corpus against product, and here the corpus and the product agree
with each other and disagree with the specification. The gap is therefore
invisible to every gate, which is why it is written down here.

**Those five cases MUST stay green and MUST NOT be weakened to fit the
specification.** They are the evidence for the gap. They are retired — not
reinterpreted — when the frontend emits the delegated suspension that makes `!`
an expression in every position. The specification page carries the same gap
under the marker **`(SA-1)`**, defined in `docs/src/pages/specification/index.mdx`
§Specification–Implementation Gaps, and it is open question 6 in
`docs/DECISIONS.md`.

A second gap of the same shape, **`(SA-2)`**, exists in `17-durable` and is
recorded on `docs/src/pages/specification/durable-execution.mdx` rather than
here: the durable frontend is still the static-plan model, so `SMITHERS4106`,
`SMITHERS4107` and `SMITHERS4100` refuse what that page now promises. Same
structure — corpus and product agree, specification disagrees, no
`product-divergence.json` row.

## What this page audits, and what it does not

Read this before any verdict below.

Sections §1–§20 measure **one thing**: the differential `.sm` conformance corpus
in `conformance/corpus/`, **507** cases across 23 numbered areas — of which 17
directories hold cases, five are empty directories left by the 2026-08-23
withdrawal (§13 and §14 record why), and `21-native-pin/` was deleted outright
(the figure in this sentence read 260 for several revisions after it stopped
being true, 422 for two revisions after that, 465 until the round-7 backlog
revision, 493 until the closure-backlog revision, 498 until the
capability-argument revision, and 503 until the durable-projection revision;
re-derive it with
`find conformance/corpus -name '*.expected.json' | wc -l`).
That is a narrow instrument. It observes a `.sm` program's stdout and its
**error**-severity diagnostics, and nothing else. **What it is not** is the
boundary of what is tested: runtime behaviour, packaging, build-cache identity,
and store transactions are outside its reach entirely, and observation gap #18
names three whole lanes' findings that live in unit and integration suites for
that reason.

§21.7 is the one verdict on this page that is **not** a corpus case and says so
in its own row: a defect in how the harness constructs its request cannot be
observed by any program the harness compiles, so it is asserted in
`conformance/runner/selftest.mjs` instead. Read that as the template for the
category, not as an exception to the scope above.

For several revisions this page treated that instrument's reach as the boundary
of the system, and the result was a census with holes in it that no reader could
see. This revision adds the surfaces the corpus does not reach and the matrix
had never named — the CLI, formatter, and language server (§21); the
`smithers:schema` virtual module (§22); the bounded portable Wasm backend
(10.14); the host-sensitive global classification table (§9.6–9.13) — and gives
comptime and durable execution real status tables (§19, §20) instead of an
unscored list. It also corrects a statement that was simply false: the previous
revision said no Wasm backend exists. One does, and it is 4,180 lines.

Three consequences a reviewer should carry into everything below:

1. **Not covered here does not mean untested.** The CLI, formatter, LSP, layer
   runtime, concurrency library, durable runtime, and Wasm backend all have real
   unit tests. Where that is the case, the row says so and names the test file.
   The gap is *audit* completeness, and mixing the two would be its own
   dishonesty.
2. **Zero divergences is a bounded claim.** A divergence is only visible where a
   case exists. See "Reference-only rejection rules" below, which is the single
   most important section on this page.
3. **The harness cannot observe warnings at all** (observation gap #11). Two
   sentinels that keep Open classifications from becoming silent fail-opens are
   therefore unmeasurable by construction.

---

## How and when this page was measured

Numbers move; this is what was measured and when.

**2026-08-27, ninth revision — the durable-projection revision.** Four cases
added, **503 → 507**, all in `17-durable`. **No new `support/` module, no new
asset, no new `.mod.sm`**; **no new `xfail` marker and none retired** (18 before
and after, 16 `go` / 3 `js`, and **none of the four needed one**); cases
declaring a `messageContains` 38 → **41**; distinct declared diagnostic codes
80 → **81**, and the `SMITHERS`-only figure the subtraction below uses **73 →
74**. **No implementation code was written or changed by this lane** — it owns
`conformance/corpus/**`, `conformance/support/**` and this page. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  504/507 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 490/507 match the reference, 0 xpass, 16 xfail, 1 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 489/507 identical observations
Markers holding a fail-open: 0
exit 0
```

Baseline for the same command before the revision: 503 cases, JS 500/503 with 3
`xfail`, Go 486/503 with 16 `xfail`, 1 unsupported, agreement 485/503, exit 0.
**All four new cases agree on both backends**, so backend agreement rose by
exactly four and the disagreeing set is unchanged at eighteen rows.

**These four are the corpus's first reach into `SMITHERS4110`, and that matters
for the subtraction below rather than only for §20.** Three lanes on 2026-08-26
and 2026-08-27 closed a chain of durable-boundary fail-opens — the reference's
Flow-output projection walk, then the fork's, then the Action **input** on both —
and **none of them wrote a corpus case, by design**, because until the last of
the three landed the program either could not be reached from a `.sm` file at all
or needed an `xfail(go)` that would have put the first marker into the
"markers holding a fail-open" register. All three are now closed on both
backends at the same code, line, column and sentence, so the cases land unmarked.
The set is
`17/an-action-input-projection-the-descriptor-does-not-have-is-rejected`
(`SMITHERS4110@11:29`, "…`#Step input cannot project length from durable
array`"), its paired positive control
`17/an-action-input-projection-the-descriptor-can-answer-is-accepted`
(`expect: "output"`, runs to `["static-plan-artifact"]` on both),
`17/a-sleep-duration-projection-the-descriptor-does-not-have-is-rejected`
(`SMITHERS4110@10:29`, "`sleep duration cannot project length from durable
array`") and
`17/an-action-input-projection-through-a-durable-string-is-rejected`
(`SMITHERS4110@10:29`, "…`from durable string`").

**The `sleep` case is worth more than its size and the reason is mechanical.**
The repair works by having every failure site drop a hard-coded `"Flow output "`
prefix and letting the collecting walk prepend the subject of the value it is
visiting. A case whose defect sits in an Action input cannot tell a subject that
is *chosen* from one hard-coded to `"Action <id> input"`, and a case whose defect
sits in the Flow output cannot tell it from one still hard-coded to
`"Flow output"`. The timer-duration case can, because its subject is neither —
which is why all three refusals declare a `messageContains` naming the subject
and the projected field. Code and position alone are satisfied by an
implementation that refuses the right program and calls it the wrong thing.

**The positive control is first-class, not filler.** This is a **narrowing**
rule: it newly refuses programs both implementations used to compile and run.
Eleven over-corrections have shipped in this repository and the two lanes
immediately before this one each removed one, so a refusal-only set would have
pinned half of what the change promised. The control is the refusal case with
the projection swapped and nothing else touched — `input.items[0]` where the
refusal writes `input.items.length`, over `readonly number[]` into
`{ key: number }` so both spellings type as `number` — and mutating the SOURCE
back to `.length` turns it into the refusal on both backends at
`SMITHERS4110@12:29` with the byte-identical sentence. One projection is the
whole difference between accept and refuse, measured on both implementations.

`node scripts/oracle-differential.mjs`: **507 measured, 59 divergent**,
`product ACCEPTS what the corpus refuses` still **0** — the dangerous direction
did not move. The measured set gained **four rows** against
`conformance/product-divergence.json` and **the baseline was deliberately NOT
re-baselined**, because this lane does not own that file. All four rows are the
pre-existing `17-durable` pattern, not a new disagreement: every one of the
twenty durable cases already in that file is recorded with `TS2307` at the
`"smithers:flows"` specifier and verdict `product-wrong`, because
`bin/smithers.js check` does not resolve the compiler-owned virtual module on
that route. The three refusals join the `both-refuse` bucket (corpus
`SMITHERS4110`, product `TS2307` + `TS2339`) and the control joins
`product-refuses` exactly as
`17/a-plain-projection-reaches-the-plan-as-an-input-expression` already does.
`node --test conformance/runner/selftest.mjs`: **31 tests, 0 failed, 0
skipped**. The eighth revision recorded that figure as **26 and "unchanged"; it
does not reproduce.** `conformance/runner/selftest.mjs` is byte-identical to
`HEAD` and statically defines 7 top-level tests and 24 subtests, and no test in
it is generated per corpus case, so 31 is `HEAD`'s number and nothing this lane
wrote moved it. The 26 is recorded here as stale rather than corrected in place,
since which revision it stopped being true in is not determinable from this page.

**Every one of the four was verified load-bearing by mutation** — sixteen
mutations in all, under a mutator that **refuses to run** unless the case is
green on BOTH backends first *and* its search string occurs **exactly once** in
the file. That second guard earned its place again here: the first attempt at the
control's source mutation was refused because `input.items[0]` also appears in
the comment above the code, and the mutation would have edited the comment and
come back green. Every declared field of every case was mutated at least once —
line, column, code and `messageContains` on the three refusals, the stdout line
and the source projection on the control — each went red on **both** backends
with the runner's own diff printed, and each file was restored
**byte-identically by sha256**. The mutations and their outcomes are in the
cases' own `notes`.

**2026-08-27, eighth revision — the capability-argument revision.** Five cases
added, **498 → 503**: three in `06-layers` and two in `09-foreign-calls`. **No
new `support/` module, no new asset, no new `.mod.sm`**; **no new `xfail` marker
and none retired** (18 before and after, 16 `go` / 3 `js`, and none of the five
needed one); `messageContains` 36 → **37**; distinct declared diagnostic codes
**79 before and 79 after**, and the `SMITHERS`-only figure the subtraction below
uses **72 before and 72 after**. **No implementation code was written or changed
by this lane** — it owns `conformance/corpus/**`, `conformance/support/**` and
this page. Measured with `node conformance/runner/run.mjs --backend both
--jobs 4`:

```
JS reference:  500/503 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 486/503 match the reference, 0 xpass, 16 xfail, 1 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 485/503 identical observations
Markers holding a fail-open: 0
exit 0
```

Baseline for the same command before the revision, re-measured rather than
quoted: **498 cases**, JS 495/498 with 3 `xfail`, Go 481/498 with 16 `xfail`, 1
unsupported, agreement 480/498, exit 0. **All five new cases agree on both
backends**, so backend agreement rose by exactly five and the disagreeing set is
unchanged at eighteen rows; the per-case rows diff against the baseline is
exactly the five added lines and the three summary lines, and nothing else.

**These five close a hole the previous revisions could not see, one ARGUMENT
away from a site the corpus already covered.** `SMITHERS2106`'s settled rule —
resolve a capability reference by SYNTAX first and by TYPE second, and refuse
what cannot be pinned to exactly one class declaration — governs the
`X.context()` receiver and was found on 2026-08-27 not to be applied at
`Layer.succeed`'s FIRST argument. The two implementations were wrong there in
**opposite directions**: the fork accepted
`Layer.succeed(Directory as unknown as typeof Clock, clock)` and **panicked at
run time**, while the reference over-refused nothing and instead published a
**phantom row** for `const Alias = Directory`, because `rowNameOfClassReference`
fell back to the identifier's own text. A fail-open on one backend and a wrong
requirement row on the other, and no case in the 498 touched the capability
argument at all except through two type-PRESERVING wrappers already held by
`a-layer-through-a-type-only-wrapper-is-the-same-layer`. The same day a second
lane found `panic` in a **tag** position accepted by **both** backends, the fork
lowering `` Reflect.panic`x` `` into a runtime
`TypeError: Reflect.panic is not a function` — so that half produced no
divergence in either direction, ever. Three of the five are refusals
(`a-laundering-capability-argument-names-the-capability-the-runtime-registers`,
`a-capability-argument-that-pins-no-single-class-is-opaque`,
`the-panic-intrinsic-is-a-call-and-not-a-template-tag`); **two are the
over-correction guards and are `expect: "output"` on purpose**
(`a-type-erased-capability-argument-is-the-same-capability`,
`an-ordinary-tagged-template-is-not-the-panic-intrinsic`). The guards are not
filler: the fix behind them removed **13 reference over-refusals on programs that
run**, this repository has shipped **ten** over-corrections, and a
`SMITHERS1503` keyed on the identifier `panic` closes one of the refusal case's
four spellings while taking `local.panic`b`` with it.

**One shape is deliberately NOT in the corpus and is named here so nobody adds
it by accident.** `let C = Directory; C = Twin; Layer.succeed(C, directory)` is
accepted and panics at run time on **both** backends today. That is
`SMITHERS2106`'s own pre-existing residual — the identical shape at the
`.context()` receiver behaves the same way, untouched — and closing it needs a
new rule that has to move both walks together. It is pinned as an explicit
known-residual **unit** test (`poc/src/language/layer-capability-argument.test.ts`),
because the only thing a corpus case over that shape could do is encode today's
acceptance as the contract. Both `06-layers` cases say so in their own `notes`.
`06-layers/a-mutable-layer-binding-is-opaque` is the reassigned binding at the
LAYER position, where the answer IS settled and IS refusal; the capability
argument does not have that answer yet.

`node scripts/oracle-differential.mjs`: **503 measured, 55 divergent**,
`product ACCEPTS what the corpus refuses` still **0**, and **the measured set
still matches `conformance/product-divergence.json` exactly** — unlike the two
revisions before it, this one moved the set by **zero** rows, so there was
nothing to re-baseline and nothing was. The product agrees with the corpus on all
five. `node --test conformance/runner/selftest.mjs`: 26 tests, 0 failed, 0
skipped, unchanged.

**Every one of the five was verified load-bearing by mutation**, under a mutator
that **refuses to run** unless the case is green on BOTH backends first *and* its
search string occurs exactly once in the file — both refusals exercised against
a real case rather than assumed, plus a third against a case deliberately made
red first. Each mutation went red on **both** backends with the runner's own diff
printed, and each file was restored **byte-identically by sha256**. The five
sentences and the five digests are in the cases' own `notes`.

**2026-08-27, seventh revision — the closure-backlog revision.** Five cases
added, **493 → 498**, all five in `09-foreign-calls`; **nine new `support/`
modules** and no new asset; **no new `xfail` marker and none retired** (18 before
and after, and none of the five needed one); `messageContains` 33 → **36**;
distinct declared diagnostic codes **79 before and 79 after** — the five cases
declare exactly one code, `SMITHERS1510`, which twenty-one other cases already
declare. **No implementation code was written or changed by this lane** — it owns
`conformance/corpus/**`, `conformance/support/**` and this page. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  495/498 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 481/498 match the reference, 0 xpass, 16 xfail, 1 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 480/498 identical observations
Markers holding a fail-open: 0
exit 0
```

Baseline for the same command before the revision, re-measured rather than
quoted: **493 cases**, JS 490/493 with 3 `xfail`, Go 476/493 with 16 `xfail`, 1
unsupported, agreement 475/493, exit 0. **All five new cases agree on both
backends**, so backend agreement rose by exactly five and the disagreeing set is
unchanged at eighteen rows; the per-case rows diff against the baseline is
exactly the five added lines and the three summary lines, and nothing else.

**These five close the hole the previous revision could only describe.** The
sixth revision's entry below ends by recording a case it deliberately did not
write, because both backends still accepted a foreign module reached at depth two
behind a properly marked relay. Two lanes closed that on 2026-08-27 — the
reference's `checkForeignModuleInitializers` and the fork's
`checkForeignModuleTrust` now walk the reached-module closure — and each measured
the pre-fix behaviour with a module-scope oracle rather than with diagnostics:
**every fail-open cell was executing the untrusted module's initializer**, 22 on
the reference and 21 on the fork. Neither lane wrote a case, by design. **Backend
agreement did not move at all when those 58 divergences were closed** (475/493
before and after, rows byte-identical), because no case in the 493 exercised a
depth-≥2 foreign edge at all — on the fix lanes' own 145-cell matrix agreement
went 82/145 → 140/145. That is the exact pattern that let this defect survive
seven rounds, and it is the argument for this revision in one line: **the fixes
were verified and the corpus could still have reported `0 divergent` while the
hole reopened.** Three of the five (`a-trust-marker-does-not-travel-through-a-
trusted-module`, `an-unmarked-module-behind-a-trusted-relay-is-refused`,
`module-trust-does-not-travel-two-hops`) are the refusals, separating "the marker
did not match" from "the closure did not ask" from "depth is not a bound"; two
(`a-marked-chain-confers-trust-at-every-depth`,
`a-deferred-foreign-loader-needs-no-marker-behind-it`) are the over-correction
guards, and they are `expect: "output"` cases on purpose — a diagnostics
assertion cannot tell *trusted* from *silently dropped*.

`node scripts/oracle-differential.mjs`: **498 measured, 55 divergent**,
`product ACCEPTS what the corpus refuses` still **0**. **The measured set moved by
exactly three rows and this lane did not re-baseline the record**, exactly as the
sixth revision did not. The three are the three refusal cases, all `both-refuse`,
all with the product reporting `SMITHERS1510` at the FOREIGN module's first
statement (`miscased-relay-target.ts:2:1`, `unmarked-relay-target.ts:1:1` twice)
where the corpus declares it at the `.sm` import specifier. That is the recorded
`duplicate-SMITHERS1510-implementation-in-the-runtime-graph` cause, which nine
rows already carry: `src/relative-runtime-graph.ts` already walked the closure and
reports before the semantic stage, which is why the shipped CLI was never affected
by this defect and why its position anchors differently. The bucket goes 9 → 12
and `conformance/product-divergence.json` needs those three rows added with
`verdict: "product-wrong"`; until they are, that gate exits 1. **The two
keep-green cases produce no divergence at all** — the product accepts them too.
`node --test conformance/runner/selftest.mjs`: 26 tests, 26 pass, 0 skipped.

Every one of the five was **verified load-bearing by mutation**: twenty
mutations, all of which turned the case **red on both backends** with the
observed-versus-declared diff printed, and every file restored byte-identically
with sha256 compared before and after. Fourteen were expectation mutations — each
refusal case had its code, its line, its column and its `messageContains` changed
in turn, each `output` case its declared stdout line. **Six were support-module
mutations, which is the half that proves the cases observe the RULE and not an
incidental refusal**: giving the miscased depth-2 target the correct marker, giving
the unmarked target a marker (at depth 2 and again at depth 3), miscasing the
keep-green chain's target, redirecting the keep-green relay at the unmarked
module, and mentioning the deferred loader's `load` at module scope so the
deferral proof fails. The mutator refused to run a case unless it was green on
**both** backends first and refused any mutation whose search string did not occur
exactly once in the file. **One further mutation came back GREEN and is reported
rather than hidden**: redirecting the depth-3 chain's middle relay at a module the
case does not stage produces the *same* `SMITHERS1510@1:24`, because an unresolved
relative initialization edge is fail-closed on both backends ("that specifier could
not be resolved to a module carrying …"). That is a non-discriminating mutation,
correctly refused by the exactly-once/green-first guard rather than a defect in the
case; the discriminating mutation for that case is the one that marks the depth-3
target.

**2026-08-27, sixth revision — the round-7 backlog revision.** Twenty-eight cases
added, **465 → 493** — nine in `20-host-globals`, seven in `09-foreign-calls`,
five in `01-result-lifting`, four in `05-context-rows`, three in
`02-unwrap-propagation`; **five new `support/` modules** (the first revision since
2026-08-25 to need any) and no new asset; **no new `xfail` marker and none
retired** (18 before and after); `messageContains` 27 → **33**; distinct declared
diagnostic codes 78 → **79**, the one new code being `SMITHERS1604`, which the
`18-typescript-requirement` case that replaced `eval-is-usable-and-not-forbidden`
brought in before this lane started — **the twenty-eight cases themselves declare
no code the corpus did not already declare** (`SMITHERS1103`, `1104`, `1503`,
`1510`, `1602`, `1604`, `2102`), which is the same shape as the revision below it
and for the same reason. **No implementation code was written or changed by this
lane** — it owns `conformance/corpus/**` and this page. The eleven defects the
cases pin were closed the same day by six other lanes in `poc/src/language/**`,
`compiler/forkbridge/*.go.txt` and `src/relative-runtime-graph.ts`, and every one
of those lanes deliberately wrote no corpus case, because a case must not land
before both implementations agree. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  490/493 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 476/493 match the reference, 0 xpass, 16 xfail, 1 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 475/493 identical observations
Markers holding a fail-open: 0
exit 0
```

Baseline for the same command before the revision, re-measured rather than
quoted: **465 cases**, JS 462/465 with 3 `xfail`, Go 448/465 with 16 `xfail`, 0
unsupported, agreement 447/465, exit 0. **All twenty-eight new cases agree on both
backends**, so backend agreement rose by exactly twenty-eight and the disagreeing
set is unchanged at eighteen rows.

**Why this revision exists, and it is the same sentence as last week's with one
word changed.** Round 7 found eleven defects that a 465-case corpus reporting
`0 divergent` could not see, and the reason is not that the rules were unprobed —
every code involved already had cases. They lived at **spellings** no case named:
twenty of twenty-two ways to reach `eval` or the `Function` constructor failed
open on both backends, three ways to spell the `context` key silently dropped the
capability row and panicked at run time, the trust marker was granted by a `//`
comment and by a NO-BREAK SPACE on all three implementations at once, and an
object literal with a member named `match` — or a bare `throw { a: 1 }` — crashed
the reference frontend outright. Two of those classes were **shared by both
backends**, so the differential oracle was blind by construction; one was
reference-only and the oracle still saw nothing, because no case named the
program. The twenty-eight cases here are spellings, and this page's
"rules both implementations have and no case probes" subtraction is structurally
unable to count them — see that section's 2026-08-27 round-7 re-derivation, where
it did not move for the second revision running and says why.

`node scripts/oracle-differential.mjs`: **493 measured, 52 divergent**,
`product ACCEPTS what the corpus refuses` still **0**. **The measured set moved by
exactly three rows and this lane did not re-baseline the record**, which is the
one figure on this page that changed shape rather than size. The three are
`09/a-line-comment-holding-the-trust-marker-does-not-confer-module-trust`,
`09/a-block-comment-holding-the-trust-marker-does-not-confer-module-trust` and
`09/exotic-whitespace-in-the-trust-marker-does-not-confer-module-trust`, all
`both-refuse`, all with the product reporting `SMITHERS1510` at the FOREIGN
module's first statement where the corpus declares it at the `.sm` import
specifier. That is not a new defect: it is the recorded
`duplicate-SMITHERS1510-implementation-in-the-runtime-graph` cause, which six rows
already carry including the two sibling cases
`09/miscased-trust-markers-do-not-confer-module-trust` and
`09/near-miss-trust-markers-do-not-confer-module-trust`. The bucket goes 6 → 9 and
`conformance/product-divergence.json` needs those three rows added with
`verdict: "product-wrong"`; until they are, that gate exits 1. The other
twenty-five new cases agree with the product exactly, including the trust-marker
POSITIVE, which the shipped CLI also accepts. `node --test
conformance/runner/selftest.mjs`: 26 tests, 26 pass, 0 skipped.

Every one of the twenty-eight was **verified load-bearing by mutation**, not
assumed: forty mutations in all, because the multi-diagnostic cases and every
`messageContains` got their own. The eighteen `diagnostics` cases had a declared
line, column, code or `messageContains` changed and the ten `output` cases had a
declared stdout line changed; **all forty turned red on both backends** with the
observed-versus-declared diff printed, and every expectation was restored
byte-identically with sha256 compared before and after. The mutator refused to run
a case at all unless it was green on **both** backends first, and refused any
mutation whose search string did not occur exactly once in the file, so no
mutation could land in prose instead of in a declaration.

**One case in the backlog was deliberately not written, and the blocker was
re-measured rather than taken on trust.** The transitive trust position — a
properly marked relay module that re-exports from a module with a miscased marker
— is still ACCEPTED by both backends, because `checkForeignModuleInitializers`
and the fork's `checkForeignModuleTrust` both stop at depth 1. Measured on both
backends this revision, and the blocker is *wider* than the lane that reported it
recorded: an entirely UNMARKED module reached through a marked relay is accepted
too, not merely a miscased one, while the direct import of either is refused
`SMITHERS1510@1:24`. A case there would have to declare `expect: "output"`, which
would contradict the CLI's correct refusal and ADD a `product-refuses` row rather
than close one. It stays specified and unwritten until the reference walks the
reached-module closure.

> **Superseded on 2026-08-27 by the seventh revision above, and the reasoning in
> this paragraph held up.** Both backends now walk the reached-module closure, so
> the blocker is gone and the case is written — as *five* cases, because the
> re-measurement in this paragraph was right that the blocker was wider than a
> miscased marker. The prediction about `expect: "output"` was right too, in the
> direction it could not have known: the three that landed are `expect:
> "diagnostics"` and each ADDS a `both-refuse` row rather than a
> `product-refuses` one. This paragraph is left as written because a dated record
> of a past measurement must keep the name and the verdict the measurement used.

**2026-08-27, fifth revision — the round-6 backlog revision.** Twenty-seven cases
added, **438 → 465** — eleven in `05-context-rows`, six in `06-layers`, six in
`09-foreign-calls`, four in `07-must-consume`; no new `support/` module and no new
asset (every case uses `.sm` alone or a support module that already existed);
**no new `xfail` marker and none retired** (18 before and after); `messageContains`
19 → **27**; distinct declared diagnostic codes **78 before and 78 after — the
first revision in this page's history to add cases and add no code**, which is
the point of the revision rather than an oversight: all twenty-seven pin rules
that already had a code and had no case at the spelling that was broken.
**No implementation code was written or changed by this lane** — it owns
`conformance/corpus/**` and this page. The rules the cases pin were closed the
same day by seven other lanes in `poc/src/language/**` and
`compiler/forkbridge/*.go.txt`, and every one of those lanes deliberately wrote no
corpus case, because a case must not land before both implementations agree.
Measured with `node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  462/465 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 448/465 match the reference, 0 xpass, 16 xfail, 1 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 447/465 identical observations
Markers holding a fail-open: 0
exit 0
```

Baseline for the same command before the revision, re-measured rather than
quoted: **438 cases**, JS 435/438 with 3 `xfail`, Go 421/438 with 16 `xfail`, 0
unsupported, agreement 420/438, exit 0. **All twenty-seven new cases agree on both
backends**, so backend agreement rose by exactly twenty-seven and the disagreeing
set is unchanged at eighteen rows.

**Why this revision exists, and it is the most important sentence on this page
this week.** Three lanes closed 143 layer divergences, 116 coercion divergences
and 227 `satisfies` divergences on 2026-08-27, and **conformance reported 0
divergent throughout all three**. That is not a contradiction; it is the
definition of the blind spot this page's "Reference-only rejection rules" section
warns about, seen from the other side. No corpus case exercised a layer under a
type-only wrapper **at all**, no case spelled a coercion member any way other than
a method shorthand, and no case put a `satisfies` anywhere near a foreign value —
so the defects were unobservable by construction and their repair was equally
unobservable. Twenty-seven cases later, the same three families are pinned in
both directions. A rule that lands without cases is invisible here; a rule whose
*repair* lands without cases is invisible too, and that second shape had not been
named before.

`node scripts/oracle-differential.mjs`: **465 measured, 48 divergent**,
`product ACCEPTS what the corpus refuses` still **0**, and *the measured
divergence set matches `conformance/product-divergence.json` exactly* — so none of
the twenty-seven changed that record and no row was added, edited or
re-baselined. `node --test conformance/runner/selftest.mjs`: 26 tests, 26 pass, 0
skipped.

Every one of the twenty-seven was **verified load-bearing by mutation**, not
assumed: the seventeen `diagnostics` cases had a declared line, column, code or
`messageContains` changed and the ten `output` cases had a declared stdout line
changed; all twenty-seven turned red on **both** backends with the diff printed,
and every expectation was restored byte-identically with sha256 compared before
and after (each case's own `notes` records its mutation and its restore digest).
The mutator refused to run unless its search string occurred exactly once in the
file, so no mutation could land in prose instead of in a declaration.

**One claim this lane had been about to write down was measured false and is
recorded instead.** Several `output` negatives argue "a wrongly charged row would
be an unsatisfied top-level requirement and the program would be refused". It
would not. `SMITHERS2102` fires on top-level **calls**, and a case's functions are
reached through `main`, which the harness calls — so a wrongly charged row is not
refused, it **aborts**: `Panic: capability 'Db' was not provided` on the reference
and `Panic: unsatisfied Context requirement` on the fork, exit code 1 on both.
Measured by temporarily making a negative read a capability for real. The oracle
for those cases is the run time, which is a stronger observation than a refusal
and is now what their notes say.

**2026-08-26, fourth revision — the requirement-row revision.** Fourteen cases
added, **424 → 438** — twelve in `05-context-rows`, two in `20-host-globals`; no
new `support/` module and no new asset (every case is self-contained `.sm`); **no
new `xfail` marker and none retired** (18 before and after); `messageContains`
18 → **19**; distinct declared diagnostic codes 76 → **78**, the two new ones
being `SMITHERS2106` and `SMITHERS2107`. **No implementation code was written or
changed by this lane** — it owns `conformance/corpus/**` and this page and
nothing else; the four rules the cases pin were closed the same day by two other
lanes, in `poc/src/language/semantic.ts` and `compiler/forkbridge/*.go.txt`, and
the cases were deliberately held back until **both** backends had them, because
landing them a lane early would have turned `--backend both` red on every one.
Measured with `node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  435/438 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 421/438 match the reference, 0 xpass, 16 xfail, 1 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 420/438 identical observations
Markers holding a fail-open: 0
exit 0
```

Baseline for the same command before the revision, **re-measured rather than
quoted: 424 cases**, JS 421/424 with 3 `xfail`, Go 407/424 with 16 `xfail`, 0
unsupported, agreement 406/424, exit 0. Note the entry below this one records the
corpus as **422** — two cases landed after it was written and the page was not
updated, so the baseline in circulation was two low. Read the run, as that entry
itself says.

`node scripts/oracle-differential.mjs`: **438 measured, 48 divergent**,
`product ACCEPTS what the corpus refuses` still **0**, and *the measured
divergence set matches `conformance/product-divergence.json` exactly* — so none
of the fourteen new cases changed that record and no row was added, edited or
re-baselined. Worth stating plainly because it was not the expected outcome: that
gate measures the shipped CLI, which does no durable lowering and runs an asset
preflight the harness does not, so a new case landing in the `both refuse,
different code or position` bucket would have been legitimate. All fourteen agree
with the product instead. `node --test conformance/runner/selftest.mjs`: 26
tests, 26 pass, 0 skipped.

Every one of the fourteen was **verified load-bearing by mutation**, not assumed:
the ten `diagnostics` cases had a declared line, column or code changed and the
four `output` cases had a declared stdout line changed; all fourteen turned red on
**both** backends with the diff printed, the sixteen pre-existing cases in the two
areas stayed green in the same runs, and every expectation was restored
byte-identically with sha256 compared before and after (each case's own `notes`
records its mutation and its restore hash).

**2026-08-26, third revision — the six-lane backlog pass.** Fourteen cases added,
408 → **422**, all fourteen in `17-durable`; no new `support/` module and no new
asset (every case is self-contained `.sm`); **no new `xfail` marker and none
retired**; `messageContains` 12 → **18**. **No implementation code was written or
changed, and that was verified rather than asserted**: `sha256` of
`poc/src/durable/{source-compiler,schema,ir,artifact}.ts` and
`poc/src/language/semantic.ts` was taken before the baseline run and re-checked
after the final run and after the selftest, and all five were **identical** —
which matters more than usual this pass, because six lanes' fixes were live and
uncommitted in the working tree and a read-only reviewer was probing
`durable/store.ts`, `engine.ts` and `concurrency/**` throughout. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  419/422 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 405/422 match the reference, 0 xpass, 16 xfail, 1 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 404/422 identical observations
Markers holding a fail-open: 0
exit 0
```

Baseline for the same command before the revision, re-measured rather than quoted:
408 cases, JS 405/408 with 3 `xfail`, Go 392/408 with **16** `xfail`, 0
`unsupported`, agreement 391/408, exit 0. **The 16 is worth flagging**: the brief
that commissioned this pass quoted the Go `xfail` count as 13, which is what the
register said two revisions ago; the run says 16 and the register's own header
says sixteen, so the number in circulation was stale. Read the run.

**Thirteen of the fourteen are green on both backends. The fourteenth is the
first `unsupported` row this corpus has ever carried**, and it is honest rather
than regrettable: `17/an-actions-failure-channel-mints-one-identity-per-error-class`
reads `plan.actions[0].errorSchema.descriptor`, and the fork's `smithers:flows`
surface has no `descriptor` on a durable schema, so it reports stock `TS2339` on
an authored `.sm` file — the harness's own definition of "parsed Smithers syntax
it has no handling for". `unsupported` does not gate (only `fail` does), so exit
stays 0; the cost is one row of backend agreement and it buys the first corpus
observation of a compiler-derived durable failure identity.

**None of the fourteen was demonstrated failing against pre-fix behaviour, and
that is stated here because conflating it with the alternative is the thing this
page keeps warning about.** The durable lane's fix hardened the *runtime
authoring guard* (`poc/src/durable/authoring.ts`); the `.sm` path these cases
exercise was measured failing closed on every one of these forms both before and
after it. **They pin current behaviour on the normative path**, which had one
declared refusal rule on one form before this revision. The two acceptance cases
were proved load-bearing by mutation instead — `a-plain-projection…`'s fourth
stdout line `input` → `literal` (red on both backends) and
`an-actions-failure-channel…`'s second line `2` → `1` (red on the reference) —
and both expectations were restored and `sha256`-compared byte-identical. The six
new `messageContains` fragments were each mutated to a different plausible
SyntaxKind, all six went red on **both** backends with the message diff printed,
and all six files were restored and `sha256`-compared byte-identical.

`node --test conformance/runner/selftest.mjs` is 13/13 before and after.

**Four observation gaps were added (#15–#18) and one was sharpened (#5's
census).** Three of the six lanes reporting this day had **no compiler-observable
surface at all** and are recorded as such rather than forced into a case; two
cases were drafted, measured green, and **deleted** because each would have
passed for a reason other than the one its title claimed. See #15 (a durable
identity collision, where two sound remedies land in two different expectation
kinds), #16 (comptime key order, unsettled by the specification and already
ratified by accident), #17 (the loader surface and cache identity), and #18
(sandbox, packaging, migration).

**2026-08-26, second revision — the closed-fail-open revision.** Ten cases added,
398 → **408**; no new `support/` module (all ten reuse files already on disk);
**three** new `xfail` markers, none retired, and **one existing marker's stated
reason rewritten** because a fix in another lane had made it a false description
of current behaviour. `messageContains` unchanged at 12. No implementation code
was written or changed. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  405/408 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 392/408 match the reference, 0 xpass, 16 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 391/408 identical observations
exit 0
```

Baseline for the same command before the revision: 398 cases, JS 395/398 with 3
`xfail`, Go 385/398 with 13 `xfail`, agreement 384/398, exit 0. All ten new cases
pass on the reference; seven pass on the fork and three carry a marker.
`node --test conformance/runner/selftest.mjs` is 13/13 before and after.

**Seven of the ten were demonstrated failing against the pre-fix behaviour.**
The four `07-must-consume` refusal cases and all three `09-foreign-calls` cases
were staged into a reconstructed pre-change tree and run through the real runner
there: on the reference, the four must-consume cases compiled, ran and exited 0
printing `saved 3 records`, `1`, `false` and `2`; on the fork, identically, and
the three foreign cases additionally compiled, ran and exited 0 printing `3`,
`false` and `3`. **The tree was verified before it was trusted**, structurally
(it differs from the working tree in exactly the four files the closing lane
touched, carries none of the symbols that lane introduced — `heldChannel`,
`heldObligation`, `transferReachesCaller` — and still contains the deleted
member-declaration gate in `lowering.go.txt`) and behaviourally (it reproduces
the documented pre-fix output on every one of the seven).

**The remaining three are the acceptance guards and were proved enforced by
mutation instead**, which is the substitute when a case's whole point is that it
was green before and must stay green: each declared `stdout` was mutated, both
backends went red with the diff printed, and each expectation was restored and
sha256-compared byte-identical to the original. The three new `09` cases' declared
positions were verified the same way, because an `xfail(go)` marker suspends the
declaration on the fork and only the reference half enforces it — see observation
gap #14.

**2026-08-26, first revision — the review-backlog revision.** Thirty-four cases added,
364 → **398**; two new `support/` modules
(`implicit-invocation-host.ts`, `throws-claims.ts`); **three** new `xfail`
markers, none retired; two new `messageContains` fragments (10 → 12). No
implementation code was written or changed: the digest of
`poc/src/language/**`, `compiler/**` and `cmd/**` was taken before the baseline
run and again after the final run and was **identical**, so every number below
was measured against one implementation state. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  395/398 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 385/398 match the reference, 0 xpass, 13 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 384/398 identical observations
exit 0
```

Baseline for the same command before the revision: 364 cases, JS 361/364 with 3
`xfail`, Go 354/364 with 10 `xfail`, agreement 353/364, exit 0. Every one of the
34 new cases passes on the reference; 31 of them pass on the fork and 3 carry a
marker. `node --test conformance/runner/selftest.mjs` is 13/13 before and after.

**Twenty-one of the 34 were demonstrated failing against the pre-fix
behaviour**, per lane rather than per file: the cases were staged into a
reconstructed pre-change tree — one carrying none of the foreign-boundary work
for the 09 cases, and the same tree with the host-global allowlist inversion
additionally reverted for the 20 cases — and run through the real runner there.
14 of the 24 foreign-boundary cases and 7 of the 10 host-global cases went red,
and the 13 that did not are exactly the acceptance and control cases, which were
green before the change by construction. Those 13 were **proved enforced by
mutation** instead: each expectation was mutated, confirmed red on both backends,
restored, and sha256-compared byte-identical to the original.

**2026-08-25, fourth revision — the five-lane backlog revision, and one harness
change.** Thirty-three cases added, 321 → **354**; eight new `support/` modules,
thirteen new `*.mod.sm` companions, and one strengthened observation in the
shared harness; **five** new `xfail` markers, none retired. Three
existing expectations were **rewritten** because the harness now observes
something stronger. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  351/354 pass, 0 xpass, 3 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 343/354 match the reference, 0 xpass, 11 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 342/354 identical observations
exit 0
```

**The harness change is the part to read first, because it is the one that
changed what the corpus is able to see at all.** `harnessText` now takes each
backend's own compiler-stable Error identity accessor and the failure line prints
the identity instead of `error.constructor.name`. `specification/failures.mdx`
§Error Prototype names `constructor.name` as precisely the wrong key, and the
corpus was reading it. The consequence was concrete and had been invisible for as
long as the corpus existed: of the four obligations in §Error Classes, the Go
fork implemented **one**, and no case could report that in either direction,
because `constructor.name` reads `Missing` on a backend that mints an identity
and `Missing` on a backend that mints none. Three existing expectations changed
line for line (`01/throw-lifts-into-failure`,
`02/unwrap-returns-the-error-variant`, `02/unwrap-stops-at-the-first-failure`) and
one new case reads the identity as its whole subject
(`04/a-nominal-error-identity-names-its-declaring-module`). The invariant that
each backend must supply an accessor lives in `runner/selftest.mjs`, not in a
case, for the usual reason: a backend that stopped supplying one would fall back
for every case at once and every case that does not declare an identity would
stay green.

**The pre-fix arm for this revision isolates one lane's change at a time, and
three of the five lanes edited the same two files.** A detached worktree at
`dede442` with the whole working tree overlaid, its control arm confirmed to
reproduce the main tree case for case, and then a *targeted* revert per lane
rather than a file restore: a reverse patch built from the L1 lane's own saved
before/after for `SMITHERS1802`; the two `instanceof` right-operand exemption
blocks for the host-global lane; three separable sites for the error-transport
lane (the emitted registration, `smithersErrorIs`, and the unguarded name read);
one condition plus its mirrored pair for the callback-trust lane; and the three
regexes plus two `strings.ToLower` calls for the marker-casing lane. Every revert
was restored and re-verified byte-identical against the main tree afterwards.
**Of the 33 new cases, 20 were demonstrated failing against the pre-fix
behaviour** and the other 13 pin current behaviour; which is which is recorded in
each case's own `notes`, because conflating the two is how a corpus starts
claiming credit for tests that never could have failed.

**2026-08-25, third revision — the panic-non-widening revision.** One expectation
**replaced**, twenty-four cases added, 297 → **321**; one new `xfail` marker
written (`go`), none retired. This revision's rows are §7.24–7.29 and the `xfail`
register. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  320/321 pass, 0 xpass, 1 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 314/321 match the reference, 0 xpass, 7 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 313/321 identical observations
exit 0
```

**`exit 0` and `0 divergent` for the first time since the panic rule landed on
both backends.** The previous revision's single red row —
`09-foreign-calls/a-panic-in-an-if-body-still-needs-the-panic-channel`, which
declared `SMITHERS1101@2:1` for exactly the program
`specification/failures.mdx` §Panic Does Not Widen a Return Type now makes legal
— was **replaced, not deleted**. It keeps its `.sm` byte for byte, is renamed
`a-panic-in-an-if-body-keeps-a-plain-return-type`, and declares
`expect: output ["done"]`. Read that replacement together with the `1 xfail` and
the `7 xfail`, exactly as this page has always asked: `0 divergent` means "no
*unrecorded* backend contradicts the specification", and the eight markers are
where the recorded ones live.

**The pre-fix demonstration for this revision isolates one change rather than a
commit.** The panic fix is uncommitted working-tree work, so a plain worktree at
`dede442` would also lack the convergence and callback-contract lanes' fixes and
could not attribute anything. Instead: a detached worktree at `dede442`, the
current working-tree copy of every non-`conformance` modified and untracked file
overlaid onto it (21 files), and the whole current `conformance/` tree copied in.
That worktree reproduced the main tree exactly — 60/60 js, 57/60 go, 3 xfail on
`--filter 09-foreign-calls` — which is the control that makes the second arm
mean something. Then **only** `poc/src/language/semantic.ts`,
`poc/src/language/compile.ts` and `compiler/forkbridge/lowering.go.txt` were
reverted to their pre-panic-fix contents and the same filter re-run. **Nineteen
of the twenty-five cases fail there** (18 js, 19 go), and each one's observed
pre-fix diagnostics are recorded per case in "The fail-open pins". The six that
do not fail are the controls, the scope guards and the two lowering boundaries,
and their *not* moving is the finding: §7.26 and §7.29 are what say the rule was
implemented at the panic and not at the widening.

Plus `node --test conformance/runner/selftest.mjs` → 9/9, 0 skipped
(`selftest.mjs` not modified). Tree: working copy on
`poc/pre-withdrawal-checkpoint` at `dede442`, with uncommitted work from the
convergence lane, the callback-contract lane, the panic lane, the data lane and a
live `SMITHERS1802`/`for-of` lane. **This revision did not re-derive the code-set
subtractions or the census sections**; it corrected the rows it touched and the
two `SMITHERS1105`/`SMITHERS1106` rows that this revision's own work moved out of
the "spelled by one implementation and probed by no case" bucket.

**2026-08-25, second revision — the convergence revision.** Fifty cases added,
247 → **297**; **all eight** `xfail` markers the previous revision recorded were
retired after being measured `XPASS`; **seven** new markers were written. This
revision's rows are §4.12–4.17, §12.5a–12.5c, §12.13–12.14, §7.7a, §7.20–7.21,
§11.15, and the `xfail` register. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  295/297 pass, 0 xpass, 1 xfail, 0 unsupported, 1 divergent, 0 unmeasured
Go fork match: 290/297 match the reference, 0 xpass, 6 xfail, 0 unsupported, 1 divergent, 0 unmeasured
Backend agreement: 290/297 identical observations
exit 1
```

**Read the `1 divergent` and the `exit 1` before anything else, because they are
not this revision's.** The single failing case is
`09-foreign-calls/a-panic-in-an-if-body-still-needs-the-panic-channel`, which
declares `SMITHERS1101@2:1` and is now accepted and run by **both** backends.
That was **proved, not assumed, to belong to the live panic lane**: the
uncommitted working-tree edit to `poc/src/language/semantic.ts` deletes
`fn.directFailures.add("Panic")` for an authored `panic(...)` exit and cites
`specification/failures.mdx` §Panic Does Not Widen a Return Type in the comment
that replaces it; `compiler/forkbridge/lowering.go.txt` carries the mirror-image
edit with the same citation; both files were modified at 12:21 while this
revision was running, hours after the convergence lane finished; and the case
that moved declares exactly the code that edit changes. That case, and the
`SMITHERS1101`/`SMITHERS1105` obligations behind it, belong to that lane to
re-specify and re-pin. **Settled by the third revision above** — the expectation
was replaced from the specification, the rule was pinned in both directions by
twenty-two new cases, and the `SMITHERS1105` obligation the sentence above defers
turned out to be an unmeasured backend asymmetry rather than a panic question;
see §7.24–7.27. **No case in this revision depends on `SMITHERS1101`,
`SMITHERS1105`, or panic widening**, which was a deliberate boundary and is why
the rest of the corpus is unmoved by an in-flight rule change to both backends
at once.

The pre-fix demonstration was run the way the previous revision's was: a
detached worktree at `dede442` — the committed tree, which predates the
convergence and callback-contract fixes because both are uncommitted working-tree
work — with the fifty new cases copied in and both backends run there. What
failed there and what did not is recorded per case in "The fail-open pins".

Plus `node --test conformance/runner/selftest.mjs` → 9/9, 0 skipped. Tree:
working copy on `poc/pre-withdrawal-checkpoint` at `dede442`, with uncommitted
work from the convergence lane, the callback-contract lane, and the live panic
lane. **This revision did not re-derive the code-set subtractions or the census
sections**, exactly as its predecessor did not; it corrected the rows it touched.

**2026-08-25 — the corpus revision this page's §12.1, §12.10–12.12, §11.5,
§11.13–11.14, §8.2a, §7.7 and §7.7b rows and the `xfail` register describe.**
Forty-three cases added, 204 → **247**. Measured with
`node conformance/runner/run.mjs --backend both --jobs 4`:

```
JS reference:  246/247 pass, 0 xpass, 1 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 240/247 match the reference, 0 xpass, 7 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 239/247 identical observations
exit 0
```

Plus `node --test conformance/runner/selftest.mjs` → 9/9, 0 skipped, and the
pre-fix demonstration described under "The fail-open pins" (the same corpus run
on both backends in a detached worktree at `ffa80e3`). **Read `0 divergent` with
the `xfail` column, not instead of it** — the eight markers include one fail-open
on each backend. Tree: working copy on `poc/pre-withdrawal-checkpoint` at
`dede442`. **The rest of this page below this note was last re-derived on
2026-08-23 and parts of it are stale** — the `21-native-pin` rows survive in
several tables although the area is deleted. This revision corrected the rows it
touched and did not re-derive the code-set subtractions.

- **Measured:** 2026-08-23, 15:10–17:30 PDT, on this machine. This revision DID
  re-run the corpus: once to take the baseline it retired the last marker
  against, once per area while the new cases were being written, and once on the
  final tree. Every code-set figure below was recomputed from the commands
  printed beside it, not carried forward — **and the commands themselves were
  found to be wrong and are corrected below.**
- **Tree:** working tree at `c60eca9`, with uncommitted work from several lanes.
  Fork revision pinned at `typescript-fork.json` → `c087644e`. **The tree was
  quiescent while this revision measured** — no other lane was running — which is
  the first time that has been true for a revision of this page. The preceding
  day rewrote `compiler/forkbridge/` three times (the morning fail-open closures,
  the midday re-export closure that added `nativeLaunderWalk`, and the dynamic
  asset-import closure) and rewrote `poc/src/targets/classify.ts` five times
  (Layer provision, the module-level argument half, value flow, and the getter /
  spread / iteration / multi-return residue). **The tree moves hour to hour —
  re-run rather than quoting this.**
- **Command:** `node conformance/runner/run.mjs --backend both --jobs 4
  --interop` (exit 0), plus `node --test conformance/runner/selftest.mjs`.
- **Corpus contents changed in this revision:** 245 → **260** cases.
  `find conformance/corpus -name '*.expected.json' | wc -l` → 260.

```
JS reference:  260/260 pass, 0 xpass, 0 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 256/260 match the reference, 0 xpass, 4 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 256/260 identical observations
Interop: 6/6 on both backends
```

Corpus size: **204 cases across 17 populated areas** after the later 2026-08-23
grammar, `Optional<T>`, and postfix-propagation revisions and the 2026-08-24
removal of the `TypeScript` requirement member (three cases added; see the
second withdrawal record above). Empty historical directories are not counted as
areas. Per-area counts, re-measured with
`for d in conformance/corpus/*/; do echo "$(basename $d) $(ls $d*.expected.json | wc -l)"; done`:

| area | cases | | area | cases | | area | cases |
| --- | ---: | --- | --- | ---: | --- | --- | ---: |
| 01-result-lifting | 20 | | 09-foreign-calls | 27 | | 17-durable | 6 |
| 02-unwrap-propagation | 9 | | 14-conditional-declarations | 6 | | 18-typescript-requirement | 6 |
| 04-nominal-errors | 13 | | 15-generic-rows | 6 | | 19-retired-syntax | 37 |
| 05-context-rows | 8 | | 16-comptime | 10 | | 20-host-globals | 4 |
| 06-layers | 7 | | 22-source-text-fidelity | 3 | | 23-asset-imports | 21 |
| 07-must-consume | 11 | | 08-promise-chaining | 10 | | **total** | **204** |

Supporting files, re-measured after the withdrawal: **7** `*.mod.sm` auxiliary
modules (23 before it, 17 before that — 16 of them belonged to `21-native-pin`),
**8** `conformance/support/*.ts` foreign modules, **8** `conformance/assets/*`
staged files, **6** `conformance/interop/*.ts`.

```
JS reference:  204/204 pass, 0 xpass, 0 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 204/204 match the reference, 0 xpass, 0 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 204/204 identical observations
```

The scoreboard immediately above this paragraph is the **pre-withdrawal**
measurement and is kept because the rest of the page reasons from it. The block
here is the post-withdrawal one.

Both backends are at **zero divergences**. The four xfail markers below are not
divergences; each is a specification obligation with a named, evidenced gap,
which is the whole reason a marker exists rather than a silently softened
expectation. **Read `0 divergent` and `4 xfail` together or the first one
flatters** — three of the four are programs the fork compiles, certifies and
RUNS.

**The marker count moved for two opposite reasons at once, and conflating them
would be dishonest.** One marker was retired because the gap it described was
closed — the fork learned to resolve literal dynamic asset imports at compile
time and to refuse computed ones — and it was measured `XPASS` in a
`--backend both` run taken on the tree as found, then re-measured with `--json`
(identical code, position **and message** to the reference) before anything was
deleted. Four new markers were added because pinning five lanes of portability
work found four live Go fail-opens that no case had ever been able to see. Net
+3 markers is not the story; "the dynamic-asset gap closed, and the native pin
turned out to be granted over four different shapes on the fork" is.

**What was re-derived, and how.** The scoreboard, every per-area count, the
supporting-file counts, the three code-set counts, **both subtraction commands
and both subtraction sets**, the `messageContains` census, the asset-code
census in §17, the durable-code census in §20, and the `xfail` register were all
recomputed from commands on this tree. Rows this revision did not touch carry
the previous revision's reasons, and the previous revision's caveat still
applies to them: **a reason recorded here can go stale as fast as a number can.**

**And this revision found something worse than a stale reason: a wrong
method.** The command this page prints for the fork's code set —
`grep -roh 'SMITHERS[0-9]\{4\}' compiler/ | sort -u` — is wrong in both
directions, and every figure derived from it for the last three revisions was
wrong with it. It counted one code the fork does not implement (a code named
only in two design documents that say it is **retired**) and missed nineteen the
fork does implement (the durable family, which `compiler/forkbridge/durable.go.txt`
builds by concatenating a prefix constant with a digit string, so no literal-code
grep can see them). The corrected commands and the corrected sets are in the two
sections below, with the diff between the old method and the new one printed in
full. **A number recomputed by a wrong command is not re-derived; it is
re-asserted.**

### What this revision changed — 2026-08-27, closure-backlog revision

This revision added **5 cases** (493 → **498**), all in `09-foreign-calls`, added
**no** `xfail` marker and retired none, declared **3** new `messageContains`
fragments (33 → **36**), and added **nine** `conformance/support/` modules — the
count is high for five cases because support files are staged flat by basename, so
four relays that must re-export from four different targets cannot share a name,
and because the depth-3 case needs a middle hop of its own. It wrote no
implementation code and edited no existing case. It gave §7 one new row, **7.7c**,
and marked 7.8c's closing "not covered" sentence superseded rather than deleting
it, because that sentence is a dated measurement and its reasoning held up.

**What it could not move, and this is again the useful half.** The
"rules both implementations have and no case probes" subtraction is **19 for the
fourth revision running**, and this time not one input moved either: R = 110,
F = 112, intersection = 91, corpus = 72. The five cases declare exactly one code
between them, `SMITHERS1510`, which twenty-one other cases already declare. The
subtraction counts codes and cannot count **distance** any more than it could
count spellings — `SMITHERS1510` had five cases while both backends ran an
untrusted initializer one edge away. The figure that moved is backend agreement,
**475/493 → 480/498**, and the reason it is the right figure to read is that
closing 58 measured divergences on the two implementations moved it by **zero**.

### What this revision changed — 2026-08-27, round-7 backlog revision

This revision added **28 cases** (465 → **493**), added **no** `xfail` marker and
retired none, declared **6** new `messageContains` fragments (27 → **33**), and
added **five** `conformance/support/` modules — the first revision since
2026-08-25 to need any, because three of the cases pin what a foreign module's
leading comment must LOOK like and no existing support file could be edited to
say it without changing what the cases already using it observe. It wrote no
implementation code. It corrected one stale citation on this page: §1.6 named
`18/eval-is-usable-and-not-forbidden`, a case that no longer exists, and the row
now records both the replacement and the fact that the corpus deliberately
contradicts a Locked specification sentence there. It gave four rows in the
§9.6–9.13 classification table their first case (9.8's `Date.parse` half, 9.14's
whole-root escape, and second and third key spellings at 9.6 and 9.11) and
re-derived that section's own count from the rows rather than adjusting it, which
moved its denominator from nine to ten.

**What it could not move, and this is the useful half.** The
"rules both implementations have and no case probes" subtraction is **19 for the
third revision running**, and this time every input to it moved by exactly one
while the answer did not. That is correct and it is the strongest evidence this
page has for its own blind spot: round 7 found eleven defects in a day, every one
at a code that already had cases, every one invisible to a 465-case corpus
reporting `0 divergent`, and two of the classes were shared by both
implementations so no divergence could ever have existed to report. The
subtraction counts codes; the defects were spellings. See that section for the
commands and the argument.

**Three rows this revision put into `conformance/product-divergence.json`'s
future and did not write.** The three trust-marker refusal cases move the
oracle-differential measured set from 49 to 52, all `both-refuse`, all the
already-recorded `duplicate-SMITHERS1510-implementation-in-the-runtime-graph`
cause, `product ACCEPTS` still 0. The record is not this lane's file and was not
re-baselined; that gate exits 1 until the three rows are added with
`verdict: "product-wrong"`.

**A gap in this log, noticed while adding to it and not filled.** The entry below
is the 2026-08-26 *third* revision. The fourth (2026-08-26, requirement rows) and
the fifth (2026-08-27, the round-6 backlog) never wrote one, so this log jumps
three revisions where "How and when this page was measured" above does not. Both
are fully recorded there; whoever next writes here should either back-fill the two
entries or delete this log in favour of that section, because two histories of the
same thing is how the rest of this page went stale.

### What the 2026-08-26 third revision changed

This revision added **14 cases** (408 → **422**), all in `17-durable`, added
**no** `xfail` marker and retired none, and declared **6** new `messageContains`
fragments (12 → **18**). It wrote no implementation code, verified by `sha256` on
both sides of the run rather than asserted. Its subject was a six-lane backlog of
landed-but-unpinned fixes, and **most of that backlog turned out not to belong
here** — three of the six lanes' findings have no compiler-observable surface at
all, and two further cases were drafted, measured green, and deleted because each
would have passed for a reason other than the one its title claimed. Four new
observation gaps (#15–#18) record what could not honestly be written and what
would have to change. See "How and when this page was measured" above for the
scoreboard, §20 for the cases, and gaps #15–#18 for the refusals.

### What the revision before it changed — 2026-08-26, second revision

That revision added **10 cases** (398 → **408**), added **3** `xfail` markers,
retired none, **rewrote one existing marker's stated reason**, and declared no
new `messageContains` fragments (12, unchanged). It wrote no implementation code:
every case pins work another lane had already landed and left unpinned.

Its subject was the two fail-opens an independent review had left open, which
that lane closed — and the *shape* of how it closed them, which is why this
revision exists at all rather than being a footnote to the last one.

| # | what was unpinned | what pins it now |
| --- | --- | --- |
| M | **a callee could move its Results into a container, return them, and charge nobody.** `return` was treated as an unconditional discharge for a stored value, and the caller was never charged, because the walk started only from producers whose own value *is* a Result — and a call returning `readonly Result<A,E>[]` is a plain value. The obligation left the callee and arrived nowhere; both backends compiled, ran and exited 0 on a program that threw and dropped a checked `SaveFailed`. | 7 cases in `07-must-consume`. **Four refusals** — the executed defect (`SMITHERS1301@15:20`), its `await` spelling, the `1402` twin for a container of started Promises, and the `: unknown` launder that keeps the return-type gate honest — all four demonstrated failing on the pre-fix tree on **both** backends with identical stdout. **Three acceptance guards**, proved enforced by mutation: `Result.all` over a returned collection, an index read off an unbound one, and — the sharpest — a **published** collection with no caller in the file, which is the only case that can see the obvious over-fix of refusing the callee. |
| F | **the fork's foreign property rule read the MEMBER's declarations while its own comment said it read the RECEIVER's provenance.** The verdict was right on the dotted, declared-member spelling and wrong everywhere else; the corpus had only that one spelling, so the whole claim was unpinned. | 3 cases in `09-foreign-calls`, each a spelling the old gate admitted: an element access, a member declared only in `lib.es5.d.ts`, and a binding pattern with no member expression. All three compiled, ran and exited 0 on the fork's pre-fix tree. All three carry `xfail(go)` for the row charge alone, which is a different rule. |

**A correct verdict resting on a stale reason is the shape this repository keeps
hitting**, and it is worth naming because it is invisible to every check that
looks at outcomes. The fork's comment and the fork's code disagreed for as long
as the corpus only exercised the spelling on which they happened to agree. The
repair is not "read the comment" — it is a case per spelling the two readings
would answer differently, which is what the three `09` cases are.

**The same shape hit this page's own tables the same day.** The marker on
`09/a-foreign-index-signature-read-through-a-property-access-needs-an-adapter` stated, as
measured fact, that the fork compiled the program with zero diagnostics and ran
it. That stopped being true when the fail-open closed, and the marker was
*correct to keep* — the fork still omits the `SMITHERS1101` — so nothing in any
run would have flagged it. A marker that survives a partial fix carries a reason
that describes a backend that no longer exists. Re-read a `reason` against the
backend before quoting it.

### What the revision before that changed — 2026-08-26, first revision

This revision added **34 cases** (364 → 398), added **3** `xfail` markers and
retired none, and declared **2** new `messageContains` fragments (10 → 12). It
wrote no implementation code: every case pins work two other lanes had already
landed and left unpinned.

Its subject was four fail-opens an independent review found, all of them in the
same direction — a foreign call the language could not see, or a host global the
rule had never been asked about.

| # | what was unpinned | what pins it now |
| --- | --- | --- |
| F3 | **the panic channel was dropped for every *implicit* invocation form.** `for…of`, spread, object spread, template interpolation, the coercing operators, `yield*`, `for await…of`, computed keys and `instanceof`'s right operand each invoke an arbitrary member of a foreign value, and the machinery was keyed on `ts.CallExpression`/`ts.NewExpression`, so foreign code threw out of functions whose row read `failures: []`. | 7 cases at 7.16a/7.16b: five refusals across the three protocols (iteration, enumeration, coercion) plus two over-correction guards. Five were **demonstrated failing** on a reconstructed pre-change tree. |
| F3b | **the call-like forms with no call expression** — a tagged template, an implicit `super(...)` from constructing a subclass of a foreign class, and a decorator. | 5 cases at 7.16c, each with its acceptance or boundary twin. On the pre-change tree the decorator case compiled clean and the emitted program **died while loading**. |
| F4 | **`@throws {never}` on an async or `Promise`-returning binding erased the rejection channel.** The marker is an opt-out for the *call*; an async function does not throw at the call, it rejects afterwards. | 5 cases at 7.16d, including the un-sugared `Promise`-returning spelling (the shape the next platform binding takes) and two `output` controls proving the unmarked and `@throws {T}` spellings were not disturbed. |
| F5 | **`@throws` was matched per SYMBOL rather than per resolved signature**, so one marked overload trusted every overload — and two contradictory tags resolved **by source order**, giving opposite verdicts for the same two claims. | 5 cases at 7.16, written as an order-symmetric pair plus three twins. **The exact rules here are a DECISIONS `Direction` entry, not Locked, and every one of the five says so in its own `notes`.** |
| HG | **the host-global prohibition was an eight-name denylist over an open namespace.** 22 of 38 globals compiled clean, including four aliases of `globalThis` that bypassed all eight refused names. | 10 cases at 9.1a, 9.1b, 9.4b, 9.4c, 9.9 and 9.9a. Seven were **demonstrated failing** on a tree with the allowlist inversion reverted; the other three are the acceptance and control guards, which were green in both trees by construction. |

**Every acceptance and control case that could not be demonstrated failing was
proved enforced instead** — 13 of them, each expectation mutated red on both
backends and then restored and sha256-compared byte-identical. That is the
substitute for a pre-fix demonstration on a case whose whole point is that it was
green before and must stay green, and without it those 13 rows would be green for
an unexamined reason.

**One marker held a fail-open again** for the first time since 2026-08-25 — see
the register. It was filed against measured current behaviour rather than
pre-filed green, because a fix for it was in flight in another lane at the time
and writing the case as though the fix had landed would have made the corpus
assert something nobody had observed. **That fix landed later the same day, and
the marker's prediction of what would happen next was wrong in an instructive
way**: it predicted `XPASS` and retirement, and the outcome was a *narrowed*
marker instead, because the fix closed the read and not the row charge. Filing
against measured behaviour was still right; predicting the shape of the
retirement inside the marker was the part that did not survive contact.

### What the revision two before that changed

This revision added **15 cases** (245 → 260), retired **1** `xfail` marker,
added **4**, wrote one case it **deliberately did not land**, and **corrected
the method behind both code-set subtractions.**

Its subject was the largest unpinned surface in the repository. Five consecutive
lanes closed well over a hundred fail-open forms in the portability analyzer
(`poc/src/targets/classify.ts`) — Layer provision, the module-level argument
half of value flow, value flow itself, and the getter / spread / iteration /
multi-return residue — and **not one corpus case covered any of it.** That is
precisely the condition that let the original defects survive at parity for as
long as they did: a rule nothing asks about produces no signal in either
direction, however many times it is rewritten.

| # | what was unpinned | what pins it now |
| --- | --- | --- |
| R1 | **the whole native-pin portability surface below the import list.** Sixteen cases in `21-native-pin` all reached the host through an import or a re-export. Nothing pinned a module-level initializer, an immediately-invoked function, a callback a visible callee invokes, a class instance whose method reads authority, a `Layer.provide` callback, or the transitive module load graph. | 9 cases in `21-native-pin`, one per class, each asserting the **composed dependency route** with `messageContains` and not merely the code. **Four of them fail on the fork** — see the register. |
| R2 | **the negative half of every one of those rules.** An over-correction is the direction that refuses a portable program, and `classify.ts`'s own header records that this analyzer has shipped one three times. | 3 acceptance controls, written as adjacent twins rather than as separate cases: a callee that only STORES its callback (an `expect: "output"` case that compiles and runs), a layer whose provided capability really is subtracted, and — measured and stated in the case's own notes — the fact that the storing twin **passes on a backend that enters no callback at all**, so it certifies nothing when read alone. |
| R3 | **`SMITHERS3005`, the gate on the whole native-pin area** — and both of its branches, which report at different positions. | `21-native-pin/a-pin-whose-argument-is-not-a-project-function-is-rejected` (at the argument) and `a-pin-given-two-arguments-is-rejected` (at the call). |
| R4 | **four more codes both implementations spell and no case probed**: `SMITHERS1503` (a `panic(...)` exit written where a value is expected), `SMITHERS1713` (an async `errdefer` over a directly returned Promise — recorded as **partial** at 14.7 with "isolating it needs a narrower program", which this is), `SMITHERS2103` (a `Layer.provide` callback that resolves to nothing checkable), and `SMITHERS4103` (an opaque `durable(...)` argument, obligation 20.5, the durable area's exact analogue of R3). | one case each in `09-foreign-calls`, `10-defer`, `06-layers`, `17-durable`. |
| R5 | **the method behind this page's two headline subtractions.** Both are computed from `grep -roh 'SMITHERS[0-9]\{4\}' compiler/`, which reads design documents and test files as if they were implementation and cannot see a code the implementation builds by concatenation. | both sections below now print a corrected command, the corrected set, **and the diff against the old method**: 1 false positive, 19 false negatives. |

**One case was written, measured, and deliberately not landed**: `SMITHERS1708`.
See §13.21 — the evidence says the fork is right and the reference's refusal is a
limitation of its own lowering strategy, so pinning it would have made the
fork's correct behaviour a conformance failure.

One marker was retired
(`23-asset-imports/a-non-literal-dynamic-asset-import-is-rejected`, the previous
revision's finding, now closed in the fork). Four were added, all in
`21-native-pin`, all in the fail-open direction, and three of them on programs
the fork compiles, certifies and runs.

### What the revision three before that changed

That revision added **11 cases** (234 → 245), retired **5** `xfail` markers,
added **1**, and added one harness self-test file
(`conformance/runner/selftest.mjs`) for a defect class no corpus case can reach.

Its subject was the two things the revision before it named as its own largest
gaps and could not get to: **a rule both implementations have and no case
probes**, and **a defect in how the harness asks its question rather than in
either answer**. Both are structurally invisible to a differential oracle, and
both turned out to be larger than that revision's list of them.

| # | what was unpinned | what pins it now |
| --- | --- | --- |
| Q1 | **`SMITHERS1507`/`SMITHERS1508`** — order-unsafe foreign call and provenance-escape shapes. Present in *both* implementations and in *neither* the corpus, which is the worst combination: nothing would notice either backend losing them. | 4 refusals + 2 acceptance controls in `09-foreign-calls`, covering both branches of the lowerability predicate and two of the four escape sites. §7.17, §7.20–7.22. |
| Q2 | the **Go CLI's default lowering mode**. `LoweringIdentity` was the empty string, i.e. the zero value of `LoweringMode`, and `cmd/smithersc-go` built positional requests with no `Lowering` field, so every positional invocation compiled `.sm` through the stock TypeScript checker and applied **no Smithers rule at all**. Fixed at both ends; nothing on the conformance side asserted it, and **no corpus case can**, because the runner always sends a mode explicitly. | `conformance/runner/selftest.mjs`, plus a named `loweringMode` constant in `corpus.mjs` that every Go request now reads. See §21.7. |
| Q3 | **8 of the 12 remaining asset rejections**, prioritised by that revision's own instruction to take the fail-open direction of the Locked static-selection rule first. | 4 refusals + 1 acceptance control in `23-asset-imports` (`SMITHERS5206`, `5207`, `5213`, `5218`). One of them was a live Go fail-open, and it is the marker this revision retired. §17.12. |
| Q4 | **the other subtraction.** The reference-only section subtracts the fork's code set from the reference's. It had never subtracted the *corpus's* code set from the **intersection** — the rules both implementations spell and no case probes. That set was recorded as **13 codes**; this revision's corrected method makes the comparable figure **27**. | recomputed and tabled in §"Rules both implementations have and no case probes". |

### What the revision four before that changed

That revision added **23 cases** (211 → 234), retired **14** `xfail` markers,
added **5**, made one additive change to the expectation schema
(`messageContains`, `conformance/README.md` §"when the payload *is* the
promise"), and fixed one defect in the harness itself (the two backends were
being given **different comptime targets**). Everything it added is a **pin for
a fail-open that was already fixed but that no case would have noticed
regressing** — except the last, which is a fail-open that was still live, in the
oracle rather than in a backend.

| # | what was unpinned | what pins it now |
| --- | --- | --- |
| P1 | the entire **re-export surface**: zero of the corpus's `.sm` files contained `export … from` or `export *`, in any area | 7 cases in `21-native-pin` and 1 in `09-foreign-calls`. Writing them found a Go fail-open nobody had measured; it is now closed and those five markers are retired. |
| P2 | the retired **`vibelang:flows`** specifier, which the Go bridge carried in both its compiler-owned and its durable module tables | `17-durable/the-retired-vibelang-flows-specifier-is-not-compiler-owned`, paired with `a-single-action-flow-lowers-to-a-static-plan` |
| P3 | the **module-initialization trust marker** grammar — all three of its holes, one of which is triggered by the header the specification tells authors to write | 3 cases in `09-foreign-calls` |
| P4 | **`@throws {Never}`** case sensitivity, and 4 **import-attribute shape** rules (`SMITHERS5203`/`5204`/`5205`, incl. the no-substitution template literal) | 1 case in `09-foreign-calls`, 4 in `23-asset-imports` |
| P5 | **shadowed compiler-owned namespaces**: a user's own `Result`/`Promise` discharging must-consume by spelling | 4 cases in `07-must-consume` (2 refusals, 2 acceptance controls) |
| P6 | **the harness's own equality relation**: the JS driver pinned `comptime.target` to `node-es2022` while the Go request sent `options: {}` and the bridge defaulted to `typescript-node`, so every comptime case compared two compilations of two different programs | one shared `comptimeTarget` constant in `conformance/runner/corpus.mjs`, sent explicitly to both backends, plus `16-comptime/the-comptime-target-is-one-declared-input-for-both-backends` |

### What the revision five before that corrected

That revision changed **no case and no runner file**. It was an audit pass over
this document only, and the corpus was unchanged at 211 cases across 23 areas.
Five things it says were wrong before:

| # | what this page said | what is true |
| --- | --- | --- |
| C1 | 10.13 and observation gap #2: "There is no native or **Wasm** backend… no implementation surface exists." | The native/LLVM half is right. The Wasm half is false: `poc/src/targets/portable-backend.ts` is 4,180 lines with 65 diagnostic codes and executes real WebAssembly. Row **10.14** now records it, with the corpus pinning zero of its codes. |
| C2 | §19 and §20 listed comptime and durable obligations "so the census is complete" and assigned **no status to any of them**, deferring to "other lanes". | No other lane returned. Both sections now have one row per normative sentence with a verdict and a named reason. §20 comes out **31 of 40 uncovered**. |
| C3 | 7.17: `SMITHERS1507`/`SMITHERS1508` "both fire and are *observed* in the corpus, but only as cascade members inside other cases." | Neither code appears anywhere under `conformance/corpus/`, and `conformance/runner/judge.mjs` requires a satisfied diagnostics expectation to compare the same number of diagnostics — an undeclared cascade member would fail the case, not ride inside it. Both are **uncovered**. (They were also absent from the fork when that was written; both have since been ported, and both are still uncovered.) |
| C4 | Documentation conflict #1: loops-as-expressions "**resolved**… No conflict remains." | Only the specification page was narrowed. `docs/DECISIONS.md:289` still locks `while`/`for` as expressions, and `specification/index.mdx:54` makes the ledger win a conflict. See **Q1**. |
| C5 | §17: "What remains open here is genuinely open… rather than untested." | Fifteen of the nineteen reference asset rejections (`SMITHERS5201`–`5219`) are neither open nor covered, and three of them are the fail-open direction of a Locked rule. See **§17.12**. |

And four surfaces it had never mentioned at all, now added: the CLI (§21),
`smithers:schema` (§22), the host-sensitive global classification table
(§9.6–9.13), and the reference-only rejection rules (its own section above).

### What changed in the revision six before that

The previous revision's §17 said asset loaders were unwritable because "the
harness cannot stage an asset", and named the fix. That fix is done, and §17 is
now the largest block of new coverage in the corpus. Its §11.11 reason has also
been re-tested and made specific, and two of its `xfail` markers are retired.

| previously recorded | status now |
| --- | --- |
| §17.1–17.5 asset loaders — "**unwritable: the harness cannot stage an asset** ... What the harness would need: an `assets` field in the expectation schema, asset staging in both backends" | **covered**, 13 cases in the new `23-asset-imports`. The `assets` field exists, both backends stage the same files at the same paths, and a satisfied verdict is audited against an `assets` stage. Two findings came out of it — see the xfail register. |
| gap #3, "**Assets cannot be staged.** `corpus.mjs` knows two file kinds" | **closed.** `corpus.mjs` knows three. Two narrower limits replace it (gaps #3 and #7 below), both traced to the Go wire protocol rather than to the corpus. |
| §11.11 concurrency library — "both backends stage the project as one flat directory" | **still unwritable, and the reason is now measured rather than reasoned.** Staging shape was never the binding constraint; module resolution is. See §11.11. |
| §11.10 cancellation — "`grep -rl cancel poc/src/{language,runtime,targets}` finds only `lsp.ts`" | **the grep was too narrow.** `poc/src/concurrency/cancellation.ts` exists. The conclusion survives — it is a library, not a language channel — but the recorded evidence was wrong and is corrected in §11.10. |
| go `xfail` on `01/top-level-expect-is-rejected` (the fork accepted and ran a top-level `Result.expect`) | **retired.** The runner reported `XPASS`; the fork now reports `SMITHERS1505` at the authored position. |
| go `xfail` on `22/diagnostic-columns-survive-non-ascii-source-text` (UTF-8 byte columns) | **retired.** `XPASS`; the fork now reports authored UTF-16 columns. |
| the four `js` markers the previous revision's register listed (both arrow-arm switch cases, the async native pin, the non-ASCII Error class name) | **already retired from the corpus before this revision measured**, and all four now pass on both backends. The register in `README.md` had gone stale against the corpus it describes, which is why retirements are now recorded in each case's own `notes`. |

---

## Reference-only rejection rules — where a fail-open could be hiding right now

**This is the most important section on this page.** Everything else measures
what the corpus reaches. This measures a place the corpus is structurally blind.

The run reports **zero divergences**. That number means "no case observed the two
backends disagreeing". It cannot mean "the two backends agree", because a
divergence is only visible where a case exists. So the interesting set is:
*rules the reference implements, the fork does not, and no case probes*. Every
member of that set is a rejection the fork would silently skip, and the
scoreboard would keep saying zero.

### The command this page used for three revisions is wrong. Here is the correct one

The old command was:

```sh
grep -roh 'SMITHERS[0-9]\{4\}' compiler/ | sort -u        # WRONG — do not use
```

It is wrong in **both** directions, and every figure derived from it since it was
introduced was wrong with it:

- **1 false positive.** `SMITHERS1708` appears in `compiler/` only in
  `FORK-SEAM-DESIGN.md:642`/`:1440` and `GRAMMAR-SPIKE.md:398`/`:832` — two design
  documents, all four sentences saying the fork **retires** it ("`SMITHERS1707`
  and `SMITHERS1708` do not arise at all: there is no hoisting"). Prose about a
  rule is not the rule. This is the same trap the page already knew about on the
  reference side, where `SMITHERS1805` had to be set aside because it appears only
  in `poc/src/language/README.md` recording its own retirement — the fix was
  applied to one side and not the other.
- **19 false negatives.** `compiler/forkbridge/durable.go.txt:27,118` declares
  `const durableDiagnosticPrefix = "SMITHERS"` and
  `func durableCode(suffix string) string { return durableDiagnosticPrefix + suffix }`,
  and its failure helper is called as `d.fail(node, "4104", …)` with a bare digit
  string. **No literal-code grep can see any of them.** The fork implements
  **22** durable codes this way and the page counted **3** of them — and those
  three only because they are spelled out in `compiler/fork_durable_test.go`,
  which is a test file rather than an implementation.

The corrected commands, which are the whole basis of this section and of the one
after it:

```sh
grep -roh 'SMITHERS[0-9]\{4\}' poc/src/ | sort -u > /tmp/ref-codes    # 204; no
                       # constructed codes on the reference side, verified with
                       # grep -rn '"SMITHERS" *+' poc/src/  ->  no matches

# the fork: implementation sources only, then the codes it CONSTRUCTS
{ find compiler -name '*.go' ! -name '*_test.go' -print0
  find compiler/forkbridge -name '*.go.txt' -print0; } \
  | xargs -0 grep -oh 'SMITHERS[0-9]\{4\}' | sort -u   > /tmp/fork-literal   # 95
grep -roh 'suffix: "[0-9]\{4\}"\|durableCode("[0-9]\{4\}")\|fail([^"]*"[0-9]\{4\}"' \
  compiler/forkbridge/ | grep -o '"[0-9]\{4\}"' | tr -d '"' | sort -u \
  | sed 's/^/SMITHERS/'                                > /tmp/fork-built     # 22
cat /tmp/fork-literal /tmp/fork-built | sort -u        > /tmp/fork-codes     # 117

grep -roh '"code": "SMITHERS[0-9]\{4\}"' conformance/corpus/ \
  | grep -o 'SMITHERS[0-9]\{4\}' | sort -u             > /tmp/corpus-codes   # 77

comm -23 /tmp/ref-codes /tmp/fork-codes                    # reference-only   100
comm -12 /tmp/ref-codes /tmp/fork-codes > /tmp/both-codes  # in both          104
comm -23 /tmp/both-codes /tmp/corpus-codes                 # in both, no case  27
```

**A reader who wants to check this page should run the diff, not the totals:**

```sh
comm -23 /tmp/fork-codes-old /tmp/fork-codes   # SMITHERS1708 — prose only
comm -13 /tmp/fork-codes-old /tmp/fork-codes   # 4103 4104 4105 4107-4113 4115
                                               # 4116 4118-4123 4199 — constructed
```

Measured 2026-08-23, on the quiescent tree: the reference names **204** codes,
the fork **117** (recorded as 98 last revision, by the wrong command), and the
corpus declares **77** (was 73 — this revision added `SMITHERS1503`, `2103`,
`3005`, `4103`, and `1713`).

The `1xxx` difference is **eight** codes, not seven: `SMITHERS1002`, `1105`,
`1106`, `1704`, `1706`, **`1708`**, `1805`, `1900`. Three are not language rules
and are set aside with their reason. **Five are** — one more than the previous
revision recorded, because `SMITHERS1708` was never in the fork at all. None of
the five has a case, and the last one is a row of a kind this table has not had
before: a reference-only rule whose absence from the fork has been **measured
and found correct**.

| code | what the reference rejects | evidence | in fork? | in corpus? | severity of a fail-open |
| --- | --- | --- | --- | --- | --- |
| `SMITHERS1105` | a constructor or accessor carrying a Result channel | `poc/src/language/semantic.ts:1968` | no | **YES, as of the third revision** — `09/a-fallible-getter-in-an-argument-still-needs-a-contract`, `xfail go` | `failures.mdx` §Compiler Lifting requires a reachable recoverable Error exit to return or infer a Result; `type-system.mdx` §Fallibility Inference says the compiler MUST reject the function "rather than permit an untyped exception path". Neither page carves out constructors or accessors. **Measured rather than feared: the fork does NOT fail open on the probed shape.** It refuses the same program with `SMITHERS1303` at the same authored position, because the getter is in an argument and the failure crosses a value edge. What the fork lacks is the accessor-shape refusal itself, so the fail-open severity above applies only to a fallible accessor with NO value edge to catch it — which no case yet probes, and which needs a program the harness can observe. See §7.28. |
| `SMITHERS1106` | a fallible generator | `poc/src/language/semantic.ts:1971` | no | **partially, as of the third revision** — `09/a-generator-may-abort-with-a-panic` is the corpus's first `function*`, and pins the *accepted* direction (a generator that PANICS is not fallible and needs no channel). The refusal itself is still unprobed. | same rule, same direction. The reference reported `SMITHERS1101` + `SMITHERS1106` and the fork only `SMITHERS1101` for a panicking generator until the panic non-widening rule made both accept it; a generator with an ORDINARY recoverable failure still splits the two backends the same way `SMITHERS1105` does, and is the sibling case §7.28 names as not yet written. |
| `SMITHERS1706` | a `break`/`continue` or case-label jump escaping a value-producing expression | `poc/src/language/control-flow.ts:255`, `poc/src/language/semantic.ts:3846`, `:3854`, `:3878` | no | no | the expression forms in `control-flow.mdx` MUST have "a statically determined success type from its reachable value-producing exits". An escaping jump is an exit the type was not computed from. |
| `SMITHERS1704` | labeled control flow the POC cannot lower label-aware | `poc/src/language/semantic.ts:3760` | no | no | a POC-boundary gate rather than a specification sentence, but it is still a rejection one implementation makes and the other does not, and no case would notice either behaviour. |
| `SMITHERS1708` | a value expression in an argument whose callee "cannot be proven order-stable" | `poc/src/language/recover.ts:1337` | **no — and that is correct**, see below | no, **deliberately** | **the one row in this table whose gap has been measured and found not to be a gap.** It entered the table this revision because the old command misread two design documents as an implementation. The fork's design says it retires the rule ("there is no hoisting, so there is no evaluation order to preserve and no callee-stability proof to make"), and that claim was tested rather than taken: handed `return pick()(score, if (on) { … } else { … })` where both `pick()` and the branch push to an observable log, the fork compiles it and prints `callee,arg` — the authored order, identical to the remedy form (`const call = pick()`) and to the same program with no expression-`if` in it at all. So this is a **reference-side provability limitation**, not a fork fail-open, and a case declaring `SMITHERS1708` would make the fork's correct behaviour a conformance failure. Written, measured, and deliberately not landed; see §13.21. |

**One row entered this table this revision and none left it.** `SMITHERS1708`
entered not because anything changed in either implementation but because the
method was corrected — which is the more uncomfortable of the two reasons, since
it means the row was wrong on this page for three revisions while the number
above it looked stable. What else changed is what happened to the three rows
that left in the revision before, and that is worth stating because it is the
whole argument for the next section.

`SMITHERS1502`, `SMITHERS1507` and `SMITHERS1508` were listed here as
reference-only with no case. All three were then ported into the fork — after a
census compared the two implementations' full accepted surface, not after any
case was run. Leaving this table is therefore **not** the same as becoming
covered: it only means code-set subtraction has stopped being able to see them.
`SMITHERS1502` did get a case
(`09-foreign-calls/the-never-annotation-is-case-sensitive`). `SMITHERS1507` and
`SMITHERS1508` did not, for a whole revision, and during that revision this page
recorded them as covered when they were not. **This revision writes their
cases** — see §7.17, §7.20–7.22 — and adds the subtraction that would have
caught the gap.

**Set aside, with the reason:** `SMITHERS1002` is an internal fail-closed guard
for a missing parser-diagnostics field (`poc/src/language/semantic.ts:4249`), not
an authored-source rule. `SMITHERS1900` is a formatter limit
(`poc/src/language/format.ts:1047`) and the fork has no formatter.
`SMITHERS1805` appears only in `poc/src/language/README.md:108`, which records it
as **retired** — it is emitted by nothing, and a reader diffing the two code sets
mechanically would wrongly count it. **`SMITHERS1708` is the same mistake made on
the other side of the subtraction**, and the fact that this page had already
written down the reference-side instance and still missed the fork-side one is
the argument for running the diff rather than the totals.

**The `4xxx` rows this table used to carry are gone, and that is a correction,
not progress.** The old command listed `SMITHERS4101`–`4123` and `4199` as
reference-only, twenty-four rows of "the fork does not have this". Sixteen of
them the fork does have; it builds their code strings by concatenation. What is
genuinely reference-only in the durable family is **seven** codes —
`SMITHERS4101`, `4102`, `4114`, and the four `SMITHERS420x` — and they are not
tabled individually here because §20 already scores the whole area as
overwhelmingly uncovered for a structural reason (three of the four compilation
phases have no channel through this harness), which dominates any per-code
verdict.

**What this section is not.** It is not a claim that the fork is wrong. It is a
claim that **nobody knows**, and that the corpus is built so that nobody can find
out. Each row is one small case away from an answer: write the program, declare
the reference's code, mark it `xfail go` with the reason. Either the marker is
the finding, or the fork surprises us and the marker retires — and in both
outcomes the zero on the scoreboard is worth more than it is today.
`SMITHERS1708` is the worked example of the third outcome, which this page had
not anticipated: **the fork surprises us and the case must not be written at
all**, because the reference is the one with the limitation.

**And the set this section measures is not the whole blind spot.** Code-set
subtraction only finds rules one implementation spells and the other does not.
It cannot find a rule both implementations *have* and one of them fails to reach
— which is what the re-export finding turned out to be, and what **all four of
this revision's new markers** turned out to be. The fork owns `SMITHERS3001`,
owns the `TypeScript` classification of `eval`, and charges it inside an
immediately-invoked function and inside a `Layer.provide` callback; it simply
never asks which value reaches a call whose selected signature has no body, never
walks the load graph past the first link, and lets a capability an author spells
`TypeScript` subtract the built-in requirement. Four fail-opens, one code,
invisible to every command printed above. That is why the section after this one
exists, and why it is the one to read first.

---

## Rules both implementations have and no case probes

This is the second subtraction, added a revision ago and **recomputed from a
corrected method this revision**. It is the one that would have caught the
`SMITHERS1507`/`SMITHERS1508` error a revision earlier — and it is now nearly
twice the size the old method could see.

> [!IMPORTANT]
> **Re-derived 2026-08-26, and the flag below is now resolved.** The block that
> follows is kept because its *reasoning* still holds, but its three numbers are
> superseded by the derivation at the end of this section. The short version:
> the subtraction was comparing sets from different code families. Read to
> "Corrected derivation" before quoting any figure from here.

```sh
comm -12 /tmp/ref-codes /tmp/fork-codes > /tmp/both-codes   # 104  (superseded: 88)
comm -23 /tmp/both-codes /tmp/corpus-codes                  #  27  (superseded: 19)
```

The reference and the fork spell **104** codes in common (recorded as 85 last
revision, by the wrong command). The corpus declares 77, and **all 77** are in
that intersection — last revision's odd one out, `SMITHERS5218`, is in the fork
now, which is why its marker retired. So 104 − 77 = **twenty-seven** codes are in
both implementations and in no case:

```
SMITHERS1901 SMITHERS1902 SMITHERS3006
SMITHERS4100 SMITHERS4103* SMITHERS4104 SMITHERS4105 SMITHERS4107* SMITHERS4108
SMITHERS4109 SMITHERS4110 SMITHERS4111* SMITHERS4112* SMITHERS4113 SMITHERS4115
SMITHERS4116 SMITHERS4117 SMITHERS4118 SMITHERS4119 SMITHERS4120 SMITHERS4121
SMITHERS4122 SMITHERS4123 SMITHERS4199
SMITHERS5215 SMITHERS5216 SMITHERS5217
```

*`SMITHERS4103` left the set in the revision that wrote this block, and
**`SMITHERS4107`, `SMITHERS4111` and `SMITHERS4112` left it on 2026-08-26**; all
four are listed above only so the shape of the durable block stays readable. The
machine-computed set is the other 23.

**The headline `twenty-seven` above is now stale and this revision could not
re-derive it honestly, so it is flagged rather than adjusted.** The corpus half
of the subtraction is exactly recomputable and does not reproduce: parsing every
expectation gives **76** distinct declared codes today (73 before this
revision's three), where the paragraph above says 77. The intersection half
(`104`) depends on how the fork's *constructed* codes are extracted — the fork
builds several by concatenating a prefix with a digit suffix — and a
straightforward reconstruction of that extraction here produced 91, not 104, so
the two numbers are not comparable and no arithmetic over them would mean
anything. What IS certain and is what this table is for: three codes that were in
the set are now declared by cases green on both backends. Whoever next runs the
two `grep`s should record the exact commands beside the numbers so the third
person does not have to guess at them. The corpus half re-derives with:

```sh
python3 -c 'import json,pathlib;print(len({d["code"] for p in pathlib.Path("conformance/corpus").rglob("*.expected.json") for d in json.loads(p.read_text()).get("diagnostics") or []}))'
```

### Corrected derivation (2026-08-26)

The previous revision could not re-derive `104 − 77` and flagged it rather than
adjusting it. That was the right call, and the reason it never reproduced is
this: **the two halves of the subtraction were drawn from different code
families.** The corpus declares codes from three — `SMITHERS`, the comptime
frontend's `VCT`, and TypeScript's own `TS` — so the 76 (then 77) declared codes
were being subtracted from an intersection that only ever contained `SMITHERS`.
Seven of them (`TS2304`, `TS2339`, `TS2345`, `TS7053`, `VCT1004`, `VCT1005`,
`VCT1012`) could never have appeared in it. The fork's half was wrong for a
second, unrelated reason: **18 of its codes are never spelled literally**, being
built as `durableCode("NNNN")` / `d.fail(node, "NNNN", …)` against the
`durableDiagnosticPrefix` constant (`compiler/forkbridge/durable.go.txt:28`), so
a `grep` for `SMITHERS[0-9]{4}` cannot see them.

Both halves are now extracted the same way, over the same family. These are the
exact commands, run from the repository root, as the previous revision asked:

```sh
# the reference's SMITHERS code space
grep -roh 'SMITHERS[0-9]\{4\}' poc/src src | sort -u > /tmp/R                      # 109

# the fork's: literal spellings UNION the codes it constructs from a bare suffix
{ grep -roh 'SMITHERS[0-9]\{4\}' compiler/
  grep -rhno 'durableCode("[0-9]\{4\}")'        compiler/forkbridge/durable.go.txt |
    grep -o '[0-9]\{4\}' | sed 's/^/SMITHERS/'
  grep -rhno 'fail([^,]*, *"[0-9]\{4\}"'        compiler/forkbridge/durable.go.txt |
    grep -o '"[0-9]\{4\}"' | tr -d '"' | sed 's/^/SMITHERS/'
} | sort -u > /tmp/F                                                              # 111

# the corpus, restricted to the same family
python3 -c 'import json,pathlib
s={d["code"] for p in pathlib.Path("conformance/corpus").rglob("*.expected.json")
   for d in json.loads(p.read_text()).get("diagnostics") or []}
print("\n".join(sorted(s)))' | grep '^SMITHERS' > /tmp/C                          #  71

comm -12 /tmp/R /tmp/F > /tmp/B          # in both implementations               #  90
comm -13 /tmp/B /tmp/C                   # declared but outside the intersection # NONE
comm -23 /tmp/B /tmp/C                   # in both, and in no case               #  19
```

**90 − 71 = 19**, and the second `comm` is the check that makes the subtraction
mean something: every code the corpus declares really is inside the
intersection, so nothing is being subtracted that was never there. The 19:

```
SMITHERS1901 SMITHERS1902
SMITHERS4100 SMITHERS4104 SMITHERS4105 SMITHERS4108 SMITHERS4109 SMITHERS4110
SMITHERS4113 SMITHERS4115 SMITHERS4116 SMITHERS4117 SMITHERS4118 SMITHERS4119
SMITHERS4120 SMITHERS4199
SMITHERS5215 SMITHERS5216 SMITHERS5217
```

### Re-derived a SEVENTH time on 2026-08-27 (the durable-projection revision) — **the figure MOVED, and the command is wrong in a second way**

**This is the first revision in which the subtraction moves.** It is also the
revision that found the recorded command counting a code the fork does not
report, and missing three the fork does. Both are written out below, prediction
first, because the prediction was right about the substance and wrong about two
of the inputs, and the reason it was wrong is the finding.

*Prediction, stated and written to disk before any command was run.* This lane
writes four corpus cases and changes no implementation, so R, F and the
intersection should not move at all: **R = 111, F = 113, B = 92, unchanged**. The
corpus half gains exactly one code — `SMITHERS4110`, declared by a case for the
first time — so **C = 73 → 74**, the second `comm` stays empty, and
**92 − 74 = 18**: the figure moves, 19 → 18, for the first time in six
derivations, and the code that leaves is precisely the one the *fifth* axis
(SURFACES) said was invisible.

*Measurement, running the three commands above verbatim from the repository
root.* **R = 111 (as predicted), C = 74 (as predicted), second `comm` empty (as
predicted) — but F = 114, B = 93, and the subtraction printed 19, not 18.**
Reporting that as "unchanged at 19" would be false, because the nineteen are
**not the same nineteen**: `SMITHERS4110` left the set, and `SMITHERS4121`
entered it.

**`SMITHERS4121` entered because a COMMENT mentions it.** The fork does not
report `SMITHERS4121` anywhere the recorded command can see; the only literal
occurrence of that string under `compiler/` is inside a comment in
`compiler/fork_durable_projection_test.go` — an *untracked* Go test written by
the two implementation lanes that closed the fail-opens this revision's cases
pin — explaining that the subset refuses `fanOut` and `loopWhile` wholesale. The
first of the three `grep`s reads literal `SMITHERS[0-9]{4}` over the whole
`compiler/` tree, tests and comments included, so **a code a comment MENTIONS is
counted as a code the fork SPELLS**. Re-running the identical commands with that
one file excluded gives **R = 111, F = 113, B = 92, C = 74, second `comm` empty,
subtraction = 18** — the prediction, exactly.

**And the same probe found the corrected derivation's own extraction still
incomplete.** The 2026-08-26 correction says the fork's codes are built as
`durableCode("NNNN")` or `d.fail(node, "NNNN", …)` and adds a `grep` for each.
There is a **third** spelling, and §20 of this very page already names it:
`compiler/forkbridge/durable.go.txt:745-748` builds four codes from a
`suffix:` field on a table of unsupported constructs — `4117` (`fanOut`), `4121`
(`loopWhile`), `4122` (`waitBroadcast`), `4123` (`dequeue`). Neither of the two
constructed-code `grep`s sees them:

```sh
grep -oh 'suffix: *"[0-9]\{4\}"' compiler/forkbridge/durable.go.txt |
  grep -o '[0-9]\{4\}' | sed 's/^/SMITHERS/'          # SMITHERS4117 4121 4122 4123
```

Of those four, only `4117` was ever in the set, and **only by luck**:
`compiler/fork_durable_test.go` happens to spell it out. `4122` and `4123` are
spelled literally nowhere under `compiler/` at all. So the subtraction has been
**undercounting by three** for as long as the corrected derivation has been in
use. With the third `grep` added and the untracked test excluded: **R = 111,
F = 116, B = 95, C = 74, second `comm` empty, subtraction = 21.**

**Three readings, one movement.** Under the recorded method with the
contamination removed the figure is **19 → 18**; under the corrected method it is
**22 → 21**; under the verbatim command it prints 19 both times but over a
changed set. **The delta attributable to this lane is −1 under every reading, and
the code is `SMITHERS4110` under every reading.**

```
SMITHERS1901 SMITHERS1902
SMITHERS4100 SMITHERS4104 SMITHERS4105 SMITHERS4108 SMITHERS4109 SMITHERS4113
SMITHERS4115 SMITHERS4116 SMITHERS4117 SMITHERS4118 SMITHERS4119 SMITHERS4120
SMITHERS4121 SMITHERS4122 SMITHERS4123 SMITHERS4199
SMITHERS5215 SMITHERS5216 SMITHERS5217
```

**Why it moved, plainly: the fifth axis's debt was paid, and it is the only one
of the five that a corpus lane could pay.** The SWALLOW revision recorded
`SMITHERS4110` as the case where "the table cannot count SURFACES" — the rule was
in both implementations and in no case, and the corpus **could not reach it at
all**, because the fail-open then depended on a legacy `Action.define` artifact
that arrives only through `smithers plan --bindings` and the corpus route supplies
no bindings. Two implementation lanes then moved the same rule onto a surface the
corpus does reach: the Flow-output projection on the fork, and the Action **input**
projection on both. A `.sm` file with no bindings at all now reaches
`SMITHERS4110` on both backends at the same code, line, column and sentence, and
four cases declare it. That is the axis closing rather than another instance of
it, and it is worth separating from the four axes that remain open: spellings,
same-revision arrivals, distance, and sites are all still uncounted.

**The sixth axis is a different kind of thing and it is about the INSTRUMENT, not
the corpus.** The first five say what the subtraction cannot see about the
implementations. This one says the subtraction **misreads its own inputs**: it
extracts codes by matching text over whole directories, so it cannot tell a code
an implementation *reports* from a code a comment *mentions*, and it does not
know every way an implementation *spells* one. Both halves are exposed —
`grep -roh 'SMITHERS[0-9]\{4\}' poc/src src` reads the reference's directories
the same way — and today the fork's half is additionally sensitive to an
**untracked** file in someone's working tree, which is not a property any
recorded figure should have. Anyone quoting this number should run the three
commands **plus** the `suffix:` grep, and should say which files were in the tree
when they did.

**Re-derived a SIXTH time on 2026-08-27 (the `SMITHERS4124` / durable
fail-open revision), and for the first time the prediction was written down
BEFORE the commands were run.** That matters here, because this revision is the
one shape that ought to move the figure and does not, and a number recorded
after the fact cannot show that its stillness was expected.

*Prediction, stated first.* `SMITHERS4124` is not a re-spelling and not a
re-probe: it is a **genuinely new code**, minted in the reference
(`poc/src/durable/source-compiler.ts`) and in the fork
(`compiler/forkbridge/durable.go.txt`, constructed as `d.fail(node, "4124", …)`
and therefore visible only to the second and third `grep`) in the same revision
that gave it a case
(`17/two-error-classes-whose-durable-identities-used-to-collide-now-compile`). So all
<!-- renamed 2026-08-28: the case turned over from a refusal to an acceptance when the identity became injective; see observation gap #15's closure note. -->
four inputs should move by exactly one — R 110 → 111, F 112 → 113, intersection
91 → 92, corpus 72 → 73 — the second `comm` should stay empty, and
**92 − 73 = 19**: unchanged, same nineteen codes.

*Measurement, running the three commands above verbatim from the repository
root.* **R = 111, F = 113, intersection = 92, corpus = 73, second `comm` empty,
subtraction = 19, and the nineteen are the same nineteen, digit for digit. The
measurement agreed with the prediction on every input and on the total.**

**And the reason is NOT a sixth axis — it is the SECOND recorded reason
recurring**, the `SMITHERS1604` shape: a rule that lands together with its case
never spends a day in this table. Saying "fifth distinct reason" here would be
the flattering reading and it would be wrong. What is new is only that the
recurrence was predicted rather than explained afterwards.

**The genuinely uncomfortable half of this revision is the OTHER change, and it
is invisible here for a reason the four recorded axes do not cover.** The same
day, `poc/src/durable/source-compiler.ts` closed a **fail-open**: `flowSchemas`
caught every failure of its Flow-success descriptor walk and, if the Flow used
any legacy `Action.define` artifact at all, discarded it and compiled the Flow
with a weaker `json-value` success contract and **no diagnostic** — so a Flow
projecting a field its output genuinely does not have compiled clean and then
faulted at run time as a `ProjectionDefect`. The refusal it now reports is
`SMITHERS4110`, which is **one of the nineteen above**: in both implementations,
probed by no case. The figure could not move, because the corpus half could not
move, because **the corpus cannot reach this rule at all** —
`conformance/runner/js-lower.mjs:309` calls `compileDurableSource` with **no
descriptor bindings**, so every Action in a `.sm` case is same-file and
structural, and the legacy artifact the fail-open depended on can only arrive
through `smithers plan --bindings <actions.json>` (`src/cli.ts:2023`). A fifth
axis, if anyone wants to name it: **the table cannot count SURFACES.** A rule
that is only reachable through an entry point the corpus does not use is
invisible to both halves of the subtraction at once, and its code can sit in the
nineteen looking like an ordinary unprobed rule while the behaviour underneath
it changes from accept to refuse.

**Re-derived a FIFTH time on 2026-08-27 (the capability-argument revision), by
running the three commands above verbatim from the repository root. NOTHING
moved, and this time not one input moved either: R = 110, F = 112, intersection
= 91, corpus = 72, second `comm` empty, subtraction = 19, and the nineteen codes
listed above are the same nineteen — identical to the closure-backlog
re-derivation immediately below, digit for digit.**

**This is the fourth consecutive revision in which the subtraction stands still,
and the fourth DIFFERENT reason, which is the finding.** The first three were:
the defects were *spellings* (round 7 — `eval` through a shorthand property, a
`context` key through a `const` alias, a trust marker inside a `//` comment); a
code entered both implementations and the corpus in the same revision and never
spent a day in this table (`SMITHERS1604`); and the table cannot count *distance*
(the closure revision — the rule was probed, at depth 1, while the hole was at
depth ≥ 2). **This revision's reason is a fourth axis: the table cannot count
SITES.** The five cases declare exactly three codes — `SMITHERS2101`,
`SMITHERS2104` and `SMITHERS1503` — and every one was already declared by other
cases before this lane: 8, 4 and 3 of them respectively, verified by parsing the
expectations rather than by reading them. Both implementations already spelled
all three. Neither half of the subtraction could move. And yet
`SMITHERS2106`'s resolution rule was **correct at the `X.context()` receiver and
absent one argument over**, at `Layer.succeed`'s first parameter, where one
backend fail-opened into a runtime panic and the other published a phantom
requirement row; and `SMITHERS1503`'s placement boundary was **correct at a
call expression and absent at a tagged template**, which both backends accepted.
A rule that is right at one site and missing at the next site is one code, two
implementations and a green corpus away from invisible — and unlike a spelling,
the two sites are not even the same *syntactic category*: a
`TaggedTemplateExpression` is not a `CallExpression`, and `Layer.succeed`'s
capability argument is not its layer argument.

**So the reading is now four-for-four, and the figure to watch is still not this
one.** Backend agreement moved 480/498 → **485/503**, by exactly the five cases;
the case count moved 498 → 503. Anyone auditing this page by the subtraction
alone has now seen four revisions of real defects — a fail-open that panicked at
run time among them — pass underneath a number that did not move by one.

**Re-derived a fourth time on 2026-08-27 (the closure-backlog revision), by
running the three commands above verbatim from the repository root, and NOTHING
moved: R = 110, F = 112, intersection = 91, corpus = 72, second `comm` empty,
subtraction = 19, and the nineteen codes below are the same nineteen.** Saying so
plainly is more informative than the figure. The five cases this revision added
declare exactly **one** diagnostic code between them, `SMITHERS1510`, and
twenty-one cases that are not this lane's already declare it — verified by parsing
the expectations rather than by reading them. So the corpus half of the
subtraction could not move, and neither implementation half moved either, because
the defect the five cases pin was **not a missing rule**: `SMITHERS1510` was
implemented, documented, and carried five cases while a foreign module reached at
depth two behind a properly marked relay ran its untrusted initializer on both
backends. This is the third revision running in which the subtraction stands still
for the same structural reason — **it counts codes, not spellings, and it cannot
count depth at all.** A reader who watches this figure alone sees a revision in
which nothing happened; the figure that moved is backend agreement, 475/493 →
480/498, and it moved by exactly the five cases, because before them **no case in
the corpus exercised a depth-≥2 foreign edge**, so closing 58 measured
divergences on the two implementations moved the scoreboard not at all. That is
the sharpest illustration this page has of its own blind spot, sharper than round
7's: there the rules were probed at the wrong spelling; here the rule was probed
at the wrong *distance*, and the corpus reported `0 divergent` throughout.

**Re-derived a third time on 2026-08-27 (the round-7 backlog revision), by
running the three commands above verbatim from the repository root. The
subtraction did not move — it is still 19 and still the same nineteen codes — but
this time EVERY INPUT moved by exactly one: R = 109 → **110**, F = 111 → **112**,
intersection = 90 → **91**, corpus = 71 → **72**, second `comm` still empty.** The
one code is `SMITHERS1604`, dynamic code evaluation: two lanes implemented it in
the reference and the fork on 2026-08-27 and a third replaced
`18/eval-is-usable-and-not-forbidden` with a case that declares it, so it entered
both implementations and the corpus in the same revision and never spent a day in
this table. That is the shape the requirement-row revision two paragraphs down
already described, seen again — a rule that lands with its cases is invisible
here by construction.

**The twenty-eight cases this revision added declare no code the corpus did not
already declare**, verified by parsing their expectations rather than by reading
them: the seven codes across all twenty-eight are `SMITHERS1103`, `1104`, `1503`,
`1510`, `1602`, `1604` and `2102`, and every one is declared by at least one case
that is not mine. So the subtraction is exactly as blind to this revision as it
was to the last one, and for the same reason stated below: **it counts codes, not
spellings.** That limit is now worth more than the number, because round 7 is the
strongest evidence for it this page has. Eleven defects were found in one day.
Every one of them lived at a code that already had cases — `SMITHERS1510` had
five, `SMITHERS2102` had a dozen, `SMITHERS1602` had four — and every one of them
was invisible to a 465-case corpus reporting `0 divergent`, because what was
missing was a case at the SPELLING where the rule was broken: `eval` reached
through a shorthand property, a `context` key reached through a `const` alias, a
trust marker inside a `//` comment, a NO-BREAK SPACE between two braces. Two of
those classes were shared by BOTH implementations, so no divergence could ever
have existed to report. **A reader who watches this figure alone will see round 7
as a week in which nothing happened.** Read it alongside the case count and the
backend-agreement figure at the top of this page, which moved 447/465 → 475/493.

**Re-derived on 2026-08-27 (the round-6 backlog revision), by running the
three commands above verbatim from the repository root, and it did not move at
all: R = 109, F = 111, intersection = 90, corpus = 71, second `comm` empty,
subtraction = 19, and the nineteen codes below are the same nineteen.** That is
the correct answer and it is worth saying why, because a reader who sees
twenty-seven cases land and this number stand still will otherwise assume the
page went stale again. **This revision added no diagnostic code to the corpus.**
All twenty-seven cases declare codes the corpus already declared — `SMITHERS1101`,
`1207`, `1301`, `1303`, `1504`, `1506`, `1507`, `2101`, `2102`, `2104`, `2107` —
because the rules were never the thing missing. What was missing was a case at the
*spelling* where each rule was broken, and this table cannot see that distinction:
it counts codes, not spellings, so a family with one case and a family with
fourteen look identical to it. **That is a real limit of this subtraction and it
should be read alongside the count, not instead of it.** `SMITHERS2104` had
exactly one case before this revision and has three now; the code was never in the
nineteen either way. The counterfactual the previous revision recorded — run the
subtraction against a corpus without the two cases that landed with their rule and
it returns 21 — is the only way this table shows work, and it shows nothing this
time by construction.

**Re-derived on 2026-08-26 (the requirement-row revision), and the way it
moved is the interesting part.** Every input grew and the answer did not: the
reference went 107 → **109**, the fork 109 → **111**, the intersection 88 → **90**
and the corpus 69 → **71**, while the subtraction stayed **19** and the nineteen
codes are the same nineteen. That is not the set standing still. `SMITHERS2106`
(an ambiguous `X.context()` receiver) and `SMITHERS2107` (a detached reference to
the compiler-recognized `Context.context`) were implemented in both backends and
pinned by cases **in the same revision**, so they entered the intersection and
left it in one step and never spent a day in this table. Run the same subtraction
against a corpus without those cases and it returns **21**, naming both — which
is the counterfactual worth recording, because it is the only way to see work
this table is designed not to show. A rule that lands with its cases is invisible
here by construction; a rule that lands without them is what this section is for.

Two caveats a reader should carry away rather than the number alone.

**`SMITHERS1901` and `SMITHERS1902` are in that list for a bad reason, not a
coverage reason.** In the fork they are comptime rules that the judge translates
to `VCT1001`/`VCT1002`, both of which the corpus *does* declare — so as comptime
rules they are probed. In the reference the same two numbers are the formatter's
overlapping-mask and overlapping-edit rules, which are genuinely unprobed and
genuinely unreachable from the harness (the formatter lives behind the
`smithers format` subcommand, never `compileProject`). One number, two rules,
two different verdicts. That collision was load-bearing in the judge until
2026-08-26 — see `runner/selftest.mjs`, "the comptime code alias is scoped to
the fork" — and it is the reason this section now says which family it is
counting in every command.

**The `VCT` family was never in this arithmetic at all.** The reference spells
**36** `VCT` codes; the corpus declares **3**. Those 33 are not in the list above
and never were, because the subtraction is over `SMITHERS`. They are not
directly comparable — the fork implements comptime under its own numbering — but
recording the shape here is honest, where silently omitting a whole diagnostic
family from a coverage figure is not.

---

**The set moved for three unrelated reasons at once, and separating them is the
point of this paragraph.** Four codes left it because this revision wrote their
cases (`1503`, `1713`, `2103`, `3005`, plus `4103`). One left it because it was
never in it (`1708` — see the previous section). And **twenty entered it because
the method was corrected**: the whole durable family the old grep could not see.
The headline number went 13 → 27, and none of that movement is either
implementation getting worse.

**Why this set is worse than the reference-only one.** A reference-only rule at
least produces a *divergence* the moment someone writes a case: one backend
refuses, the other does not, and the runner says so. A rule both backends have
and no case probes produces nothing at all, in either direction, ever. If either
implementation lost it tomorrow the scoreboard would not move, and if both lost
it the differential oracle would report perfect agreement. `SMITHERS1507` and
`SMITHERS1508` sat in exactly this set while this page recorded them as covered,
and `SMITHERS3005` — the gate on the best-covered area on this page — sat in it
until this revision.

| code | what it rejects | reference site | status |
| --- | --- | --- | --- |
| `SMITHERS1503` | `panic(...)` outside an expression statement or direct return | `poc/src/language/semantic.ts:1836` | **WRITTEN this revision** — `09-foreign-calls/panic-outside-a-statement-or-return-is-rejected`, green on both. Its accepted twin (`explicit-panic-charges-the-channel`) uses the supported placement, so the pair separates the channel rule from the placement rule. |
| `SMITHERS1713` | an async `errdefer` that directly returns a Promise before its Result can be inspected | `poc/src/language/semantic.ts:3680-3686` | **WRITTEN this revision** — `10-defer/async-errdefer-cannot-inspect-a-directly-returned-promise`, green on both. This is the "narrower program" 14.7 said was needed: the neighbouring shapes reach `SMITHERS1402`/`1712` first and mask it. |
| `SMITHERS2103` | a `Layer.provide` callback that does not resolve to a checked local function | `poc/src/language/semantic.ts:2692` | **WRITTEN this revision** — `06-layers/a-provide-callback-that-is-not-a-local-function-is-rejected`, green on both. It is the "what is required" half of *knowing the complete closure*; `SMITHERS2104` (`opaque-layer-is-rejected`) is the "what is provided" half. |
| `SMITHERS3005` | `native(...)` given something that is not one reference to a function declared in this project | `poc/src/targets/classify.ts:1214` | **WRITTEN this revision, both branches** — `21-native-pin/a-pin-whose-argument-is-not-a-project-function-is-rejected` (at the argument) and `a-pin-given-two-arguments-is-rejected` (at the call). Both green on both. One case would have pinned one branch and left the other free, which is how a backend comes to own half of a code. |
| `SMITHERS4103` | a `durable(...)` argument that is not inline or statically resolvable | `poc/src/durable/source-compiler.ts:700`, `:705`, `:709`, `:724` | **WRITTEN this revision** — `17-durable/an-opaque-durable-argument-is-rejected`, green on both. It pins obligation **20.5**, which §20 named as the highest-value reachable durable gap, and it is the durable area's exact analogue of `SMITHERS3005`. The corpus now declares **two** durable diagnostics rather than one. Its sibling branch (wrong argument count, reported at the call) is still unwritten. |
| `SMITHERS1901` | the source does not parse after Smithers masking, so nothing is rewritten | `poc/src/language/format.ts:66` | **not writable here.** Formatter diagnostics, and the corpus has no formatter channel — the harness compiles and runs, it does not format. §21 is where the formatter is scored. |
| `SMITHERS1902` | the formatted result would not round-trip the authored token stream | `poc/src/language/format.ts:68` | same. |
| `SMITHERS3006` | the retired `/** @native */` JSDoc marker | `poc/src/targets/classify.ts:830` (the page said `:449` for three revisions; that line no longer holds the rule) | **not writable — severity is `"warning"`.** See observation gap #11: the harness filters to `severity === "error"` on both backends, so a warning cannot be observed at all. This one is *uncoverable*, not merely uncovered. |
| `SMITHERS4100` | reference: any diagnostic the durable source's own check produced. fork: a `.run` input that is not assignable to the Action's checked input contract | ref `poc/src/durable/source-compiler.ts:2566`; fork `compiler/forkbridge/durable.go.txt:729` | **measured this revision and deliberately not written: the two implementations mean different things by this number.** The reference's `SMITHERS4100` is a *wrapper* that re-emits the first checker diagnostic of the durable source with the checker's own message and position; the fork's is one specific assignability rule. They may coincide on an input-mismatch program and may not, and a case would pin whichever reading its author guessed. Named here so whoever owns the durable bridge can settle it, rather than guessed at. |
| `SMITHERS4117` | reference: a `fanOut` argument that is not one inline synchronous single-parameter arrow. fork: `fanOut` is not implemented by the Go durable subset at all | ref `poc/src/durable/source-compiler.ts:1690`, `:1703`; fork `compiler/forkbridge/durable.go.txt:562` | **measured this revision and deliberately not written: same problem as `4100`, one step worse.** The reference reports on the malformed arrow; the fork reports on the `fanOut` call, for *any* `fanOut`. A program malformed enough to reach the reference's rule reaches the fork's blanket refusal at a different node, so the case would be a position divergence dressed as a rule. |
| `4104`, `4105`, `4108`–`4110`, `4113`, `4115`, `4116`, `4118`–`4120`, `4199` | the rest of the durable template-compilation subset | `poc/src/durable/source-compiler.ts`; `compiler/forkbridge/durable.go.txt` | **still the largest single block in this table, and three codes smaller than a revision ago.** It read "nineteen codes both implementations spell, none probed"; **`4107`, `4111` and `4112` left the set on 2026-08-26** when §20's twelve refusal cases landed, each measured green on **both** backends at the identical code and authored position. **Twelve remain in this row, and fourteen `41xx` codes remain in the set** once `4100` and `4117` — the two rows above, where the implementations do not mean the same rule — are counted back in. (This cell said "Sixteen remain" and enumerated `4118`–`4123` until the 2026-08-26 requirement-row revision re-ran the subtraction: `4121`, `4122` and `4123` are **not** in the derived set and appear nowhere in it, so the prose count and the code list had drifted apart from each other as well as from the derivation. Corrected against the machine-computed list rather than by arithmetic on the old sentence.) They are reachable from phase 1, which is the phase the corpus does reach — see §20's closing paragraph, which names 20.8/20.9/20.11/20.13/20.14/20.21/20.25 as the obligations behind them. This is still where the next revision buys the most. |
| `SMITHERS5215` | one path being both a compiler asset module and an authored/runtime code module | `poc/src/build/source-assets.ts:1150`, `:1161`, `:1198`, `:1328` | **measured a revision ago and deliberately not landed.** Reachable on the reference — a `.ts` file staged through the `assets` channel and also imported as code reports `SMITHERS5215@1:20` — but the fork reports `SMITHERS5209` at the same position instead ("asset must be a staged regular file beneath the project root"). Whether that is a fork defect or a consequence of the two-kinds wire protocol (gap #3: an asset crosses as `"typescript"`, so the fork cannot tell a staged asset from a staged code file) **cannot be decided from the conformance side**. Re-checked this revision: unchanged. |
| `SMITHERS5216` | a generated asset identity colliding with a real path | `poc/src/build/source-assets.ts:1282` | **not writable.** Requires a real file at `.smithers-generated/assets/<digest>.ts` inside the project root; the staged path is derived from the asset's content digest, so a case would have to hard-code a digest and would break the moment the fixture's bytes changed. |
| `SMITHERS5217` | a generated-module construction failure | `poc/src/build/source-assets.ts:1291` | **not usefully writable.** It carries a third party's exception text and is reached only when `generatedModule(build)` throws, which the built-in loaders do not do for any input a case can stage. The neighbouring `SMITHERS5213` covers the reachable half of "the loader failed" and is pinned. |

**Fourteen of the nineteen are the durable block** — twelve in the
template-compilation row above plus `4100` and `4117` — and they are writable
today in the sense that the corpus reaches the phase that emits them; the three
that left on 2026-08-26 prove it, since each one's case was written from the
specification and was green on both backends the first time it ran. Of the
remaining five, **two are uncoverable by construction** (`1901`, `1902`, the
formatter's own rules, reachable only through `smithers format`) and **three are
unwritable for a recorded mechanical reason** (`5215`, `5216`, `5217`). Two of
the fourteen — `4100` and `4117` — are the category the previous revision had to
open: **codes both implementations spell where the two implementations do not
agree on what the code means.** A subtraction over code *numbers* cannot see
that, and it is the next thing this page's method will have to grow.

**This paragraph itself was corrected on 2026-08-26 by the requirement-row
revision, and the correction is a worked example of the hazard the section
opens with.** It read "Sixteen of the set are the durable template-compilation
block" and "Three of the remaining eight are uncoverable by construction
(`1901`, `1902`, `3006`)" — but the machine-computed list has **fourteen** `41xx`
codes, not sixteen, and does **not contain `SMITHERS3006` at all**: `3006` is
reference-only *and* has severity `"warning"`, so it is named in the table above
as uncoverable without ever being a member of this set. Sixteen + eight = 24,
against a stated total of 19, and nobody added them up for a revision. The
numbers here are now taken from the `comm -23` output rather than by arithmetic
on the previous sentence; if this prose and the derivation ever disagree again,
**the derivation is right and this is the stale copy.**

---

## 1. Identity and compatibility

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 1.1 | Smithers source uses `.sm` | DECISIONS Locked | covered | structural: the corpus is `.sm` only and the Go bridge rejects anything else |
| 1.2 | `.sm` uses a TypeScript-derived grammar with only documented differences | compatibility.mdx §Source Relationship | covered | the whole corpus; `conformance/interop/*` pins the `.ts` side; **`22/non-ascii-string-content-round-trips`** pins that source text outside ASCII survives lowering |
| 1.3 | `.ts`/`.tsx`/JS keep their own complete syntax and behavior when imported | compatibility.mdx §Source Relationship | covered | `interop/*` (6 files), all of `09-foreign-calls` |
| 1.4 | shared syntax keeps TypeScript behavior unless a divergence is documented | compatibility.mdx §Source Relationship, DECISIONS Locked | covered | `11/statement-switch-keeps-typescript-fallthrough` (TS2678), `11/statement-switch-fallthrough-over-a-widened-scrutinee`, **`19/retired-clause-words-in-type-positions-stay-ordinary`** (`?:`, `??`, `?.` keep their TypeScript meaning) |
| 1.5 | adding expression forms MUST NOT reinterpret an existing TypeScript statement | control-flow.mdx §Existing TypeScript Forms | covered | `11/statement-if-is-not-reinterpreted-as-an-expression`, `11/statement-switch-fallthrough-over-a-widened-scrutinee`, **`19/retired-operator-words-as-members-stay-ordinary`** |
| 1.6 | TypeScript escape hatches stay available on the TypeScript target | compatibility.mdx §Source Relationship, DECISIONS Locked | **covered for `any`; for `eval` the corpus now contradicts the specification on purpose, and the sentence needs amending** | `18/any-is-usable-and-not-forbidden` is unchanged and still passes. **The citation this row carried for three revisions — `18/eval-is-usable-and-not-forbidden` — names a case that no longer exists.** It was replaced on 2026-08-27 by `18/eval-cannot-be-described-by-a-row-and-is-refused` (`SMITHERS1604@5:13`), whose own `notes` carry the full argument and which is where the open question is recorded rather than here. The short form: `compatibility.mdx` §Dynamic Features says "`any` and `eval` remain usable… the language does not forbid them", and two `MUST`s in the same document were being violated by the escape it permitted — `eval("process.platform")` returned the host platform and `eval("Date.now()")` read the clock, both with `failures: []` and `requirements: []`, on **both** backends. A `MUST NOT` outranks a permission, so the escape was closed and the permissive sentence is the one that has to move. **The `any` half of the sentence is unaffected**, which is why the two cases were split rather than retired together. The rule is narrower than "eval is forbidden" — the NAME resolves, the OPERATION is refused — and the guard that keeps it narrow is `20/the-function-type-and-prototype-test-stay-available` (9.1d). |
| 1.7 | **the retired-grammar sweep is a grammar rule, not token adjacency** | poc README ("Recognition is a **grammar** property"); compatibility.mdx §Source Relationship | covered | **`19/retired-operator-words-as-members-stay-ordinary`**, **`19/retired-clause-words-in-type-positions-stay-ordinary`** — the other half of §16. Nine cases pin that each retired form *is* rejected; these two pin that ordinary TypeScript reusing those words is *not* claimed, which is the false-positive direction a textual sweep fails in. |

## 2. Function model and Result lifting

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 2.1 | a fallible function returns `Result<A, E>`; a fallible async one `Promise<Result<A, E>>` | failures.mdx §Result Model | covered | `01/inferred-result-for-an-unannotated-function`, `08/async-unwrap-propagates-across-await` |
| 2.2 | `return value` produces the success variant | failures.mdx §Compiler Lifting | covered | `01/return-lifts-into-success` |
| 2.3 | `throw error` produces the error variant and exits | failures.mdx §Compiler Lifting | covered | `01/throw-lifts-into-failure` |
| 2.4 | returning an existing compatible Result preserves it without nesting | failures.mdx §Compiler Lifting | covered | `01/returning-an-existing-result-preserves-it`, `19/result-nesting-remains-rejected` |
| 2.5 | `Result.ok` / `Result.err` are not authoring API | failures.mdx §Compiler Lifting | **covered at the authored spelling and at the module edge; NOT at the compiler's own constructors — see observation gap #13** | `01/result-ok-is-not-an-authoring-constructor` (the dotted spelling), `01/a-computed-result-ok-is-a-compiler-hook` (the element-access spelling, which is the same resolved symbol). The sentence also forbids reaching the constructors the compiler *does* use, and the corpus pins the **module edge** to them on both backends: `01/the-compiler-owned-prelude-is-not-reachable-by-a-path` (`SMITHERS1510@1:23`, a *sanctioned* binding through the forbidden path, so the case is about the path alone) and `01/a-star-re-export-of-the-compiler-owned-prelude-is-refused` (`SMITHERS1510@1:15`, the spelling that names no binding, which no binding rule can see). Their over-correction guards are `01/the-compiler-owned-modules-still-serve-their-authoring-surface` — `Context`, `Layer` and `panic` must still work, so the program has to RUN — and `01/a-local-class-named-after-a-compiler-constructor-is-ordinary`, which stops the rule being implemented as a token filter. **What is NOT covered** is the constructor reached through a *sanctioned* specifier, which each backend closed on 2026-08-25 and which the case format cannot express, because the two backends' constructors have different names. |
| 2.6 | compiler-owned `Optional<T>` and its constructors are absent | type-system.mdx §Absence | covered | `19/builtin-optional-is-unresolved` |
| 2.7 | a function with no fallible path is not wrapped in a Result | failures.mdx §Compiler Lifting; compatibility.mdx §TypeScript Target | covered | `01/plain-function-keeps-javascript-throw`, `08/infallible-async-returns-a-plain-promise` |
| 2.8 | an explicit non-Result annotation over a reachable Error exit is a compile error | failures.mdx §Compiler Lifting; type-system.mdx §Fallibility Inference | covered | `01/contract-omits-reachable-failure`, `19/bang-return-marker-is-retired` |
| 2.9 | public/abstract/declaration-only contracts spell `Result` directly | failures.mdx §Inference | covered | `01/exported-fallible-needs-result-contract` |
| 2.10 | `E` is inferred from throws, unwraps, returned Results, foreign boundaries | type-system.mdx §Fallibility Inference | covered | `01/inferred-result-for-an-unannotated-function`, `02/unwrap-joins-two-error-types-into-one-row`, `09/untrusted-foreign-call-charges-panic` |
| 2.11 | a recoverable `throw` value must extend `Error` | failures.mdx §Error Classes | covered | `01/throw-must-extend-error` |
| 2.11a | **…and the rule has to be able to RUN: deciding whether a thrown value extends `Error` climbs its base types, and that walk crashed the reference frontend on most non-`Error` operands** | failures.mdx §Error Classes; the precondition is TypeScript's own — `checker.getBaseTypes` handles a tuple, then a symbol flagged `Class \| Interface`, and `Debug.fail`s on anything else | **covered as of 2026-08-27, two cases, and both were a hard CRASH on the reference until that day** | `01/a-thrown-object-literal-is-not-a-recoverable-error` (`SMITHERS1103@2:3`) and `01/a-thrown-const-tuple-is-not-a-recoverable-error` (the same code at the same position). Two cases, not one, because there are **two distinct faults on adjacent lines** of the checker and a guard can close either alone: `throw { code: 1 }` reached `Debug.fail("type must be class or interface")`, while `throw [1, 2] as const` reached the UNGUARDED `type.symbol.flags` dereference one line earlier and died with a `TypeError`, because a tuple reference has no symbol at all. Seventeen operands were measured crashing (an object literal, an arrow, a function expression, `Object.freeze`, a `Proxy`, a getter object, alias-typed, indexed-access-typed, `Record`-typed, cast-through-`unknown`, a union of two literals, a type parameter, a `satisfies` expression, a named tuple, a `readonly` tuple, and the same inside a nested arrow and a class method) — while `throw "x"`, `throw [1]`, `throw 1` and `throw new Date()` were sound throughout, which is exactly why 2.11's single case never saw it. `throw [1]` is the sharp control: `number[]` is a reference whose symbol IS the `Array` interface, so it satisfied the real precondition and an array-throw case could have existed forever without finding this. The fix invented no diagnostic — every crashing operand already had this rule waiting for it — and the reference converged onto the fork, which reported `SMITHERS1103` here all along. The name-keyed route into the same walk is 5.x's `match` family; see `01/an-object-literal-with-a-match-method-is-not-result-match`. |
| 2.12 | a top-level `throw` cannot be represented as a checked Result | poc README SMITHERS1511 | covered | `01/top-level-throw-is-rejected` |
| 2.13 | no `throws` clause, `!T`, prefix `try`, or postfix recovery grammar | failures.mdx §Inference; DECISIONS Locked | covered | `19/throws-clause-is-retired`, `19/bang-return-marker-is-retired`, `19/prefix-try-marker-is-retired`, `19/postfix-catch-expression-is-retired` |
| 2.14 | no throw-expression grammar in the initial scope | control-flow.mdx §Throw Statements; DECISIONS Locked | covered | `19/throw-is-not-an-expression` |
| 2.15 | **functions remain ordinary and eager: no `Effect` value, interpreter, or `.run()`** | DECISIONS Locked; type-system.mdx §Function Type | covered structurally | every output case calls its functions directly and prints the result; nothing in the corpus interprets a description of work |
| 2.16 | **a fallible constructor or accessor**: the lifting rule carves out neither | failures.mdx §Compiler Lifting; type-system.mdx §Fallibility Inference ("MUST reject the function rather than permit an untyped exception path") | **covered as of the third revision, by an `xfail go` documentation-gap marker — see §7.28** | The reference rejects with `SMITHERS1105` (`poc/src/language/semantic.ts:2038`). The fork's code set has neither code (`grep -roh 'SMITHERS[0-9]\{4\}' compiler/`), and `compiler/forkbridge/lowering.go.txt:2264-2275` implements the `SMITHERS1101/1104/1102` siblings in one block with no 1105 next to them. 79 corpus cases declare a `constructor(` and **none of them is fallible** (`grep -rl 'constructor(' conformance/corpus/ --include='*.sm' \| wc -l`). See "Reference-only rejection rules". |
| 2.17 | **a fallible generator** | same | **still uncovered in the refusal direction; the accepted direction is now pinned** | The reference defers it explicitly with `SMITHERS1106` (`poc/src/language/semantic.ts:1971`); the fork has no such code. The sentence this row used to carry — that no corpus case contains a generator at all — **is no longer true**: `09/a-generator-may-abort-with-a-panic` is the first, and it pins that a generator which aborts with `panic(...)` keeps `Generator<string>` and runs on both backends. That is the accepted half. A generator with an ordinary recoverable failure still splits the two backends exactly as §2.16 does and is not yet written. |

## 3. Result combinator surface

failures.mdx §Matching and Transformation requires operations equivalent to
`isOk isError match map mapError andThen recover tap tapError unwrapOr all`.
Every member has a case.

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 3.1 | `match` requires both success and error branches | failures.mdx §Matching | covered | `01/result-match-requires-both-branches` (TS2345, reached through the emit-check stage) |
| 3.1a | **…and `match` is not a reserved member name: an ordinary value with a member called `match` is that value's own method** | compatibility.mdx §4 (Locked) forbids invalidating TypeScript's escape hatches, and `match` is an ordinary identifier — `String.prototype.match` is in `lib.es5.d.ts` | **covered as of 2026-08-27, three cases, and all three were a hard CRASH on the reference until that day** | `01/an-object-literal-with-a-match-method-is-not-result-match` (three spellings — dotted, string-literal element access, and a `const`-aliased key — all printing the object's own return value), `01/a-frozen-object-with-a-match-method-compiles`, and `01/a-module-member-named-match-is-the-modules-own`. Three receivers, not one, because the guard that closes the crash can be written three ways and only one of them is right: an object literal has **no symbol**, `Object.freeze`'s `Readonly<T>` mapped type **has** one and is still not a class or an interface, and a module namespace object is neither while also being how `import * as lib; lib.match()` reaches the walk — so **any project with a module exporting a function named `match`, called qualified, could not be compiled at all.** Thirteen receiver kinds and all six call spellings were measured crashing. The third spelling in the first case is the round-7 intersection worth reading: the member-key rule now resolves a `const`-aliased key to the same member symbol, so `own[KEY]()` reaches this walk too and a fix keyed on `PropertyAccessExpression` would leave it crashing. The rules that must still fire were measured unchanged — `SMITHERS1251`, `1253`, `1254`, `1255` on a real `Error.match`, and `SMITHERS1206` on a retired `Result.unwrap()`. The name-independent route into the same walk is 2.11a. |
| 3.2 | `map` / `andThen` / `recover` preserve or combine the error type | failures.mdx §Matching; type-system.mdx §Result Composition | covered | `01/result-transformations-preserve-the-error-type` |
| 3.3 | `mapError` rewrites the error channel | failures.mdx §Matching | covered | `01/result-map-error-rewrites-the-error-channel` |
| 3.4 | `tap` / `tapError` observe without changing the Result | failures.mdx §Matching | covered | `01/result-tap-and-tap-error-observe-without-changing` |
| 3.5 | `isOk` / `isError` inspect the variant | failures.mdx §Matching | covered | `01/result-is-ok-and-is-error` |
| 3.6 | `unwrapOr` extracts with a fallback | failures.mdx §Matching | covered | `01/result-transformations-preserve-the-error-type` |
| 3.7 | `Result.all` collects, and reports the first error | failures.mdx §Matching | covered | `01/result-all-collects-and-stops-at-the-first-error` |
| 3.8 | `Result.try` / `Result.tryPromise` adapt a throwing/rejecting body, retaining Panic | poc README; failures.mdx §Foreign Exceptions | covered | `01/result-try-adapts-a-throwing-body`, `01/result-try-promise-adapts-a-rejecting-body` |
| 3.9 | `expect` converts the error variant into a panic on the enclosing channel | failures.mdx §Failure Propagation; poc README | covered | `01/expect-charges-the-panic-channel` |
| 3.10 | **`expect` at a non-Result boundary is visually distinct in diagnostics** | failures.mdx §Failure Propagation; poc README SMITHERS1505 | covered | `01/top-level-expect-is-rejected` — the go marker is **retired**; the fork used to accept and run this program |
| 3.11 | ordinary Result recovery MUST NOT swallow panic implicitly | failures.mdx §Foreign Exceptions | covered | `09/recover-does-not-swallow-a-panic` |
| 3.12 | exhaustive recovery MAY remove handled members from `E` | type-system.mdx §Result Composition (MAY) | covered as a MAY | `01/result-transformations-preserve-the-error-type` |

## 4. Propagation (postfix `!`)

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 4.1 | postfix `!` yields the success value or propagates the error variant | failures.mdx §Failure Propagation | covered | `02/unwrap-returns-the-error-variant`, `02/unwrap-stops-at-the-first-failure` |
| 4.2 | the propagated Result's error type joins the enclosing `E` | failures.mdx §Failure Propagation | covered | `02/unwrap-joins-two-error-types-into-one-row` |
| 4.2a | **…and it joins it through a type-only WRAPPER and through a local BINDING, which are the two spellings where the join was silently dropped** | failures.mdx §Failure Propagation joined with §Result Model (a declared `E` MUST cover every failure reachable through the function) | **covered as of 2026-08-27, three cases, both directions** | `02/a-satisfies-wrapped-propagation-charges-the-contract` and `02/a-stored-inferred-fallible-result-charges-the-contract` both declare `SMITHERS1104@9:1` — the same code and position 2.5's `01/contract-omits-reachable-failure` declares for the inline spelling — over `outer(): Result<number, Calm>` whose body can only produce `Boom`. Before the fix the reference reported **no Smithers diagnostic at all**, published the row `["Calm"]` (a failure the body cannot produce, while omitting the one it can), and let the stock check of the emitted module refuse the program with an unmapped `TS2322`: a wrong published row, a missed rule, and a refusal pointing at generated code. `as` and `<T>` were already handled and `satisfies` was not, in three walks that each restated the wrapper table by hand. **The binding spelling is the one that needed TWO edges, and recognizing either one alone is worse than recognizing neither**: a backend that accepted `stored!` as a propagation without also charging the row would COMPILE a function publishing `Result<number, Calm>` over a body that can only fail with `Boom`, which is a fail-open in the contract itself. `02/a-stored-inferred-fallible-result-propagates-and-runs` is the acceptance half and is not optional — the same program with a matching contract did not compile on the Go fork at all, drawing `SMITHERS1302` and `SMITHERS1207` at once, two rules contradicting each other about one value on the most ordinary store-then-propagate spelling in the language. It prints both variants, so a backend that recognized the propagation but lost the failure fails it. The callee is deliberately UNANNOTATED in all three, because a row still being computed by the fixpoint is what the reference used to read while deciding whether the propagation existed. The foreign-value counterpart is 7.34a. |
| 4.3 | the emitted error path returns rather than throwing | failures.mdx §Failure Propagation | covered | `02/unwrap-stops-at-the-first-failure` |
| 4.4 | postfix `!` needs an enclosing Result-returning function | failures.mdx §Failure Propagation | covered | `02/unwrap-at-top-level-is-rejected`, `02/unwrap-in-a-non-result-owner-is-rejected` |
| 4.5 | propagation whose early return would bypass a `catch` is rejected | poc README SMITHERS1205 | covered | `02/unwrap-inside-try-with-catch-is-rejected` |
| 4.6 | propagation in an order-unpreservable expression is rejected | poc README SMITHERS1204 | covered | `02/unwrap-in-a-compound-expression-is-rejected` |
| 4.12 | **the placement rule is a WALK to the nearest statement or arrow function, so a construct whose child is directly a statement position admits a `!`** | failures.mdx §Accepted Placements (**withdrawn 2026-08-27**; quoted verbatim in that page's §Amendment Record) — condition 1 and its own consequence sentence: "That is why `if (r!)`, `switch (r!)`, and `for (let i = r!; …)` are accepted". The obligation is no longer live: §Refusal Conditions makes placement unrestricted. This row now pins **current compiler behavior**, which is the `(SA-1)` gap | **covered — all three the sentence names** | `02/postfix-bang-in-an-if-condition-is-accepted`, `02/postfix-bang-in-a-switch-discriminant-is-accepted`, `02/postfix-bang-in-a-for-initializer-is-accepted`. The fork refused the last two with `SMITHERS1204` until 2026-08-25 because its hoistable-statement set listed only variable, return, expression, throw and `if`. Written as three cases rather than one because the sentence names three constructs and an implementation can hold any subset. |
| 4.13 | **`r!.length` is accepted and `r!.trim()` is not — the allowance ends when the member is called** | failures.mdx §Accepted Placements (**withdrawn 2026-08-27**; quoted verbatim in that page's §Amendment Record) — worked examples, flagged there as "easy to get wrong and MUST be read from the rule rather than guessed". The obligation is no longer live: §Refusal Conditions makes placement unrestricted. This row now pins **current compiler behavior**, which is the `(SA-1)` gap | **covered, both directions** | `02/postfix-bang-as-a-property-access-object-is-accepted` and `02/postfix-bang-before-a-member-call-is-rejected` — the same program with `.length` and `.trim()`. Neither half means anything alone. |
| 4.14 | **element access is not property access** | failures.mdx §Accepted Placements (**withdrawn 2026-08-27**; quoted verbatim in that page's §Amendment Record) — "`r![0]` // rejected — element access is not property access". The obligation is no longer live: §Refusal Conditions makes placement unrestricted. This row now pins **current compiler behavior**, which is the `(SA-1)` gap | covered | `02/postfix-bang-before-an-element-access-is-rejected`. Its counterpart from the other side is `compatibility.mdx:72`'s `arr[i]!` — `!` applied TO an element read — pinned by `07/an-array-literal-of-results-is-consumed-through-an-index-read`. |
| 4.15 | **`??` admits the LEFT operand and refuses the right** | failures.mdx §Accepted Placements (**withdrawn 2026-08-27**; quoted verbatim in that page's §Amendment Record) — condition 1's fifth form and its two worked examples. The obligation is no longer live: §Refusal Conditions makes placement unrestricted. This row now pins **current compiler behavior**, which is the `(SA-1)` gap | **covered, both directions** | `02/postfix-bang-as-a-nullish-left-operand-is-accepted` and `02/postfix-bang-as-a-nullish-right-operand-is-rejected` — one operator, two positions, opposite verdicts. |
| 4.16 | **a call argument is refused at any nesting depth** | failures.mdx §Accepted Placements (**withdrawn 2026-08-27**; quoted verbatim in that page's §Amendment Record) — "`f(r!)` // rejected — call argument, at any nesting depth". The obligation is no longer live: §Refusal Conditions makes placement unrestricted. This row now pins **current compiler behavior**, which is the `(SA-1)` gap | covered | `02/postfix-bang-in-a-call-argument-is-rejected`. The commonest shape in the language, and the one an implementation reading the rule as a list of shapes is likeliest to admit. |
| 4.17 | **a rejected placement MUST be a diagnostic, never a silent lowering** | failures.mdx §Refusal Conditions — **this obligation survives the 2026-08-27 revision verbatim**: "A rejected `!` MUST be a diagnostic, never a silent lowering." (Previously stated in §Accepted Placements.) | **covered structurally, by every refusal row above** | A silent lowering is not a quieter answer here, it is a *different program*: TypeScript's own non-null assertion means something in each of these positions, so a backend that lowered it through unchanged would compile and RUN. The judge scores that `fail` ("accepted and ran… but the case must be rejected"), not `pass`. Each of 4.13/4.14/4.15/4.16's refusal halves says so in its `notes`. The rule was written into the specification to settle a live disagreement in which one backend suppressed `SMITHERS1207` and emitted the `!` through; that carve-out is gone and `08/postfix-bang-on-an-unawaited-promise-result-is-not-a-result-operand` is what would notice it returning. |
| 4.18 | **an arrow function is where the placement walk STOPS, not a placement it fails** | failures.mdx §Refusal Conditions — the *verdict* survives and is strengthened (placement is unrestricted, so a concise arrow body is accepted a fortiori); the **walk** that produced it was withdrawn 2026-08-27 with §Accepted Placements, condition 1: "until the nearest statement **or arrow function**" | **covered** — both cases were `xfail go` until 2026-08-28, when `lowerConciseBody` learned to synthesise the block body a hoisted guard needs; they were one defect and retired in one edit | `02/postfix-bang-in-a-concise-arrow-body-is-accepted` (**xfail go** — the fork reports `SMITHERS1204`, because a concise arrow body has no statement list to hoist a guard into; closing it needs a synthesised block body) and `07/a-fallible-callback-in-a-map-argument-needs-a-contract` (**xfail go** for the same extra `SMITHERS1204`). The two retire together. `07/a-concise-arrow-body-returning-a-result-is-a-return` is the must-consume half of the same reading. |
| 4.19 | **a labeled statement is an ordinary statement position for the walk** | failures.mdx §Refusal Conditions — the *verdict* survives and is strengthened (placement is unrestricted, so a labeled statement body is accepted a fortiori); the **walk** that produced it was withdrawn 2026-08-27 with §Accepted Placements, condition 1 | **covered** — an `xfail js` until 2026-08-28. The marker blamed the guard's placement and the guard was already in the right place; the defect was a missing labeled-statement arm in `statementMayFallThrough`, which appended an unreachable completion the emitted-module check then rejected | `02/postfix-bang-in-a-labeled-statement-body-is-accepted`. The reference ACCEPTS the placement, as the rule requires, and then emits TypeScript its own stock check rejects with `TS2322`. That is a lowering defect on the reference, fail-closed, and it is pre-existing: the convergence lane's 510-row emit byte-comparison shows no reference emit changed except one dynamic-import case. **ONE CLAUSE OF THAT CASE'S `notes` IS WRONG AND IS CORRECTED HERE — re-measured 2026-08-28.** It says the over-approximating direction "is also self-checking — a function that really can run off its end without the completion is refused by the emitted-module check's own *not all code paths return a value*, never accepted silently." The **direction** is right (it is refused, on both backends, and nothing fails open) but the **mechanism** named is not what happens. Six such programs were measured — `outer: { … if (c) break outer; return … }`, the same with a plain `break` and no return, `while (true)`/`for (;;)` with a `break`, nested labels with `break inner`, and a bare unlabeled block — and on **all six** the reference reports `TS2322` *Type 'Result<undefined, never>' is not assignable to type 'Result<string[], Missing>'* with `mapped: false`, at a **generated** position past the end of the authored file (lines 21–24 of a 14-line program), because the appended `return __vsResultSuccess(undefined)` is what the stock check objects to. The fork reports `TS2366` *Function lacks ending return statement* at the authored signature (`10:25`) on all six. So the complement of this class is a live **six-for-six diagnostic-identity divergence in which the fork is right**, both backends refuse, and no corpus case spells it. Left unregistered deliberately: it is one cause, the fix is on the reference's `implicitCompletion` rather than in the corpus, and pinning `TS2366` today would need an `xfail js` on six cases for one defect. |
| 4.7 | propagation in a repeated loop header is rejected | poc README SMITHERS1703 | covered | `02/unwrap-in-a-loop-header-is-rejected` |
| 4.8 | `Result.unwrap()` is retired, and postfix `!` on a non-Result is not a non-null assertion | failures.mdx §Failure Propagation; compatibility.mdx §Configuration | covered | `19/result-dot-unwrap-is-retired`, `19/non-result-postfix-bang-is-rejected` |
| 4.9 | `x!: T` definite assignment is removed from `.sm` | compatibility.mdx §Configuration | covered | `19/definite-assignment-bang-is-rejected` |
| 4.10 | `?.` and `??` remain ordinary nullish operators around propagation | failures.mdx §Failure Propagation | covered | `02/postfix-propagation-keeps-nullish-operators-ordinary`, `19/optional-chaining-and-nullish-coalescing-stay-typescript` |
| 4.11 | prefix `!`, `!!`, and `!==` retain ordinary TypeScript behavior | compatibility.mdx §Configuration | covered | `19/boolean-negation-stays-typescript` |

## 5. Nominal errors and `Error.prototype`

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 5.1 | any class extending `Error` is a nominal recoverable error, no factory needed | failures.mdx §Error Classes | covered | every `04/*` case; `22/a-non-ascii-error-class-name-is-a-nominal-error` pins "**any** named class" against a non-ASCII identifier (the js marker is **retired**; it now passes on both) |
| 5.2 | **nominal identity is added WITHOUT changing ordinary `Error` behavior** | failures.mdx §Error Classes; DECISIONS Locked | covered | **`04/an-error-subclass-keeps-ordinary-error-behavior`** — `instanceof` up a two-level chain, `message`, the inherited `name`, and a real `stack`. Every other `04/*` case measures what the compiler *adds*; none of them would notice if the additions cost something. |
| 5.3 | `error.match({...})` is exhaustive for a statically known union, and narrows each handler argument | failures.mdx §Error Prototype | covered | `04/error-match-is-exhaustive` (handlers read subclass-only fields, so narrowing is observed), `04/error-match-missing-a-case` |
| 5.4 | a case outside the checked union is rejected | failures.mdx §Error Prototype | covered | `04/error-match-has-a-case-outside-the-union` |
| 5.5 | match handlers must be a static object literal keyed by class names | failures.mdx §Error Prototype ("not a forgeable user `_tag`"); poc README | covered | `04/error-match-requires-an-object-literal`, `04/error-match-cases-must-be-static-class-names` |
| 5.6 | `matchPartial` requires an explicit fallback, and routes unlisted failures to it | DECISIONS Locked; failures.mdx §Error Prototype | covered | `04/error-match-partial-needs-a-fallback`, `04/error-match-partial-runs-the-fallback` |
| 5.7 | `is` and `matches` narrow to the nominal subclass | failures.mdx §Error Prototype | covered | `04/error-is-and-root-cause` |
| 5.8 | `rootCause` walks a `cause` chain | DECISIONS Locked; failures.mdx §Error Prototype | covered | `04/error-root-cause`, `04/root-cause-walks-a-multi-level-chain` |
| 5.9 | handler selection uses compiler-stable nominal identity, not a name or `_tag` | failures.mdx §Error Prototype | **covered on both backends as of 2026-08-25, in six spellings, and the fork's half was closed this revision** | `04/same-named-errors-in-two-modules` pins the module-qualified half. `04/error-is-does-not-consult-a-user-installed-has-instance` pins the forgeability half for `is`/`matches` — before 2026-08-25 the fork printed `true, true, true`, because `smithersErrorIs` used a bare `instanceof`, which consults the RIGHT operand's `Symbol.hasInstance`. **`04/a-case-class-that-lies-about-instanceof-must-not-capture-a-sibling` is the same question asked of `match`, and its `xfail go` marker is RETIRED this revision** — the fork used to print `timeout` where the reference prints `notfound:k`, and now agrees. `instanceof` is a forgeable mechanism in more than one direction and at more than one site, so one case cannot hold this closed and five more were written from the sentence: `04/a-lying-case-class-does-not-capture-a-sibling-in-match-partial` (the SECOND spelling of the one lowering — `matchPartial` selects a handler exactly as `match` does), `04/a-case-class-that-denies-its-own-instances-still-receives-them` (the opposite direction: a hook that DENIES its own instances turns a compiler-certified exhaustive match into a runtime abort; the fork used to die with `TypeError: non-exhaustive Error match`), `04/a-case-class-whose-base-lies-does-not-capture-a-sibling` (a static member is INHERITED, so a rule inspecting only the case class's own members satisfies the other two and still selects wrongly), and — the construction half, which is not a `match` at all — `09/a-declared-foreign-channel-does-not-admit-an-unrelated-throw`, where a `@throws {T}` whose `T` lies admitted a `RangeError` into the declared recoverable channel. Two further cases pin what the FIX costs rather than what it buys, because the sound predicate narrows by assignability and can over-subtract: `04/zero-parameter-handlers-close-over-the-matched-value` (a handler with no parameter has nothing to annotate, so without the nominal brand its body reads a member of `never` — `TS2339`, measured on that exact program) and `04/a-match-partial-fallback-over-two-subclasses-of-one-base-still-checks` (exactly one level of a chain may carry a brand, so two subclasses stay mutually assignable on BOTH backends; this is the residual, pinned green). The `is`/`matches` case stays a pair with the rest: line 2 of it is load-bearing, because a rule answering `false` to everything satisfies lines 1 and 3 while having deleted `is`. |
| 5.10 | two same-named Error classes in one module cannot both get a stable identity | poc README SMITHERS1150 | covered | `04/duplicate-error-class-name-is-rejected`. Its unsettled neighbour is **`04/a-function-local-error-class-cannot-be-declared-twice`** (`xfail js + go`): a class declared inside a function mints a *new constructor per call* claiming the *same* module-local identity, and both backends accept the program and then die on the second call with `TypeError: stable Error identity … is already registered`. The marker does not pick a side — either the registry must tolerate per-call constructors, because ordinary TypeScript syntax keeps its behaviour, or SMITHERS1150's own sentence applies and the compiler must refuse it, in which case the *case* is retired rather than an implementation fixed. |
| 5.11 | **stable nominal identity** | failures.mdx §Error Classes | **covered as of 2026-08-25 — and it was unobservable until the harness changed** | **`04/a-nominal-error-identity-names-its-declaring-module`** declares the identity string itself as its `stdout`, so the two backends must mint it identically to satisfy one expectation, and it names the declaring `.mod.sm` for a class thrown, propagated and returned entirely from the *importing* module. `01/throw-lifts-into-failure` and the two `02/unwrap-*` cases carry the same-module form as a side effect of their own subject. **None of this was writable before**: the shared harness printed `error.constructor.name`, which §Error Prototype names as the wrong key, and which reads the same whether or not an identity exists — so the fork's total absence of an identity registry produced no divergence in either direction. See "Known observation gaps in the harness itself". |
| 5.12 | **serialization evidence and cross-realm transport metadata** | failures.mdx §Error Classes | **still unwritable, and now for a precisely stated reason** | The blocker is **reach**, not the runner's process count. `.sm` has no sanctioned path to the transport surface on *either* backend: on the reference `encodeError` lives in the POC runtime, which authored `.sm` may not import without a trusted `.ts` companion, and on the fork it lives in the injected `__smithers_prelude.ts`. The two surfaces are different modules at different paths, so **no single `typescript:` support module can be written that reaches both**, and a case that stages one is not a differential case. A same-realm `encode(decode(x))` would prove only that a function round-trips its own object. Closing it needs an `expect: "transport"` case shape in the runner — execute the emitted program twice, in two processes, passing one wire string between them — which is roughly forty lines and is not this revision's. Covered outside the corpus by `compiler/fork_error_transport_test.go` (two of its seven tests run two separate `node` processes, and two of those cross backends) and by `poc/src/runtime/introspection.test.ts`. |
| 5.13 | **an ambient Error declaration introduces no runtime binding, so nothing may be emitted that names it** | failures.mdx §Error Classes ("while preserving ordinary `Error` behavior") | **covered** — an `xfail js` until 2026-08-28, when the reference stopped emitting a registration for a declaration that has no runtime binding. The identity is still reserved, so `SMITHERS1150` still refuses two same-named ambient Error classes | `04/an-ambient-error-declaration-is-not-registered`. The reference emits `__vsRegisterError(Ambient, …)` for a `declare class` and the accepted program dies while the emitted module is still loading — a clean compile that cannot run, 0 diagnostics and exit 1. The fork skips ambient declarations **at the registration site only**, so the identity is still reserved and `SMITHERS1150` still refuses two same-named ambient classes. This is the one place the two backends deliberately differ. |
| 5.14 | **a class member with a computed name is ordinary TypeScript** | compatibility.mdx §Source Relationship | **covered** | `04/a-computed-class-member-name-is-ordinary-typescript` — four spellings in one class (static method, instance method, getter, static field). Not a language rule: a regression pin for a crash. Before 2026-08-25 any one of them took the Go bridge down with `panic: Unhandled case in Node.Text: *ast.ComputedPropertyName`, from a single unguarded name read used only to render a diagnostic. **A panicking backend scores `unmeasured`, which is a failure to measure rather than a measurement** — the one outcome a differential harness cannot score — so this belongs in the corpus and not only in a Go unit test. Measured against the pre-fix tree it is exactly that. |
| 5.15 | **an Error subclass whose base is declared in another module satisfies both nominal identities** | failures.mdx §Error Classes | **covered** | `04/an-error-subclass-across-a-module-boundary-keeps-both-identities`. The subclass takes an identity naming its own module and the base keeps one naming its declaring module; a value is nominally both. This pins the *behaviour* those identities implement, beside 5.11 which reads an identity directly. |

## 6. Absence and nullability

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 6.1 | absence uses ordinary `T | undefined` / `T | null` and narrows ordinarily | type-system.mdx §Absence | covered | `19/undefined-union-narrows-ordinarily` |
| 6.2 | TypeScript optional parameters and properties keep their meaning | type-system.mdx §Absence | covered | `19/typescript-optionals-keep-their-meaning` |
| 6.3 | optional chaining and nullish coalescing keep their TypeScript meaning | type-system.mdx §Absence; failures.mdx §Failure Propagation | covered | `19/optional-chaining-and-nullish-coalescing-stay-typescript`, `02/postfix-propagation-keeps-nullish-operators-ordinary` |
| 6.4 | the withdrawn `?T`, `orelse`, and `.?` grammar remains rejected | specification index removal worklist | covered | `19/question-optional-grammar-is-retired`, `19/orelse-operator-is-retired`, `19/dot-question-operator-is-retired` |
| 6.5 | compiler-owned `Optional<T>` is absent while user-defined names remain ordinary | specification index removal worklist | covered | `19/builtin-optional-is-unresolved`, `19/user-defined-optional-is-ordinary` |

## 7. Foreign boundaries and the panic channel

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 7.1 | calling any unannotated foreign value adds the checked `panic` case | failures.mdx §Foreign Exceptions | covered | `09/untrusted-foreign-call-charges-panic` |
| 7.2 | a caller must propagate, catch, or adapt that panic | failures.mdx §Foreign Exceptions | covered | `09/untrusted-foreign-call-needs-the-panic-channel` |
| 7.3 | `@throws {never}` is a trusted opt-out from the *panic case* | failures.mdx §Foreign Exceptions | covered | `09/trusted-foreign-call-is-accepted`; **`21/a-pin-reaching-a-trusted-foreign-call-is-rejected`** pins that it is not an opt-out from the *requirement* |
| 7.34 | **`satisfies` does not launder foreign provenance, and `as` and a type ANNOTATION erase a trust marker where `satisfies` does not** | compatibility.mdx §Foreign Boundary: the panic case attaches to calling an unannotated foreign value, and "Trusted `@throws {never}` metadata opts out" — the opt-out is a property of the DECLARATION the checker resolves | **covered as of 2026-08-27, three cases; 227 divergences were closed the same day with conformance reporting 0 divergent throughout, because no case put a `satisfies` near a foreign value** | `09/a-satisfies-cannot-launder-foreign-provenance` declares seventeen diagnostics across three rules (`SMITHERS1504`, `1506`, `1101`) over a `satisfies`, a `satisfies` then an `as`, a `const` that holds one, and a double alias, with the DIRECT spelling of each declared alongside so the promise is an equality between spellings rather than a list of refusals. Its load-bearing row is `propVsALocal`: the alternate in the `??` is a LOCAL object, because with a foreign alternate the diagnostic fires whichever branch the rule looked at and the case would be green while observing nothing. `09/an-as-or-an-annotation-erases-a-trust-marker-where-satisfies-does-not` is the only shape in the family where `satisfies` and `as` must give DIFFERENT answers — five pure `satisfies` spellings of a `@throws {never}` tag stay clean while `as`, an annotation, and `satisfies` composed with `as` are refused — so a refactor folding the two operators together passes every other case and breaks this one. `09/an-ordinary-satisfies-a-cast-and-an-annotation-stay-clean` is the over-correction guard and RUNS: three wrappers around a LOCAL object plus a trusted foreign callee reached through `satisfies` and through a parenthesis, the first of which the fork refused until this day. **Deliberately absent:** the marker-PLACEMENT family (a `@throws {never}` on the constructor's own line, on the same line, on the class only, on an implicit constructor) is measured identical on both backends but needs a foreign module `conformance/support/` does not have, and the round-6 corpus lane did not own that directory. |
| 7.34a | **…and the same wrapper must not COST a foreign propagation its lift: `satisfies` around an untrusted foreign call still produces the checked Result, and the program runs** | failures.mdx §Foreign Exceptions (Locked): an untrusted foreign call adds the distinguished checked panic case and the caller MUST propagate it | **covered as of 2026-08-27, and it is the over-refusal half of 7.34** | `09/a-satisfies-wrapped-foreign-propagation-runs` — `(parseIntegerUnchecked(text) satisfies unknown)!` inside `Result<number, Panic>`, an `expect: "output"` case, so the trusted-module edge, the lift, the propagation and the `match` all execute. Before the round-7 wrapper work the reference refused it with `SMITHERS1507` (its foreign-result walk stopped at the wrapper) and the fork with `SMITHERS1301` plus `SMITHERS1207`. Both were wrong in the SAME direction, and in the OPPOSITE direction from 4.2a's `02/a-satisfies-wrapped-propagation-charges-the-contract`, which requires the identical wrapper to be REFUSED when the contract omits the failure. One table now answers both, so a fix to either direction that regressed the other shows up in one run. The `as` spelling is deliberately not written beside it: a type wrapper whose annotation the lowered `Result` does not satisfy is refused by the stock check of the emitted module, which is pre-existing and a different subject — 7.34's `09/an-as-or-an-annotation-erases-a-trust-marker-where-satisfies-does-not` is where the two operators are required to differ. |
| 7.23a | **…and the panic INTRINSIC is recognized by the member it selects, not by how the member is spelled — in both directions** | DECISIONS Locked and failures.mdx:219: "`Reflect.panic` and compiler/runtime invariant failures enter the same distinguished panic channel"; §Panic Does Not Widen a Return Type for the accepting half | **covered as of 2026-08-27, as a pair, and one half was a live fail-OPEN the other half's defect created** | `09/an-aliased-reflect-panic-key-is-not-a-value` (`SMITHERS1503`, the same refusal 7.23 pins for the imported spelling) and `09/an-aliased-reflect-panic-key-is-still-a-panic-exit` (`output`, the same acceptance 7.24 pins for the dotted spelling). Both write `Reflect[KEY](...)` with `const KEY = "panic"`. **This pair exists because widening one rule broke another**: once the member-selection helper resolved a `const`-aliased key (12.12a), the panic recognizer still asked for the symbol of the node that SPELLS the member — which on `Reflect[KEY]` is the symbol of `KEY` — so on the Go fork the refusal case COMPILED, RAN and printed `ok` while the acceptance case was refused by the stock checker with `TS2355`, a function with a declared return type that returns nothing. One unrecognized member, two opposite failures, which is why neither direction is safe to pin alone. Eight sibling rules read the same answer and stayed correct only because they were already routed through the shared helper. |
| 7.35 | **an operator that SELECTS a value does not change where the value came from: `??`, `\|\|`, `&&`, a conditional, a comma, a `const` that holds the selection and a cast over it all leave a foreign value foreign** | compatibility.mdx §Foreign Boundary | **covered as of 2026-08-27, three cases** | The operand walk knew the ternary and the comma and did not know `??`, `\|\|` or `&&`, so a foreign constructor, property read or tag hidden behind a nullish coalesce was accepted and its throw escaped every checked channel. `09/a-selected-foreign-constructor-property-and-tag-are-still-foreign` declares nineteen diagnostics across three rules over seven selector spellings, and **every selector pairs a foreign operand with a LOCAL one, with the local alternate on the RIGHT for `??`/`\|\|`/ternary/comma and on the LEFT for `&&`** — so a walk reading only one side is wrong on at least one row whichever side it picks. `09/a-selected-trusted-foreign-callee-is-still-not-order-safe` records a distinction that reads wrong at first: a `@throws {never}` marker removes the panic case from the CALL and does not make the expression that SELECTS the callee evaluation-order-safe, so five selector spellings of a trusted callee draw `SMITHERS1507` while the direct and parenthesised spellings stay clean. It exists because an earlier draft of the negative case listed `(double ?? localDouble)(2)` as a negative and both backends refused it. `09/selectors-over-local-and-trusted-values-stay-clean` is the over-correction guard and RUNS: `&&` over two locals prints its RIGHT operand's value so the case observes which branch ran, and the local tag returns a constant that appears nowhere in the expected output so the three trusted-tag lines prove the TRUSTED branch was selected and executed. That file omits the comma spelling over two locals for a harness reason worth knowing: `(b, a).retries` is `TS2695` under the stock checker an `output` case must survive, while a refusal case never reaches the emit stage. |
| 7.4 | `@throws {T}` declares the stated channel, honoured case | failures.mdx §Foreign Exceptions | **covered, and its FORGERY direction was closed and pinned on 2026-08-25** | `09/declared-foreign-throws-is-exposed` pins that an honest `T` really thrown is admitted. `09/a-declared-foreign-channel-does-not-admit-an-unrelated-throw` pins the other side of the same sentence: `@throws {T}` names the class whose instances the boundary admits, so a `T` that installs a lying `Symbol.hasInstance` must NOT widen the channel. The fork's `smithersTry` tested admission with a bare `cause instanceof expected` and printed `error:RangeError` — a `RangeError` delivered as the declared recoverable member, so the checked channel meant nothing while still type-checking; it now prints `error:Panic`, and the case reads `.name` precisely because that separates the two answers. This is the CONSTRUCTION half of the forgeable-mechanism class §5.9 covers for selection, and it is not a `match` at all. Its acceptance controls are 7.4's own honest case and 7.5 — without them a rule that admitted NOTHING would satisfy it. Support module `conformance/support/lying-channel.ts`, whose leading JSDoc carries a genuine initialization trust claim so the case is about the function-level channel and not module trust. |
| 7.5 | a violated `@throws {T}` claim still lands in Panic | failures.mdx §Foreign Exceptions; DECISIONS Locked; poc README | covered | `09/declared-foreign-throws-violated-stays-panic` — **the long-standing JS xfail here is retired**; both backends now deliver the violated claim as the Panic member of the declared channel |
| 7.6 | Promise rejection at an unannotated boundary becomes panic | failures.mdx §Promise Semantics | covered | `09/foreign-rejection-becomes-panic`, `01/result-try-promise-adapts-a-rejecting-body` |
| 7.20 | **a project module whose own FILENAME contains the letters `import` compiles** | not a language rule — a regression pin for a crash that produced no diagnostic at all | covered | `09/a-module-name-containing-import-does-not-crash-the-specifier-rewrite` (static) and `09/a-dynamic-import-of-a-project-module-is-not-a-foreign-module-edge`, whose own module file is named the same way (dynamic). The fork located candidate dynamic imports by scanning raw source text for the substring `import`, so every occurrence *inside a specifier* resolved back to the same call, duplicated the import entry, produced two identical specifier edits and panicked with `slice bounds out of range` — taking the compile down silently. The hazard was unreachable for as long as the fork refused every dynamic import, and became reachable the moment that refusal was narrowed. **A crash is not a verdict**, which is why it belongs in the corpus rather than only in a Go unit test. |
| 7.21 | **the type `Panic` may be named in a contract without importing it** | *no sentence settles this* — type-system.mdx:60 establishes that the compiler charges the distinguished checked `panic` case on every unannotated foreign call; nothing on failures.mdx says whether the TYPE naming it is ambient the way `Result` is | **covered by an `xfail go` that is a documentation gap, not a defect verdict** | `09/a-bare-panic-type-resolves-without-an-import`. The reference resolves the bare name; the fork does not and adds `SMITHERS1104`. **Neither backend should be changed on the strength of this marker.** The previous revision met the same divergence as an accident of another case's imports and left it unpinned for that reason; it is pinned here as its own subject so the question is written down at the place it bites. If the specification says `Panic` is ambient, the fork moves; if it says it must be imported, the case is rewritten to import it. |
| 7.7 | a statically imported foreign module needs a module-initialization trust claim | poc README SMITHERS1510 | covered | `09/foreign-module-without-a-trust-marker` (**its `xfail go` was retired 2026-08-25 after an `XPASS`** — the fork's early return that disabled the ENTIRE foreign policy behind a refused module edge is gone, and enumerating the class found four broken call forms where one had been reported), plus its async spelling `09/an-async-function-returning-an-untrusted-foreign-result-charges-both` |
| 7.7b | **…and the rule is not escapable by re-spelling the edge** | poc README SMITHERS1510 (the hazard it names — an initializer runs before any call boundary exists — is identical for both spellings); *no specification sentence covers dynamic import at all* | **covered by a pair, both marked, and deliberately narrower than the open question underneath them** | **Both markers were retired 2026-08-25 after an `XPASS`, and the pair became a set of four.** `09/a-dynamic-import-of-an-untrusted-foreign-module-is-refused` (the `js` fail-open: the reference compiled and RAN it while refusing the byte-identical static edge), `09/a-dynamic-import-of-a-project-module-is-not-a-foreign-module-edge` (the `go` over-reach that refused every dynamic import), and now `09/a-dynamic-import-of-a-trusted-foreign-module-is-accepted` and `09/a-dynamic-import-of-a-host-package-is-refused`. Read the four together: the rule is about the TARGET's trust, in every spelling — a project module is ordinary, a host package is foreign, an untrusted foreign module is refused, and a trusted one keeps its claim. `09/a-computed-dynamic-import-specifier-is-refused` is the boundary: a non-literal specifier resolves to no target, so no claim can be read and the fail-closed answer is the only available one. **The trusted-target case still does NOT settle whether the dynamic edge should exist**: `DECISIONS.md:296` is Locked that arbitrary dynamic import expressions remain available, the specification pages say nothing about dynamic import, and if the ledger goes the other way that case is what to retire — it asserts only that trust survives the spelling. The ledger decision REVIEW-fable-1.md F2 asked for is still owed. |
| 7.7c | **…and the claim certifies the module that WRITES it and no module that module goes on to load: the rule is over the reached-module closure, at every depth** | compatibility.mdx §Runtime TypeScript Dependency and failures.mdx:115 (both Locked) attach the claim to a MODULE's initialization; nothing in either sentence bounds it to the module the authored `.sm` names, and the hazard `SMITHERS1510` states — "foreign module initialization can panic before a checked call boundary" — is identical whether the initializer runs one edge away or three | **covered as of 2026-08-27, five cases, both backends, no `xfail`** | **This is the row the corpus could not have written for seven rounds, and the measurement is the reason it matters.** A foreign module reached at depth ≥ 2 behind a properly marked relay was never asked for its marker on EITHER backend, and both fix lanes measured the failure with a module-scope oracle rather than with diagnostics: **every fail-open cell was executing the untrusted module's initializer** (22 cells on the reference, 21 on the fork), on programs that compiled clean. Three refusals, deliberately separated because they fail identically from outside and are not the same defect: `09/a-trust-marker-does-not-travel-through-a-trusted-module` (the reached module wrote `@MODULE` — *the marker did not match*, which is 7.8c's rule asked one edge out), `09/an-unmarked-module-behind-a-trusted-relay-is-refused` (the reached module wrote nothing at all — *the closure did not ask*), and `09/module-trust-does-not-travel-two-hops` (the same unmarked module behind TWO marked relays — *depth is not a bound*; its middle relay is character-for-character the depth-2 relay apart from a comment, so an implementation that unrolls the check twice passes the second case and fails this one). All three anchor at the authored `.sm` import specifier, `SMITHERS1510@1:24`, the same anchor 7.8b and 7.8c's cases use, and all three declare `messageContains: "@module and @throws {never}"` because the whole risk here is a refusal for the WRONG reason: the relay's own marker is correct, and an implementation that misread *it* would refuse at the identical line and column. **Two over-correction guards land with them and are not optional** — this repository has shipped ten. `09/a-marked-chain-confers-trust-at-every-depth` is the discriminating twin of the second refusal: same shape, and the only difference between the two programs is whether the module at the end of the edge wrote the marker. `09/a-deferred-foreign-loader-needs-no-marker-behind-it` is the deferral proof's guard and **shares the very support module the second refusal requires to be REFUSED**, so an implementation answering by file identity or reachability instead of by edge kind cannot pass both. Both are `expect: "output"` on purpose: a diagnostics assertion cannot tell *trusted* from *silently dropped*. **The prelude forgery guarantee is a compiler-internal edge no corpus case reaches** — `poc/src/runtime/result.ts` and `panic.ts` are deliberately unmarked and that unmarkedness IS the guarantee; the reference's first fix attempt broke it and `poc/src/language/capability-seams.test.ts` SEAM 3 caught it, which remains its only pin. **Deliberately not written:** the `.cts` edge spellings (`require()` at module scope, the IIFE, `import x = require`), because the fork cannot execute them at all and TypeScript refuses import-equals under ESM — they are pinned in `poc/src/language/foreign-module-closure.test.ts` and the fork's closure tests instead. |
| 7.8 | the module trust claim never doubles as a function-level opt-out | poc README; compatibility.mdx §Runtime TypeScript Dependency; failures.mdx:115 | covered | **`09/module-init-trust-is-not-a-function-level-throws-claim`** is the direct pin: `support/module-init-only.ts` writes ONLY the documented `/** @module @throws {never} */` header, immediately above a first export that always throws, and the throw must still be delivered as a Panic. That header is the trigger — the specification's own happy path — because a file-leading JSDoc is also the leading trivia of the first statement, so an implementation that reads `@throws` from that trivia without excluding the `@module` claim certifies a throwing function. `09/untrusted-foreign-call-charges-panic` keeps the weaker form (an unannotated export of the trusted `support/foreign.ts` still charges Panic). |
| 7.8b | **the trust marker's grammar is exact: `@module` has a boundary, and `@throws {never}` is not assembled across a JSDoc decoration** | compatibility.mdx §Runtime TypeScript Dependency; failures.mdx:115 | covered | **`09/near-miss-trust-markers-do-not-confer-module-trust`** (both near misses, two `SMITHERS1510`s, one case) and its acceptance control **`09/a-multiline-module-trust-header-is-honoured`**, which is the ordinary multi-line spelling and must keep compiling. Written as a pair deliberately: the obvious way to refuse a split marker is to require the two tags to be adjacent, which would refuse every real header. |
| 7.8c | **…and the marker has to be in a JSDoc COMMENT, and the whitespace inside it is exactly `[ \t\r\n]`** | failures.mdx:115 (Locked): "The compiler MUST recognize trusted **JSDoc**/declaration metadata at the boundary" — the word is JSDoc, and the same sentence's two productions (`@throws {never}` opts out; `@throws {T}` declares a channel) are separated only by the spelling inside the braces | **covered as of 2026-08-27, four cases, and three of the four spellings were a fail-open on ALL THREE implementations at once** | Two spellings say the comment KIND is the scanner's answer and not a substring search: `09/a-line-comment-holding-the-trust-marker-does-not-confer-module-trust` and `09/a-block-comment-holding-the-trust-marker-does-not-confer-module-trust`, the latter carrying TWO support modules and two `SMITHERS1510`s — `/* @module @throws {never} */` (one asterisk, already refused everywhere and previously untested, so it is the control that makes the second mean something) and `/* /** @module @throws {never} */` (an ordinary block comment whose CONTENT begins `/**`, which is the defect). One spelling says what JSDoc whitespace is: `09/exotic-whitespace-in-the-trust-marker-does-not-confer-module-trust`, whose braces hold U+00A0 and therefore name a type whose spelling is not `never` — the second production, by 7.32's own reasoning about `{Never}`. `\s` in JavaScript matches U+00A0, U+000C, U+000B, U+FEFF and every Unicode space separator; JSDoc's class is `[ \t\r\n]`, and **eight spellings were a live BACKEND DIVERGENCE** (the reference trusted all eight and their initializers RAN; the fork refused all eight) until the reference moved to the fork's narrower class. `09/ordinary-whitespace-in-the-trust-marker-still-confers-module-trust` is the acceptance half and is not optional: the obvious way to narrow the class is to demand the literal bytes `@throws {never}`, which would refuse a marker written across three lines. That support file deliberately carries no `*` decoration on its inner lines, so it and 7.8b's split-marker near miss together say JSDoc whitespace is honoured and JSDoc decoration is not assembled across — an implementation that compacts a comment by deleting its `*` characters passes one and fails the other. **The obvious repair is worse than the defect and was measured to be**: reading the PARSER's attached JSDoc tags disagrees with the scanner on 21 of the 75 marker-carrying files in this repository, because TypeScript attaches only the LAST block before a statement — `conformance/support/foreign.ts` would silently have become untrusted and `conformance/support/split-trust-marker.ts` would have been GRANTED trust. ~~**Not covered, and the blocker was re-measured on 2026-08-27 rather than taken on trust:** the transitive position (a marked relay re-exporting from an unmarked or miscased module) is still ACCEPTED by both backends at depth ≥ 2, so a case there would encode a product-only rule; see the sixth-revision entry under "How and when this page was measured".~~ **Covered later the same day — see 7.7c.** Both backends now walk the reached-module closure, the blocker is gone, and the transitive position is pinned by five cases. The predicate the closure consults is the SAME `hasLeadingModuleNoThrowMarker` / `trustedForeignModule` this row's four spellings interrogate at depth one, on both backends and by construction, so 7.7c's `a-trust-marker-does-not-travel-through-a-trusted-module` is this row's `@MODULE` spelling asked one edge out and must always give the same answer. |
| 7.9 | a foreign property/accessor read needs an annotated adapter | poc README SMITHERS1506 | covered | `09/foreign-property-read-needs-an-adapter` |
| 7.10 | a foreign constructor is not lowerable without `@throws {never}` | poc README SMITHERS1504 | covered | `09/foreign-constructor-needs-throws-never` |
| 7.11 | a callback escaping into foreign code is rejected | poc README SMITHERS1509; requirements.mdx §Scoping | covered | `09/callback-escaping-into-foreign-code-is-rejected` |
| 7.12 | `panic` is imported from `smithers:exceptions` and accepts a message or Error | failures.mdx §Foreign Exceptions | covered | `09/explicit-panic-charges-the-channel` |
| 7.13 | `Reflect.panic` enters the same distinguished channel | DECISIONS Locked; failures.mdx §Foreign Exceptions | covered | `09/reflect-panic-enters-the-panic-channel` |
| 7.14 | ordinary `try/catch` stays valid and does not change the Result contract | failures.mdx §JavaScript try/catch | covered | `01/plain-function-keeps-javascript-throw`, `09/try-catch-does-not-change-the-result-contract` |
| 7.15 | **module trust is exact: a package merely *starting* with the intrinsic letters is foreign** | poc README ("Prefixes do not confer trust") | covered | **`09/a-bare-package-with-the-intrinsic-letters-is-foreign`**. The previous revision recorded this as unwritable on the grounds that a bare specifier cannot resolve in the harness's flat staging tree; that reason was wrong. `SMITHERS1510` is decided lexically from the specifier, so the rule is reached before resolution matters. Inspecting rather than calling the binding keeps the case to the one diagnostic. |
| 7.16 | overload / declaration-merging / generic / multiple-tag `@throws` rules | DECISIONS **Direction**; failures.mdx:115 "remain open" | **partially covered as of 2026-08-26, and the cases say Direction rather than Locked** | The *exact* semantics remain undecided and this row is not claiming otherwise. What the five new cases pin is the **default and its direction**, which is Locked: compatibility.mdx §Foreign Boundary makes the panic case a MUST on every unannotated foreign call, and DECISIONS.md Locked makes `@throws {never}` "a trusted opt-out from the default `panic` case" — one claim, about one call — so a claim the compiler cannot reduce to a single usable answer for the call in front of it does not opt out and the MUST stands. `09/one-marked-overload-does-not-trust-the-unmarked-one` (a marker on the numeric overload does not certify the string overload a call resolves to) with its acceptance twin `09/a-call-resolving-to-the-marked-overload-is-still-trusted`; `09/a-never-claim-followed-by-a-declared-channel-is-refused` and `09/a-declared-channel-followed-by-a-never-claim-is-refused-identically`, a deliberate pair whose whole content is that the same two claims in either order give the same verdict at the same position — before 2026-08-26 they gave **opposite** verdicts and only one order failed closed — with its own acceptance twin `09/two-identical-throws-claims-are-redundant-not-contradictory` (two IDENTICAL claims are redundant, not contradictory, so a rule that counted tags rather than distinct claims would satisfy the pair and fail here). Both backends agree on all five. **Each case's `notes` records that this is a Direction entry and that the case is rewritten, not defended, if the specification later chooses a different rule.** See 7.18: the refusal to honour an unreifiable claim is a separate question. |
| 7.16a | **an implicit invocation is a foreign call: `for…of`, spread, object spread, interpolation and the coercing operators all invoke a foreign member with no call expression to lower** | compatibility.mdx §Foreign Boundary (Locked) — the MUST is on *calling*, and each of these positions is a call the grammar spells without a callee; poc/src/language/README.md registers the closure under `SMITHERS1506` as one predicate over an expression's POSITION | **covered as of 2026-08-26** | `09/a-for-of-over-a-foreign-iterable-keeps-the-panic-case`, `09/a-spread-of-a-foreign-iterable-keeps-the-panic-case` (the same protocol under a second spelling, deliberately kept as its own case), `09/an-object-spread-of-a-foreign-value-runs-its-getters` (the enumeration protocol), `09/template-interpolation-of-a-foreign-value-runs-its-coercion` and `09/a-coercing-operator-on-a-foreign-value-keeps-the-panic-case` (the coercion protocol). All five were **demonstrated failing** on a reconstructed pre-change tree, where each compiled clean and ran with the enclosing row reading `failures: []`. The over-correction guards are 7.16b. |
| 7.16b | **…and the rule does not widen: an authored value invokes nothing foreign, and a trusted binding's primitive keeps the language's own protocol members** | the same MUST, read for what it does NOT reach; poc/src/language/README.md, `SMITHERS1506` ("the value must have foreign provenance, and `foreignValueCanExecute` must be true, so a trusted binding's `string` may still be interpolated, iterated and spread") | **covered as of 2026-08-26** | `09/ordinary-iteration-spread-and-interpolation-stay-clean` (all three protocols over authored values, an `output` case so a broken lowering is caught as well as a broken rule) and `09/a-trusted-bindings-string-may-still-be-interpolated-and-iterated` (the second gate specifically: provenance alone is not sufficient). Both were proved enforced by mutation rather than assumed, since neither could be demonstrated failing — they were green before the change and after it, which is the point of them. |
| 7.16c | **a call-like foreign form with no call expression: a tagged template, an implicit `super(...)`, and a decorator** | compatibility.mdx §Foreign Boundary (Locked); poc/src/language/README.md, `SMITHERS1504` names all three spellings beside `new Foreign(...)` | **covered as of 2026-08-26** | `09/a-foreign-tagged-template-is-a-call-with-no-call-expression` with its acceptance twin `09/a-trusted-tag-is-accepted-and-runs`; `09/constructing-a-subclass-of-a-foreign-class-runs-the-base-constructor` with its boundary twin `09/declaring-a-subclass-of-a-foreign-class-without-constructing-it-is-clean` (the `extends` clause runs no constructor — a first draft of the rule charged the clause and broke `17-durable/the-retired-vibelang-flows-specifier-is-not-compiler-owned`, which pins that boundary only as a side effect); and `09/a-foreign-decorator-is-invoked-when-the-declaration-is-evaluated`, which carries no `SMITHERS1101` beside it because the invocation happens as the module is evaluated rather than inside any row — there is no enclosing contract that could have carried the channel. On the pre-change tree the decorator case compiled clean and the emitted program **died while loading**, exit 1. |
| 7.16d | **`@throws {never}` cannot describe an async or `Promise`-returning binding, because the marker is an opt-out for the CALL and an async binding fails by rejecting afterwards** | compatibility.mdx §Foreign Boundary (Locked): "JavaScript and TypeScript may throw, **reject**, or violate a declaration" | **covered as of 2026-08-26** | `09/a-trusted-async-binding-keeps-its-rejection-channel` and `09/a-trusted-promise-returning-binding-keeps-its-rejection-channel` — the pair is the evidence that the rule asks about the rejection channel rather than about the `async` keyword, and the sugar-free spelling is the one the next platform binding actually takes. `09/a-trusted-union-with-a-promise-constituent-keeps-its-rejection-channel` extends it to a union constituent (**`xfail go`**, cascade only). The controls, both `output` cases that must still run: `09/an-untrusted-async-binding-still-charges-exactly-panic` (the unmarked spelling is unchanged — the refusal could have been implemented by charging something extra everywhere and nothing in a refusal-only corpus would have noticed) and `09/a-declared-async-channel-is-still-honoured` (only the OPT-OUT is unusable; `@throws {T}` adds a name and loses nothing). |
| 7.16e | **the read half of the rule asks the RECEIVER's provenance and nothing else — not the member's declarations, and not the file those declarations live in** | compatibility.mdx §Foreign Boundary (Locked); poc/src/language/README.md, `SMITHERS1506` ("The read half of the rule asks the **receiver** one question and nothing else … The member's own declarations are not consulted, on either backend") | **covered on the reference by four cases; all four `xfail go` for the row charge alone (7.31), none for the read** | `09/a-foreign-index-signature-read-through-a-property-access-needs-an-adapter` (`keyed.width`, a member with NO declarations — an index signature is a declaration of the CONTAINER and was never a trust claim about the member), its **deliberate pair** `09/a-foreign-index-signature-read-through-an-element-access-needs-an-adapter` (`keyed["width"]`, the same member off the same value), `09/a-library-declared-member-of-a-foreign-value-still-needs-an-adapter` (`constructor`, declared only in `lib.es5.d.ts` — the half the index-signature cases cannot make, since a rule may stop treating an empty declaration list as consent and still decide by where the member is declared), and `09/destructuring-a-foreign-value-runs-its-accessors` (a read with **no member expression at all**, reported at the pattern). **Why four and not one.** The corpus had only the dotted index-signature case when the fork's second gate — the one that walked the member's declarations — was deleted, and a single case cannot tell a rule that reads the receiver from a rule that happens to refuse `keyed.width`. Three of the four were demonstrated failing on a reconstructed pre-fix tree, where the fork compiled, ran and exited 0 on each; the fourth is the case that was already filed as the fail-open and whose marker this revision rewrote. |
| 7.17 | foreign factory/result invoked before an expression-safe unwrap (`SMITHERS1507`); executable foreign provenance escaping a higher-order/return/store boundary (`SMITHERS1508`) | poc README:125, :127; the Locked rule behind both is failures.mdx:111 | **covered** | Two revisions of history on this one row, and it is the reason the section above exists. Two revisions ago it said "**partial**: both fire and are *observed* in the corpus, but only as cascade members inside other cases" — false, because `judge.mjs` requires a satisfied diagnostics expectation to compare the **same number** of diagnostics, so an undeclared cascade member fails a case rather than riding inside it. The previous revision corrected it to **uncovered** and moved both codes into "Reference-only rejection rules". Then both were ported into the fork, which removed them from *that* table too — leaving two rules present in both implementations, probed by nothing, and visible to neither subtraction this page performed. **This revision writes the cases.** See 7.20–7.22 for the four refusals and two acceptance controls. `grep -rl '"code": "SMITHERS150[78]"' conformance/corpus/ \| wc -l` → **4**. |
| 7.20 | **an untrusted foreign call's result may not be consumed where the lowered `Result` cannot go** (`SMITHERS1507`) | failures.mdx:111 (Locked) "Calling any TypeScript, JavaScript, or other foreign runtime implementation MUST add the distinguished checked `panic` case by default"; compatibility.mdx:24 "The caller must propagate, explicitly catch, or safely adapt that channel" | **covered** | Both branches of the lowerability predicate (`poc/src/language/semantic.ts:2110`), one case each, because an implementation can lose either without losing the other. `09/a-foreign-factory-result-invoked-before-it-is-unwrapped-is-rejected` is the `!stableCallee` branch — `makeParser()(text)`, where lowering would place a `Result` in **callee** position; its single declared diagnostic is load-bearing, because the inner factory call is at the same authored position and a backend that charged it too would be observable. `09/an-untrusted-foreign-result-used-in-an-expression-is-rejected` is the `unsafeUse` branch — `parseIntegerUnchecked(text) + 1` — and declares `SMITHERS1301` alongside `SMITHERS1507` deliberately: the must-consume diagnostic is the compiler demonstrating that it really did produce a `Result` there. |
| 7.21 | **executable foreign provenance may not leave the checked scope** (`SMITHERS1508`) | poc README:127; the same failures.mdx:111 MUST, read at a site where there is no call to attach the channel to | **covered** | Two of the four emission sites. `09/a-foreign-callable-escaping-through-a-local-higher-order-call-is-rejected` is the argument site: the foreign function is never called in the module at all, it is invoked through a *parameter*, which has no foreign origin to follow (`semantic.ts:2329-2357`), so the throw would cross the declared `Result<number[], Panic>` with no boundary anywhere on the path. `09/returning-a-foreign-callable-is-rejected` is the return site, and declares `Result<(text: string) => number, Panic>` on purpose: a `Result` around a callable wraps its *delivery*, not its later invocation, so declaring one does not discharge the rule. The mutable-alias and assignment sites (`semantic.ts:1203`, `:1252`) are **uncovered**. **Two more sites landed 2026-08-25.** `09/a-foreign-callable-handed-to-a-trusted-binding-is-still-rejected` is the argument site *inside a trusted call* — see 7.30, where it is the fail-open guard, because that position used to belong to `SMITHERS1509` and the refusal had to be transferred here rather than deleted. And `09/a-trusted-binding-returning-an-object-still-loses-foreign-provenance` is the residual **object-return wall**: a `@throws {never}` claim covers the call's panic channel and says nothing about the methods of a value the call hands back, because a trusted factory can legitimately return a handle whose methods throw. That question is genuinely **open** — no sentence settles whether the claim should reach the returned type — so it is pinned in **both** directions, with `09/a-trusted-binding-filling-a-smithers-owned-buffer-is-accepted` as the acceptance control: a buffer constructed in `.sm`, written by the binding, nothing foreign crossing back. It asserts the bytes and not just the length, so a binding accepted without running would not satisfy it. Without that pair, a lane narrowing `foreignTypeCanExecute` cannot tell an intended acceptance from a regression. |
| 7.22 | the remedies both diagnostics prescribe are reachable, and the channel they protect is real | the message text of `SMITHERS1507` and `SMITHERS1508` | **covered** | `09/a-foreign-factory-result-bound-to-a-local-is-accepted` and `09/a-foreign-callable-wrapped-in-a-local-adapter-is-accepted`. Both are `output` cases and both print `panic` on their second line, so they show the throw arriving as the distinguished checked panic case after crossing the boundary the refusal case was refused for. Without them a rule that refused *every* foreign factory call, or *every* callable argument, would satisfy 7.20 and 7.21 exactly and the corpus could not tell it from a correct one. |
| 7.18 | **a foreign `@throws {T}` claim the compiler cannot reify to one imported Error constructor is refused** | failures.mdx:115 (`@throws {T}` annotations "are trust claims and MUST remain visible in declarations and tooling") | **covered** | **`09/the-never-annotation-is-case-sensitive`**. Previously uncovered, and previously reference-only. Both halves moved: the fork now emits `SMITHERS1502`, and the case pins the sharpest instance of the rule — `@throws {Never}` is not the lowercase opt-out, so it is a declared channel naming a class that is not in scope, and it is refused (`SMITHERS1502`) with the call keeping its panic policy (`SMITHERS1301`). A case-insensitive comparison accepts the same source with no diagnostic at all and certifies the function infallible, which is the fail-open direction on the trust boundary. Still **not** blocked by 7.16's Open decision: what is open is which channel an overloaded or generic annotation produces, not whether an unreifiable one may be believed. |
| 7.7a | **…and the Result an untrusted foreign call lifts is charged by the same bound/unbound split as an authored producer** | type-system.mdx:60 and :56; the split the corpus pins in `07/result-must-be-consumed` (`SMITHERS1301` at an unbound producer) and `07/result-parameter-must-be-consumed` (`SMITHERS1302` at a binding) | **covered** — an `xfail go` position divergence until 2026-08-28, when the foreign lift was routed through the must-consume ownership walk instead of being charged beside the row | `09/an-untrusted-foreign-result-bound-to-a-name-is-charged-at-the-binding`. Both backends refuse the program and both are right about WHAT is wrong; the fork reports `SMITHERS1301` at the call where the reference reports `SMITHERS1302` at the binding, because its foreign-lift reporter does not know about bindings. Pre-existing, and visible only because the cascade suppression that was hiding the whole second diagnostic was removed — the ordinary shape of a fix, which does not create the defect underneath but stops concealing it. |
| 7.19 | **a re-export is a module edge and carries the same initialization trust claim an import does** | compatibility.mdx §Runtime TypeScript Dependency (Locked) | **covered, both backends** | **`09/a-re-exported-foreign-module-still-needs-a-trust-marker`** — the first corpus case in any area to contain a re-export. It carried an `xfail go` marker for one revision: the fork compiled and ran the program because it never examined an export declaration. The fork's `staticRuntimeModuleEdge` now owns runtime export declarations, the marker was measured `XPASS` and retired, and the retirement is recorded in the case's own `notes`. |
| 7.23 | **`panic(...)` is an exit and not a value: a placement the compiler cannot lower is refused rather than guessed at** (`SMITHERS1503`) | failures.mdx:113 (Locked) "A caller MUST propagate panic, explicitly catch it, or use a trusted adapter"; the POC narrows the lowerable placements | **covered** | **`09/panic-outside-a-statement-or-return-is-rejected`**, green on both. A POC lowering boundary rather than a specification sentence, pinned because an unpinned boundary is one the other implementation can put somewhere else. Its accepted twin is 7.12's `09/explicit-panic-charges-the-channel`, which uses the supported expression-statement placement, so the pair separates the *channel* rule from the *placement* rule. It also produced this revision's one measured backend wording difference: the two implementations spell this diagnostic's message with one word between them, which is why the case declares no `messageContains`. **Extended on 2026-08-27 (the capability-argument revision) to the TAG position, which is where this boundary was fail-open on BOTH backends**: a tagged template is a call with no call expression, and until that day `` panic`x` ``, `` abort`x` `` through a `const` alias, `` (panic satisfies typeof panic)`x` `` and `` Reflect.panic`x` `` all compiled — the fork lowering the last into a runtime `TypeError: Reflect.panic is not a function`. Since both backends accepted them, **no divergence could ever have been reported**, which is why this row read "covered" while the hole was open. `09/the-panic-intrinsic-is-a-call-and-not-a-template-tag` holds all four at `SMITHERS1503`, and its four spellings share no mechanism (bare identifier; a value binding; the type-only-wrapper table; an ambient member leaf test), so a rule keyed on the identifier `panic` closes exactly one of them. `09/an-ordinary-tagged-template-is-not-the-panic-intrinsic` is the acceptance guard that makes closing it that way impossible: it holds a LOCAL function named `panicTag`, a local object member literally named `panic`, and `String.raw`, alongside `panic(...)` and its alias still calling and still returning. The parenthesised tag `` (panic)`x` `` was measured during that revision and is refused identically on both backends at the same position and with the same message — recorded in the case's `notes` and deliberately not added, because it is a spelling nobody measured in the PRE-fix state. |
| 7.24 | **`panic(...)` MUST NOT force a return type to widen into `Result<A, Panic>`** | failures.mdx §Panic Does Not Widen a Return Type (the whole section, new on 2026-08-25); DECISIONS.md Locked, "the prohibition is on the compiler forcing it" | **covered, fourteen cases, both backends** | The rule is stated once and holds over a whole class of constructs, so it is pinned per construct rather than once: `09/a-panic-in-an-if-body-keeps-a-plain-return-type` (the replaced case — same `.sm`, new expectation), `a-panic-in-a-plain-return-function-does-not-widen-it`, `a-panic-as-a-concise-arrow-body-is-an-abort`, `a-panic-two-helpers-deep-leaves-both-callers-plain`, `an-accessor-may-read-its-state-through-a-panicking-helper`, `a-constructor-a-getter-and-a-setter-may-all-abort`, `an-object-literal-method-and-getter-may-abort`, `an-instance-and-a-static-method-may-abort-with-a-panic`, `a-generator-may-abort-with-a-panic`, `an-async-function-may-abort-with-a-panic`, `an-exported-void-assertion-needs-no-result-contract`, `an-inline-callback-may-abort-with-a-panic`, `reflect-panic-under-a-plain-return-type-is-the-same-abort`, and `an-unannotated-panicking-function-infers-no-result-to-swallow-it`. **All fourteen are `expect: output` and every one executes**, which is deliberate: the defect this rule closes was a program that compiled and misbehaved, so a diagnostics-only pin would have been the wrong instrument. **All fourteen fail against the tree with only the panic fix reverted**, with the observed pre-fix diagnostics recorded per case in each `notes` — `SMITHERS1101` on the declaration and `SMITHERS1301`/`SMITHERS1302`/`SMITHERS1303` at the call for most of them, `SMITHERS1102` for the exported form, and additionally `SMITHERS1105` (accessors, constructors, setters) or `SMITHERS1106` (generators) on the reference only. The three constructs where the refusal was a **contradiction with no legal spelling** — a getter, a constructor and a generator each simultaneously required to declare a Result and forbidden to — are why the class is enumerated instead of sampled. |
| 7.25 | **…but an author MAY still annotate `Result<A, Panic>` explicitly, and it still materializes** | failures.mdx §Panic Does Not Widen a Return Type: "An author MAY still annotate `Result<A, Panic>` explicitly to materialize a panic as a value; that is how panic is made explicitly catchable" | **covered, and deliberately unchanged** | `09/explicit-panic-charges-the-channel`, `09/reflect-panic-enters-the-panic-channel` and `09/a-panic-in-an-if-body-is-a-simple-exit` already pinned the annotated direction and were **not touched** by this revision — the last of these is the byte-for-byte annotated twin of the replaced case, and the pair is what makes the MUST-NOT and the MAY legible side by side. The panic lane measured all three emitting byte-identically before and after the rule. The MUST-NOT and the MAY are one rule with two halves and neither is safe to pin alone: pinning only the MUST-NOT licenses an implementation that stops materializing panics altogether, which would delete the only explicit catch the language has. |
| 7.26 | **the rule is scoped to `panic(...)`: an ordinary recoverable `throw`, an untrusted foreign call, and `throw new Panic(...)` all still widen** | failures.mdx §Compiler Lifting and DECISIONS Locked (a `throw error` infers `Result<A, E>`); failures.mdx §Foreign Exceptions and DECISIONS.md:291 (Locked, the foreign panic case is independent and retained); failures.mdx §Foreign Exceptions names exactly two spellings of the distinguished channel, `panic` from `smithers:exceptions` and `Reflect.panic` | **covered, three cases, both backends** | `09/an-ordinary-recoverable-throw-still-requires-a-result` (`SMITHERS1101@7:1`), `09/an-untrusted-foreign-call-propagated-with-bang-still-charges-panic` (`SMITHERS1101@3:1`, the postfix-`!` spelling beside 7.2's `return` spelling) and `09/throwing-a-panic-instance-is-an-ordinary-recoverable-exit` (`SMITHERS1101@3:1` + `SMITHERS1301@8:44`). **These three are the only cases in this revision that pin current behaviour rather than a fixed defect, and that is the point of them**: they were measured identical before and after the panic fix, which is the evidence that the fix was made at the panic charge and not at the widening machinery. §Panic Does Not Widen a Return Type derives itself from the premise that panic is tracked *separately from ordinary recoverable Error variants*; if `throw new Missing(...)` stopped widening too, the derivation would have no premise left and the recoverable channel would be gone. The foreign case carries a recorded tension: the section's own reasoning (a panic in `E` is consumable by `unwrapOr`/`recover`/`match`) applies verbatim to the foreign channel, which this row pins as still widening. That is a ledger question, named in the case's `notes` with the condition for rewriting both foreign cases together, and deliberately not settled here. `throw new Panic(...)` is a real foot-gun pinned at today's answer so a change of mind has to be deliberate. |
| 7.27 | **the panic materialization gate keys on the published row naming `Panic`, not on the function returning some Result** | failures.mdx §Foreign Exceptions: "The distinguished `panic` case is tracked separately from ordinary recoverable Error variants. Ordinary Result recovery MUST NOT swallow panic implicitly" | **covered — and this is the fail-open pin of this revision** | `09/an-inferred-error-channel-does-not-absorb-a-panic`. A function with **no return annotation** that both `throw`s a recoverable `Missing` and calls `panic(...)`. It genuinely has a Result channel, so an implementation deciding materialization by asking "does this function return some Result?" answers yes and turns the panic into the error variant of `Result<string, Missing>`. Measured against the pre-fix tree, this program **compiled with zero diagnostics on both backends and printed `"missing: empty key"`** — an invariant violation delivered into the caller's expected-error branch wearing the name of a lookup miss, with nothing reported before or during execution. It now prints `"panic: empty key"`, observed through `Result.try`, the only boundary that can see it. Lines 1 and 2 of the same program are the over-correction guard: an implementation that stopped materializing by dropping the whole failure row breaks them. Its third corner is 7.25's `explicit-panic-charges-the-channel`, the row that DOES name `Panic` and where materialization is required. Closing 7.24 without this gate would have widened the hole from "inferred functions only" to "always", which is why the pin is an `output` case that executes and not a row assertion. Its companion refusals are `09/unwrap-or-cannot-reach-a-panicking-plain-return-type` and `09/recover-cannot-reach-a-panicking-plain-return-type`, which say the same thing from the other side: on a function with no annotation the recovery surface does not merely fail, it does not exist (`TS2339`, with `messageContains` on the receiver type so the case cannot be satisfied by a `TS2339` about something else). The third member the section names, `match`, is deliberately not written — on a plain `string` receiver it resolves to `String.prototype.match` and produces a stock TypeScript cascade that is a fact about the JavaScript standard library, not about this rule. |
| 7.29 | **the two lowering boundaries the non-widening rule deliberately did not move** (`SMITHERS1505` at module top level, `SMITHERS1107` in a class static initializer block) | failures.mdx §Panic Does Not Widen a Return Type is scoped to a **function's** return type; neither position has one. Both codes are declared POC/fork lowering boundaries rather than normative sentences, of the same family as `SMITHERS1503` and `SMITHERS1511` | **covered, two cases, both backends, both measured unchanged across the revert** | `09/a-top-level-panic-is-still-refused` (`SMITHERS1505@3:1`) and `09/a-panic-in-a-static-initializer-block-is-still-refused` (`SMITHERS1107@4:3`). These close the enumeration §7.24 opens: of every construct that can host a `panic(...)`, these two are the only ones that must still be refused for a reason of their own, and **until this revision neither had a corpus case**. That mattered more than it sounds — the rule removed `SMITHERS1101` from every other member of the class, so a static block reads as one more member of a list while being governed by a different rule entirely, and a later lane widening §7.24 into "a panic is legal anywhere" would have broken nothing in the corpus. Moving either one means teaching the lowerer to emit a panic in that position, not relaxing a rule; if that happens, both cases are **rewritten to the accepted direction rather than deleted**. **One honest caveat, recorded in the top-level case's own `notes` rather than hidden:** the `SMITHERS1505` message argues from the reasoning §Panic Does Not Widen a Return Type just abolished ("cannot be represented as a checked Result"). The refusal is still right, for a different reason than the one it gives. No `messageContains` is declared, deliberately — the text is the part that should change, and pinning it would freeze the wrong argument into the contract. |
| 7.28 | **an accessor or generator that cannot carry a Result channel is refused** (`SMITHERS1105`, `SMITHERS1106`) | *no sentence names either code.* failures.mdx:190 requires only that a checked failure not be silently discarded; both codes are declared POC lowering boundaries (`poc/src/language/semantic.ts:1968`, `:1971`) of the same family as `SMITHERS1503` | **covered by an `xfail go` that is a documentation gap, not a defect verdict** | `09/a-fallible-getter-in-an-argument-still-needs-a-contract`. **The Go backend implements no `SMITHERS1105` and no `SMITHERS1106` at all** — neither code appears anywhere in the fork. That is not a missed shape but a missing rule, and it means the two backends have always disagreed on every fallible accessor, constructor and generator. It was invisible because those two codes sat in the worst bucket this page tracks: **spelled by one implementation and probed by no case**, which produces no divergence in either direction, ever. It became visible only when 7.24 removed `SMITHERS1101` from the *panicking* half of the same class, leaving the ordinary-`Error` half as the residual. **Both backends refuse this program** — the fork with `SMITHERS1303@8:19`, the reference with `SMITHERS1105@8:19` beside it — so no checked failure escapes and this is not a fail-open; `SMITHERS1303` is the refusal that matters, because it is the one about a failure channel crossing a value edge, and both report it at the same authored position. **Neither backend should move on this marker.** Retire it by implementing the two codes in the fork if the accessor limitation is made normative, or by dropping the declaration to `[SMITHERS1303@8:19]` if accessors may carry a channel or the limitation is declared implementation-defined. Read it beside 7.24's `an-accessor-may-read-its-state-through-a-panicking-helper`: the panicking twin of this program is now accepted and runs, because a getter that panics has no failure channel to lose — which is exactly why it lost its refusal and this one did not. |

| 7.30 | **`@throws {never}` opts a call out of the panic case INCLUDING for a callback argument the call was handed** | compatibility.mdx §Foreign Boundary (Locked) — the subject of "Trusted `@throws {never}` metadata opts out" is the **call**; requirements.mdx §Scoping (Locked) assigns the *deferred* half to the imported module — "Imported JavaScript or TypeScript that starts hidden background work owns that work"; failures.mdx §Panic Does Not Widen a Return Type is why "the callback must independently be panic-free" is not an available rule at all | **covered, seven cases, and the middle one is the fail-open guard** | Until 2026-08-25 `SMITHERS1509` claimed **every** callable argument at **every** foreign call, so the only route the language has for `process.on`, `setTimeout`, `socket.on` or `readline` was refused by the rule the binding existed to satisfy. The acceptance is `09/a-callback-registered-through-a-trusted-binding-is-accepted`, whose stdout is produced *by the listener*, so a registration accepted without ever running would not satisfy it. Its refusal twin is `09/a-callback-handed-to-an-untrusted-host-is-still-rejected` — the same program against the untrusted export of the **same module**, so nothing but the marker can be doing the work — and `09/a-module-trust-claim-is-not-a-call-site-opt-out`, which is the same again through a module carrying only the initialization claim. **`09/a-foreign-callable-handed-to-a-trusted-binding-is-still-rejected` is the fail-open guard and the most important case here**: before the fix `SMITHERS1509` covered this program too, and a fix that merely *suppressed* it for trusted calls would have left the program with no diagnostic at all. The refusal had to be **transferred** to `SMITHERS1508`, whose charter actually covers a callable minted in another module — see 7.21 — with the real Panic still charged to the enclosing row. The last three keep the acceptance narrow: `09/an-inferred-fallible-callback-into-a-trusted-host-still-needs-a-contract` (`SMITHERS1303`), `09/an-async-callback-into-a-trusted-host-still-has-no-owner` (`SMITHERS1404`) and `09/a-host-global-inside-a-trusted-registration-is-still-refused` (`SMITHERS1602`) — the callback's own inferred Result channel, its started work, and its body's authority are each owned by a rule that never reads the marker. Five of the seven fail against the pre-fix tree on **both** backends. Two carry an `xfail go`; see 7.31. |
| 7.31 | **an untrusted foreign call charges the caller's panic row, not merely a diagnostic** | compatibility.mdx §Foreign Boundary: "Calling an unannotated foreign runtime value MUST **add the checked `panic` case**" — adding the case is the row charge, and the diagnostic is downstream of it | **covered by an `xfail go` — a diagnostic-set divergence, not a soundness one** | `09/a-callback-handed-to-an-untrusted-host-is-still-rejected` and `09/a-module-trust-claim-is-not-a-call-site-opt-out` both declare `SMITHERS1101` at the enclosing declaration beside the `SMITHERS1301`/`SMITHERS1509` at the call. **Four more rows joined this class on 2026-08-26** — 7.16e's `09/a-foreign-index-signature-read-through-a-property-access-needs-an-adapter`, `…-through-an-element-access-needs-an-adapter`, `09/a-library-declared-member-of-a-foreign-value-still-needs-an-adapter` and `09/destructuring-a-foreign-value-runs-its-accessors`, each declaring `SMITHERS1101@3:1` beside a `SMITHERS1506` the fork now reports at the reference's position. Six rows, one omission, six different routes to it; they retire in one edit or the fix was partial. The first of the four is the row that used to be the register's fail-open: closing the read left the row charge behind, which is how one marker became six rather than none. The fork reports the latter two and not the first: its `checkForeignBoundaries` reports without calling anything equivalent to the reference's `recordForeignBoundary`. **Both backends refuse both programs**, so nothing escapes. What localizes it rather than leaving it a guess is 7.21's `09/a-foreign-callable-handed-to-a-trusted-binding-is-still-rejected`, which declares the same `SMITHERS1101` for the **neighbouring** `SMITHERS1508` and passes on both — so the fork's row machinery works and only this one reporter skips it. Invisible until this revision because no case had handed a callback to an untrusted host from inside a function with a plain return type. |
| 7.32 | **the module-initialization trust marker is matched with the exact case the specification prints** | failures.mdx §Foreign Exceptions (Locked): "`@throws {never}` removes the default panic case; `@throws {T}` declares the stated foreign error channel" — two productions of one syntax, separated only by the spelling inside the braces, and `T` is a TypeScript type name, which TypeScript matches case-sensitively | **covered — and this was a live fail-open on both backends until 2026-08-25** | **`09/miscased-trust-markers-do-not-confer-module-trust`**: three near misses in one case — `@throws {Never}`, `@MODULE`, `@THROWS` — each refused independently with its own `SMITHERS1510`, so a fix that closed one boundary and not the others is still visible. A case-insensitive comparison **merges the two productions**, and the implementation silently picks the opt-out: the same source becomes both the trusted claim and channel `Never`. The module half is the more dangerous of the two boundaries, because at the call site a miscased annotation still leaves `SMITHERS1502` and `SMITHERS1301` behind, whereas the module marker's only job is to *suppress* `SMITHERS1510` — so folding case there admits an unchecked foreign initializer with no diagnostic at all. Nine spellings were measured accepted before the fix and the real class is every casing of `module`, `throws` and `never`. `messageContains` declares the marker the author has to write, because code and position alone would be satisfied by a refusal for an unrelated reason — which a leading comment above the JSDoc produces, and which is why those support files have none. The 7.8b positives must keep passing beside it. |
| 7.33 | **…and at the CALL boundary the tag NAME is exact too, which fails more quietly than the brace content** | the same sentence; a JSDoc tag name is not case-folded by TypeScript's own JSDoc parser | **covered** | `09/a-miscased-throws-tag-name-is-not-an-annotation-at-all` declares **only** `SMITHERS1301`. 7.18's `09/the-never-annotation-is-case-sensitive` miscases the brace *content*, so the annotation is still an annotation and reports `SMITHERS1502` for a channel that cannot be reified. `@THROWS` yields **no annotation at all**, so there is nothing to reify and nothing to complain about — just the default panic case and the unconsumed Result. Two spellings, two failure modes, and only one leaves a second diagnostic behind: a case declaring `SMITHERS1502` here would have been wrong. This boundary was already correct on both backends; the case pins it so a tag-name comparison cannot quietly become case-insensitive the way the module one had. |

## 8. Requirements, capabilities, and layers

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 8.1 | a capability is an abstract class extending `Context`, declared with ordinary class syntax | requirements.mdx §Capability Identity | covered | every `05/*` and `06/*` case; `19/uses-clause-is-retired` pins the absence of a separate declaration form |
| 8.2 | `Capability.context()` adds the class to the enclosing `R` row and returns its instance type | requirements.mdx §Context Access | covered | `05/context-requirement-is-satisfied` |
| 8.2a | **…and the receiver is identified by resolved binding identity, not by syntactic form** | requirements.mdx:36: "The receiver MUST identify a `Context` subclass strongly enough for the compiler to record its nominal key" | covered | `05/a-capability-read-through-a-local-alias-charges-the-row` (a `const` alias; `messageContains` the capability's own name, because an empty row or one naming the local binding would satisfy code-and-position exactly) and `05/a-capability-read-through-a-local-alias-is-subtracted-by-its-layer`, which proves the resolved KEY rather than the refusal — the alias's row is subtracted by `Layer.succeed(Clock, …)` and the program prints `7`. REVIEW-fable-1.md F3 measured the fork accepting the alias with an empty row and panicking at runtime. The computed-receiver spelling of the same rule is `05/a-computed-context-access-charges-the-same-row` (12.12). |
| 8.2b | **…and when the receiver identifies NO single class, the read is REFUSED rather than silently charged to nothing or to one arm of it** (`SMITHERS2106`) | requirements.mdx:36, read in the closed direction: a receiver that does not identify the subclass "strongly enough" leaves nothing to record, and requirements.mdx §Satisfaction makes an unsatisfied capability an error | **covered as of 2026-08-26, four cases, and every one was a live fail-open on BOTH backends until that day** | 8.2a is the open direction of this sentence and could not see the closed one: an unresolvable receiver returned "not a context call" and fell through with no row and no diagnostic, so `Layer.provide` completeness, transitive caller rows and the top-level check all certified. The four: `05/a-ternary-receiver-does-not-identify-one-capability` (the SYNTACTIC arm — and the case worth reading first, because it is not an empty row but a **misattributed** one: TypeScript subtype-reduces `typeof Reader \| typeof Writer` to `typeof Reader`, so the certified row said `[Reader]`, a Reader-only layer satisfied it exactly, and the program panicked at run time with `capability 'Writer' was not provided`); `05/a-union-typed-capability-receiver-is-rejected` (the TYPE arm, with structurally different capabilities so no reduction occurs and the union really arrives intact); `05/a-generic-capability-receiver-is-rejected` (a type parameter, refused even though its constraint names exactly one class, because a subclass is still substitutable); and `05/a-tuple-element-capability-receiver-is-rejected` (a non-literal index into an `as const` capability registry, which no rule reading declared parameter types can see). The over-correction guard is `05/sound-capability-receivers-keep-their-row-and-run`, an `output` case whose thirteen receivers include two conditional ones whose branches agree, a `typeof Reader` parameter, and `(Reader as any)` recording the **correct** row rather than being refused. |
| 8.2c | **…and the compiler-recognized `Context.context` member cannot be DETACHED from its capability at all** (`SMITHERS2107`) | requirements.mdx §Context Access: "`Capability.context()` MUST be an inherited, compiler-recognized **call**" — recognition happens at the call, and a detached member reference leaves no call to recognize | **covered as of 2026-08-26, two cases, and this was the worst of the three receiver fail-opens** | `05/a-detached-context-reference-is-rejected` (`Reflect.apply(Reader.context, Reader, [])`) was **accepted with an empty row and RAN on both backends**, reading the capability out of a function whose certified row named nothing. `05/a-bound-context-reference-is-rejected` (`Reader.context.bind(Reader)()`) is a separate case rather than a fold-in because the two spellings had **different verdicts on different backends**: the reference refused the bind form *incidentally* with `TS2571` out of its prelude's typing, while the fork's looser typing accepted it — a verdict divergence resting on a typing accident. Both now answer `SMITHERS2107` alone on both backends, and **the corpus deliberately pins the SMITHERS code and not the TS one**: a frontend refusal short-circuits the emitted-TypeScript stage, so the incidental code is gone, and declaring it would have re-pinned the accident. The over-correction guard is `05/a-member-named-context-on-an-ordinary-value-stays-ordinary`, an `output` case covering a plain object's `context`, an ordinary class's static `context`, `Reflect.get` on a non-capability, and — the one an implementation breaks first — `typeof Reader.context` in a **type position**. Residual, recorded rather than papered over: `Reflect.get(Reader, computedKey)` with a non-literal key stays open on both backends. |
| 8.2d | **…and the boundary between a recognized CALL and a detached REFERENCE is one token wide, and both sides of it are now pinned** | requirements.mdx §Context Access: "`Capability.context()` MUST be an inherited, compiler-recognized **call**" | **covered as of 2026-08-27, as a pair, and the accepting half closed the seventh over-correction this repository has shipped** | 8.2c pins that a detached reference is refused. The fork then refused `(Reader.context)()` — a legitimate capability read — as detached, which is the same rule over-firing. `05/a-parenthesised-context-callee-is-still-a-context-call` is the acceptance half: five parenthesised-CALLEE spellings, including a doubled parenthesis, the same callee inside a template, inside a call argument, and inside a nested arrow, all subtracted by one layer and RUNNING. `05/a-detached-context-reference-is-refused-in-every-spelling` is the refusal half at four spellings 8.2c does not reach — as a call argument, as a PARENTHESISED call argument, through a `const` alias, and through `.call`. Lines 11 and 12 of that file are the matched pair: `take((Reader.context))` and `(Reader.context)()` differ by whether a call follows the parenthesis and must get OPPOSITE answers, which no rule keying on 'a parenthesis appears around `X.context`' can produce. `05/sound-capability-receivers-keep-their-row-and-run` is the cousin that covers parentheses around the RECEIVER; it did not cover the callee, and that gap is exactly where the fork fell. |
| 8.3 | requirement inference is transitive through ordinary calls | requirements.mdx §Inference | covered | `05/requirement-propagates-through-callers`, `05/one-layer-satisfies-a-capability-required-through-many-paths` |
| 8.3c | **…and an invocation with NO call expression is an ordinary call: a tagged template, a `new`, an implicit `super`, a `for-of`, a spread and a `yield*` all charge their callee's row** | requirements.mdx §Inference | **covered as of 2026-08-27, as a pair** | The row was dropped at every invocation form that is not a call-expression node, and the failure is silent and total — the row comes back empty, every downstream rule certifies, and the read aborts at run time. `05/an-invocation-with-no-call-expression-still-charges-its-row` declares six `SMITHERS2102`s. The sharpest is the **implicit super constructor**: `class Derived extends Base {}` has no constructor, no `super` call and no argument list anywhere in the source, so a walk over written syntax has nothing to visit. The three iterator forms are three rather than one because `for-of`, a spread and a `yield*` reach `Symbol.iterator` by different lowering paths. The over-correction guard is `05/ordinary-invocation-forms-with-no-call-expression-charge-nothing`, the same six forms over callees that read nothing, in a module that deliberately declares a capability and an uncalled function that reads it — so a rule charging the FORM has something to over-fire on. Deliberately excluded from both: coercion-protocol members and a decorator (the latter because the legacy two-argument spelling type-checks under the CLI's options and not under a bare option set, and a case whose green depends on which option set ran will break for the wrong reason). |
| 8.3d | **…and a COERCION is an ordinary call, at every spelling of the member and at every position that triggers one** | requirements.mdx §Inference; ECMAScript `OrdinaryToPrimitive` decides which member runs | **covered as of 2026-08-27, seven cases; 116 divergences were closed the same day with conformance reporting 0 divergent throughout, because no case spelled a coercion member any way but a method shorthand** | `05/every-spelling-of-a-coercion-member-charges-the-same-row` is an EQUALITY, not a list: ten spellings that were fail-open (arrow and function-expression property values, a computed key written as a string literal and through a `const`, a reference to a function declaration, a shorthand property, a class arrow FIELD, a nested property, a `const` alias, and a getter whose inferred return type is a function) declared beside six that both backends already charged. `05/a-computed-member-name-is-charged-to-the-scope-that-evaluates-it` settles WHICH function is the enclosing one — a computed name is evaluated where the object is built, not by the member it names — with three non-function-valued controls that identify the cause as the member boundary. `05/a-parenthesised-ambient-coercion-callee-charges-the-same-row` pins `(Number)(obj)`/`(String)(obj)` against their unparenthesised twins. The walk itself is pinned in BOTH fall-through directions, which is what stops a future lane flattening it: `05/coercion-members-that-never-run-charge-nothing` (a Db-reading `valueOf` at a string hint is NOT charged, and the printed `[object Object]` is the proof the walk stopped at `toString`) against `05/a-toString-returning-an-object-falls-through-to-valueOf` (when `toString` returns a non-primitive the walk continues and the row IS charged). `05/the-coercion-row-reaches-the-provide-site-and-runs` and `05/a-coercion-row-is-not-subtracted-by-the-wrong-layer` are the pair that says the row is RECORDED and travels rather than that the program was merely not refused — the accepting case alone cannot see a backend that recorded no row, because the layer is installed at run time either way. **Residual, measured and deliberately not pinned:** an explicitly annotated member type, an annotated getter return, and a helper that returns the object are accepted by BOTH backends (shared fail-open R1); `(JSON).stringify(obj)` is a shared fail-open in the member-receiver helper; and `JSON.stringify`/`toString` is a known over-approximation on both. |
| 8.3a | **…and an accessor access IS an ordinary call, in every spelling** | requirements.mdx §Inference; type-system.mdx §Fallibility Inference (`R` comes from `Capability.context()` calls and transitive callees) | **covered, five cases, and every one of them was a live fail-open until 2026-08-25** | Reading a get-accessor *calls* it — there is no syntax that names an accessor without running it — so it charges the accessor's requirement row. Before this revision **no accessor access charged its row anywhere, on either backend**: a getter read, a setter write, a get/set-pair read, an element access and a destructuring read all compiled with the capability silently dropped, and `SMITHERS1802` refused exactly one corner of that hole (cross-module, get-only, read) while nothing refused the rest. The cases: `05/a-cross-module-accessor-read-charges-the-capability-row` and `05/a-destructured-accessor-read-charges-the-capability-row` (coverage — a *satisfied* provide runs either way, which is why they are not the gate); `05/a-top-level-accessor-read-has-unsatisfied-requirements` and `05/a-top-level-accessor-write-has-unsatisfied-requirements` (`SMITHERS2102`, each with `messageContains` on the capability's own name); and **`06/layer-provide-missing-a-capability-an-accessor-introduces`**, which is the gate — see 8.7a. The destructured case carries **both** the plain and the renamed spelling on purpose: before the fix they disagreed with each other about one call, the plain form compiling with the row dropped while `const { value: n } = source` was refused, so a case carrying only the plain form would have pinned nothing. |
| 8.3b | **…and a CALLBACK boundary is an ordinary call: a capability read inside a callback charges the function that hands it over** | requirements.mdx §Inference ("Requirement inference MUST be transitive through ordinary calls"), read against the `SMITHERS1303`/`SMITHERS1404` precedent — the compiler already walks this exact value edge for the failure and async channels | **covered as of 2026-08-26, as a pair, and it was a live fail-open on BOTH backends** | The callback-boundary rules were asymmetric: a fallible callback is refused (`SMITHERS1303`), an async callback is refused (`SMITHERS1404`), and a callback that **requires a capability** crossed the same boundaries with the requirement deleted from every row. `xs.map((k) => Reader.context().read(k))` published `requirements: []`, so **8.7's obligation was escapable by inlining the read into a callback** — the shape `05/unsatisfied-top-level-requirement` pins for a direct call. `05/a-callback-capability-escapes-the-top-level-check` is the refusal (`SMITHERS2102`; the diagnostic IS the row assertion, because an empty row produces no diagnostic at all and neither backend exposes a row to an expectation — the Go fork's `CompileResult` protocol carries none). `05/a-capability-read-inside-a-callback-charges-the-caller` is the acceptance half and states what the refusal cannot: the row is subtracted by exactly `Layer.succeed(Reader, …)`, which is the observable form of "the key is Reader". That second case is also the **over-correction guard**, and the over-correction is specific: `Layer.provide`'s own computation must NOT be charged the capabilities its layer provides, or every provide republishes to its caller exactly what it satisfies. Residuals, mirrored on both backends rather than closed: a closure **returned** from a function and one pushed into a module-level array still publish `[]`, because propagation is the wrong tool for a requirement needed later — requirements.mdx §Inference leaves the encoding of a row on a function TYPE explicitly open. |
| 8.4 | requirements propagate across module boundaries | requirements.mdx §Inference; poc README | covered | `05/requirement-propagates-across-modules` |
| 8.5 | duplicate nominal requirements collapse | requirements.mdx §Inference | **partial** | `05/one-layer-satisfies-a-capability-required-through-many-paths` pins the observable consequence (one provider satisfies every route). Row de-duplication itself is row text — see "Known observation gaps" #1. |
| 8.6 | two structurally identical Context subclasses stay different requirements | requirements.mdx §Capability Identity | covered | `05/structurally-identical-contexts-are-distinct-requirements` |
| 8.6a | **…and `super.context()` in a static charges the CONTAINING capability, not the base class the checker's type for `super` names** | requirements.mdx §Capability Identity (identity is nominal) + §Context Access (the receiver identifies the subclass whose key is recorded) | **covered as of 2026-08-26** | `05/a-super-context-read-charges-the-containing-capability`. A static `super.context()` invokes the inherited static with `this` still bound to the subclass, so `typeof Base` — which is what the checker gives for `super` — is the one key that read can **never** have; both backends recorded it anyway until this revision and the program panicked. This is the one case in the family that asserts a **ROW** rather than a refusal, and the only shape that can: the layer provides the base, `SMITHERS2101` names what is missing, and a backend recording the base would find the layer complete and report nothing. `messageContains` is the capability's own name for that reason — it is the entire content of the case — and the bare name is a substring of both renderings (`missing Registry` on the reference, `missing {Registry}` on the fork), measured on both rather than assumed. It deliberately does **not** settle the wider subtyping question (does `typeof Base` cover `typeof Sub`?), which stays a recorded residual on both backends; `super` is narrower and fully decided. |
| 8.7 | an unsatisfied capability in a known closure is a compile error | requirements.mdx §Satisfaction | covered | `05/unsatisfied-top-level-requirement`, `06/layer-provide-missing-a-capability` |
| 8.7a | **…including a capability that only an accessor read introduces** | requirements.mdx §Satisfaction | **covered, and this is the load-bearing case of the accessor set** | **`06/layer-provide-missing-a-capability-an-accessor-introduces`**. The body requires `Label` directly and `Clock` only through `source.value`; the layer supplies `Label`. Before 2026-08-25 this program **compiled with zero diagnostics on both backends and aborted at run time**. It is the only shape that discriminates "the accessor's row travels" from "the accessor's row vanishes", because a satisfied provide runs either way — which is exactly why the two acceptance cases at 8.3a are labelled coverage and this one is the gate. `messageContains` names `Clock`, the capability the layer does **not** supply, so a refusal naming the one it does cannot satisfy it; verified by mutating the declared name red and back on both backends. |
| 8.7b | **…and the read written DIRECTLY at module top level is charged to the module, not to nobody** | requirements.mdx §Satisfaction: "When the compiler knows the complete closure, an unsatisfied capability MUST be a compile error" — module top level is where the closure is complete, because no caller is left to propagate to | **covered as of 2026-08-26, and it was a live fail-open on BOTH backends** | 8.7's `05/unsatisfied-top-level-requirement` pins the **indirect** spelling: a top-level call to a function whose row names the capability. The direct spelling was charged to nobody, because the machinery that recognizes `Capability.context()` runs per function body and module top level is not one — so `export const entry = Directory.context().lookup("ada")` compiled with zero diagnostics and panicked at run time. A one-line program shape the corpus already pinned was open in its one-line form. `05/a-top-level-capability-read-is-rejected` closes it, and the pair is the evidence that the rule reads the **requirement** rather than the call graph. The acceptance guard is `05/a-capability-read-inside-a-callback-charges-the-caller`, whose read is reachable from module scope through a `Layer.provide` computation and must keep running. Pre-existing observation, untouched by this revision and flagged rather than fixed: a class **field initializer** is treated as module top level by this rule, though it executes at construction, which can be inside a provide scope. |
| 8.8 | providing a layer removes matching capabilities from the row | requirements.mdx §Satisfaction | covered | `05/context-requirement-is-satisfied`, `06/layer-merge-satisfies-both` |
| 8.9 | provided implementations are scoped to the provided computation | requirements.mdx §Scoping | covered | `05/capability-is-unavailable-outside-the-provided-scope`, `06/nested-provide-scopes-are-independent` |
| 8.10 | a base Layer receives an already-acquired service and does not own its lifetime | requirements.mdx §Layer Algebra; DECISIONS Locked | covered | `06/layer-receives-an-already-acquired-service` |
| 8.11 | an opaque Layer expression fails closed | poc README SMITHERS2104 | covered | `06/opaque-layer-is-rejected` |
| 8.11a | **…and a TYPE-ONLY wrapper around a layer is not opaqueness: `satisfies`, `as`, an angle-bracket assertion and a parenthesis are erased before anything runs, so the layer under them is the same layer** | requirements.mdx §Layer Algebra ("the compiler recognizes their effect on `R`") + §Satisfaction | **covered as of 2026-08-27, five cases, and until that day NO case anywhere in the corpus put a wrapper near a layer** | This is the gap that let the fork fail open at 143 measured cells while conformance reported 0 divergent, and it is the clearest instance on this page of a defect surviving because nothing spelled it. `06/a-layer-through-a-type-only-wrapper-is-the-same-layer` is the acceptance half: eight wrappers — `satisfies`, `as`, `<T>`, `as unknown as`, a wrapper on a `const` INITIALIZER rather than on the argument, a wrapped operand of `Layer.merge`, and two wrappers on the CAPABILITY argument of `Layer.succeed` — all resolved, all subtracted by one provider, and the program RUNS. `06/a-wrapped-layer-missing-a-capability-names-it` is the discriminator that makes it mean something: a wrapper must not degrade a precise `SMITHERS2101` into `SMITHERS2104`, and `messageContains` names the capability the layer does NOT supply so a refusal naming the supplied one cannot satisfy it. `06/a-laundering-assertion-does-not-change-which-capability-a-layer-provides` is the case a future "resolve the layer from its checker TYPE" rewrite breaks: `Layer.succeed(Clock, clock) as unknown as Layer<typeof Directory>` provides Clock, and a type-reading resolver certifies it as complete and the program panics. `06/a-wrapper-does-not-make-an-opaque-layer-transparent` holds the other direction — a reassigned `let` and a `?:` stay `SMITHERS2104` under the same `satisfies`. `06/a-non-null-assertion-is-not-a-type-only-wrapper` records which spellings are IN the table by pinning one that is out: `!` draws `SMITHERS1207` + `SMITHERS2104` (declared as a set; the two backends emit them in opposite order). **That residual is CLOSED as of the capability-argument revision, 2026-08-27, and needed no marker.** This row read "*Residual, measured and deliberately not pinned:* laundering at the CAPABILITY argument (`Layer.succeed(Directory as unknown as typeof Clock, clock)`) is a live divergence — the fork reads the checker type there, accepts, and panics — and a case for it would need a `go-xfail`." Two lanes applied `SMITHERS2106`'s settled resolution rule at that argument in both implementations, and three cases now hold it, green on both: `06/a-laundering-capability-argument-names-the-capability-the-runtime-registers` is that exact program (`SMITHERS2101@26:20`, `messageContains` naming Directory, because a refusal naming Clock is the plausible wrong answer); `06/a-capability-argument-that-pins-no-single-class-is-opaque` is the half the layer position had no analogue for — two `SMITHERS2104`, and its SECOND provide uses a capability declared structurally identical to `Directory`, so `typeof Directory \| typeof Journal` subtype-reduces to one arm and a type-directed resolver accepts it, which is precisely what the fork did; and `06/a-type-erased-capability-argument-is-the-same-capability` is the acceptance guard for the erasing wrappers (`<any>`, `as any`) and the `const` value alias, where the REFERENCE was the wrong one — it recorded a phantom row named after the alias identifier rather than the class. See §"How and when this page was measured", eighth revision. **What is still not pinned there, and is named in both `06-layers` cases' `notes`:** a REASSIGNED binding at the capability argument (`let C = Directory; C = Twin; Layer.succeed(C, directory)`) is accepted and panics on BOTH backends — `SMITHERS2106`'s own residual, identical at the `.context()` receiver, held as a known-residual unit test rather than as a corpus case that could only pin today's acceptance. |
| 8.11b | **…and a MUTABLE layer binding is opaque, because the initializer is not what `Layer.provide` receives** | requirements.mdx §Layer Algebra + §Satisfaction | **covered as of 2026-08-27** | `06/a-mutable-layer-binding-is-opaque` — a `let`, a `var`, and a binding reassigned only from **inside a function**. The third is the load-bearing one: a scope-local scan sees a binding assigned exactly once at its declaration and follows it happily, and the certified program then panics because the registry holds the reassigned layer. The negative direction is not duplicated in that file on purpose — `06/layer-provide-missing-a-capability` (a `const` layer that really is missing a capability must answer `SMITHERS2101`, NOT `SMITHERS2104`) and `06/layer-merge-satisfies-both` (a `const` layer that resolves and RUNS) are what stop this rule degrading a precise diagnosis into an opaque one. |
| 8.12 | a fallible `Layer.provide` callback needs an explicit Result contract | poc README SMITHERS2105 | covered | `06/fallible-provide-callback-needs-a-contract` |
| 8.13 | platform-sensitive functionality uses requirements | requirements.mdx §Platform Requirements | covered | `05/*`, `20-host-globals/*` |
| 8.14 | **portability is determined from the satisfied dependency closure, not the import path** | requirements.mdx §Platform Requirements | covered | **`21/a-pin-is-checked-over-the-closure-not-the-module`** — a TypeScript-requiring sibling the pinned function never calls does not block the pin |
| 8.15 | `Layer.provide` keeps its environment active through the Promise the body returns, revoking at settlement before queued reactions | requirements.mdx §Scoping; DECISIONS Locked | **unwritable: the harness cannot express a host-conditional expectation** | Re-measured 2026-08-23 on both backends with the documented `async () => await …` adapter shape. **Go/node runs it and prints the value. JS/bun refuses it** with `TypeError: Layer.provide cannot keep an async environment on this host: exact Promise settlement hooks are unavailable` (`poc/src/runtime/layer.ts:98`). Both are conformant: the same Locked entry says "A host without a synchronous Promise-settlement hook must fail closed for an async Layer scope rather than leave authority live for an extra microtask." So this is not an xfail — an xfail would mislabel conformant behavior as a defect. **What the harness would need:** either a per-backend expectation, or a declared host-capability predicate in the expectation schema so one case can state both conformant outcomes. The invariant both hosts *must* share — authority is never available after the scope ends — **is** pinned, by `05/capability-is-unavailable-outside-the-provided-scope`. |
| 8.16 | nested scope override precedence | requirements.mdx §Scoping ("a future explicit precedence rule"); DECISIONS **Open** | unwritable | **blocked on an Open decision.** `06/nested-provide-scopes-are-independent` pins only the locked part: each scope is active for its own body and composes additively. |
| 8.17 | Layer merge/override semantics and requirement-environment lowering | DECISIONS **Open** (unresolved design work item 4) | unwritable | **blocked on an Open decision**, by the ledger's own admission |
| 8.18 | the declaration encoding of the context row | DECISIONS **Open**; requirements.mdx §Lowering ("Ambient runtime context is not a locked implementation choice") | unwritable | **blocked on an Open decision.** The corpus deliberately observes only source-level behavior, which the same entry requires be unchanged by whichever encoding wins. |
| 8.19 | **a `Layer.provide` callback the compiler cannot resolve to a checked local function is refused** (`SMITHERS2103`) | requirements.mdx §Satisfaction (Locked): "When the compiler knows the complete closure, an unsatisfied capability MUST be a compile error" | **covered** | **`06/a-provide-callback-that-is-not-a-local-function-is-rejected`**, green on both. This is the "what is REQUIRED" half of *knowing the complete closure*; 8.11's `06/opaque-layer-is-rejected` (`SMITHERS2104`) is the "what is PROVIDED" half, and the two had never been read as a pair. The fail-open direction is specific: accepting an unresolvable callback publishes an EMPTY unsatisfied row for a body that may require anything, which silently disables 8.7's obligation for every provide written that way. |
| 8.20 | **`Layer.provide` keeps its environment active THROUGH the callback, so what the callback reads is reachable** | requirements.mdx §Scoping (Locked) | **covered, one backend** | **`21/a-layer-provide-callback-is-part-of-the-pinned-graph`** and **`21/a-layer-provided-capability-is-subtracted-and-the-pin-still-holds`**, written as a pair. The first requires the callback to be entered; the second is an `expect: "output"` case that requires what the layer provides to be subtracted afterwards, including through an ordinary call. Satisfying either alone is easy and wrong — skip the callback and the second passes for the wrong reason, report everything found inside a provide and the first passes for the wrong reason. Both are green on both backends. |
| 8.21 | **layer satisfaction subtracts nominal capability rows and nothing else: a provider cannot withdraw a built-in requirement** | requirements.mdx §Satisfaction + §TypeScript Requirement (Locked); compatibility.mdx §Native Pin: "Compilation MUST fail if any reachable operation **or provider** requires TypeScript" | **covered by an `xfail go` — a live fork fail-open** | **`21/a-layer-cannot-subtract-a-requirement-that-blocks-the-pin`**. A capability's row name is a class name and class names are whatever the author writes, so `abstract class TypeScript extends Context` plus `Layer.succeed(TypeScript, …)` is one identifier away from certifying `eval` as native-portable. **The fork does exactly that**: it accepts the program, grants the pin, and runs it, while refusing the byte-identical program with the capability renamed `Config`. See the register. |

`SMITHERS2101` is reported only for a `Layer.provide` at module top level
(`!nearestFunction(edge.node)` in `poc/src/language/semantic.ts`). Inside a
function the unsatisfied requirement propagates to the caller's row instead,
which is consistent with requirements.mdx §Satisfaction's qualifier "**when the
compiler knows the complete closure**". Negative Layer cases therefore place the
`Layer.provide` at top level deliberately.

## 9. Host globals and platform surface

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 9.1 | `process`, `window`, `document`, filesystem, network are not ambient globals | compatibility.mdx §Host Globals; DECISIONS Locked | covered | `20/host-globals-are-unavailable` |
| 9.2 | host-sensitive clock access still requires a capability | compatibility.mdx §Host Globals | covered | `20/clock-access-needs-a-capability` |
| 9.3 | host-sensitive randomness still requires a capability | compatibility.mdx §Host Globals | covered | `20/random-access-needs-a-capability` |
| 9.4 | facilities present in every environment may stay unconditional globals | compatibility.mdx §Host Globals | covered | `20/universal-globals-stay-available` |
| 9.4a | **…and the rule is per-OPERATION, so `value instanceof Date` is a prototype test rather than a clock read** | compatibility.mdx §Host Globals ("Host-sensitive **operations** such as clock and random access") | **covered as a pair** | `20/value-instanceof-date-is-a-prototype-test-not-a-clock-read` (accepted; `new Date(0)` on its second line is the already-exempt authored-instant form and doubles as its own control) and `20/the-date-constructor-in-a-value-position-is-still-charged` (`SMITHERS1602`). Both backends charged `SMITHERS1602` on `instanceof Date` until 2026-08-25 even though `Date.parse`, `Date.UTC` and `new Date(<instant>)` were already exempt on exactly the same reasoning — the form was simply missed. The refusal half is why the exemption is narrow: only the **right** operand is exempt, because the object in a value position is one property access away from `now()`. Without it, "the right operand of `instanceof`" could be widened to "any mention of `Date`" and nothing would notice. |
| 9.5a | **the prohibition is scoped to authored `.sm`, and the implementation side is ASSIGNED rather than left open** | compatibility.mdx §Host Globals ("in authored `.sm` code"); reference/capabilities.mdx §Platform Services ("JavaScript hosts provide live implementations"); compatibility.mdx §Source Relationship (`.ts` "MUST retain their own complete syntax and behavior") | **covered as a pair, and the pair is the whole argument** | `20/a-capability-implementation-reads-the-host-through-a-trusted-binding` — an abstract capability, its live implementation, its Layer and its consumer all authored in `.sm`, with the single host read in a trusted `.ts` binding — and `20/a-class-that-looks-like-a-capability-implementation-still-cannot-read-a-host-global` (`SMITHERS1602`), which is the **same program with the host read moved into the `.sm`**. Together they say the opt-out is the module boundary and there is no implementation-side opt-out claimable from `.sm`: extending a `Context` subclass, being the declared capability's implementation shape, and being named like one all buy nothing, because the rule never consults any of them. Read the second one as the guard on the first: if a later lane ever adds an implementation-side opt-out, that case is what stops it from being claimable by ordinary code. Both pin current behaviour — no compiler change was needed for either, which is itself the finding. |
| 9.1a | **the prohibition is a CLASS, not a spelling list: `and similar host facilities` cannot be enumerated against a namespace the host may extend, so the rule is an allowlist over the ECMA-262 global object** | compatibility.mdx §Host Globals (the MUST NOT is open-ended; the second clause is a **MAY**, so refusing a universally present host facility is spec-legal where admitting a platform-specific one is not); DECISIONS Locked | **covered as of 2026-08-26** | Four refusal cases, each a different class of host authority and each demonstrated failing on a reconstructed pre-change tree: `20/globalthis-aliases-are-refused` (`self`, `top`, `parent`, `frames` — the same object under four spellings, and `self.fetch(...)` compiled clean while `fetch(...)` did not, which is what makes this the case that proves the rule is an allowlist), `20/network-and-thread-globals-are-refused` (`XMLHttpRequest`, `WebSocket`, `EventSource`, `Worker` — `fetch` was the only network global the rule knew), `20/host-identity-globals-are-refused` (`navigator`, `location`, `localStorage`, `sessionStorage`), and `20/scheduling-and-clone-globals-are-refused` (`queueMicrotask`, `clearTimeout`, `clearInterval`, `structuredClone` — the siblings of the two `set*` names that WERE refused, which is the exact shape of a denylist rather than a rule). **THE SPECIFICATION DOES NOT SETTLE WHERE THE LINE FALLS** for universally present non-ECMA-262 globals (`URL`, `TextEncoder`, `AbortController`, `atob`/`btoa`, the streams and fetch types); the implementation refuses them because the MUST NOT/MAY asymmetry makes that the safe direction and because it is the only completable rule, and a specification amendment should say so explicitly. |
| 9.1b | **the Node global scope and the CommonJS module wrapper are host facilities, and four of them do not exist in the emitted ESM at all** | compatibility.mdx §Host Globals | **covered as of 2026-08-26** | `20/the-node-global-scope-is-refused`. This is also the **backend-agreement pin for the ambient name environment**: the reference frontend runs against the installed `@types` packages and the pinned fork carries none, so these eight names used to answer `clean` on one backend and `TS2591`/`TS2304` on the other — a divergence no corpus case could see unless the *language* answers, which is why they are refused BY NAME rather than left to whichever ambient lib is installed. On the pre-change tree this case scored `js FAIL / go unsupported`; it now passes on both. `__dirname`, `__filename`, `module` and `exports` are worse than unportable — the compiler emits ESM, where they are a guaranteed `ReferenceError` inside a function whose row reads `failures: []`. |
| 9.4b | **the allowlist is wide enough to carry the standard library: the ECMAScript-262 global object stays unconditionally available** | compatibility.mdx §Host Globals ("Facilities truly present in every supported JavaScript environment MAY be unconditional globals"); DECISIONS Locked | **covered as of 2026-08-26** | `20/the-ecmascript-global-object-stays-available`, an `output` case exercising fifteen ECMA-262 clause-19 members. 9.4's `20/universal-globals-stay-available` covers four names; this covers the breadth, because the failure mode of inverting a denylist is an allowlist that is **too narrow**, and a narrow one takes the whole `.sm` standard library with it. Green before the change and after, so it was proved enforced by mutation rather than by a pre-fix demonstration. |
| 9.4c | **an identifier the program declares nowhere is an ordinary unresolved name, not an ambient host global** | compatibility.mdx §Host Globals, read for what it does NOT reach | **covered as of 2026-08-26** | `20/an-unresolved-name-is-not-a-host-global` (`TS2304`). A SMITHERS error preempts the TypeScript check entirely, so answering a typo with "ambient host global … is unavailable" would REPLACE the diagnostic that names the real problem. `19/builtin-optional-is-unresolved` pins this shape for a type name; this pins it for a **value**, which is the position the allowlist reads. Both backends report `TS2304` here from different stages — the reference from its stock check of the emitted module, mapped back through the compiler's source map — so it was confirmed on both rather than inferred from the type-name case. |
| 9.1c | **…and a host-authority namespace with NO identifier to key on is still host authority: `import.meta` is refused, and `new.target` is not** | compatibility.mdx §Host Globals, by the allowlist's own criterion — ECMA-262 delegates the properties of `import.meta` to the host through `HostGetImportMetaProperties`, which is precisely what makes something a host facility | **covered as of 2026-08-26, as a pair, and it also closes a live BACKEND DIVERGENCE** | `checkHostGlobals` is identifier-keyed and `import.meta` is a **meta-property**, so it carries no identifier and the whole rule never saw it: `import.meta.url` compiled with `requirements: []` on both backends and **ran, printing the host filesystem path**, while `__dirname` is refused BY NAME two rows above. `20/the-import-meta-namespace-is-refused` declares four `SMITHERS1601`s, all at the `import` keyword — the refusal is the namespace, not the property selected off it, which is what makes a fifth spelling nobody enumerated refuse too. Two of the four (`dirname`, `filename`) were a live divergence before this revision: the reference accepted them and the fork answered `TS2339`, which is exactly the "`types: []` makes the two agree by construction" claim failing for an interface whose shape still comes from whichever ambient lib each backend carries. The guard is `20/the-other-meta-property-stays-available`, an `output` case: the two meta-properties share a syntax node and differ only in a keyword token, so the cheapest wrong implementation refuses the **node** — it passes the refusal case perfectly and is caught only here. Not written and recorded as such: `import.meta` inside an imported `.ts` module stays accepted on both backends (compatibility.mdx §Source Relationship), and pinning it needs a file in `conformance/support/`. |
| 9.1e | **DETERMINISM-HOSTILE globals are refused by NAME even though ECMA-262 publishes them, and the refusal offers no capability because none could exist** (`SMITHERS1605`) | compatibility.mdx §Determinism-Sensitive Members, rows one and two (`WeakRef`, `FinalizationRegistry` and `SharedArrayBuffer`, `Atomics` "MUST NOT be unconditional globals") | **covered as of 2026-08-28, and all four were a fail-open on BOTH backends until that day** | The gap was not a missing rule but an asserting one: all four were *listed* in `UNIVERSAL_GLOBALS` (`poc/src/language/semantic.ts`) and in the fork's byte-for-byte `universalGlobals` (`compiler/forkbridge/hostrules.go.txt`), so the allowlist stated the opposite of two `MUST NOT`s. Measured: `new WeakRef(o).deref()`, `new FinalizationRegistry(() => {})`, `new SharedArrayBuffer(8)` and `Atomics.load(…)` each compiled with zero diagnostics and an empty requirement row, in the same file where the `Date.now()` control reported `SMITHERS1602`. **THE CODE IS THE POINT**: this is not `SMITHERS1601`, whose message ends "access it through a Context capability", because the two rows say in as many words that no capability can mediate these and no journal entry can describe them — so 1601 would name a remedy that cannot be built. `SMITHERS1604` is the precedent for a refusal that carries its own reason for the same argument. Unlike 1604 the line is the **name** rather than the operation, because every value use of `WeakRef` is construction and every member of `Atomics` is a shared-memory operation, so there is no safe read to preserve. **The acceptance guard is not optional and is `20/determinism-hostile-siblings-stay-available`**: `WeakMap`, `WeakSet`, `ArrayBuffer`, `DataView` and the typed arrays all compile and RUN. Without it the rule can be widened to "any weak collection or buffer" and the refusal case stays green — the same shape 9.4b guards for the allowlist and `20/the-function-type-and-prototype-test-stay-available` guards for 9.1d. Refusal case: `20/determinism-hostile-globals-are-refused`. Rows three, four and five of the same specification table (`Promise.race`/`any` → `Scheduler`, `Date` instance members → `Clock`, `Intl`/`localeCompare` → `Locale`) are **not** covered here and stay recorded as `(SA-4)`. Re-measured 2026-08-28, NOT because "the ambient vocabulary" lacks a requirement kind — the requirement row admits any `Context` subclass and `Scheduler.context()` already publishes `requirements: ["Scheduler"]` (a locally declared `Locale` publishes `["Locale"]`), while `Date.now()` publishes `requirements: []` beside its `SMITHERS1602`, so no ambient site charges a row for any kind and `"Clock" | "Random" | "Host"` is a diagnostic-category discriminator that needs nothing added to it. **The verb was DECIDED on 2026-08-28: charge.** `Promise.race`/`Promise.any` stay legal and publish a `Scheduler` requirement a layer satisfies; `durable-execution.mdx` §Deterministic Scheduling won unchanged and `compatibility.mdx` was amended to match — "charge" is now defined under its table, and the criterion that reconciles the two pages is stated there: the ambient spelling is *additionally* refused only where the capability has a source-language surface the author could write instead, which is why `Clock`/`Random` stay `SMITHERS1602`/`1603`. **No code implements it here**; it needs an ambient site injecting a nominal key into `R` plus a `race`→scheduler lowering and lands with migration step 7, and `Promise.race` is unchanged today — measured compiling, running, and publishing an empty row beside `Promise.all`, which does the same. Row five's verb is still open, because it turns on whether `Locale` is given a source-language surface. Measured cost of settling row three: **0** of 591 authored `.sm` files name `Promise.race`/`Promise.any`, so it moves no case and no test. Row five's cost is larger than previously recorded, because its MEMBERSHIP was: the row named four ICU members and the hazard covers **thirty**, re-derived on 2026-08-28 by sweeping the ambient lib for `Intl` value members, `toLocale*`, `localeCompare` and `normalize` and measuring each spelling — an earlier estimate of fifteen was fifteen short. All thirty measure **identically** today (no diagnostic, empty row, both backends), so widening the row recorded no behavioural change; `20/intl-locale-formatting-is-not-a-clock-read` and its mirrored fork subtest were widened with it (see 9.9a) and `Intl.getCanonicalLocales` no longer "stays legal either way", being a function of the host's CLDR alias data. `Error.prototype.stack` is host-varying, named by no page, measures unclassified, and is deliberately LEFT undecided: ECMA-262 publishes no such property, so the allowlist's ECMA-262-membership criterion does not reach it; its variance is across engines rather than between two hosts at one instant, which the page answers with a SHOULD about pinning an engine version; and it is the only stack-trace surface the language has. |
| 9.1d | **DYNAMIC CODE EVALUATION reaches the whole host namespace with no identifier for the allowlist to key on, so the operation is refused while the name stays resolvable** (`SMITHERS1604`) | compatibility.mdx §Host Globals (`process`… MUST NOT be unconditional globals in authored `.sm`) and (host-sensitive operations MUST still use capabilities), read against `eval`; **and it CONTRADICTS compatibility.mdx §Dynamic Features, which needs amending — see 1.6** | **covered as of 2026-08-27, six cases, and twenty of twenty-two measured spellings were a fail-open on BOTH backends until that day** | The escape: `eval("process.platform")` returned the host platform, `eval("Date.now()")` read the clock, `eval("Math.random()")` bypassed `SMITHERS1603` — every one with `failures: []` and `requirements: []` and every one RUNNING, so 9.1, 9.2 and 9.3 were all escapable through one string. Five refusal cases: `20/eval-reaches-the-host-namespace`, `20/eval-reaches-the-clock-and-randomness` (two diagnostics, one per host-sensitive operation, in separate functions so neither can be a cascade of the other), `20/the-function-constructor-is-dynamic-code-evaluation` (`new Function` beside `Reflect.construct(Function, …)`, which writes no `new` keyword — a rule keyed on `NewExpression` closes one and not the other), `20/a-callables-constructor-is-the-function-constructor` (the spelling that reaches the constructor **without naming it**, since every callable inherits `constructor` from `Function.prototype`), and `20/an-aliased-constructor-key-is-the-function-constructor`, which is the intersection with 12.12a and the only case showing either rule is total. **THE RULE IS ON THE READ, NOT THE CALL**, which is why every declared column is an identifier or a member name rather than a call site: twenty of the twenty-two spellings reach the callee through a read — an alias, `(0, eval)`, a shorthand `{ eval }`, `Reflect.apply(Function, …)`, `Function.prototype.constructor` — so a rule keyed on the call closes one spelling and none of the others. `Date` already draws the line here; 9.4a's `20/the-date-constructor-in-a-value-position-is-still-charged` is the same shape. **The acceptance guard is not optional and is `20/the-function-type-and-prototype-test-stay-available`**: `callback: Function` as a type annotation, `f instanceof Function` as a prototype test, and `({ a: 1 }).constructor` as an ordinary member all compile and RUN. Without it the rule can be widened to "any mention of `Function`" and all five refusal cases stay green. Residuals recorded rather than closed: `Object.getPrototypeOf(fn).constructor` still escapes on both backends because `getPrototypeOf` is declared `any` in `lib.es5.d.ts`, and `Function.prototype[Symbol.hasInstance]` is a deliberate over-refusal accepted with reasons by the lane that wrote the rule. |
| 9.5 | direct host-module usage carries an exact `Module<"node:fs">` requirement | compatibility.mdx §Host Modules (**Direction**) | covered as **Direction evidence** | `21/a-pin-reaching-a-host-module-is-rejected` — `poc/src/targets/classify.ts` spells the requirement `Module<"node:fs">` and `blocksNativePin` rejects it. The *rule* is Direction, so the case pins the implementation's chosen spelling and says so in its notes rather than claiming a locked obligation. |

### 9.6–9.13 The host-sensitive global classification table

`compatibility.mdx` §Host Globals is a MUST and `requirements.mdx` §Platform
Requirements restates it. Behind that one sentence the reference implements a
real nine-branch decision table, twice: `poc/src/language/semantic.ts:4450-4469`
(`ambientRequirementsForMembers`, reached through
`ambientRequirementsForRootUse` at `:4427-4447`) and its near-mirror
`poc/src/targets/classify.ts:978-994`. The matrix has never listed the branches.
`20-host-globals` has four cases, and one of them is about a different
obligation.

The two copies are not identical: `semantic.ts:4466` spells the non-random
`crypto` requirement `"Host"` and `classify.ts:991` spells it `'Host<"crypto">'`.
No case observes either spelling.

Fail-open direction throughout: an **uncharged** host-sensitive operation is
effectful code that looks pure, and it feeds straight into the native pin
(§10.6), which would then certify it as portable.

| # | branch | evidence | status | cases |
| --- | --- | --- | --- | --- |
| 9.6 | `Date.now` charges `Clock` | `semantic.ts:4461` | covered, **at three key spellings as of 2026-08-27** | `20/clock-access-needs-a-capability` (dotted), `20/a-computed-date-now-is-refused` (string-literal element access), and `20/an-aliased-clock-member-key-is-the-same-clock-read` (`const NOW = "now"` declared at MODULE scope, so the key is resolved across a scope boundary). The third landed with 12.12a's key-TYPE rule and is the direction of it that must stay REFUSED; 9.8 is the direction that must stay accepted, and the two were broken in opposite directions by the same drifted helper. |
| 9.7 | any **other** `Date` member charges `Clock` | `semantic.ts:4462` | **uncovered** | no case reads a `Date` member other than `now` |
| 9.8 | `Date.parse` and `Date.UTC` are **exempt** | `semantic.ts:4462` (`!["parse", "UTC"].includes(member)`) | **`Date.parse` covered as of 2026-08-27; `Date.UTC` still uncovered** | `20/an-aliased-pure-member-key-needs-no-capability` is an `output` case reading `Date[PARSE]("2020-01-01T00:00:00.000Z")` beside `Math[MAX](2, 7, 5)` and printing both. It is here rather than only at 9.11 because it pins a measured over-refusal, not a hypothetical one: the Go fork refused **both** members with `SMITHERS1602`/`SMITHERS1603` before round 7, because its ambient-authority walk carried its own key test, an unresolved key fell through to the **whole-root** arm, and that arm charges every member of the object. So one helper answering "which member does this select?" two different ways produced a missed clock read at 9.6 and a refused `Date.parse` here, and only the pair holds both closed. The instant is a fixed authored string, so the printed value is stable and reads no clock. `Date.UTC` is still read by no case. |
| 9.9 | `new Date()` with no arguments charges `Clock`; `new Date(x)` with arguments charges **nothing** | `semantic.ts:4438-4441` | **covered as of 2026-08-26, including the boundary the split gets wrong** | The exempt half runs inside `20/value-instanceof-date-is-a-prototype-test-not-a-clock-read`, whose second line is `new Date(0)`. The boundary is `20/a-date-spread-argument-is-still-a-clock-read`: the exemption counted syntactic argument **nodes**, and `new Date(...(instant as [number]))` where the array is empty is one node and **zero** runtime arguments, so it constructed the current time and compiled clean on both backends. A spread has no statically known length and therefore cannot prove an instant was supplied. Demonstrated failing on the pre-change tree, where both backends accepted and ran it. |
| 9.9a | **`Intl.DateTimeFormat` construction is a clock read, and the rest of `Intl` is not** | compatibility.mdx §Host Globals ("Host-sensitive **operations** such as clock and random access MUST still use capabilities") | **covered as of 2026-08-26, as a pair** | `20/intl-datetimeformat-construction-needs-a-clock` (`SMITHERS1602`) and `20/intl-locale-formatting-is-not-a-clock-read` (`output`). **The acceptance half was WIDENED on 2026-08-28 from two members to seventeen**, and its expectation re-derived by running both backends, which produced byte-identical stdout. compatibility.mdx §Determinism-Sensitive Members row five named four ICU members and the hazard covers thirty — an incomplete list, not a narrow one — so the case now carries a representative of every shape in the class: the nine other `Intl` value members, the four locale-sensitive `String` members, and `toLocaleString` on `Number`, `BigInt`, `Array` and a typed array. Members whose result IS host ICU data are printed as `typeof`, because pinning their text would make the case vary with the host's ICU version, which is the hazard. Measured to be load-bearing by mutation rather than by a pre-fix demonstration: changing `root === "Intl" && member === "DateTimeFormat"` to `root === "Intl"` turns ten of them into `SMITHERS1602`, and a subtler mutation that exempts only the three members the case used to name leaves **every** pre-existing assertion green while the widened one fails. The thirty-member enumeration lives in `host-global-allowlist.test.ts`, which checks rather than runs and so can name all twelve typed arrays without depending on the host having `Float16Array`. `Intl` was not an ambient root the rule modelled at all, so `new Intl.DateTimeFormat("en").format()` formatted *now* with zero diagnostics on both backends. The requirement is charged at **construction** rather than at the call that reads the clock, and that is a deliberate fail-closed choice rather than the finest rule: which call reads it depends on the arity of a call on an *instance* (`format()` formats now, `format(instant)` does not) and `resolvedOptions().timeZone` reads the host time zone with no call at all. The acceptance half is what keeps the rule per-operation rather than per-object — the same relationship 9.11 has for `Math`. |
| 9.10 | every `performance` member charges `Clock` | `semantic.ts:4464` | **uncovered** | `grep -rn performance conformance/corpus/` finds no use |
| 9.11 | `Math.random` charges `Random`; any other `Math` member charges nothing | `semantic.ts:4463` and the absent `else` beside it | covered, both directions, **and both at two key spellings as of 2026-08-27** | `20/random-access-needs-a-capability`; `20/universal-globals-stay-available` reads `Math.max` and stays clean; `20/an-aliased-pure-member-key-needs-no-capability` reads `Math[MAX]` and stays clean, which is the spelling the fork refused before round 7 (see 9.8). |
| 9.12 | `crypto.randomUUID` / `crypto.getRandomValues` charge `Random`; **every other** `crypto` member charges `Host` | `semantic.ts:4465-4466` | **uncovered** | neither side of the split; `grep -rn crypto conformance/corpus/ --include='*.sm'` finds nothing. Note the diagnostic mapping at `semantic.ts:4395`: `Clock` → `SMITHERS1602`, `Random` → `SMITHERS1603`, everything else → `SMITHERS1601`. So the `Host<"crypto">` branch reports the *same* code as `process`/`document`, and a case for it must observe the position rather than a distinct code. |
| 9.13 | a **lexical shadow** of one of these names stays an ordinary value | `semantic.ts:4417` (`isAmbientGlobalReference`) | **uncovered** | the one that matters most. A local `const Math = { random: () => 4 }` charging `Random` would be a false positive; the classifier guards against it and nothing checks the guard. Exactly parallel to `19/retired-operator-words-as-members-stay-ordinary`, which this page calls out as load-bearing at §1.7. |
| 9.14 | a whole-root escape — `Date`/`performance` → `Clock`, `Math` → `Random`, `crypto` → `Host` — when the member is dynamically selected | `semantic.ts:4454-4457` | **covered as of 2026-08-27, for the `Date` → `Clock` branch** | `20/a-widening-string-key-escapes-the-whole-object` — `Date["now" as string]()`, `SMITHERS1602@2:14`, the declared column being the `Date` identifier rather than a member name, which is the observable difference between charging the ROOT and charging nothing. This is the conservative direction the row's previous text called "the one a refactor is most likely to relax", and round 7 is why it now has a case: once the member-selection helper was keyed on the checker's string-literal TYPE of the key, its unresolved-key edge became load-bearing, and the fail-open reading of that edge (an unresolved key selects nothing to object to) is exactly the shape of the `context`-key defect at 12.12a, which dropped the capability row and panicked at run time. Note that the sibling boundary on the CAPABILITY side answers differently and correctly so — `05/a-non-literal-computed-capability-access-has-no-statically-known-member` is a stock `TS7053`, because `Clock` is a class with no string index signature while `DateConstructor` has members a `string` key really can reach. Two receivers, two answers, both fail-closed. The `performance`, `Math` and `crypto` branches of the same escape are still uncovered. |

**Six and a half of the ten branches are pinned, as of 2026-08-27** — 9.6 (now at
three key spellings), 9.9 (both halves plus the spread boundary), 9.9a, 9.11 (both
directions, now at two key spellings), 9.14 (the whole-root escape, for its `Date`
branch only), and **half of 9.8**: `Date.parse` is covered and `Date.UTC` is not,
which is why this sentence says "and a half" rather than rounding. 9.7, 9.10, 9.12
and 9.13 are still uncovered, and **9.13 — a lexical shadow of one of these names
stays an ordinary value — remains the one that matters most**, unchanged by this
revision. `20/host-globals-are-unavailable` pins a different obligation (9.1:
`process`/`document` are not ambient globals) and does not touch this table at
all; 9.1d (dynamic code evaluation) is a different rule from the classification
table and is counted in neither figure. **This count was re-derived from the rows
above rather than carried forward, and the denominator moved from nine to ten
because the whole-root escape row was given a number when it gained a case.**

## 10. The `TypeScript` requirement and native classification

The native pin is the change that reshaped this section. Before it existed, a
requirement row was only observable through a diagnostic that happened to name
it, so three obligations here could be pinned only through their consequences.
`SMITHERS3001` names the blocking requirement and its dependency path, which
makes the row itself observable for the first time.

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 10.1 | using a runtime value from TS/JS adds the `TypeScript` requirement | compatibility.mdx §Runtime TypeScript Dependency; type-system.mdx §Foreign Boundaries | covered | **`21/a-pin-reaching-a-trusted-foreign-call-is-rejected`** — the corpus's first *direct* observation of the requirement's presence in a row. Previously pinned only through its consequence (a value import rejected, a type-only import accepted). |
| 10.2 | a type-only import adds neither requirement | compatibility.mdx §Runtime TypeScript Dependency; type-system.mdx §Foreign Boundaries | covered | `18/type-only-import-adds-no-requirement` |
| 10.3 | `any` contributes `TypeScript` and is not globally forbidden | compatibility.mdx §Dynamic Features; DECISIONS Locked | covered (both halves) | `18/any-is-usable-and-not-forbidden` (acceptance), `21/a-pin-reaching-typescript-is-rejected` (contribution) |
| 10.4 | `eval` contributes `TypeScript` and is not globally forbidden | compatibility.mdx §Dynamic Features; DECISIONS Locked | covered (both halves) | `18/eval-is-usable-and-not-forbidden`, `21/a-pin-reaching-typescript-is-rejected` |
| 10.5 | the `TypeScript` requirement propagates transitively like any other | requirements.mdx §TypeScript Requirement; DECISIONS Locked | covered | `21/a-pin-reaching-typescript-transitively-is-rejected` — four ordinary calls between the pin and the `eval`. Previously **partial** for want of an observation channel. |
| 10.6 | **a native pin rejects any transitive `TypeScript`, over the complete graph, showing the dependency path** | compatibility.mdx §Native Pin; requirements.mdx §TypeScript Requirement | covered | the whole of `21-native-pin` (**27 cases**, 16 before this revision, 9 before that): clean graph accepted, one-hop and four-hop `TypeScript` rejected, host module rejected, trusted foreign call rejected, dynamic import rejected, ordinary capability **accepted**, closure-not-module scoping, async pin. The re-binding block added a revision ago — named, star and chained re-exports, a re-export cycle, a parameter default, and two acceptance controls — is green on both backends with every retirement recorded in its own case's `notes`. **This revision added the eleven cases in 10.15–10.20 below**, which is where the area stopped being about import lists. |
| 10.6b | **the diagnostic shows the dependency path that introduced the requirement** | compatibility.mdx §Native Pin (SHOULD) | **covered, and now load-bearing** — *observation gap #5 stays closed* | Two revisions ago the path text was unobservable: the expectation format compared code and authored position only, so a pin refused with an EMPTY route satisfied every case in this area exactly. `conformance/runner/corpus.mjs` and `judge.mjs` accept an optional `messageContains` on a declared diagnostic, checked only where declared. **The census, recomputed this revision: 12 declared `messageContains`, all 12 in `21-native-pin`** (was 5), counted by parsing the expectations rather than by grep, because the word now also appears in several `notes`. Seven of the twelve are new and each one names a composed route that did not previously exist in the corpus — `-> initializer-host.mod.sm#pid -> process.pid`, `-> invoking-callee.mod.sm#run`, `-> reader-callee.mod.sm#run -> …#read`, `-> loads-host.mod.sm -> node:fs`. Backend agreement still compares codes and positions only, because message *wording* legitimately differs between the two implementations — **measured this revision on `SMITHERS1503`, where the two messages differ by one word** — so a case names the smallest fragment that carries the promise and never the sentence around it. Where the payload is *not* the promise, this revision declares no `messageContains` at all. |
| 10.15 | **ambient host authority read by a module-level initializer is in the graph of every function that reads the binding** | requirements.mdx §Platform Requirements (Locked): portability from "the satisfied dependency closure, not merely the source module's import path"; compatibility.mdx §Native Pin | **covered** | **`21/a-host-read-in-a-module-initializer-is-part-of-the-pinned-graph`**, green on both, asserting the route `-> initializer-host.mod.sm#pid -> process.pid`. The read is in no function at all: an analysis that walks function bodies and import lists certifies the program, and running it reads `process`. |
| 10.16 | **a function invoked where it is written runs where it is written, and contributes no hop of its own** | the same two sentences | **covered** | **`21/a-host-read-behind-an-immediately-invoked-function-is-part-of-the-pinned-graph`**, green on both. It declares the *same* route shape as 10.15 on purpose: `(() => process.pid)()` runs exactly when `process.pid` would have, so a walk that treats a function expression as deferred answers two byte-similar programs differently, and an anonymous immediately-invoked callable must not appear between the binding and the read. `messageContains` pins both halves at once. |
| 10.17 | **a callback is part of the graph exactly when the callee's visible body invokes it** | requirements.mdx §Inference (Locked): "Requirement inference MUST be transitive through ordinary calls"; compatibility.mdx §Native Pin ("any reachable operation") | **covered by an `xfail go` plus its acceptance twin** | **`21/a-callback-a-callee-invokes-is-part-of-the-pinned-graph`** (route `-> invoking-callee.mod.sm#run`) and **`21/a-callback-a-callee-only-stores-still-satisfies-the-pin`** (an `expect: "output"` case that compiles and runs). **This pair is the most valuable thing in the area** and neither half means anything alone: the two programs are identical at the call and differ only in what the callee's body does, so "charge callback arguments" turns the acceptance case red and "a callback is deferred" turns the refusal green. **The fork accepts, certifies and runs the refusal case** — see the register — and it passes the acceptance case *for the wrong reason*, because a backend that enters no callback satisfies a negative automatically. The acceptance case's own `notes` say so. |
| 10.18 | **the method that runs is the one on the class the caller constructed, not the interface member the signature selected** | the same two sentences | **covered by an `xfail go`** | **`21/a-class-instance-method-is-part-of-the-pinned-graph`**, asserting the whole route tail `-> reader-callee.mod.sm#run -> …#read` so a route that stopped at the callee fails the case even with the right code at the right position. The callee's parameter is an interface, so the signature a checker selects has no body; reaching the class's method needs the value question. **The fork accepts, certifies and runs it.** |
| 10.19 | **what a module's evaluation loads is in the graph of every function in it, transitively** | requirements.mdx §Platform Requirements (Locked) | **covered by an `xfail go`** | **`21/a-side-effect-import-chain-is-part-of-the-pinned-graph`**, asserting `-> loads-host.mod.sm -> node:fs`. This is the LOAD graph rather than the call graph: the pinned function calls nothing and names nothing, and a side-effect import has no binding for a tree-shaker or an unused-import rule to remove. **The fork charges the first link and not the chain** — handed the same program with `import "node:fs"` written directly it reports the pin failure correctly, so it owns the rule and does not walk it. |
| 10.20 | **a native pin whose subject the compiler cannot identify is refused** (`SMITHERS3005`, both branches) | compatibility.mdx §Native Pin (Locked) "a **checked** assertion"; DECISIONS "TypeScript and native classification" (Locked) | **covered** | **`21/a-pin-whose-argument-is-not-a-project-function-is-rejected`** (reported at the argument) and **`21/a-pin-given-two-arguments-is-rejected`** (reported at the call), both green on both. This code is the **gate on this whole section** and was unprobed until now: the other twenty-five cases in the area all hand `native(...)` a well-formed reference, so nothing pinned what happens when the assertion itself is uncheckable. Two cases rather than one because the two branches report at different positions, and a single case would have left the other branch free. |
| 10.7 | the pin's **source spelling** | compatibility.mdx §Native Pin: "The exact source spelling of a native pin is **open**"; DECISIONS **Open** | unwritable | **blocked on an Open decision.** The corpus commits to the provisional `native(fn)` from `smithers:native` because it is what both backends implement and what the specification prints as the candidate. If the spelling changes, area 21 needs a sweep and nothing else does — the *rule* the cases pin is spelling-independent. |
| 10.8 | arbitrary dynamic import unavailable in native code | DECISIONS Locked; compatibility.mdx §Native and Wasm Targets | covered | **`21/a-pin-reaching-a-dynamic-import-is-rejected`**. Previously unwritable "because there is no native backend to reject it" — the rule needs a checked native-eligibility assertion, not a native backend. |
| 10.9 | closures, classes, generics, unions and **async functions** are not rejected merely for needing runtime support | compatibility.mdx §Native and Wasm Targets | covered | `21/a-pin-over-an-async-function-is-accepted` — the js marker is **retired**; the reference used to reject every async pin with `SMITHERS1404`, which made the pin inapplicable to all async code. Green on both now. |
| 10.10 | a feature classified **forbidden** in authored `.sm` is rejected | compatibility.mdx §Dynamic Features (bucket 3); DECISIONS Locked | covered | `18/class-static-block-is-rejected` (SMITHERS1107), **`18/with-statement-is-forbidden`** (SMITHERS3003, from the portability classifier itself) |
| 10.11 | classification of `Proxy`, prototype APIs, descriptors, weak refs, thenables, Promise subclassing | compatibility.mdx §Dynamic Features (**Open**); DECISIONS **Open** | unwritable **twice over** | **blocked on an Open decision** — item 1 of the ledger's unresolved-design-work list — **and** blocked on observation gap #11. `SMITHERS3002` ("portability is not classified yet") exists as a *warning* (`poc/src/targets/classify.ts:342`), and both backends filter the diagnostic stream to errors before the runner sees it. So even the one thing a corpus *could* honestly pin while the decision stays open — that the implementation still flags the unclassified construct rather than passing it silently — is unassertable. That second reason is a harness change, not a design decision, and it is now recorded as gap #11 rather than left inside this cell. |
| 10.12 | type-assertion semantics | compatibility.mdx §Type Assertions (**Open**); DECISIONS **Open** | unwritable **twice over** | as 10.11. `SMITHERS3004` is likewise a warning (`poc/src/targets/classify.ts:297`). |
| 10.13 | a **native** backend emitting near-native code through LLVM | compatibility.mdx:60 — "Smithers **MUST** support a near-native target through LLVM" | unwritable | **no implementation surface exists.** `grep -ril llvm poc/src/ src/ compiler/ cmd/` returns nothing — the string occurs only in prose files; `specification/index.mdx:83` says so in the same words. The pin is a *checked assertion about* native eligibility, which is why 10.6–10.9 became writable without a backend, but nothing can execute native output. This is the largest single unimplemented **MUST** in the repository — see "Feature complete is not true on the specification's own terms" below. |
| 10.14 | a **Wasm** backend emitting WebAssembly for a declared host contract | compatibility.mdx:60 (**SHOULD**); `specification/index.mdx:32` names "a **Wasm backend**" as one of five conformance targets | **uncovered — a bounded backend exists and the corpus does not reach it** | **This row corrects a false statement.** The previous revision said at 10.13 and at observation gap #2 that "there is no native or Wasm backend… no implementation surface exists". The native half was right. The Wasm half was wrong. `poc/src/targets/portable-backend.ts` is **4,180 lines** (`wc -l`). It lowers exported, synchronous, non-generic `.sm` functions over `number`/`boolean`/portable-string values into a canonical digest-bound IR (`:3312` binds a `wireDigest` over the contract digest and the frozen exit), compiles that IR to **import-free WAT**, shells out to `wat2wasm` (`:3809`), rejects a module that imports any host authority (`:3728`), instantiates it (`:4114`), and requires exact canonical-exit and wire-digest agreement between the TypeScript evaluator and the Wasm runtime. Context capabilities are carried as value services with the requirement row inside the contract digest; recursion is rejected at compile *and* validation time; loops carry a fuel budget of exactly `PORTABLE_LOOP_FUEL = 1_000_000` condition evaluations (`:271`) whose exhaustion produces the canonical `fuel-exhausted` defect identically in both runtimes (`:274`, `:290`). It ships publicly: `poc/src/targets/index.ts:2` re-exports it and `package.json:70` publishes `smthrs/targets`. **It carries 65 distinct diagnostic codes**, `SMITHERS5001`–`SMITHERS5073` (`grep -oh 'SMITHERS5[0-9]\{3\}' poc/src/targets/portable-backend.ts \| sort -u \| wc -l` → 65). **The corpus pins zero of them.** The only 5xxx codes any case declares are `SMITHERS5201`, `5202`, `5208`, `5209` — asset-loader codes from `poc/src/build/source-assets.ts`, a different family. Its only measurements are `poc/src/targets/portable-backend.test.ts` (1,942 lines) and `scripts/release-fixtures/runtime-smoke.mjs:214-221`. **Why no case:** the fork has no Wasm backend, so a corpus area here could only be `js`-pass / `go`-`unsupported`, which is a one-sided measurement rather than a differential one — but that is an argument about *what kind* of coverage it would be, not a reason for the matrix to say the surface does not exist. |

## 11. Promises and concurrency

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 11.1 | authored `.sm` consumes Promises only through `await` | failures.mdx §Promise Semantics | covered | `08/await-consumes-the-promise-and-the-result` |
| 11.2 | Promise instance `.then()` is a compile error | failures.mdx §Promise Semantics | covered | `08/promise-then-is-rejected`, and **`08/promise-then-on-a-bound-promise-is-rejected`** (**marker retired**; the fork has ported the bound/unbound split and both backends now report `[SMITHERS1401@15:25, SMITHERS1403@14:9]`) — the false-negative direction. All three original chaining cases call `.then` directly on a call expression, so all three would still pass if the rule were a syntactic check on `call().then(...)`; this one binds the Promise first. |
| 11.3 | Promise instance `.catch()` is a compile error | failures.mdx §Promise Semantics | covered | `08/promise-catch-is-rejected` — **the previous revision's js+go xfail is retired**; both backends now report only the declared Promise-discipline diagnostics |
| 11.4 | Promise instance `.finally()` is a compile error | failures.mdx §Promise Semantics | covered | `08/promise-finally-is-rejected` |
| 11.5 | every started Promise is consumed before scope exit | requirements.mdx §Scoping; DECISIONS Locked | covered | `07/promise-must-be-consumed`, and — for the same reason 12.1 was an overclaim — one case per discard spelling: `08/a-void-operator-does-not-consume-a-started-promise`, `08/a-comma-expression-discards-its-left-operand-promise`, `08/an-array-literal-in-statement-position-abandons-its-promises`, `08/a-bound-promise-array-that-is-never-awaited-is-refused`. All four were measured compiling and running on the fork before 2026-08-25. |
| 11.15 | **a started Promise read back out of a container is NOT discharged by awaiting it there** | failures.mdx §Promise Semantics ('Authored `.sm` code MUST consume Promise instances only through `await`') — but *no sentence says what consuming a collection means for a Promise* | **covered, pinned at the currently-agreed answer, and flagged as an open question** | `07/a-started-promise-read-back-out-of-an-object-is-not-consumed` (`SMITHERS1402`, identical on both backends). The container-discharge rule is deliberately Result-only: only a Result read leaves a container. This is arguably the *worse* language answer — the Promise genuinely is awaited — and the convergence lane measured itself introducing exactly this as a NEW divergence in the permissive direction before reverting it, because a lane may not answer a specification question on one side only. **This case is what to retire** if the ledger decides that awaiting a stored Promise through its property discharges it. `07/the-ambient-promise-all-discharges-a-bound-promise` and `08/a-bound-promise-array-is-consumed-by-promise-all` pin the forms that DO discharge. |
| 11.13 | **a bound array of started Promises is consumed by awaiting a recognized combinator over it** | failures.mdx §Promise Semantics; DECISIONS Locked (Concurrency) | covered | `08/a-bound-promise-array-is-consumed-by-promise-all` (**its `xfail go` was retired 2026-08-25 after an `XPASS`**) — the acceptance half of 11.5's array row, and the ordinary concurrent spelling. The fork recognizes the inline form and the bound SCALAR form and refuses this one. |
| 11.14 | **postfix `!` requires a Result operand, so an un-awaited `Promise<Result<A, E>>` is not one** | compatibility.mdx:72; failures.mdx §Promise Semantics | covered | `08/postfix-bang-on-an-unawaited-promise-result-is-not-a-result-operand` (**its `xfail go` was retired 2026-08-25 after an `XPASS`**; both halves of the fork's carve-out are gone, including the one that suppressed `SMITHERS1207` and emitted the `!` through unchanged — precisely what failures.mdx forbids outright — stated in §Accepted Placements when this row was written, and surviving verbatim in §Refusal Conditions after that section's withdrawal on 2026-08-27). Deliberately a **pair** with `02/an-unawaited-promise-bang-forwarded-into-a-return-reports-only-the-operand`: the same violation with and without a surviving unconsumed-Promise obligation, two diagnostics in one case and one in the other. `02/await-applied-after-postfix-bang-is-a-non-result-operand` is the third corner — `await lookup(k)!` binds the `!` to the Promise, and `SMITHERS1207` is the diagnostic that names the fix. |
| 11.6 | a recognized combinator whose Promise is awaited satisfies that rule | DECISIONS Locked | covered | `08/promise-all-is-a-recognized-combinator`, and **`08/result-all-collects-across-concurrent-work`** — the composition rather than the rule: `Promise.all` collects the Promise channel and `Result.all` then collects the Result channel that awaiting it left behind, in that order, and neither collapses into the other. This is how concurrent fallible work is actually written and nothing pinned it before. |
| 11.7 | an unowned async callback fails closed | poc README SMITHERS1404 | covered | `08/unowned-async-callback-is-rejected` |
| 11.8 | `await Promise<Result<A,E>>` yields the Result; `await` does not unwrap or discard it | failures.mdx §Promise Semantics | covered | `07/await-leaves-a-result-that-must-still-be-consumed`, `08/await-consumes-the-promise-and-the-result` |
| 11.9 | an infallible async function returns `Promise<A>` | type-system.mdx §Async Values | covered | `08/infallible-async-returns-a-plain-promise` |
| 11.10 | cancellation is visible in typed failures and provided through the dependency model | DECISIONS Locked | unwritable | **no *language* surface exists.** The previous revision's evidence was wrong: it grepped `poc/src/{language,runtime,targets}` and concluded nothing existed, but `poc/src/concurrency/cancellation.ts` does, and `reference/standard-library.mdx` §Concurrency and Streams documents "cancellation sources/registrations" in `smthrs/concurrency`. The conclusion survives the correction — cancellation is a **library** value, not a typed failure member, a capability, or a diagnostic in either backend, so there is no language rule to pin — but it is now unwritable for 11.11's reason (the library is unreachable) rather than for want of an implementation. |
| 11.11 | governors, structured-concurrency combinators, `Promise.allKeyed`, shared structs, `Stream`/`Queue`/`Semaphore`/`Channel` | DECISIONS Locked/Direction (TC39 adoption); standard-library.mdx §Concurrency and Streams | **unwritable from the corpus** — the surface exists, no case can resolve it | These are **library** APIs and the ledger says so ("Smithers does not add Promise or structured-join parser syntax"), so the obligation is a package export, not a language rule. The previous revision blamed flat staging; **staging shape was never the binding constraint, module resolution is.** Measured 2026-08-23 by putting `import { Stream } from "smthrs/concurrency"` through the JS backend directly: `SMITHERS1510@1:24 — 'smthrs/concurrency' could not be resolved`. `smthrs/concurrency` is an ordinary package export (`package.json` → `./dist/concurrency.js`), unlike `smthrs/context` and `smthrs/provider`, which the compiler owns and never resolves from disk. The JS backend executes from a `mkdtemp` tree with no `node_modules` above it, and the Go fork has no filesystem at all — its whole project arrives in one request. **What the harness would need:** a resolvable package root staged into both backends, which on the Go side means a wire-protocol change the harness does not own. Vendoring the API into `conformance/support/` is *not* the fix: it would measure the copy. Ranked low: a library obligation, not a language one. |
| 11.12 | the exact native-portable Promise subset | DECISIONS **Direction** ("still open") | unwritable | **blocked on an Open decision** |

## 12. Must-consume

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 12.1 | a discarded Result is a compile error | failures.mdx §Matching; type-system.mdx §Result Composition | covered | **Was recorded `covered` by `07/result-must-be-consumed` alone, which was true of one SPELLING of discard and false of the obligation** — the overclaim REVIEW-fable-1.md F1 named, and the same shape that once concealed SMITHERS1507/1508. Eleven discard spellings were then measured compiling and RUNNING on the fork. Now enumerated, one case per spelling: `07/result-must-be-consumed` (bare statement), `07/a-void-operator-does-not-consume-a-result`, `07/a-comma-expression-discards-its-left-operand-result`, `07/a-logical-and-discards-the-result-on-its-right`, `07/a-for-initializer-discards-its-result`, `07/an-as-expression-in-statement-position-does-not-consume-a-result`, `07/a-template-literal-span-does-not-consume-a-result`, `07/an-array-literal-of-results-in-a-discarded-statement-is-refused`, `07/a-discarded-conditional-charges-both-branch-producers`, `07/a-parenthesized-discard-is-charged-at-the-call`. The last two also pin the POSITION, which is where the two backends disagreed. |
| 12.1a | …and the positions the walk visits do not turn ordinary code into an error | failures.mdx §Matching (the rule says nothing about a value that is not a Result) | covered | `07/the-discard-positions-stay-ordinary-for-values-that-are-not-results` — every position the enumeration above added, holding a value that is neither a Result nor a started Promise, in one program that compiles and runs. `07/an-ownership-transfer-in-every-position-is-accepted` is the other guard: binding, returning, the value side of a comma, and an array handed to `Result.all` are transfers, not discards. |
| 12.10 | **storing a Result in a container transfers ownership to the container; reading it back out is the consumption** | compatibility.mdx:72 (the `arr[i]!` worked example, Locked 2026-08-25); failures.mdx §Matching | covered | `07/an-array-literal-of-results-is-consumed-through-an-index-read` (the specification's own example, as a program), `07/a-tuple-of-results-is-consumed-through-an-index-read`, `07/an-object-literal-holding-a-result-is-consumed-through-its-property` (**its `xfail go` was retired 2026-08-25 after an `XPASS`; the fork's container transfer now recognises object-literal property assignment**), `07/result-all-on-a-bound-array-keeps-the-elements-failure`. Both refusal guards are written beside them: `07/an-array-literal-of-results-that-is-never-consumed-is-refused` (**its `xfail go` was retired 2026-08-25 after an `XPASS`; it was the worst fail-open the corpus has carried — the fork compiled and ran it, discarding two checked failures with nothing reported**) and `07/an-array-literal-of-results-in-a-discarded-statement-is-refused`. |
| 12.11 | **a forwarding position keeps the obligation rather than discharging or discarding it** | failures.mdx §Matching (`returning` is one of the five forms; a forwarded value is the value the enclosing expression becomes) | covered | `07/a-concise-arrow-body-returning-a-result-is-a-return` (the braced spelling was always accepted; only this one was charged), `07/a-conditional-branch-forwards-its-result` (**its `xfail go` was retired 2026-08-25 after an `XPASS`**), and its condition-position twin `07/a-result-in-a-ternary-condition-is-discarded`, `07/a-satisfies-expression-forwards-its-result`. Their discard twins are 12.1's conditional and parenthesized rows. |
| 12.12 | **a literal element access is the same member access as the dotted spelling, for every compiler-recognized member** | requirements.mdx §Access; failures.mdx §Result Composition, §Error Prototype, §Promise Semantics; compatibility.mdx §Host Globals | covered | Ten cases across seven areas, because the defect was one blind spot in every recognizer at once and REVIEW-fable-1.md F4 measured it on **both** backends: `05/a-computed-context-access-charges-the-same-row`, `06/a-computed-layer-provide-checks-its-capability-closure`, `08/a-computed-then-on-a-bound-promise-is-rejected`, `08/a-computed-then-on-an-unbound-promise-is-rejected`, `04/a-computed-error-match-is-exhaustiveness-checked`, `01/a-computed-result-ok-is-a-compiler-hook`, `19/a-computed-unwrap-is-the-retired-spelling`, `20/a-computed-date-now-is-refused`, plus the two acceptance halves `07/a-computed-match-discharges-the-obligation` and `07/a-computed-result-all-discharges`, and the over-correction guard `07/an-ordinary-computed-property-access-is-untouched`. The BOUNDARY of the family is `05/a-non-literal-computed-capability-access-has-no-statically-known-member`: a non-literal key resolves to no member, so no recognizer may claim it, and the case pins where it fails closed instead (`TS7053` from the stock check of the emitted module, identical on both backends). FB-report.md §7.3 recorded that path as unpinnable in this harness; it is not, and the case is the correction. |
| 12.12a | **…and "literal" is the wrong word for it: a key selects a member exactly when the CHECKER gives it a string-literal TYPE, which covers a `const` alias, an alias of an alias, a parenthesis, a `satisfies`, an `as const` and an angle-bracket cast — and stops at a widening `string`** | requirements.mdx:34/:36 for the capability rule; compatibility.mdx §Host Globals for the ambient one; the criterion itself is TypeScript's own, since a string-literal-typed key is precisely when TypeScript resolves an element access to one property symbol | **covered as of 2026-08-27, eight cases across four areas, and this was a fail-open on BOTH backends that ended in a RUN-TIME PANIC** | 12.12 fixed the *literal* spelling in ten recognizers; round 7 measured **seven** further spellings failing open in the reference and five in the fork, all of them dropping the capability row and then aborting with `capability 'Clock' was not provided` at run time. The capability three — `05/a-const-alias-context-key-charges-the-same-row` (`SMITHERS2102@13:28`), `05/a-parenthesised-context-key-charges-the-same-row` and `05/a-satisfies-wrapped-context-key-charges-the-same-row` (both `@11:28`) — are one program with one token changed each, and each declares `messageContains` on the capability's own name for 8.2a's reason. The parenthesised one is a separate case rather than a fold-in because the two backends **disagreed** on it (the fork's own key test happened to skip parentheses and the reference's did not), which is the one shape the differential oracle can see and it saw nothing, because no case named the spelling. The `satisfies` one is chosen for what distinguishes it from its near miss: `satisfies` CHECKS without WIDENING, so `"context" satisfies string` still has the literal type while `"context" as string` does not — and 9.14's `20/a-widening-string-key-escapes-the-whole-object` pins the other side of that same sentence. **The acceptance half is `05/an-aliased-context-key-is-subtracted-by-its-layer`**, and it is the only case in the family that can tell "charges the `Clock` row" from "charges A row": the three refusals are each satisfied by any unsatisfied requirement named `Clock`, whereas here one layer supplies `Clock` and nothing else, so the program compiles only if the row is exactly right and PRINTS only if the access was also lowered to the real context read — which is the half a compile-only case would have missed, since the defect compiled clean and died at run time. Outside `05`, the same rule is pinned at `20/an-aliased-clock-member-key-is-the-same-clock-read` (9.6), `20/an-aliased-pure-member-key-needs-no-capability` (9.8/9.11, the over-refusal direction), `20/an-aliased-constructor-key-is-the-function-constructor` (9.1d), and the `09/an-aliased-reflect-panic-key-*` pair (7.23a) — nine rules read this one answer, and the panic pair is the evidence that widening it can break a rule that was already right. |
| 12.15 | **a tagged template whose tag returns a Result is a Result-producing invocation, so dropping it is a discard** | failures.mdx:136; type-system.mdx:56 | **covered as of 2026-08-27, as a pair** | The rule recognized a producer by looking for a call expression, and a tagged template is not one, so the whole family was invisible at that spelling: the tag throws, the throw is lifted into the Result it declares, and nothing looks at it. `07/a-dropped-result-from-a-tagged-template-is-refused` declares four `SMITHERS1301`s — the template and an ordinary call, each inside a function and at module top level. The two ordinary calls are the attribution control, and the top-level pair matters separately because the top-level obligation runs through a different traversal from the in-function one on both backends. `07/a-consumed-result-from-a-tagged-template-is-accepted` is the over-correction guard and RUNS; its second line matches on the FAILING side and prints `boom`, which is simultaneously evidence that the tag ran, that its throw was lifted rather than escaping, and that the failure branch was selected. Deliberately excluded: `` panic`x` ``, a recorded open question on both backends. |
| 12.16 | **an inferred-fallible callback reaching a consumer through an ALIAS is the same value that reaches it directly** | failures.mdx §Inference and Public Contracts | **covered as of 2026-08-27, as a pair** | One alias hop defeated `SMITHERS1303`: the resolver followed a direct reference to a function declaration and stopped at a `const` binding, so the aliased program COMPILED, ran to exit 0, and the throw was swallowed inside the consumer with no diagnostic anywhere. `07/an-aliased-fallible-callback-still-needs-a-contract` declares four — the direct spelling as the attribution control, one `const` hop, TWO hops (so a fix following exactly one initializer is caught), and an object-literal property, which is a different resolution mechanism entirely. `07/an-aliased-total-callback-needs-no-contract` is the over-correction guard and RUNS, with a different key per spelling so the four printed values observe that each spelling reached the consumer with its own argument. Residuals mirrored on both backends and deliberately not pinned: a callback aliased through a MUTABLE binding, and one returned from a helper. |
| 12.2 | an unconsumed Result **parameter** is a compile error | poc README SMITHERS1302 | covered | `07/result-parameter-must-be-consumed` |
| 12.3 | returning, matching, transforming, inspecting, and unwrapping all count as consuming | failures.mdx §Matching | covered | `07/consumed-result-is-accepted`, `07/every-listed-consumption-form-is-accepted` (all five forms in one program) |
| 12.3a | **…and "inspecting" is the three-method inspection group, not a read of the Result's runtime discriminant** | failures.mdx §Compiler-Owned Modules — `smthrs/result` "is the lowering target: emitted code imports it… The compiler links it directly, `!` and `expect` are rejected inside it, and **its public API is instance methods**"; §Matching and Transformation spells the inspection group `isOk isError match`, three methods and no properties | **covered as of 2026-08-28 — landed as an `xfail go` holding a FORK FAIL-OPEN and RETIRED in the same lane by fixing the fork; green on both backends** | `07/reading-a-results-runtime-tag-does-not-consume-it`. The fork accepted, compiled and RAN `const outcome = lookup("zoe"); if (outcome.ok) { return [outcome.value] } return [outcome.error.key]`, printing `zoe` — extracting the ERROR value and reading a field off it with none of the five acts — while the reference refused it with `SMITHERS1302@11:9`. **The cause was one arm**, in `boundConsumeResult` in `compiler/forkbridge/mustconsume.go.txt`: a bare member SELECTION resolving to one of the four declarations `collectResultInspectionMembers` indexes (`ok` on each of `SmithersOk`/`SmithersErr`, plus the `value`/`error` readonly constructor parameters) returned `true` before the walk asked whether the member was CALLED. Removing it makes every discharge require a call, which is what the reference has always required; the predicate it fed (`preludeSymbols.resultInspection`) is deleted and the four declarations are still collected, because the prelude completeness check counts them as a shape assertion. It was deliberate rather than a gap — `compiler/fork_mustconsume_test.go` asserted it under the name "compiler-owned Result inspection consumes the binding", and that subtest is now the **inversion**, beside a new one pinning that `isError()` still discharges, so the rule refuses the PROPERTY read and not inspection as such. **`compiler/fork_result_member_surface_test.go` could not have seen this**: it pins the reference's `RESULT_MEMBER_SIGNATURES` against the fork's `resultConsumerMembers`, and `ok` was on neither list — it lived in a third, separate set. No corpus case reads `.ok`/`.value`/`.error` on a Result, which is why `0 divergent` had been true throughout. **What is NOT closed**: `outcome.ok` still typechecks on the fork, so with the obligation discharged another way first (`unwrapOr` above the tag read) the fork compiles and runs the read while the reference reports `TS2339`. The fork's authored `Result` IS the union of its two runtime classes while the reference's is an opaque interface of fifteen instance methods; separating them needs an authored-facing Result declaration distinct from the representation the fork's own lowering emits `.ok` reads against — a design change, not a walk fix, and fail-**closed** on the reference. Measured beside it: `.value`/`.error` read WITHOUT a `.ok` guard were already `TS2339` on **both**, so the discriminant was the only gateway, and `isOk()` narrows on **neither** (`if (outcome.isOk()) { return [outcome.value] }` is `TS2339` at `.value` on both). That last fact is why this read as a capability: failures.mdx §Authorability states "the language has no form that extracts the error from a Result" and marks "Whether Smithers gains an error-extraction form" **Open**, so the fork had settled an Open decision on its own. The case pins the must-use consequence, which is locked; the spelling belongs to the ledger owner. `07/every-listed-consumption-form-is-accepted` is the acceptance half and already pins `isError()` as the inspecting form. |
| 12.4 | a Result left by `await` still must be consumed | failures.mdx §Promise Semantics | covered | `07/await-leaves-a-result-that-must-still-be-consumed` |
| 12.5 | an inferred-fallible function crossing a general callback boundary needs a contract | poc README SMITHERS1303 | covered | `07/inferred-fallible-callback-needs-a-contract` |
| 12.5a | **…and the boundary is a VALUE edge, not an argument position** | failures.mdx §Inference and Public Contracts ("Public, abstract, ambient, and declaration-only contracts MUST express fallibility directly with `Result<A, E>`"); the callee invokes a function received inside a container exactly as it invokes one passed directly | **covered, eleven spellings** | `07/a-fallible-callback-inside-an-object-literal-argument-needs-a-contract`, `…-inside-an-array-literal-argument-…`, `a-parenthesized-fallible-callback-argument-…`, `…-through-an-as-cast-…`, `…-argument-to-a-new-expression-…`, `…-two-object-levels-deep-…`, `…-through-a-satisfies-expression-…`, `…-through-an-array-spread-…`, `a-fallible-shorthand-method-in-an-argument-…`, `a-shorthand-property-name-carries-the-same-callback-contract`, `a-try-finally-callback-still-carries-its-throw-across-the-boundary`. **Ten of the eleven were a live fail-open on BOTH backends** and were measured executing with `isOk() === true` carrying a `Result` in the success payload, with zero language *and* zero emitted-TypeScript diagnostics; the eleventh (`new`) was a position neither backend's visitor ever entered. The shorthand-property-name row is the sharpest: `{ transform }` ran on both backends while the byte-equivalent `{ transform: transform }` was refused on both. One case per spelling, for the same reason 12.1 needed one per discard spelling. |
| 12.5b | **…and an inferred Result return manufactured by the abolished `!` meaning is not a contract** | failures.mdx §Failure Propagation ("`!` MUST NOT retain TypeScript's non-null assertion meaning in `.sm`") with §Inference and Public Contracts | covered | `07/a-propagating-callback-needs-a-contract-even-though-its-inferred-type-is-a-result` (the direct-argument spelling, which is why the defect was invisible to an "it's only object literals" reading) and `07/a-fallible-callback-in-a-map-argument-needs-a-contract` (**xfail go** for an unrelated extra `SMITHERS1204`; see 4.18) — the ordinary `.map(() => r!)` shape, where accepting silently means the propagation returns from the *callback* and the failure never reaches the author's declared channel. |
| 12.5c | **…and the rule does not fire on a callback that owes nothing** | failures.mdx §Inference and Public Contracts (the rule is about a *fallible* value crossing); §JavaScript try/catch ("its presence MUST NOT change a function's Result contract implicitly") | **covered, five acceptance halves, all executed** | `07/a-contracted-callback-throw-reaches-the-caller-as-a-failure` (proves BOTH directions in one program: the throw arrives as the authored error class, and the plain return is lifted to a plain success rather than nested), `07/a-callback-forwarding-an-existing-result-needs-no-annotation`, `07/an-ordinary-callback-argument-is-untouched`, `07/a-javascript-caught-throw-in-a-callback-needs-no-contract` (one line from the `try`/`finally` refusal above, opposite verdict), `07/a-result-try-boundary-callback-needs-no-contract`. **The forwarding row is not filler**: the obvious stronger rule (always require a spelled annotation) was measured breaking it, `01/result-transformations-preserve-the-error-type`, and two `08-promise-chaining` cases. |
| 12.13 | **a stored collection is discharged only by giving a Result back, and a BOUND container does not escape the walk** | failures.mdx:190 (the five named forms); the transfer rule of 12.10 | **covered, both directions** | Refusals: `07/array-length-is-not-consumption-of-a-result-collection`, `07/handing-a-result-collection-to-a-user-function-is-not-consumption`, `07/destructuring-a-stored-collection-does-not-release-its-elements`. Acceptances: `07/a-nested-object-literal-is-consumed-through-its-property-chain`, `07/an-object-of-results-returned-from-a-function-is-consumed-by-its-property`, `07/result-all-on-a-bound-array-is-consumed-by-propagating-it`. **The guard that stops the transfer rule from being widened until containers are transparent** is `07/a-lifted-call-stored-into-a-plainly-typed-array-is-still-a-discard`: the call lifts to `Result<number, Panic>` while its declaration still says `number`, so the array's own type is `number[]`, it does not hold the channel, and the store is a fiction. Its foreign twin is `09/foreign-module-without-a-trust-marker`. |
| 12.13a | **a `return` is a TRANSFER, so the obligation must land on the caller — and it discharges only when the enclosing function's return type still carries the channel** | failures.mdx:190 (`returning` is one of the five forms, and it is a form because the value goes *somewhere*); type-system.mdx:56; requirements.mdx:88 for the Promise half | **covered, both directions, and the refusing half was demonstrated failing pre-fix** | Refusals, all four measured compiling and RUNNING to exit 0 on a reconstructed pre-change tree, on **both** backends, with identical stdout: `07/a-returned-result-collection-charges-its-caller` (`SMITHERS1301@15:20` — the executed defect; it printed `saved 3 records` while a checked `SaveFailed` was thrown and dropped), `07/an-awaited-result-collection-charges-its-caller` (the `await` spelling — removing the Promise layer must leave the collection owed), `07/a-returned-promise-collection-charges-its-caller` (**`SMITHERS1402`**, the twin that proves the receiving predicate names WHICH channel it found rather than answering yes/no — a boolean would have to report `1301` for a container of Promises), and `07/a-collection-laundered-through-an-opaque-return-type-is-still-a-discard` (`pack(): unknown`, charged INSIDE the callee at the element, which is what keeps the two ends of the transfer symmetric: a `return` discharges exactly when the caller inherits). Acceptances, proved enforced by mutation rather than by a pre-fix demonstration, because their whole point is that they were green before and must stay green: `07/a-returned-result-collection-is-consumed-by-result-all`, `07/a-returned-result-collection-is-consumed-by-an-index-read` (unbound — `pack()[0]!` never binds the container), and **`07/a-published-result-collection-with-no-caller-is-an-ordinary-transfer`**, which is the sharpest and which neither of the others substitutes for: the obvious way to close the defect is to refuse the CALLEE, that reading passes both other guards because both of them call `pack()` and consume what comes back, and it would refuse every library that publishes `Result<A,E>[]`. Read it beside the `: unknown` row — the pair fixes the transfer/discard boundary at the RETURN TYPE rather than at the shape of the returned expression. |
| 12.14 | **a consumption written inside a nested function body is still a consumption** | failures.mdx:190 — the five forms are *acts performed on the value*, and no sentence conditions any of them on the function body the act is written in | **covered by a pair** — one half was `xfail go` until 2026-08-28, when the parameter-ownership walk moved onto the same per-file identifier index the binding rule already used | `07/a-result-consumed-only-inside-a-callback-is-consumed` (a local binding — passes on both) and `07/a-result-parameter-is-consumed-by-an-unwrap-inside-a-callback` (**xfail go** — the fork reports `SMITHERS1302` on a parameter consumed one line later). The pair is what makes the verdict decisive rather than arguable: the two programs differ only in where the Result came from, and the fork accepts one and refuses the other, so it is inconsistent with itself about the same consumption site. **Found by this revision**, as a second diagnostic on 12.5b's case, then isolated with four probes varying one thing at a time. |
| 12.6 | a started Promise must be consumed | DECISIONS Locked | covered | `07/promise-must-be-consumed` |
| 12.8 | **the discharge set is the compiler's own combinators, not anything spelled like them** | failures.mdx §Matching; DECISIONS Locked (Concurrency) | **covered** | **`07/a-shadowed-result-namespace-does-not-discharge`** (a user's own `const Result = { all: … }` — `SMITHERS1302`) and **`07/a-shadowed-promise-namespace-does-not-discharge`** (a user's own `const Promise = { async all… }` — `SMITHERS1403`, and the member is `async` because a promise-shaped-return guard is satisfied by it). Both were reference fail-opens recognised by RAW SPELLING; both compiled clean before. Each case file carries an `export`, which is load-bearing: without one the source is a global script where a top-level `const Result` MERGES with the ambient declaration instead of shadowing it, and the case would pass without observing the rule. |
| 12.9 | **the real combinators still discharge** | failures.mdx §Matching; DECISIONS Locked (Concurrency) | **covered** | **`07/the-compiler-owned-result-all-discharges`** and **`07/the-ambient-promise-all-discharges-a-bound-promise`**, both deliberately in the BOUND form the refusal cases use. The over-correction they guard against is measured, not hypothetical: resolving the twelve RECEIVER consumers through the compiler's declarations reports a false `SMITHERS1301` when a member resolves nowhere, or resolves to an unrelated real declaration such as `String.prototype.match` — which is corpus case `01/inferred-result-for-an-unannotated-function`. Only the namespace call lacks a receiver already known to be the compiler's, which is why it is the one that must resolve by identity. |
| 12.7 | imported TS/JS that starts hidden background work owns that work | DECISIONS Locked; requirements.mdx §Scoping | **unwritable** | **the harness cannot observe this.** The rule is about ownership *inside* a foreign module, which by construction keeps ordinary Promise behavior and is not analyzed. Its enforceable half — a callback escaping into foreign code — is covered by `09/callback-escaping-into-foreign-code-is-rejected`. Observing the rest would need a case that detects work outliving the program, i.e. a timing or handle-count observation the runner does not make. |

## 13. Expression control flow

> [!WARNING]
> **Every row in this section is history, not live coverage.** The 2026-08-23
> withdrawal removed the expression-form control-flow grammar — value-position
> `if`/`switch`, braceless value `if`, labeled `break :label value`, labeled
> block and loop values, and loop `else` — leaving one addition,
> `if (const x = f(); cond)`, which is §13.17–§13.19 and is covered by
> `14-conditional-declarations/` (6 cases, present and green).
>
> Measured against the tree on 2026-08-26: `11-expression-if-switch/`,
> `12-labeled-block-values/` and `13-loop-values/` are **empty directories —
> 0 `.sm` files each**. §13.1–§13.16 cite **23 case names that no longer
> exist**, plus the three whole-directory globs `11/*`, `12/*` and `13/*` at
> §13.1 and §13.2, which now resolve to nothing; Q1, Q2 and Q4 re-cite three of
> the same 23. A "covered" in a status column below is therefore a record of
> what was once measured, not a claim about the corpus as it stands.

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 13.1 | blocks, `if`, `switch` are usable as expressions | control-flow.mdx §Expression Forms | covered | `11/*`, `12/*` |
| 13.2 | `while` / `for` produce values **only** through the labeled form with a value break and an `else` | control-flow.mdx:19-22 (**Direction**) — but see **Q1** | covered **against the specification page; contradicted by the ledger** | `13/*` covers `for…of`, counted `for`, and `while`; `11/unlabeled-loop-expression-is-rejected` pins the rejection (`SMITHERS1702`, green on both). The previous revision recorded this conflict as **resolved**. It is not. Only `specification/control-flow.mdx` was narrowed; `docs/DECISIONS.md:289` still reads "**Locked:** Blocks, `if`, `switch`, `while`, and `for` can be expressions", and `specification/index.mdx:54` gives the ledger priority in a conflict. So the corpus is green against the page that loses the tie-break. See Q1. |
| 13.3 | an expression construct has a statically determined type from its value-producing exits | control-flow.mdx §Expression Forms | covered | `12/labeled-block-may-complete-without-a-value`, `13/loop-value-without-an-else-is-rejected`, `12/plain-break-out-of-a-value-block-is-rejected` |
| 13.4 | a value-producing `if` requires an else branch | control-flow.mdx §If; poc README SMITHERS1705 | covered | `11/if-expression-requires-an-else-branch` |
| 13.5 | expression switch value is the selected case's final expression | control-flow.mdx §Switch; DECISIONS Locked | covered | `11/switch-case-final-expression-is-the-value` |
| 13.6 | expression switches MUST NOT fall through between cases | control-flow.mdx §Switch | covered | `11/expression-switch-does-not-fall-through` |
| 13.7 | statement switches keep TypeScript fallthrough and `break` | control-flow.mdx §Switch | covered | `11/statement-switch-fallthrough-over-a-widened-scrutinee` |
| 13.8 | **switch clauses are colon-delimited; there is no arrow-arm switch grammar** | control-flow.mdx §Switch; DECISIONS Locked | covered | `11/arrow-arm-switch-grammar-is-rejected`, `11/arrow-arm-switch-mixes-two-grammars-in-one-switch` — the js markers are **retired**; the reference used to implement the arrow form, which was the previous revision's most serious finding. Both green on both backends. |
| 13.9 | a closed-union expression switch should be exhaustive | control-flow.mdx:42 (**SHOULD**); poc README SMITHERS1716 | covered — **but as a MUST, not a SHOULD** | `11/switch-expression-missing-a-union-member` declares `SMITHERS1716` and is green on both backends, so what is pinned is a hard error. The specification says SHOULD. An implementation that emitted a warning here would be conformant and would **fail** this case — and per gap #11 the warning would be invisible, so the case could not even be relaxed to match. The previous revision recorded this as "covered as a SHOULD", which understates what the corpus actually enforces. See **Q4**. `11/switch-with-a-default-over-an-open-scrutinee` is the negative control and is unaffected. |
| 13.10 | an order-unpreservable expression placement is rejected | poc README SMITHERS1707/1709 | covered | `11/if-expression-on-a-short-circuit-right-side-is-rejected`, `11/if-expression-with-a-braceless-branch-is-rejected` |
| 13.11 | labeled `break :label value` combines reachable break values | control-flow.mdx §Labeled Break Values (**Direction**) | covered | `12/labeled-block-produces-a-value`, `12/labeled-block-joins-two-value-types` |
| 13.12 | **a declaration inside an expression block follows ordinary lexical scope** | control-flow.mdx §Blocks | covered | **`12/a-declaration-in-a-value-block-follows-lexical-scope`** — load-bearing because the lowering textually hoists the labeled block out of the expression it was written in |
| 13.13 | a value break inside a nested function is rejected | poc README SMITHERS1714/1715 | covered | `12/labeled-block-value-break-inside-a-nested-function-is-rejected` |
| 13.14 | a plain `break label` that would complete a value block without its value is rejected | poc README SMITHERS1714 | covered | `12/plain-break-out-of-a-value-block-is-rejected` |
| 13.15 | loop `else` supplies the non-break completion value | control-flow.mdx §Loop Else (**Direction**) | covered | `13/loop-value-with-an-else-completion`, `13/while-loop-value-with-an-else-completion`, `13/plain-break-flows-into-the-else-value`, `13/counted-for-loop-value-with-an-else-completion` |
| 13.16 | a cross-construct value break is rejected (nested label selection unfinalized) | control-flow.mdx §Loop Else; poc README SMITHERS1715 | covered | `13/cross-construct-value-break-is-rejected` |
| 13.17 | declarations in conditionals are adopted | control-flow.mdx §Declarations in Conditions; DECISIONS Locked | covered | `14/*` (6 cases) |
| 13.18 | a conditional declaration's binding is scoped to the construct and to nothing after it | control-flow.mdx §Blocks; poc README | covered | `14/conditional-declaration-binding-is-visible-in-else` (provisional, noted), `14/conditional-declaration-binding-does-not-escape-the-construct` (TS2304) |
| 13.19 | an unprovable conditional-declaration shape is rejected | poc README SMITHERS1717 | covered | `14/conditional-declaration-with-a-braceless-branch-is-rejected`, `14/conditional-declaration-with-var-is-rejected` |
| 13.20 | infinite loops, unreachable completion, nested label selection | control-flow.mdx §Loop Else ("not finalized") | unwritable | **blocked on an Open decision.** The one enforceable consequence — a cross-construct break — is 13.16. |
| 13.21 | **a value expression in an argument whose callee "cannot be proven order-stable"** (`SMITHERS1708`) | poc README; `poc/src/language/recover.ts:1337`. **No specification sentence requires the rejection** — control-flow.mdx requires that observable behaviour be preserved, which is a different claim | **deliberately NOT covered, and a case must not be written** | The case was written from the docs, measured, and **not landed**. The reference refuses `return pick()(score, if (on) { … } else { … })` because hoisting the branch would move it across a callee it cannot prove side-effect-free. The fork accepts it — and the acceptance was tested rather than assumed: with `pick()` and the branch each pushing to an observable log, the fork compiles the program and prints **`callee,arg`**, the authored order, byte-identical to the remedy the reference's own message prescribes (`const call = pick()`) and to the same program written with no expression-`if` at all. The fork's design documents say why (`compiler/GRAMMAR-SPIKE.md:832`: real `IfExpression` grammar, "there is no hoisting, so there is no evaluation order to preserve and no callee-stability proof to make"). **So this is a reference-side provability limitation, not a fork fail-open, and a corpus case declaring `SMITHERS1708` would turn the fork's correct behaviour into a conformance failure.** Its two siblings `SMITHERS1707` and `SMITHERS1709` are different: the fork implements both, and both are pinned at 13.10. Recorded here rather than in the corpus, which is the same convention `SMITHERS5215` is under. |

## 14. Cleanup

> [!WARNING]
> **Every row in this section is history, not live coverage.** The 2026-08-23
> withdrawal removed `defer` and `errdefer` along with the rest of the fork's
> grammar patches, and `10-defer/` is an **empty directory — 0 `.sm` files**,
> measured against the tree on 2026-08-26. §14.1–§14.7 cite **9 case names
> that no longer exist**.
>
> §14.7 is the row this matters most for: it reads "**covered** …
> **`10/async-errdefer-cannot-inspect-a-directly-returned-promise`**, green on
> both", and the SMITHERS code census likewise records `SMITHERS1713` as
> "**WRITTEN this revision**". Both sentences were true when written and are
> now claims about a deleted file, so the code they cover is unprobed —
> though the rule itself went with the grammar. §14.8 was already
> `unwritable`, and stays so for a second reason.

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 14.1 | `defer` registers cleanup for every scope exit | failures.mdx §Cleanup; control-flow.mdx §Deferred Cleanup | covered | `10/defer-runs-on-every-exit-in-reverse-order` |
| 14.2 | `errdefer` registers cleanup for a Result error exit only | failures.mdx §Cleanup | covered | `10/errdefer-runs-only-on-the-error-variant`, `10/errdefer-runs-on-unwrap-propagation`, `10/defer-and-errdefer-interleave-in-one-lifo-order` |
| 14.3 | `errdefer` needs a Result owner | poc README SMITHERS1711 | covered | `10/errdefer-without-a-result-owner-is-rejected` |
| 14.4 | multiple deferred operations run in one deterministic order | control-flow.mdx §Deferred Cleanup (**candidate LIFO, not locked**) | covered *as POC evidence* | `10/defer-runs-on-every-exit-in-reverse-order`, `10/defer-and-errdefer-interleave-in-one-lifo-order` — both `notes` fields record that the ordering is not yet locked, so a deliberate change is visible rather than silent |
| 14.5 | an unsupported `defer` placement or cleanup shape is rejected | poc README SMITHERS1710/1712 | covered | `10/defer-cleanup-must-be-on-the-marker-line`, `10/defer-cleanup-that-can-fail-is-rejected` |
| 14.6 | an async owner accepts a root awaited plain-Promise cleanup | poc README | covered | `10/async-defer-awaits-its-cleanup` |
| 14.7 | an async `errdefer` tail returning an unawaited Promise is rejected (`SMITHERS1713`) | poc README | **covered** | **`10/async-errdefer-cannot-inspect-a-directly-returned-promise`**, green on both. The previous revision recorded this as **partial** with the reason "isolating `1713` needs a narrower program", and that reason was correct and is now discharged: the narrower program has an async owner, an `errdefer` whose cleanup is a plain `void` call that cannot itself fail (so `SMITHERS1712` does not fire) and a Result-returning callee awaited nowhere (so `SMITHERS1402` does not fire either), leaving `SMITHERS1713` alone at the RETURN statement. The rule is the one 14.2 depends on: `errdefer` runs only on the error variant, so it must inspect the Result, and a directly returned Promise settles after the `finally` that would run the cleanup — both available guesses lose an obligation. A POC-boundary gate, not a specification sentence, and declared as such. |
| 14.8 | async finalization, defects, cancellation, cleanup-error composition | failures.mdx §Cleanup ("require further normative specification") | unwritable | **blocked on an Open decision** — explicitly unspecified by the page that would define it |

## 15. Cross-module rows and generics

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 15.1 | rows propagate across modules through direct static calls | poc README | covered | `15/generic-row-instantiation`, `05/requirement-propagates-across-modules` |
| 15.2 | a polymorphic row template instantiates per call site | poc README | covered | `15/generic-row-instantiation` |
| 15.3 | an unresolved row variable fails closed | poc README SMITHERS1803 | covered | `15/unresolved-row-variable-is-rejected` |
| 15.4 | a value escaping direct static-call analysis fails closed — **and an ordinary CALL does not** | poc README SMITHERS1802; requirements.mdx §Inference ("Requirement inference MUST be transitive through **ordinary calls**"); compatibility.mdx's fail-closed principle ("any construct whose lowering depends on information the file alone does not carry") | **covered, six cases, and until 2026-08-25 exactly one shape of the rule was probed** | The refusals: `15/higher-order-escape-is-rejected` (the alias escape, unchanged and byte-identical across the fix), **`15/an-object-literal-shorthand-escape-is-rejected`** — `{ count }` compiled on **both** backends where `{ count: count }` was refused, a live fail-open — **`15/a-tagged-template-callee-is-rejected`** and **`15/a-parameter-default-callee-is-rejected`**, both fail-closed because the callee's requirement row is charged **nowhere**, measured rather than assumed, and the second of which the fork used to accept. The acceptances: **`15/a-top-level-cross-module-call-is-an-ordinary-call`** (the `poc/src/data/**` shape — call edges were collected per function *body*, so a top-level call had none and the reference refused it while the fork accepted it), **`15/a-parenthesized-callee-is-an-ordinary-call`** (refused on both, while both already charged the row through the parentheses) and **`15/a-re-exported-binding-is-not-an-escape`**. The pair is the whole point: a rule that refuses a *value* and a rule that refuses a *call* are indistinguishable to a corpus that only ever asked about the value. Note what deliberately stays refused — an `as`-cast callee `(f as () => number)()` charges no row on either backend, so the relaxation stops at parentheses. |
| 15.5 | an instantiation must nominally cover a callback's declared row | poc README SMITHERS1806 | covered | `15/callback-row-must-be-nominally-covered` |
| 15.6 | a missing relative `.sm` module fails closed | poc README SMITHERS1801 | covered | `15/missing-relative-module-is-rejected` |
| 15.7 | **an import of a name the module does not export fails closed** | poc README SMITHERS1804 | covered | **`15/importing-a-name-a-module-does-not-export-is-rejected`** — the sibling half of 15.6: the module is there and the *name* is not, so the binding would otherwise carry an empty row rather than an unknown one |
| 15.8 | row members carry module-qualified nominal identity | poc README | covered | `04/same-named-errors-in-two-modules` |

## 16. Retired syntax — `19-retired-syntax/` (38 cases)

DECISIONS locks the *absence* of these forms; the poc README records that each
receives a migration diagnostic (`SMITHERS1001`). A compiler that silently
accepted one would be accepting a language Smithers does not have.

| # | retired form | replacement | status | case |
| --- | --- | --- | --- | --- |
| 16.1 | `error Name {}` declaration | `class Name extends Error` | covered | `19/error-declaration-is-retired` |
| 16.2 | `throws` row clause | `Result<A, E>` | covered | `19/throws-clause-is-retired` |
| 16.3 | named `uses` clause | `Capability.context()` | covered | `19/uses-clause-is-retired` |
| 16.4 | `!T` return marker | `Result<T, E>` | covered | `19/bang-return-marker-is-retired` |
| 16.5 | `?T` type grammar | `Optional<T>` | covered | `19/question-optional-grammar-is-retired` |
| 16.6 | `orelse` operator | `Optional` methods | covered | `19/orelse-operator-is-retired` |
| 16.7 | `.?` postfix operator | `Optional.unwrap()` | covered, **and the recorded gap is closed** | `19/dot-question-operator-is-retired` (plain receiver), **`19/dot-question-on-an-optional-call-is-retired`** (an Optional-returning call — the spelling a migrating user actually writes, which used to crash the frontend) |
| 16.8 | prefix `try` marker | `Result.unwrap()` | covered | `19/prefix-try-marker-is-retired` |
| 16.9 | postfix `catch` expression | `Result.match()` / `recover()` | covered | `19/postfix-catch-expression-is-retired` |
| 16.10 | throw as an expression | statement `throw` | covered | `19/throw-is-not-an-expression` |
| 16.11 | **none of the above may be claimed in ordinary TypeScript** | poc README; compatibility.mdx §Source Relationship | covered | **`19/retired-operator-words-as-members-stay-ordinary`**, **`19/retired-clause-words-in-type-positions-stay-ordinary`** — see §1.7 |

## 17. Imports, asset loaders, and import attributes

| # | obligation | source | status | notes |
| --- | --- | --- | --- | --- |
| 17.1 | every non-code/foreign-source import selects its loader with standard import attributes | DECISIONS Locked; comptime.mdx §Built-In Formats | covered | **`23/a-json-import-selects-its-loader-with-an-import-attribute`**, **`23/a-text-import-embeds-the-source-string`**, **`23/a-bytes-import-exposes-the-file-as-a-typed-byte-array`**, and the three fail-closed cases 17.8–17.10. Four `type` strings the specification names — `json`, `text`, `bytes`, `markdown`/`mdx` — all selected the same way. The previous revision named the harness change this needed; it is done. A case now ships real sibling files through an `assets` field, both backends stage the same bytes at the same paths, and a satisfied verdict is audited against an `assets` stage so a green asset case cannot be green because the file was never opened. |
| 17.2 | `with { type: "json", mode: "const" }` produces a deeply readonly literal type | DECISIONS Locked; comptime.mdx | covered | **`23/const-json-preserves-literals-and-is-deeply-readonly`** — the case the ledger calls out by name. The observation is an invariant `Exactly<typeof config, { readonly mode: "production"; readonly ports: readonly [80, 443] }>` alias against the type `ASSET_LOADERS.md` prints for that exact file: a widened literal or a dropped `readonly` stops the program compiling under the emitted-TypeScript check. Its other half is **`23/an-ordinary-json-import-keeps-typescript-semantics`**, which mutates the module object to prove const preservation stayed opt-in. |
| 17.3 | built-in Markdown and MDX loaders | DECISIONS Locked; comptime.mdx | **partial** | **`23/a-markdown-import-exposes-its-source-and-locations`**, **`23/an-mdx-import-produces-a-component-module`**. The **locked** halves are pinned: Markdown's raw-source default, MDX's component vocabulary, MDX expression holes as never-evaluated identifier placeholders, and "Markdown and MDX MUST preserve source locations" — observed by slicing the raw source at the offset the loader reported for a heading and getting that heading back. The **open** half is not claimed: the exported module shapes are explicitly open, so the cases read the provisional `frontmatter`/`headings`/`components`/`expressions` exports only as the channel carrying the locked facts, and say so. |
| 17.4 | user-defined comptime loaders | DECISIONS Locked | **partial** | The *input* half is covered: **`23/the-type-attribute-selects-the-loader-not-the-extension`** stages a `.yaml` — an extension no built-in claims — and reads it because the attribute named a loader. The *registration* half is not, and is **blocked on an Open decision** (ledger item 7, "Specify the comptime loader registration API"; `ASSET_LOADERS.md` calls the `comptime.loader("yaml", fn)` spelling provisional and "not a locked production contract"). Writing it would also bind the corpus to the POC's Deno loader sandbox, which the Go backend has no counterpart for, so a registration case would be a `js`-only measurement of a provisional spelling. |
| 17.5 | file extensions do not create a second implicit loader-selection grammar | DECISIONS Locked | covered | **`23/the-type-attribute-selects-the-loader-not-the-extension`** — both directions in one program: a `.md` asked for as `text` comes back as raw text rather than the Markdown module shape, and a `.yaml` is readable only because the attribute named a loader. |
| 17.6 | a relative `.sm` import resolves within the supplied project, or fails closed | poc README SMITHERS1801/1804 | covered | `15/missing-relative-module-is-rejected`, `15/importing-a-name-a-module-does-not-export-is-rejected`, `15/generic-row-instantiation` |
| 17.7 | file imports are first-class incremental build nodes | DECISIONS **Direction** | unwritable | **blocked on an Open decision**, and each case gets a fresh comptime *and* asset cache inside its own staging tree, so the corpus cannot observe incremental identity at all. Deliberate: a corpus that shared warm state between cases would not be measuring one program at a time. |
| 17.8 | a non-code import with no `type` attribute is rejected rather than guessed from the extension | comptime.mdx §Built-In Formats; DECISIONS Locked | covered | **`23/an-asset-import-without-a-type-attribute-is-rejected`** (`SMITHERS5201` at the import declaration). The fail-closed direction of 17.1: the file exists and a JSON loader is registered, and the import is still refused because nothing named the loader. |
| 17.9 | the withdrawn `assert { ... }` spelling does not select a loader | comptime.mdx §Built-In Formats ("**standard** import attributes"); guide/asset-imports.mdx | covered | **`23/the-legacy-assert-attribute-spelling-is-rejected`** (`SMITHERS5202` at the attribute clause). Load-bearing because `assert { type: "json" }` still parses: accepting it would leave two selection grammars in the language. |
| 17.10 | a type-only asset import, and a specifier that escapes the project root, fail closed | guide/asset-imports.mdx; ASSET_LOADERS.md (Locked) | covered | **`23/a-type-only-asset-import-is-rejected`** (`SMITHERS5208`; an erased import would take a loader's types without leaving the runtime binding or the build-graph node), **`23/an-asset-path-outside-the-project-root-is-rejected`** (`SMITHERS5209` at the specifier). The second measures the *specifier*: a real `counter.json` is staged inside the root and the escaping spelling is refused anyway. The "exists but outside the root" variant cannot be staged — see gap #7. |
| 17.11 | loading happens during compilation and adds no runtime platform requirement | ASSET_LOADERS.md (Locked) | **UNCOVERED since 2026-08-23 — its only observation channel was withdrawn.** The obligation stands; the case is deleted because it observed the rule through a native pin, and no surviving `.sm`-observable channel reports a platform requirement. Unit-level only: `compiler/fork_asset_test.go` and the artifact assertion in `compiler/fork_reexport_test.go`. What follows is the pre-withdrawal record. | **`23/an-asset-import-adds-no-runtime-platform-requirement`** (deleted). The previous revision recorded this as the most serious finding on the page, with **both** backends contradicting it. **Both markers are retired**: the reference's portability pass now knows which relative imports the source-asset stage owns, and the fork now has a source-asset stage. Measured `XPASS` on both backends before the markers were deleted, and both now print `production/2`. The retirement and the observation it replaces are recorded in the case's own `notes`. |

| 17.13 | **`export * from` an asset is rejected; the attributed named/namespace form is not** | ASSET_LOADERS.md (Locked) "The required string-valued `type` selects its loader"; the same page names "bare star re-exports" as unsupported and "attributed named/namespace re-exports" as integrated, in one sentence | covered | **`23/a-bare-star-re-export-of-an-asset-is-rejected`** (`SMITHERS5206` at the statement, 1:1 — its `SMITHERS5207` sibling three lines away in the same walk reports on the *specifier*, which is what distinguishes them) and its acceptance control **`23/a-namespace-re-export-of-an-asset-is-accepted`**. The control is not decoration: the fork's asset discovery and lowering were import-only until this session, so "refuses every asset re-export" was a live way to satisfy the refusal case. |
| 17.14 | **an asset specifier must be relative** | ASSET_LOADERS.md (Locked) "Loaders use compiler-tracked asset imports rather than ambient filesystem … access"; ":192 Loader identity must be stable across machines. Package resolution and its lock …" | covered | **`23/a-non-relative-asset-specifier-is-rejected`** (`SMITHERS5207` at the specifier). The fail-open is not a missing file — `config.json` **is** staged at the root — but a compile-time read whose input the build graph cannot name, because package resolution depends on `node_modules` layout rather than on anything the graph records. |
| 17.15 | **a loader that cannot build its asset fails the compile, at the import** | ASSET_LOADERS.md (Locked) "Loading happens during compilation"; "Loader diagnostics … participate in normal type-checking, editor, and source-map behavior" | covered | **`23/a-loader-that-cannot-read-its-asset-fails-the-compile`** (`SMITHERS5213` at the import). `conformance/assets/truncated.json` is a real staged file that is not valid JSON, so the loader is genuinely selected, genuinely runs and genuinely fails — which is what separates this from a missing-file case. No `messageContains`: the two backends report the underlying parser's own words, so the message is a third party's text and is not the contract. |
| 17.16 | **a dynamic asset import needs a literal specifier and a literal attribute object** | ASSET_LOADERS.md (Locked), twice: the static-selection rule, and "Loading happens during compilation. It does not add `FileSystem` or another runtime platform requirement to the importing program." The page names the spelling: "nonliteral dynamic imports/attributes … remain unsupported." | **covered, `xfail go`** | **`23/a-non-literal-dynamic-asset-import-is-rejected`** (`SMITHERS5218` at the `import(` call). **This is the finding of this revision.** The fork compiles the program clean and emits a **runtime** dynamic import of the asset; the emitted JavaScript exits 1 under node with `ERR_MODULE_NOT_FOUND` for `config.json`. See the `xfail` register. |

**This was the largest area with zero coverage; it is now the largest area of
new coverage.** Two revisions ago it said: "What remains open here is genuinely
open — the loader registration API and the Markdown/MDX module shapes are item 7
of the ledger's own 'Immediate unresolved design work' list — rather than
untested." **That sentence was withdrawn as too generous, and it stays
withdrawn.** Two things are open. The rest were neither open nor covered, and
this is the second revision to reduce that number:

| # | the asset-code census, re-measured | evidence |
| --- | --- | --- |
| 17.12 | `poc/src/build/source-assets.ts` emits **19** asset codes, `SMITHERS5201`–`SMITHERS5219`. The corpus now declares **eleven**: `5201`, `5202`, `5203`, `5204`, `5205`, `5206`, `5207`, `5208`, `5209`, `5213`, `5218`. **Eight** are unpinned: `5210`, `5211`, `5212`, `5214`, `5215`, `5216`, `5217`, `5219`. Four (`5201`, `5202`, `5208`, `5209`) two revisions ago; seven one revision ago; eleven now. | `grep -oh 'SMITHERS52[0-9][0-9]' poc/src/build/source-assets.ts \| sort -u \| wc -l` → 19; `grep -roh '"code": "SMITHERS52[0-9][0-9]"' conformance/corpus/ \| grep -o 'SMITHERS[0-9]*' \| sort -u \| wc -l` → 11; `comm -23` of the two → the eight |

The previous revision pinned the three that make loader selection *static* —
`SMITHERS5203`, `SMITHERS5204`, `SMITHERS5205` — through four cases:

| case | pins |
| --- | --- |
| **`23/a-non-identifier-import-attribute-name-is-rejected`** | `SMITHERS5203`. `_mode` is one character from the real selector and matches no admitted name; accepting it carries an unvalidated key into the loader options *and* into the asset's cache/identity key, so a typo becomes a distinct compiled artifact. |
| **`23/a-duplicate-import-attribute-is-rejected`** | `SMITHERS5204`, and it is the highest-consequence of the four: a last-wins implementation does not merely accept the program, it compiles a JSON file through the `text` loader. Same source, different value, no diagnostic anywhere. |
| **`23/a-computed-import-attribute-value-is-rejected`** | `SMITHERS5205` + the `SMITHERS5201` that follows from no loader being named. The identifier is declared above with the value `"json"` precisely so an implementation that resolved it would find a real loader and compile. |
| **`23/a-template-literal-import-attribute-value-is-rejected`** | the same pair, through a different predicate. A no-substitution template literal has the same TEXT as the string literal beside it, and `isStringLiteralLike` matches it while `isStringLiteral` does not — a fourth admission hole the accepted-surface census did not name. |

**This revision took four more, prioritised the same way** — fail-open direction
of the Locked static-selection rule first, unusual shapes last: `SMITHERS5207`
(non-relative specifier), `SMITHERS5206` (bare star re-export), `SMITHERS5218`
(non-literal dynamic import) and `SMITHERS5213` (loader failure), tabled at
17.13–17.16 above, plus one acceptance control.

**The eight that were skipped, each with its reason.** These are measurements,
not guesses; three of them changed a previously recorded reason.

| code | what it rejects | why no case |
| --- | --- | --- |
| `SMITHERS5210` | asset hard-link aliases | needs two directory entries for one inode inside the staged project. The `assets` staging channel copies files, and the Go bridge stages entirely in-request with no filesystem identity at all, so the two backends could not be asked the same question. |
| `SMITHERS5211` | asset graph exceeds *N* files (`:1172`) | the case would have to ship the ceiling. §21.4 records that the CLI side of this same limit is untested too, so **both** enforcements are unmeasured. |
| `SMITHERS5212` | asset graph exceeds *N* bytes (`:1176`) | same, and the fixture would dominate the repository. Reference-only: not in the fork's code set. |
| `SMITHERS5214` | loader-emitted diagnostics, passed through with the loader's own `level` | **not observable.** The level may be a warning, and observation gap #11 records that the harness filters to `severity === "error"` on both backends. Reference-only as well. |
| `SMITHERS5215` | one path being both an asset module and a code module | **measured and deliberately not landed** — the reference reports `SMITHERS5215@1:20` and the fork reports `SMITHERS5209` at the same position, and which of those is right cannot be decided from the conformance side. Full reasoning in §"Rules both implementations have and no case probes". |
| `SMITHERS5216` | a generated asset identity colliding with a real path | the staged path is derived from the asset's content digest, so a case would hard-code a digest and break when the fixture's bytes changed. |
| `SMITHERS5217` | a generated-module construction failure | carries a third party's exception text and is unreachable for any input a case can stage. `SMITHERS5213` covers the reachable half of "the loader failed" and **is** pinned. |
| `SMITHERS5219` | nested generated-module graph invariants (cycle, depth, undeclared dependency, identity mismatch) | needs a loader that emits references to other assets, i.e. the `comptime.loader` registration API — which is **open** (17.4) and provisional. Reference-only. |

Ranking the unmeasured guards below the two genuinely-open items inverts the
severity: an open decision costs nothing until it is made, and an unmeasured
fail-closed guard costs whatever it was guarding.

The **22** cases live in `23-asset-imports/` and read from
`conformance/assets/`: `config.json`, `counter.json`, `system.txt`, `logo.bin`,
`reviewer.md`, `coding-agent.mdx`, `settings.yaml`, `truncated.json`. **21 pass
on both backends and one carries an `xfail go`** (17.16). The twelve `xfail go`
markers and one `unsupported` row this area used to carry are all gone — the
fork gained a source-asset stage with all six built-in loaders and owns the
fail-closed refusals under their own codes — and the one `xfail js` marker went
with them.

## 18. Source-text fidelity — `22-source-text-fidelity/` (3 cases)

Nothing in the corpus used a character outside ASCII until this area existed, so
nothing could notice a byte-versus-code-unit confusion. The three cases found
one defect in each backend; **both are now fixed** and all three pass on both.
Keep the area: it is the only part of the corpus that would notice either
defect returning, and all non-ASCII in the corpus is confined to it so every
other case measures its own rule.

| # | obligation | source | status | case |
| --- | --- | --- | --- | --- |
| 18.1 | non-ASCII string literals and template substitutions survive lowering | compatibility.mdx §Source Relationship | covered | `22/non-ascii-string-content-round-trips` |
| 18.2 | a diagnostic reported after non-ASCII source text keeps its authored column | conformance/README.md ("**authored** 1-based coordinates"); compatibility.mdx §Source Relationship | covered | `22/diagnostic-columns-survive-non-ascii-source-text` — the go marker is **retired**; the fork used to report UTF-8 byte columns |
| 18.3 | **any** named class extending `Error` is a nominal recoverable error, including one whose identifier is non-ASCII | failures.mdx §Error Classes | covered | `22/a-non-ascii-error-class-name-is-a-nominal-error` — the js marker is **retired**; the stable-Error-identity validator used to be ASCII-only |

## 19. Comptime — `16-comptime/` (10 cases)

The previous revision listed these obligations "so the census is complete" and
assigned **no status to any of them**, on the grounds that the area was "owned by
another lane". Listing without a verdict is not a census, and no other lane
returned. This is the table.

**Measured 2026-08-23 from source, not from a run.** `16-comptime` has 9 cases
(`ls conformance/corpus/16-comptime/*.expected.json | wc -l` → 9) against 34
normative sentences below, of which 28 are MUST/MUST NOT
(`grep -o MUST docs/src/pages/specification/comptime.mdx | wc -l` → 37 including
the repeated `MUST NOT` halves). The comptime frontend emits **22** diagnostic
codes in the `VCT1000`–`VCT1207` families (`poc/src/build/comptime-intrinsic.ts`);
the corpus declares **three**: `VCT1004`, `VCT1005`, `VCT1012`.

Rows 19.20–19.27 are the loader and built-in-format contract, which §17 audits
against `23-asset-imports` rather than `16-comptime`; they are listed here for
completeness and cross-referenced rather than re-scored.

| # | normative sentence (comptime.mdx) | status | reason / cases |
| --- | --- | --- | --- |
| 19.1 | comptime MUST use ordinary TypeScript call syntax, not a keyword (`:7`) | covered | every case imports `{ comptime }` from `smithers:comptime` and calls it |
| 19.2 | the compiler MUST recognize the **resolved binding**, not the identifier text (`:13`) | covered | `16/comptime-value-is-evaluated-during-compilation` imports `{ comptime as build }` and the aliased call still evaluates at compile time |
| 19.3 | aliasing the import MUST preserve its meaning (`:13`) | covered | same case. **This corrects a claim made against this page:** an external triage reported that only the negative twin existed. The positive alias case is `comptime-value-is-evaluated-during-compilation.sm:1`. |
| 19.4 | an unrelated function named `comptime` MUST remain ordinary (`:13`) | covered | `16/an-unrelated-local-comptime-stays-an-ordinary-function` |
| 19.5 | `comptime(value)` MUST be evaluated during compilation and the call replaced by the result (`:15`) | covered | `16/comptime-value-is-evaluated-during-compilation` — template strings, `join`, `toUpperCase`, `%`, `map`, `Object.keys` all resolve before emit |
| 19.6 | `comptime(fn)` MUST return a compile-time function and **MUST NOT invoke it** merely because it was passed (`:17`) | **partial** | `16/comptime-function-is-interpreted-during-compilation` pins that *calling* the returned function evaluates at compile time. The **MUST NOT invoke** half is unpinned: no case passes a function whose invocation would be observable and then asserts the observation is absent. That is the fail-open direction and it is one cheap `expect: "output"` case away. |
| 19.7 | every call of a compile-time function MUST be evaluated during compilation (`:17`) | covered | same case: locals, assignment, `for…of`, `while`, `break`, `continue`, and container mutation all run before emit |
| 19.8 | the compiler MUST erase or lower recognized imports and calls (`:26`) | covered structurally | every green output case runs with no `smithers:comptime` module present at runtime |
| 19.9 | uncompiled JavaScript execution MUST **fail during virtual-module loading** rather than provide a runtime fallback (`:26`) | **uncovered** | The mechanism exists and is verified present for the sibling module: `poc/src/build/schema-derive.ts:29-30` emits a stub whose top-level `throw` rejects dependency evaluation before an importing module runs. Nothing measures the `smithers:comptime` equivalent, and the harness cannot: it compiles every case, so the uncompiled path is unreachable by construction. Closing this is a unit test, not a corpus case. |
| 19.10 | the compiler **MAY** evaluate automatically (`:30`) | not an obligation | a MAY with no fail direction |
| 19.11 | an explicit `comptime(...)` MUST be evaluated; compilation MUST fail if it cannot be (`:32`) | covered | `16/a-comptime-value-that-is-not-canonical-data-is-rejected` (`VCT1005`) |
| 19.12 | comptime MUST NOT silently defer explicit work to runtime (`:34`) | covered | same case — the failure is a diagnostic, not a deferral |
| 19.13 | a generated type MUST participate in ordinary checking, declarations, diagnostics, and editor behavior (`:38`) | **partial** | `16/comptime-binding-used-in-type-position` pins the checking half (a comptime binding read in type position gains a same-named literal type alias and keeps its value). Declarations, diagnostics, and **editor behavior** are not observable from a `.sm` program's stdout; the LSP half is `test/lsp.test.mjs`'s territory and §21's. |
| 19.14 | the language MUST NOT require a separate `runtime type` declaration modifier (`:40`) | **uncovered** | This is a retired-syntax-shaped obligation with an exact home — `19-retired-syntax` — and no case. DECISIONS locks the same absence. The corpus pins the absence of ten other retired forms (§16); this eleventh one is missing for no reason anybody recorded. |
| 19.15 | comptime MUST be hermetic and deterministic with respect to declared inputs (`:44`) | **partial** | the two cases below are the only evidence |
| 19.16 | comptime MUST NOT observe **seven** named ambient sources: filesystem, network, environment variables, process state, wall clock, randomness, mutable host state (`:46-54`) | **partial — two of seven** | covered: wall clock (`16/the-wall-clock-is-unreachable-from-comptime`, `VCT1004`) and randomness (`16/randomness-is-unreachable-from-inside-a-comptime-loop`, `VCT1004`). **Uncovered: filesystem, network, environment variables, process state, and mutable host state.** All five are siblings of the two that exist, use the same diagnostic, and would be near-copies of cases already in the tree. Fail-open direction: an ambient read that slips through makes a "hermetic" compile-time value host-dependent, and every downstream cache identity that includes it becomes wrong rather than merely stale. |
| 19.17 | an equivalent value **MAY** enter through a compiler-owned tracked input API (`:56`) | not an obligation | a MAY |
| 19.18 | compiler-known imports and embedding MUST be supported; the compiler MUST record every such asset as an incremental dependency (`:60`) | **partial** | the import/embed half is §17's `23-asset-imports`. The **incremental-dependency** half is unobservable here: §17.7 records that each case gets a fresh comptime and asset cache inside its own staging tree, deliberately, so the corpus cannot observe incremental identity at all. |
| 19.19 | arbitrary unavailable runtime I/O MUST NOT be performed merely because a call occurs beneath `comptime` (`:62`) | **partial** | the same two determinism cases; the other five ambient sources of 19.16 are the same gap seen from the other side |
| 19.20 | `comptime.target` MUST be exposed as a typed value (`:66`) | covered | `16/comptime-target-selects-one-branch` (a target-selected branch is folded and the unselected arm is not emitted) and **`16/the-comptime-target-is-one-declared-input-for-both-backends`**, which reports the target itself rather than branching on one value. The second exists because the first could not fail: it branches on `=== "browser"`, and the two backends were being given *different* declared targets — `node-es2022` on the reference, `typescript-node` on the fork — which both take the same arm. Every comptime case was therefore two compilations of two different programs. One shared `comptimeTarget` constant in `conformance/runner/corpus.mjs` is now sent explicitly to both, and this case is the row that notices if that ever stops being true. |
| 19.21 | a target-selected branch MUST NOT emit unselected runtime code (`:68`) | **partial** | the same case pins that the **selected** branch's value is what runs. It does not observe the **absence** of the unselected branch in emitted code, because the harness observes stdout and diagnostics, not emit. The case's title claims more than the case measures. |
| 19.22 | target-dependent loaders and derived artifacts MUST include the target in their cache identity (`:68`) | **uncovered** | same reason as 19.18: no case can observe a cache key, and by design no case shares warm state with another |
| 19.23 | Smithers MUST support comptime loaders for non-code assets (`:72`) | see §17.1–17.5 | audited there |
| 19.24 | a loader MUST satisfy five clauses: immutable compiler-owned bytes, tracked transitive inputs, a checked typed module, preserved source spans, incremental caching (`:74-80`) | see §17.3, §17.4 | source spans pinned by `23/a-markdown-import-exposes-its-source-and-locations`; the registration half is blocked on an Open decision; incremental caching is 19.22's gap |
| 19.25 | a loader MUST NOT use ambient filesystem, network, clock, random, or process access (`:82`) | **uncovered** | the loader sandbox exists (`poc/src/build/sandboxed-loader.ts`) and no case reaches it, because loader **registration** is blocked on an Open decision (§17.4). The rule is not open; the spelling that would let a case reach it is. |
| 19.26 | the toolchain MUST include loaders for JSON, Markdown, and MDX (`:86`) | see §17.1, §17.3 | covered, green on both backends (markers retired) |
| 19.27 | const JSON MUST preserve literals recursively and expose a deeply readonly type; existing TypeScript JSON imports MUST retain TypeScript semantics (`:88`) | see §17.2 | covered, green on both backends (markers retired) |
| 19.28 | non-code inputs MUST select loader and mode with standard import attributes (`:90-96`) | see §17.1, §17.5, §17.8, §17.9 | **covered in full**, green on both backends. The **staticness** half was the uncovered `SMITHERS5203/5204/5205` trio; it is now four cases, listed in §17. |
| 19.29 | Markdown and MDX MUST preserve source locations (`:98`) | see §17.3 | covered |
| 19.30 | a cache key MUST include every semantically relevant input, at minimum five named classes (`:102-108`) | **uncovered** | unobservable from the corpus for 19.22's reason. `poc/src/build/stable.ts` and the comptime cache are unit-test territory. |
| 19.31 | file mtime alone SHOULD NOT invalidate content whose semantic key is unchanged (`:110`) | **uncovered** | same |
| 19.32 | a compiler **MAY** limit comptime CPU, memory, recursion, and output size (`:114`) | not an obligation | a MAY |
| 19.33 | limit failures MUST produce **deterministic** diagnostics (`:114`) | covered | `16/an-unbounded-comptime-loop-exhausts-its-step-budget` (`VCT1012`) — the case declares an exact code and authored position, which is what "deterministic" buys |
| 19.34 | limit failures MUST NOT fall back silently to runtime behavior (`:114`) | covered | same case: the program is rejected, not emitted |

**Honest shape of §19.** Recognition, evaluation, target selection, and resource
limits are genuinely covered. Determinism is **two of seven**. Cache identity and
the uncompiled-execution guard are structurally outside what this harness can
see and need unit tests rather than cases. `runtime type` (19.14) has an obvious
home and no case. Five of the seven determinism cases would be near-copies of
cases that already exist.

## 20. Durable execution — `17-durable/` (26 cases)

Same correction as §19: the previous revision listed these "so the census is
complete" and scored none of them.

**This section still comes out mostly uncovered, and that is still the finding —
but the phase-1 half of it moved a long way on 2026-08-26.** `17-durable` has
**twenty-six** cases (`ls conformance/corpus/17-durable/*.expected.json | wc -l`
→ 26, up from 6, then 20, then 22) against the 40 normative sentences below, of
which the great majority are MUST/MUST NOT
(`grep -o MUST docs/src/pages/specification/durable-execution.mdx | wc -l` → 63,
counting each `MUST NOT` twice). The reference implements **29** durable
diagnostic codes — 25 in the `SMITHERS41xx` family (`4100`–`4123` plus `4199`)
and 4 in `SMITHERS42xx` — measured with
`grep -roh 'SMITHERS4[0-9]\{3\}' poc/src/durable/ | sort -u`. **The corpus
declares seven:** `SMITHERS4103`, `4106`, `4107`, `4110`, `4111`, `4112` and
`4124` — `4111`, `4112` and `4107` new on 2026-08-26, `4124` on 2026-08-27, and
**`4110` on 2026-08-27 in the durable-projection revision**, which is the one
that moved the "rules both implementations have and no case probes" subtraction
for the first time. (`SMITHERS4100` also appears
under `conformance/corpus/17-durable/`, but only inside a `notes` field recording
behaviour that was *retired*; it is not a declared diagnostic and nothing asserts
it.)

**The fourteen cases added on 2026-08-26 are one deliberate set** and they exist
because of a defect found *outside* the corpus: a durable lowering that
discovered its graph by evaluating the source function against a proxy
constant-folded branches out of a Plan, and **26 of 59 measured forms recorded a
Plan that was not the program written** — one of which reached a
signature-verified artifact. That defect was in the *runtime authoring* entry
point (`poc/src/durable/authoring.ts`), not in the `.sm` path, and the `.sm` path
was measured failing closed on every one of those forms both before and after the
fix. **So these cases do not reproduce a live defect and none of them was
demonstrated failing pre-fix; they pin CURRENT behaviour on the normative path,**
and that is precisely their value: the normative path had one declared refusal
rule (`4106`, on one form) standing between it and the same class of silent
folding, and nothing at all would have observed a regression into it. Twelve are
refusals, one is the paired positive control
(`17/a-plain-projection-reaches-the-plan-as-an-input-expression`, which opens the
Plan's own value expression and asserts the projection arrived as an `input` node
rather than a folded `literal` — the only case in the corpus that reads a
`ValueExpr`), and one is the failure-identity case at 20.12b. Six of the twelve
declare a `messageContains` naming the SyntaxKind the program actually wrote,
because at the shared authored column three expressions start at once and code
plus position alone are satisfied by a backend that refused the identifier and
never looked at the operator; see observation gap #5.

**And the fork's side of this area was mis-measured until this revision.** This
page's fork code-set command reads literal `SMITHERS[0-9]{4}` strings, and
`compiler/forkbridge/durable.go.txt` builds every one of its durable codes by
concatenating a prefix constant with a digit suffix (`durableCode("4103")`,
`d.fail(node, "4104", …)`, `suffix: "4117"`). The fork implements **22** durable
codes — `4100`, `4103`–`4113`, `4115`–`4123`, `4199` — and this page counted
**three**, all three only because they happen to be spelled out in
`compiler/fork_durable_test.go`. So nineteen rules the two implementations
**share** were being reported as reference-only, and the largest single block in
"rules both implementations have and no case probes" was invisible. What is
genuinely reference-only in this family is `SMITHERS4101`, `4102`, `4114` and the
four `SMITHERS420x`. Two of the shared codes, `4100` and `4117`, turn out to mean
**different rules** in the two implementations; both are tabled in that section
rather than written as cases.

Five cases against forty sentences is not a lane that is nearly done. It is a
lane that has barely started, and the previous revision's phrasing concealed
that. The two cases added since are an A/B pair about the module SPECIFIER
rather than about durable semantics, so they raise the count without moving the
sentence coverage much:
**`17/the-retired-vibelang-flows-specifier-is-not-compiler-owned`** and
**`17/a-single-action-flow-lowers-to-a-static-plan`**.

| # | normative sentence (durable-execution.mdx) | status | reason / cases |
| --- | --- | --- | --- |
| 20.1 | durable execution MUST be opt-in; ordinary functions MUST remain ordinary and eager and MUST NOT be scheduled unless selected through an Action or Flow boundary (`:7`) | covered | `17/unrelated-local-durable-stays-ordinary` pins the negative; §2.15's structural argument covers the eager half |
| 20.2 | a Flow MUST be declared with ordinary TypeScript call syntax from `smithers:flows` (`:11-24`) | covered | the positive cases import from `smithers:flows` and call it, and **`17/a-single-action-flow-lowers-to-a-static-plan`** is the minimal one. |
| 20.2b | **`smithers:flows` is the ONLY compiler-owned durable specifier: any other spelling is an ordinary module** | DECISIONS Locked ("`smithers:flows` is a compiler-owned virtual module"); durable-execution.mdx:24 | **covered** | **`17/the-retired-vibelang-flows-specifier-is-not-compiler-owned`** — `SMITHERS1510` at the specifier, on both backends. The retired language name `vibelang:flows` was carried in the Go bridge's `compilerModuleSpecifiers` AND its `durableModuleSpecifiers`, so that exact program compiled there, contributed no requirement, did not block a native pin, and lowered a real digest-pinned Plan — a language name that no longer exists behaving as the intrinsic, while the reference had always treated it as foreign. Paired as a deliberate A/B with 20.2's minimal positive: the two cases differ in the specifier and in nothing else that matters, because removing a retired spelling from a compiler-owned table is exactly the edit that can take the real one with it. |
| 20.3 | the compiler MUST recognize the **resolved binding**; an aliased import preserves durable behavior (`:24`) | covered | both positive cases import `{ durable as compileFlow }` — the alias direction is pinned here, unlike comptime's negative-only asymmetry that an external triage attributed to this area |
| 20.4 | an unrelated function named `durable` remains ordinary (`:24`) | covered | `17/unrelated-local-durable-stays-ordinary` |
| 20.5 | the argument MUST be an inline function or a statically resolvable function; an opaque runtime-selected function MUST be a compile error (`:26`) | **covered** | **`17/an-opaque-durable-argument-is-rejected`** — `SMITHERS4103` at the argument, green on both. `durable(pick())` chooses the function at run time, which is the one moment a template compiler is not present for, so there is nothing to lower and nothing to digest; accepting it would force the runtime callback wrapper the Locked descriptor rule replaces. This row was named as "directly parallel to `21-native-pin`'s `SMITHERS3005` gap", and both gates were closed in the same revision. **The corpus now declares two durable diagnostics rather than one.** The sibling branch of the same code — a `durable(...)` given the wrong number of arguments, reported at the CALL rather than at the argument — is still unwritten. |
| 20.6 | the compiler MUST replace a recognized `durable(...)` with a **serializable Flow descriptor** referencing emitted Plan IR, and MUST NOT emit a runtime callback wrapper (`:28`) | covered | `17/static-plan-shape-is-digest-pinned` reads `Build.plan` and `Build.artifactSource` from the descriptor, so a runtime wrapper would not have produced them |
| 20.7 | uncompiled JavaScript execution MUST fail during `smithers:flows` virtual-module loading (`:28`) | **uncovered** | 19.9's reason exactly: the harness compiles every case, so the uncompiled path is unreachable from the corpus |
| 20.8 | an Action implementation MUST be an ordinary Smithers function or callback and MUST NOT require an Effect wrapper or failure annotation (`:39`) | **uncovered** | no case supplies an Action *implementation* at all. Both positive cases declare abstract Actions and never implement one. |
| 20.9 | an **abstract** Action signature MUST state an explicit `Result<A, E>` or `Promise<Result<A, E>>` return type (`:41`) | **uncovered** | `17/static-plan-shape-is-digest-pinned` declares two Actions that *do* spell `Result`, so the honoured direction is incidentally exercised — but no case omits it and asserts the rejection, which is where the obligation lives |
| 20.10 | capabilities used by an implementation MUST enter the Action's inferred requirement row and MUST NOT become explicit inputs or context parameters (`:43`) | **partial** | `17/static-plan-shape-is-digest-pinned` prints `plan.requirements`, so the row is observable. But with no Action implementation in the corpus, nothing exercises inference *from* an implementation, and nothing pins the MUST NOT half. |
| 20.11 | source authors MUST NOT repeat Action types as separate schema arguments (`:45`) | **uncovered** | no case attempts the forbidden spelling |
| 20.12 | every value crossing an Action or Flow persistence boundary MUST satisfy the compiler-checked durable codec contract (`:49`) | **partial as of 2026-08-27** — was **uncovered**, "no case crosses a persistence boundary" | Four cases now pin the **projection** half of the contract: a value crossing the boundary along a path the durable descriptor cannot answer is refused, at `SMITHERS4110` on both backends with byte-identical sentences. **`17/an-action-input-projection-the-descriptor-does-not-have-is-rejected`** puts the bad projection in an Action's **input** — the Flow's output is a bare node reference the descriptor answers perfectly, so an output-only check cannot see it — and **`17/a-sleep-duration-projection-the-descriptor-does-not-have-is-rejected`** puts it in a timer duration, which is what pins that the diagnostic names the **subject** of the value it is refusing rather than a hard-coded one; **`17/an-action-input-projection-through-a-durable-string-is-rejected`** pins the second of the three `from durable <kind>` spellings. **`17/an-action-input-projection-the-descriptor-can-answer-is-accepted`** is the paired `expect: "output"` control and is the refusal with the projection swapped and nothing else touched. All four came from three implementation lanes that closed the same fail-open on the reference, then the fork, then the Action input on both: before them **both** implementations compiled these programs and ran them, emitting a Plan that carried `{"kind":"input","path":["items","length"]}` into the executor's `pathValue` and faulted there as a `ProjectionDefect`. Still **partial**, not covered: the ephemeral-value half of the boundary contract is 20.13 and remains uncovered, and nothing in the corpus round-trips a value through persistence — the refusals are compile-time, which is where this sentence's checkable half lives. |
| 20.13 | functions, capabilities, process handles, and other ephemeral values MUST be rejected without an explicit durable representation (`:51`) | **uncovered** | the central fail-closed rule of the durable boundary, and no case probes it. Fail-open direction: an unrejected ephemeral value is a Flow that replays wrong. |
| 20.14 | `any` and `unknown` MUST require an explicit codec at the boundary (`:53`) | **uncovered** | no case |
| 20.15 | the compiler MUST lower checked syntax, control flow, and data flow into Plan IR, and MUST NOT invoke the source function with proxy or symbolic values to discover the graph (`:59`) | **covered as of 2026-08-26 — and the MUST NOT half is now directly observed rather than inferred** | `17/static-plan-shape-is-digest-pinned` pins that the Plan exists with the right node kinds and edges. The **MUST NOT proxy-execute** half used to be inferable only from the statement-branch rejection; **`17/a-plain-projection-reaches-the-plan-as-an-input-expression`** now reads the action node's own `input` value expression and asserts the projection arrived as `{kind:"input", path:["mode"]}`. A lowering that discovered the graph by evaluating the source against a stand-in object emits a `literal` there, so that one stdout line is the difference between the two techniques, observed rather than argued. Mutating that line to `literal` turns the case red on both backends; verified and restored byte-identically. |
| 20.16 | an `Action.run` expression MUST emit a plan node and a typed symbolic Result (`:61`) | covered | same case: `plan.nodes.map(node => node.kind)` is asserted exactly |
| 20.17 | postfix `!` on it MUST emit the Result error-propagation **edge** (`:61`) | covered | same case asserts `plan.nodes[1].controlDependencies[0] === plan.nodes[0].id` |
| 20.18 | neither template compilation nor planning MUST execute the Action implementation (`:61`) | **uncovered** | with no implementation anywhere in the corpus, there is nothing whose non-execution could be observed |
| 20.19 | property access and argument passing on a symbolic result MUST create typed projections and dependency edges when representable (`:63`) | **covered as of 2026-08-26** | `17/static-plan-shape-is-digest-pinned` reads `found.value` off a symbolic result and asserts the resulting edges; **`17/a-plain-projection-reaches-the-plan-as-an-input-expression`** asserts the projection itself — that a `.` access became an `input` expression *carrying its path* — which is the sentence's own words. The qualifier "when representable in Plan IR" is what **`17/an-optional-projection-on-a-durable-input-is-rejected`** pins from the other side: `?.` is a branch wearing the syntax of a projection, so it is refused (`SMITHERS4106@11:25`) rather than waved through beside the plain form. The two are an A/B on one sentence. |
| 20.20 | the durable source function MUST be **removable** after the compiler emits its plan; a planner or coordinator MUST NOT require the source function or a live side table (`:65`) | **partial** | `Build.artifactSource` is asserted, which shows the artifact is self-describing. Nothing removes the source and re-plans, which is what the sentence actually requires. |
| 20.21 | a durable source function MAY capture compiler-known immutable values **only**, and MUST NOT observe runtime clock, randomness, environment, mutable state, services, or I/O while the template is constructed (`:69`) | **uncovered** | six named sources, zero cases. §19.16 has the same shape and at least has two. |
| 20.22 | runtime-dependent control flow MUST be represented explicitly in Plan IR; the compiler MUST reject an operation that would inspect a symbolic value without a corresponding IR representation (`:71`) | **covered across thirteen forms as of 2026-08-26** — it was one | `17/statement-branch-fails-closed` was the corpus's only declared durable diagnostic. Twelve refusal cases now stand beside it, chosen so no two share a walk branch: **operators** — `a-logical-or-fallback…`, `a-nullish-coalescing-fallback…`, `strict-equality-against…`, `an-in-test-on…` (`SMITHERS4111`, the binary family, and `in` is deliberately the one whose *symbolic operand is on the right*), `typeof-on…` (TypeOfExpression) and `logical-negation-of…` (PrefixUnaryExpression, the unary shape a binary-only walk would miss); **calls** — `array-isarray-on…` and `object-is-on…` (`SMITHERS4112`, on two different host namespaces so the rule is a property of the call rather than of one global); **control flow** — `a-conditional-expression-on-a-non-boolean-durable-input-is-rejected` (`SMITHERS4106`; read against `static-plan-shape-is-digest-pinned`, which lowers a *boolean* conditional into a real `branch` node, so the promise is the narrow one), `a-statement-branch-holding-an-action-in-each-arm-is-rejected` (`SMITHERS4106`, the expensive member: each arm calls a different Action, so folding the condition drops an Action out of the Plan and out of every digest computed over it), `a-do-while-loop-in-durable-source-is-rejected` (`SMITHERS4107`, its own rule because the repair is a parameterized template rather than branch lowering, and `do`/`while` is the form whose body runs before its condition is read), and `an-optional-projection-on-a-durable-input-is-rejected` (`SMITHERS4106`). All twelve are green on both backends at identical codes and authored positions. |
| 20.12b | **an Action's failure channel mints one durable identity per Error class** — failures.mdx:33 "The compiler MUST provide stable nominal identity…" and :209 "Handler selection MUST use compiler-stable nominal identity, not a forgeable user `_tag` or minifier-sensitive constructor name in compiled artifacts", read on the durable persistence boundary of 20.12 | **fully covered as of 2026-08-27** (was "half covered; the other half is inexpressible — observation gap #15", which closed) | **`17/an-actions-failure-channel-mints-one-identity-per-error-class`** opens `plan.actions[0].errorSchema.descriptor` and asserts one variant per declared Error class, one *distinct* identity per variant, and an identity derived from the declaring module and the class's own name. Stability is worth nothing without injectivity: two Error classes arriving under one identity is exactly a forgeable key. It deliberately does **not** declare the identity's spelling — see the case's own notes and gap #15. ~~**The other half — a COLLISION, two classes normalizing to one identity — is now declared too**, by `17/two-error-classes-whose-durable-identities-collide-are-rejected` and its paired control, `SMITHERS4124@20:10` on **both** backends with byte-identical messages (measured 2026-08-27, `--filter durable-identities`).~~ **Stale as of 2026-08-28: there is no longer a collision to declare.** The durable failure identity became injective (reversible `+XXXX` escaping of both components, `@` withheld as the separator), so that program compiles and the case turned over into `17/two-error-classes-whose-durable-identities-used-to-collide-now-compile`, which pins the two identities' literal spelling instead — the thing this row and gap #15 both said could not be pinned. The remaining collision family (two declarations sharing module and class name) is refused at different codes on the two backends and is covered off-corpus; see gap #15's closure note. **`js pass / go pass` as of 2026-08-28.** It scored `js pass / go unsupported` until then, and the reason was the fork's error-schema stub: the descriptor it type-checks this program against was `{digest, format, role, schemaVersion, shape, source}` with no `descriptor` field, so `errorSchema.descriptor` reported `TS2339` on an authored `.sm` file. The fork now derives the error schema from the declared failure channel, and the two backends were measured byte-identical on this program's whole Plan — both failure identities, both `errorSchema` digests, the `contractDigest` and `plan.digest`. This obligation is now differenced on both backends rather than pinned on the reference alone; the corpus's only remaining `unsupported` count for the Go fork is **0**. |
| 20.23 | a durable implementation MUST distinguish four compilation phases: template compilation, deployment build, plan/preview, execution (`:75-80`) | **uncovered** | the corpus reaches phase 1 only. Phases 2–4 have no channel through this harness at all: the runner compiles and runs one program and observes stdout. |
| 20.24 | plan/preview MUST NOT load or invoke the `durable(...)` function, and MUST NOT load or invoke an Action implementation (`:82`) | **uncovered** | phase 3 is unreachable; see 20.23 |
| 20.25 | a branch or fan-out whose value is unknown to the planner MUST remain an explicit conditional or parameterized template in the reported plan (`:82`) | **uncovered** | `17/static-plan-shape-is-digest-pinned` uses `input.live ? … : …` in *expression* position and pins its edges, but never inspects the reported plan for a preserved conditional node |
| 20.26 | the deployment build MUST check the complete provider dependency closure for every worker artifact; provider layers MUST satisfy each Action's context requirements before deployment (`:84`) | **uncovered** | phase 2 is unreachable; see 20.23 |
| 20.27 | Action ordering MUST be determined by data and control edges, not source position alone (`:88`) | **partial** | the digest case asserts a `sequential` Action edge, which is ordering *with* an explicit construct. Ordering derived purely from a data edge, and independent Actions being free to run concurrently, are unpinned. |
| 20.28 | programs requiring order without a data dependency MUST use an explicit sequencing construct (`:90`) | **partial**, and the construct's syntax is **open** (`:90`) | the case uses `sequential(...)`, which is the provisional spelling; the sentence's normative half is that *something* explicit is required, and no case shows the un-sequenced program being rejected |
| 20.29 | timers and external-signal waits MUST suspend **without occupying a worker lease** (`:94`) | **uncovered** | a runtime property; no execution phase in the corpus |
| 20.30 | an external-signal Plan node MUST own a statically bound identity and a compiler-derived durable payload schema; a delivery client MUST NOT supply or widen it (`:96-98`) | **uncovered** | the digest case calls `waitSignal<string>("build.approval")` and asserts only the node kind, not the bound identity or the derived schema |
| 20.31 | delivery MUST address an exact execution and Plan node, carry an explicit idempotency key, validate a canonical payload before persistence, and commit delivery evidence atomically (`:98-101`) | **uncovered** | runtime; `poc/src/durable/signal-transport.test.ts` and siblings are where this lives |
| 20.32 | retrying the same key and payload MUST be idempotent; a conflicting key or payload for a single-delivery wait MUST fail closed (`:100-102`) | **uncovered** | runtime |
| 20.33 | consumption and the node's terminal result MUST be one durable state transition (`:102`) | **uncovered** | runtime |
| 20.34 | every completed Action invocation MUST be journaled, including Error Results and nondeterministic successes (`:111`) | **uncovered** | runtime |
| 20.35 | after restart, the same Flow execution MUST observe the committed outcome instead of repeating the invocation (`:113`) | **uncovered** | runtime. `poc/src/durable/crash-matrix.test.ts` and `process-crash.test.ts` exist; no corpus case can restart a program. |
| 20.36 | recovery safety and cross-execution reuse MUST be independent policy dimensions; the runtime MUST NOT retry an ambiguously committed irreversible Action automatically (`:119-121`) | **uncovered** | runtime |
| 20.37 | cross-execution reuse MUST distinguish memoization from content caching; a memoized result MUST NOT be promoted automatically to a content-cache entry (`:127-132`) | **uncovered** | runtime |
| 20.38 | a deployment build MUST be capable of emitting a coordinator plus separate tree-shaken TypeScript, native, or Wasm worker artifacts and a routing manifest (`:138`) | **uncovered**, and partly **unimplementable** | the *native* worker artifact depends on the LLVM backend of 10.13, which does not exist |
| 20.39 | the canonical Plan and routing manifest MUST be authenticated before workers are created; trust roots MUST be supplied out of band; an artifact MUST NOT introduce its own signing authority; the manifest MUST pin coordinator, worker, implementation, policy, schema, and capability-grant identities (`:140-144`) | **uncovered** | `poc/src/durable/signed-deployment.ts` implements it and `signed-deployment.test.ts` measures it; no corpus case reaches deployment |
| 20.40 | coordinator admission MUST NOT silently substitute a weaker transport or sandbox; a non-local pool's transport MUST be bound to the exact authenticated sandbox identity (`:146-149`); workers MUST receive only their declared provider authority; cross-boundary messages MUST be validated against derived codecs (`:155`); a valid signature MUST NOT be treated as proof of possession, closure identity, sandbox state, freshness, rollback prevention, or revocation (`:159-162`) | **uncovered** | the security section in full. Real implementations exist under `poc/src/durable/`; the matrix has never scored any of it, and no gate outside that directory's own tests measures it. |

**Honest shape of §20, re-derived 2026-08-27.** Of the forty sentences plus
20.2b and 20.12b: **13 covered or partial**, all of them inside template
compilation (phase 1); **29 uncovered**. The durable-projection revision moved
exactly one row, 20.12 from *uncovered* to *partial*, and moved no phase-2/3/4
row, which is the same limit every revision of this section has run into.
**Re-derived 2026-08-26:** three rows moved that revision —
20.15 and 20.19 from *partial* to *covered*, 20.22 from one form to thirteen —
and one row (20.12b) is new. **None of that is a phase-2/3/4 change**, and the
paragraph below is unchanged for exactly that reason: fourteen new cases bought
depth inside the one phase this harness can reach and bought nothing outside it.
Twenty-two of the
thirty are uncovered for one structural reason — the corpus compiles and runs
a single `.sm` program in one process and observes its stdout, so **three of the
four compilation phases the specification requires have no channel through this
harness at all**. That is not a lane's backlog; it is a statement that durable
execution is measured by `poc/src/durable/*.test.ts` and essentially not by the
conformance corpus. Saying so is more useful than a promise that another lane
will get to it.

The seven that are *not* structural — 20.8/20.9 (Action implementations and
abstract signatures), 20.11, 20.13, 20.14 (durable boundary rejections), 20.21
(flow purity), 20.25 (unknown branch preserved) — are all reachable from template
compilation today, and each is a **fail-closed** rule. 20.5 was the eighth and is
covered; 20.15/20.19/20.22 were the ninth through eleventh and closed on
2026-08-26, and 20.12's projection half was the twelfth on 2026-08-27. Those
seven remaining are where corpus work in this area would buy the most, and they
are the same surface as the shared-but-unprobed durable codes in "rules both
implementations have and no case probes" — **sixteen of them** under that
section's corrected extraction (`4100`, `4104`, `4105`, `4108`, `4109`, `4113`,
`4115`–`4123`, `4199`), thirteen if the `suffix:`-built codes the recorded
command cannot see are left out. One case per fail-closed rule would move both
counts at once. **Two revisions are now the worked demonstration that this is
true rather than aspirational.** On 2026-08-26 twelve refusal cases were written
straight from durable-execution.mdx:59/:63/:71, every one green on both backends
the first time it ran, and three codes left the shared-but-unprobed set. On
2026-08-27 four more cases were written against `:49`, and **`SMITHERS4110`
became the first code ever to leave that set for a rule the corpus previously
could not reach at all** — the fifth axis, SURFACES, closing rather than
recurring.

**20.21 (flow purity) is the nearest neighbour of what just landed and is
deliberately still uncovered, so the boundary is worth stating.** The twelve new
cases cover the second sentence of §Flow Purity — inspecting a *symbolic* value.
The first sentence is different: it forbids a durable source function from
observing the *ambient* clock, randomness, environment, mutable state, services,
or I/O. Nothing in the corpus reaches it, and the sibling obligation in §19
(comptime determinism) is reachable and covered — `16/the-wall-clock-is-unreachable-from-comptime`
and `16/randomness-is-unreachable-from-inside-a-comptime-loop` — so the shape of the
case is already known. Six named sources, zero cases; that is the next
highest-value durable work.

## 21. The CLI, formatter, and language server — no corpus area, and that is fine

**Before this revision the string "cli" appeared zero times on this page**
(`grep -oi cli conformance/COVERAGE.md | wc -l` → 0), while
`docs/src/pages/reference/cli.mdx` is 335 lines of behavioural contract. A
reviewer told "this is the audit that lets someone judge whether feature complete
is true" was reading a document that never mentioned the program users actually
run.

**Say the fair thing first: the CLI is not untested.** It is one of the better
tested surfaces in the repository.

| test file | size |
| --- | --- |
| `test/cli.test.mjs` | 1,578 lines |
| `test/lsp.test.mjs` | 354 lines |
| `test/format.test.mjs` | 258 lines |
| `test/cli-go-backend.test.mjs` | 201 lines |

Those cover `format --check` exiting nonzero, `--check`/`--stdout` mutual
exclusion, `.sm`+`.ts` mixing rejected, colliding outputs rejected, bounded
UTF-8 reads, `--backend go` failing closed with its exact remedy command, and
the `--timeoutMs` bound (`test/cli.test.mjs:308-320` runs a hanging test with
`--timeoutMs 100` and asserts the report says `exceeded 100ms`).

**So the gap here is audit completeness, not test coverage**, and this section
exists to say that in the document rather than leave it implied. What follows is
the part nothing covers, measured rather than asserted.

| # | contract | evidence | what covers it |
| --- | --- | --- | --- |
| 21.1 | `--indentSize` accepts an integer from 1 through 8 (`cli.mdx:301`) | enforced at `src/cli.ts:1831` (`z.number().int().min(1).max(8)`) | **nothing.** `grep -rn indentSize test/` returns no hits. The bound is real and unexercised in both directions. |
| 21.2 | structured `SMITHERS_GO_*` backend-preparation envelopes, each obliged to print a specific remedy command, and each obliged to "never change backend" (`cli.mdx:97-108`) | **eight** distinct envelope names across seven table rows: `CHECKOUT_MISSING`, `CHECKOUT_REVISION`, `CHECKOUT_UNPATCHED`, `CHECKOUT_DIVERGENT`, `CHECKOUT_INVALID`, `BUILD`, `TIMEOUT`, `PROTOCOL` | **two of eight.** `grep -roh 'SMITHERS_GO_[A-Z_]*' test/ \| sort -u` → `SMITHERS_GO_CHECKOUT_MISSING`, `SMITHERS_GO_CHECKOUT_UNPATCHED`. The other six — including `TIMEOUT` and `PROTOCOL`, the two a user hits when the fork misbehaves — have no test. |
| 21.3 | resource ceilings: 2 MiB per source, 16 MiB across the discovered graph, 1,024 source files (`cli.mdx:199-200`) | `src/cli.ts:61-63` (`MAX_CLI_SOURCE_BYTES`, `MAX_TEST_PROJECT_BYTES`, `MAX_TEST_PROJECT_FILES`) | **one of three.** The 2 MiB per-source ceiling is exercised four times (`test/cli.test.mjs:404`, `:597`, `:696`, `:1200`, each writing 2 MiB + 1 byte). The 16 MiB graph ceiling and the 1,024-file ceiling have no test hit. Both are fail-closed limits; an unenforced one is an unbounded compile. |
| 21.4 | asset ceilings: 1,024 top-level assets, 2 MiB per top-level asset, 16 MiB across them (`cli.mdx:202-203`) | same file | **nothing** measures the asset-count or asset-total ceilings |
| 21.5 | `smithersc` and the `tsc` alias "forward arguments in their original order" (`cli.mdx:281-286`) | — | **forwarding** is covered (`test/cli.test.mjs:38-45`: `--version`, then `--noEmit <file>`). **Order preservation** is not asserted by any test: no test passes two order-sensitive flags and checks the order survives. |
| 21.6 | the LSP's bounded project closure, row hover, definition lookup, whole-document formatting (`specification/index.mdx:44-48`) | — | covered by `test/lsp.test.mjs`, and **not by this matrix**, which has no vocabulary for a JSON-RPC observation |
| 21.7 | **the lowering mode is explicit, and an omitted one is refused rather than defaulted** (`compiler/api.go:138-140`, "The zero value is invalid") | `compiler.LoweringIdentity` used to be the empty string — the zero value of `LoweringMode` — and `cmd/smithersc-go` built its positional request with no `Lowering` field, so every positional invocation silently selected identity lowering and applied **no Smithers rule at all** | **covered as of this revision, by a harness self-test rather than a case.** `conformance/runner/selftest.mjs`, run with `node --test conformance/runner/selftest.mjs` (6/6). Two halves: a source-level invariant that every `CompileRequest` in `backend-go.mjs` reads the one named `loweringMode` constant from `corpus.mjs` and that no mode is spelled as a string literal; and a live protocol assertion that sends the real bridge four real requests — omitted (refused, `lowering mode is required`), unknown (refused), `"internal"` (reports `SMITHERS1510`+`SMITHERS1301`), and `"identity"` (**exit 0, zero diagnostics on the same program**). The Go side has its own unit coverage at `compiler/lowered_test.go:159-162`; this is deliberately independent of it and goes over the wire. |

**Why the lowering-mode assertion is here and not in `conformance/corpus/`.**
The corpus can never reach it. `backend-go.mjs` sends a mode on every request it
builds, so no `.sm` program, however written, exercises the omitted-mode path; a
corpus case claiming to pin it would be asserting something about the runner
while pretending to assert something about the language, and would pass for a
reason unrelated to its own text. The thing that can regress is the harness's
own **request construction**, so the assertion lives next to it. It was verified
to catch that regression: restoring one `lowering: "internal"` literal in
`backend-go.mjs` turns the test red (`expected 3, actual 2`), and removing it
turns it green again.

**Why there is no corpus area for any of this, and why that is the right call.**
The conformance corpus is a *differential* instrument: it compiles one `.sm`
program through two backends and compares the observations. The CLI is neither
backend — it is the program that drives them, and the Go backend does not have a
CLI of its own to differ from. Building a corpus area here would produce
single-backend rows that measure the reference against itself. The honest
arrangement is the one the repository already has: `test/cli.test.mjs` owns the
CLI, and **this page names what that file does not reach** so nobody mistakes a
green corpus for a checked CLI.

## 22. `smithers:schema` — the third compiler-owned virtual module

DECISIONS locks, in the comptime section: *"Validators, codecs, schemas,
equality, hashing, and similar artifacts are derived at comptime from ordinary
types."* `type-system.mdx` §Reification restates it. **This page has never
mentioned it.** (`grep -n schema conformance/COVERAGE.md` before this revision
returned two hits, both the phrase "expectation schema".)

The implementation is real and the harness already knows about it:

| fact | evidence |
| --- | --- |
| it is a compiler-owned virtual module, third alongside `smithers:comptime` and `smithers:flows` | `poc/src/build/schema-derive.ts:18` — `SCHEMA_MODULE_SPECIFIER = "smithers:schema"` |
| the conformance runner **already special-cases the specifier** | `conformance/runner/js-lower.mjs:228` triggers the whole-project comptime frontend on `smithers:comptime` **or** `smithers:schema` |
| uncompiled execution fails at load rather than falling back | `poc/src/build/schema-derive.ts:29-30` emits a stub whose top-level `throw` rejects dependency evaluation before an importing module runs — the 19.9 mechanism, verified present here |
| reification **diagnoses rather than silently widening** | `schema-derive.ts:84-85` throws `SchemaDerivationError("unsupported", …)`, reached from `:127` (`any`), `:128` (`unknown`), `:132` (a free type parameter), `:134` (an enum), `:150` (an intersection), `:172` (a recursive type), `:178`, `:191` |
| the failure is surfaced, not swallowed | `poc/src/build/comptime-intrinsic.ts:515` re-throws anything that is not a `SchemaDerivationError` |
| its only measurement | `test/comptime-schema.test.mjs`, 140 lines |

| # | obligation | status | reason |
| --- | --- | --- | --- |
| 22.1 | validators/codecs/schemas are derived at comptime from ordinary types | **uncovered** | `grep -rn 'smithers:schema' conformance/corpus/` returns nothing. Zero cases in 211. |
| 22.2 | the reification rejection set diagnoses rather than silently widening | **uncovered** | this is the fail-open direction and the one that matters: a silently widened `any` produces a validator that accepts anything, which is worse than no validator. Nothing in the corpus reaches it. |
| 22.3 | a derived schema and the native pin | **uncovered**, and it interacts with xfail Finding 1 | Re-measured, and **not** what a first reading suggests. `poc/src/targets/classify.test.ts:952-956` asserts that a function importing `Schema` from `smithers:schema` carries `requirements: ["TypeScript"]`; only the **lowered** form importing `smthrs/schema-runtime` is requirement-free (`:957-961`). The test's own comment at `:950-951` calls `TypeScript` "the conservative answer" and says widening the registry to absorb it "would be an under-report in the direction a pin must never fail". So this is deliberate — but the consequence is the same one xfail Finding 1 reports for assets: **a function that derives a schema cannot be certified native-portable in authored source.** Two compile-time-only facilities now sit in the runtime requirement row for the same structural reason. Nothing in the corpus observes either, and this page had named only one of them. |

**Expected shape of a case here:** `unsupported go`.
`docs/TYPESCRIPT_FORK.md:148-150` records that "Schema reification, loader
registration, and the persistent content-addressed comptime cache remain on the
TypeScript-instrument side", so the fork legitimately has no rule. That is the
honest kind of `unsupported` — the fork reports no rule of its own rather than a
wrong one — and it is worth recording as a row rather than leaving the surface
unnamed.

`type-system.mdx:105-109` §Reification is also where obligation 19.14 (no
separate `runtime type` declaration modifier) is stated a second time. It has no
case in either place.

---

## Known observation gaps in the harness itself

These are not corpus gaps; they bound what any case could see. Each says what
the harness would need.

1. **Requirement and failure *row text* is not observed.** The harness observes
   stdout and diagnostics. `conformance/runner/js-lower.mjs` already carries
   `rows: file.analysis.rows` back in its response, and the runner discards it;
   there is no `expect: "rows"` and no Go-side equivalent. Obligation 8.5
   (duplicate requirements collapse) is therefore pinned only through its
   observable consequence. **What it would need:** a third expectation kind
   backed by `emitProjectDeclarations` / `readDeclarationEffects`, plus a
   matching channel in the Go bridge. *Materially smaller than it was:* the
   native pin's `SMITHERS3001` names the blocking requirement and its dependency
   path, which is what let 10.1, 10.5, and 8.14 leave this bucket.
2. **There is no native/LLVM backend** (10.13). Nothing can execute native
   output. The pin is an assertion *about* native eligibility, so it did not
   need one. **The previous revision's version of this entry also said "or
   Wasm", and that was false.** A bounded portable Wasm backend exists —
   `poc/src/targets/portable-backend.ts`, 4,180 lines, 65 diagnostic codes,
   real `wat2wasm` compilation and real `WebAssembly.instantiate`. It is not an
   observation gap at all: the corpus *could* reach it and does not. It is
   uncovered, not unobservable, and it is now row **10.14** with its evidence.
   This is exactly the failure mode this page's own preamble warns about — a
   recorded reason quoted rather than re-tested — and it survived several
   revisions.
3. ~~**Assets cannot be staged**~~ — **closed.** `corpus.mjs` knows three file
   kinds now, and §17 is covered. Two narrower limits took its place, #7 and #8
   below; both are properties of the Go wire protocol rather than of the
   corpus. What is still missing on the reference side is a `loaders` channel,
   which is 17.4's registration half and is blocked on an Open decision anyway.
4. **Host capability differences are not modelled** (8.15). The JS reference
   executes under bun and the Go backend under node, and the async `Layer.provide`
   rule is host-conditional *by specification*. **What it would need:** a
   per-backend expectation, or a declared host-capability predicate so one case
   can state both conformant outcomes.
5. ~~**Diagnostic *message text* is not compared**~~ — **closed, narrowly and
   deliberately.** A declared diagnostic may now carry an optional
   `messageContains`: a substring the message must contain, checked only where a
   case declares it (`conformance/runner/corpus.mjs`, `judge.mjs`, documented in
   `README.md`). It exists for one shape of obligation — where the payload IS
   the promise rather than decoration — and the native pin's "SHOULD show the
   dependency path" is that shape: a pin refused with an **empty** route
   satisfies a code-and-position expectation exactly, which is a fail-open in
   the harness rather than in a backend. **Eighteen diagnostics in eighteen
   cases declare the field as of 2026-08-26** — it read ten on 2026-08-25, and
   the six added since are the `SMITHERS4111` cases in §20, each naming the
   SyntaxKind ITS OWN program wrote (`BinaryExpression` / `TypeOfExpression` /
   `PrefixUnaryExpression`) because at the shared authored column three
   expressions start at once (`input`, `input.mode`, and the operator expression
   over it), so code and position alone are satisfied by a backend that refused
   the identifier and never looked at the operator. The smallest fragment
   carrying that promise is the bare kind name, which is a substring of both
   backends' wording (the reference prints `unsupported durable expression
   BinaryExpression`, the fork `…KindBinaryExpression`) — measured on both, not
   assumed. All six were verified enforced by mutating each fragment to a
   different, plausible SyntaxKind, watching both backends print the message
   diff, and restoring all six files byte-identically (sha256 compared before
   and after). Recomputed by *parsing* the expectations rather
   than by grep — the word also appears in `notes` prose, so a grep over-counts —
   with the command in `README.md`. The twelve that once carried a composed
   dependency route were all in `21-native-pin` and went with it; what is left is
   six naming a **capability** (`05-context-rows`, `06-layers`), one naming the
   **trust marker an author must write** (`09/miscased-trust-markers-do-not-confer-module-trust`),
   two naming a **stock TypeScript receiver type**, and one naming a diagnostic's
   own subject. Every one of the four added on 2026-08-25 was verified enforced
   by mutating the fragment to a wrong-but-plausible value, watching both
   backends print the message diff, and restoring it — a case that declares a
   fragment nothing checks is worse than one that declares none. They are
   also what made the export-declaration retirement trustworthy — the fork had
   to reproduce each composed route before any marker could be scored `XPASS`,
   so "refuses the program" was not enough — and this revision they are what
   makes four new `xfail` markers precise rather than merely red.
   **What is deliberately still not compared:** message wording, anywhere it is
   not the promise, and backend *agreement*, which still diffs codes and
   positions only — the two implementations word the same rule differently on
   purpose, and making the oracle sensitive to that would manufacture
   divergences. **That is not a hypothetical: this revision measured one.**
   `SMITHERS1503` reads *"only as an expression statement or direct return"* on
   the reference and *"only as an expression statement or a direct return"* on
   the fork, one word apart, at the identical code and position. An early draft
   of `09/panic-outside-a-statement-or-return-is-rejected` declared a fragment
   spanning that word and the fork failed a case it agreed with completely. The
   rule the corpus follows as a result: **declare `messageContains` only where
   the payload is the promise, and never as a way of naming the rule.** Five
   cases added this revision therefore declare none.
   `poc/src/targets/classify.test.ts` keeps asserting the full path text as a
   unit test.
6. **Error transport: identity is now observed, encode/decode is not** (5.11,
   5.12). **Half of this closed on 2026-08-25, and the half that closed had been
   the more dangerous one**, because it was invisible rather than merely
   unwritten. The harness's failure line printed `error.constructor.name` —
   which `failures.mdx` §Error Prototype names as exactly the wrong key — so a
   backend with a full identity registry and a backend with none produced the
   same observation, and the Go fork's absence of three of §Error Classes' four
   obligations could not show up in either direction. `harnessText` now takes
   each backend's own identity accessor (`errorIdentity` from the POC runtime;
   `smithersErrorIdentity` from the emitted `__smithers_prelude.js`), read from
   the module instance the program registered into, and the failure line carries
   the compiler-stable identity. That is the same normalization the Result
   *representation* already gets — two spellings of one concept — and the
   identity **value** is not normalized, because it is the thing under test.
   `04/a-nominal-error-identity-names-its-declaring-module` declares one. The
   invariant that each backend must supply an accessor is in
   `runner/selftest.mjs`, not in a case: a backend that stopped supplying one
   would fall back for every case at once, and every case not declaring an
   identity would stay green.
   **What is still missing, and the reason is reach rather than process count:**
   `.sm` has no sanctioned path to `encodeError`/`decodeError` on *either*
   backend, and the two backends' transport surfaces are different modules at
   different paths — so no single `typescript:` support module reaches both, and
   staging one per backend would be two different projects, which is the one
   thing a differential harness must not do. A same-realm `encode(decode(x))`
   would prove only that a function round-trips its own object. **What it would
   need:** an `expect: "transport"` case shape — run the emitted program twice,
   in two processes, passing one wire string as `argv[2]` — roughly forty lines
   in the runner. Covered meanwhile by `compiler/fork_error_transport_test.go`
   (two of seven tests run two `node` processes; two of those cross backends).
7. **A case cannot resolve a package** (11.10, 11.11). A case's files are
   staged into a `mkdtemp` tree (js) or sent in one request (go); neither has a
   `node_modules`, so a bare specifier that is not compiler-owned does not
   resolve. Measured, not assumed: `import { Stream } from "smthrs/concurrency"`
   through the JS backend gives `SMITHERS1510@1:24 — 'smthrs/concurrency' could
   not be resolved`. This is what actually blocks the concurrency library, and
   it is a stronger constraint than the flat-staging reason it replaces.
   **What it would need:** a resolvable package root staged into both backends
   — on the Go side a wire-protocol change, since its project has no filesystem.
   Vendoring the API into `conformance/support/` is not the fix: it would
   measure the copy.
8. **Nothing can be staged outside the project root** (17.10). The Go bridge's
   `virtualFileName` refuses any input path that escapes its virtual project, so
   a file above the root would exist for the reference and not for the fork —
   and staging two different projects is the one thing a differential harness
   must not do. A case about an escaping *specifier* is writable; a case about a
   file that exists outside the root is not.
9. **A staged asset is UTF-8 text.** `conformance/assets/` files are read and
   written as UTF-8, so a byte-exact staged asset has to be ASCII —
   `23/a-bytes-import-exposes-the-file-as-a-typed-byte-array` uses a
   nine-byte ASCII file. A real binary asset (an actual PNG) cannot be staged.
   **What it would need:** a base64 channel through both backends. Ranked
   lowest here: the `bytes` loader's contract is the same for any input, and
   the case already pins it.
10. **The Go wire protocol has two file kinds, not three.** `FileKindAsset` is
   declared in `compiler/api.go`, but the bridge's own switch accepts only
   `"smithers"` and `"typescript"` and errors on anything else — and an errored
   request is scored `unmeasured`, which is not a measurement. So an asset
   crosses to the fork under the kind the bridge uses for "not `.sm`", at the
   same path and with the same bytes, and out of `rootNames`. It changes nothing
   about what is measured today (the fork has no source-asset stage either way)
   but it is a mislabel the protocol forces, and it is where a fork implementer
   adding loaders will start.

11. **The harness cannot observe warnings at all.** This is the load-bearing one
   and it was previously mentioned only in passing inside row 10.11. Both
   backends filter the diagnostic stream to errors before the runner ever sees
   it: `conformance/runner/backend-js.mjs:132` keeps only
   `item.severity === "error"`, and `conformance/runner/backend-go.mjs:105`,
   `:185`, and `:242` each keep only `item.category === "error"`. A warning is
   therefore not "hard to assert" — it is **invisible**, and a case declaring
   one would observe an empty diagnostic list. **What this costs:** the two
   sentinels that keep an Open classification from silently becoming a fail-open
   are unmeasurable by construction — `SMITHERS3002` ("portability is not
   classified yet", `poc/src/targets/classify.ts:342`, severity `"warning"`) and
   `SMITHERS3004` ("type assertion portability is undecided",
   `poc/src/targets/classify.ts:297`, severity `"warning"`). Rows 10.11 and
   10.12 say those decisions are Open, which is true; what they cannot say today
   is that the implementation still *flags* the undecided construct, which is
   the only thing a corpus can honestly claim while a decision stays open.
   **A third warning joined that list a revision ago**, found by the
   both-implementations subtraction: `SMITHERS3006`, the retired
   `/** @native */` JSDoc marker (`poc/src/targets/classify.ts:830` — the page
   said `:449` for three revisions and that line no longer holds the rule;
   severity `"warning"`). It is in *both* implementations and cannot be probed by
   any case, which makes it one of only three members of that set — with the two
   formatter codes — that are **uncoverable** rather than merely uncovered.
   **What it would need:** carry `severity` on each observed diagnostic and add
   an optional `severity` field to a declared diagnostic defaulting to
   `"error"`, so no existing case changes and a declared warning matches only a
   warning.

12. ~~**The corpus cannot observe the harness's own request shape**~~ —
   **closed, outside the corpus.** Every case travels through one
   `CompileRequest`, so a field that request always sets the same way is a field
   no case can vary, and a field it omits is a path no case can reach. That is
   not a gap a case can close, and pretending otherwise is how the Go CLI's
   default lowering mode survived at 211/211 — see §21.7 and "The fail-opens
   this corpus still cannot pin". `conformance/runner/selftest.mjs` now holds
   assertions of that shape (`node --test conformance/runner/selftest.mjs`,
   6/6). Today it holds one, `lowering`, and the file's header states the class
   so the next such field has an obvious home. **What is still open:** `options`
   has the same property. `comptimeTarget` is sent explicitly and pinned by a
   corpus case, but nothing asserts that no *other* compiler option is left to a
   bridge default the reference does not share — which is exactly what
   `comptimeTarget` was before it was found.

13. **Two prelude-constructor routes the corpus cannot express, because the two
   backends' Result constructors have different NAMES.** This is a structural
   blind spot in the case format, not an oversight, and it is recorded here
   rather than skipped because a gap the contract cannot express reopens
   silently — the same reasoning that put the identity accessor in
   `harness.mjs` rather than in a case (#6 above).

   `failures.mdx` §Compiler Lifting (Locked) says *"Authors MUST NOT need to
   write `Result.ok(...)` or `Result.err(...)`. Those constructors MUST NOT be
   part of the ordinary Smithers authoring API."* The sentence names **the
   constructors**, so the rule has to hold at the constructor and not only at
   the module edge. But the reference's constructors are `__vsResultSuccess` /
   `__vsResultFailure` / `RuntimeValues`, and the fork's are `SmithersOk` /
   `SmithersErr`. A `diagnostics` expectation declares one exact
   `code@line:column` set for both backends, and a case can only spell one of
   the two names — so whichever it spells, the *other* backend reports a stock
   `TS2305` for a member that genuinely does not exist in its runtime.

   Measured 2026-08-25 by staging each as a throwaway case, reading
   `run.mjs --backend both --json`, and deleting it again:

   | route | JS reference | Go fork | judged |
   | --- | --- | --- | --- |
   | `import { __vsResultSuccess } from "smthrs/context"` | `SMITHERS1201@1:10` | `TS2305@1:10` — *"has no exported member '__vsResultSuccess'"* | go `unsupported` |
   | `import { SmithersOk } from "smithers:exceptions"` | `TS2305@1:10` — *"has no exported member 'SmithersOk'"* | `SMITHERS1201@1:10` | js `fail` |

   A third route is **nearly** expressible and fails for a second, independent
   reason worth recording separately:
   `import { SmithersOk } from "./__smithers_prelude.ts"` draws
   `SMITHERS1510@1:28` on **both** backends, but the fork adds
   `SMITHERS1201@1:10` on top of it and the reference does not — so the
   diagnostic *sets* differ even where the module-edge diagnostic agrees
   exactly. A `diagnostics` case is exact in both directions, so an extra
   diagnostic on one backend cannot be declared away.

   **What the corpus holds instead.** The module-edge half of the same rule *is*
   pinned on both backends, deliberately written so it never names a
   constructor:
   `01-result-lifting/the-compiler-owned-prelude-is-not-reachable-by-a-path`
   (`SMITHERS1510@1:23`) imports the *sanctioned* binding `Panic` through the
   forbidden path, and
   `01-result-lifting/a-star-re-export-of-the-compiler-owned-prelude-is-refused`
   (`SMITHERS1510@1:15`) names no binding at all. Those two are green on both
   backends precisely *because* they avoid the constructor. What stays unpinned
   is the constructor rule reached through a **sanctioned** specifier — the
   sharper half, because there the specifier is legitimate and only the imported
   name is not.

   **What would have to change to close it**, three ways, none free:

   - **A per-backend binding name in the case format.** The most honest and the
     smallest: the harness *already* normalizes the two backends' Result
     **representations** and their **identity accessors** for exactly this
     reason — two implementations, two spellings of one concept, one declared
     expectation (`runner/harness.mjs`'s own docstring makes that argument). A
     constructor name is the same kind of difference. It costs a new expectation
     field and a substitution point in both backends, and it must be bounded to
     *naming*, never to semantics.
   - **A pair of cases, each `xfail`ed on the other backend.** Mechanically
     viable — `judge.mjs` consults the `xfail` marker *before* the
     `looksUnimplemented` branch, so the `TS2305` side would score `xfail` and
     not `unsupported`. But it is **semantically dishonest**, and that is the
     objection that should stop it: `xfail.reason` is documented as *"what the
     implementation actually does, and why that is wrong"*, and nothing here is
     wrong — both backends implement the rule. Two permanent markers recording a
     naming difference as a defect would also corrupt every count in the
     register below, which is read as a census of real disagreements.
   - **Leave it to the two backends' own suites**, where it is already pinned by
     name (`compiler/fork_error_brand_test.go`,
     `poc/src/language/compiler-result-constructors.test.ts`). This is the
     status quo and it is not nothing; what it costs is that the rule is no
     longer part of the **contract**, so the two implementations may drift on it
     without the differential oracle noticing, and a fork that quietly dropped
     `SMITHERS1201` at a sanctioned specifier would keep the corpus green.

   Ranked: the first is the right fix, the third is what is true today, and the
   second should be refused explicitly so a later lane does not reach for it as
   the cheap option.

14. **An `xfail` marker suspends the declared expectation on that backend, so
   the declaration itself goes unobserved there.** This is a property of what
   `xfail` *means* — "marked, and indeed did not match" — and it is written down
   because its consequence is the opposite of the one people expect from a
   marker, and because it is the same family as the fail-open `messageContains`
   exists to close (#5 above): a check that passes without observing anything.

   `judge.mjs` compares the observation to the expectation and then, if the
   backend is marked, converts *any* mismatch into `xfail` without regard to
   which mismatch it was. So a case marked `xfail(go)` has its declared codes
   and positions enforced by the **reference half only**, and a case marked on
   **both** backends has them enforced by nothing at all.

   **Measured 2026-08-26 rather than reasoned about,** on both shapes, with each
   expectation restored and sha256-compared byte-identical afterwards:

   | mutation | js | go | run |
   | --- | --- | --- | --- |
   | the three new `09` row-charge cases, declared `SMITHERS1506` column shifted by 1 (and by 10) | **FAIL**, message diff printed | `xfail` — unchanged | red |
   | `04/a-function-local-error-class-cannot-be-declared-twice` (the register's only **both-backends** marker), declared `stdout` replaced by a line the program never prints | `xfail` | `xfail` | **green, exit 0** |

   The second row is the finding. That case's `stdout` is not a claim any run
   checks; it is unverified text until the day the defect is fixed.

   **And that is the dangerous half, not the harmless one.** `xpass` is the
   documented retirement signal — a marked case that starts matching is reported
   so the marker is retired deliberately. But `xpass` fires on a match against
   the **declared** expectation, so a marker whose declaration is wrong can
   never fire it: the backend can be fully fixed and the case will keep scoring
   `xfail` forever, and the register will keep carrying a defect that no longer
   exists. A wrong expectation under a one-backend marker is caught by the other
   backend the moment it is written; under a both-backends marker nothing
   catches it, in either direction, ever.

   **What it would need:** nothing in the runner — the semantics are right. What
   it needs is a rule for authors, and it is now here: **a both-backends `xfail`
   must have its declared expectation verified out-of-band before it lands**
   (run the program, read what it prints, put that in `stdout`), and its
   `notes` must record that this was done. There is exactly one such marker
   today and its declaration was checked against a real run when it was written;
   this entry exists so the second one is not written without that step. A
   cheaper mechanical guard, if a third ever appears: assert in
   `runner/selftest.mjs` that at most one marker names both backends, so adding
   another is a deliberate act rather than a quiet one.

15. ~~**A durable failure-identity COLLISION cannot be expressed, because two
   sound implementations of the same obligation land in two different
   expectation kinds.**~~ **CLOSED 2026-08-27.** Recorded 2026-08-26; kept in
   full below because the reasoning is what the closure had to answer, and
   because a reader who finds the gap cited elsewhere needs to land somewhere
   that says why it no longer holds.

   **What closed it.** The gap rested on a measurement — *"the fork compiled
   this program clean and ran it"* — and on the reading that the only
   `diagnostics` form available was the reference's *remedy*. Both moved on
   2026-08-27. Both implementations now mint a code for the collision
   **itself** (`SMITHERS4124`, at the authored `run` call site), the fork's
   message is byte-identical to the reference's, and the corpus declares it:
   `17/two-error-classes-whose-durable-identities-used-to-collide-now-compile` plus its
<!-- renamed 2026-08-28: the case turned over from a refusal to an acceptance when the identity became injective; see observation gap #15's closure note. -->
   paired control `…-with-distinct-durable-identities-compile`. Re-measured for
   this entry with `node conformance/runner/run.mjs --backend both --filter
   durable-identities --json`:

   | case | JS reference | Go fork |
   | --- | --- | --- |
   | `…-whose-durable-identities-collide-are-rejected` | `SMITHERS4124@20:10` "Error classes `$Failed` and `_Failed` … share one durable failure identity …" | `SMITHERS4124@20:10`, same sentence |
   | `…-with-distinct-durable-identities-compile` | `kind: "output"`, stdout `["1"]` | `kind: "output"`, stdout `["1"]` |

   The alternation objection is answered rather than dodged: a code for the
   *collision* is not a code for the *remedy*. An implementation that took the
   other sound route — making the spelling injective, so `$Failed` and `_Failed`
   never share an identity — would have no collision to report and would fail
   this case. That is a real residual narrowing of the obligation, and the
   case's notes do **not** record it — they explain why the *message* is pinned
   now and was not before, which is a different question. Someone should add a
   sentence saying which remedy the case assumes; this entry is the record until
   they do. What the closure buys is that the fail-open the gap was recording
   (one backend accepting the program) can no longer reopen unobserved. The
   second corroborating row below is **still true** and was re-measured the same
   day, so the fork's identity *spelling* remains unobservable from `.sm`; only
   its refusal is.

   *The original entry, unchanged from 2026-08-26 except where marked:*

   This is the same family as #13 —
   a rule the contract cannot state — and it is written down for the same
   reason: a gap the corpus cannot express reopens silently.

   `failures.mdx:33` (Locked) requires *"stable nominal identity"* and `:209`
   requires handler selection to use *"compiler-stable nominal identity, not a
   forgeable user `_tag` or minifier-sensitive constructor name in compiled
   artifacts."* On the durable persistence boundary those two sentences mean
   the identity must be **injective**: two distinct Error classes arriving under
   one identity is a forgeable key by any other name. The reference's durable
   contract identity is `smithers:${file}#${name}@1` with every character
   outside `[A-Za-z0-9._/@:+-]` replaced by `_` — **including its own `#`
   separator** — so it is a function of (logical file, class name) that is not
   injective over class declarations. `$Failed` and `_Failed`, two different
   classes with two different payloads in one module, normalize to one identity.
   Measured (not reasoned about) as a bundle that compiled, built, ran, and
   returned two different payloads under one identity string.

   **Why no case.** The obligation is *"distinct classes get distinct
   identities"*. There are two sound ways to satisfy it and they produce
   observations of different kinds:

   - **refuse the program** — the reference's choice, a `diagnostics`
     observation;
   - **make the spelling injective** (use `:`, which survives normalization,
     instead of `#`) — an `output` observation, and explicitly the alternative
     the identity lane costed and declined, because it changes every persisted
     `errorSchema.digest` and `contractDigest` in existence.

   An expectation declares **one** kind, `output` or `diagnostics`. A case
   cannot say *"either refuse this or mint two identities"*, so whichever it
   declares, a conformant implementation of the other remedy fails it. Writing
   the `diagnostics` form would pin **the reference's remedy** rather than the
   language's promise, which is the one thing this corpus is not for.

   **Two corroborating measurements, both taken and then discarded with the
   throwaway case:**

   | probe | JS reference | Go fork |
   | --- | --- | --- |
   | `$Failed`/`_Failed` as the two arms of one Action failure channel | ~~`SMITHERS4112@20:10` — refused (the derivation is skipped, so the lowerer reports the ordinary unsupported-call diagnostic at the authored `run` call site)~~ **stale; `SMITHERS4124@20:10` since 2026-08-27, naming the collision, and the old sentence was false of the program — there is no higher-order or dynamic call in it** | ~~**compiled clean and ran** — observation `kind: "output"`, zero diagnostics~~ **stale; `SMITHERS4124@20:10` since 2026-08-27, byte-identical message** |
   | the same program printing `errorSchema.descriptor.variants[].identity` | prints them | `TS2339` — the fork's `smithers:flows` types a durable schema as `{digest, format, role, schemaVersion, shape, source}`, with no `descriptor`. **Re-measured 2026-08-27 through `--filter mints-one-identity`: still `TS2339@28:29` plus five `TS7006`, unchanged.** |

   The second row is why the first cannot even be adjudicated: the fork's
   identity spelling is **not observable from `.sm` at all**, so the corpus
   cannot ask whether its acceptance is sound or a fail-open. And a
   `diagnostics` case marked `xfail(go)` would put a marker holding a fail-open
   into a register that currently holds none, to record a remedy choice rather
   than a language rule — the same objection #13 raises against paired markers,
   for the same reason.

   **What the corpus holds instead.** The injective direction, on a program that
   compiles: `17/an-actions-failure-channel-mints-one-identity-per-error-class`
   (row 20.12b) asserts one variant per class, one distinct identity per
   variant, and an identity derived from module and class name. It deliberately
   does **not** declare the identity's literal spelling, because declaring
   `smithers:<module>_<Name>@1` would ratify the normalized-separator spelling
   as the contract and make the one-character repair a corpus break for a reason
   the specification does not state. *(Still accurate for that case, which was
   left as it stands. The repair happened on 2026-08-28 and the spelling is now
   pinned by `…-used-to-collide-now-compile` instead — see the closure note above.)*

   **What would have to change to close it:** the specification would have to
   say which remedy is required — that is the cheap and correct fix, and it is a
   sentence, not a harness change. Failing that, an expectation able to declare
   an alternation of kinds, which is a much larger change to the judge and would
   weaken every other case's exactness. The first is the right answer.

   *(End of the 2026-08-26 entry. The closure above took neither route: it minted
   a code for the collision rather than for a remedy. The specification sentence
   is still the right answer and is still unwritten — what changed is that the
   gap is no longer holding a fail-open while it waits.)*

   **CLOSED 2026-08-28 — the second remedy was taken after all.** The entry above
   costed "make the spelling injective" and declined it because it moves every
   persisted `errorSchema.digest` and `contractDigest` in existence. That
   migration has now been done, on both backends in one change. The identity is
   `smithers:<escaped file>@<escaped class>@1`: each component reversibly escaped
   (`+XXXX`, four upper-case hex units) and `@`, the separator, withheld from the
   escape alphabet so neither component can spell it, with the 256-unit bound
   honoured by digesting the exact spelling instead of cutting it. Nothing is
   folded, so it is injective over (logical file, class name) and `$Failed` /
   `_Failed` mint two identities.

   Three things follow, and each closes a paragraph above:

   - The **alternation of kinds** problem dissolves. There is no longer a choice
     of remedies to pin, because the program is not a collision: it is ordinary
     source that both backends compile. The case that held the refusal,
     `two-error-classes-whose-durable-identities-collide-are-rejected`, turned
     over into `…-used-to-collide-now-compile`, an `output` case on the same
     program.
   - The **spelling is now pinned**, which the paragraph above deliberately
     refused to do while the separator was still being destroyed. That reason is
     spent: the repair has happened, so ratifying the spelling no longer freezes
     a string that has to move. The new case prints both identities and both
     backends were measured minting the same bytes.
   - The second corroborating row is **no longer true**: the fork's identity
     spelling IS observable from `.sm` now — `errorSchema.descriptor.variants[]`
     reaches it on both backends, which is what the new case reads. The `TS2339`
     that made it unobservable was the fork's legacy stub error schema, gone
     since the fork began deriving the schema from the declared failure channel.

   What is NOT closed by this, and is now the only residual: the identity remains
   a function of (logical file, class name), so two DIFFERENT declarations sharing
   both — sibling namespaces, a namespaced class beside a top-level one of the
   same name — are indistinguishable under any injective encoding. That family
   still cannot be a case, but for the ordinary reason given for the same-NAME
   family rather than for a missing specification sentence: the fork refuses it
   module-wide as SMITHERS1150 (its RUNTIME identity is a function of the same
   pair) while the reference reports SMITHERS4124 alone, so a case would freeze
   two unrelated rules against each other. Both backends keep direct off-corpus
   coverage of that refusal.

   The cross-backend agreement that used to rest on two hand-maintained copies of
   one algorithm now rests on `conformance/identity/durable-failure-identity.json`
   — 28 shared vectors read by both backends' tests, the same mechanism
   `nominal-error-identity.json` provides for the runtime spelling. That file
   exists because a differential could never have found this: both backends
   spelled the identity the same wrong way, so every cross-backend comparison
   agreed byte-for-byte on the colliding answer and this corpus reported
   `0 divergent` on the very program that measured it.

16. **Comptime object key order is unsettled by the specification, and the
   corpus already ratifies BOTH halves of the contradiction in one file.**
   Recorded 2026-08-26. This one is not a missing case: it is a case that must
   not be written until a human picks a side, and the reason it is filed here is
   that the corpus is currently making the choice by accident.

   Measured: `comptime(v)` emits an object's own keys **sorted**, while
   `Object.keys`/`entries`/`values` evaluated *inside* comptime preserve
   **insertion order**. `specification/comptime.mdx:15` says only that the
   compiler *"MUST replace the call with the resulting value or generated
   artifact"* — it never names key order, canonicalization, or a canonical value
   form. §Determinism constrains *inputs*; §Incremental Identity is about cache
   keys, which is what `canonical`/`digest` are for and which must stay sorted
   either way. `compatibility.mdx:12` removes "JavaScript semantics by default"
   as a licensed inference.

   **The accident.** `16/comptime-value-is-evaluated-during-compilation` prints
   one `JSON.stringify` line at run time, and its declared `stdout` contains a
   top level that is sorted, a `nested` object that is sorted, **and** a
   `keys: Object.keys(source)` that is in insertion order. `judge.mjs` compares
   stdout literally, so both halves of the self-contradiction are enforced,
   byte-for-byte, by one line of one expectation — and a fork that disagreed
   with either would be caught. That is coverage of a rule nobody has written.

   **The four cases to write once it is settled**, all `expect: "output"`, all
   the existing `16-comptime` shape, no new diagnostic codes:

   1. `comptime-object-key-order-is-observable` — `comptime({b,a,c})` against the
      runtime literal `{b,a,c}`, one line each, so the two backends cannot agree
      by both being canonical.
   2. `comptime-object-keys-agrees-with-comptime-value-order` —
      `Object.keys(comptime({b,a}))` against `comptime(Object.keys({b,a}))`.
      **This is the case that makes the contradiction a corpus failure instead
      of a code comment: today the two lines disagree.**
   3. `comptime-json-stringify-key-order`.
   4. `comptime-json-parse-key-order`.

   **What it would need:** one sentence in `specification/comptime.mdx`. Under
   (a) *sorted is the language rule*, `Object.keys`/`entries`/`values` inside
   comptime must sort too, which changes the ratified `["name","major"]` in the
   file named above. Under (b) *the resulting value keeps its own order*, the
   exit `stableClone` must be replaced by an order-preserving validating clone
   and **two ratified corpus cases must be re-baselined**
   (`16/comptime-value-is-evaluated-during-compilation` and
   `16/comptime-function-is-interpreted-during-compilation:5`). Until then, any
   case written here ratifies a guess, so none is written. See also
   `17/a-plain-projection-reaches-the-plan-as-an-input-expression`, whose notes
   record that its first draft was rewritten rather than re-baselined precisely
   so it would not become a third, unannounced ratification of the same
   unsettled question.

17. **The comptime LOADER surface has no channel, so its extension and
   hermeticity rules are unreachable.** Recorded 2026-08-26; this sharpens the
   half-sentence left inside gap #3 ("what is still missing on the reference
   side is a `loaders` channel").

   A source loader is not something a `.sm` file *imports*; it is something a
   *project* registers, and the expectation format has no field for it. The
   `typescript` field stages modules a case imports and the `assets` field
   stages files a case imports — neither is a registration. So the whole
   `VCT13xx` family is out of reach, including the two rules a build lane
   measured and fixed on 2026-08-26: five advertised loader extensions
   (`.cts`, `.cjs`, `.tsx`, `.d.ts`, and case-varied `.TS`) that were admitted
   and then always failed at run time, and a spelling trigger that turned an
   ordinary project file into a `VCT1301`/`VCT1303` build error. Both now fail
   closed at recognition; neither is expressible here.

   **The hermeticity half is further out still and would not be closed by a
   `loaders` field.** The defect there was that `Date.parse` without an offset
   read the host time zone inside the loader sandbox and the build cache's
   `implementationDigest` could not see the difference, so two machines shared a
   cache key for two different outputs. A corpus case observes a *compilation's
   output*, never a cache identity — and the harness deliberately gives every
   case a fresh comptime cache inside its own `mkdtemp` tree so cases cannot
   share compiler state, which is the property that makes cache poisoning
   unobservable by construction. **Measured, in case a later lane reaches for
   the obvious case:** `comptime(Date.parse("…"))` is refused, but not for a
   time-zone reason — the comptime interpreter refuses the `Date` binding
   outright (`VCT1004`, *"identifier \"Date\" is not a single local const
   declaration\"*), exactly as it refuses `Date.now()` in
   `16/the-wall-clock-is-unreachable-from-comptime`. A case built on that would
   be a near-duplicate of an existing one wearing a rationale that is not the
   reason it passes. It was drafted, measured, and deleted rather than landed.

   **What it would need:** a `loaders` staging field in the expectation format
   *and* a fork-side comptime loader stage, for the extension half; nothing
   would close the cache-identity half, which belongs to
   `poc/src/build/build.test.ts` and does live there.

18. **Three of the six lanes reporting on 2026-08-26 had no compiler-observable
   surface at all, and saying so is the point of this entry.** The corpus is a
   *compiler* differential harness over authored `.sm` programs. Runtime,
   packaging, and store-transaction behaviour is not a thing it measures badly —
   it is a thing it does not measure. Recorded so the next pass does not
   re-derive it:

   - **The agent sandbox.** A runner pinned at its realpath and then spawned at
     the unresolved path; a teardown identity missing from a hand-listed set
     poisoning a durable call site permanently. Filesystem symlink races and
     subprocess spawn identity have no `.sm` spelling. Lives in
     `poc/examples/agent/agent.test.ts` and
     `poc/examples/agent/durable-turn.test.ts`, where that lane wrote 19
     regression tests.
   - **Packaging.** `bun:sqlite` reachable through a Node-loadable published
     subpath. This is a property of the *built tarball's* module graph, of which
     no corpus case is even a member. Lives in
     `poc/src/durable/runtime-boundary.test.ts` (an early static check on the
     import graph) and in `scripts/verify-pack.mjs`, which resolves all 42
     exports from a real installed tarball under both runtimes.
   - **Durable migration.** Two store mutators with no plan pin or fence, and an
     empty fan-out invisible to a migration's evidence set. These are SQL
     transaction predicates observed by crashing and resuming a coordinator;
     phase 4 has no channel through this harness (§20's closing paragraph).
     Lives in `poc/src/durable/migration.test.ts` and `crash-matrix.test.ts`.

   **What it would need:** nothing. This is the correct boundary, and the
   entry exists so that "the corpus has no case for it" is not read as "nothing
   pins it".

## `xfail` register

**Eleven markers, 2026-08-28 (third revision).** All eleven name `go`; one of
them also names `js`. Six were retired that day — the ambient-Error registration,
the labeled-statement lowering, the concise-arrow placement pair, the
Result-parameter ownership walk, and the foreign lift's bound/unbound split —
each by a shared seam rather than a site fix, and each measured to close
unregistered siblings besides the case that named it; see conformance/README.md,
"Current `xfail`s", for the per-case account. Three further rows this table had
carried were removed as already-retired. **None is a fail-open** — and read that
beside the fact that the previous revision of this line said "One IS a
fail-open", and the revision before *that* said "none is", and all three were
correct when written. The fail-open
(`09/a-foreign-index-signature-read-through-a-property-access-needs-an-adapter`) was closed
inside the same day it was filed; its marker survives, in the **fail-closed**
direction, because the fork now refuses the program at the reference's position
and only the row charge is missing. **The value of this sentence has a shelf life
measured in hours and the reasoning behind it does not: a marker can hold a
fail-open, so a marker count is not a soundness statement.** Which is why, as of
this revision, **it is no longer a sentence anybody maintains**: `run.mjs`
derives it and prints `Markers holding a fail-open: N` on every run — a marked
backend whose observation is `kind: "output"` on a case whose `expect` is
`"diagnostics"` — naming each row when N is non-zero. Zero extra measurement;
both halves of the predicate are in hand when the verdict is scored. Verified
non-vacuous against a reconstructed pre-fix tree, where the same code prints
`4` and names all four. If this paragraph and that line ever disagree, the line
is right. Each program was
written from the documentation before it was run. None is a "divergence" in the
runner's sense: each is a backend disagreeing with the *specification*, or — for
four of them — a place where the specification is silent and the marker says so
instead of choosing a side.

**Read the direction column for a second thing.** Every marker before the fourth
revision was on a program at least one backend *refuses*: fail-closed, a position
disagreement, or a documentation gap. Three of the five that revision added are
on programs that compile clean and are nevertheless wrong — two die at load or on
a second call, one silently selected the wrong handler. None of those three is a
fail-open, because the language requires none of them to be rejected, and that is
precisely what makes the class hard: a fail-open is found by a case that declares
a diagnostic, an accepted-and-wrong program only by a case that runs it and reads
what it printed. All three are `expect: "output"` for that reason. A future
revision reporting `0 divergent` and a shrinking marker count says nothing at all
about this class unless the corpus grew `output` cases to look for it.

**The wrong-handler one is the marker this revision retired**, and it is the only
one of the three that a *fix* could close — the other two await a sentence, not
an implementation. Two of that class remain. See "One marker was retired this
revision" below.

| case | backend | what that backend does instead | why it is a defect and not a wrong case |
| --- | --- | --- | --- |
| `04/a-function-local-error-class-cannot-be-declared-twice` | **js + go** | both compile clean, run the first call, and die on the second with the identical `TypeError: stable Error identity …:Inner is already registered` | **A DOCUMENTATION GAP, NOT A VERDICT — and the first marker in this register that names both backends.** Each invocation mints a *new* constructor claiming the *same* module-local identity; the registry is right to refuse two constructors for one identity, but the program was accepted. Two repairs, and no sentence chooses: either such a class is ordinary TypeScript whose behaviour compatibility.mdx §Source Relationship says `.sm` keeps, and the registry must tolerate per-call constructors; or it cannot receive a stable module-local identity — which is `SMITHERS1150`'s own sentence — and the compiler must refuse it at compile time, in which case **this case is retired rather than an implementation fixed**. Filing it is how a shared latent defect that neither backend can report about itself stops being invisible. |
| `09/a-callback-handed-to-an-untrusted-host-is-still-rejected` | go | reports the declared `SMITHERS1301@5:3` and `SMITHERS1509@5:28` but **not** the `SMITHERS1101@3:1` | compatibility.mdx §Foreign Boundary (Locked): calling an unannotated foreign value "MUST **add the checked `panic` case**" — adding the case is the row charge and the diagnostic is downstream of it. The reference calls `recordForeignBoundary(owner, panic)` beside its `SMITHERS1509`; the fork's `checkForeignBoundaries` reports without touching the row. **Both backends refuse the program**, so this is a diagnostic-set divergence and not a soundness one, and a `diagnostics` case is exact in both directions so the omission cannot be declared away. **Localized rather than guessed:** the fork charges the row correctly for the neighbouring `SMITHERS1508`, which `09/a-foreign-callable-handed-to-a-trusted-binding-is-still-rejected` declares and passes on both — so the machinery works and one reporter skips it. Pre-existing, and invisible until this revision because no case had handed a callback to an untrusted host from inside a function with a plain return type. |
| `09/a-module-trust-claim-is-not-a-call-site-opt-out` | go | the same omission, reached through a module carrying only the initialization claim | the same row, the same rule, the same reporter. The two retire together. Kept as a separate case because what it pins is separate: that a `@module @throws {never}` header answers `SMITHERS1510` and has never doubled as a per-call opt-out. Without it, a lane widening the argument-position rule could let the module header confer call-site trust and open every export of every trusted module at once. |
| `09/a-bare-panic-type-resolves-without-an-import` | go | adds `SMITHERS1104@3:1` — it does not resolve a bare `Panic` type | **A DOCUMENTATION GAP, NOT A VERDICT.** type-system.mdx:60 makes the compiler charge the distinguished checked `panic` case on every unannotated foreign call, so a contract that spells the channel the compiler itself charges must be able to name it — and `Result` is ambient in `.sm` already. But nothing on failures.mdx says whether the TYPE `Panic` is ambient; it says `panic` is imported from `smithers:exceptions`. The fork is arguably right. Neither backend should move on this marker; a sentence should. |
| `09/an-untrusted-union-return-is-an-executable-foreign-value-on-one-backend-only` | go | reports `SMITHERS1301@5:23` alone; the reference reports `SMITHERS1508@6:10` beside it | compatibility.mdx §Foreign Boundary. The returned value's type is `string \| Promise<string>` and the `Promise` constituent carries the foreign call out of the function un-awaited, which is what `SMITHERS1508` is for. **Both backends refuse the program**, so this is a diagnostic-set divergence and not a soundness one. The binding here carries **no `@throws` claim at all**, and that is the case's job: it is the control for the row below, and it localizes the shared omission to `containsForeignExecutableValue`'s union handling rather than to any trust rule. **Pre-existing, and measured as such rather than argued:** the case was re-run on a reconstructed tree carrying none of the 2026-08-26 foreign-boundary work and scored `js pass / go xfail` there, identically. |
| `09/a-trusted-union-with-a-promise-constituent-keeps-its-rejection-channel` | go | reports `[SMITHERS1502@5:23, SMITHERS1301@5:23]`; the reference adds `SMITHERS1508@6:10` | the same union shape as the row above with a `@throws {never}` marker added, so the same omitted cascade. What the case exists to pin — that a union with a `Promise` constituent still carries a rejection channel, so the opt-out marker on it is unusable — is reported **identically on both backends, at the same position, under the same code**. Only the cascade differs, and the control row above is the evidence for where the difference comes from. The two retire together. |
| `09/a-foreign-index-signature-read-through-a-property-access-needs-an-adapter` | go | reports `SMITHERS1506@4:17` and **refuses the program**; omits the `SMITHERS1101@3:1` | **THIS ROW WAS THE REGISTER'S ONE FAIL-OPEN AND IS NO LONGER.** Until 2026-08-26 the fork compiled this program with zero diagnostics, ran it and exited 0 printing `3`: its property rule consulted the *member's* declarations, an index-signature member has none, and an empty declaration list was treated as nothing to object to, so a foreign accessor could run inside a function whose row read `failures: []`. The second gate that did that is gone; the rule now asks the **receiver's** provenance alone, which is what the fork's own comment had claimed the rule was all along — a correct verdict resting on a stale reason, and the reason was the part that was wrong. What remains is the row charge: compatibility.mdx §Foreign Boundary says the call "MUST **add the checked `panic` case**", the reference charges the row beside its report and the fork does not, so the `SMITHERS1101` is missing. **Both backends now refuse the program**, so this is a diagnostic-set divergence and retires with the other five row-charge rows. Re-measured through `run.mjs --backend both --filter … --json` from source rather than through `bin/smithers.js`, which serves a stale build. |
| `09/a-foreign-index-signature-read-through-an-element-access-needs-an-adapter` | go | reports `SMITHERS1506@4:17` and refuses the program; omits the `SMITHERS1101@3:1` | The **deliberate pair** of the row above: `keyed["width"]` against `keyed.width`, the same member off the same value. One case cannot tell a rule that reads the receiver from a rule that happens to refuse one spelling, and the corpus had only the dotted one — so the fix above landed with its central claim unpinned. **Demonstrated failing against the pre-fix tree, not merely pinned:** staged into a reconstructed pre-change tree and run through the real runner there, where the fork compiled it, ran it and exited 0 printing `3`. |
| `09/a-library-declared-member-of-a-foreign-value-still-needs-an-adapter` | go | reports `SMITHERS1506@4:17` and refuses the program; omits the `SMITHERS1101@3:1` | The half of the same argument the index-signature cases cannot make: `constructor` **is** declared, and its only declaration is in `lib.es5.d.ts`. A rule that decides by asking where the member is declared admits this read even after it stops treating an empty declaration list as consent, so the declaring *file* had to be shown not to be the question either. Nothing stops a foreign object serving `constructor`, `length` or `toString` from a throwing getter or a `Proxy` trap, and `lib.es5.d.ts` describes a shape rather than vouching for an object. The receiver here is `spreadable`, whose own `a` getter throws. **Demonstrated failing against the pre-fix tree:** the fork compiled it, ran it and exited 0 printing `false`. |
| `09/destructuring-a-foreign-value-runs-its-accessors` | go | reports `SMITHERS1506@4:9` — at the binding **pattern**, agreeing with the reference on position as well as code — and refuses the program; omits the `SMITHERS1101@3:1` | `const { width } = keyed` is a property read with **no property-access node to see**, the same shape as the implicit-invocation protocols one level down, which is why it is a third case and not a variant of the first two. The position is the pattern rather than the initializer because the pattern is what decides how many members are read. **Demonstrated failing against the pre-fix tree:** the fork compiled it, ran it and exited 0 printing `3`; it modelled a binding pattern only for *authored* accessor rows and let the foreign case through with no diagnostic at all. |
| `09/a-fallible-getter-in-an-argument-still-needs-a-contract` | go | reports only `SMITHERS1303@8:19`; the reference reports `SMITHERS1105@8:19` beside it | **A DOCUMENTATION GAP, NOT A VERDICT — and the most consequential of the three, because what it records is a missing RULE, not a missed shape. The fork implements no `SMITHERS1105` and no `SMITHERS1106` anywhere.** So the two backends have always disagreed on every fallible accessor, constructor and generator, and the disagreement was structurally invisible: both codes sat in this page's worst bucket, *spelled by one implementation and probed by no case*, which produces no divergence in either direction ever. §2.16 and §2.17 recorded them as **uncovered** for exactly that reason; this marker is what moves them. It became visible only when the panic non-widening rule removed `SMITHERS1101` from the panicking half of the same class. **Both backends refuse the program**, so nothing escapes — `SMITHERS1303` is the refusal that matters, it is about a failure channel crossing a value edge, and both report it at the same authored position. They differ only in loudness. **No specification sentence names either code**; failures.mdx:190 requires only that the program be refused, and both satisfy it. Neither backend should move on this marker. Retire it by implementing the two codes in the fork if the accessor limitation is made normative, or by dropping the declaration to `[SMITHERS1303@8:19]` if it is not. |

**Sixteen of the eighteen pin current behaviour rather than a regression, and the
markers say which.** Only the two arrow-body rows are an over-reach in a rule
that moved. The position row, the parameter row, the **six** row-charge rows, the
two union rows and the four documentation gaps are pre-existing and
were newly *measured*. That distinction is the whole reason the pre-fix
demonstration is run: "not reached yet", "had it and lost it", and "never
specified" call for three different repairs. The six markers added on
2026-08-26 each had that demonstration run explicitly — the case was staged into a
reconstructed pre-change tree and scored there — precisely so that "pre-existing"
is a measurement in this register and not an inference.

**Six of the eighteen are one omission**, not six: the fork's foreign reporters
report without charging `Panic` to the enclosing row. They are listed separately
because each names a different route to it — a callback handed to an untrusted
host, a module-level trust claim, an index-signature read spelled with a dot, the
same read spelled with an element access, a member declared only by the standard
library, and a binding pattern — and one row would have tracked the omission
without being able to notice a fix that closed only one route. They retire in one
edit or the fix was partial.

**Four of the eighteen are the documentation.** For those the marker names both
observations, says which sentence is missing, and states the condition under
which the *case* is retired instead of an implementation "fixed". That is the
required shape when the documentation does not settle a disagreement. The newest
of the four is the first to name **both** backends, which is worth noticing:
agreement is not conformance, and two implementations agreeing on a program that
crashes is exactly the shape a differential oracle is blindest to.

**What most of them have in common is again the thing the code-set subtraction
cannot see.** `SMITHERS1204`, `SMITHERS1301`, `SMITHERS1302`, `SMITHERS1303`,
`SMITHERS1101` and `SMITHERS1104` are all spelled by both implementations. Most
markers here are a rule both backends "have" and one of them answers differently
in one spelling. They were found by writing ordinary programs. **The three filed
on accepted programs are not of that kind, and that is the point:** no code is
missing and no code is extra, so no subtraction over code sets could ever have
found them. Only running the program could.

### Three more markers were added, none retired, and one row changed direction — 2026-08-26, second revision

All three additions are `go`, all three are in `09-foreign-calls`, and all three
are the same row-charge omission as the two rows already in that class. Each was
**demonstrated failing against a reconstructed pre-fix tree** — the fork compiled,
ran and exited 0 on all three there — rather than only pinned against current
behaviour; the pre-fix tree was verified to be the right tree first (it differs
from the working tree in exactly the four files the closing lane touched, carries
none of the symbols that lane introduced, and still contains the deleted
member-declaration gate).

**The row that changed direction is the register's headline.**
`09/a-foreign-index-signature-read-through-a-property-access-needs-an-adapter` went from
**FAIL-OPEN** to fail-closed without being retired, which had not happened here
before, and the marker's stated reason had to be rewritten because it had become
a false description of current behaviour in the same commit that made it
obsolete. That is the failure mode this page keeps recording about its own tables,
reaching a marker for the first time: **a marker's `reason` is a measurement with
a timestamp, not a standing fact, and it goes stale the moment the backend moves
— including when the backend moves in the direction the marker wanted.** Re-read
a marker's reason against the backend before quoting it, exactly as this page
asks for its own numbers.

The other three markers named in the section below are the reason the direction
change is trustworthy rather than merely reported: the closing lane's fix asked
the receiver's provenance instead of the member's declarations, and the
index-signature case alone could not tell those two rules apart. The element-access
spelling, a `lib.es5.d.ts`-declared member and a binding pattern can.

### Three markers were added and none retired on 2026-08-26 — first revision

All three are `go`, all three are in `09-foreign-calls`, and all three are in the
table above with their pre-change measurement. Two are the union pair, which
retire together; the third is the fail-open the second revision closed. The revision that
added them also added **34 cases** — 24 in `09-foreign-calls` and 10 in
`20-host-globals` — of which 21 were demonstrated failing on a reconstructed
pre-change tree and 13 are acceptance or control cases that were instead proved
enforced by mutation (each expectation mutated red on both backends, then
restored and sha256-compared byte-identical).

### One marker was retired the revision before that

`04-nominal-errors/a-case-class-that-lies-about-instanceof-must-not-capture-a-sibling`
— the **wrong-handler** member of that accepted-and-wrong class, and the only one
of the three a *fix* could close; the other two await a sentence, not an
implementation. The fork used to compile the program clean, run it, and print
`timeout` where the reference prints `notfound:k`: its `lowerMatch` emitted a
bare `error instanceof CaseClass` chain, and `instanceof` consults the **right**
operand's `Symbol.hasInstance`, which any class may install. The marker also
recorded the blocker that had to clear first — a native type predicate narrows
its else branch by assignability, so two structurally identical Error classes
subtract each other and a `matchPartial` fallback over them collapses to `never`
(`TS2339`) — and required the fork to emit the reference's **nominal brand**
*before* switching the predicate. It did both, in that order. Measured `XPASS` on
`go` in one `node conformance/runner/run.mjs --backend both --jobs 4` run (354
cases, exit 0, go 1 xpass / 10 xfail), then re-measured with
`--filter a-case-class-that-lies-about-instanceof --json`, which reports
`stdout: ["notfound:k"]`, exit 0 and `agreement.agree: true` on **both** backends,
before the marker was deleted. What the fork used to do now lives in the case's
own `notes`, per the convention.

**The retirement did not shrink the contract; it grew it.** The predicate fix had
to close a whole class at once, and one case can only see one member of that
class, so the same revision added the cases that pin the rest: a lying case class
in `matchPartial` (the second spelling of the one lowering), a class that
**denies** its own instances (which used to abort the fork outright with
`non-exhaustive Error match`), a class whose **base** lies (a static member is
inherited, so the forgery arrives one class away from the site a reader
inspects), and a lying `@throws {T}` admitting an unrelated throw into a declared
foreign channel — the **construction** half, which is not a `match` at all. Two
further cases pin the brand's own residuals as working programs, so a lane that
removes the brand turns them red rather than silently re-narrowing a handler to
`never`. Retiring a marker on a class-wide fix without those is exactly how the
other spellings reopen unobserved.

### All eight markers were retired the revision before this one

Seven `go` and one `js`, **including both fail-opens**, every one measured
`XPASS` in a `--backend both --jobs 4` run before its marker was deleted. What
each backend used to do is recorded in the case's own `notes`, so the history
travels with the case:

| case | backend | what closed it |
| --- | --- | --- |
| `07/an-array-literal-of-results-that-is-never-consumed-is-refused` | go | **the fail-open**: the fork compiled and ran it, exit 0, discarding two checked failures with nothing reported before or during execution. It now re-asks after the transfer — a stored collection does not escape by being bound, and at least one reference must consume it — with the transfer gated on the container's own type still carrying the channel. |
| `09/a-dynamic-import-of-an-untrusted-foreign-module-is-refused` | **js** | **the other fail-open**: the reference initialized a foreign module with no trust claim through `import()` while refusing the byte-identical static edge. Both backends now apply one narrow rule about the target. |
| `07/a-conditional-branch-forwards-its-result` | go | the fork's ownership walk now forwards through a conditional's branch positions; the condition position still discards. |
| `07/an-object-literal-holding-a-result-is-consumed-through-its-property` | go | the container transfer now recognises object-literal property and spread assignment alongside the array forms. |
| `08/a-bound-promise-array-is-consumed-by-promise-all` | go | the transfer is no longer Result-only, and the ambient Promise combinators now discharge a *bound* collection. |
| `08/postfix-bang-on-an-unawaited-promise-result-is-not-a-result-operand` | go | both halves of the `!`-on-a-Promise carve-out were deleted — including the one that suppressed `SMITHERS1207` and emitted the `!` through, which failures.mdx forbids outright ("A rejected `!` MUST be a diagnostic, never a silent lowering") — stated in §Accepted Placements when this row was written, and surviving verbatim in §Refusal Conditions after that section's withdrawal on 2026-08-27. |
| `09/foreign-module-without-a-trust-marker` | go | the early return that disabled the entire foreign policy behind a refused module edge was removed. It had suppressed far more than the one diagnostic it was written for. |
| `09/a-dynamic-import-of-a-project-module-is-not-a-foreign-module-edge` | go | the blanket dynamic-import refusal was narrowed to the rule's actual subject, which also made a latent bridge crash reachable — and it was fixed at the same time (see 7.20). |

**Five of those eight were regressions**, measured `XPASS` at `ffa80e3` by the
previous revision before they were ever markers. Two were pre-existing and one
had been a bridge crash. None was "fixed" by softening an expectation: every
declared diagnostic set and every declared `stdout` in the eight is byte-for-byte
what it was when the marker was added.


### One marker was retired three revisions ago

`23-asset-imports/a-non-literal-dynamic-asset-import-is-rejected` — that
revision's finding, where the fork compiled a compile-time asset load into a
runtime `import()` and the emitted program exited 1 under node with
`ERR_MODULE_NOT_FOUND` for a file the case stages. It is closed: the fork now
routes literal dynamic asset sites through the same loader and admission
pipeline as a static asset edge and refuses computed specifiers and computed
attribute objects before emit.

The retirement was measured twice, on the tree as found, before anything was
deleted: `XPASS` in a `node conformance/runner/run.mjs --backend both --jobs 4`
run, then `--backend go --filter … --json`, which reports `SMITHERS5218` at
**4:24** with the message *"dynamic asset imports require a literal specifier and
a literal `with { ... }` attribute object"* — identical to the reference in code,
position **and message**. The full record of what the fork used to observe is in
the case's own `notes`, so the history travels with the case rather than with
this list, which is how an earlier version of this register went four entries
stale.

### Twenty-four markers were retired by the four revisions before this one

Five in the revision before (all `go`, all one cause — the fork did not own
export declarations, closed by `nativeLaunderWalk` and `staticRuntimeModuleEdge`,
and every one verified against a declared `messageContains` route rather than
against the code alone). Fourteen in the revision before that (thirteen `go`, one
`js`), two before that, and three earlier ones the register had lost track of.
Not restated; each is in its case's `notes`. In summary: the fork gained a
source-asset stage with all six built-in loaders and the four fail-closed asset
refusals under their own codes, ported the bound/unbound must-consume split, gave
up reporting diagnostic columns as UTF-8 byte offsets, stopped accepting a
top-level `Result.expect(...)`, and learned to follow a value through every
re-export spelling; and the reference's portability pass learned which relative
imports the source-asset stage owns.

**Two acceptance controls held across the re-export retirement and still hold**
(`21-native-pin/a-clean-re-export-chain-still-satisfies-the-pin`,
`a-type-only-re-export-adds-no-requirement`). They are the evidence that the fork
implemented a walk that follows a binding rather than a rule that charges every
re-export edge, and they are the model for the three acceptance twins this
revision added.

## Go `unsupported` rows

**One, as of 2026-08-26 (third revision), and it is the first one the corpus has
carried in five measurements.** It arrived because a question was asked, not
because anything regressed:

| row | what the fork did |
| --- | --- |
| `17/an-actions-failure-channel-mints-one-identity-per-error-class` | reported stock `TS2339` + five `TS7006` on an authored `.sm` file. Its `smithers:flows` surface types a durable schema as `{digest, format, role, schemaVersion, shape, source}` — **no `descriptor`** — so `plan.actions[0].errorSchema.descriptor` does not exist there and no compiler-derived durable failure identity is reachable from `.sm` on that backend in either direction. `unsupported` is exactly right: not implemented yet, loudly. |

`unsupported` does not gate — only `fail` does — so the run is still exit 0. What
it costs is one row of backend agreement (404/422 rather than 405/422), and what
it buys is the corpus's first observation of a durable failure identity at all
(row 20.12b). It moves from `unsup` to `pass` the day the fork's virtual-module
types carry the descriptor.

The previous count was zero across four consecutive measurements. The last row
before this one — `23/a-type-only-asset-import-is-rejected`, where the
fork reported a stock `TS2857` where the reference reports `SMITHERS5208` — is
gone with the rest of the asset gap: the fork now owns that refusal under its
own code. The revision before that had three rows (`18/with-statement-is-forbidden`,
`09/a-bare-package-with-the-intrinsic-letters-is-foreign`,
`15/importing-a-name-a-module-does-not-export-is-rejected`), which had already gone the
same way.

That number is the one to watch during the migration. Read it precisely: `unsupported` was
never the dangerous bucket. It means "no rule of its own here yet", which is
loud and honest. The dangerous bucket is `fail` in the fail-open direction — the
fork accepting and running a program the language requires it to refuse — and
that is what the four `xfail` markers above hold, because a marker is the only
way the corpus can record such a thing without it counting as a divergence.
**Read the `unsupported`, `divergent` and `xfail` counts together or the first
two flatter — and the revision that added the four fail-open markers is the
sharpest illustration the page has: the number of recorded fail-opens went from
one to four while `0 unsupported` and `0 divergent` did not move at all, because
nothing changed in either implementation. Only the number of questions asked
changed.** The 2026-08-26 third revision is the same lesson in the other
direction: fourteen new questions moved `unsupported` 0 → 1 and left `divergent`
at 0, `xfail` at 16, and `Markers holding a fail-open` at 0 — again with no
implementation change, verified by `sha256` on both sides of the run.

## Documentation conflicts

> [!NOTE]
> **Items 1 and 2 are superseded — 2026-08-26.** Both are about grammar the
> 2026-08-23 withdrawal removed, and both cite cases that went with it:
> `11-expression-if-switch/` and `10-defer/` are empty directories, so
> `11/unlabeled-loop-expression-is-rejected` and the two `defer` ordering cases
> prove nothing today. Item 1's *conflict* is not thereby settled — the sentence
> at `docs/DECISIONS.md:289` is still there and still locks a form the
> specification page now calls Direction — but the corpus half of the argument
> is gone, so it is a documentation question with no measurement behind it.
> Q1 in the register below carries the same supersession.

1. **Loops as expressions — NOT resolved.** The previous revision recorded this
   as closed: "The page has since been narrowed to a **Direction** note that says
   exactly that. No conflict remains." **Re-checked, and only half the conflict
   was closed.** `specification/control-flow.mdx:19-22` was indeed narrowed to a
   Direction note. `docs/DECISIONS.md:289` was not, and still reads:

   > **Locked:** Blocks, `if`, `switch`, `while`, and `for` can be expressions.

   And `specification/index.mdx:54` states the tie-break: *"When these pages
   conflict with the ledger, **the ledger wins** until the specification is
   updated."* So the ledger currently locks a form that the specification page
   calls Direction and that **both implementations reject** —
   `11/unlabeled-loop-expression-is-rejected` declares `SMITHERS1702` and passes
   on both backends. The document that formally wins is the one that disagrees
   with everything else. Narrowing a specification page does not narrow the
   ledger, and this page should not have said it did.
2. **`defer` ordering** is still not locked. `control-flow.mdx` calls LIFO a
   candidate and the poc README calls it POC evidence. The two ordering cases
   pin LIFO and say so in `notes`, so a deliberate change is visible.
3. **The two intrinsic namespaces are intentional and exact.** Package-exported
   capability modules are `smthrs/context` and `smthrs/provider`; compiler-owned
   virtual modules use the colon namespace (`smithers:exceptions`,
   `smithers:comptime`, `smithers:flows`, `smithers:native`). Neither is trusted
   by prefix, which **`09/a-bare-package-with-the-intrinsic-letters-is-foreign`**
   now pins. Any docs still spelling the package modules as
   `smithers/context` are stale.
4. **`09/declared-foreign-throws-is-exposed` over-claims in its title.** It says
   a violated contract "still lands in Panic" but only exercises a foreign
   function that honours its `@throws {RangeError}` claim. The violated half is
   the separate case `09/declared-foreign-throws-violated-stays-panic`, which
   now passes on both backends.

## Unresolved documentation conflicts — questions for a human, not for this page

These are **not** resolved below. Each is a place where two documents that are
both normative say different things, and where a conformance case written
faithfully from one of them is wrong under the other. Recording them as open
questions is the only honest treatment: a corpus lane that picked a side would be
inventing language, and the ledger's own tie-break rule (`index.mdx:54`) means
the side this page might pick is not the side that wins.

Each entry names the exact consequence for the corpus, because that is what makes
it urgent rather than tidy.

| # | question | the two documents | consequence today |
| --- | --- | --- | --- |
| Q1 | **Can `while` and `for` be expressions?** | `docs/DECISIONS.md:289` — "**Locked:** Blocks, `if`, `switch`, `while`, and `for` can be expressions." vs. `specification/control-flow.mdx:19-22` — a **Direction** note saying an unlabeled loop in expression position "is not part of the current locked surface and is rejected by both implementations." `specification/index.mdx:54` gives the ledger priority. | The document that formally wins contradicts both implementations and the corpus. `11/unlabeled-loop-expression-is-rejected` pins the rejection, so **if the ledger is taken at its word, that green case is testing the wrong behaviour.** One sentence in one file settles it. |
| Q2 | **Is loop `else` required or optional?** | `specification/control-flow.mdx` contradicts **itself**: `:19-21` (§Expression Forms) says a loop value requires "a value-bearing `break` and **required `else`** completion"; `:62` (§Loop Else) says "a loop expression **MAY** provide an `else` value for the path where the loop completes without breaking". | Both implementations require it — `13/loop-value-without-an-else-is-rejected` is green on both. So §Loop Else's MAY describes nothing that exists. A case written from `:62` would assert acceptance and fail; a case written from `:19` is the one in the tree. One of the two sentences has to go. |
| Q3 | **Can a trusted adapter remove `Panic` from `E`?** | `specification/failures.mdx:113` — a caller MUST "propagate panic, explicitly catch it, or **use a trusted adapter that catches and translates it**", which implies `Panic` leaves the channel. vs. `docs/src/pages/guide/typescript-interop.mdx:46` — "the current POC's `Result.try` helper **conservatively retains `Panic`** in its result type even when a mapper is supplied." | The corpus's own authoring rule is "write the case from the documentation first". A case written straight from `failures.mdx:113` asserts a panic-free channel and **fails today**, so nobody has written it, and the adapter clause of a locked MUST is unmeasured. Either the specification sentence over-promises or `Result.try` under-delivers; a human decides which. |
| Q4 | **Is switch exhaustiveness a SHOULD or a MUST?** | `specification/control-flow.mdx:42` — "the compiler **SHOULD** require an expression switch to be exhaustive." vs. both implementations, which make it a hard error: `11/switch-expression-missing-a-union-member` declares `SMITHERS1716` and is green on both backends. | §13.9 records this as "covered as a SHOULD" while what is actually pinned is a MUST. That mislabels the strength of a green case: if a future implementation downgraded it to a warning it would be *conformant* with the spec and would **fail** this corpus — and per observation gap #11 the warning would then be invisible, so the case could not even be softened. |

None of these is a lane's work. Each is a one-sentence edit by someone with the
authority to make it, and each currently makes a conformance case unwritable or
wrong.

## "Feature complete" is not true, on the specification's own terms

This page exists to let someone judge that claim. Stated plainly, and separately
from anything about the corpus: **it is not true, and the gap is not test
coverage.**

| # | locked obligation | status | evidence |
| --- | --- | --- | --- |
| F1 | *"Smithers **MUST** support a near-native target through LLVM"* | **CLOSED 2026-08-23 by withdrawal, not by implementation.** The near-native/LLVM target and the Wasm target were withdrawn from the specification; TypeScript is the only target. This is no longer an unimplemented MUST because it is no longer a MUST. Pre-withdrawal record follows. | `compatibility.mdx:60`. `grep -ril llvm poc/src/ src/ compiler/ cmd/` returns nothing; the string occurs only in prose. This is the single largest unimplemented MUST in the repository and it is the one row 10.13 has always named. It also blocks 20.38 (a deployment build MUST be capable of emitting a **native** worker artifact). |
| F2 | compiler and loader sandboxes | **process-level, not container or VM isolation** | `specification/index.mdx:83`. No gate measures isolation strength at any level. |
| F3 | durable runtime coordination | **no multi-machine coordination** | `specification/index.mdx:84`. §20.23–20.28 and 20.38–20.40 are the sentences this makes unreachable; `poc/src/durable/remote-worker.ts` and `isolated-worker.ts` are single-machine. |
| F4 | fork patches | **neither vendored into the distribution nor signed** | `specification/index.mdx:81-82`; `docs/TYPESCRIPT_FORK.md` records the series as reviewable and digest-gated but not vendored or signed, and `.sm` as still "a content-mapper extension rather than a built-in source kind" (`index.mdx:41-42`). No gate measures any of it. |

`specification/index.mdx:80-84` names all four in one paragraph. **This page had
named only the first**, and named it in a sentence that also made a false claim
about Wasm. F2, F3, and F4 are projects rather than lanes, and no amount of
corpus work substitutes for them — which is precisely why an audit that omits
them reads as more finished than the system is.

The Wasm target is a different case and belongs here for contrast:
`compatibility.mdx:60` makes it a **SHOULD**, and a bounded backend exists
(10.14). That obligation is met at the strength the specification asks for. It is
simply unmeasured by this corpus.

---

## The fail-open pins

Column 4 answers the only question that makes a pin worth anything: *would this
case have failed against the behaviour it pins?*

**This section enumerates six revisions in full and two in summary, and the gap
is recorded rather than papered over.** The six enumerated below total one
hundred and sixty-seven cases: twenty-three, then eleven, then fifteen, then
forty-three, then fifty, then twenty-five. The **first 2026-08-26 revision's
twenty-one** demonstrations were run and are recorded under "How and when this
page was measured" and in that revision's own section, but were never enumerated
here — so this section was one revision stale before the entry below was added,
which is worth knowing before quoting its total as a census. The **second
2026-08-26 revision's seven** are enumerated immediately below.

### This revision's seven — 2026-08-26, second revision

**Seven of the ten cases added were demonstrated failing against the pre-fix
behaviour; the other three are acceptance guards that were green before the
change by construction and were proved enforced by mutation instead.**

**The pre-fix tree was verified before it was trusted**, which is the step that
makes the column mean anything. It is a full copy of the repository left on disk
by the lane that closed the defect, with the current `conformance/` tree copied
in so the runner and the corpus are identical and only the compiler differs.
Structurally it differs from the working tree in exactly the four files that lane
touched (`poc/src/language/semantic.ts`, its `README.md`,
`compiler/forkbridge/mustconsume.go.txt`, `compiler/forkbridge/lowering.go.txt`),
plus the two new test files that are absent; it contains none of the symbols that
lane introduced (`heldChannel`, `heldObligation`, `transferReachesCaller`,
`isRecognizedPromiseCombinatorCall`); and its `lowering.go.txt` still contains the
deleted second gate that walked `symbolDeclarations(symbol)`. Behaviourally it
reproduces the documented pre-fix output on every one of the seven. Both backends
were run from that tree's own copies of the runner, which resolve their repository
root from `import.meta.url`, so the reference ran that tree's `poc/src/language`
and the fork was rebuilt from that tree's `cmd/` and `compiler/`.

| case | half of the rule it pins | pre-fix (js) | pre-fix (go) |
| --- | --- | --- | --- |
| `07/a-returned-result-collection-charges-its-caller` | the executed defect: a returned Result collection charges its caller | **compiled, ran, exit 0, printed `saved 3 records`** while a checked `SaveFailed` was thrown and dropped | **identical** |
| `07/an-awaited-result-collection-charges-its-caller` | `await` removes only the Promise layer | **compiled, ran, exit 0, printed `1`** | **identical** |
| `07/a-returned-promise-collection-charges-its-caller` | the `SMITHERS1402` twin — the predicate names *which* channel | **compiled, ran, exit 0, printed `2`** | **identical** |
| `07/a-collection-laundered-through-an-opaque-return-type-is-still-a-discard` | a `return` discharges only when the return type carries the channel | **compiled, ran, exit 0, printed `false`** | **identical** |
| `09/a-foreign-index-signature-read-through-an-element-access-needs-an-adapter` | the receiver's provenance, not the spelling | pass — the reference always refused it | **compiled, ran, exit 0, printed `3`** |
| `09/a-library-declared-member-of-a-foreign-value-still-needs-an-adapter` | the receiver's provenance, not the declaring file | pass — the reference always refused it | **compiled, ran, exit 0, printed `false`** |
| `09/destructuring-a-foreign-value-runs-its-accessors` | a read with no member expression | pass — the reference always refused it | **compiled, ran, exit 0, printed `3`** |

The three `09` rows are `pass` on the reference in both trees because the defect
they pin was only ever in the fork; their pre-fix demonstration is the fork
column, and it is a fail-open in every one of the three.

**The three not in this table**, and what was done instead:
`07/a-returned-result-collection-is-consumed-by-result-all`,
`07/a-returned-result-collection-is-consumed-by-an-index-read` and
`07/a-published-result-collection-with-no-caller-is-an-ordinary-transfer` are
over-correction guards — they were green before the change and must stay green,
so no tree can demonstrate them failing. Each declared `stdout` was mutated to a
line the program does not print, both backends went red with the diff printed,
and each expectation was restored and **sha256-compared byte-identical** to the
original. The three `09` cases' declared positions were verified the same way,
because an `xfail(go)` marker suspends the declaration on the fork and only the
reference half enforces it — see observation gap #14.

### The revision before this one's twenty-five — 2026-08-25, third revision

**Nineteen of the twenty-five demonstrably fail against the pre-fix tree, and
the pre-fix tree isolates ONE change rather than a commit.** The panic fix is
uncommitted working-tree work, so a worktree at `dede442` would also lack the
convergence and callback-contract lanes' fixes and could attribute nothing. The
method instead: detached worktree at `dede442`; the current working-tree copy of
all 21 non-`conformance` modified and untracked files overlaid; the whole current
`conformance/` tree copied in. **Control arm** — that worktree reproduced the
main tree exactly (60/60 js, 57/60 go, 3 xfail on `--filter 09-foreign-calls`),
which is what makes the second arm mean anything. **Pre-fix arm** — only
`poc/src/language/semantic.ts`, `poc/src/language/compile.ts` and
`compiler/forkbridge/lowering.go.txt` reverted to their pre-panic-fix contents.

```
pre-fix reference (js): 42/60 pass, 18 divergent   — 18 of the 25 fail
pre-fix fork      (go): 38/60 match, 19 divergent  — 19 of the 25 fail
union: 19 of 25
```

| case | half of the rule it pins | pre-fix (js) | pre-fix (go) |
| --- | --- | --- | --- |
| `a-panic-in-an-if-body-keeps-a-plain-return-type` | MUST-NOT widen — **the replaced expectation** | `1101@2:1` | `1101@2:1` |
| `a-panic-in-a-plain-return-function-does-not-widen-it` | MUST-NOT widen, function declaration | `1101@5:1, 1301@11:11` | same |
| `a-panic-as-a-concise-arrow-body-is-an-abort` | MUST-NOT widen, concise arrow | `1101@3:14, 1301@7:28` | same |
| `a-panic-two-helpers-deep-leaves-both-callers-plain` | MUST-NOT widen, transitively | `1101@3:1, 1301@4:47` | same |
| `an-accessor-may-read-its-state-through-a-panicking-helper` | MUST-NOT widen, class getter | `1101@6:1, 1302@17:11` | same |
| `a-constructor-a-getter-and-a-setter-may-all-abort` | MUST-NOT widen, the three members that carry no channel | `1105@5:3, 1101@9:3, 1105@9:3, 1105@13:3` | `1101@9:3` **only** — the constructor and setter were refused on the reference alone |
| `an-object-literal-method-and-getter-may-abort` | MUST-NOT widen, object literal | `1101@4:3, 1101@8:3, 1105@8:3, 1301@14:11` | same minus the `1105` |
| `an-instance-and-a-static-method-may-abort-with-a-panic` | MUST-NOT widen, class methods | `1101@4:3, 1101@8:3, 1301@15:11` | same, with `1301@15:11` reported **twice** |
| `a-generator-may-abort-with-a-panic` | MUST-NOT widen, generator | `1101@3:1, 1106@3:1, 1301@9:14` | same minus the `1106` |
| `an-async-function-may-abort-with-a-panic` | MUST-NOT widen, async | `1101@3:1, 1301@9:11` | same |
| `an-exported-void-assertion-needs-no-result-contract` | MUST-NOT widen, exported public contract | `1102@3:1, 1301@8:3` | same |
| `an-inline-callback-may-abort-with-a-panic` | MUST-NOT widen, callback value edge | `1101@4:22, 1303@4:22` | same |
| `reflect-panic-under-a-plain-return-type-is-the-same-abort` | MUST-NOT widen, ambient spelling | `1101@1:1, 1301@7:11` | same |
| `an-unannotated-panicking-function-infers-no-result-to-swallow-it` | MUST-NOT widen, **inference** | `1301@14:5` | same |
| `only-an-explicit-boundary-observes-a-panic-from-a-plain-function` | the unwind, and that only `Result.try` sees it | `1101@6:1, 1301@14:5` | same |
| `unwrap-or-cannot-reach-a-panicking-plain-return-type` | recovery MUST NOT swallow — no surface exists | `1101@3:1` (not the declared `TS2339`) | same |
| `recover-cannot-reach-a-panicking-plain-return-type` | recovery MUST NOT swallow — no surface exists | `1101@3:1` (not the declared `TS2339`) | same |
| `an-inferred-error-channel-does-not-absorb-a-panic` | **the materialization gate — the fail-open** | **compiled clean, 0 diagnostics, printed `missing: empty key`** | **identical** |
| `a-contract-error-does-not-suppress-a-panic-placement-refusal` | the placement refusal survives a contract error | pass — pins current | `1101@5:1` only; the `1503` was suppressed |
| `an-ordinary-recoverable-throw-still-requires-a-result` | **scope guard** — an ordinary `throw` still widens | pass — pins current | pass — pins current |
| `an-untrusted-foreign-call-propagated-with-bang-still-charges-panic` | **scope guard** — the foreign channel is untouched | pass — pins current | pass — pins current |
| `throwing-a-panic-instance-is-an-ordinary-recoverable-exit` | **scope guard** — `throw new Panic` is not a third spelling | pass — pins current | pass — pins current |
| `a-fallible-getter-in-an-argument-still-needs-a-contract` | the `SMITHERS1105`/`1106` asymmetry | pass — pins current | `xfail` — pins current |
| `a-top-level-panic-is-still-refused` | **lowering boundary** — no return type to keep | `1505@3:1` — pins current | `1505@3:1` — pins current |
| `a-panic-in-a-static-initializer-block-is-still-refused` | **lowering boundary** — the construct is refused wholesale | `1107@4:3` — pins current | `1107@4:3` — pins current |

**The six that pin current behaviour are the finding, not the filler.** Three
are the scope guards, and a scope guard that *moved* would mean the rule had
leaked out of `panic(...)` into the recoverable or foreign channel; their staying
identical across the revert is the evidence that the fix was made at the panic
charge rather than at the widening machinery. Two are the lowering boundaries
that close the class — module top level and a class static block — and until
this revision neither had a case, so a later lane widening the rule into "a panic
is legal everywhere" would have broken nothing here. The sixth is the asymmetry
marker.
Two rows are worth reading twice: the fail-open row, where **both** backends
compiled a program with zero diagnostics and delivered an invariant violation
into the caller's expected-error branch; and the `1105` columns, which show three
members (constructor, setter, object-literal getter) that were refused on the
reference and **not refused at all** on the fork before the rule landed.

### The revision two before this one's fifty — 2026-08-25, second revision

**Thirty-one of the fifty demonstrably fail against the pre-fix tree, and the
demonstration was run rather than argued.** The fixes these cases pin — the
convergence lane's and the callback-contract lane's — are **uncommitted
working-tree work**, so the pre-fix tree is the committed tree itself: `dede442`.
It was checked out into a detached worktree, the fifty new cases were copied in,
and both backends were run there:

```
pre-fix reference (js): 238/254 pass, 15 divergent
pre-fix fork      (go): 220/254 match, 24 divergent, 4 unsupported
```

Every one of the reference's fifteen divergences is one of these fifty cases, and
twenty-three of the fork's twenty-four are (the twenty-fourth is
`09/foreign-module-without-a-trust-marker`, the regression the previous revision
recorded). Read the two columns together and the split is informative rather than
incidental:

- **15 failed on the reference** — the entire callback value-edge family
  (`12.5a`, `12.5b`) plus the two dynamic-import refusals the reference used to
  compile and run. Ten of the callback rows are the *fail-open* shape: accepted
  with zero language and zero emitted-TypeScript diagnostics, executing with
  `isOk() === true` and a `Result` sitting in the success payload.
- **23 failed on the fork** — the `!` placement rows the fork refused
  (`switch`, `for` initializer, `??` left, `await` after `!`), the whole callback
  family again, the container-ownership rows, and the dynamic-import rows.
- **4 more were `unsupported` on the fork**, which is the honest label for what
  happened: the fork *rejected its own emitted TypeScript* with `TS2322` on
  ordinary programs, because its lifting consulted the Smithers side table for a
  direct `!` only and the stale TypeScript meaning of `!` leaked one edge further
  out through a `const` binding's inferred type. Those four are
  `a-contracted-callback-throw-reaches-the-caller-as-a-failure`,
  `a-lifted-call-stored-into-a-plainly-typed-array-is-still-a-discard`,
  `a-result-consumed-only-inside-a-callback-is-consumed` and
  `result-all-on-a-bound-array-is-consumed-by-propagating-it`. A fail-CLOSED
  defect, on programs an author would write on the first day.

**The other nineteen pin current behaviour, and each is deliberate.** Seven are
`!` placement rows both backends already answered correctly — they pin the
then-newly-normative §Accepted Placements rule, which was almost entirely unpinned (that section was **withdrawn 2026-08-27**; those seven rows now pin current compiler behavior rather than a live obligation — see the 2026-08-27 citation record);
five are over-correction guards for the callback-contract and container rules
(`a-callback-forwarding-an-existing-result-needs-no-annotation` is the one a
measured stronger rule already broke); six are the divergence markers in the
register above; and one (`a-module-name-containing-import-…`) is the static
sibling of a crash regression pin. **Nineteen cases pinning current behaviour is
not nineteen cases of filler** — the corpus has shipped seven over-corrections
and the guards are what catch the eighth.

**No case in this revision depends on `SMITHERS1101`, `SMITHERS1105`, or panic
widening.** That was a deliberate boundary: a lane was implementing the new
§Panic Does Not Widen a Return Type rule across both backends while this revision
ran. The corpus case that DOES depend on it —
`09/a-panic-in-an-if-body-still-needs-the-panic-channel` — moved under that lane
and is the single failing row in this revision's scoreboard. It belongs to them.
**The third revision settled it**: the expectation was replaced from the
specification, the case renamed `a-panic-in-an-if-body-keeps-a-plain-return-type`,
and the rule pinned in both directions by twenty-two further cases (§7.24–§7.29).
The `SMITHERS1105` half of the deferral turned out not to be a panic question at
all — it is an unmeasured backend asymmetry, now carrying its own marker.

### The previous revision's forty-three — 2026-08-25

**Thirty-six of the forty-three demonstrably fail against the pre-fix tree, and
the demonstration was run rather than argued.** The three fix lanes that closed
REVIEW-fable-1.md's F1–F6 are commits `a013b94`, `60b8bd9` (reference) and
`3940e4d`, `5d76c7f`, `e590100`, `e2c5bf4` (fork); `ffa80e3` is the commit before
all six. The whole corpus, including these forty-two, was checked out into a
detached worktree at `ffa80e3` and run on **both** backends:

```
pre-fix reference (js): 227/246 pass, 18 divergent   —  18 of the new cases fail
pre-fix fork      (go): 215/246 match, 21 divergent, 3 unsupported, 2 xfail, 5 XPASS
```

The Go column counts every non-matching verdict, not only `divergent`: three of
its failures were bucketed `unsupported` because the fork reported stock
TypeScript codes on authored `.sm`, and two were already carrying a marker.
Union of the two failure sets: **36 cases**, with eight failing on both backends
— the computed-member family, which is exactly the family the review predicted a
differential oracle could never see.

Eighteen of the pre-fix fork's failures and three of the pre-fix reference's are
the *fail-open* shape — the backend compiled the program and ran it, twice with
the emitted program dying at runtime on a capability that was never provided
(`05/a-computed-context-access-charges-the-same-row`,
`06/a-computed-layer-provide-checks-its-capability-closure`, both exit 1 on both
backends before the fix). The five `XPASS` rows are the opposite finding and are
recorded in the `xfail` register: the fork answered those five correctly at
`ffa80e3` and does not now.

The remaining **seven** pin current behaviour rather than a fixed defect, and
every one is deliberate — five are the over-correction guards and two are
boundary/regression pins: `07/an-ordinary-computed-property-access-is-untouched`,
`07/an-ownership-transfer-in-every-position-is-accepted`,
`07/the-discard-positions-stay-ordinary-for-values-that-are-not-results`,
`05/a-capability-read-through-a-local-alias-is-subtracted-by-its-layer`,
`09/a-panic-in-an-if-body-is-a-simple-exit`, and
`20/a-computed-date-now-is-refused` (the one recognizer that already tested for a
literal element access, and the precedent the rest were fixed to follow), and
`05/a-non-literal-computed-capability-access-has-no-statically-known-member`
(the boundary of the family: a key that is not a literal selects nothing
statically, so no recognizer may claim it, and the case pins where it fails
closed instead — measured identical on both backends before and after the fix). A guard
that passes everywhere is not a weak case — it is the row that would notice the
fix for the case beside it going too far, which is what happened five times in
this session's fork commits and once, caught before it shipped, in the
reference's (`09/foreign-module-without-a-trust-marker` refused an attempt to
make container literals unconditionally transparent).

### The revision before that: fifteen

Their subject is the largest unpinned surface in the repository. Five lanes closed
well over a hundred fail-open forms in `poc/src/targets/classify.ts` and not one
corpus case covered any of it, so every rule below was, until now, a rule both
implementations could lose without the scoreboard moving.

**Four of the fifteen demonstrably fail — on the fork, right now.** That is the
highest count this column has ever carried, and it is not because the fork got
worse. It is because the questions had never been asked.

| case | pins | fail-open direction | demonstrated failing against the behaviour it pins? |
| --- | --- | --- | --- |
| `21/a-callback-a-callee-invokes-is-part-of-the-pinned-graph` | a callback is in the graph exactly when the callee's visible body invokes it; route `-> invoking-callee.mod.sm#run` | **fork (live)** | **YES** — the fork accepts, certifies and runs it (exit 0, prints `1`). See the register. |
| `21/a-class-instance-method-is-part-of-the-pinned-graph` | the method that runs is the one on the class the caller constructed, not the interface member the signature selected; route `-> reader-callee.mod.sm#run -> …#read` | **fork (live)** | **YES** — accepted, certified, run. |
| `21/a-layer-cannot-subtract-a-requirement-that-blocks-the-pin` | layer satisfaction subtracts nominal capability rows and never a built-in requirement | **fork (live)** | **YES** — accepted, certified, run, and separated from a missing walk by two probes: the byte-identical program with the capability renamed `Config` is refused. |
| `21/a-side-effect-import-chain-is-part-of-the-pinned-graph` | the module LOAD graph, transitively; route `-> loads-host.mod.sm -> node:fs` | **fork (live)** | **YES** — pin granted. Isolated to the transitive half: the fork charges a direct `import "node:fs"` correctly. |
| `21/a-host-read-in-a-module-initializer-is-part-of-the-pinned-graph` | ambient authority read by a module-level initializer; route `-> initializer-host.mod.sm#pid -> process.pid` | **neither today** — it was a live *reference* fail-open one day ago | **no** — both backends refuse it now. Reverting `poc/src/targets/classify.ts` to prove it is not a licence this lane has. |
| `21/a-host-read-behind-an-immediately-invoked-function-is-part-of-the-pinned-graph` | a function invoked where it is written runs where it is written, and adds no hop — declared as the *same* route as the case above, which is the contract | same | **no** — pins current behaviour. Its A/B is real though: the two cases differ by one pair of parentheses and must produce the identical route. |
| `21/a-layer-provide-callback-is-part-of-the-pinned-graph` | `Layer.provide` keeps its environment active THROUGH the callback, so the callback runs | same | **no** — pins current behaviour |
| `21/a-callback-a-callee-only-stores-still-satisfies-the-pin` | acceptance twin; an `expect: "output"` case that compiles, type-checks its emitted module set, and runs | — | n/a (over-correction guard) — **and it passes on the fork for the wrong reason**, which the case's own `notes` state: a backend that enters no callback satisfies a negative automatically. |
| `21/a-layer-provided-capability-is-subtracted-and-the-pin-still-holds` | acceptance twin; the provided row really is subtracted, including through an ordinary call, and the pin holds | — | n/a (over-correction guard) |
| `21/a-pin-whose-argument-is-not-a-project-function-is-rejected` | `SMITHERS3005`, unresolvable-subject branch, reported at the argument. **The gate on the whole area** | **neither** — a rule both implementations have and nothing probed | **no** — pins current behaviour |
| `21/a-pin-given-two-arguments-is-rejected` | `SMITHERS3005`, arity branch, reported at the call. Written separately because the two branches report at different positions | same | **no** — pins current behaviour |
| `09/panic-outside-a-statement-or-return-is-rejected` | `SMITHERS1503`: `panic(...)` is an exit, not a value | same | **no** — pins current behaviour. It did find a real backend wording difference (§7.23). |
| `10/async-errdefer-cannot-inspect-a-directly-returned-promise` | `SMITHERS1713`, isolated at last from `SMITHERS1402`/`1712` | same | **no** — pins current behaviour |
| `06/a-provide-callback-that-is-not-a-local-function-is-rejected` | `SMITHERS2103`: the "what is required" half of knowing the complete closure | same | **no** — pins current behaviour |
| `17/an-opaque-durable-argument-is-rejected` | `SMITHERS4103`, obligation 20.5; the durable area's analogue of `SMITHERS3005` | same | **no** — pins current behaviour |

**One case was written, measured, and deliberately NOT landed**: `SMITHERS1708`
(§13.21). The evidence says the fork is right — it preserves the authored
evaluation order on the exact shape the reference refuses — so pinning the
reference's refusal would have made correct fork behaviour a conformance failure.
Recording that is worth more than a fifteenth green row would have been.

**Four of the fifteen demonstrably fail; eleven pin current behaviour, and two of
those are acceptance controls.** The eleven divide into two kinds and the
difference matters: five were live *reference* fail-opens within the last day and
are unrevertable from this lane, and six are rules both implementations have had
all along and nothing had ever asked about.

### The previous revision's twenty-three

Twenty-two are for behaviour that was **already fixed**; the twenty-third is for
a defect that was still live, in the harness itself. Every one of them exists
because an accepted-surface census compared the two implementations' full
accepted surface rather than running more cases, found ten fail-opens the corpus
was structurally blind to, and the lanes that closed them left **none of them
pinned**. A fix with no case is a fix that can silently rot, and the corpus
reported the same `211/211` agreement before those fixes and after them.

| case | pins | fail-open direction | demonstrated failing against the old behaviour? |
| --- | --- | --- | --- |
| `21/a-pin-reaching-a-host-module-through-a-re-export-is-rejected` | a `node:fs` edge behind a named re-export still blocks the pin, and the route names the laundering module | reference (fixed) **and fork (live)** | **yes** — it fails on the Go backend, which still has the defect: zero diagnostics, pin granted, prints `9` |
| `21/…-through-a-star-re-export-…` | the same through `export *`, where no checker alias exists to follow | same | **yes**, same route |
| `21/…-through-a-two-module-chain-…` | two hops, both named in the reported route | same | **yes**, same route |
| `21/…-through-a-re-export-cycle-…` | a cycle containing a reachable foreign edge is still charged, and the walk terminates | same | **yes**, same route |
| `21/…-through-a-parameter-default-…` | a parameter default executes inside its function, so its edges are in that function's graph | reference (fixed) | **no** — both backends refuse it today. It pins current behaviour. Reverting `poc/src/targets/classify.ts` to reproduce the historical defect is another lane's work. |
| `21/a-clean-re-export-chain-still-satisfies-the-pin` | acceptance control, both re-export spellings | — | n/a (over-correction guard) |
| `21/a-type-only-re-export-adds-no-requirement` | acceptance control, Locked type-only rule | — | n/a (over-correction guard) |
| `09/a-re-exported-foreign-module-still-needs-a-trust-marker` | a re-export is a module edge and needs the initialization trust claim | **fork (live)** | **yes** — the fork compiles and runs it |
| `17/the-retired-vibelang-flows-specifier-is-not-compiler-owned` | only `smithers:flows` is compiler-owned; the retired name is an ordinary unresolvable module | fork (fixed) | **no** — the fix is in the tree and the specifier is gone from both Go tables. Pins current behaviour. The historical defect is recorded with its evidence in the case's `notes`. |
| `17/a-single-action-flow-lowers-to-a-static-plan` | acceptance control: the real specifier still lowers a Plan | — | n/a (over-correction guard) |
| `09/module-init-trust-is-not-a-function-level-throws-claim` | the documented `/** @module @throws {never} */` header does not certify the first export | fork (fixed) | **no** — pins current behaviour. Observation is behavioural: under the defect the throw escapes and the program exits non-zero instead of printing `panic`. |
| `09/near-miss-trust-markers-do-not-confer-module-trust` | `@moduleResolution` is not `@module`; `@throws` + decoration + `{never}` is not the marker | fork (fixed) | **no** — pins current behaviour, both near misses in one case |
| `09/a-multiline-module-trust-header-is-honoured` | acceptance control: the ordinary multi-line header still confers trust | — | n/a (over-correction guard) |
| `09/the-never-annotation-is-case-sensitive` | `{Never}` is a declared channel that names no resolvable Error class, not the opt-out | fork (fixed) | **no** — pins current behaviour |
| `23/a-non-identifier-import-attribute-name-is-rejected` | `SMITHERS5203` | fork (fixed) | **no** — pins current behaviour |
| `23/a-duplicate-import-attribute-is-rejected` | `SMITHERS5204`; a last-wins reading compiles JSON through the `text` loader | fork (fixed) | **no** — pins current behaviour |
| `23/a-computed-import-attribute-value-is-rejected` | `SMITHERS5205` + `SMITHERS5201` | fork (fixed) | **no** — pins current behaviour |
| `23/a-template-literal-import-attribute-value-is-rejected` | the same pair through `isStringLiteralLike`; a hole the census did not name | fork (fixed) | **no** — pins current behaviour |
| `07/a-shadowed-result-namespace-does-not-discharge` | a user's own `const Result = { all: … }` discharges nothing | reference (fixed) | **no** — pins current behaviour |
| `07/a-shadowed-promise-namespace-does-not-discharge` | the same at the Promise combinators, with an `async` member that defeats a promise-shape guard | reference (fixed) | **no** — pins current behaviour |
| `07/the-compiler-owned-result-all-discharges` | acceptance control | — | n/a (over-correction guard) |
| `07/the-ambient-promise-all-discharges-a-bound-promise` | acceptance control, bound form | — | n/a (over-correction guard) |
| `16/the-comptime-target-is-one-declared-input-for-both-backends` | `comptime.target` reports the target the compilation was given, and both backends are given the same one | **the harness (live until this revision)** | **yes** — with the Go request restored to `options: {}`, the case fails: `stdout ["server:typescript-node"] != ["server:node-es2022"]`. This is the one defect this lane could legitimately revert to reproduce, because the defect was in the harness, which this lane owns. |

**Seven of the twenty-three demonstrably fail against the behaviour they pin.** The
other sixteen pin current behaviour, and that distinction is recorded rather
than smoothed over, because a case that could never have failed is a weaker
instrument than one that did. The reason is the same in every instance: the fix
is already in the tree, and reverting another lane's work to prove a point is
not a licence this lane has. Where the historical observation is known it is
written into the case's own `notes`, so a future reader can reconstruct the
counterfactual without trusting this table.

**Five of the twenty-three carry no expectation of failure at all** — they are the
acceptance controls, and they exist because this repository has shipped
over-corrections twice while closing rules of exactly this kind: one lane broke
ordinary boolean negation while fixing retired-syntax rules, another made a
whole specifier namespace requirement-free. A corpus that only pins refusals
invites the next one.

### The fail-opens this corpus still cannot pin, and why

Of the ten the census found, **three** are still not corpus-observable, and
saying so is part of keeping this page honest — an unpinned fix is unpinned
whether or not the reason is good. A fourth left this table this revision.

**A fifth row joined on 2026-08-25** and it is not one of the census's ten: the
compiler-owned Result **constructors**, reached through a *sanctioned* specifier.
Both backends closed that fail-open the same day, and **the corpus still cannot
state it** — not because nobody wrote the case, but because the case format
cannot express it. Read that row together with observation gap #13, which carries
the measurements and the three ways out. It is the row to watch alongside the
import-attribute one for the same reason: what a differential oracle cannot say,
it cannot notice changing back.

| fail-open | why no case | where it is pinned instead |
| --- | --- | --- |
| ~~**the Go CLI's default lowering mode ran zero Smithers checks**~~ (`lowering: ""` selected identity, so `smithersc-go file.sm` compiled `.sm` as plain TypeScript and exited 0) | **still no case, and there never can be one**: the runner reaches the fork through `conformance/runner/backend-go.mjs`, which always sends an explicit mode, so every case measures the mode the harness asked for. That is exactly why this one survived at 211/211. | **pinned as of this revision**, outside the corpus: `conformance/runner/selftest.mjs` sends the real bridge four real requests and requires an omitted mode to be refused, an unknown mode to be refused, `"internal"` to report `SMITHERS1510`+`SMITHERS1301` on a two-file program, and `"identity"` to compile that same program clean — which is the consequence of the original defect, measured rather than argued. It also asserts, at the source level, that every request `backend-go.mjs` builds reads the one named `loweringMode` constant. See §21.7. |
| **`weakenUnderivableErrors` shipped enabled**, converting a hard "cannot derive this failure contract" refusal into a silently weaker JSON-value contract | the durable schema-derivation path is not on the corpus compile route | `poc/src/durable/source-compiler.test.ts` and `schema.test.ts` |
| **a prefix match skipped the Action-contract closure check** for any `smthrs/`- or `smithers:`-prefixed specifier, including ones no registry owns | the implementation-contract subsystem is not on the corpus compile route and the fork has no analogue | `poc/src/durable/implementation-contract.test.ts` |
| **neither backend validates import-attribute *keys*** — `with { type: "json", secret: "x" }` compiles clean on both | a **shared** hole is permanently invisible to a differential oracle. It is observable only as a single-backend expectation once a rule is decided, and no rule is decided. | nothing |
| **an authored `.sm` reaching a compiler-owned Result CONSTRUCTOR through a *sanctioned* specifier** — `import { __vsResultSuccess } from "smthrs/context"` on the reference, `import { SmithersOk } from "smithers:exceptions"` on the fork. Both were wide open until 2026-08-25: each backend compiled its own spelling clean and ran it, hand-building both Result variants, so a Result the compiler never constructed at a checked exit carried a failure channel that means nothing. | **closed on both backends, and the corpus still cannot say so.** The two backends' constructors have different NAMES, and one `diagnostics` expectation declares one exact code set — so whichever name a case spells, the other backend answers `TS2305`. Measured both ways; see observation gap **#13**, which also names the three ways to close it and why the cheap one (paired `xfail`s) should be refused. | `compiler/fork_error_brand_test.go`, `poc/src/language/compiler-result-constructors.test.ts` — and, for the **module-edge** half only, `01-result-lifting/the-compiler-owned-prelude-is-not-reachable-by-a-path` and `…/a-star-re-export-of-the-compiler-owned-prelude-is-refused`, which are green on both backends because they deliberately name no constructor. |

The last row is the one to watch. A differential harness is structurally unable
to see a defect both implementations share, and this page's whole "zero
divergences" section is about the *other* blind spot — rules one implementation
has and the other does not. Agreement is not correctness, and the corpus cannot
tell the difference.

## Honest summary

### The headline claim, restated

The previous revision's closing claim was:

> The corpus covers **every locked obligation that has both a source spelling and
> an implementation surface reachable from a `.sm` program**, across 23 areas.

Read quickly, that is a claim about the *language*. Measured, it is a claim about
**23 corpus areas**, and the two are not the same thing. The clause "reachable
from a `.sm` program" was doing all the work and no reader was told how much it
excluded. It is replaced by:

> **Within the 23 differential corpus areas, the corpus covers every locked
> obligation that has a source spelling, an implementation surface in *both*
> backends, and an observation channel the harness can reach.**
>
> That is a claim about `conformance/corpus/` at **438 cases** — the figure sat
> at 260 for two revisions, then 297, 321 and 354 across the three 2026-08-25
> revisions, then 398, 408, 422, 424 and now 438 across 2026-08-26, each time with
> `find conformance/corpus -name '*.expected.json' | wc -l`. **It stood at 354
> for two revisions after it stopped being true**, which is the ordinary fate of
> a hand-maintained number on this page and the reason the command is printed
> beside it: re-derive it, do not read it. It is **not** a
> claim about the language, and it is **not** a claim about the system.
> Specifically, it excludes — and the sections named here now say so:
>
> - the CLI, formatter, and language server (§21) — well tested, never audited
>   here until three revisions ago, and six of eight `SMITHERS_GO_*` envelopes
>   plus three of four resource ceilings still have no test;
> - the bounded portable Wasm backend (10.14) — 4,180 lines, 65 diagnostic codes,
>   **zero** pinned by the corpus, and once described on this page as not
>   existing;
> - `smithers:schema` (§22) — a third compiler-owned virtual module the runner
>   already special-cases, with zero cases;
> - comptime determinism (§19.16) — **two of seven** ambient sources;
> - durable execution (§20) — **six cases against forty normative sentences**,
>   with three of the specification's four compilation phases outside anything
>   this harness can observe;
> - the host-sensitive global classification table (§9.6–9.13) — **two of nine**
>   branches, including the lexical-shadow guard that nothing checks;
> - **five** rejection rules the reference implements, the fork does not, and no
>   case probes (see "Reference-only rejection rules") — four unchanged, and
>   `SMITHERS1708` newly added because the old subtraction command misread two
>   design documents as an implementation;
> - **nineteen rules both implementations spell and no case probes** (see
>   "Rules both implementations have and no case probes"). This bullet said
>   *twenty-seven* for two revisions, which was the pre-correction figure from a
>   method the same section had already replaced — the corrected derivation gave
>   19 and this restatement was never updated with it. Re-derived on 2026-08-26
>   by the requirement-row revision and **still 19**, from a larger intersection
>   (90) and a larger corpus code set (71); re-derived three more times since —
>   round-7 backlog, closure backlog, and the capability-argument revision — and
>   **still 19, the same nineteen codes, four consecutive revisions for four
>   different reasons** (spellings, then a code that landed with its cases, then
>   distance, then *sites*: a rule right at one call site and absent one argument
>   over). **Fourteen of the nineteen are that durable block**, reachable from
>   the phase the corpus does reach;
> - eight of nineteen reference asset-loader rejections (§17.12), with a per-code
>   reason for each;
> - **two codes both implementations spell where they do not mean the same rule**
>   (`SMITHERS4100`, `SMITHERS4117`) — a category a subtraction over code numbers
>   cannot see at all, and one this page had to open this revision;
> - every warning the implementations emit, which the harness filters away before
>   the runner sees it (observation gap #11). One member of the set above,
>   `SMITHERS3006`, is uncoverable for exactly this reason;
> - **six members of `poc/src/targets/classify.ts`'s own hazard log**, which are
>   fail-open by design of the analyzer's boundary and which **no case asserts as
>   correct** — see "Known-uncovered by design" immediately below. Asserting any
>   of them would freeze a fail-open into the contract.
>
> And two exclusions no earlier revision could have written, because nothing had
> looked. **First: a syntactic form neither implementation's corpus coverage
> touched at all.** Three revisions ago, zero of the corpus's `.sm` files
> contained a re-export; writing the first eight found a Go fail-open that
> code-set subtraction could not see, because the fork spelled both of the rules
> it failed to apply. **Second, and this revision's: an entire ANALYSIS the
> corpus never questioned.** Five lanes rewrote the portability classifier and
> not one case pinned any of it; writing nine found four more Go fail-opens of
> exactly the same shape. This page measures *rules*, and a rule can be
> unenforced for a whole **form**, or a whole **analysis**, without any rule
> being missing.

### Known-uncovered by design — six residues no case may assert

`poc/src/targets/classify.ts`'s header hazard log names six shapes where the
portability analyzer **fails open by design of its boundary**, each with a
recorded reason. They are listed here so a reader can see them, and they are
listed *here* rather than in the corpus for one reason: **a passing case
asserting any of them as correct would freeze a fail-open into the contract**,
and it would be the quietest possible way to do it, because such a case is green
and stays green.

| residue | why it stays open |
| --- | --- |
| `[1].map(cb)`, `cbs.forEach(cb => cb())`, `new Map([...]).get("a")!.read()`, `for (const cb of new Set([cb]))` | **one boundary in four spellings, and the intended one.** The body that would run the callback belongs to `Array.prototype` or `Map.prototype`, which is a declaration file: there is nothing to read, and giving it something to read means a table of host knowledge the analyzer exists to refuse. |
| `const i = 0; fns[i]!()` — a non-literal index | exactly ONE element runs and the analyzer cannot say which, so charging all of them would report bodies the program never enters. That is a different rule, not a wider one. |
| `declare const holder: Reader; holder.read()` | no literal and no class anywhere: both of the analyzer's questions genuinely have no answer. |
| `declare const fns: Array<…>; run(...fns)` — a spread whose source is not a list | the spread *of a list* is followed; what is left is the case where nothing decides how many values it contributes. |
| `class Impl { set read(v) { … } }; r.read = 1` — a **setter** | only a property READ runs a get accessor, and nothing owns the write. Measured for the first time in the last lane. |
| module-level **statements** beyond imports | needs a purity judgement the specification does not make: an unread `const pid = process.pid` is dead code a native backend may elide, an unread `readFileSync("x")` is not. |

The corpus does pin the *closed* side of three of these boundaries, which is what
makes the line visible rather than merely asserted: 10.17's pair separates a
callee that invokes from one that stores, 10.15/10.16 separate a deferred
function from one invoked where it is written, and 10.19 pins the load graph that
the module-statement residue sits next to.

### What "zero divergences" does and does not mean

Both backends are at zero divergences and that number is real. It means: **no
case observed the two implementations disagreeing.** It cannot mean the two
implementations agree, because a divergence is only visible where a case exists,
and the five remaining reference-only rejection rules are one shape where one
would hide. Nobody knows which way four of them go, and the scoreboard is built
so that nobody can find out. Fixing that is small: write the program, declare the
reference's code, mark it `xfail go`. Either the marker is the finding or it
retires — or, as `SMITHERS1708` turned out, the fork is right and the case must
not be written at all. All three outcomes make the zero worth more than it is
today.

**Three consecutive revisions have now run that experiment, and the results
compound.** Two revisions ago, twenty-two cases were written for behaviour that
had already been fixed; seventeen came out green, which is the boring and correct
outcome, and five found a live Go fail-open — the re-export gap — which nothing
else could have found. Its twenty-third case found a defect in the **oracle**:
the two backends were being handed different comptime targets. The revision after
that aimed at rules both implementations have; ten of its eleven cases came out
green and the eleventh found a compile-time asset load compiled into a runtime
`import()`.

**This revision aimed at an entire unquestioned analysis, and it is the sharpest
result of the three.** Fifteen cases; **four found live Go fail-opens**, three of
them programs the fork compiles, certifies as native-portable, and runs. Not one
of the four is visible to code-set subtraction, because the fork spells every
code involved. And a sixteenth case was written, measured, and deliberately not
landed, because the evidence said the *reference* was the one with the
limitation.

So the zero is worth more than it was, in five directions: one marker retired
against measured `XPASS` and against an identical message, not merely a code;
four markers added against measured acceptance of programs the language requires
the fork to refuse; five codes that both implementations spell and nothing probed
now pinned, including the gate on the best-covered area on this page; both
subtraction commands corrected, which moved one rule out of "in both" and
nineteen into it; and a set of six analyzer residues written down as
known-uncovered rather than left to be discovered later as green cases. **None of
those moved because a bug was hidden — and the four that are findings moved
because somebody wrote a program, not because anything regressed.**

**The two 2026-08-26 revisions add a sixth direction, and it is the one this
section did not have a name for: a rule both backends now get *right* whose
corpus evidence covered only the spelling on which a wrong rule and a right rule
agree.** The fork's foreign property rule stated in its own comment that it asked
the receiver's provenance and in fact asked the member's declarations. Every
existing case read a declared member off a foreign value, where the two readings
give the same verdict, so the corpus was green over the disagreement for as long
as it existed and would have stayed green over it indefinitely. It surfaced from
reading the code, not from running the corpus — and the fix, once made, still had
nothing pinning its central claim until three cases were written for the
spellings the two readings answer differently. **`0 divergent` is silent about a
rule whose only cases sit where every candidate rule agrees.** That is a
different blind spot from a missing case and from an unprobed code: the code is
spelled by both, a case exists, it passes, and it observes nothing about the
question. The countermeasure is the one used here — when a rule is stated as
*which question it asks*, write the case that a differently-phrased question
would answer differently, and keep it after the fix lands.

Every uncovered entry above is one of five things, and each row says which.

1. **A rule the specification itself marks Open or Direction** — nested Optional
   normalization (6.14), Layer merge/override precedence and the declaration
   encoding (8.16–8.18), `@throws` overload *semantics* (7.16), the native pin's
   *spelling* (10.7), dynamic-feature classification (10.11), assertion
   semantics (10.12), the native-portable Promise subset (11.12), nested label
   selection (13.20), cleanup composition (14.8), the loader **registration API**
   (17.4), and the Markdown/MDX **module shapes** (17.3). Testing these would
   invent language.
2. **A locked feature with no implementation surface** — the native/LLVM backend
   (10.13), and only that. The previous revision put "and Wasm" in this
   category and was wrong; 10.14 records what actually exists.
3. **A surface no case can reach** — the concurrency library (11.10, 11.11,
   module resolution); the Wasm backend (10.14, reachable in principle and
   one-sided in practice); `smithers:schema` (§22); the reference-only rejection
   rules; eight asset rules (§17.12); the host-global branches (§9.6–9.13); the
   comptime determinism siblings (§19.16); and most of §20. **This category is
   much larger than two revisions ago**, which named one library. Note that
   "no case can reach" is not the same as "nothing can reach": §21.7 is the
   worked example of moving one item out of this category by asserting it
   somewhere the corpus is not.
4. **A property the harness cannot observe** — requirement row text (8.5),
   cross-realm Error transport (5.11), host-conditional async Layer scope (8.15),
   foreign-owned background work (12.7), **all warnings** (gap #11), cache
   identity and incremental behaviour (19.22, 19.30, 19.31), the uncompiled-
   execution guards (19.9, 20.7), and durable phases 2–4 (§20.23).
5. **A surface this instrument is the wrong tool for** — the CLI, formatter, and
   LSP (§21). Named here so a reader knows it was considered and why there is no
   corpus area, not omitted so a reader assumes there is nothing to consider.

### Is the corpus a census of the locked language?

**For the locked semantic core that both implementations share — yes**, and that
is not a small thing. Result lifting, propagation, nominal errors, optionals,
requirement rows, layers, must-consume, expression control flow, cleanup,
cross-module rows, retired syntax, the `TypeScript` requirement, and the native
pin are genuinely and differentially measured, and the corpus has repeatedly
found real defects in both implementations rather than ratifying either.

**For the locked feature set — no**, and successive revisions have moved that
answer further from yes, by measuring more of what was never measured rather
than by anything regressing. Durable execution is six cases against forty
sentences. Comptime determinism is two of seven. Host-global classification is
two of nine. A 4,180-line Wasm backend has no case and was once described here
as nonexistent. And "feature complete" is not true on the specification's own
terms: `compatibility.mdx:60` makes an LLVM near-native target a **MUST** and
there is no LLVM anywhere in the source tree.

That is the honest shape of the remainder: **a well-measured semantic core, a
much larger unmeasured periphery than this page used to admit, four open
questions that make specific cases unwritable, five places a fail-open could be
hiding right now (reference-only), nineteen more where one could hide in
either implementation at once (both-implementations), two codes where the two
implementations do not even mean the same rule, six analyzer residues that are
fail-open by design and that no case may assert, four places a fail-open is not
hiding but recorded (the `xfail go` markers), and one Locked backend that does
not exist.**

Two closing cautions, because they are the most transferable things these
revisions learned.

**A stable number is not a safe number.** Every fail-open an accepted-surface
census found had been closed before a single case existed for it, and the corpus
reported `211/211` agreement throughout — before the fixes and after them,
unchanged. A contract that does not move when a defect is introduced and does
not move when it is removed is not measuring that defect at all. The number to
distrust is not a low one; it is a stable one.

**And a differential oracle is blindest where the two implementations agree.**
Its natural instinct is to look for rules one side has and the other does not,
because that is the set it can subtract. But the dangerous set is the one where
both sides have the rule and nothing asks either of them about it: there, the
scoreboard reports perfect agreement whether the rule is enforced, half
enforced, or gone. Twenty-seven codes are in that set today. Two more were in it
two revisions ago — and this page recorded them as covered.

**A third caution, from this revision, and it is about this page rather than
about the corpus.** Both of the subtractions above are computed by a command, and
for three revisions one of those commands was wrong in both directions at once:
it read design prose as implementation and could not see a code the
implementation builds by concatenation. The totals it produced were stable, and
stability is exactly what made them look trustworthy. **Re-deriving a number with
a wrong command is not re-derivation; it is re-assertion.** The remedy is in the
section itself: run the *diff* between the old method and the new one, not the
totals — a total can be wrong by nineteen in one direction and one in the other
and still look like it barely moved.

**A fourth, from the same revision, and it is the one to carry furthest.** Every
finding here came from writing a program for an analysis nobody had ever
questioned. The rules were spelled by both implementations. The scoreboard said
245/245 with zero divergences and had said something like it all day. The four
fail-opens were not introduced and were not hidden; they were simply never
asked about. **The corpus does not measure what the implementations do. It
measures what somebody thought to ask.**
