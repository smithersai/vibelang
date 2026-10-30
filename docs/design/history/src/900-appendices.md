## Appendices

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

> **Retired handler design.** The first release has no handlers or continuation kernel. `control`, `handle`, `resume`, `abandon` are not supported. [VIP-35](../../vips/0035-handlers-open.md) remains an open proposal; any handler examples and machine descriptions below record the old prototype.

### A. Evidence index

Run everything:

```sh
cd experiments
bun install        # effect@4.0.6 exactly
bun test           # {{testCount}} tests in {{testFiles}} files, about a second
bun test ./tests/runtime-boundaries.test.ts         # runtime boundary regressions
bun test ./tests/acquisition-cancellation.test.ts ./tests/generator-tail-resume.test.ts
bun bench/perform.ts
bun bench/deep-capture.ts
node scripts/wakeup-chain-depth.ts       # F10 depths on this host (also runs under bun)
node scripts/v3-wakeup-chain.mjs 100000  # F10b: the same chain on effect 3.22.3
cd reference-machine && bun install && bun test   # strategy B, 20 tests, about 18 s
```

The docs site build (`site/scripts/build-docs.ts`) runs this suite first and won't build if a test fails.

#### How this revision was checked

The conformance suite exercises the kernel's ownership, interruption, tracing, and cleanup laws. Boundary regressions pin mixed causes, acquisition masking, transferred continuations, and generator tail resumes. The fixes and their regression tests are described in `experiments/KERNEL-CHANGES.md`.

A feature-coverage audit mapped 309 Effect features to the language (`docs/research/effect-feature-coverage.md`); D22-D28 and D37-D43 resolve its gaps. A prototype compiler compiled 46 examples from the specification (D44-D53). A single-pass experiment reached the same lowering, byte for byte, with one TypeScript check per file (D56 and D52).

#### Effect facts

| ID | File | What it shows |
| --- | --- | --- |
| F1-F3 | `tests/effect-facts.test.ts` | JavaScript `finally` and `catch` in `Effect.gen` don't run when a yielded effect fails or the fiber is interrupted |
| F4 | same | A JavaScript exception in a generator body is a defect |
| F5, F6 | same | `Effect.callback` ignores every resume after the first; an asynchronous resume runs the fiber on the resumer's stack |
| F7, F8 | same | A child snapshots Context at fork, and nothing flows back; `forkChild` children are interrupted when the parent completes |
| F9 | same | Direct recursion limit: about 39,900 frames on Bun 1.4.1 and 10,150 on Node 26.10 |
| F10a, F10b | `tests/wakeup-chain.test.ts`, `scripts/` | A chain of `Deferred` wake-ups exhausts a logical stack budget in one fiber and strands the rest; effect 3.22.3 completes the same chain at 100,000 hops |
| F11a-F11e | `tests/defect-precedence.test.ts` | Effect 4.0.6 makes a failure beside a cleanup's or a sibling's defect a defect, first; typed recovery skips a cause with a defect; an interruption doesn't block recovery; `mapError` maps every failure; `timeout` still drops a loser's cleanup failure (D305, D256) |
| T5a, T6b | `tests/kernel.test.ts` | `Effect.callback` drops a late resume silently; plain JavaScript recursion overflows |
| D01-D05 | `tests/conformance/source-claims.test.ts` | Corrections to the first draft's Effect claims: synchronous callback resume, fork-time async context, `zip`'s `concurrent` flag, `catchCause` on a self-raised interrupt, sibling provides sharing a supplied `MemoMap` |
| A3 | `tests/fiber-behavior.test.ts` | Two providers for one key in `Layer.merge`: the later one wins silently |
| K15a | `tests/kernel-regressions.test.ts` | Default `acquireRelease` masks a wait: interruption waits for the value, which is then released |

#### Kernel laws

