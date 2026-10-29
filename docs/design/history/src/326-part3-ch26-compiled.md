### 26. What compiled code must guarantee

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

```ts es
function displayName(id: string) {
  return Users.find(id).name
}
```

```ts gen
export const displayName = Effect.fnUntraced(function* (id: string) {
  const users = yield* Users          // in-place evidence from the current Context
  const user = yield* users.find(id)  // runs on this fiber, under this Context
  return user.name
})
```

```ts dts
import { Effect } from "effect"
export declare const displayName:
  (id: string) => Effect.Effect<string, UserNotFound, Users>
```

Compiled code owes five obligations, each a rule of this chapter: the frame invariant; observational equivalence of every optimization and rewrite to the frame lowering; the pattern evaluation order; ECMAScript module semantics; and the declaration ABI (Chapter 27). Chapter 13's rules for evaluation order (E), lexical context (L), and names (H) apply to every lowering here; rule E11 binds every compiled form to the observations defined below. The last section states what the static guarantees assume.

#### The frame invariant

> **Frame invariant** [Rule]. At every point where a computation can capture or park, everything needed to continue it lives in frames on the fiber's `_stack`. No JavaScript activation of compiled or foreign code sits between the run loop and that point.

Capture moves `_stack` frames; it cannot move a JavaScript activation. An activation between the run loop and a perform site would be lost on capture or force re-execution. The lowering in the rest of this chapter follows from this rule.

#### What a function compiles to

A function that may capture or park compiles to one heap frame per activation. Today that frame is Effect's generator frame, made by `Effect.fnUntraced`, as above. A call to another computation is `yield*` of its Effect, which the run loop evaluates as a separate frame, so JavaScript stack depth stays constant (T6a).

Each execution of an Effect function binds its parameters again, including defaults, destructuring and a fresh rest array. This also applies to methods. Caller-provided objects retain their identity.

Parameter assignments, including writes from nested closures, stay inside that execution's bindings. Explicit program factories retain their eager outer state (Chapter 13).

A function with simple, read-only parameters and no rest parameter, whose body is empty or one return, with every call that runs in a result position, needs no frame of its own (D274). It returns that Effect, suspended: `Effect.suspend(thunk)` when a result runs a program, `Effect.sync(thunk)` when it is a value, and `Effect.void` for an empty body. The thunk only builds the program, which runs as the next step of the caller's run loop, so nothing can capture or park inside it:

```ts es
const shout = (text: string) => Console.log(text.toUpperCase())
```

```ts gen
const shout = (text: string) => Effect.suspend({ shout: () => Console.log(text.toUpperCase()) }.shout)
```

The generator is only a frame representation; control comes from the kernel's prompts, not from `Effect.gen`. The compiler never emits `Effect.fnUntracedEager`, which runs at call time, and traces a function with `Effect.fn` only when the project's `tracing` option asks for it (Chapter 28), because traced frames cost 10 to 20 times more (Chapter 24). A later backend can replace generators with explicit state machines without changing any rule here (Chapter 25).

#### Regions compile to frames, never to JavaScript `try`

```ts es
function profile(raw: string) {
  const id = parseId(raw)                 // may throw InvalidId
  try {
    return Users.find(String(id))
  } catch (e) {                           // e: UserNotFound
    return guest
  } finally {
    Metrics.increment("profile")
  }
}
// User!InvalidId!Users | Metrics
```

```ts gen
export const profile = Effect.fnUntraced(function* (raw: string) {
  const id = yield* parseId(raw)
  return yield* Effect.onExit(                         // Final: finally
    catchExpected(                                     // Catch: the first expected failure (D306)
      Effect.fnUntraced(function* () {                 // try region
        return yield* (yield* Users).find(String(id))
      })(),
      (_e) => Effect.succeed(guest)                    // catch region
    ),
    () => Effect.fnUntraced(function* () {             // finally region: it may fail (D15)
      yield* (yield* Metrics).increment("profile")
    })()
  )
})
```

