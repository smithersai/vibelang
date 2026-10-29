# vibelang-runtime

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

The VibeLang runtime: the one-shot continuation kernel and the helpers the
[`vibelang`](https://www.npmjs.com/package/vibelang) compiler emits. It runs on
Effect 4's fibers, scopes, and services.

## Install

```sh
npm install vibelang-runtime effect@4.0.6
```

JavaScript compiled by `vibelang` imports `effect` and `vibelang-runtime`, so an
application lists both as dependencies; `create-vibelang` apps already do. The
runtime requires **effect@4.0.6 exactly**: the kernel accesses that version's
fiber continuation stack. Install one copy of `effect`; with two, a Scope can
miss fibers it must stop.

## Build and test

For contributors, from this directory of the VibeLang repository:

```sh
bun install
bun run build
bun run test
```

The build uses TypeScript to write ES2022 JavaScript modules, declarations,
source maps, and declaration maps to `dist/`. Node 26 and Bun 1.4 load the
package's JavaScript export; TypeScript resolves it to `dist/index.d.ts`. The
package includes `dist/`, this README, and the license; build before packing or
installing a local copy. Generated files under `dist/` are ignored.

`bun run test` builds, then runs behavior tests through the package export;
`bun test` uses the current build. The tests import `bun:test`, so they run
only under Bun; Vitest cannot load that module. Fast-call suite only:
`bun run build && bun test tests/fastcalls.test.ts`.

The shared kernel model suite imports `experiments/tests/conformance/model-laws.ts`.
Before the full suite, install its pinned dependencies once from this directory:
`(cd ../../experiments && bun install --frozen-lockfile)`.

The tests cover each helper module, resource and interruption behavior, and
isolated Node, Bun, and browser bundle consumers, and compile a TypeScript
consumer against the declarations.

The original suites still run from the repository root:

```sh
(cd experiments && bun test)                  # 148 kernel law tests
bun prototype/esc/examples/run-all.ts          # 46 compiler examples
```

Generated JavaScript can compose helpers directly:

```js
import { Effect, $bind, $program } from "vibelang-runtime"

const answer = $program(() => $bind(42))
console.log(await Effect.runPromise(answer))
```

Applications normally write `.vibe` programs and let the compiler pick these
helpers. Programs stay lazy: a helper that receives a program starts no root
fiber; an explicit Effect runner starts execution at the application boundary.

## Effect version guard

At module load, `version.js` statically imports the public `effect/package.json`
export with the JSON import attribute and checks its version. This works in Node
and Bun, and bundlers inline the same metadata without a Node module loader or
file-system access. A mismatch throws an error naming the runtime version, the
installed and required Effect versions, and the command `npm install effect@4.0.6`.
Package metadata keeps module side effects, so browser tree shaking can't drop
the guard when a caller imports only a helper. The mismatch tests cover a
different patch version and Effect 3.

## Public exports

Every export from the package root. `$` marks compiler helpers; types have no
JavaScript value. Decisions are in [`docs/design/history/DECISIONS.md`](../../docs/design/history/DECISIONS.md).

| Export | Purpose | Decision |
| --- | --- | --- |
| `$assertMatch` | Require a successful pattern match | — |
| `$asyncHatch` | Adapt an asynchronous hatch and its optional AbortSignal | — |
| `$await` | Lower a retired await form | — |
| `$awaitAll` | Run concurrent programs and collect successes | — |
| `$awaitAllSettled` | Run concurrent programs and collect typed results | — |
| `$awaitAny` | Race for the first success | — |
| `$awaitRace` | Race for the first completion | — |
| `$catchCause` | Recover a complete Cause while preserving control abandonment | — |
| `$defineProperty` | Captured Object.defineProperty intrinsic | — |
| `$eager` | Track eager-call depth and its shared limit | — |
| `$errorSubclass` | Construct a tagged error subclass | — |
| `$errors` | The key under which a `trusted` value carries its failure classes | D514 |
| `$extract` | Extract pattern bindings | — |
| `$failureOf` | Find the first expected failure in a recoverable Cause | — |
| `$finallyExit` | Run cleanup with the try block exit | — |
| `$forConcurrent` | Run a concurrent loop | — |
| `$freeze` | Captured Object.freeze intrinsic | — |
| `$global` | Captured global object, for a global failure class such as SyntaxError that a binding of the module shadows | — |
| `$is` | Test a lowered pattern | — |
| `$join` | Join a fiber or collection of fibers | — |
| `$noFailure` | Sentinel for a Cause without a recoverable expected failure | — |
| `$noMatch` | Throw for a value that no match arm handled | — |
| `$patternError` | Mark an unsupported pattern during checking | — |
| `$provideEntries` | Provide a block's entries: a `Key = value` service as `Effect.provideService` does, a layer through `Effect.provide` | D173 |
| `$provideService` | Supply a service implementation | — |
| `$rest` | Extract object rest properties for a pattern | — |
| `$schemaErrorFamily` | Register a schema error family and its union schema | — |
| `$schemaErrorMember` | Register a schema error subclass with its ancestor families | — |
| `$select` | Lower a retired select operation | — |
| `acquireDisposable` | Effect's `acquireDisposable`, recording the value whose disposal it registered so `using` releases it once | D401, D481 |
| `acquireRelease` | Effect's `acquireRelease`, recording the value whose release it registered so `using` releases it once | D401, D481 |
| `attempt` | TypeScript name for the try hatch | — |
| `callback` | Adapt a callback API with cancellation | — |
| `customMatcher` | Symbol used to define a custom pattern matcher | — |
| `detach` | Fork a program independently of the current block | — |
| `interrupt` | Interrupt the running fiber | — |
| `interruptible` | Run a program with interruption enabled | — |
| `join` | The prelude's `join`: `join(x)` is the keyword `join x`, joining a fiber or collection of fibers | D391, D432 |
| `restore` | Restore the enclosing uninterruptible region’s previous interruptibility | — |
| `runCallback` | Run a program with a callback for its exit | — |
| `runFork` | Run a program on a new fiber | — |
| `runPromise` | Run a program as a Promise | — |
| `runSync` | Run a synchronous program | — |
| `sync` | Run a TypeScript hatch; exceptions become defects | — |
| `try` | Run a TypeScript hatch; exceptions become expected failures | — |
| `uninterruptible` | Run a program with interruption masked | — |
| `yieldNow` | Yield to the scheduler | — |
| `$bind` | Run an Effect result or lift an ordinary value during prototype call lowering | D24 |
| `Bind` (type) | Keep `$bind`'s success, failure, and requirement types | D24 |
| `$program` | Convert a zero-argument function to a lazy, rerunnable Effect | D7 |
| `$programs` | Convert an iterable of zero-argument functions to an array of Effects, or a record of them to a record of Effects | D49 |
| `$isRun` | Test whether a call's value runs where the call stands: an Effect that isn't a Config, a Context key, or an Error (including cross-realm YieldableErrors) | D24, L3 |
| `$direct` | Name the property, `f[$direct] = f$direct`, that gives callers in other modules a pure function's plain body | D10, D65 |
| `$done` | Return a finished fast call's value, as `Exit.succeed(value)` when the run check would run the value | L2 |
| `$settle` | Finish a fast call eagerly after its first step, or return the Effect that resumes its body on the fiber | L2 |
| `$fast` | Make the fast entry that bounds eager nesting; emitted today for every function the projector can't prove pure | L2, D10 |
| `Fast` (type) | Type a fast entry's result: the body's value, or an Effect that produces it | L2 |
| `$normal` | Represent normal completion of a lowered region or loop body | D14, D26 |
| `$catch` | Recover a cause containing expected failures only | D13, D28, D46 |
| `$catchExpression` | Run a catch expression's left side and recover as `$catch` does | D236 |
| `$isFailure` | Test a caught failure's `_tag` against a retired typed catch clause's tags | D131, D216 |
| `$finally` | Run cleanup on every exit and retain cleanup failures | D15, D46 |
| `$expected` | Mark a typed failure thrown in a function that compiles to plain JavaScript | D54, D282 |
| `$caught` | Return the expected failure a plain function's catch received, and rethrow a defect | D54, D282 |
| `$finallyFailure` | Join a failure a plain function's finally block raises to the failure in flight; two failures with a defect leave as a `SuppressedError` that stands for their joined cause | D15, D54, D340 |
| `$plainSync` | A plain function's Effect form: run the plain form, failing with the cause a `SuppressedError` the runtime made stands for, and record the plain form on the program | D340, D446 |
| `$plainOf` | A plain function's plain form from another module, before its module has attached `f[$direct]` too | D268, D446 |
| `$joinedFrame` | Internal compiler adapter: fail a generated frame with the cause a `SuppressedError` the runtime made stands for, where Effect would make it one defect | D340, D341 |
| `$region` | Create a block-owned scope without adding it to the body's Context | D14, D47 |
| `$using` | Run an acquisition with a block's scope, keeping its own interruptibility, and register disposal for objects and functions with interruption masked; await `Symbol.asyncDispose` when no acquisition release exists and no `Symbol.dispose` is present | D14, D25, D94 |
| `$fork` | Fork into a block's scope, with `forkIn`'s options, or require a scope from the caller | D19, D47 |
| `fork` | Expose `Effect.forkScoped` to TypeScript and prelude type positions | D4, D19 |
| `$Context` | Expose Effect's Context namespace for generated service references | D1, D40 |
| `$service` | Create the Context key base merged with a generated service interface | D1, D45 |
| `$reference` | Create the `Context.Reference` base of a service class that declares `static readonly default` | D40, D45 |
| `ServiceKey` (type) | Name the static side of a compiled service or control class in its declaration file | D45 |
| `ReferenceKey` (type) | Name the static side of a compiled service class with a static default in its declaration file | D40, D45 |
| `$control` | Register one kernel operation per generated control method | D2 |
| `Control` | Mark an abstract control declaration in the prelude | D2, D4 |
| `wire` | Compose layers in the dependent-first order computed by the compiler | D27 |
| `Continuation` (type) | Type the clause-local, one-shot continuation token: `Continuation<V, E, H>` | D16, D50 |
| `handle` | Install a deep handler and optional return clause; a clause for every operation | D16, D50 |
| `resume` | Resume a captured continuation with a value | D16 |
| `resumeWith` | Resume with an injected Effect that requires no services | D17 |
| `abandon` | Consume a continuation and run its cleanup without resuming its body | D16 |
| `$tailResume` | Return a tail-resume request without adding a clause frame | D18 |
| `$tailResumeWith` | Return a tail-resume request with an injected Effect | D17, D18 |
| `$clause` | Type a handle statement's clause bindings for the checker; compiled code never calls it | D132 |
| `YieldOf` (type) | Type a producer body's yields until a loop or a Stream handles them | D26 |
| `Producer` (type) | A producer: a `Stream` that also carries its body | D26 |
| `$produce` | Turn a generated producer body into a cold `Stream` that hands over one element per pull | D26 |
| `$yield` | Perform the built-in yield operation | D26 |
| `$yieldAll` | Yield every element of another producer, a Stream, or an iterable (`yield*`) | D26 |
| `$forOf` | Iterate a producer under a `Yield` handler, pull a Stream, or iterate a JavaScript iterable with IteratorClose, and lower loop completion records | D18, D26 |
| `$iteratorFrame` | Internal compiler adapter: unwind the native loops and array destructuring of an abandoned generator so JavaScript runs IteratorClose; a throwing `return()` is a defect beside the original cause | D26, D305 |
| `$forStream`, `$toStream` | Kept for the prototype compiler's output: `$forOf`, and the identity | D26 |
| `trusted` | Wrap a synchronous implementation as one plain function that carries its expected-failure classes | D249, D514 |
| `$trusted` | Run a trusted call: an instance of a listed class is an expected failure, any other exception a defect | D5, D23 |
| `$trustedPlain` | Run a trusted call inside a plain function's own try: a listed exception becomes an expected failure its catch receives | D54, D282 |
| `Effect` | Supply the prelude Effect namespace | D4 |
| `Layer` | Supply the prelude Layer namespace | D4 |
| `Schema` | Supply the prelude Schema namespace | D4 |
| `Scope` | Supply the prelude Scope namespace | D48 |
| `Experimental` | Supply the prelude Experimental namespace: VibeLang's additions where Effect lacks an API | D313 |
| `TaggedError` | Expose Effect's `Data.TaggedError` | D3 |
| `pipe` | Supply the prelude pipeline function | D8 |
| `Exit` | Expose Effect completion values to TypeScript adapters | D43 |
| `runMain` | Run a prototype entry program and return its Exit | D38 |
| `$entry` | Run an entry module's `main` when the host started the module, unbundled or as a bundle's entry module | D135 |
| `$runMain` | Run an entry module's `main` as `NodeRuntime.runMain` would, when `@effect/platform-node` isn't installed | D135 |
| `suspend` | Bridge callback registration with a resumer that reports a lost race | D43 |
| `Resumer` (type) | Type `resume` and the callback registration state | D43 |
| `handoff` | Bridge sources that acknowledge cancellation before releasing late values | D43 |
| `HandoffProtocolViolation` | Report duplicate delivery or delivery after acknowledged shutdown | D43 |

The kernel's implementation modules are private package files; their source
stays in `src/kernel/` so the original law and trace suites can test the
continuation machine directly. Generated code uses the package root. Tests and
instrumentation import the kernel module itself from `vibelang-runtime/kernel`,
such as its `hooks`, which report each capture and resumption; the compiler's
acceptance case `stack-depth` uses them to check that loops run in constant stack.

## Experimental platform APIs

`vibelang-runtime/experimental` holds what VibeLang adds where Effect lacks a
platform API (D313), one module per service, each also a subpath:
`vibelang-runtime/experimental/FileSystem` (Effect's `FileSystem` plus
`access` with `executable`, `open` with `nonBlocking` and `File.chmod`),
`vibelang-runtime/experimental/Crypto` (Effect's `Crypto` plus `hmac`, `sign`
and `verify`), `vibelang-runtime/experimental/Process` (the process id,
platform, host name and other facts, `kill` and `isRunning`) and
`vibelang-runtime/experimental/Locks` (Web Locks: `hold`, `tryHold` and
`query`). Each service has its own key; `FileSystem` and `Crypto` are
supersets of Effect's interfaces. The layers are in
`vibelang-runtime/experimental/platform-node` (`ExperimentalNodeServices`,
`ExperimentalNodeFileSystem`, `ExperimentalNodeCrypto`, `ExperimentalNodeProcess`, `ExperimentalNodeLocks`), `-bun`
(`ExperimentalBunServices`, `ExperimentalBunFileSystem`, `ExperimentalBunCrypto`, `ExperimentalBunProcess`) and `-browser`
(`ExperimentalBrowserServices`, `ExperimentalBrowserCrypto`, `ExperimentalBrowserLocks`). A layer of a service
that extends Effect's provides the experimental service and Effect's service
of the same name from one implementation. `ExperimentalNodeServices` and `ExperimentalBunServices`
are Effect's bundles plus `FileSystem`, `Crypto` and `Process`;
`ExperimentalBrowserServices` provides `Crypto` and `Locks`; `ExperimentalNodeLocks`, which locks
within one process only, is in no bundle. Install the matching
`@effect/platform-*` package, an optional peer dependency. The
platform-neutral modules import only `effect`, and the service keys are pure,
so a program that does not use them bundles none of them.

## Fast calls without types

The text-only projector (decision (B)) can't see types, so `$isRun`, `$direct`,
and the fast-call helpers decide at run time what the fork decided from types.
That decision's language changes: a function is plain JavaScript only with a
plain return annotation (L2), and a call runs its value when the value is an
Effect at run time (L3). No helper changes what a call computes.

| Call in an Effect body | JavaScript the projector writes |
| --- | --- |
| A same-file pure function | `f$direct(x)` |
| A function another `.vibe` module exports | `(($t = (f[$direct] ?? f)(x)), f[$direct] ? $t : ($isRun($t) ? (yield* $t) : $t))` |
| Any other same-file function | `(($t = f$fast(x)), $isRun($t) ? (yield* $t) : $t)` |
| Anything else | `(($t = c), $isRun($t) ? (yield* $t) : $t)` |

A fast entry runs the function's generator, `f$body`, eagerly on the caller's
stack. If the body finishes without needing the fiber, the entry returns the
value through `$done`, which wraps in `Exit.succeed` a value `$isRun` would run.
Otherwise it returns an Effect that resumes the body on the fiber after the
Effect the body yielded, or the failure the body yielded. The call site then
has the slow call's result, `yield* f(x)`. A yielded Exit resolves in place, as
Effect.gen's own generator step resolves it. The projector writes this entry
today for every function it can't prove pure:

```js
const f$fast = $fast(f$body)
```

A planned per-function entry uses `$done` and `$settle` directly for functions
outside a same-file call cycle:

```js
function f$fast(a, b) { const it = f$body(a, b), s = it.next(); return s.done ? $done(s.value) : $settle(it, s) }
```

Only a same-file call cycle nests eager runs without limit; a call of another
module's function, a lambda, or a function value starts its body on the fiber.
`$fast` counts eager nesting: after 100 nested entries it returns the slow
call's Effect, which starts the body on the fiber with heap frames (D10). Each
eager level holds three JavaScript frames, sized by the body's live locals.
Node 26.10's default stack overflows at 3,085 levels with no locals, 888 with
80, 485 with 200, and 272 with 400; with 80 locals on a 6,000-frame plain base
stack, at 297. Bun 1.4.1 overflows at 9,384 with no locals and 4,143 with 80. A
cap of 100 leaves room in these measured cases but can't guarantee stack safety
for every body: enough live locals, a deeper base stack, or plain recursion
inside a body can still overflow. A RangeError becomes a Die; retrying the body
would be unsound because its side effects may already have run. The tests run
100,000-deep recursion on Bun and Node, including Node bodies with 0, 80, and
200 live locals.

The run check also recognizes cross-realm YieldableErrors, whose Effect 4.0.6
string key `"~effect/Effect/identifier"` is `"YieldableError"`, so they stay
data even when `instanceof Error` is false.

The edges, each with a test in `tests/fastcalls.test.ts`:

- Handlers, `resume`, and interruption see the suspended body as an ordinary
  generator frame: tail and non-tail resumes, a continuation resumed twice,
  and cleanup on interruption behave as for the slow call.
- The eager part has no interruption check or scheduler yield, like a
  `$direct` call. An interrupt pending at the call arrives at the first
  suspension, after the eager part ran; the slow call takes it before the
  body starts.
- A failure the body yields, and a defect it throws after its first step,
  surface at the call site's `yield*`, inside the caller's regions, with the
  slow call's Cause. A throw in the planned per-function entry's first step,
  or while `f$body(a, b)` binds its parameters, leaves the caller's body as a
  JavaScript exception, which the fiber makes the same defect at the
  caller's step; an Effect body has no JavaScript `try` (D54) to see the
  difference. `$fast`'s entry catches both.
- Running one suspended fast call twice is a defect: the body resumes once.
- The fast path has no span, so a function that D34's tracing compiles with
  `Effect.fn` keeps the slow call.

Nanoseconds per call, in the text-only study's shapes: 200,000 calls of
`n * 2` in one Effect function, best of 15 rounds. From this directory:

```sh
bun run build && node tests/fastcalls-bench.mjs
```

| Call | ns per call |
| --- | ---: |
| `$direct`, same file (D10 today) | 1.9 |
| Plain helper + `$isRun` (L3) | 4.8 |
| `f[$direct]`, another module | 6.0 |
| Fast call, pure body | 14.9 |
| `$fast` entry, pure body | 15.1 |
| Fast call, body yields an Exit | 36.2 |
| `$fast` entry, body yields an Exit | 37.2 |
| Effect function + `$isRun` | 118.3 |
| Fast call, body suspends | 139.4 |
| Effect function, `yield* f(x)` (the slow call) | 149.0 |
| `$fast` entry, body suspends | 149.4 |
| Effect function, body yields an Exit | 228.5 |
| Effect function, body suspends | 428.8 |

The run check alone costs 2.9 ns over an inline call; the property check,
4.1 ns. Node 26.10.0 measured these on a Mac mini (darwin arm64, 14 cores) that
other jobs held at a load average of 78 to 147, so each row is the best of two
runs. Rows that allocate (Effect functions and suspending fast calls) still
carry that load: on an idle machine the study measured the slow call at 179 ns
and a suspending one at 259 ns. Rows that don't allocate repeated within 0.5 ns.

## Provide blocks

`provide Key = value { }` compiles to
`$provideEntries(body, [$provideService(Key, "Key", value)])`, which provides
the service as `Effect.provideService` does. Only a layer the block lists
goes through `Effect.provide`. Nanoseconds per pass, best of 15 rounds of
20,000 passes. From this directory:

```sh
bun run build && node tests/provide-bench.mjs
```

| Form | ns per pass |
| --- | ---: |
| `Effect.provideService` | 383 |
| `provide Key = 1 { }` (`$provideEntries`) | 563 |
| `Effect.provide` with a one-service Layer (before) | 2,103 |

## Prototype compatibility

The extraction keeps the prototype's helper names and execution behavior. The
compiler orders `wire` arguments with dependents before providers; the runtime
doesn't inspect or sort Layer dependencies. `$trusted` tests `instanceof`
against the classes the compiler passes (D51); the prototype matched exception
tags and constructor names.

`Continuation<V, E, H>` follows D50: `V` is what the perform site receives, `E`
the operation's declared errors, which `resumeWith`'s program may raise, and `H`
what `resume` returns. `handle` takes `H` to be the program's own result,
exact when no clause that returns a value of another type resumes; with
`onReturn`, `H` is `never`, so a clause's tail `resume` adds nothing to the
`handle`'s result (D97).

A producer is a `Stream`. `for...of` over it runs its body under a `Yield`
handler on the loop's fiber and resumes it in tail position, so a long producer
runs in constant stack; a loop that ends early abandons it, which runs its
cleanup. Anything else that runs it as a `Stream` starts its body on its own
fiber at the first pull; the `Yield` clause completes the pending pull and waits
for the next before resuming the body: an unbuffered handoff, so the producer
never runs ahead of its consumer (D26; the prototype's adapter used a
one-element buffer). Closing the stream interrupts that fiber, which runs the
producer's cleanup.
