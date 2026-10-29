# EffectScript prototype compiler: findings

2026-10-16. Prototype `esc` in `prototype/esc/`, on `typescript@5.9.3` and `effect@4.0.5`, following `docs/design/history/DECISIONS.md` (D1-D29).

**Summary.** Type-directed lowering works. The compiler decides every call, lambda, and conversion from TypeScript's checker. All 46 example files pass: the 26 runnable ones compile with no errors and produce their expected results, and the 20 expected-failure files report their codes. 25 of the proposal's 28 claimed contracts match as written.

The remaining three fail for reasons the proposal must fix:
- D5 changes `profileCard`'s E.
- `openFile` and `openLog` write `Scope`, which is not a type in Effect 4.

`totalSize` matches only through a recursion fixpoint that TypeScript inference cannot provide. The most consequential findings are the D1 emission (Effect's class form breaks `implements`), `finally` lowering (`Effect.ensuring` rejects a cleanup that can fail), and the circular expected-type problem the Go fork must solve inside overload resolution.

## How to run

```sh
cd .
bun prototype/esc/src/cli.ts build prototype/esc/examples/ch01-first-look.es [--out dir]
bun prototype/esc/src/cli.ts run prototype/esc/examples/ch09-handlers.es
bun prototype/esc/examples/run-all.ts [filter] [--verbose]    # 46/46 pass, about 16 s
```

`build` writes the `.ts` file and prints contracts and diagnostics. `run` builds, then runs the module's `main()`.

`prototype/esc/node_modules` is a symlink to `experiments/node_modules`; nothing was downloaded.

## What runs end to end

| Area | Status | Evidence |
| --- | --- | --- |
| Type-directed call lowering | Pass 1 emits `yield* $bind(call)`. Later passes emit `yield*` only where the checker says the call's type is `Effect` itself (D24) | 642 `yield*` sites; the only runtime `$bind` fallbacks are 2 deliberate `using` of a plain `Disposable` |
| Inferred contracts | Read from TypeScript's inference of the generated `Effect.fnUntraced` generators, then compared with every `// Effect<…>` claim | Table below |
| Written contracts | ES2001/ES2002 with the escape site and the proposal's wording; TypeScript's duplicate TS2322 is suppressed | `ch02-contract-narrower`, `ch03-safelookup-no-try`, `ch12-welcome-missing-mailer`, `nominal-services` |
| Errors and regions | `throw`, `try`/`catch` (D13 via the kernel's `catchExpected`), narrowing and rethrow, `finally`, `using` (D14), and completion records | `regions.es` produces exactly plain JavaScript's event order; in `ch15-failures`, a defect and a mixed cause pass through `catch` |
| Services and DI | Abstract-class services (D1, nominal), `Users.find(id)`, `Users()`, `Layer.effect(S, () => …)`, `Effect.provide(() => f(), layer)`, `implements Users`, TypeScript-authored services, `wire` (D27) | `ch01`, `ch04-*`, `ref1`, `ref2-*` |
| Programs as values | D7 conversion; `retry`, `timeout`, `all`, `race`, `cached`, `pipe` (D8) | `ch05-programs`, `ref3`, `ref5` |
| Handlers and producers | `extends Control` (D2), `handle`/`resume`/`resumeWith`/`abandon` (D16, D17), tail resume (D18), `function*`, `for...of`, Streams (D26), ES4201 | `ch08-*`, `ch09-handlers`, `ref6-handlers`; `stack-depth.es` stays under 50 frames for 100,000 elements or operations |
| Plain JavaScript (D9, D10) | `f$direct` plus a TypeScript-facing `Effect.sync` wrapper; a function value in a plain position passes `f$direct` | `ch13-plain`, `ref4`, `ch05` (`stores.map(makeSync$direct)`) |
| Diagnostics | ES1001, ES1002, ES2001, ES2002, ES2101, ES3001-ES3006, ES3101, ES3201-ES3204, ES4201, ES4301, ES4401-ES4403, mapped to `.es` spans | 20 `*.fail.es` files |

Size: about 3,560 lines including the runtime. The corpus is 46 `.es` files, 3,334 lines, written from the proposal by a second agent before the compiler existed.

## How it works

The compiler parses each `.es` file once, then loops:

1. Emit TypeScript using the previous pass's facts.
2. Type-check the emitted program in memory.
3. Collect new facts. Stop when they equal the previous pass's.

The last emission is the output.

The facts are per-node checker answers:
- whether a call's type is `Effect` itself;
- whether a callee is an Effect value;
- whether a receiver is a service key;
- what type is expected at a lambda's or value's position;
- whether a function is free of Effect operations (D10);
- whether a `for...of` iterates a producer or a Stream;
- a recursive function's contract so far;
- the order of `wire`'s arguments.

Pass counts across the corpus: 1 pass for 1 file, 2 for 16, 3 for 26, 4 for 2, 5 for 1. A warm compile takes 40-900 ms per file. A cold build takes about 1.6 s, mostly spent parsing `lib.dom.d.ts` and Effect's declarations.

## The proposal's 28 claimed contracts

| Design line | Function | Result |
| --- | --- | --- |
| 23 | `welcome` | Match |
| 186 | `add` | Match; compiles to plain JavaScript |
| 192 | `greeting` | Match |
| 249 | `notifyAll` | Match |
| 307 | `profileCard` | **Mismatch under D5.** The bare `formatName(user)` call is ES4401. The required `Effect.try` adds `UnknownError` to E (`ch10-typescript.es:62`) |
| 334 | `parseId` | Match |
| 364 | `lookup` | Match |
| 378 | `lookupOrGuest` | Match: `instanceof` narrowing plus `throw e` gives E = `InvalidId` |
| 490 | `apiUrl` | Match |
| 528 | `UsersLive` | Match |
| 566 | `DatabaseLive` | Match |
| 610 | `AppLive` | Match, with `wire`'s arguments ordered from their Layer types |
| 753 | `makeSync` | Match; compiles to plain JavaScript |
| 794 | `readReport` | Match |
| 810 | `openFile` | **Does not type-check as written.** `Scope` is a namespace in Effect 4; the type is `Scope.Scope`. It matches once that spelling is normalized |
| 821 | `openLog` | Same as `openFile` |
| 828 | `compareLogs` | Match |
| 970 | `firstErrors` | Match |
| 1016 | `checkout` | Match |
| 1057 | `locate` | Match; the open cursor closes on abandonment |
| 1167 | `title` | Match |
| 1230 | `parseConfig` | Match |
| 1263 | `fetchJson` | The contract matches, but the body is now illegal: `fetch` is ES4402, even inside `Effect.tryPromise` |
| 1419 | `quoteCart` | Match |
| 1483 | `totalSize` | Match **only with the recursion fixpoint**. TypeScript alone infers `Effect<unknown, any, any>` (TS7022) |
| 1566 | `mapAll` | Match under D12; the hover shows the generated names `E$1, R$1` |
| 1582 | `withRetry` | Match under D12 |
| 2337 | `profile` | Match (`ch24-profile.es`) |

The corpus adds 18 claims of its own for the reference programs; all match.

## Findings: where the proposal is wrong or underspecified

### Calls and programs (Chapter 11)

1. **"Where the expected type is Effect" needs a definition, and TypeScript's contextual type is the wrong one.** A lambda's contextual type in a generic call is instantiated from the lambda itself. In `ids.map((id) => Users.find(id))`, once the lambda is lowered as an Effect function, `U` becomes an `Effect`, so the lambda looks like it belongs in an Effect position.

   The rule that worked:
   - Use the declared, uninstantiated parameter type of the resolved overload.
   - If resolution fails, use the overload candidates whose arity fits.
   - Use the instantiated contextual type only when the declared type is a bare type parameter fixed by another argument, such as `Layer.succeed`'s `NoInfer<S>`.

2. **D24 is necessary and cheap.** Context keys, `Config`, `Exit`, and `TaggedError` instances all extend `Effect` in 4.0.5. Before D24, a top-level `Context.Service(...)` call reported ES1001. The prototype implements D24 as "the result type's symbol is effect's own `Effect` interface".

3. **An Effect-valued service member called with `()` falls under two rows of Chapter 11's table at once.** In ref1, `UserRepo.all` is an `Effect`, not a method, so `UserRepo.all()` must lower to `yield* (yield* UserRepo).all`. Treated as either row alone, the decisions oscillated for 6 passes. The table should list the combination.

4. **Service member names collide with the key's own members.** The generated key has `pipe`, `key`, `Service`, `Identifier`, `toString`, and `toJSON`; because it is a class, it also has `name`, `length`, `call`, `apply`, and `bind`. `Rpc.call(...)` and `Registry.pipe(...)` silently reached the key instead of the service.

   Rule adopted: a member the service declares wins over the key's members. A static member with the same name as a service member is ES3006. D1 should state this rule.

5. **Programs inside runtime arrays are not covered.** The conversion rule covers syntactic array elements and record fields only. The proposal's own `Effect.all(stores.map(makeSync), …)` is TS2345 under it (Fable finding 3).

   The prototype adds a container conversion, `$programs`: an iterable of zero-argument programs is converted where an iterable of Effects is expected. Decision needed: adopt this conversion, or rewrite the example with `Effect.forEach`.

6. **The `pipe` special case (D8) works.** The first argument is treated as a program when the first stage's parameter type is an Effect.

### Contracts (Chapter 12)

7. **"Computed over the whole cycle, so they never need an annotation" is false if TypeScript does the inference.** The generated recursive `const` is TS7022/TS7023.

   The prototype routes recursive calls through a forward binding typed with the previous pass's inferred contract. E and R reach a fixpoint in 3 passes. A still becomes `any` when it depends on the recursive result, and that case needs its own diagnostic. The Go fork needs this fixpoint per strongly connected component.

8. **D12 works as a signature rewrite.** `(a: A) => B` becomes `(a: A) => Effect<B, E$n, R$n>`, and `mapAll` and `withRetry` then match the proposal's generic contracts.

   It has three costs:
   - the hover shows invented names;
   - every call of a callback parameter is an Effect call, so higher-order functions always run on frames (D11);
   - TypeScript callers must pass callbacks that return Effects.

9. **A provider's implementation must be checked against the service's shape.** The object returned from `Layer.effect(Users, () => { …; return { find(id) {…} } })` takes its contextual type from itself. An escaping `DbError` therefore surfaces only as a raw TS2345 on the whole layer.

   The prototype takes the expected shape from the program's expected `Effect<Users, …>`. It then reports ES2001 for `UsersLive.find` and ES3101 for `UsersAudited.find`, in the proposal's wording.

10. **A keeps literal types.** `describeDefect` infers `number | "defect: InvalidId" | "defect: other"`. A is inferred as a type argument of `fnUntraced`, where TypeScript's widening of function return types does not apply.

### Errors and regions (Chapters 3, 15, 24)

11. **`finally` must lower to `Effect.onExit`, not `Effect.ensuring`.** In 4.0.5, `ensuring` requires the finalizer's E to be `never`, but the proposal and D15 allow a cleanup to fail. Chapter 24's printed `profile` lowering type-checks only because `Metrics.increment` cannot fail.

12. **D13 leaves a typed `Fail` inside a cause whose static E omits it.** `mixedCause` infers E = `never`, yet its exit holds `Fail(Expected)` and `Die`. This is sound for EffectScript's `catch`, which never recovers a cause that contains a defect. It is unsound for a TypeScript caller that applies `Effect.catch`. The spec should define E as the type of causes made only of expected failures.

13. **Region closures defeat definite-assignment analysis.** `let n: number; try { n = … } catch { n = -1 }; return n` is TS2454 after lowering. The prototype emits `let n!: number`, which loses the check. The real compiler must check definite assignment on the source.

14. **`throw` must lower to `return yield* Effect.fail(e)`.** The `return` preserves narrowing after the throw. Region dispatch also needs `return $c as never` when a region cannot complete normally; otherwise TypeScript adds `undefined` to A.

15. **Completion records match JavaScript.** In `regions.es`, labeled `break`, `continue`, and `return` through nested `try`/`catch`/`finally` produce the same results and `finally` order as Node. `using` in a loop body releases once per iteration, including on `continue`, `break`, and `return`.

16. **A `catch` over a block with E = `never` binds `e: never`.** Such a clause is dead code, and the compiler should warn.

### Resources and fibers (Chapters 6, 7)

17. **D14 is implementable directly.** Only `using` acquisitions receive the block's Scope: `Scope.provide(acquire, scope)` inside `Effect.scopedWith`. Codex R8's `openAndLog` returns an open connection and keeps `Scope` in its R.

18. **D19 needs one more rule: a block that contains `fork` is a Scope region even without `using`.** Without it, `reportWithProgress` died with `Service not found: effect/Scope`.

### Services (Chapter 4, D1, D27)

19. **D1 cannot emit Effect's `Context.Service` class form.** That form makes the class's instance type the identifier. `class UsersFake implements Users` is then TS2720, and a parameter typed `db: Database` means the identifier rather than the methods.

    The emission that works is an interface for the shape, plus an optional brand `"~esc/service"?: "<key>"`, merged with a class whose static side is `Context.Key<Users, Users>`. `scratch/probe2.ts` shows three things:
    - R stays nominal;
    - `implements` works;
    - a parameter typed with the service means its methods.

20. **`wire` works as an intrinsic.** The compiler reads each argument's Layer inputs and outputs from its type and orders the arguments by a stable topological sort. It reports ES3201 at the runner with the dependency path, plus ES3202, ES3203, and ES3204.

21. **D5 and D23 have three frictions.**
    - ES4401 cannot apply at module top level, because the `Effect.try` it asks for would itself be ES1001. The prototype applies it inside functions only.
    - `@throws {T}` names a type, but the runtime needs a value to test against. The prototype types E as `import("…").T` and matches exceptions by `_tag` or constructor name.
    - `fetchJson` is illegal.

### Handlers and producers (Chapters 8, 9, D16-D18, D26)

22. **Control operations fit the service machinery.** `handle` provides an implementation that performs kernel operations and discharges `Exclude<R, Approval>`.

23. **D18 holds for compiled clauses.** A `return resume(k, v)` outside every region lowers to the kernel's `tailResume(k, v)`. Producer loops, user handler clauses, and loop bodies with `try`/`finally` stay under 50 frames over 100,000 elements.

24. **The proposal does not type what `resume` returns.** Under a deep handler, `resume` returns the `handle` call's own result type, which is recursive. The prototype approximates it with the program's A, which is wrong when another clause returns early or `onReturn` changes the result. The proposal never defines `Continuation`'s type parameters (Fable 12).

25. **ES4201 works from a combinator table plus each argument's R.** D20's ES4202 is not implemented.

26. **The producer-to-Stream adapter breaks D26's "never runs ahead".** It is built on `Stream.callback` with a one-element buffer, so the producer runs one element ahead. Early close still runs the producer's cleanup. A true rendezvous needs a zero-capacity handoff.

### Compiler architecture (Chapter 25)

27. **Every pass re-checks the whole program**, 1 to 5 times per compile.
28. **Generated statements need explicit terminators.** Without them, a statement beginning with `(yield* …)` joins the previous line through automatic semicolon insertion.
29. **Service lookups happen at each call**, as `(yield* Users).find(id)`. The output is equivalent to Chapter 1's Effect version, not identical to it (Fable 10).
30. **A method's lowering follows its interface.** A method of a class that `implements` a service becomes an Effect function.

## Stubbed or missing

- `.d.ts` emission and `$direct` metadata for other packages.
- Partial annotations (O7), D20's ES4202, and external iteration of producers.
- `transfer` is internal only, per D16.
- No source maps or hovers.
- A non-Effect return annotation is rejected with ES2003.
- `this` inside Effect-mode methods is untested.

## Next hardest risk

The call rule must work in a single pass inside the checker. In the prototype, three decisions form a loop that only iteration resolves:
- whether a call runs depends on the callee's type;
- how a lambda lowers depends on the overload that resolution picks;
- overload resolution and inference depend on the lambda's lowered type.

The Go fork must decide lambda lowering during overload resolution and compute E and R incrementally.

Experiment: patch TypeScript 5.9's `chooseOverload` to classify lambdas against each candidate signature. If any corpus file needs a second pass to reach the prototype's decisions, single-pass checking is falsified for that construct.

## Files

| Path | Contents |
| --- | --- |
| `src/cli.ts` | `build` and `run`; printing of diagnostics and contracts |
| `src/compiler.ts` | Discovery, the pass loop, the in-memory host, ES checks, contracts and claims |
| `src/emit.ts` | The lowering emitter, its probe spans, and the span map for diagnostics |
| `src/facts.ts` | Checker queries |
| `src/model.ts` | Shared types and names |
| `../../packages/runtime/src/index.ts` | The prelude (D4), helpers, services, control operations, producers, Streams, and `$trusted` |
| `examples/` | 26 runnable examples, 20 expected-failure files, and `run-all.ts`; `out/` holds the generated TypeScript |
| `scratch/` | `probe1.ts` (hand lowering), `probe2.ts` (D1 emission), `keymembers.ts`, and `es/` edge cases |
