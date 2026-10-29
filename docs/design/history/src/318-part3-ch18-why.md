## Part III. The runtime

> **Historical, not normative.** This is the previous specification, kept as reference. The language is defined by the accepted VIPs (`docs/design/vips/`) and the specification in `docs/design/src/`.

This part is for reviewing how VibeLang runs: how the features of Parts I and II execute on Effect 4's fiber runtime, what Effect already provides, what a small runtime extension (the **kernel**) adds, and which tests check each claim. Claims carry tags:

Its snippets follow Part I's conventions (Chapter 1): one without an enclosing function sits inside one, since a module's top level cannot run a program.

| Tag | Meaning |
| --- | --- |
| **[Effect]** | Verified in `effect@4.0.5` source (`experiments/node_modules/effect/src` at the time, cited as `file:line`) or by an Effect-only test (F1-F10, conformance tests D01-D05, K15a); the tests and the kernel laws run on the pinned `effect@4.0.6` |
| **[Kernel]** | Verified by a kernel test: T1-T17, K10-K15, H1-H4, G6, and the conformance suite's A, F, I, O, S, T, W, and X tests, which test the language model, not ordinary Effect programs |
| **[Prototype]** | Compiled from `.vibe` by the prototype compiler and run on the kernel: an example in `prototype/esc/examples` (Chapter 27) |
| **[Rule]** | A language rule, decided in Part V; the compiler enforces it, and no test can prove a rule a checker has not been built to enforce |
| **[Experiment]** | A rule whose implementation an experiment in Chapter 30 must still confirm |

### 18. Why a continuation runtime

```ts es
const cell = handle(() => search(grid, 42), Found, {
  found(cell, _k) { return cell }         // ends search() now; the cursors it opened close first
})

for (const line of lines(path)) {          // one value at a time; break closes the file
  if (line.startsWith("ERROR")) break
}
```

Both examples need one thing Effect does not expose today: a way for code on a fiber to take "the rest of the computation, up to here", hand it to a handler, and let the handler continue it once, later, or never. That object is a **one-shot delimited continuation**. Fubhy advised building the language on it: "Start with a one-shot delimited continuation though. That is kind of the core thing that anything else should be based on." Effect 4 already provides most of it; this part shows what the rest takes.

#### Effect already runs on continuations

Effect 4 runs every program as a one-shot continuation. A fiber's `_stack` is the rest of the computation, reified as an array of frames. `Effect.callback` parks it and accepts one resume. Interruption unwinds it through finalizer frames. Effect lacks a delimiter inside a fiber: the fiber's root is the only one, so the only continuation anyone can take is the whole fiber.

VibeLang adds the missing delimiter. A {{kernelLines}}-line kernel prototype on `effect@4.0.6` pushes prompt frames onto the real fiber stack and captures the segment above a prompt as a one-shot continuation. It restores the Context and interruptibility recorded at each boundary, abandons unresumed continuations through Effect's own finalizers, keeps a continuation from outliving the fiber that captured it, and bounds cross-fiber wake-up depth. {{testCount}} tests cover nested suspension with Context and Scope, double resumption, abandonment, interruption while a continuation is held, cancellation races, a 100,001-frame capture, capture through TypeScript-authored `Effect.forEach`, retry, producers in constant stack, cause-aware `catch`, and a 54-test conformance suite written by an independent reviewer.

Every feature in Parts I and II is a rule over that one machine:

- A function call is a frame; `throw` unwinds frames.
- A service is an operation whose handler runs in place, at the call.
- `using` and `finally` are finalizer frames.
- `fork` starts a new root that inherits the Context but no handlers.
- `handle` is a prompt, and a control operation captures the frames above it.
- A function compiles to plain JavaScript only when the compiler proves it cannot reach a pause or a capture, and its plain code ends with the Exit its frames would (Chapter 17).

#### Why not lower to `Effect.gen` first

An earlier proposal compiled VibeLang through `Effect.gen` and deferred delimited control to a later experiment. That cannot be the foundation, for four reasons that are facts about the running system:

1. `Effect.gen` and `flatMap` push frames onto one fiber stack whose only delimiter is the root. They sequence work but cannot hand "the rest of the computation up to here" to a handler, because nothing marks "here". When the handler is on another fiber, the operation is unhandled (T7b, T8).
2. `Effect.gen` drops its generator on failure and interruption without running JavaScript `finally` (F1-F3). A language that compiled `finally` to generator `finally` would leak on every failure.
3. Wrapping an API in `Effect.callback` parks the whole fiber or nothing. No frame inside the fiber can act as the handler for part of the stack.
4. A service method always returns to its caller exactly once. It cannot end the caller's remaining work with a value, defer it, or store it.

