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
>
> Retained and unaffected: the checked `panic` channel on unannotated foreign
> calls, and Zig/Rust imports through generated Wasm bindings. Where this document
> and the specification disagree, the specification wins.

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

## What this page audits, and what it does not

Read this before any verdict below.

Sections §1–§20 measure **one thing**: the differential `.sm` conformance corpus
in `conformance/corpus/`, 260 cases across 23 areas, run through two backends.
That is a narrow instrument. It observes a `.sm` program's stdout and its
**error**-severity diagnostics, and nothing else.

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

Corpus size: **260 cases across 23 areas** (245 before this revision, 234 before
that, 211 before that, 196 before that). Per-area counts, re-measured with
`for d in conformance/corpus/*/; do echo "$(basename $d) $(ls $d*.expected.json | wc -l)"; done`:

| area | cases | | area | cases | | area | cases |
| --- | ---: | --- | --- | ---: | --- | --- | ---: |
| 01-result-lifting | 20 | | 09-foreign-calls | 27 | | 17-durable | 6 |
| 02-unwrap-propagation | 8 | | 10-defer | 9 | | 18-typescript-requirement | 5 |
| 03-optionals | 16 | | 11-expression-if-switch | 17 | | 19-retired-syntax | 13 |
| 04-nominal-errors | 13 | | 12-labeled-block-values | 7 | | 20-host-globals | 4 |
| 05-context-rows | 7 | | 13-loop-values | 6 | | 21-native-pin | 27 |
| 06-layers | 7 | | 14-conditional-declarations | 6 | | 22-source-text-fidelity | 3 |
| 07-must-consume | 11 | | 15-generic-rows | 6 | | 23-asset-imports | 22 |
| 08-promise-chaining | 10 | | 16-comptime | 10 | | **total** | **260** |

Supporting files, re-measured: **23** `*.mod.sm` auxiliary modules (17 before),
**8** `conformance/support/*.ts` foreign modules, **8** `conformance/assets/*`
staged files, **6** `conformance/interop/*.ts`.

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

### What this revision changed

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

### What the revision before that changed

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

### What the revision two before that changed

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

### What the revision three before that corrected

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

### What changed in the revision four before that

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
| `SMITHERS1105` | a constructor or accessor carrying a Result channel | `poc/src/language/semantic.ts:2038` | no | no | `failures.mdx` §Compiler Lifting requires a reachable recoverable Error exit to return or infer a Result; `type-system.mdx` §Fallibility Inference says the compiler MUST reject the function "rather than permit an untyped exception path". Neither page carves out constructors or accessors. If the fork lifts neither and rejects neither, that is exactly the untyped exception path the spec forbids by name. |
| `SMITHERS1106` | a fallible generator | `poc/src/language/semantic.ts:2041` | no | no | same rule, same direction. One case in the whole corpus contains `function*` and it is not fallible. |
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

```sh
comm -12 /tmp/ref-codes /tmp/fork-codes > /tmp/both-codes   # 104
comm -23 /tmp/both-codes /tmp/corpus-codes                  #  27
```

The reference and the fork spell **104** codes in common (recorded as 85 last
revision, by the wrong command). The corpus declares 77, and **all 77** are in
that intersection — last revision's odd one out, `SMITHERS5218`, is in the fork
now, which is why its marker retired. So 104 − 77 = **twenty-seven** codes are in
both implementations and in no case:

```
SMITHERS1901 SMITHERS1902 SMITHERS3006
SMITHERS4100 SMITHERS4103* SMITHERS4104 SMITHERS4105 SMITHERS4107 SMITHERS4108
SMITHERS4109 SMITHERS4110 SMITHERS4111 SMITHERS4112 SMITHERS4113 SMITHERS4115
SMITHERS4116 SMITHERS4117 SMITHERS4118 SMITHERS4119 SMITHERS4120 SMITHERS4121
SMITHERS4122 SMITHERS4123 SMITHERS4199
SMITHERS5215 SMITHERS5216 SMITHERS5217
```