| ID | File | What it shows |
| --- | --- | --- |
| T1 | `tests/trace.test.ts` | Nested suspension and resumption keep Context and Scope; the clause sees the outer Context; the fiber waits at its root while the continuation is held |
| T2-T4 | `tests/kernel.test.ts` | Double resume is a defect; a clause that returns without resuming abandons first; interruption order is clause, continuation, outer |
| T5b, T5c, K10a, K10b | `tests/kernel.test.ts`, `tests/wakeup-chain.test.ts` | `suspend` reports lost races, delivers once, survives a 100,000-fiber chain, and releases a deferred value that loses to cancellation |
| T6a | `tests/kernel.test.ts` | 100,001 nested compiled frames captured in one operation and resumed |
| T7a, T7b, T8 | same | Capture through TypeScript-authored `Effect.forEach`; forking combinators and child fibers can't reach the parent's prompt |
| T9-T11 | same | Deep handlers; external iteration with `transfer`; retry runs fresh continuations |
| T12-T15 | `tests/kernel-edges.test.ts` | Pending interruption at resume; resume-site Context; fiber-affine abandonment (T14b caught a real bug); `HandlerPromptExited` instead of rebinding |
| T16, T17 | `tests/producers.test.ts` | `for...of` lowering: `break` runs the producer's finalizer first; 100,000 elements in constant stack with a `flatMap`-shaped clause |
| K11a-K11d | `tests/kernel-regressions.test.ts` | A generator clause that returns `tailResume` iterates 100,000 elements at 3 frames, 5 with a per-element `using` and `finally`; yielding a tail-resume request is a defect; a resume inside a `finally` region isn't a tail resume |
| K12a-K12e | same | Abandonment reports every cleanup failure beside real pending interruptions: explicit `abandon`, `abandonNow`, owner exit, and Scope exit |
| K13a-K13e | same | A transferred continuation never outlives its capturing fiber; transfer into a parallel Scope is rejected |
| K14a-K14d | same | `catchExpected` follows `Effect.catch`: it recovers the first expected failure of a cause with no defect and drops an interruption beside it (D306); a cause with a defect passes as defects; an abandonment passes through untouched |
| K15b, K15c | same | Interruptible acquisition: cancellation wins, and late or deferred values are released |
| K16a-K16d | same | Where the kernel combines or re-raises a cause (owner exit, fiber exit, `catchExpected`), a failure beside a defect is a defect; an expected cleanup failure stays expected (D305) |
| H1-H4 | `tests/handoff.test.ts` | Handoff: one delivery; late delivery during asynchronous shutdown released before cancellation completes; deferred delivery released; delivery after quiescence rejected |
| G6a, G6b | `tests/context-bridges.test.ts` | Spans are correct across capture; `AsyncLocalStorage` isn't delimited |
| Probes | `tests/fiber-behavior.test.ts` | 17 combinators keep control on the performing fiber; 7 move it to other fibers |
| A01-A04 | `tests/conformance/abandonment.test.ts` | Finalizer failures and swallowed aborts surface at every abandoning boundary |
| F01-F09 | `tests/conformance/frames.test.ts` | Effect's own frames (restore closures, masks, nested prompts, iterator frames, finalizers) behave correctly when spliced |
| I01-I11 | `tests/conformance/interruption.test.ts` | Interruption at capture, at resume, and during abandonment; real interrupts are never lost or mixed with the internal abort |
| O01-O08 | `tests/conformance/ownership.test.ts` | Nested owners, transfer, revocation, fiber affinity, and the ownership-cycle check |
| S01, S02 | `tests/conformance/scopes.test.ts` | `Effect.scoped`, `acquireRelease`, and Layer resources across resume and abandonment |
| T01, T02 | `tests/conformance/tracing-cache.test.ts` | `Effect.fn` and `withSpan` frames across capture; `Context.Reference` and fiber caches at every boundary |
| W01-W05 | `tests/conformance/wake.test.ts` | Wake budget ordering and release on every losing path |
| X01, X02 | `tests/conformance/async-frames.test.ts` | Effect's async finalizer frame inside a captured segment |
| B | `reference-machine/` | The independent strategy-B machine: 20 tests on the same laws |

The conformance suite (A, D, F, I, O, S, T, W, X) covers the kernel laws. Tests that encoded the old behavior as counterexamples now assert the corrected behavior.

#### Runtime boundary regressions

Runtime counterexamples are kept as observational tests. A probe of a fixed defect now asserts the fixed behavior.

| ID | File | What it showed |
| --- | --- | --- |
| Boundary | `tests/runtime-boundaries.test.ts` | `Effect.catch` recovers a cause holding both a failure and a defect, and drops the defect (D13, K14); true of Effect 4.0.5, fixed in 4.0.6 (D305) |
| Boundary | same | Owner-driven abandonment keeps a cleanup defect; explicit `abandon` dropped it while an interruption was pending (D15, K12) |
| Boundary | same | Default `acquireRelease` shields `suspend` from cancellation (D25, K15) |
| Boundary | same | Inlining an `Effect.sync` operation removes an interruption point (D10) |
| Boundary | same | A child that transfers into its inherited Scope and exits stranded the segment (D16, K13) |
| Boundary | same | A TypeScript function forks its operation without taking a program argument (D20) |
| Boundary | same | A provider around `resumeWith` can't satisfy the injected program's R (D17) |
| Boundary | same | A block-wide Scope closes acquisitions not marked `using` (D14) |
| Boundary | same | Strategies A and B disagree on the next clause's Context after a resume (G16) |
| Boundary | same | A generator clause written `return yield* resume(k, v)` defeats constant-stack iteration (D18, K11) |
| Acquisition and tail resume | `tests/acquisition-cancellation.test.ts` | The masked adapter's race branches never run; generator clauses grow 200,003 frames over 100,000 elements before K11 |
| Services | `tests/service-identity/probe.ts` | Structurally equal abstract classes alias in R, and the program dies with `Service not found` (D1) |

#### Prototype compiler

The prototypes predate the rename to VibeLang, so their sources keep the old `.es` extension.

```sh
# From the repository root:
bun prototype/esc/examples/run-all.ts       # 46 of 46 example files pass, about 16 s
bun prototype/esc/src/cli.ts build prototype/esc/examples/ch01-first-look.es
bun prototype/esc/src/cli.ts run prototype/esc/examples/ch09-handlers.es
```

| What | Where | What it shows |
| --- | --- | --- |
| The compiler | `prototype/esc/src/` | Type-directed lowering of `.es` to TypeScript on `typescript@5.9.3`, with the experiments kernel as its runtime; about 3,560 lines |
| 26 runnable examples | `prototype/esc/examples/*.es` | Each compiles without errors and produces its stated result, including the six reference programs (`ref1` to `ref6`) |
| 20 expected failures | `prototype/esc/examples/*.fail.es` | Each reports its diagnostic code at the right span |
| `regions.es` | same | Completion records through nested `try`, `catch`, and `finally` match plain JavaScript's results and order |
| `stack-depth.es` | same | Producer loops and handler clauses stay under 50 frames over 100,000 elements |
| `scratch/probe2.ts` | `prototype/esc/scratch/` | The service emission of D45: nominal R, working `implements`, and a parameter typed with the service meaning its methods |
| Findings | `prototype/esc/FINDINGS.md` | Thirty findings, settled by D44-D53 |

