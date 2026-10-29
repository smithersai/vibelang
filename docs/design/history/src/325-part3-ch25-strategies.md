### 25. Implementation strategies and costs

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

```text
$ bun bench/perform.ts          (Bun 1.4.1, Apple silicon; indicative, not a benchmark suite)
plain Effect service call (yield* Counter; next)               105 ns/op
kernel perform, in-place evidence                               87 ns/op
kernel perform, capture + resume, 0 frames in segment          247 ns/op
control: in-place evidence under 10 compiled frames           1141 ns/op
kernel perform, capture + resume, 10 frames in segment        1526 ns/op
control: in-place evidence under 100 compiled frames         10853 ns/op
kernel perform, capture + resume, 100 frames in segment      13101 ns/op
control: in-place evidence under 1000 compiled frames       118108 ns/op
kernel perform, capture + resume, 1000 frames in segment    134409 ns/op
```

A service call through the kernel costs what one costs in Effect today. A capture plus resume costs about 165 ns plus 16 to 22 ns per captured frame. Entering one compiled generator frame costs about 110 ns, and that dominates. Two rules follow: services must run in place, never through capture; and compiled frames, not capture, are the main cost to optimize (Chapter 15).

The run above predates the tail-resume fix, which adds one frame to every clause invocation. A rerun on 2026-10-16, on a machine busy with other work, measured capture plus resume at 223 ns with 0 frames, 1,650 ns with 10, and 14,661 ns with 100: the same shape, with the per-frame cost unchanged.

#### Five candidates

The machine in Chapter 20 is fixed. These are ways to run it. Two were built and tested.

| Strategy | Same-fiber semantics | Capture through TypeScript-authored Effect frames | Depends on Effect internals | Status |
| --- | --- | --- | --- | --- |
| **A. Effect-native prompts.** Prompt and owner frames live on Effect's real `_stack`; capture splices it. | Yes | Yes: through `Effect.forEach`, `Effect.scoped`, `provideService` (T1, T7a) | Yes: `_stack`, `interruptible`, `_interruptedCause`, frame keys, and the interruption skip loop's reliance on `ensureCont` | Built: `packages/runtime/src/kernel/`; {{testCount}} tests pass in under a second, including a 54-test conformance suite covering runtime boundaries |
| **B. Explicit frame machine.** A defunctionalized interpreter inside one Effect fiber, using only public APIs. | Yes | No: an embedded Effect is an opaque step; its frames are not the machine's | No | Built independently: 20 tests pass in about 18 s. Disagrees with A on the Context a reinstalled prompt records (`tests/runtime-boundaries.test.ts`), and lacks `transfer` and `onReturn` |
| **C. One fiber per prompt.** The body runs on a child fiber; operations are messages to the parent. | No: the clause and the body run on different fibers, and interruption is relayed | Partially | No | Not built |
| **D. Generator kernel.** Each activation is a generator driven by a VibeLang loop inside one fiber. | Yes | No, for the same reason as B | No | Not built; the earlier VibeLang project's checkpoint built one beside its own host loop |
| **E. CPS or state machines.** A representation of compiled function frames, not a capture strategy. | Under A, yes | Under A, yes | No | Evaluated below |

#### Deep capture

Capture is linear in segment length, so a program that captures at every level of a deep recursion copies quadratically. `bun bench/deep-capture.ts` measures it on strategy A:

```text
depth  1000:     6.6 ms,     501,501 frames copied
depth  2000:     9.6 ms,   2,003,001 frames copied
depth  4000:    23.4 ms,   8,006,001 frames copied
depth  8000:    78.9 ms,  32,012,001 frames copied
```

The growth is quadratic, but the constant is about 2.5 ns per frame copy, so it matters only for very deep producers. The reference machine's deep test hits the same shape and takes most of its 18 s. Segmented stacks would remove the quadratic term for both strategies, but only Effect can make `_stack` segmented (G17).