| Source | Frame | Generated with |
| --- | --- | --- |
| `try { } catch (e) { }` | `Catch(h)`: the first expected failure of a cause with no defect, as `Effect.catch` (D306) | The runtime's `catchExpected`, built on `Effect.catchCause`; an abandonment passes through (K14a-K14d) |
| `finally { }` | `Final(fin)` | `Effect.onExit`, never `Effect.ensuring`, whose cleanup must have E = `never` (D46) |
| `throw e` | Fail | `return yield* Effect.fail(e)`: the `return` keeps TypeScript's narrowing after the `throw` |
| A block that declares `using`, or a region that owns a `fork`: a function body, a loop iteration, a `try`, `catch`, or `finally` block, or a `provide` or mask block (D408) | A Scope region: `Final` closes it | `Effect.scopedWith` |
| `using x = e` | `Effect.acquireRelease(e, release, { interruptible: true })` in the block's Scope, `e` run with the interruptibility around the declaration; `release` is the value's one disposal unless an acquisition recorded its release (D342, D401, D490) | The runtime's `$using`, built on `Effect.acquireRelease` |
| `fork p()`, an arrow's expression body included (D353) | A child owned by its region's Scope (D408) | `Effect.forkIn(p(), scope)` |
| A provider override | `Restore(Γ′)` | `Effect.provideService` / `Effect.provide` |
| Masks | `Mask(ι′)` | `Effect.uninterruptible`, `Effect.interruptible` |
| `handle(...)` | `Prompt` | The runtime's `handle` |
| A clause's last `return resume(k, v)` | `Clause(k)` performs it | `return tailResume(k, v)` (K11a) |

Region bodies are closures over the function's variables, so assignments inside a region are visible after it. `return`, `break`, and `continue` that leave a region produce a completion record (`{ kind: "return", value }`, `{ kind: "break", label }`, `{ kind: "normal" }`) that the enclosing frame dispatches on. This is the same transform TypeScript's own downlevel generator emit performs, applied to Effect frames. Because closures hide assignments from TypeScript's definite-assignment analysis, the compiler checks definite assignment on the source, before lowering (D52).

The prototype compiler (`prototype/esc`) emits these shapes and runs them on the kernel. Its `regions.vibe` example reproduces plain JavaScript's results and `finally` order through labeled `break`, `continue`, and `return` across nested `try`, `catch`, and `finally`, and a `using` in a loop body releases once per iteration on every exit (`prototype/esc/FINDINGS.md`).

#### Scope regions

A region's Scope is given only to the block's `using` acquisitions and forked fibers (D14, D19). Everything else in the block runs under the Scope its caller supplies, so an acquisition without `using` stays in the function's R:

```ts gen
// openAndLog from Chapter 6
export const openAndLog = Effect.fnUntraced(function* (url: string) {
  return yield* Effect.scopedWith((scope) => Effect.fnUntraced(function* () {
    const connection = yield* (yield* Database).connect(url)                     // the caller's Scope: R keeps Scope
    const log = yield* $using(scope, (yield* Logs).open("connect.log"))          // `using`: this block's Scope, one release
    yield* log.write(`connected to ${url}`)
    return connection
  })())
})
```

`Effect.scopedWith` creates the region's Scope without providing it, so `Database.connect` still sees the caller's `Scope`, and only the `using` acquisition receives the region's. An acquisition is masked or interruptible as its `acquireRelease` says. `using x = e` is itself `$using(scope, e)`, which is `Effect.acquireRelease(e, release, { interruptible: true })` in the region's Scope, so that `e` runs as `yield* e` would, with the interruptibility around the declaration (Chapter 6, D490): if an acquisition recorded the value's release, `release` does nothing; otherwise it calls the disposal method read once at registration, `[Symbol.asyncDispose]` first, with the value as `this` [Rule] (D342, D343, D401).

Block-owned fibers use the same Scope:

