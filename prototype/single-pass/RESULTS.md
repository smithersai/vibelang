# Single-pass lowering: results

This report records the historical experiment. The commands describe its original environment.

2026-10-16. TypeScript 5.9.3 patched in `typescript/`, effect 4.0.5, the prototype `esc` at `prototype/esc/` (read, not edited).

**Summary.** The hypothesis survives on the corpus. With each lambda classified per overload candidate inside `chooseOverload`, one checker pass reaches the prototype's final lowering for all 46 files: 817 call sites, 257 lambdas and methods, 0 disagreements, and byte-identical generated TypeScript.

The corpus does not exercise the risk it was meant to test. 45 lambdas met two or more candidates, and no two candidates ever classified the same lambda differently. Synthetic probes that do split candidates produce 16 disagreements. In each one, the prototype has two self-consistent lowerings and lands on one through its first-pass guess, while the single pass picks the one TypeScript's candidate order picks. The only construct that needs a second pass is a contract across mutually recursive functions. A fixpoint local to the strongly connected component fixes it.

## Method

```
prototype                                     single pass
.es ─► emit(facts) ─► check ─► facts ─┐        .es ─► neutral emit ─► patched check, once ─► facts S
         ▲                            │               (no facts)      $esDual, $esBind, ...       │
         └───── until facts repeat ───┘                                                           ▼
                                                     prototype's own emitter(S) ─► compare with prototype's out/*.ts
```

1. **Replica.** `harness/replica.ts` runs the prototype's loop from its exported modules. Its final output equals `prototype/esc/examples/out/*.ts` byte for byte, and its pass counts match FINDINGS.md (1 file at 1 pass, 16 at 2, 26 at 3, 2 at 4, 1 at 5).
2. **Neutral emission.** `harness/emit-neutral.ts` is the prototype's emitter with every type-dependent choice emitted as an intrinsic the checker resolves. It reads no facts. `harness/emit-neutral.diff` shows the changes.

   | Construct | Neutral form | The checker decides |
   | --- | --- | --- |
   | Lambda | `$esDual(plain, effect, program, meta, id)` | Its class against the candidate's declared parameter type; only the selected variant is checked |
   | Object-literal method | `name: $esDual(function…, function…)` | Same |
   | Class method, nested function | `return $esBody(() => {…}, () => Effect.gen(…))` | `implements` member type, else whether the body pauses |
   | Call in Effect code | `(yield* $esBind(call))` | Runs when the type is effect's own `Effect` (D24); D23 `@throws` |
   | Zero-argument call | `$esBind0(callee, call)`, `$esVal0(callee, call)` | A non-callable Effect value runs |
   | Call to an `.es` function in plain code | `$esPlain(call)` | D10: the plain variant's value |
   | Receiver in Effect code | `(yield* $esSvc(r, "m")).m` | A key whose service declares `m` is the service (finding 4) |
   | Argument, element, property value | `$esConv(value)` | D7 program, `$programs`, D26 Stream, D9 plain variant |
   | `for...of` in Effect code | `for (x of (yield* $esIter(xs)))` | Producer, Stream, or iterable (type-level) |
3. **Patched checker.** `patch/es-checker.js` is spliced into `createTypeChecker` (`patch/typescript.patch`: one 668-line block and 15 small hooks). While `inferTypeArguments` or `getSignatureApplicabilityError` checks a call's arguments against a candidate, a dual is classified against that candidate's declared, uninstantiated parameter type (finding 1). If that type is a bare type parameter or classifies nothing, the dual uses every arity-compatible candidate's declared type. If those classify nothing either, it uses the contextual type instantiated with the inferences made so far. The selection kept is the first one against the winning candidate, made before any inference from the dual itself; later checks against that candidate never chose differently (0 conflicts).
4. **Comparison.** `harness/single-pass.ts` reads the decisions after the one check and builds the prototype's `Facts` shape from them. `harness/compare.ts` re-emits those facts with the prototype's own emitter and diffs every decision and the text. It then runs one more prototype pass from the single-pass facts: if the emission is unchanged, the result is a fixpoint of the prototype's iteration.