*`SMITHERS4103` left the set this revision and is listed above only so the shape
of the durable block is readable; the machine-computed set is the other 26.

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
| `4104`, `4105`, `4107`–`4113`, `4115`, `4116`, `4118`–`4123`, `4199` | the rest of the durable template-compilation subset | `poc/src/durable/source-compiler.ts`; `compiler/forkbridge/durable.go.txt` | **the largest single block in this table, and newly visible.** Nineteen codes both implementations spell, none probed. They are reachable from phase 1, which is the phase the corpus does reach — see §20's closing paragraph, which names 20.8/20.9/20.11/20.13/20.14/20.21/20.25 as the obligations behind them. This is where the next revision buys the most. |
| `SMITHERS5215` | one path being both a compiler asset module and an authored/runtime code module | `poc/src/build/source-assets.ts:1150`, `:1161`, `:1198`, `:1328` | **measured a revision ago and deliberately not landed.** Reachable on the reference — a `.ts` file staged through the `assets` channel and also imported as code reports `SMITHERS5215@1:20` — but the fork reports `SMITHERS5209` at the same position instead ("asset must be a staged regular file beneath the project root"). Whether that is a fork defect or a consequence of the two-kinds wire protocol (gap #3: an asset crosses as `"typescript"`, so the fork cannot tell a staged asset from a staged code file) **cannot be decided from the conformance side**. Re-checked this revision: unchanged. |
| `SMITHERS5216` | a generated asset identity colliding with a real path | `poc/src/build/source-assets.ts:1282` | **not writable.** Requires a real file at `.smithers-generated/assets/<digest>.ts` inside the project root; the staged path is derived from the asset's content digest, so a case would have to hard-code a digest and would break the moment the fixture's bytes changed. |
| `SMITHERS5217` | a generated-module construction failure | `poc/src/build/source-assets.ts:1291` | **not usefully writable.** It carries a third party's exception text and is reached only when `generatedModule(build)` throws, which the built-in loaders do not do for any input a case can stage. The neighbouring `SMITHERS5213` covers the reachable half of "the loader failed" and is pinned. |

**Nineteen of the twenty-seven are the durable template-compilation block**, and
they are writable today in the sense that the corpus reaches the phase that emits
them. Three of the remaining eight are uncoverable by construction (`1901`,
`1902`, `3006`), three are unwritable for a recorded mechanical reason (`5215`,
`5216`, `5217`), and two — `4100` and `4117` — are the new category this revision
had to open: **codes both implementations spell where the two implementations do
not agree on what the code means.** A subtraction over code *numbers* cannot see
that, and it is the next thing this page's method will have to grow.

---

## 1. Identity and compatibility

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 1.1 | Smithers source uses `.sm` | DECISIONS Locked | covered | structural: the corpus is `.sm` only and the Go bridge rejects anything else |
| 1.2 | `.sm` uses a TypeScript-derived grammar with only documented differences | compatibility.mdx §Source Relationship | covered | the whole corpus; `conformance/interop/*` pins the `.ts` side; **`22/non-ascii-string-content-round-trips`** pins that source text outside ASCII survives lowering |
| 1.3 | `.ts`/`.tsx`/JS keep their own complete syntax and behavior when imported | compatibility.mdx §Source Relationship | covered | `interop/*` (6 files), all of `09-foreign-calls` |
| 1.4 | shared syntax keeps TypeScript behavior unless a divergence is documented | compatibility.mdx §Source Relationship, DECISIONS Locked | covered | `11/statement-switch-keeps-typescript-fallthrough` (TS2678), `11/statement-switch-fallthrough-over-a-widened-scrutinee`, **`19/retired-clause-words-in-type-positions-stay-ordinary`** (`?:`, `??`, `?.` keep their TypeScript meaning) |
| 1.5 | adding expression forms MUST NOT reinterpret an existing TypeScript statement | control-flow.mdx §Existing TypeScript Forms | covered | `11/statement-if-is-not-reinterpreted-as-an-expression`, `11/statement-switch-fallthrough-over-a-widened-scrutinee`, **`19/retired-operator-words-as-members-stay-ordinary`** |
| 1.6 | TypeScript escape hatches stay available on the TypeScript target | compatibility.mdx §Source Relationship, DECISIONS Locked | covered | `18/any-is-usable-and-not-forbidden`, `18/eval-is-usable-and-not-forbidden` |
| 1.7 | **the retired-grammar sweep is a grammar rule, not token adjacency** | poc README ("Recognition is a **grammar** property"); compatibility.mdx §Source Relationship | covered | **`19/retired-operator-words-as-members-stay-ordinary`**, **`19/retired-clause-words-in-type-positions-stay-ordinary`** — the other half of §16. Nine cases pin that each retired form *is* rejected; these two pin that ordinary TypeScript reusing those words is *not* claimed, which is the false-positive direction a textual sweep fails in. |

## 2. Function model and Result lifting

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 2.1 | a fallible function returns `Result<A, E>`; a fallible async one `Promise<Result<A, E>>` | failures.mdx §Result Model | covered | `01/inferred-result-for-an-unannotated-function`, `08/async-unwrap-propagates-across-await` |
| 2.2 | `return value` produces the success variant | failures.mdx §Compiler Lifting | covered | `01/return-lifts-into-success` |
| 2.3 | `throw error` produces the error variant and exits | failures.mdx §Compiler Lifting | covered | `01/throw-lifts-into-failure` |
| 2.4 | returning an existing compatible Result preserves it without nesting | failures.mdx §Compiler Lifting | covered | `01/returning-an-existing-result-preserves-it`, `03/nested-result-normalization-is-rejected` |
| 2.5 | `Result.ok` / `Result.err` are not authoring API | failures.mdx §Compiler Lifting | covered | `01/result-ok-is-not-an-authoring-constructor` |
| 2.6 | `Optional.some` / `Optional.none` are not authoring API | type-system.mdx §Optional | covered | `03/optional-some-is-not-an-authoring-constructor` |
| 2.7 | a function with no fallible path is not wrapped in a Result | failures.mdx §Compiler Lifting; compatibility.mdx §TypeScript Target | covered | `01/plain-function-keeps-javascript-throw`, `08/infallible-async-returns-a-plain-promise` |
| 2.8 | an explicit non-Result annotation over a reachable Error exit is a compile error | failures.mdx §Compiler Lifting; type-system.mdx §Fallibility Inference | covered | `01/contract-omits-reachable-failure`, `19/bang-return-marker-is-retired` |
| 2.9 | public/abstract/declaration-only contracts spell `Result` directly | failures.mdx §Inference | covered | `01/exported-fallible-needs-result-contract` |
| 2.10 | `E` is inferred from throws, unwraps, returned Results, foreign boundaries | type-system.mdx §Fallibility Inference | covered | `01/inferred-result-for-an-unannotated-function`, `02/unwrap-joins-two-error-types-into-one-row`, `09/untrusted-foreign-call-charges-panic` |
| 2.11 | a recoverable `throw` value must extend `Error` | failures.mdx §Error Classes | covered | `01/throw-must-extend-error` |
| 2.12 | a top-level `throw` cannot be represented as a checked Result | poc README SMITHERS1511 | covered | `01/top-level-throw-is-rejected` |
| 2.13 | no `throws` clause, `!T`, prefix `try`, or postfix recovery grammar | failures.mdx §Inference; DECISIONS Locked | covered | `19/throws-clause-is-retired`, `19/bang-return-marker-is-retired`, `19/prefix-try-marker-is-retired`, `19/postfix-catch-expression-is-retired` |
| 2.14 | no throw-expression grammar in the initial scope | control-flow.mdx §Throw Statements; DECISIONS Locked | covered | `19/throw-is-not-an-expression` |
| 2.15 | **functions remain ordinary and eager: no `Effect` value, interpreter, or `.run()`** | DECISIONS Locked; type-system.mdx §Function Type | covered structurally | every output case calls its functions directly and prints the result; nothing in the corpus interprets a description of work |
| 2.16 | **a fallible constructor or accessor**: the lifting rule carves out neither | failures.mdx §Compiler Lifting; type-system.mdx §Fallibility Inference ("MUST reject the function rather than permit an untyped exception path") | **uncovered** | The reference rejects with `SMITHERS1105` (`poc/src/language/semantic.ts:2038`). The fork's code set has neither code (`grep -roh 'SMITHERS[0-9]\{4\}' compiler/`), and `compiler/forkbridge/lowering.go.txt:2264-2275` implements the `SMITHERS1101/1104/1102` siblings in one block with no 1105 next to them. 79 corpus cases declare a `constructor(` and **none of them is fallible** (`grep -rl 'constructor(' conformance/corpus/ --include='*.sm' \| wc -l`). See "Reference-only rejection rules". |
| 2.17 | **a fallible generator** | same | **uncovered** | The reference defers it explicitly with `SMITHERS1106` (`poc/src/language/semantic.ts:2041`); the fork has no such code. `grep -rln 'function\*\|yield ' conformance/corpus/ --include='*.sm'` returns **nothing**: no case in the corpus contains a generator at all, fallible or not. |

## 3. Result combinator surface

failures.mdx §Matching and Transformation requires operations equivalent to
`isOk isError match map mapError andThen recover tap tapError unwrap unwrapOr all`.
Every member has a case.

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 3.1 | `match` requires both success and error branches | failures.mdx §Matching | covered | `01/result-match-requires-both-branches` (TS2345, reached through the emit-check stage) |
| 3.2 | `map` / `andThen` / `recover` preserve or combine the error type | failures.mdx §Matching; type-system.mdx §Result Composition | covered | `01/result-transformations-preserve-the-error-type` |
| 3.3 | `mapError` rewrites the error channel | failures.mdx §Matching | covered | `01/result-map-error-rewrites-the-error-channel` |
| 3.4 | `tap` / `tapError` observe without changing the Result | failures.mdx §Matching | covered | `01/result-tap-and-tap-error-observe-without-changing` |
| 3.5 | `isOk` / `isError` inspect the variant | failures.mdx §Matching | covered | `01/result-is-ok-and-is-error` |
| 3.6 | `unwrapOr` extracts with a fallback | failures.mdx §Matching | covered | `01/result-transformations-preserve-the-error-type` |
| 3.7 | `Result.all` collects, and reports the first error | failures.mdx §Matching | covered | `01/result-all-collects-and-stops-at-the-first-error` |
| 3.8 | `Result.try` / `Result.tryPromise` adapt a throwing/rejecting body, retaining Panic | poc README; failures.mdx §Foreign Exceptions | covered | `01/result-try-adapts-a-throwing-body`, `01/result-try-promise-adapts-a-rejecting-body` |
| 3.9 | `expect` converts the error variant into a panic on the enclosing channel | failures.mdx §Propagation; poc README | covered | `01/expect-charges-the-panic-channel` |
| 3.10 | **`expect` at a non-Result boundary is visually distinct in diagnostics** | failures.mdx §Propagation; poc README SMITHERS1505 | covered | `01/top-level-expect-is-rejected` — the go marker is **retired**; the fork used to accept and run this program |
| 3.11 | ordinary Result recovery MUST NOT swallow panic implicitly | failures.mdx §Foreign Exceptions | covered | `09/recover-does-not-swallow-a-panic` |
| 3.12 | exhaustive recovery MAY remove handled members from `E` | type-system.mdx §Result Composition (MAY) | covered as a MAY | `01/result-transformations-preserve-the-error-type` |

## 4. Propagation (`unwrap`)

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 4.1 | `unwrap` yields the success value or propagates the error variant | failures.mdx §Propagation | covered | `02/unwrap-returns-the-error-variant`, `02/unwrap-stops-at-the-first-failure` |
| 4.2 | the unwrapped Result's error type joins the enclosing `E` | failures.mdx §Propagation | covered | `02/unwrap-joins-two-error-types-into-one-row` |
| 4.3 | the emitted error path returns rather than throwing | failures.mdx §Propagation | covered | `02/unwrap-stops-at-the-first-failure`, `10/errdefer-runs-on-unwrap-propagation` |
| 4.4 | `unwrap` needs an enclosing Result-returning function | failures.mdx §Propagation | covered | `02/unwrap-at-top-level-is-rejected`, `02/unwrap-in-a-non-result-owner-is-rejected` |
| 4.5 | an unwrap whose early return would bypass a `catch` is rejected | poc README SMITHERS1205 | covered | `02/unwrap-inside-try-with-catch-is-rejected` |
| 4.6 | an unwrap in an order-unpreservable expression is rejected | poc README SMITHERS1204 | covered | `02/unwrap-in-a-compound-expression-is-rejected` |
| 4.7 | an unwrap in a loop header is rejected | poc README SMITHERS1703 | covered | `02/unwrap-in-a-loop-header-is-rejected` |

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
| 5.9 | handler selection uses compiler-stable nominal identity, not a name or `_tag` | failures.mdx §Error Prototype | covered | `04/same-named-errors-in-two-modules` |
| 5.10 | two same-named Error classes in one module cannot both get a stable identity | poc README SMITHERS1150 | covered | `04/duplicate-error-class-name-is-rejected` |
| 5.11 | serialization evidence and cross-realm transport metadata | failures.mdx §Error Classes | **unwritable** | the harness observes stdout and diagnostics from a single realm. A case would have to serialize an Error, cross a realm boundary, and read the nominal identity back. Closing this needs a corpus expectation kind for a two-realm program (worker or subprocess) on both backends. `poc/src/language/qualified-rows.test.ts` covers the identity round trip as a unit test. |

## 6. Optionals

type-system.mdx §Optional requires `isSome isNone match map andThen filter tap
unwrap unwrapOr toResult toNullable all`. Every member has a case.

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 6.1 | `return value` → present; `return null`/`undefined` → absent | type-system.mdx §Optional | covered | `03/return-lifts-into-optional` |
| 6.2 | **an existing compatible Optional is returned without nesting** | type-system.mdx §Optional | covered | **`03/returning-an-existing-optional-preserves-it`** — the third clause of the lifting rule, and the one a lifter gets wrong by symmetry with the first two |
| 6.3 | `match` / `map` / `andThen` / `unwrapOr` | type-system.mdx §Optional | covered | `03/optional-methods` |
| 6.4 | `filter`, `tap`, `isSome`, `isNone` | type-system.mdx §Optional | covered | `03/optional-filter-tap-and-predicates` |
| 6.5 | `toResult(error)` converts absence into a Result error | type-system.mdx §Optional | covered | `03/optional-to-result-converts-absence` |
| 6.6 | `Optional.all` collects | type-system.mdx §Optional | covered | `03/optional-all-collects-and-stops-at-the-first-absence` |
| 6.7 | `Optional.fromNullable` / `toNullable` interop | DECISIONS Locked; type-system.mdx §Optional | covered | `03/optional-nullable-interop` |
| 6.8 | `unwrap` propagates absence from an Optional owner, and fails closed without one | poc README SMITHERS1206 | covered | `03/optional-unwrap-propagates-absence`, `03/optional-unwrap-needs-an-optional-owner` |
| 6.9 | combined types lift outside in (`Result<Optional<A>, E>`): plain `A`, nullish, Error throw | DECISIONS Locked; type-system.mdx §Optional | covered | `03/result-optional-lifts-outside-in`, `03/optional-unwrap-in-a-result-optional-owner` |
| 6.10 | **and an existing Optional becomes the Result success rather than being re-wrapped** | type-system.mdx §Optional | covered | **`03/result-optional-accepts-an-existing-optional`** — the clause of the outside-in rule where the returned expression matches the *inner* layer |
| 6.11 | Optional absence stays distinct from a Result error | DECISIONS Locked | covered | `03/optional-to-result-converts-absence`, `03/optional-unwrap-needs-an-optional-owner` |
| 6.12 | Optional composes with async (`Promise<Optional<T>>`) | type-system.mdx §Async Values + §Optional | covered | `03/optional-across-an-await` |
| 6.13 | TypeScript optional parameters/properties keep their TypeScript meaning | DECISIONS Locked; type-system.mdx §Optional | covered | `03/typescript-optionals-keep-their-meaning`, **`19/retired-clause-words-in-type-positions-stay-ordinary`** |
| 6.14 | nested Optional normalization and additional implicit conversions | DECISIONS **Open**; type-system.mdx "remain open" | unwritable | **blocked on an Open decision.** The ledger records this as item 3 of its own unresolved-design-work list; there is no rule to pin. |

## 7. Foreign boundaries and the panic channel

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 7.1 | calling any unannotated foreign value adds the checked `panic` case | failures.mdx §Foreign Exceptions | covered | `09/untrusted-foreign-call-charges-panic` |
| 7.2 | a caller must propagate, catch, or adapt that panic | failures.mdx §Foreign Exceptions | covered | `09/untrusted-foreign-call-needs-the-panic-channel` |
| 7.3 | `@throws {never}` is a trusted opt-out from the *panic case* | failures.mdx §Foreign Exceptions | covered | `09/trusted-foreign-call-is-accepted`; **`21/a-pin-reaching-a-trusted-foreign-call-is-rejected`** pins that it is not an opt-out from the *requirement* |
| 7.4 | `@throws {T}` declares the stated channel, honoured case | failures.mdx §Foreign Exceptions | covered | `09/declared-foreign-throws-is-exposed` |
| 7.5 | a violated `@throws {T}` claim still lands in Panic | failures.mdx §Foreign Exceptions; DECISIONS Locked; poc README | covered | `09/declared-foreign-throws-violated-stays-panic` — **the long-standing JS xfail here is retired**; both backends now deliver the violated claim as the Panic member of the declared channel |
| 7.6 | Promise rejection at an unannotated boundary becomes panic | failures.mdx §Promise Semantics | covered | `09/foreign-rejection-becomes-panic`, `01/result-try-promise-adapts-a-rejecting-body` |
| 7.7 | a statically imported foreign module needs a module-initialization trust claim | poc README SMITHERS1510 | covered | `09/foreign-module-without-a-trust-marker` |
| 7.8 | the module trust claim never doubles as a function-level opt-out | poc README; compatibility.mdx §Runtime TypeScript Dependency; failures.mdx:115 | covered | **`09/module-init-trust-is-not-a-function-level-throws-claim`** is the direct pin: `support/module-init-only.ts` writes ONLY the documented `/** @module @throws {never} */` header, immediately above a first export that always throws, and the throw must still be delivered as a Panic. That header is the trigger — the specification's own happy path — because a file-leading JSDoc is also the leading trivia of the first statement, so an implementation that reads `@throws` from that trivia without excluding the `@module` claim certifies a throwing function. `09/untrusted-foreign-call-charges-panic` keeps the weaker form (an unannotated export of the trusted `support/foreign.ts` still charges Panic). |
| 7.8b | **the trust marker's grammar is exact: `@module` has a boundary, and `@throws {never}` is not assembled across a JSDoc decoration** | compatibility.mdx §Runtime TypeScript Dependency; failures.mdx:115 | covered | **`09/near-miss-trust-markers-do-not-confer-module-trust`** (both near misses, two `SMITHERS1510`s, one case) and its acceptance control **`09/a-multiline-module-trust-header-is-honoured`**, which is the ordinary multi-line spelling and must keep compiling. Written as a pair deliberately: the obvious way to refuse a split marker is to require the two tags to be adjacent, which would refuse every real header. |
| 7.9 | a foreign property/accessor read needs an annotated adapter | poc README SMITHERS1506 | covered | `09/foreign-property-read-needs-an-adapter` |
| 7.10 | a foreign constructor is not lowerable without `@throws {never}` | poc README SMITHERS1504 | covered | `09/foreign-constructor-needs-throws-never` |
| 7.11 | a callback escaping into foreign code is rejected | poc README SMITHERS1509; requirements.mdx §Scoping | covered | `09/callback-escaping-into-foreign-code-is-rejected` |
| 7.12 | `panic` is imported from `smithers:exceptions` and accepts a message or Error | failures.mdx §Foreign Exceptions | covered | `09/explicit-panic-charges-the-channel` |
| 7.13 | `Reflect.panic` enters the same distinguished channel | DECISIONS Locked; failures.mdx §Foreign Exceptions | covered | `09/reflect-panic-enters-the-panic-channel` |
| 7.14 | ordinary `try/catch` stays valid and does not change the Result contract | failures.mdx §JavaScript try/catch | covered | `01/plain-function-keeps-javascript-throw`, `09/try-catch-does-not-change-the-result-contract` |
| 7.15 | **module trust is exact: a package merely *starting* with the intrinsic letters is foreign** | poc README ("Prefixes do not confer trust") | covered | **`09/a-bare-package-with-the-intrinsic-letters-is-foreign`**. The previous revision recorded this as unwritable on the grounds that a bare specifier cannot resolve in the harness's flat staging tree; that reason was wrong. `SMITHERS1510` is decided lexically from the specifier, so the rule is reached before resolution matters. Inspecting rather than calling the binding keeps the case to the one diagnostic. |
| 7.16 | overload / declaration-merging / generic / multiple-tag `@throws` rules | DECISIONS **Direction**; failures.mdx:115 "remain open" | unwritable | **blocked on an Open decision.** The *semantics* are undecided. See 7.18: the *refusal to honour an unreifiable claim* is not undecided, and it is uncovered for a different reason. |
| 7.17 | foreign factory/result invoked before an expression-safe unwrap (`SMITHERS1507`); executable foreign provenance escaping a higher-order/return/store boundary (`SMITHERS1508`) | poc README:125, :127; the Locked rule behind both is failures.mdx:111 | **covered** | Two revisions of history on this one row, and it is the reason the section above exists. Two revisions ago it said "**partial**: both fire and are *observed* in the corpus, but only as cascade members inside other cases" — false, because `judge.mjs` requires a satisfied diagnostics expectation to compare the **same number** of diagnostics, so an undeclared cascade member fails a case rather than riding inside it. The previous revision corrected it to **uncovered** and moved both codes into "Reference-only rejection rules". Then both were ported into the fork, which removed them from *that* table too — leaving two rules present in both implementations, probed by nothing, and visible to neither subtraction this page performed. **This revision writes the cases.** See 7.20–7.22 for the four refusals and two acceptance controls. `grep -rl '"code": "SMITHERS150[78]"' conformance/corpus/ \| wc -l` → **4**. |
| 7.20 | **an untrusted foreign call's result may not be consumed where the lowered `Result` cannot go** (`SMITHERS1507`) | failures.mdx:111 (Locked) "Calling any TypeScript, JavaScript, or other foreign runtime implementation MUST add the distinguished checked `panic` case by default"; compatibility.mdx:24 "The caller must propagate, explicitly catch, or safely adapt that channel" | **covered** | Both branches of the lowerability predicate (`poc/src/language/semantic.ts:2110`), one case each, because an implementation can lose either without losing the other. `09/a-foreign-factory-result-invoked-before-it-is-unwrapped-is-rejected` is the `!stableCallee` branch — `makeParser()(text)`, where lowering would place a `Result` in **callee** position; its single declared diagnostic is load-bearing, because the inner factory call is at the same authored position and a backend that charged it too would be observable. `09/an-untrusted-foreign-result-used-in-an-expression-is-rejected` is the `unsafeUse` branch — `parseIntegerUnchecked(text) + 1` — and declares `SMITHERS1301` alongside `SMITHERS1507` deliberately: the must-consume diagnostic is the compiler demonstrating that it really did produce a `Result` there. |
| 7.21 | **executable foreign provenance may not leave the checked scope** (`SMITHERS1508`) | poc README:127; the same failures.mdx:111 MUST, read at a site where there is no call to attach the channel to | **covered** | Two of the four emission sites. `09/a-foreign-callable-escaping-through-a-local-higher-order-call-is-rejected` is the argument site: the foreign function is never called in the module at all, it is invoked through a *parameter*, which has no foreign origin to follow (`semantic.ts:2329-2357`), so the throw would cross the declared `Result<number[], Panic>` with no boundary anywhere on the path. `09/returning-a-foreign-callable-is-rejected` is the return site, and declares `Result<(text: string) => number, Panic>` on purpose: a `Result` around a callable wraps its *delivery*, not its later invocation, so declaring one does not discharge the rule. The mutable-alias and assignment sites (`semantic.ts:1203`, `:1252`) are **uncovered**. |
| 7.22 | the remedies both diagnostics prescribe are reachable, and the channel they protect is real | the message text of `SMITHERS1507` and `SMITHERS1508` | **covered** | `09/a-foreign-factory-result-bound-to-a-local-is-accepted` and `09/a-foreign-callable-wrapped-in-a-local-adapter-is-accepted`. Both are `output` cases and both print `panic` on their second line, so they show the throw arriving as the distinguished checked panic case after crossing the boundary the refusal case was refused for. Without them a rule that refused *every* foreign factory call, or *every* callable argument, would satisfy 7.20 and 7.21 exactly and the corpus could not tell it from a correct one. |
| 7.18 | **a foreign `@throws {T}` claim the compiler cannot reify to one imported Error constructor is refused** | failures.mdx:115 (`@throws {T}` annotations "are trust claims and MUST remain visible in declarations and tooling") | **covered** | **`09/the-never-annotation-is-case-sensitive`**. Previously uncovered, and previously reference-only. Both halves moved: the fork now emits `SMITHERS1502`, and the case pins the sharpest instance of the rule — `@throws {Never}` is not the lowercase opt-out, so it is a declared channel naming a class that is not in scope, and it is refused (`SMITHERS1502`) with the call keeping its panic policy (`SMITHERS1301`). A case-insensitive comparison accepts the same source with no diagnostic at all and certifies the function infallible, which is the fail-open direction on the trust boundary. Still **not** blocked by 7.16's Open decision: what is open is which channel an overloaded or generic annotation produces, not whether an unreifiable one may be believed. |
| 7.19 | **a re-export is a module edge and carries the same initialization trust claim an import does** | compatibility.mdx §Runtime TypeScript Dependency (Locked) | **covered, both backends** | **`09/a-re-exported-foreign-module-still-needs-a-trust-marker`** — the first corpus case in any area to contain a re-export. It carried an `xfail go` marker for one revision: the fork compiled and ran the program because it never examined an export declaration. The fork's `staticRuntimeModuleEdge` now owns runtime export declarations, the marker was measured `XPASS` and retired, and the retirement is recorded in the case's own `notes`. |
| 7.23 | **`panic(...)` is an exit and not a value: a placement the compiler cannot lower is refused rather than guessed at** (`SMITHERS1503`) | failures.mdx:113 (Locked) "A caller MUST propagate panic, explicitly catch it, or use a trusted adapter"; the POC narrows the lowerable placements | **covered** | **`09/panic-outside-a-statement-or-return-is-rejected`**, green on both. A POC lowering boundary rather than a specification sentence, pinned because an unpinned boundary is one the other implementation can put somewhere else. Its accepted twin is 7.12's `09/explicit-panic-charges-the-channel`, which uses the supported expression-statement placement, so the pair separates the *channel* rule from the *placement* rule. It also produced this revision's one measured backend wording difference: the two implementations spell this diagnostic's message with one word between them, which is why the case declares no `messageContains`. |

## 8. Requirements, capabilities, and layers

| # | obligation | source | status | cases |
| --- | --- | --- | --- | --- |
| 8.1 | a capability is an abstract class extending `Context`, declared with ordinary class syntax | requirements.mdx §Capability Identity | covered | every `05/*` and `06/*` case; `19/uses-clause-is-retired` pins the absence of a separate declaration form |
| 8.2 | `Capability.context()` adds the class to the enclosing `R` row and returns its instance type | requirements.mdx §Context Access | covered | `05/context-requirement-is-satisfied` |
| 8.3 | requirement inference is transitive through ordinary calls | requirements.mdx §Inference | covered | `05/requirement-propagates-through-callers`, `05/one-layer-satisfies-a-capability-required-through-many-paths` |
| 8.4 | requirements propagate across module boundaries | requirements.mdx §Inference; poc README | covered | `05/requirement-propagates-across-modules` |
| 8.5 | duplicate nominal requirements collapse | requirements.mdx §Inference | **partial** | `05/one-layer-satisfies-a-capability-required-through-many-paths` pins the observable consequence (one provider satisfies every route). Row de-duplication itself is row text — see "Known observation gaps" #1. |
| 8.6 | two structurally identical Context subclasses stay different requirements | requirements.mdx §Capability Identity | covered | `05/structurally-identical-contexts-are-distinct-requirements` |
| 8.7 | an unsatisfied capability in a known closure is a compile error | requirements.mdx §Satisfaction | covered | `05/unsatisfied-top-level-requirement`, `06/layer-provide-missing-a-capability` |
| 8.8 | providing a layer removes matching capabilities from the row | requirements.mdx §Satisfaction | covered | `05/context-requirement-is-satisfied`, `06/layer-merge-satisfies-both` |
| 8.9 | provided implementations are scoped to the provided computation | requirements.mdx §Scoping | covered | `05/capability-is-unavailable-outside-the-provided-scope`, `06/nested-provide-scopes-are-independent` |
| 8.10 | a base Layer receives an already-acquired service and does not own its lifetime | requirements.mdx §Layer Algebra; DECISIONS Locked | covered | `06/layer-receives-an-already-acquired-service` |
| 8.11 | an opaque Layer expression fails closed | poc README SMITHERS2104 | covered | `06/opaque-layer-is-rejected` |
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
| 9.6 | `Date.now` charges `Clock` | `semantic.ts:4461` | covered | `20/clock-access-needs-a-capability` |
| 9.7 | any **other** `Date` member charges `Clock` | `semantic.ts:4462` | **uncovered** | no case reads a `Date` member other than `now` |
| 9.8 | `Date.parse` and `Date.UTC` are **exempt** | `semantic.ts:4462` (`!["parse", "UTC"].includes(member)`) | **uncovered** | the false-positive direction this page prizes at §1.7 and §16.11 and never applies here |
| 9.9 | `new Date()` with no arguments charges `Clock`; `new Date(x)` with arguments charges **nothing** | `semantic.ts:4438-4441` | **uncovered** | both halves. The argument-count split is a real rule and no case sits on either side of it. |
| 9.10 | every `performance` member charges `Clock` | `semantic.ts:4464` | **uncovered** | `grep -rn performance conformance/corpus/` finds no use |
| 9.11 | `Math.random` charges `Random`; any other `Math` member charges nothing | `semantic.ts:4463` and the absent `else` beside it | covered, both directions | `20/random-access-needs-a-capability`; `20/universal-globals-stay-available` reads `Math.max` and stays clean |
| 9.12 | `crypto.randomUUID` / `crypto.getRandomValues` charge `Random`; **every other** `crypto` member charges `Host` | `semantic.ts:4465-4466` | **uncovered** | neither side of the split; `grep -rn crypto conformance/corpus/ --include='*.sm'` finds nothing. Note the diagnostic mapping at `semantic.ts:4395`: `Clock` → `SMITHERS1602`, `Random` → `SMITHERS1603`, everything else → `SMITHERS1601`. So the `Host<"crypto">` branch reports the *same* code as `process`/`document`, and a case for it must observe the position rather than a distinct code. |
| 9.13 | a **lexical shadow** of one of these names stays an ordinary value | `semantic.ts:4417` (`isAmbientGlobalReference`) | **uncovered** | the one that matters most. A local `const Math = { random: () => 4 }` charging `Random` would be a false positive; the classifier guards against it and nothing checks the guard. Exactly parallel to `19/retired-operator-words-as-members-stay-ordinary`, which this page calls out as load-bearing at §1.7. |
| — | a whole-root escape — `Date`/`performance` → `Clock`, `Math` → `Random`, `crypto` → `Host` — when the member is dynamically selected | `semantic.ts:4454-4457` | **uncovered** | the conservative direction, and the one a refactor is most likely to relax |

**Two of the nine branches are pinned.** `20/host-globals-are-unavailable` pins a
different obligation (9.1: `process`/`document` are not ambient globals) and does
not touch this table at all.

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
| 11.5 | every started Promise is consumed before scope exit | requirements.mdx §Scoping; DECISIONS Locked | covered | `07/promise-must-be-consumed` |
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
| 12.1 | a discarded Result is a compile error | failures.mdx §Matching; type-system.mdx §Result Composition | covered | `07/result-must-be-consumed` |
| 12.2 | an unconsumed Result **parameter** is a compile error | poc README SMITHERS1302 | covered | `07/result-parameter-must-be-consumed` |
| 12.3 | returning, matching, transforming, inspecting, and unwrapping all count as consuming | failures.mdx §Matching | covered | `07/consumed-result-is-accepted`, `07/every-listed-consumption-form-is-accepted` (all five forms in one program) |
| 12.4 | a Result left by `await` still must be consumed | failures.mdx §Promise Semantics | covered | `07/await-leaves-a-result-that-must-still-be-consumed` |
| 12.5 | an inferred-fallible function crossing a general callback boundary needs a contract | poc README SMITHERS1303 | covered | `07/inferred-fallible-callback-needs-a-contract` |
| 12.6 | a started Promise must be consumed | DECISIONS Locked | covered | `07/promise-must-be-consumed` |
| 12.8 | **the discharge set is the compiler's own combinators, not anything spelled like them** | failures.mdx §Matching; DECISIONS Locked (Concurrency) | **covered** | **`07/a-shadowed-result-namespace-does-not-discharge`** (a user's own `const Result = { all: … }` — `SMITHERS1302`) and **`07/a-shadowed-promise-namespace-does-not-discharge`** (a user's own `const Promise = { async all… }` — `SMITHERS1403`, and the member is `async` because a promise-shaped-return guard is satisfied by it). Both were reference fail-opens recognised by RAW SPELLING; both compiled clean before. Each case file carries an `export`, which is load-bearing: without one the source is a global script where a top-level `const Result` MERGES with the ambient declaration instead of shadowing it, and the case would pass without observing the rule. |
| 12.9 | **the real combinators still discharge** | failures.mdx §Matching; DECISIONS Locked (Concurrency) | **covered** | **`07/the-compiler-owned-result-all-discharges`** and **`07/the-ambient-promise-all-discharges-a-bound-promise`**, both deliberately in the BOUND form the refusal cases use. The over-correction they guard against is measured, not hypothetical: resolving the twelve RECEIVER consumers through the compiler's declarations reports a false `SMITHERS1301` when a member resolves nowhere, or resolves to an unrelated real declaration such as `String.prototype.match` — which is corpus case `01/inferred-result-for-an-unannotated-function`. Only the namespace call lacks a receiver already known to be the compiler's, which is why it is the one that must resolve by identity. |
| 12.7 | imported TS/JS that starts hidden background work owns that work | DECISIONS Locked; requirements.mdx §Scoping | **unwritable** | **the harness cannot observe this.** The rule is about ownership *inside* a foreign module, which by construction keeps ordinary Promise behavior and is not analyzed. Its enforceable half — a callback escaping into foreign code — is covered by `09/callback-escaping-into-foreign-code-is-rejected`. Observing the rest would need a case that detects work outliving the program, i.e. a timing or handle-count observation the runner does not make. |

## 13. Expression control flow

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
| 15.4 | a value escaping direct static-call analysis fails closed | poc README SMITHERS1802 | covered | `15/higher-order-escape-is-rejected` |
| 15.5 | an instantiation must nominally cover a callback's declared row | poc README SMITHERS1806 | covered | `15/callback-row-must-be-nominally-covered` |
| 15.6 | a missing relative `.sm` module fails closed | poc README SMITHERS1801 | covered | `15/missing-relative-module-is-rejected` |
| 15.7 | **an import of a name the module does not export fails closed** | poc README SMITHERS1804 | covered | **`15/importing-a-name-a-module-does-not-export-is-rejected`** — the sibling half of 15.6: the module is there and the *name* is not, so the binding would otherwise carry an empty row rather than an unknown one |
| 15.8 | row members carry module-qualified nominal identity | poc README | covered | `04/same-named-errors-in-two-modules` |

## 16. Retired syntax — `19-retired-syntax/` (13 cases)

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
| 17.11 | loading happens during compilation and adds no runtime platform requirement | ASSET_LOADERS.md (Locked) | covered | **`23/an-asset-import-adds-no-runtime-platform-requirement`**. The previous revision recorded this as the most serious finding on the page, with **both** backends contradicting it. **Both markers are retired**: the reference's portability pass now knows which relative imports the source-asset stage owns, and the fork now has a source-asset stage. Measured `XPASS` on both backends before the markers were deleted, and both now print `production/2`. The retirement and the observation it replaces are recorded in the case's own `notes`. |

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

## 20. Durable execution — `17-durable/` (5 cases)

Same correction as §19: the previous revision listed these "so the census is
complete" and scored none of them.

**This section still comes out overwhelmingly uncovered, and that is the
finding.** `17-durable` has **six** cases
(`ls conformance/corpus/17-durable/*.expected.json | wc -l` → 6) against the 40
normative sentences below, of which the great majority are MUST/MUST NOT
(`grep -o MUST docs/src/pages/specification/durable-execution.mdx | wc -l` → 63,
counting each `MUST NOT` twice). The reference implements **29** durable
diagnostic codes — 25 in the `SMITHERS41xx` family (`4100`–`4123` plus `4199`)
and 4 in `SMITHERS42xx` — measured with
`grep -roh 'SMITHERS4[0-9]\{3\}' poc/src/durable/ | sort -u`. **The corpus
declares two:** `SMITHERS4106` in `17-durable/statement-branch-fails-closed`
and, new this revision, `SMITHERS4103` in
`17-durable/an-opaque-durable-argument-is-rejected`. (`SMITHERS4100` also appears
under `conformance/corpus/17-durable/`, but only inside a `notes` field recording
behaviour that was *retired*; it is not a declared diagnostic and nothing asserts
it.)

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
| 20.12 | every value crossing an Action or Flow persistence boundary MUST satisfy the compiler-checked durable codec contract (`:49`) | **uncovered** | no case crosses a persistence boundary |
| 20.13 | functions, capabilities, process handles, and other ephemeral values MUST be rejected without an explicit durable representation (`:51`) | **uncovered** | the central fail-closed rule of the durable boundary, and no case probes it. Fail-open direction: an unrejected ephemeral value is a Flow that replays wrong. |
| 20.14 | `any` and `unknown` MUST require an explicit codec at the boundary (`:53`) | **uncovered** | no case |
| 20.15 | the compiler MUST lower checked syntax, control flow, and data flow into Plan IR, and MUST NOT invoke the source function with proxy or symbolic values to discover the graph (`:59`) | **partial** | `17/static-plan-shape-is-digest-pinned` pins that the Plan exists with the right node kinds and edges. The **MUST NOT proxy-execute** half is not directly observed; it is inferable from the statement-branch rejection (20.19) but nothing asserts it. |
| 20.16 | an `Action.run` expression MUST emit a plan node and a typed symbolic Result (`:61`) | covered | same case: `plan.nodes.map(node => node.kind)` is asserted exactly |
| 20.17 | `.unwrap()` on it MUST emit the Result error-propagation **edge** (`:61`) | covered | same case asserts `plan.nodes[1].controlDependencies[0] === plan.nodes[0].id` |
| 20.18 | neither template compilation nor planning MUST execute the Action implementation (`:61`) | **uncovered** | with no implementation anywhere in the corpus, there is nothing whose non-execution could be observed |
| 20.19 | property access and argument passing on a symbolic result MUST create typed projections and dependency edges when representable (`:63`) | **partial** | the same case reads `found.value` off a symbolic result and asserts the resulting edges; "when representable in Plan IR" is the qualifier and its unrepresentable side is 20.22 |
| 20.20 | the durable source function MUST be **removable** after the compiler emits its plan; a planner or coordinator MUST NOT require the source function or a live side table (`:65`) | **partial** | `Build.artifactSource` is asserted, which shows the artifact is self-describing. Nothing removes the source and re-plans, which is what the sentence actually requires. |
| 20.21 | a durable source function MAY capture compiler-known immutable values **only**, and MUST NOT observe runtime clock, randomness, environment, mutable state, services, or I/O while the template is constructed (`:69`) | **uncovered** | six named sources, zero cases. §19.16 has the same shape and at least has two. |
| 20.22 | runtime-dependent control flow MUST be represented explicitly in Plan IR; the compiler MUST reject an operation that would inspect a symbolic value without a corresponding IR representation (`:71`) | covered | `17/statement-branch-fails-closed` — `SMITHERS4106`, the corpus's **only** declared durable diagnostic |
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

**Honest shape of §20.** Of the forty sentences: **10 covered or partial**, all of
them inside template compilation (phase 1); **30 uncovered**. Twenty-two of the
thirty are uncovered for one structural reason — the corpus compiles and runs
a single `.sm` program in one process and observes its stdout, so **three of the
four compilation phases the specification requires have no channel through this
harness at all**. That is not a lane's backlog; it is a statement that durable
execution is measured by `poc/src/durable/*.test.ts` and essentially not by the
conformance corpus. Saying so is more useful than a promise that another lane
will get to it.

The eight that are *not* structural — 20.8/20.9 (Action implementations and
abstract signatures), 20.11, 20.13, 20.14 (durable boundary rejections), 20.21
(flow purity), 20.25 (unknown branch preserved) — are all reachable from template
compilation today, and each is a **fail-closed** rule. 20.5 was the ninth and is
now covered. Those seven remaining are where corpus work in this area would buy
the most, and they are the same surface as the nineteen shared-but-unprobed
durable codes in "rules both implementations have and no case probes": one case
per fail-closed rule would move both counts at once.

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
   the harness rather than in a backend. **Twelve diagnostics in `21-native-pin`
   now pin a composed route** (five a revision ago), recomputed this revision by
   parsing the expectations rather than by grep, and they are still the whole
   corpus: only diagnostics under `21-native-pin/` declare the field. They are
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
6. **Everything runs in one realm** (5.11). Cross-realm transport metadata for a
   nominal Error cannot be observed. **What it would need:** a two-realm
   expectation kind (worker or subprocess) on both backends.
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

## `xfail` register

**Four markers, four findings, all `go`, all in `21-native-pin`, and all in the
fail-open direction.** Each program was written from the documentation before it
was run. None is a divergence: each is a backend disagreeing with the
*specification*, recorded rather than smoothed over, which is why the run reports
zero divergences and still reports these.

**Three of the four are programs the fork compiles, certifies as native-portable,
and RUNS.** That is the worst shape a failure can take here, because nothing
before execution reports it and the certification is the thing being asked for.

| case | what the fork does instead | why it is a defect and not a wrong case |
| --- | --- | --- |
| `a-callback-a-callee-invokes-is-part-of-the-pinned-graph` | zero diagnostics, exit 0, prints `1` | requirements.mdx §Inference (Locked) makes inference transitive through ordinary calls, and `run(() => eval(…))` reaches `eval` through one. The fork owns every neighbouring piece: it charges `eval` in the pinned body, inside an immediately-invoked function expression, and inside a `Layer.provide` callback (naming the anonymous hop). What it never does is ask which VALUE reaches a call whose selected signature is a parameter's function type. |
| `a-class-instance-method-is-part-of-the-pinned-graph` | zero diagnostics, exit 0, prints `1` | the same missing question in its other spelling. `run`'s parameter is an interface, so the signature the checker selects has no body and the walk enters nothing; the body that runs belongs to the class the caller constructed. |
| `a-layer-cannot-subtract-a-requirement-that-blocks-the-pin` | zero diagnostics, exit 0, prints `1` | **a subtraction defect, and the two probes that prove it were run.** The byte-identical program with the capability class renamed `Config` is REFUSED by the fork (`native pin failed: TypeScript is required through main.sm#scoped -> main.sm#<anonymous>`), and a `Layer.provide` callback reading `process.pid` is refused there too. The only thing that changes is the identifier on the capability class, so the fork's layer satisfaction subtracts by matching the row NAME with no guard for the built-in requirements a pin exists to reject. compatibility.mdx §Native Pin names providers explicitly and makes them a reason to fail: *"Compilation MUST fail if any reachable operation **or provider** requires TypeScript."* The reference has the guard (`charge` refuses to drop anything `blocksNativePin` recognizes). **Highest severity of the four**: the exploiting program is ordinary Smithers and one identifier long. |
| `a-side-effect-import-chain-is-part-of-the-pinned-graph` | `[SMITHERS1510@4:8]` — the trust companion fires, the pin is granted | requirements.mdx §Platform Requirements (Locked): portability from the satisfied dependency closure, "not merely the source module's import path". **It is the transitive half specifically**, measured: handed the same pinned function with `import "node:fs"` written directly in its own module, the fork reports the pin failure correctly (`Module<"node:fs"> is required through main.sm#pinned`). It owns the rule and charges only the first link. Read the masking precisely: this program is still refused, by the *trust* rule and not by the pin, so a host module carrying the trust marker would leave the fork with no diagnostic at all. |

**What these four have in common is the thing the previous section warns about.**
Not one of them is visible to code-set subtraction. The fork spells
`SMITHERS3001`, spells `SMITHERS1510`, classifies `eval` as `TypeScript`, and
passes the other twenty-three cases in `21-native-pin`. Four rules both
implementations "have" and one of them does not reach — found only because
somebody wrote the programs.

**And they were only writable because five other lanes had already done the work
in the reference.** Every one of these four classes was a *reference* fail-open
within the last day; each was closed in `poc/src/targets/classify.ts` and none was
pinned by any case. Pinning them is what turned "the reference used to be wrong
here" into "the fork is wrong here now".

### One marker was retired this revision

`23-asset-imports/a-non-literal-dynamic-asset-import-is-rejected` — the previous
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

### Twenty-four markers were retired by the three revisions before this one

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

**Zero.** The last one — `23/a-type-only-asset-import-is-rejected`, where the
fork reported a stock `TS2857` where the reference reports `SMITHERS5208` — is
gone with the rest of the asset gap: the fork now owns that refusal under its
own code. The previous revision's three rows (`18/with-statement-is-forbidden`,
`09/a-bare-package-with-the-intrinsic-letters-is-foreign`,
`15/importing-a-name-a-module-does-not-export-is-rejected`) had already gone the
same way.

That number is the one to watch during the migration, and it has now reached
zero across four consecutive measurements. Read it precisely: `unsupported` was
never the dangerous bucket. It means "no rule of its own here yet", which is
loud and honest. The dangerous bucket is `fail` in the fail-open direction — the
fork accepting and running a program the language requires it to refuse — and
that is what the four `xfail` markers above hold, because a marker is the only
way the corpus can record such a thing without it counting as a divergence.
**Read `0 unsupported`, `0 divergent` and `4 xfail` together or the first two
flatter — and this revision is the sharpest illustration the page has: the
number of recorded fail-opens went from one to four while `0 unsupported` and
`0 divergent` did not move at all, because nothing changed in either
implementation. Only the number of questions asked changed.**

## Documentation conflicts

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
| F1 | *"Smithers **MUST** support a near-native target through LLVM"* | **no implementation** | `compatibility.mdx:60`. `grep -ril llvm poc/src/ src/ compiler/ cmd/` returns nothing; the string occurs only in prose. This is the single largest unimplemented MUST in the repository and it is the one row 10.13 has always named. It also blocks 20.38 (a deployment build MUST be capable of emitting a **native** worker artifact). |
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

Forty-nine cases across three revisions: twenty-three two revisions ago, eleven
in the one before this, and **fifteen in this one**. Column 4 answers the only
question that makes a pin worth anything: *would this case have failed against
the behaviour it pins?*

### This revision's fifteen

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

| fail-open | why no case | where it is pinned instead |
| --- | --- | --- |
| ~~**the Go CLI's default lowering mode ran zero Smithers checks**~~ (`lowering: ""` selected identity, so `smithersc-go file.sm` compiled `.sm` as plain TypeScript and exited 0) | **still no case, and there never can be one**: the runner reaches the fork through `conformance/runner/backend-go.mjs`, which always sends an explicit mode, so every case measures the mode the harness asked for. That is exactly why this one survived at 211/211. | **pinned as of this revision**, outside the corpus: `conformance/runner/selftest.mjs` sends the real bridge four real requests and requires an omitted mode to be refused, an unknown mode to be refused, `"internal"` to report `SMITHERS1510`+`SMITHERS1301` on a two-file program, and `"identity"` to compile that same program clean — which is the consequence of the original defect, measured rather than argued. It also asserts, at the source level, that every request `backend-go.mjs` builds reads the one named `loweringMode` constant. See §21.7. |
| **`weakenUnderivableErrors` shipped enabled**, converting a hard "cannot derive this failure contract" refusal into a silently weaker JSON-value contract | the durable schema-derivation path is not on the corpus compile route | `poc/src/durable/source-compiler.test.ts` and `schema.test.ts` |
| **a prefix match skipped the Action-contract closure check** for any `smthrs/`- or `smithers:`-prefixed specifier, including ones no registry owns | the implementation-contract subsystem is not on the corpus compile route and the fork has no analogue | `poc/src/durable/implementation-contract.test.ts` |
| **neither backend validates import-attribute *keys*** — `with { type: "json", secret: "x" }` compiles clean on both | a **shared** hole is permanently invisible to a differential oracle. It is observable only as a single-backend expectation once a rule is decided, and no rule is decided. | nothing |

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
> That is a claim about `conformance/corpus/` at **260 cases**. It is **not** a
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
> - **twenty-seven rules both implementations spell and no case probes** (see
>   "Rules both implementations have and no case probes"). Recorded as thirteen
>   last revision; the difference is not regression — this revision wrote five of
>   the thirteen and corrected a method that had been hiding nineteen durable
>   codes. **Nineteen of the twenty-seven are that durable block**, reachable from
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

### What remains uncovered, and why

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
hiding right now (reference-only), twenty-seven more where one could hide in
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