```ts gen
// serve from Chapter 7
export const serve = Effect.fnUntraced(function* (port: number) {
  return yield* Effect.scopedWith((scope) => Effect.fnUntraced(function* () {
    const server = yield* $using(scope, (yield* Http).listen(port))          // `using server`
    yield* Effect.forkIn(heartbeat(), scope)                                 // registered after server: closed before it
    return yield* server.awaitShutdown()
  })())
})
```

A Scope finalizer registered later runs earlier, so the child is interrupted and awaited before resources acquired earlier in the block are released. A region that owns a `fork` without declaring `using` is a Scope region too (D47, D408); without that rule, the prototype compiler's fork-only block found no `Scope` and died with `Service not found`.

#### Clauses

A clause compiles like any function, with one rule for its last step (D18). When a clause's last action is `return resume(k, v)` and no `try`, `catch`, `finally`, or `using` region of the clause encloses it, the compiler emits `return tailResume(k, v)`: the request is returned, never yielded, so the clause's generator finishes and the `Clause(k)` frame performs the resume with the clause gone (K11a, K11c). Inside such a region the compiler emits `yield* resume(k, v)`, because the region's cleanup must run after the resumed computation, and the stack grows by design (K11d). In the prototype compiler, producer loops, handler clauses, and loop bodies with `try` and `finally` stay under 50 frames over 100,000 elements (`stack-depth.vibe`).

#### Producers

A producer body may pause, so it cannot run synchronously inside JavaScript's `next()`. Every `function*` is a producer (D370; a JavaScript generator is a generator method, a `module` declaration, or a `.ts` file, Chapter 8), and VibeLang defines it by the machine [Rule]:

- Calling a `function*` runs none of its body. The result is a **producer**: a `Stream` value that carries a cold program, which performs the built-in control operation `Yield<T>` once per element (D402).
- `yield v` performs `Yield<T>`.
- `for (const x of p)` over a producer, recognized by its value, is **internal iteration**. It installs a `Yield` handler and runs `p`'s program under it. The clause runs the loop body, then tail-resumes `p`. `break`, `return`, or `throw` out of the body returns from the clause without resuming, so the owner abandons `p` and its finalizers run before the loop exits.
- Pulling elements one at a time from outside, as zipping two producers does, is **external iteration**. The standard library's clause transfers `k` and returns the element with the `Suspended` handle; the next pull resumes it, on the same fiber.

```ts gen
// The loop in firstErrors from Chapter 8
const producer = lines(path)                         // the producer value; runs none of its body
yield* handle(Yield,
  producer[$produce],                                // its program, run on this fiber
  {
    Yield: Effect.fnUntraced(function* (line: string, k: Continuation<void, never, void>) {
      if (line.startsWith("ERROR")) found.push(line)
      if (found.length === 3) return                 // break: Owner(k) abandons the producer
      return tailResume(k, undefined)                // RETURN the request; never yield* it
    })
  })
```

A loop body with `using`, `try`, or `finally` runs those regions inside the clause; they return completion records, and the clause tail-resumes only after every region has closed (K11b).

Evidence [Kernel]:

- T16 runs internal iteration over an infinite producer with a finalizer. `break` after three elements runs the producer's finalizer before the loop exits.
- K11a runs this exact generator-clause lowering over 100,000 elements; the deepest stack is 3 frames. K11b adds a per-element `using` and `finally`: 5 frames, with every region closed before each resume. Before the fix, the same clause written as `return yield* resume(k, undefined)` reached 200,003 frames (`tests/generator-tail-resume.test.ts`).
- T17 covers the `flatMap`-shaped clause, which the kernel also drops in constant stack.
- T10 runs external iteration with `transfer`. Each element is one capture and one resume. A producer is one-shot per run: iterating it again runs it again from the start.

If a producer's own loop iterated another producer, abandoning the outer one would reach the inner loop's owner frame and abandon the inner producer too, finalizers included (O01).