#### Decision

**Strategy A is the runtime** [Rule]. It is the only candidate where TypeScript-authored Effect code on the same fiber is transparent to capture (T7a), which seamless Effect interop requires. It also reuses Effect's finalizers, masks, scheduler, and tracing instead of re-implementing them.

**Strategy B is the reference semantics** [Rule]. Two independent implementations of the same laws make the laws, not an implementation, the specification. Today they pass separate suites, and they do not agree everywhere: B records the `handle` site's Context in a reinstalled prompt where Chapter 22 requires the resume site's (the prompt-context regression). Passing tests in both is therefore not evidence of agreement. G16 writes the Chapter 20 laws once and runs them against both; Prompt-context restoration is its first law. A law that one passes and the other fails is a bug in an implementation or an ambiguity in Chapter 20, never something to paper over.

**What strategy A costs** [Rule]. The kernel reaches undocumented fields structurally, because `package.json` maps `effect/internal/*` to `null`. The pin points:

```text
fiber._stack              read, splice, push, unshift          internal/effect.ts:516
fiber.interruptible       read, write                          internal/effect.ts:514
fiber._interruptedCause   read, write (sticky abort)           internal/effect.ts:520
fiber._deferredInterrupt  cleared when a mask begins           internal/effect.ts:523, 636
frame keys                ~effect/Effect/successCont …         internal/core.ts:46-58
skip loop                 frames stop it only via              internal/core.ts:613-627
                          ensureCont lowering ι
restore closures          bound to the pushing fiber           internal/effect.ts:2200-2208
stack bottom              FiberExitFrame at _stack[0]          internal/effect.ts:516
```

Mitigation: pin `effect` exactly, check the version at load (`kernel/internals.ts`), and run the law suite on every Effect release. The durable fix is upstream: a supported prompt primitive, or at least a public stack-splice and interruptibility API on `Fiber`. The kernel is the concrete reference for the supported-prompt proposal (G1). The [supported-prompt draft](../../upstream/effect-prompt-primitive.md) states the capability and its laws; D59 sets the status to drafted, not filed.

#### Representations of a compiled frame

Under strategy A, capture moves whatever objects sit on `_stack`. How a compiled function's activation is represented is a separate choice, judged by the frame invariant (Chapter 26) and by what Effect does to it on failure (F1-F4).

| Representation | Satisfies the frame invariant | Behavior on failure and abandonment | Cost and codegen | Verdict |
| --- | --- | --- | --- | --- |
| Generator frame (`Effect.fnUntraced`) | Yes: each activation is one `Iterator` frame; calls are `yield*` of the callee's Effect, so JavaScript depth stays constant (T6a) | Effect drops the generator without `return()` (F1-F3), so source `catch`, `finally`, and `using` must compile to Effect frames. Nothing else is lost: the frame holds no cleanup | ~110 ns per activation; simplest codegen; readable output; debuggable as ordinary generators | **v0** |
| Explicit state machine (regenerator style: a frame object with `pc` and a locals record) | Yes, directly: the object is `Ret(f, pc, locals)` | Same as generators: the frame holds no cleanup, so the same region lowering applies | Avoids allocating a generator and an iterator per activation; codegen is larger and harder to read | **Later**, if profiles show generator frames dominate |
| CPS with continuation closures | Only if each continuation closure is pushed as a frame. Calling continuations directly builds JavaScript stack and breaks the invariant | A closure called on the JavaScript stack cannot be captured or abandoned | Closure per call site; needs a trampoline to stay stack-safe, which turns it back into frames | **Rejected**; it is the state machine above with extra allocation |
| Plain JavaScript | Only for regions with no capture or pause point (Chapter 15) | A JavaScript exception is a defect (F4); `finally` and iterator close combine failures through the runtime, as frames do (Chapter 17) | Fastest | **Optimization** for proven `pure`/`sync` code |