## Corpus results

| File | Prototype passes | Calls | Lambdas | Overloaded lambdas | Disagreements | Same text | Lowering fixpoint |
| --- | --: | --: | --: | --: | --: | --- | --- |
| `ch01-first-look.es` | 3 | 11 | 3 | 1 | 0 | yes | yes |
| `ch02-contract-narrower.fail.es` | 2 | 2 | 0 | 0 | 0 | yes | yes |
| `ch02-functions.es` | 3 | 25 | 5 | 3 | 0 | yes | yes |
| `ch02-plain-ts-call.fail.es` | 2 | 3 | 0 | 0 | 0 | yes | yes |
| `ch03-errors.es` | 3 | 40 | 9 | 3 | 0 | yes | yes |
| `ch03-safelookup-no-try.fail.es` | 2 | 8 | 0 | 0 | 0 | yes | yes |
| `ch04-provider-escapes.fail.es` | 3 | 8 | 4 | 0 | 0 | yes | yes |
| `ch04-services.es` | 3 | 50 | 24 | 3 | 0 | yes | yes |
| `ch04-users-audited.fail.es` | 2 | 11 | 5 | 0 | 0 | yes | yes |
| `ch04-wire.es` | 3 | 29 | 13 | 3 | 0 | yes | yes |
| `ch05-programs.es` | 5 | 46 | 13 | 4 | 0 | yes | yes |
| `ch06-disposable.es` | 3 | 6 | 1 | 0 | 0 | yes | yes |
| `ch06-resources.es` | 3 | 49 | 17 | 1 | 0 | yes | yes |
| `ch07-concurrency.es` | 4 | 41 | 13 | 3 | 0 | yes | yes |
| `ch08-producers.es` | 3 | 22 | 5 | 1 | 0 | yes | yes |
| `ch08-streams.es` | 2 | 7 | 0 | 0 | 0 | yes | yes |
| `ch09-approve-all-forked.fail.es` | 2 | 3 | 1 | 0 | 0 | yes | yes |
| `ch09-handlers.es` | 3 | 45 | 21 | 1 | 0 | yes | yes |
| `ch10-effect-gen.fail.es` | 3 | 3 | 2 | 0 | 0 | yes | yes |
| `ch10-fetch.fail.es` | 3 | 5 | 4 | 1 | 0 | yes | yes |
| `ch10-map-pausing-callback.fail.es` | 3 | 3 | 1 | 0 | 0 | yes | yes |
| `ch10-typescript.es` | 3 | 32 | 10 | 4 | 0 | yes | yes |
| `ch11-top-level-run.fail.es` | 2 | 2 | 0 | 0 | 0 | yes | yes |
| `ch12-contracts.es` | 3 | 32 | 7 | 1 | 0 | yes | yes |
| `ch12-rates-bare-return.fail.es` | 1 | 0 | 0 | 0 | 0 | yes | yes |
| `ch12-welcome-missing-mailer.fail.es` | 2 | 4 | 0 | 0 | 0 | yes | yes |
| `ch13-plain.es` | 3 | 20 | 2 | 1 | 0 | yes | yes |
| `ch14-callbacks.es` | 3 | 15 | 5 | 1 | 0 | yes | yes |
| `ch15-failures.es` | 3 | 52 | 19 | 1 | 0 | yes | yes |
| `ch24-profile.es` | 3 | 20 | 5 | 3 | 0 | yes | yes |
| `d5-clock-read.fail.es` | 2 | 1 | 0 | 0 | 0 | yes | yes |
| `nominal-services.fail.es` | 3 | 5 | 2 | 1 | 0 | yes | yes |
| `ref1-existing-service.es` | 3 | 17 | 2 | 1 | 0 | yes | yes |
| `ref2-ambiguous-provider.fail.es` | 2 | 3 | 2 | 0 | 0 | yes | yes |
| `ref2-cycle.fail.es` | 2 | 7 | 4 | 0 | 0 | yes | yes |
| `ref2-missing-provider.fail.es` | 4 | 9 | 4 | 1 | 0 | yes | yes |
| `ref2-opaque-layer.fail.es` | 2 | 2 | 1 | 0 | 0 | yes | yes |
| `ref2-provider-graph.es` | 3 | 44 | 15 | 3 | 0 | yes | yes |
| `ref3-resourceful-retry.es` | 3 | 18 | 7 | 3 | 0 | yes | yes |
| `ref4-callbacks.es` | 3 | 19 | 5 | 1 | 0 | yes | yes |
| `ref4-pausing-function-value.fail.es` | 2 | 3 | 0 | 0 | 0 | yes | yes |
| `ref5-programs-as-data.es` | 3 | 23 | 2 | 0 | 0 | yes | yes |
| `ref6-fork.fail.es` | 2 | 5 | 3 | 0 | 0 | yes | yes |
| `ref6-handlers.es` | 3 | 45 | 16 | 0 | 0 | yes | yes |
| `regions.es` | 2 | 13 | 2 | 0 | 0 | yes | yes |
| `stack-depth.es` | 2 | 9 | 3 | 0 | 0 | yes | yes |
| **46 files** | **124** | **817** | **257** | **45** | **0** | **46/46** | **46/46** |