**The `Stream` adapter** [Rule, D26, D402]. A producer value is a `Stream` whose channel is the adapter: each consumption through the `Stream` interface runs the producer on a fiber of its own, under internal iteration, and hands over one element per pull through a zero-capacity handoff: the clause completes the pending pull and waits for the next one before it resumes the producer. A buffer of one element, as the prototype compiler used (`Stream.callback` with `bufferSize: 1`), lets the producer run one element ahead, which D26 forbids. Closing the stream interrupts the producer's fiber, which abandons the producer and runs its finalizers. Because the producer runs on the adapter's fiber, a control operation it performs, other than its own `Yield`, cannot reach a handler around the stream's consumer: a `Stream` whose R holds one is EK4201 where it reaches a consumer other than `for...of` (Chapter 8). Nothing converts a producer: a declared type, a parameter, or a return passes the same value, so `for...of` over it, wherever it came from, is internal iteration. `for...of` over another `Stream` needs no adapter: it opens a Scope region, takes the stream's pull with `Stream.toPull`, and loops over chunks until the pull signals the end. G12 is the experiment that confirms the adapter. A `for...of` over any other iterable closes the iterator it opened on every exit before the end: a jump, a failure in the body, its head, a default, or a destructuring, or an interruption, and a failing `return()` is combined with the exit (D356). JavaScript's own loop is emitted only with the runtime's close helper around its exits, which looks `return` up only when it closes the iterator (D404, D424); otherwise the loop runs through the runtime loop, since Effect abandons a generator without calling `return()` (Chapter 24). A generated frame in which a native loop's binding or body, or an array destructuring pattern, can pause is wrapped in `runtime.$iteratorFrame`, so JavaScript's own loop closes on every exit; the runtime loop for ordinary iterables is the same adapter around a native loop. The adapter is an Effect finalizer that owns the generator: when the frame is abandoned at a failed or interrupted `yield*`, it resumes the generator with a return completion, and JavaScript runs IteratorClose for every live loop and pattern, innermost first, with the native bindings, evaluation order and done flags intact. Source `catch` and `finally` are already Effect regions, so nothing in the frame intercepts that completion. A `return()` that throws or returns a primitive propagates out of the generator, as from a native loop that exits by a jump, and is a defect beside the original failure, defect or interruption (D305, D356). A finished iterator is never closed twice, and no pattern moves into a new lexical scope.

#### Trusted calls

A call to a trusted function that lists expected failures compiles to a plain call wrapped in a JavaScript `try` with no pause point inside, which the frame invariant allows:

```ts gen
// const meta = JSON.parse(text), whose trusted contract lists SyntaxError
let meta: any
try {
  meta = JSON.parse(text)
} catch (e) {
  if (e instanceof SyntaxError) return yield* Effect.fail(e)    // an expected failure
  throw e                                                       // a defect, as in any generator body (F4)
}
```

#### Observations and equivalence

One observation model judges every optimization the compiler makes and every rewrite a tool makes to source [Rule] (D372). Two programs are observationally equivalent when, run from the same Context, inputs, and outside world, they produce the same observations:

1. **The exit.** The same success value, or a Cause with the same reasons, Fail, Die, and Interrupt, in the same order (Chapter 17).
2. **Effects outside the program.** The same calls into code the compiler does not see, with the same arguments, in the same order, the same number of times: foreign functions, service members, control operations, and getters, proxy traps, iterator steps, and custom matchers.
3. **Bindings.** Every source reference reads the binding it resolves to in the source, with the source's `this`, `arguments`, `new.target`, `super`, and self-binding (Chapter 13, rules L and H).
4. **Lifetimes.** Each resource is acquired and released, and each fiber started and interrupted, by the same owner, in the same order relative to the other observations (Chapters 6, 7, 21).
5. **Suspension points.** Every point where the language lets another fiber run or an interruption arrive (Chapters 13 and 15) is still there.

Not observations: how many run-loop operations a program takes, and so where Effect's scheduler yields for fairness (every 2,048 operations); the shape and names of generated code; time; memory. A program must not depend on them.