#### Single-pass experiment

```sh
cd prototype/single-pass      # from the repository root
bun patch/apply.ts            # copy TypeScript 5.9.3 to typescript/ and patch it
bun harness/compare.ts        # the corpus: 46 of 46 files, about 10 s
bun harness/compare.ts --dir "$PWD/probes" --verbose
bun harness/passes.ts         # the prototype's decision changes per pass
```

| What | Where | What it shows |
| --- | --- | --- |
| The patched checker | `prototype/single-pass/patch/es-checker.js` | Each lambda classified per overload candidate inside `chooseOverload`, D10 on demand, and narrowing through the call rule: one 668-line block and 15 hooks in TypeScript 5.9.3 |
| The comparison | `prototype/single-pass/harness/compare.ts` | One check per file reaches the prototype's lowering in 46 of 46 files: 817 call sites, 257 lambdas and methods, 0 disagreements, byte-identical output, 46 checks instead of 124 |
| The probes | `prototype/single-pass/probes/` | 17 disagreements: 16 from 6 lambdas with two self-consistent lowerings (D56), 1 from mutual recursion (D52) |
| Results | `prototype/single-pass/RESULTS.md` | The method, the per-file table, and the rules for the Go checker (Chapter 27) |

#### The Go fork

```sh
cd typescript                    # from the repository root
vibelang/smoke.sh            # builds tsc (about 75 s cold), then compiles and runs every case
vibelang/smoke.sh vibelang-infer   # one case
```

| Case | What it shows |
| --- | --- |
| `vibelang-wrap` | Functions lower to `Effect.fnUntraced` generators, and JavaScript runs them |
| `vibelang-lower` | Calls run by type: plain-annotated helpers stay plain, Effect-returning calls run, operands run left to right, and a `Config` stays data |
| `vibelang-infer` | Unannotated functions get `Effect<A, E, R>`: a typed failure flows from `lookup` into `main`, and the `.d.ts` declares it |

`typescript/VIBELANG.md` records the base, the 11 commits, the upstream lines it changes, and the differential check against the prototype.

#### Research and drafts

- `docs/design/DECISIONS.md`: the decision log, D1-D520, the record of why each rule is what it is (D360).
- `docs/research/effect4-runtime.md`: Effect 4.0.5 runtime facts, with 23 scripts in `experiments/scripts/runtime-facts/`. Scripts written for this design live in `experiments/scripts/`.
- `docs/research/continuation-prior-art.md`: OCaml 5, Kotlin, Swift, Loom, WasmFX, Koka, Effekt, Effection, js_of_ocaml, and the papers.
- `docs/research/vibelang.md`: the earlier VibeLang project's `main` (`c60eca97`) and the unmerged checkpoint (`ebe89a2b`).
- `docs/research/typescript-native-compiler.md`: the native compiler upstream and effect-tsgo.
- `docs/research/independent-design.md`: an independent semantics proposal from the same language requirements.
- `docs/research/pipe-census.md`: how real Effect code uses `pipe` (D8).
- `docs/research/tc39-syntax.md`: the status of every TC39 proposal that could give syntax to an Effect feature, fetched 2026-10-16.
- `docs/research/effect-feature-coverage.md`: every Effect docs section mapped to the language (Appendix C).
- `experiments/KERNEL-CHANGES.md`: the 2026-10-16 kernel fixes.
- `prototype/esc/FINDINGS.md`: what the prototype compiler found.
- `prototype/single-pass/RESULTS.md`: the single-pass experiment (D56, D52).
- `typescript/VIBELANG.md`: the Go fork's base, commits, seams, and gaps.
- [Upstream draft index](../../upstream/README.md): nine Effect runtime, tooling, documentation, and API drafts with reproductions; all drafted, none filed (D59).

### B. Prior art

`docs/research/continuation-prior-art.md` has the full notes, with quoted sources. Rule numbers refer to its final section.