"Overloaded lambdas" counts lambdas that were classified against two or more candidates during resolution. Of those 45, **0** received different classes from different candidates. 6 lambdas had no expected type and were decided by whether their body pauses; 1 was decided by D8 (`pipe`).

Cost, warm, whole corpus: the prototype ran 124 whole-program checks in 4.0 s; the single pass ran 46 checks in 2.1 s. The neutral text is 2.03 times the size of the final text, because every lambda carries all of its variants.

Every recorded consistency check is empty:
- no candidate selected two classes for one lambda;
- no lambda outside a call changed class after its first check;
- every in-pass call decision equals the type read back after the check;
- every in-pass D10 decision equals the prototype's `computeDirect` on the single-pass facts.

Runnable files check with 0 TypeScript errors in the neutral text; the only diagnostics are in 9 `.fail.es` files.

One raw fact differs while the lowering agrees. In `ch05-programs.es:91`, the prototype records the D8 pipe lambda's class as `program`, read from its own program emission; the single pass records `none`. Both lower it as a program by D8.

### What made the prototype iterate

These are the decision changes after the prototype's second pass, from `harness/passes.ts`:

```
 39  call  call -> run          23 files  a call becomes runnable once its lambda argument is a program:
                                          Effect.provide(() => f(), layer), Effect.race, Effect.all, handle, ...
 24  D10   direct flips         18 files  main and others stop being plain JavaScript once those calls run
  5  call  direct -> run/call    5 files  callers of those functions follow the flip
 15  call  bind -> run/call      9 files  a value's type is known once the lambda that produced it is lowered,
                                          or once a type guard narrows it
  5  ch05  conversion chain       1 file  D9 makeSync$direct -> $programs -> Effect.all -> D10 syncEverything -> reports.map
```

All 88 follow from the loop named in FINDINGS ("Next hardest risk"): a call's lowering depends on its type, its type depends on a lambda's lowering, and the lambda's lowering depends on the resolved overload. D9 and D10 extend the same loop to function values. The prototype pays one whole-program pass per link because it learns each fact from the previous emission. Inside the checker each link is resolved in demand order, so none needs a pass of its own.

## Disagreements

### Corpus: 0

The final run has none. The run itself surfaced three defects in the harness's encoding, and each one is a constraint the Go fork must meet:

1. **Round 1 of overload resolution.** TypeScript skips context-sensitive arguments in round 1 and replaces them with `anyFunctionType`. A dual whose plain form returns an object literal with untyped methods is context sensitive, so it was skipped. `Layer.effect(Users, () => {…})` then failed its only candidate in round 1, and TypeScript's error re-check crashed with "No error for last overload signature" (`ch04-services.es:75`). **Fix:** skip only when the variant *this candidate* selects is context sensitive. A program variant is a call, so round 1 checks it.
2. **Narrowing through the call rule.** `Exit.isFailure(x) ? x.cause.reasons.map(…) : …` lost its narrowing, because the binder and `narrowType` saw `yield* $esBind(…isFailure($esConv(x)))` instead of the call. This made 3 calls `unknown` instead of plain (`ch15-failures.es:181`, `:182`, `ref6-handlers.es:144`). The prototype hits the same artifact through `$bind` in pass 1, which is one reason it needs a third pass. **Fix:** narrowing sees the original call and reference.
3. **D10 in plain code.** A plain lambda `(x) => double(x)` calls `double$direct`, whose value is a number. The neutral text typed it as `Effect<number>`, which rejects a plain-callback overload. The corpus never depends on this; the probe did. **Fix:** `$esPlain`.

The comparison also fixes two reading conventions, so that a decision is compared with a decision and not with a representation:
- A call to a D10 function reads as its plain variant's value, because the prototype reads it from the `f$direct(...)` it emitted.
- A lambda's first selection is the one that typed the program. A deferred re-check sees a contextual type instantiated from the lambda's own first selection.

### Probes outside the corpus: 17 disagreements in 2 files

`probes/p1-overloads.es` and `probes/p2-recursion.es` construct the cases the corpus lacks. Results are in `results-probes.json`.

| Construct | Example | Prototype | Single pass | Cause |
| --- | --- | --- | --- | --- |
| Plain-callback overload first | `register((x) => Math.max(x, 0))`, `register((x) => double(x))` | Effect function, overload 2, runs | plain, overload 1, call | Two fixpoints; the prototype's first-pass guess "any call means Effect" picks overload 2 |
| Effect-callback overload first | `attach((x) => x + 1)` | plain, overload 2 | Effect function, overload 1, runs | Two fixpoints; "no call means plain" picks overload 2 |
| Program overload first | `start(() => Math.max(1, 2))` | plain thunk, overload 2 | program, overload 1 | The prototype never tries the program form, because the resolved overload declares a thunk |
| Bare type parameter | `apply((x: number) => Math.max(x, 0))` | Effect function | plain | The prototype's expected type is the lambda's own inferred type, so its first guess fulfils itself |
| Returned lambda | `return (x: number) => Math.max(x, n)` | Effect function | plain | Same self-fulfilment, through the generator's inferred return type |
| Mutual recursion | `isEven` and `isOdd` | `isEven: Effect<any, Odd, never>` | `Effect<any, never, never>` | The forward binding starts at `never`; one pass cannot see `Odd` through the cycle (finding 7) |

All 16 disagreements in p1 come from the first five rows: 6 lambdas, the 5 calls that take them, and 5 D10 decisions that follow. The single pass's result for p1 is itself a lowering fixpoint of the prototype's iteration. Running the prototype one more pass from it changes nothing. These lambdas have two self-consistent lowerings, and the prototype's answer depends on where it starts. The single pass's answer is the one TypeScript's own overload rule (the first applicable candidate wins) gives. It is also the one the proposal's wording implies: "where the expected type is Effect", with no expected type taken from the lambda itself. The one candidate split that both systems resolve alike is `register((x) => Users.find(…).id.length)`. Overload 1 classifies the lambda plain, fails to type its service call, and overload 2 wins with an Effect function.

## Constructs that force iteration

**Lowering decisions:** none, on the corpus or the probes. Every call, lambda, conversion, loop, and D10 decision was reached in one pass. Each was a fixpoint of the prototype's own rules.

**Contracts of mutually recursive functions:** one more pass is needed for E and R across the cycle. The local fix is a fixpoint over the strongly connected component. Check the component's bodies, then recheck only those bodies with the component's union rows, until E and R stop growing. The lattice is finite and the step is monotone, including `catch` subtracting a fixed set. The corpus has only self-recursion, where the body alone supplies E and R, so `ch12-contracts.es`'s `totalSize` matched in one pass. When A depends on the recursive result, it stays `any` in both systems; that case needs the diagnostic finding 7 asks for.