General delimited control therefore needs new frame kinds (`Prompt` and `Owner` above all) and capture, resume, and abandon operations: a runtime extension, which no choice of code generation supplies.

#### The central test

> Does the language make Effect's continuation runtime its foundation, with everything else derived from that model?

**Claim** [falsifiable]. Every feature is a rule over the machine in [Chapter 20](#20-the-machine), which has three continuation mechanisms: frames, root capture, and prompt capture. Effect provides frames and root capture; the kernel provides prompt capture. The claim is false if any feature needs a mechanism outside the machine: a second scheduler, a second Context, a JavaScript `try` the machine cannot see, or a calling convention that skips frames where a pause or capture is reachable. Plain JavaScript calls (Chapter 15) skip frames only where the compiler proves no such point is reachable, which is the frame invariant (Chapter 26) applied, not an exception to it, and only where the plain code ends with the same Exit as the frames, which is Chapter 17's Exit rule.

| Feature | Mechanism in the machine | Captures | Evidence |
| --- | --- | --- | --- |
| Program entry | A runner creates a fiber root for a program value | No | Chapters 13, 23 |
| Calls and returns | `Ret` frames; plain calls only where no pause or capture is reachable | No | T6a, T17; F9; `ch02-functions.vibe`, `ch13-plain.vibe` |
| `throw` and `catch` | Abortive unwinding to a `Catch` frame that recovers the first expected failure of a cause with no defect, as `Effect.catch` does (D306); a failure beside a defect unwinds as a defect (D305) | No: aborts | K14a-K14d, K16a-K16d; `resumeWith` test; `ch15-failures.vibe` |
| `finally` and `using` | `Final` frames on every exit, abandonment included | No | T1, T3, T4, T10, K11b; `regions.vibe` |
| Services | In-place evidence in the Context | No: runs in place | In-place evidence test; `ch04-services.vibe` |
| Providers and Layers | Installing evidence: `Restore` frames plus a Scope | No | Effect (Chapter 24) |
| Test overrides | Services: a `Restore` frame. Control operations: a handler for one region | Services: no. Control operations: yes | Override test; Chapter 9 |
| Async I/O, sleep, waits | Root capture with one-shot resume | Yes, at the root | T1 step ③; F5, F6 |
| Callback adapters | Root capture with a reported race and bounded wake-ups; masked or interruptible acquisition | Yes, at the root | T5b, T5c, K10a, K10b, K15a-K15c |
| Interruption | Asynchronous unwinding of the fiber's continuation, deferred by `Mask` frames | No | T4, T12 |
| Structured concurrency | New roots with a Context snapshot and no prompts; block-owned forks | No | F7, F8, T8 |
| Control handlers | Prompt capture, resume, abandon, ownership | Yes | T1-T4, T9, T13, T15; O01-O08; A01-A04; I03-I11; K12; `ref6-handlers.vibe` |
| Producers (`function*`) | One prompt capture per element; abandonment on `break`; constant stack under a tail resume | Yes | T10, T16, T17, K11a-K11d; `stack-depth.vibe` |
| Retry, race, all | Fresh runs of a program; nothing reused | No | T11 |

Features checked against the claim and kept out:

- **Multi-shot handlers** (backtracking, probabilistic choice). They need copyable frames, and Effect's frames are not: they hold live generators and closures bound to one fiber.
- **Durable execution.** It needs serializable continuations, a different machine. The earlier VibeLang project reversed course on it twice in ten days (`vibelang.md` §9).

**Verdict.** Yes. Two independent reviews (2026-10-16) reached the same verdict and found five defects in how the machine was implemented or lowered, not in what it is; all five are fixed with regression tests (K11-K15). A prototype compiler then mechanically lowered 46 example files, written from this document, to the machine and ran them on the kernel; no feature needed a mechanism outside it (Chapter 27). Two qualifications remain, both tracked in Chapter 30: prompt capture relies on undocumented Effect fields, so the foundation is real but not yet a supported Effect API (Chapter 25, G1); and the checker rules that make it safe to program against (fiber crossing, second-class continuations, control classes) are specified here but not built (G8).
