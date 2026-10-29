# Fuzzing the VibeLang compiler

Researched 2026-10-27; suite built 2026-10-27 and 2026-10-28. This is a snapshot; `typescript/tsc/internal/vibelangfuzz/` is the live suite.

## Summary

Fuzz VibeLang with Go's native fuzzer, and take every oracle from the specification.

The compiler is a Go fork of TypeScript 7, so the engine is `go test -fuzz`: coverage-guided, in-process, with failing inputs kept as regression tests in `testdata/fuzz/`. The engine is the easy part. Compiler-fuzzing research finds bugs through oracles: a program the generator knows is valid must compile, two programs the specification calls equivalent must behave the same, and a program with one injected rule violation must draw exactly the diagnostic the specification assigns. `internal/vibelangfuzz` implements those oracles in 13 targets, reads its facts from `docs/design/src` at test time, and records each place the specification is ahead of the compiler as a pending gap instead of encoding today's behavior.

## Question 1: how to fuzz TypeScript code

| Tool | Engine | Status | Use it for |
| --- | --- | --- | --- |
| [fast-check](https://github.com/dubzzz/fast-check) | Property-based: typed generators, shrinking to a minimal counterexample | Maintained; runs under Jest, Vitest, Mocha, AVA, `bun test` | Invariants of TypeScript logic: round trips, idempotence, model equivalence |
| [Jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js) | Coverage-guided, in-process, libFuzzer | Its maintainers stopped open-source maintenance; the product moved to commercial CI Fuzz | Not for new work |
| jsfuzz | Coverage-guided JavaScript fuzzer | GitLab's own issue reports it could not fuzz TypeScript except as compiled JavaScript | Not for new work |

Answer: property-based testing with fast-check for TypeScript code. No maintained open-source coverage-guided engine exists for Node, and the [2025 Amp write-up](https://wickstrom.tech/2025-08-28-findings-bugs-coding-agent-lightweight-dst.html) calls TypeScript "an ecosystem currently not drowning in fuzzing tools". VibeLang's TypeScript packages (`packages/runtime`, `packages/ts-mapper`) are not this suite's subject; the compiler is Go. The runtime is still exercised here, because every runnable oracle executes emitted JavaScript on it.

## Question 2: how to fuzz a compiler

### Prior art

| Work | Technique | Result | What VibeLang takes |
| --- | --- | --- | --- |
| [Csmith](https://www.doi.org/10.1145/1993316.1993532), PLDI 2011 | Generate valid C free of undefined behavior; differential across compilers | 325+ GCC/LLVM bugs | Generate programs valid by the specification |
| [YARPGen](https://users.cs.utah.edu/~regehr/yarpgen-oopsla20.pdf), OOPSLA 2020 | Generation policies for diversity once Csmith saturated | 220+ bugs in GCC, LLVM, ICC | Feature-diverse generation |
| [EMI](https://www.cs.ucdavis.edu/~su/publications/emi.pdf), PLDI 2014 | Variants equivalent on the test inputs (prune or insert dead code) | 147 GCC/LLVM bugs, mostly miscompilations | Equivalent spellings and dead code must not change a result |
| [Swarm testing](https://www.cefns.nau.edu/~adg326/issta12.pdf), ISSTA 2012 | Each test enables a random subset of features | 42% more distinct compiler crashes than a tuned default | Per-input feature subsets |
| [Hephaestus](https://discovery.ucl.ac.uk/id/eprint/10182832/), PLDI 2022 | Type-erasure and type-overwriting mutations with typing oracles | 156 typing bugs in javac, kotlinc, groovyc | Injected violations with expected diagnostics |
| [Thalia](https://arxiv.org/abs/2311.04527v1), 2023 | API-driven programs, fault-injection and semantics-preserving modes | 84 typing bugs in Scala, Kotlin, Groovy | The dual oracle: allowed forms add no diagnostic |
| [Fuzzilli](https://github.com/googleprojectzero/fuzzilli) | Mutate an IL that stays valid, lower it to JavaScript | Coverage-guided JS-engine fuzzing at Google | Fuzz bytes drive a generator, so mutations stay valid |
| [tree-splicer / icemaker](https://rustc-dev-guide.rust-lang.org/fuzzing.html) | Splice tree-sitter syntax trees of existing files; hunt internal compiler errors | rustc, clippy, rustfmt ICEs | A follow-up: VibeLang has a tree-sitter grammar in `editors/` |
| [Kotlin K1/K2](https://arxiv.org/abs/2401.06653v1), FSE 2024 | Grammar and semantic models, genetic search, differential K1 vs K2 | Bugs JetBrains confirmed and fixed | Differential against a second implementation |
| [Comfort](https://ar5iv.labs.arxiv.org/html/2104.07460), PLDI 2021 | Differential conformance testing of JavaScript engines | 158 engine bugs | Spec conformance as the oracle |

Surveys: [Ma, A Survey of Modern Compiler Fuzzing (2023)](https://ar5iv.labs.arxiv.org/html/2306.06884), [Compiler Testing: A Systematic Literature Analysis (2018)](https://arxiv.org/pdf/1810.02718).

No published work fuzzes TypeScript's own checker; its crash reports are hand-reduced issues. Go's native fuzzer finds parser bugs ([trophy case](https://go.googlesource.com/wiki/+/16f3fb9cf6297ac8e85f2f243449f5e037e7d36f/Fuzzing-trophy-case.md)) and keeps its seed corpus and crashers in `testdata/fuzz/<Target>` ([Go fuzzing docs](https://go.googlesource.com/website/+/7a18f71f511720a4cf96e3346e32c14c9b44fa36/_content/doc/fuzz/index.md)).

### Why the specification is the oracle

A differential oracle needs a second implementation. VibeLang has one only in a weak sense: the specification says a `.vibe` program means the Effect TypeScript it replaces (SKILL.md: "Read and write it as Effect code; that reading is never wrong"). That sentence is the reference implementation: print each generated program twice, once as VibeLang and once as the Effect TypeScript of the Forms table, run both, and compare. The other oracles also come from the specification: Chapter 28's registry gives every rule a code, Chapter 27 fixes what emitted JavaScript may import, D266 keeps `.ts` files TypeScript, D291 says a fix keeps meaning.

The specification is ahead of the compiler in places (Chapter 28: "A registry entry doesn't prove its check or editor code action is implemented"). An oracle that encoded today's behavior would bless those gaps. The suite reports each disagreement with `Gap`; a line in `testdata/pending/<area>.txt` names the gap, its decision and its owner, skips it, and fails as XPASS once the compiler catches up, the way a `pending` file marks an acceptance case.

## The suite

```
             generator bytes        mutated cases, snippets, archives
                   │                              │
        ┌──────────▼──────────┐        ┌──────────▼──────────┐
        │ specgen: valid      │        │ 750 acceptance cases │
        │ programs over 48    │        │ ~700 doc snippets    │
        │ Part I features     │        │ 227 rule injections  │
        └──────────┬──────────┘        └──────────┬──────────┘
                   │  .vibe + Effect TS print     │
                   ▼                              ▼
   parse ─► check ─► diagnostics ─► emit JS, .d.ts, maps ─► run on Node
     │        │           │                 │                  │
 FuzzParse  FuzzSpec   FuzzSpecRules     FuzzCompile      FuzzSpecPrograms
            Programs   FuzzSpecAllowed   FuzzTypeScript-  FuzzSpecVariants
                       FuzzConfig        Parity           FuzzFix (outcome)
   tools: FuzzFormat (vibelangfmt) · FuzzFix (--fix) · FuzzEditor (LSP) · FuzzIncremental (edits)
   the binary: FuzzCommandLine (every flag, --lsp, --api, --estree, --fix, --watch)
```

| Target | Input | Oracles, each from the specification |
| --- | --- | --- |
| `FuzzCompile` | Archive of a project, seeded with the cases and snippets | No panic or hang. Every EK code is registered in Chapter 28 and not retired; each has its Chapter 28 default category. EK codes only in `.vibe` files (D266). Spans inside their files. Same result on a fresh compilation, in reverse file order, and emitting first. With no error: emitted JavaScript parses; it imports only effect, the runtime, written specifiers, module files and an entry's platform package (Chapter 27, D365, D403, D312); runtime helpers exist; source maps are version 3, stay inside the source and map each emitted statement into its statement (D34); every requested output exists; `.d.ts` files parse, and a consumer that calls every export type-checks under the fork and under stock TypeScript (D366); runtime helpers are the runtime's executable exports |
| `FuzzParse` | One text, parsed as `.vibe`, `.ts`, `.tsx`, `.d.ts` | No panic; well-formed tree; deterministic; ESTree output is JSON with ranges inside the text (Chapter 28 Linting, D277) |
| `FuzzConfig` | A `vibelang` settings object and a source | Invalid values draw a config diagnostic; a valid severity sets an adjustable code; non-adjustable codes never change; tracing changes no diagnostic (Chapter 28, D104, D275) |
| `FuzzTypeScriptParity` | A `.ts`-only project | Same diagnostics, with complete spans, JavaScript, declarations and maps as stock TypeScript 7.1.0-beta (D266) |
| `FuzzSpecRules` | Injection, host and choice bytes | Each of 148 registered codes, injected into a valid host at a fuzzed slot and setting, is reported exactly once, inside the injection, in the category Chapter 28 gives it under that setting, with no other new error |
| `FuzzSpecAllowed` | One of 35 allowed forms, or a violation in a `.ts` file | Allowed forms add no diagnostic; a `.ts` file draws no EK code even with every adjustable code set to error (D266) |
| `FuzzSpecPrograms` | Generator bytes (focus feature, swarm mask, choices); programs of one to three modules | The program compiles; its VibeLang and Effect TypeScript prints end with the same outcome, the same whole cause and the same trace, and no export returns a plain value where an Effect is due (Chapters 1, 17, 27, Appendix C); each export's `.d.ts` contract holds the A, E and R the model infers, producers included (Chapters 2-4, 8, 14, 27) |
| `FuzzSpecVariants` | Generator bytes | Each equivalent spelling (`A!E!R`, pipes, catch as try, renaming, dead code, extraction) ends as the base program does (EMI) |
| `FuzzFormat` | One source | A file with a syntax error is refused and a file without one is not; the output emits the same JavaScript token stream and diagnostics as the input, keeps each comment between the same tokens, and a second pass changes nothing (Chapter 28 Idempotence, D276, D372) |
| `FuzzFix` | Project archive | `--fix` converges, edits only `.vibe` files, adds no error, keeps comments and contracts, is a fixed point, keeps every exported program's outcome, and repairs each code Chapter 28 names for `--fix`, its Effect-form lint codes, the retired spellings and EK1002, or says why not (D291, D372) |
| `FuzzEditor` | Project archive and offsets | No panic, hang or request error; ranges inside documents; hover, definition and completion answer at a declared name; edits stay in their documents, do not overlap, keep a parsing file parsing; an EK quick fix removes its diagnostic and adds no error (D61, D291, D372) |
| `FuzzIncremental` | Archive and edit script over any file of the project | After each partial edit, the server's diagnostics equal a fresh compilation's (D32, D61) |
| `FuzzCommandLine` | Archive and a fuzzed argument list | The built binary never panics or hangs; exit statuses as Chapter 28 gives them; printed diagnostics equal the library's; `--fix` as above; `--estree` equals the library conversion; `--help`, `--version`, `--watch`, an LSP and an API session end cleanly |

Completeness is checked, not claimed. Each of these tests reads the specification at test time and fails when it grows:

| Test | Fails when |
| --- | --- |
| `TestSpecRuleCoverage` | A code in Chapter 28's table or list has no injection, pending line or retirement |
| `TestGeneratorMatchesSpecForms` | A code span of SKILL.md's Forms table maps to no generator feature and no pending line that says why, or the map names a form SKILL.md dropped |
| `TestCommandLineFlagsCoverSpec` | The specification shows a `vibelang` flag the command-line target does not fuzz |
| `TestPendingLines` | A pending line names no target, a missing reproduction, or no chapter or decision |
| `TestPendingHangs` | A pending hang's reproduction finishes within its deadline (XPASS) |

A pending line skips only the disagreement its own key names. A reproduction's `corpus:` line marks it for XPASS and never excuses a new failure. `typescript/vibelang/smoke.sh`, which the merge queue's gate runs before anything lands on `main`, runs the seed corpus with `-short`, and a missing dependency fails there instead of skipping.

## Results

Campaigns ran on the shared build host (48 cores, load average 70 to 110) at `-parallel 6`, so the counts are low for Go fuzzing. A compilation with a type check and emit costs about 20 ms on an idle core.

| Target | Campaign | Inputs run | New failures |
| --- | --- | --- | --- |
| `FuzzCompile` | 10 min | 2,684 | none beyond the seeds' |
| `FuzzParse` | 5 min | 170,772 | none |
| `FuzzConfig` | 5 min | 108,094 | none |
| `FuzzTypeScriptParity` | 5 min | 12,025 | none |
| `FuzzSpecRules` | 16 min | 39,774 | none beyond the gaps below |
| `FuzzSpecAllowed` | 11 min | 45,813 | none |
| `FuzzSpecPrograms` | 13 min | about 6,000 | bug 7 below |
| `FuzzFormat` | 17 min in 4 runs | about 773,000 | bugs 1 and 19 |
| `FuzzFix` | 12 min | 3,379 | none |
| `FuzzEditor` | 1 min 20 s | seeds only | bugs 3, 4 and 15 to 18, on the seeds |
| `FuzzIncremental` | 90 s, all spent replaying its corpus | 554 corpus inputs | none |
| `FuzzCommandLine` | 2.5 min | 1,913 | none |

After both reviews' fixes, one 90-second pass over all 13 targets found bug 24 in `FuzzParse` after 12,741 inputs. It also found two test bugs, both fixed: `FuzzCommandLine` deadlocked the fuzz engine, and `FuzzFix` did not accept a warning that says what a fix would change, which Chapter 28 permits. Several targets spent the 90 seconds replaying the corpus earlier campaigns had grown, so a pass needs about 5 minutes per target.

While this change waited in the merge queue, the fiber ownership change landed first. It made EK4838 an error that no setting lowers and fixed bug 17, and the gate's seed run failed with four XPASS reports, one for each pending line those fixes closed. This change deletes those lines. The same run found two more test bugs, both fixed: `FuzzFix` required `--fix` to apply every quick fix the registry lists, such as EK4802's, where Chapter 28 names only its Effect-form lint codes, the retired spellings and EK1002, and the EK4609 injection held owned fibers in an array that is not `join`'s operand, which Chapter 7 also makes EK4838 (D409), so it now uses detached fibers. Before it landed, two more changes closed the EK1019 and EK4701 gaps, which also failed as XPASS, and Chapter 28 added EK4839 and EK4840, which `TestSpecRuleCoverage` required injections for.

No VibeLang program's outcome differed from its Effect TypeScript reading, and no declared contract differed from the inferred one.

Statement coverage over the seed corpus and the saved inputs:

| Package | Coverage |
| --- | --- |
| `internal/vibelang` (checker hooks, lowering, diagnostics, fixes, editor) | 85.3% |
| `internal/vibelangestree` | 87.4% |
| `internal/parser` | 81.2% |
| `internal/format` | 69.4% |
| `internal/checker` | 67.9% |
| `internal/printer` | 66.6% |
| `internal/vibelangfmt` | 57.3% |
| `internal/ls` | 35.0% |
| `internal/vibelangmapper` | 19.2% (its own `FuzzProjectionSpans` covers it) |

The low `internal/ls` figure is the language server's breadth: `FuzzEditor` asks hover, definition, type definition, references, highlights, completion, signature help, rename, code actions, document symbols, folding ranges, inlay hints and semantic tokens at fuzzed offsets, but the language server holds every TypeScript feature besides, such as call hierarchy, workspace symbols and organize imports, which no target asks.

### Bugs

Each open bug has a minimal reproduction in `typescript/tsc/internal/vibelangfuzz/testdata/fuzz/<Target>/` and a line in `testdata/pending/`.

| # | Kind | Reproduction | The specification says |
| --- | --- | --- | --- |
| 1 | Hang | `layer e{)` never finishes parsing (`parseLayerDeclaration` loops) | A compiler stops |
| 2 | Hang | A `match` of N literal arms checks in O(N³): 1,000 arms 5.7 s, 2,000 arms 48 s; the TypeScript `switch` takes 10 ms | A compiler stops |
| 3 | Crash | Signature help at the `}` of `error E { a: string }` panics "Not a subspan" | LSP 3.17 |
| 4 | Crash | Completion inside the `service` keyword panics "Token cache mismatch" | LSP 3.17 |
| 5 | Parse | `do { const a = 1; match (a) { when 1: 2; default: 3; } }` is TS1109 | D187: `match` ends a `do` block as a value |
| 6 | Check | An exhaustive `match` after a `return` draws EK4701 and TS2339 | D346 |
| 7 | Check | `const d: D0 = D0.V0(); match (d) { ...; when D0.V1 { let x }: x; }` is TS2339 on `never` | D346, D307 |
| 8 | Check | `x \|> rec0(%)` inside `rec0` is EK2102 where `rec0(x)` compiles | Chapter 13 rule E6, Chapter 14 |
| 9 | Check | Writing the inferred `number!!` on a function whose `try` returns a `do` block gives TS7022 and TS7024 | Chapter 2, D71 |
| 10 | Parse span | `schema error E extends { id: string }` has a CallExpression span [22, 14), and ESTree inverts it too | D61, D277 |
| 11 | Source map | A top-level `match` maps a segment one character past the end of the file | D34 |
| 12 | Declarations | A D12 callback parameter is written `Effect<B, E, R>`: TS2709 in a consumer | Chapter 27 rule 4, D366 |
| 13 | Declarations | A module declaration's `.d.ts` keeps `./more.ts` | D365 |
| 14 | Declarations | A module body's `.d.ts` needs `Symbol.dispose` from a lib only the implicit `effect` import brings: TS2550 in a consumer | D366 |
| 15 | Refactor | "Convert to a pipe" turns `Console.log(String({ a: 1 }))` into `{ a: 1 } \|> ...`, which does not parse | D245, D372 |
| 16 | Quick fix | The EK4832 fix is offered for `Schema.Struct({ a: Missing.fields.a })` and adds EK2109 | D291, D372 |
| 17 | Quick fix, **fixed on `main`** by the fiber ownership change | The EK4838 fix writes `detach({ log("x") })`, which does not parse | D291, D372 |
| 18 | Quick fix | The EK4835 fix inside a pipe stage writes `%() catch ...`, calling the topic | D291, D372 |
| 19 | Formatter, **fixed in this change set** | Not idempotent on `{{0!\n("")}}` and `{{x\n+ y}}`: a line break added before a token shifted only its own node's indentation. TypeScript 6.0.3 does the same; upstream PR [microsoft/TypeScript#64994](https://github.com/microsoft/TypeScript/pull/64994) | Chapter 28 Idempotence |
| 20 | Crash, **fixed in this change** | Declaration emit of several `.vibe` files in parallel stops with "concurrent map read and map write": each file's transform read the checker's prelude maps after releasing its lock | A compiler stops |
| 21 | Formatter | Refuses `module {}`, which parses without a syntax error | D276 |
| 22 | `--fix` | `catch (e: Error)` draws EK2112, a retired spelling Chapter 28 gives a quick fix, with no fix and no explanation, and `--fix` leaves it | Chapter 28, D216 |
| 23 | Hover | Empty for a declared function called inside a retired `select` arm | D61, D77 |
| 24 | Parse tree, **fixed in this change set** | `export {}; await + f(const 0 await !x` keeps two overlapping statements: the top-level await reparse read to the end of the file and the original statements after it stayed. TypeScript 6.0.3 also overlaps on the original input; upstream PR [microsoft/TypeScript#64993](https://github.com/microsoft/TypeScript/pull/64993) | D266 |

### Where the specification is ahead of the compiler

| Gap | Codes |
| --- | --- |
| A warning where Chapter 28 says error | EK3205 (D420), EK4409 and EK4802 (D321) |
| A setting lowers a code no setting may lower | EK9100 |
| Retired codes still reported | EK1008, EK2115, EK2116 |
| Not reported | EK1001 for a parameter default (D350) and a static block (D282); EK4603 over Configs; EK4609, EK4610 for Fiber and Deferred elements (D394); EK4704 over an `Iterable` (D417); EK4838 for `fibers.push(fiber)`; EK4301 for a contracted callback (D421); EK4836 in a `const` initializer (D290) |
| A TypeScript error instead of the EK code | EK4408 (TS1203), EK1020 (TS7009), EK3007 (TS2348) |
| Reported twice | EK1001 for a top-level `provide` that contains calls |
| Listed after the table, not reported yet | EK1018, EK2129, EK3208, EK4410, EK4411, EK4613 |

### Added before landing

The same change set adds what the first results argued for:

| Addition | What it found |
| --- | --- |
| `FuzzSplice`: splices statements, expressions, types, members, match arms and declarations between the acceptance cases and doc snippets, then applies the parse and compile oracles | A `.vibe` file holding only its platform import emits an empty `.d.ts`, which a TypeScript consumer rejects with TS2306 (Chapter 27 rule 4) |
| `FuzzEditorConsistency`: references, highlights, rename to a fresh name, Organize Imports, call hierarchy, selection ranges and symbols must agree (LSP 3.17, D372) | 29 gaps, among them rename missing `extends Base`, a service's `Shape` and `from` of a module block, and Organize Imports breaking module-block imports. `internal/ls` coverage rose from 35.7% to 42.1% |
| 15 more generated runtime forms: joined fiber literals, detached, scoped and scope-held forks, Cause values, interruptible regions, held fibers interrupted inside `try`/`finally` with `using`, failures beside defects | VibeLang and Effect agreed on every seed. `yield` in a producer's `do` block is TS1163, and writing the inferred contract on a function holding an async hatch is TS7024 |
| `nightly.sh`: every seed, then every target's campaign, against the latest `main` each night on the build host, the race detector on Sundays | Its first test run found the formatter refusing a field comma (EK1013), recorded in `tools.txt` |

## Independent review

Two independent reviews ran before the suite landed. Codex Astra (`gpt-6-astra`) reviewed it against the specification first. It found every registered code and every Forms row accounted for, and eight classes of weakness. Each was fixed before landing, except where the table says otherwise:

| Finding | Fix |
| --- | --- |
| A pending reproduction skipped on any failure, so a new failure in it passed; the rules area's reproductions could never XPASS; a hang could never XPASS | A corpus line only marks XPASS; each gap needs its own key; the rules reproductions have corpus lines; `TestPendingHangs` probes hangs in a child process |
| The Node worker turned a plain return into an Effect and kept only the first failure of a cause; the smoke test accepted any defect; agreeing crashes passed | The worker reports `plain` and every reason of the cause; crashes, timeouts and plain results disagree |
| The declaration consumer only took `typeof` and ran on the fork; outputs could be missing; any string literal authorized an import; source maps were checked only for bounds | The consumer calls every export, under stock TypeScript too; requested outputs must exist; imports come from parsed module specifiers; statements map into their statements |
| The command line had no target | `FuzzCommandLine` |
| The formatter oracle used the formatter's own `SameProgram` guard; refusals passed; editor request errors passed; incremental failures compared as empty | An emitted-JavaScript token comparison; refusals of valid input and request errors are gaps |
| Some expectations came from the compiler | Each such comparison is metamorphic (the same compiler on two inputs the specification says must agree) and says so, or now reads the specification |
| Generator gaps: one module per program, depth 3, first code span only, unreachable incremental tokens | Programs of up to three modules, deeper nesting, every code span, every token reachable |
| A missing toolchain skipped every target; `campaign.sh` exited 0 after a failure | `VIBELANG_FUZZ_REQUIRE=1` fails instead; the script's status reports failures |

Claude Fable then reviewed the result. It confirmed the race fix: each transform copies the maps at the point the old code took them, after the file's last write, and a single-file program sees what it saw before. It found that the suite still tested less than it said, and those findings were fixed too:

| Finding | Fix |
| --- | --- |
| Pending keys named whole oracles (`feature:source-map-range`, `editor:empty:hover`, `format:refusal`, `editor:parse:Convert-to`), so one known gap switched an oracle off for every input | Each key now says where: `source-map-range:one-past-end`, hover by the construct around the name, refusal by the first statement's kind, refactors by their title |
| The smoke run's `-short` ran one rule injection in three and skipped the hang probe; parity and the stock consumer passed without stock TypeScript | Every injection runs; the probe runs with a reproduction that outlasts it on any host; `smoke.sh` installs the pinned stock TypeScript and a missing one fails |
| The programs target keyed every gap by its reproduction | Each gap is keyed by its oracle |
| The parse, config and parity targets skipped any panic of a pending reproduction | A panic is keyed by the function that panicked |
| `--lsp` and `--api` sessions passed when the server exited before `initialize` | The `initialize` reply is required |
| `FuzzFix` compared outcomes without their causes | Causes are compared |
| A pending key could name a code or injection no input reaches | `TestPendingLines` rejects it |

Left on purpose: ESTree token parity with `typescript-estree` (not installed in the repository, and dependency changes need approval); the installation, scaffold, loader, Vite and editor-extension packages, which are TypeScript, not the compiler (fuzz them with fast-check); the "exactly once" reading of a rule's report, which the specification implies but does not state.

## FuzzVIPDifferential: the VIPs' differential test

Added 2026-10-29. VIP-31: "Each VIP's VibeLang and Effect TS pair is a differential test that compiles one, runs both, and compares their `Exit`s. The fuzz suite generates more pairs." `FuzzVIPDifferential` is that test. Its oracles come from the accepted VIPs in `docs/design/vips/`, not from the old specification, and it will replace `FuzzSpecPrograms` and `FuzzSpecVariants` once it covers their constructs.

```
 fuzz bytes ─► vipgen: focus construct + swarm mask ─► one program tree
                                  │
              ┌───────────────────┴───────────────────┐
         PrintVibe: main.vibe                 PrintEffect: ref.mjs (each VIP's Effect TS,
              │                                untyped JS, never through the compiler)
   Workspace.Compile (no error)                       │
              │                                       │  run twice: must agree, or the
   Node worker, vip mode ◄────────────────────────────┘  generator has a bug
     main() logs nothing when called (VIP-1)
     TestClock.layer(), MaxOpsBeforeYield at its maximum, +1 ms per step, ≤ 10,000 steps
              │
   VIPCompare: Exit (Success value, or Failure reasons in order with payloads) and event log
```

| Part | Where | What it does |
| --- | --- | --- |
| Construct registry | `vipgen/model.go` | A construct is `vipNN.<name>` with its VIP, `Requires`, citations, and hooks: `Focus` (its probe), `Stmt`, `Operand` (an Effect for `try`), `Declare` (a function form). One file per VIP registers its constructs from `init`, so a new construct never touches the core |
| Constructs | `vipgen/vip01_effect_function.go`, `vip04_throw.go`, `vip05_try.go` | `effect function` as `function f(p) { return Effect.gen(function* () { … }) }`; `throw e` as `return yield* Effect.fail(e)`; `try e` as `yield* e`. The core (`core.go`) writes events, `if`, `return`, numbers and `Effect.succeed`/`sync`/`fail`/`die`, written `Effect.x` so VIP-6 is not needed |
| Worker | `vip.go`, the `vip` mode of `node.go` | Each print imports `ev` from `vip-events` (`testdata/vip`, `@throws {never}`). The encoding tags `undefined`, `bigint`, `NaN`, the infinities, `-0`, classes and errors (class, name, message, own fields, cause), drops stacks and annotations, and renames fiber ids by first appearance. Reasons and events are never sorted |
| Gating | `testdata/pending/vip.txt` | One `feature:<construct>` line per construct the compiler lacks, owned by `compiler`, naming the VIP and the lane. Campaigns leave pending constructs out unless `VIBELANG_FUZZ_PENDING=1`. A gap is keyed `compile:<code>/<construct>` or `exit:<aspect>/<construct>`; a compile gap of a program holding a pending construct is that construct's line, an Exit gap never is |

| Test | Fails when |
| --- | --- |
| `TestVIPConstructs` | A construct's key, VIP or `Requires` is malformed; a probe fails with no pending line for it or what it requires; or a pending probe passes (XPASS). It runs every probe under `-short` too |
| `TestVIPTemplatesCited` | A citation's quote is not verbatim in its VIP; a template is neither in a code block of its VIP nor given a `Reading`; a reading the VIP now shows in code is still there; or a probe's reference print lacks its template. It lists every reading |
| `TestVIPCoverage` | An accepted VIP in the README has no construct, `not-runtime` line or `not generated` line, or a pending line names a construct or VIP that does not exist |
| `TestVIPExitEncoding`, `TestVIPCanonicalExit` | Hand-written Exits (success, typed failure, defect, interruption, `ensuring(fail(A), die(D))`, a sleep, `never`, a hot and a plain `main`) encode wrongly, or the comparison names the wrong aspect |
| `TestVIPReferenceDeterminism` | A reference whose two runs differ is not reported as a generator bug |

The target generates VIP-1 effect functions, VIP-2 effect blocks, VIP-4 throw, VIP-5 try and the four catch forms, VIP-6 globals, VIP-7 match on data and errors, VIP-13 errors, VIP-16 and VIP-28 data, VIP-17 fork and join, VIP-18's try operations, VIP-19 for concurrent, and VIP-22 interruption blocks with Effect's finalizers. On 2026-10-29 the compiler implements none of them (lanes vip-core, vip-globals, vip-match and vip-decls are landing them), so each is pending and each probe skips with its line. With `VIBELANG_FUZZ_PENDING=1` the reference side of every generated program runs and encodes, and the VibeLang side fails to compile (`effect function` is TS1434). Today's compiler also reports EK4401 for `ev`, though its declaration says `@throws {never}` (VIP-4: "Library and global functions say what they throw with the JSDoc tag `@throws {ErrorType}`"); once vip-core lands, that would fail as `compile:EK4401/<construct>`.

The designs' probes found VIP-21's `Stream.callback` never ending its queue and VIP-18 not stating `allSettled`'s lowering; both VIPs now state them (`Queue.end`, and `Effect.all(xs.map(Effect.exit), { concurrency: "unbounded" })`). Where a VIP states its Effect TS only in prose or a table, as VIP-5's `catch` and VIP-7's `match` do, the construct carries a `Reading` that `TestVIPTemplatesCited` lists. Runs stay deterministic: forks synchronize through `Deferred` gates, a held child signals ready from inside its `ensuring` (a child interrupted before it reaches `ensuring` registers no finalizer), and the elements of a `try` operation wait on distinct virtual deadlines.

## How to run

```sh
cd typescript/tsc
export ES_REMOTE_HOST=ubuntu@<host> ES_REMOTE_KEY=~/.ssh/<key>

# The seed corpus, as the smoke run does it:
sh ../../scripts/remote.sh sh -c 'GOFLAGS= go test -short ./internal/vibelangfuzz/...'

# One target's campaign:
sh ../../scripts/remote.sh sh -c 'GOFLAGS= go test -run "^$" -fuzz "^FuzzSpecPrograms$" -fuzztime 10m -parallel 6 ./internal/vibelangfuzz/'

# Every target, then statement coverage per package:
sh ../../scripts/remote.sh sh internal/vibelangfuzz/campaign.sh 5m
```

A new crasher lands in `testdata/fuzz/<Target>/`. The fuzz engine discards its workers' standard error, so a worker that dies of a hang panic or a fatal runtime error reports only `fuzzing process hung or terminated unexpectedly: exit status 2`; `campaign.sh` sets `VIBELANG_FUZZ_WORKER_LOG`, and each worker appends its standard error to `<Target>.workers.log` beside the target's log. The first nightly campaign (2026-10-29) lost two such reasons: the spec generator nested `do` blocks without bound, and 3.5 kB inputs wrote Effect readings of 2 and 3 MB whose compiles outlasted the 30-second hang limit. Minimize it, keep it there, and add its key and its `corpus:` line to `testdata/pending/<area>.txt` with the decision it breaks. Delete both lines in the change that fixes the compiler. `VIBELANG_FUZZ_PENDING=1` puts pending generator features back into campaigns; `VIBELANG_FUZZ_HANG=60s` raises the hang limit on a loaded host. The parity target and the stock consumer need the stock TypeScript that `packages/ts-mapper` pins, installed as the parity target's skip message says.

## Not covered

- Throughput. The host was shared at load 70 to 110, so each campaign ran thousands to hundreds of thousands of inputs. Ten-minute campaigns per target on an idle host would test far more.
- A second implementation. The only differential reference is the specification's Effect TypeScript reading and stock TypeScript for `.ts` files; there is no independent VibeLang implementation to compare against.
- Splicing real-world code. tree-splicer's approach would apply through the tree-sitter grammar in `editors/`, but the suite has no splicer yet.
- Forms the generator does not write, each with its reason in `testdata/pending/programs.txt`: schemas, spans, the callback hatch, the platform entry, module blocks, custom error constructors, generic data, timeouts, `it.effect`, detached and scoped forks, record-shaped `await`, Promise hatches, and typing a service implementation as `Users.Shape` rather than `Users` (D361), which no rule injection checks either.