- **Optimizations.** An optimization is valid only if the optimized program is observationally equivalent to the frame lowering of this chapter on every input, its exit included (D341): the plain-JavaScript path (Chapter 15), the single-result thunk (D274), the tail resume, and JavaScript's own `for...of` (D404). That a channel is `never`, or that a match is exhaustive, proves none of the observations by itself (settled decision 4).
- **Concurrency.** Where a program interleaves with other fibers, equivalence means that every set of observations the optimized program can produce, the original can produce too, with every suspension point kept.
- **Rewrites.** A quick fix, `vibelang --fix`, an automatic refactor, and the formatter produce a program observationally equivalent to the original, with the same types, or they are not applied (Chapter 28).

G10 compiles a corpus both ways and compares these observations (Chapter 30).

#### Patterns

A `match` or an `is` evaluates in one order, which every lowering keeps [Rule] (D328, D367, D368):

1. **The subject** is evaluated once, before any arm (D214).
2. **Arms** are tried in order. Within an arm the pattern is tested left to right, depth first; a test runs only after the tests before it in that arm succeeded, so a guard, `and if (…)`, runs only after the pattern terms before it matched (D502).
3. **Reads are shared.** Within one `match` or `is`, each property of each value is read at most once, and an iterator is advanced at most once per element, as the TC39 proposal caches them; a read happens when a test first needs it. A subpattern's subject, such as `value` in `when { value: 1 and let n }`, is that one read value, so its test and its binding see the same value.
4. **Matcher expressions**, such as `registry.State.Waiting` or a custom matcher's object, are evaluated when their arm's test is reached, in arm order.
5. **Names resolve by scope.** A name in a pattern resolves as any reference does (Chapter 13, rule H4). `Option.Some`, `Exit.Failure`, `Result.Success` and their siblings, the primitive classes `String`, `Number`, `Boolean`, `BigInt` and `Symbol`, and a data type's variants have their built-in tests only when the name resolves to that declaration, under any import alias. A local `Option` or `Number` shadows them, and the pattern then uses the local value as an ordinary matcher (D213).
6. **Every test runs.** Every arm's test runs when its arm is reached, the last arm of an exhaustive match included: its reads, its matcher expressions, and its comparisons. A last arm whose test fails is a defect (`$assertMatch`), as D346 requires (D405). No type proves a test inert: a literal-typed property, a data value's `_tag` included, may be a getter or a proxy trap, so a lowering that skipped its read would observe less than this rule. Branch coverage is never a reason to omit a test.
7. **Temporaries are fresh.** Every name the lowering introduces obeys Chapter 13's rule H, so a source binding named `$match1` keeps its value inside an arm.

#### Modules

A `.vibe` file is an ECMAScript module, and so is each `module` declaration in it [Rule] (D364, D365):

1. **Live bindings.** An import, a re-export, or a namespace import reads the exporting binding's current value at each use, so every importer sees an assignment to an exported `let`. A generated companion, such as an Effect function's plain variant (D268, D500), is read through the same binding at each use.
2. **Evaluation order.** A file's dependencies, its module declarations among them, are evaluated in the order of its import declarations, then its own body, as ECMAScript's module evaluation orders them. A module declaration the file never imports, or imports only types from, is not evaluated. Temporal dead zones, cycles, and a body's top-level `await` behave as ECMAScript specifies.
3. **Declarations keep their kind.** An `export function` is hoisted as a function declaration, wherever the lowering puts its body; listings in this specification that write `export const f = …` show the body's shape, not the binding's kind. The declaration file is a separate matter (Chapter 27). A plain function is the hoisted function itself, so a call from another module that reaches it before the exporting module's body has run, as one in a module cycle can, calls it as JavaScript does, synchronously, in plain code and Effect code alike: it starts no fiber, calls no runner, evaluates no module's body early, and gives the observations of the source's call (rule E11), a `ReferenceError` from a binding still in its temporal dead zone included (D500). An Effect function's plain variant is called only from code a fiber runs (D421), so a call of it before the exporter has attached `f[$direct]` runs the hoisted function's Effect form on the current fiber, as a call compiled without the variant does.
4. **Names.** A module declaration's name is case-sensitive, as every binding is. A body's declarations keep their source names, so a direct `eval` in the body sees them.
5. **Specifiers.** A relative specifier that names a `.vibe` or `.ts` source is written with the output's `.js` name in JavaScript and declarations (D31, D63, D298): in a static import or export, `import type`, an import type such as `typeof import("./user.vibe")`, and a dynamic `import()` whose specifier is a string literal. Only the extension changes, and the path is spelled as the emitted loader reads it: a file path for `require`, an escaped URL for an ES module `import`. A computed dynamic specifier is not rewritten and must name an output file.