| Question | Prior art | VibeLang |
| --- | --- | --- |
| Second resume | A runtime error everywhere it is checked: OCaml `Continuation_already_resumed`, Kotlin "Already resumed", Swift's checked continuation traps (6.4 rejects it at compile time), Loom "Continuation terminated", WasmFX traps. `Effect.callback` and Effection drop it silently | Defect at the caller (T2). Root waits keep first-wins and report the loss (rule 1) |
| Abandoned continuations | No system cleans them up from the GC; deterministic cleanup needs a handler or scope that owns the continuation: Koka's final yield, Effection's `return()`, OCaml's `discontinue`, WasmFX's `resume_throw` | Owner frames, Scope ownership, and the capturing fiber's exit; development-only leak reports (rules 3, 4) |
| Cancellation versus resumption | One take-once cell. Only Kotlin hands the losing value to a release hook (`onCancellation`) | Kernel `suspend` reports the loss and releases deferred values (T5b, K10b); `handoff` releases late values after producer quiescence (H2-H4) (rule 2) |
| `finally` in generated code | Effection loses a halt when a delegated `finally` performs an effect; Effect 4 never calls `return()` | Finalizers compile to Effect frames, never JavaScript `finally` (rule 5) |
| Dynamic state across resume | DDB in the delimited-control literature, Racket, and Koka; snapshot in TC39 AsyncContext (at each `await`, and a generator's creation-time context), Effect 4, Kotlin, Swift, and tokio | Snapshot, unlike the research recommendation (rule 6); Chapter 22 gives the reasons and the cost |
| Tail-resumptive operations | Run in place: 10× on Koka's counter benchmark, under the handler's evidence | Run in place under the caller's Context, as Effect services do; call-time lookups must be in the contract (Chapter 4). Differs from rule 7 on whose Context |
| Handler identity | Generative tags (WasmFX), labels (Koka), capabilities (Effekt) | Handler instances, found through Context evidence (rule 8) |
| Multi-shot | Excluded by every fiber or thread runtime; Kyo stays single-shot so it never re-enters a released bracket | Excluded (rule 9) |
| Foreign frames | Every system refuses to capture through them (OCaml `Unhandled`, js_of_ocaml, JSPI `SuspendError`, Racket barriers) | Rejected at compile time (EK4301, EK4202); unhandled at run time (rule 10) |
| Which code gets transformed | Selective: Koka cut CPS-translated functions by over 80%; Stopify measured generators at about 2× slower than exception-based capture | Frames only where capture or parking is reachable (Chapter 15; rule 11) |
| Cross-fiber resume | Kotlin and Swift always schedule | Bounded synchronous wake-ups (Chapter 24; rule 12) |
| Resumable handlers on Effect-TS or ZIO | None found by searches of npm, GitHub code (`fiber._stack`, `"~effect/Effect/successCont"`), and Effect issues and discussions on 2026-10-15. Effect's maintainer: generators "are only valid to express `one-shot` effect types" | No other implementation is known; this kernel is one-shot by design. The claim fails if a search turns one up |

#### TC39 proposals and VibeLang

Stages as fetched on 2026-10-16 (`docs/research/tc39-syntax.md`).

| Proposal | Stage | In VibeLang |
| --- | --- | --- |
| Explicit Resource Management (`using`) | 4 since 2026-05-19, for ES2027 | Adopted: `using` with Effect's guarantees (Chapter 6) |
| Pipeline operator (Hack `\|>`) | 2 since 2021-08; topic token undecided; "somewhat stuck" (January 2026) | Adopted in `.vibe` files with the topic `%`, which is the value of the left side, evaluated once (Chapter 5, D154; supersedes D8) |
| AsyncContext | 2 | Prior art for the snapshot rule (Chapter 22). VibeLang code keeps request-scoped values in Effect's Context |
| Partial application (`f~(x, ?)`) | 1 | Not adopted. A function with no arguments is the program spelling (D7) |
| Pattern matching (`match`, `is`) | 1 | Adopted, a subset: `match` expressions with `when` arms, `is`, extractors, and custom matchers; regular expression and relational patterns are not (Chapters 3 and 11, D206-D215) |
| Throw expressions | 2, unchanged since 2017 | Adopted: `x ?? throw new NotFound()` fails as the throw statement does (Chapter 3, D186) |
| Extractors | 2 | Adopted in match patterns, such as `Option.Some(let value)` (Chapter 3, D207) |
| Import defer | 3 | Not used. Deferring a module's evaluation doesn't change EK1001: its top level still can't run a program |
| Await dictionary (`Promise.allKeyed`) | 3 | Adopted as the object operand of `await.all` and `await.allSettled` (Chapter 7, D196) |
| Await operations (`await.all`, `await.race`, …) | 1 | Adopted: `await.all`, `await.allSettled`, `await.race`, and `await.any` start programs concurrently and behave as the `Promise` methods (Chapter 7, D196) |
| Do expressions | 1 | Adopted: `do { … }` is an expression whose value is its last statement's (D187) |
| Block params | 1 | Adopted: a block after a call is a program passed as its last argument, `it.effect("greets") { … }` (D188, D376) |
| Module declarations | 2 | Adopted as an escape to TypeScript, with ECMAScript module semantics; module expressions and nested declarations are not supported (Chapter 11, D283, D364) |
| Abort Controller, Concurrency control | 1 | Not adopted. Effect's interruption and `concurrency` options |
| F#-style pipes; `Function.pipe` and `flow` | Failed Stage 2; withdrawn | Not applicable |

### Grammar

VibeLang's grammar is TypeScript's, as the pinned compiler's parser accepts it for a `.ts` file (Chapter 27: `microsoft/TypeScript` at `257e874`, TypeScript 7.1), with the changes this section states [Rule] (D419). Each change names the rule that gives it meaning; a nonterminal this section does not define is TypeScript's or ECMA-262's. A `.ts` file and a `module` declaration's body use TypeScript's grammar unchanged. A hatch's first argument is parsed by this grammar and then checked as TypeScript, so a VibeLang form inside it is an error that names it, such as EK2114 for a catch expression and EK4612 for `join`.

Notation, as in ECMA-262 where it can be: a token is quoted; `X?` is optional, `X*` repeats, `X+` repeats at least once, `|` separates alternatives; `[nLT]` is ECMA-262's [no LineTerminator here]; `[lookahead ≠ t]` excludes a next token.

#### Contextual words

No word VibeLang adds is reserved. Each is a keyword only in the position the table gives, and an identifier everywhere else, so `const match = 1`, `error.message`, `words.join(",")`, and a local function named `fork` called as `fork(x)` parse as in TypeScript; `fork(x)` and `join(x)` always parse as a call, whatever `fork` and `join` resolve to, and which of them is the keyword follows rule H5 (D452).

| Word | A keyword where | Production |
| --- | --- | --- |
| `error`, `service`, `control`, `schema`, `data` | At the start of a statement, or after `export`, `declare`, or `abstract`, followed on the same line by an identifier; `schema` also by `error` | Declarations |
| `mutable` | Before a property or index signature's name on the same line, in an interface or object type (D134) | Declarations |
| `module` | At the start of a top-level statement, followed on the same line by an identifier and `{` (D283) | ModuleDeclaration |
| `try` | Followed by `(` where an expression starts: a call of the hatch; followed by `{`, TypeScript's try statement (D149) | TypeScript's call |
| `fork` | At the start of a unary expression, followed on the same line by an identifier other than `as`, `satisfies`, `in`, `instanceof`, or `is`, or by `this`, `new`, `super`, `await`, or `{`; followed by `(`, it is TypeScript's call of the identifier, which rule H5 reads (D166, D391, D443, D452) | ForkExpression; CallExpression |
| `join` | At the start of a unary expression, followed on the same line by an identifier other than `as`, `satisfies`, `in`, `instanceof`, or `is`, or by `this`, `{`, or, after white space, `[`; followed by `(`, TypeScript's call of the identifier, which rule H5 reads; `join[i]` without the space is an element access (D225, D391, D443, D452) | JoinExpression; CallExpression |
| `await` `.` `all`, `allSettled`, `race`, `any` | Always; followed by `(`, a call in shape; a plain `await` parses as TypeScript's and is EK4601-EK4604 (D196, D226, D452) | AwaitOperation; AwaitCall |
| `provide` | At the start of a statement, followed on the same line by a provider or `(` (D172) | ProvideStatement |
| `uninterruptible`, `interruptible`, `restore` | At the start of a statement, followed on the same line by `{` (D180) | MaskStatement |
| `concurrent` | After `for` on the same line (D169) | ForConcurrentStatement |
| `handle` | After a try statement's block or another handle clause (D132) | HandleClause |
| `catch` | After an expression; after a try block it is TypeScript's (D236) | CatchExpression |
| `match` | Followed, with no line break, by a parenthesized expression, then by `{` on the same line, whose next token, on any line, is `when`, `default`, or `}` (D206, D443) | MatchExpression |
| `when`, `default` | At the start of a match arm | MatchArm |
| `is` | After an operand of a relational operator, as `instanceof` (D211) | RelationalExpression |
| `and`, `or`, `not`, `let`, `if` | Inside a pattern | Pattern |
| `infer` | As a channel of a function's return annotation (D57), or as the whole return annotation, `: infer _` (D500) | Contract, ReturnTypeAnnotation |
| `throw`, `do` | Where an expression is expected; at the start of a statement they are TypeScript's statements (D186, D187) | ThrowExpression, DoExpression |

`%` where an expression starts is the pipe's topic; after an operand it is the remainder operator, so `n |> % % 2` is `n % 2` (D154, D156).

#### Types

```text
Type :
  FunctionType | ConstructorType | ConditionalType           TypeScript's; a FunctionType's return type may be a Contract
ConditionalType :
  CheckType
  CheckType "extends" UnionType "?" Type ":" Type             only where CheckType is a UnionType, or parenthesized
CheckType :
  UnionType
  Contract
Contract :                                                    A!E!R is Effect<A, E, R> (D127, D309)
  UnionType "!" [nLT] Slot? "!" [nLT] FinalSlot?              A!E!R, A!E!, A!!R, A!!
  UnionType "!" [nLT] FinalSlot                               A!E: R inferred on a function with a body, else never (D335)
Slot :
  [lookahead ≠ "{"] UnionType
FinalSlot :
  [lookahead ≠ "{"] UnionType
  [lookahead ≠ "{"] UnionType "extends" UnionType "?" Type ":" Type
InferChannel :
  "infer" Identifier                                          a Slot, FinalSlot, or type argument of Effect<…> in the return annotation of a function with a body (D57, D414)
ReturnTypeAnnotation :                                        D500
  ":" Type                                                    a definitely-Effect Type, a Contract included, makes an Effect function; any other Type a plain function
  ":" "infer" "_"                                             a plain function whose return type TypeScript infers from its body
```

UnionType includes intersections, postfix `[]`, indexed access, and the prefix operators `keyof` and `typeof`, so each binds inside a slot (Chapter 14's table). A function declaration, function expression, arrow function, method, or accessor's return annotation is a ReturnTypeAnnotation; with none, a function or method is an Effect function, unless rule F gives a function literal its destination's form, and an accessor, which runs as plain JavaScript, is not a function in this sense (Chapter 13, D282, D500). `infer` followed by any name but `_` there is TypeScript's TS1338. A `!` after a function type's return type belongs to that return type, and a conditional after the last slot belongs to that slot. A `{` after a `!` starts the function's body in a return annotation, so an object type in a slot is parenthesized.

#### Declarations

```text
VibeDeclaration :
  ErrorDeclaration | ServiceDeclaration | ControlDeclaration | SchemaDeclaration | DataDeclaration
ErrorDeclaration :                                            D126, D278, D279, D304
  "abstract"? "schema"? "error" [nLT] BindingIdentifier TypeParameters? ClassHeritage? ClassBody?
ServiceDeclaration :                                          D128, D223, D281
  "service" [nLT] BindingIdentifier ClassBody
  "service" [nLT] BindingIdentifier ":" Type ClassBody?
ControlDeclaration :                                          D128, D223
  "control" [nLT] BindingIdentifier ClassBody
SchemaDeclaration :                                           D133, D280
  "schema" [nLT] BindingIdentifier "{" SchemaField* "}"
  "schema" [nLT] BindingIdentifier "=" Type
SchemaField :
  "mutable"? PropertyName "?"? ":" Type
DataDeclaration :                                             D307
  "data" [nLT] BindingIdentifier TypeParameters? "{" DataVariant* "}"
DataVariant :
  Identifier
  Identifier "{" DataField* "}"
DataField :
  PropertyName "?"? ":" Type
ModuleDeclaration :                                           D283, D364, D403
  "module" [nLT] BindingIdentifier "{" ModuleBody "}"         a top-level statement only (EK4408); the body is TypeScript
FromClause :
  "from" StringLiteral
  "from" IdentifierReference                                  names a ModuleDeclaration of the file (EK4407)
```

A VibeDeclaration may follow `export`, and `declare` where TypeScript allows it. In an `error`, `service`, `control`, or `schema` body, and in a data declaration, fields and variants are separated by `;` or a line break; a `,` is EK1013. In an interface or object type, `mutable` before a member's name on the same line makes it writable (D134); every other member there is readonly.

#### Statements

```text
TryStatement :
  "try" Block HandleClause+ Catch? Finally?                   D132
  "try" Block Catch Finally?                                  TypeScript's
  "try" Block Finally
HandleClause :
  "handle" MemberExpression "(" FormalParameters ")" Block    MemberExpression names a control's operation
Finally :
  "finally" Block
  "finally" "(" BindingIdentifier ")" Block                   D178
ProvideStatement :                                            D130, D172, D173
  "provide" [nLT] ProviderList [nLT] Block
  "provide" "(" ProviderList ")" Block
ProviderList :
  Provider ("," Provider)*
Provider :
  LeftHandSideExpression "=" AssignmentExpression             one service, Key = value
  AssignmentExpression
MaskStatement :                                               D180
  ("uninterruptible" | "interruptible" | "restore") [nLT] Block
ForConcurrentStatement :                                      D169, D354
  "for" [nLT] "concurrent" ("(" AssignmentExpression ")")? "(" ForDeclaration "of" AssignmentExpression ")" Statement
```

In a ProviderList, a `{` where a provider starts is an object literal, and a `{` after a complete provider ends the list and starts the statement's block: a provider is never followed by a block param (D188). ECMAScript's `using` declarations and `for (using …)` loops keep their grammar, with Chapter 6's meaning.

#### Expressions

```text
PrimaryExpression :
  TypeScript's | TopicReference | DoExpression | MatchExpression
TopicReference :                                              D154, D156
  "%"                                                         only in a pipe's body (EK1007)
DoExpression :                                                D187, rule L5
  "do" Block
MatchExpression :                                             D206
  "match" [nLT] "(" Expression ")" [nLT] "{" MatchArm* DefaultArm? "}"
MatchArm :
  "when" Pattern ":" AssignmentExpression ";"                 a guard is a PatternTerm: when P and if (e): (D207, D502)
DefaultArm :
  "default" ":" AssignmentExpression ";"
CallExpression :
  TypeScript's                                                fork(x) and join(x) included, which rule H5 reads (D452)
  AwaitCall
  CallExpression [nLT] Block                                  f(args) { … } is f(args, () => { … }) (D188, D376)
  MemberExpression [nLT] Block                                f { … } is f(() => { … })
AwaitCall :                                                   D196, D452
  "await" "." AwaitName [nLT] "(" AssignmentExpression ")"    a call in shape: what follows the ")" applies to its value
UnaryExpression :
  TypeScript's | ForkExpression | JoinExpression | AwaitOperation | ThrowExpression
ForkExpression :                                              D166, D391, D452
  "fork" [nLT] [lookahead ≠ "("] UnaryExpression
  "fork" [nLT] Block
JoinExpression :                                              D225, D391, D452
  "join" [nLT] [lookahead ≠ "("] UnaryExpression              a "{" here starts an object literal
AwaitOperation :                                              D196, D377, D394, D452
  "await" "." AwaitName [nLT] [lookahead ≠ "("] UnaryExpression
AwaitName :
  "all" | "allSettled" | "race" | "any"
ThrowExpression :                                             D186
  "throw" UnaryExpression
RelationalExpression :
  TypeScript's
  RelationalExpression "is" Pattern                           D211
CatchExpression :                                             D236, D237
  ShortCircuitExpression
  CatchExpression "catch" ShortCircuitExpression              x catch fallback
  CatchExpression "catch" ArrowParameters "=>" ConciseBody    x catch (e) => h
ConditionalExpression :
  CatchExpression
  CatchExpression "?" AssignmentExpression ":" AssignmentExpression
PipeExpression :                                              D154
  ConditionalExpression
  PipeExpression "|>" ConditionalExpression
AssignmentExpression :
  TypeScript's, with PipeExpression where TypeScript has ConditionalExpression
```

A block param is not taken after `new`, in a heritage clause, or after a provider (above). A statement that starts with `throw`, `do`, `{`, or `match` followed by a line break is TypeScript's statement, not one of these expressions. The arguments of a CallExpression, a block param included, follow rule E1, except the one operand of `fork(x)`, which rule D defers when rule H5 makes the call the keyword, and the elements of an array or object literal written as an AwaitCall's operand, which rule D defers as it defers an AwaitOperation's (D462); `join(x)`'s operand is evaluated once (E7), and the prelude's `fork` and `join` take exactly one operand.

#### Patterns

```text
Pattern :                                                     D206, D207
  PatternTerm
  PatternTerm ("and" PatternTerm)+
  PatternTerm ("or" PatternTerm)+                             mixing "and" and "or" at one level is EK4705
PatternTerm :
  "not" PatternTerm
  "(" Pattern ")"
  LiteralPattern                                              a string, numeric, or bigint literal, "-" NumericLiteral, true, false, null, undefined
  ("let" | "const" | "var") BindingIdentifier
  "[" (PatternElement ("," PatternElement)*)? ","? "]"
  "{" (PatternProperty ("," PatternProperty)*)? ","? "}"
  MatcherReference
  MatcherReference "(" (Pattern ("," Pattern)*)? ")"         an extractor
  MatcherReference "{" ("let" BindingIdentifier (";" | ",")?)* "}"   a data variant's fields (D307, EK4706)
  "if" "(" Expression ")"                                     a guard: matches when Expression is truthy; it reads only the bindings of terms tested before it, in Chapter 26's pattern order, and a reference to one a later term binds is EK4704; an arm whose pattern contains a guard removes nothing for exhaustiveness (D207, D502, D520)
PatternElement :
  Pattern
  "..." ("let" | "const" | "var") BindingIdentifier
PatternProperty :
  ("let" | "const" | "var") BindingIdentifier
  PropertyName ":" Pattern                                    a computed key other than a name or literal is EK4704
  "..." ("let" | "const" | "var") BindingIdentifier
MatcherReference :
  IdentifierReference ("." IdentifierName)*                   resolved by scope (rule H4, D367)
```

Regular expression and relational patterns are EK4704 (D212). A binding inside `or` or `not` is EK4702, and an `is` that binds outside an `if` or `while` condition is EK4703 (Chapter 30's restrictions).

#### Line breaks

- Every `[nLT]` above is a place where a line break ends the form: a contract's slot, the operand of `fork`, `join`, and the await operations, a block param, `match`, and the block of `provide` and the masks.
- A `{` that begins a line after a statement that ends, with no `;`, in an identifier, a member access, or a call is EK1022, a syntax error: on one line it would be a block param, and on the next JavaScript makes it a block statement (D376).
- Otherwise automatic semicolon insertion is ECMAScript's; a match arm's `;` may be left to it (D206).

#### Precedence

From the tightest: member access, calls and block params, the parenthesized forms of `fork`, `join`, and the await operations included (D452); the unary operators, `fork`, `join`, the await operations, and `throw` in an expression; TypeScript's binary operators, with `is` at `instanceof`'s level; `&&`, `||`, and `??`; `catch`, left-associative; `? :`; `|>`, left-associative; assignment and arrow functions; the comma. Chapter 13 gives each form's decision, and Chapter 14 the precedence inside contracts.

### Glossary

The terms the rules use. A term defined here means only this in a rule.

| Term | Meaning |
| --- | --- |
| Abandonment | Ending a captured continuation without resuming it: its owner unwinds it as an interruption, running its finalizers (Chapters 20, 21) |
| Call that runs | A call whose callee's declared return type is definitely an `Effect`, or whose callee is itself an Effect value, `p()`: it runs the program on the current fiber and evaluates to its success value (Chapter 13). A call of a plain function is a plain call, which plain code may make (D445), unless its return type is definitely an Effect: then it is one, and runs the program the function returns (D480) |
| Contextual keyword | A word that is a keyword only in the position the grammar gives, such as `fork` before its operand, and an identifier elsewhere (Grammar) |
| Cause | Effect's record of why a program did not succeed: an ordered list of reasons, each a Fail (an expected failure), a Die (a defect), or an Interrupt (Chapter 17) |
| Cold | Of a program: building it runs none of its work, and each run starts its work afresh |
| Context | Effect's map from service identifiers to implementations, which a running program reads its services from |
| Contract | A function's `Effect<A, E, R>`, written as `A!E!R` or `Effect<A, E, R>`, or inferred: its success type, expected failures, and requirements (Chapter 14) |
| Control operation | A member of a `control` declaration: a request a handler answers, which may capture the continuation (Chapter 9) |
| Data type | A `data` declaration, or a tagged union declared with `Data.taggedEnum`: a closed set of tagged variants (Chapter 11) |
| Declared return type | The return type written in the declaration a call's resolved signature comes from, or the one TypeScript infers for that declaration where none is written; for a `.vibe` Effect function, its contract, and for a plain function, its return annotation or, under `infer _`, the type TypeScript infers. A type parameter that the signature of the callee's type, as TypeScript writes that type, itself declares is left uninstantiated, however it is bound, and every other is read as TypeScript instantiates it for the call, whatever construct declares it, so one TypeScript shows uninstantiated, as inside its own generic declaration, is a type parameter; an instantiation expression's value declares no type parameter it bound (Chapter 13, D438, D449, D458, D486, D491) |
| Definitely an Effect | Of a type: the `Effect` interface with any type arguments, written directly or through an alias; a conditional whose every branch is definitely an Effect or `never`; or a union whose every member is. Never a type parameter, `any`, `unknown`, an intersection, or a type that extends `Effect` (Chapter 13, rule R) |
| Destination | Where a function or a value lands and is typed: the parameter of the signature a call resolves to, a declared variable, field, or return type, a field of a contextually typed object literal, or an element of a contextually typed array literal; its declared type gives a function literal there its form (Chapter 13, rule F, D500) |
| Defect | A failure no contract lists: a bug or an unlisted foreign exception. It is a Die reason, outside E, and `catch` does not receive it (Chapter 17) |
| Direct variant | The plain-JavaScript copy the compiler may give an Effect function whose body performs no Effect operation, which VibeLang callers in Effect code call instead of its Effect form: an optimization of its calls that no destination receives and no declaration names (Chapter 15, D421, D500) |
| Effect function | A function whose form is Effect: one with no return annotation or an Effect contract, or a function literal its destination makes one. TypeScript sees it returning a cold `Effect`, and a VibeLang call of it runs that program (Chapter 13, rule F, D500) |
| Evaluate | To compute an expression's value, once, in source order. The value may be a program, which evaluating does not run |
| Expected failure | A value thrown with `throw`, or failed with by a callee: a Fail reason, in E, which `catch` receives (Chapter 3) |
| Foreign code | Code the compiler does not check: TypeScript and JavaScript functions, a hatch's or a `module` declaration's body, and a package consumed through declarations alone, except the plain functions its manifest lists as compiled from VibeLang (Chapter 27, D500, D516) |
| Form | Of a function: plain or Effect. It is written: a return annotation that is not definitely an Effect, or `infer _`, makes a function plain; a function literal at a destination takes the form the destination's declared type gives it; every other function is an Effect function. A body never decides it. A function value has the form its type gives, so a plain declaration whose return type is definitely an Effect, `pick(p: number!!): infer _`, is an Effect-form value (Chapter 13, rule F, D500, D511) |
| Frame | A heap record of an activation on a fiber's stack, where the state of a computation that can capture or park lives (Chapter 26) |
| Hatch | `sync`, `try`, or `callback`: a call whose first argument is TypeScript, the boundary to foreign code (Chapter 10) |
| Identifier | A service's nominal type, which R holds: the instance type of Effect's `Context.Service` class, which carries the service's key as a literal type (Chapter 4, D501) |
| Interruption | Cancellation of a fiber, an Interrupt reason; never caught by `catch` (Chapter 17) |
| Key | A service's value: Effect's `Context.Key`, through which a program looks the service up and a layer provides it (Chapter 4) |
| Layer | Effect's `Layer<Out, E, In>`: a recipe that builds the services `Out`, may fail with `E`, and needs `In` (Chapter 4) |
| Live binding | An import that reads the exporting binding's current value at each use, as an ECMAScript import does (Chapter 26) |
| Observation | What a run of a program shows the world: its exit and Cause, its effects outside the program in order and number, its bindings, its lifetimes, and its suspension points. Two programs are observationally equivalent when every observation is the same (Chapter 26) |
| Pause | A point where a fiber parks or captures its continuation: a sleep, a wait on the outside world, a control operation, or any call whose callee's control class is `suspends` or `captures`. A plain function may not reach one (EK2003, EK4301), an Effect function that can reach one gets no plain variant, and interruption reaches a fiber at a pause or between two steps (Chapters 15, 17) |
| Plain code | Code that runs as plain JavaScript: a module's top level, a class field initializer, a constructor, an accessor, a static block, a parameter default, a function with a plain contract, and a plain callback. It calls plain functions and makes no call that runs (Chapter 13, D445, D480) |
| Plain function | A function whose form is plain: one with a plain return annotation or `infer _`, a function literal at a destination of the plain form, a protocol method, or a method implementing a plain member (D397). It compiles to plain JavaScript, performs no Effect operation, cannot fail with an expected failure, and needs no service (Chapter 15). A call of one is JavaScript's call, wherever it stands, plain code included, unless its return type is definitely an Effect, when the call runs the program it returns (Chapter 13, D445, D480, D500) |
| Prelude | The names every `.vibe` file has in scope without an import: the runtime's exports and Effect's modules (Chapter 1) |
| Producer | What a `function*` call returns: a `Stream` value that carries a cold program yielding values one at a time; `for...of` runs that program on the loop's fiber, and any other consumer through the adapter (Chapter 8, D402) |
| Protocol method | A method JavaScript calls by name without reading a declaration: `toString`, `toLocaleString`, `valueOf`, `toJSON`, `then`, or a method keyed by a well-known symbol or one of the pinned `effect`'s protocol symbols; checked as a plain function (Chapter 10, D397). In an object literal, a field at a protocol key is a destination of the plain form, and holds the plain function (D484) |
| Program | A cold value that runs when something runs it: an `Effect`, or a function with no required parameters, which becomes an `Effect` where one is expected (Chapters 5, 13) |
| Provider | What removes services from R: a layer, a non-empty list of layers, a `Context`, or `Key = value` (Chapter 4) |
| Region | A block the compiler lowers to its own Effect frame: a function body, a loop iteration, a `try`, `catch`, or `finally` block, a block that declares `using`, a `provide` block, a mask. A fiber belongs to the innermost region around its `fork`; braces alone make none (Chapters 7, 26, D408) |
| Requirement | A service a program looks up, an identifier in its R (Chapter 4) |
| Resolved symbol | The declaration a name refers to after scope, imports, and aliases are followed. A rule that gives a name a meaning keys on the resolved symbol, never on the name's spelling (Chapter 13) |
| Restriction | A limit of the current implementation, marked [Restriction]; not a rule of the language |
| Rule | A normative statement, marked [Rule] or stated in Part II: what a program means |
| Run | To execute a program on the current fiber until it succeeds, fails, or is interrupted |
| Scope | Effect's `Scope`: what owns finalizers and closes them in reverse order; in R it records an obligation to release (Chapter 6) |
| Service | A dependency a program looks up by key: a `service` declaration, or a `Context.Service` from TypeScript (Chapter 4) |
| Shape | The type of a service's implementation, `S.Shape`, which declaration files write as Effect does, `Context.Service.Shape<typeof S>` (Chapter 4, D501) |
| Suspension point | A point where another fiber may run or an interruption may arrive: a call that runs a program that can park, an await operation, a `join` (Chapters 13, 15) |
| Tagged class | A class whose instance type declares `_tag` as a string literal or a union of them, an `error` declaration's, a `Data.TaggedError` class's, and `effect`'s tagged errors' included. Its arm tests the tag, as `catchTag` does, and removes from a match's subject every case its tag set covers (Chapter 3, D515) |
| Trusted base | What the static guarantees assume: the implementation, TypeScript's types where used unchanged, foreign declarations, trust declarations, escapes, and the fiber-behavior table (Chapter 26) |