## What the Go fork should do

1. **Classify each lambda argument inside `chooseOverload`, per candidate,** from the candidate's declared, uninstantiated parameter type. If it is not useful, use every arity-compatible candidate's declared type. For a bare type parameter, use the instantiation from the other arguments only. Never let a lambda's own inferred type classify it; that is where the prototype's path dependence comes from.
2. **Decide round-1 skipping per candidate:** skip only when the selected form is context sensitive.
3. **Check a lambda at most once per form** (plain, Effect function, program), with TypeScript's one-shot caches keyed by form: contextual parameter types, `resolvedReturnType`, and inner calls' resolved signatures. The harness gets this by duplicating text (2.03 times). On the corpus, no lambda in argument position needed two forms. A body with no expected type checks its Effect form to learn whether it pauses (6 lambdas).
4. **Keep the first classification of a lambda per candidate.** A deferred re-check must not reclassify it.
5. **Apply the call rule to the call node.** Narrowing by type guards must see the original call, and a call to a D10 function in plain code has the plain variant's type.
6. **Compute D10 on demand,** as a greatest fixpoint over the callee's strongly connected component. A D9 conversion, a body with no expected type, and a plain-code call all need it before the caller is typed.
7. **Keep D8's look-ahead.** `pipe`'s first argument is classified by the next argument's parameter type, which is checked first.
8. **Fix contracts of recursive components with a component-local fixpoint** on E and R, never a whole-program pass.
9. **Put the overload rule in the proposal:** with overloads, the first candidate that accepts the lambda in the form that candidate expects wins. The prototype cannot be the specification here, because it has two answers.

## Limitations

- The harness models the Go checker with a patched TypeScript and a neutral text. A Go fork would hold the forms in the checker, not in duplicated text.
- In Effect code, a producer or Stream loop body is checked inline. The prototype moves it into a region closure, which drops narrowing of outer `let` variables. On the corpus the lowering was identical.
- Recursive functions keep the prototype's first-pass forward binding (`any`, `never`, `never`).
- The evidence that candidates can disagree comes from 2 synthetic files: 6 constructs, 1 TypeScript helper module.

## How to run

```sh
cd ./prototype/single-pass
bun patch/apply.ts            # copy TypeScript 5.9.3 to typescript/, patch it, write patch/typescript.patch
bun harness/compare.ts        # corpus: 46/46, writes results.json (about 10 s)
bun harness/compare.ts --dir probes --verbose
bun harness/passes.ts         # the prototype's decision changes per pass
bun harness/inspect.ts ch01-first-look.es --text   # one file's neutral text and selections
```

`node_modules` links to `../../experiments/node_modules`, as `prototype/esc/node_modules` does. The harness runs from the repository root, because service keys embed a cwd-relative path.

## Files

| Path | Contents |
| --- | --- |
| `patch/es-checker.js` | The checker code: classification, intrinsics, D10, narrowing helpers |
| `patch/apply.ts` | Copies TypeScript and splices the code in at exact anchors |
| `patch/typescript.patch` | Unified diff of `lib/typescript.js` |
| `typescript/` | The patched TypeScript 5.9.3 |
| `harness/es-shim.d.ts` | Intrinsic declarations and the type aliases the checker instantiates |
| `harness/emit-neutral.ts`, `.diff` | The neutral emitter and its diff from `prototype/esc/src/emit.ts` |
| `harness/single-pass.ts` | One emission, one check, decisions read into `Facts` |
| `harness/replica.ts` | The prototype's loop, recorded per pass |
| `harness/compare.ts` | Decisions, text, and fixpoint comparison |
| `harness/passes.ts`, `harness/inspect.ts` | Per-pass changes; one file's selections |
| `probes/` | Constructs the corpus lacks |
| `results.json`, `results-probes.json` | Per-file rows behind the tables above |