The compiler keeps rules 1 and 2 by emitting each module declaration the file imports as a JavaScript module of its own, beside the file's output, and importing it there with that module's specifier in place of the identifier, so ECMAScript's own module evaluation orders it, its imports, and the file's other dependencies (D403). An implementation that cannot keep one of these properties for some construct rejects the construct with EK4408; it never substitutes a snapshot of an export or moves a module's evaluation.

#### What the guarantees assume

VibeLang's static guarantees hold for checked VibeLang code, relative to a trusted base [Rule] (D373). The guarantees:

- Every Fail reason that leaves a function has a type in that function's E (D355); E bounds neither defects nor interruption.
- A program's R includes every service it can look up, so a program run with its R provided does not fail with `Service not found`.
- A function with a plain return annotation never fails with an expected failure and needs no service (D282).
- `Scope` in R records an obligation to release; it does not prove that a resource is unused after its release.
- A control operation is handled on the fiber that performs it, or the runtime fails with `HandlerNotOnThisFiber` (P10).

What they assume, the trusted base:

1. **The implementation:** the compiler, `vibelang-runtime`, and `effect@4.0.6`.
2. **TypeScript's type system, where VibeLang uses it unchanged:** `any`, type assertions, non-null assertions, and TypeScript's documented unsound rules, such as bivariant method parameters, can make any guarantee false without a diagnostic.
3. **Foreign declarations:** an `Effect<A, E, R>` that a `.ts` or `.d.ts` file declares, and a `Context.Service` it declares, are trusted to describe what the implementation does. A foreign declaration's written signature also decides whether a call of it runs, read as rule R reads every signature (D449, D458). A TypeScript function that returns a `Disposable` whose release it registered records that release through `vibelang-runtime`'s `acquireRelease` or `acquireDisposable`; one that registers it with Effect's own records nothing, and `using` then disposes the value a second time (D401).
4. **Trust declarations:** Effect's packages and the values they return (D22, D121); the built-ins' shipped contracts (D101), `trustedPackages` (D261), `trusted(impl, [Errors])` (D249), and the deprecated `@vibelang trusted` and `@throws` tags (D23). A wrong one classifies an exception wrongly, as an expected failure or as a defect, and the guarantee about E then follows the declaration, not the code.
5. **Escapes:** a hatch's TypeScript (D148), a `module` declaration's body (D283), and `.ts` files are outside the checks.
6. **Callbacks and fibers:** a library calls a callback only as its type says, and the fiber-behavior table says which combinators run an argument on another fiber (Chapter 16); the runtime check stands behind the table (P10).
7. **Declarations without bodies:** a VibeLang package consumed through its `.d.ts` files is checked as foreign code, since a declaration cannot prove what a body does (Chapter 27), except the exports a module's entry in the compiler's manifest lists, whose plain functions and methods are trusted to compile to plain JavaScript, need no service, and fail with an expected failure only of a class a `Trusted<F, Errors>` type lists (D400, D421, D500, D516). The manifest is the producing package's assertion, as its declaration files are (item 3): a consumer trusts it as it trusts that package's declared types.
This is the one list of the trusted base; Chapters 10 and 17 cite it.
