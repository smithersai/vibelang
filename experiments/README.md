# VibeLang experiments

Disposable, one-command experiments behind `docs/design/src/`. They test two different things, and the tags in the design keep them apart:

- **Effect facts** (`F*`): behavior of the unmodified `effect@4.1.0` runtime.
- **Kernel laws** (`T*`, `K*`): the proposed language machine. The kernel adds prompt frames, one-shot capture, resumption, abandonment, and ownership to Effect's real fiber stack.

```sh
bun install                 # effect is pinned to exactly 4.1.0
bun test                    # tests/: 148 tests, about a second
bun bench/perform.ts        # operation costs
cd reference-machine && bun install && bun test   # independent strategy-B machine, ~17 s
```

A watchdog (`scripts/test-watchdog.ts`, preloaded by `bunfig.toml`) ends a run when one test runs past `KERNEL_TEST_STALL_SECONDS` (120 by default, `0` turns it off) and prints the file, the test's position in it and its probable name. bun's per-test timeout can't stop a test that spins in synchronous code.

| Path | Contents |
| --- | --- |
| `../packages/runtime/src/kernel/kernel.ts` | The continuation kernel: operations, evidence, `handle`, `perform`, `resume`, `resumeWith`, `abandon`, `transfer`, root `suspend` with bounded wake-ups, `handoff` |
| `../packages/runtime/src/kernel/internals.ts` | Structural access to `FiberImpl` fields; refuses to load on any Effect version but 4.1.0 |
| `../packages/runtime/src/kernel/trace.ts` | Names compiled-function frames and prints machine state |
| `tests/trace.test.ts` | T1: nested suspension and resumption through Context and Scope |
| `tests/kernel.test.ts` | One-shot ownership, handler semantics, interop, stack safety, producers, retry |
| `tests/kernel-edges.test.ts` | Resume-site state, masking, fiber affinity, foreign frames, finalizer failure |
| `tests/effect-facts.test.ts` | Effect 4.1.0 facts the design relies on |
| `tests/wakeup-chain.test.ts` | Effect's unbounded wake-up chains, and the kernel's bound |
| `bench/perform.ts` | In-place versus capturing operation cost by segment depth |
| `bench/deep-capture.ts` | Capture at every level of a deep recursion: the quadratic copy cost |
| `tests/context-bridges.test.ts` | Tracing spans and `AsyncLocalStorage` across a prompt capture |
| `tests/handoff.test.ts` | Handoff for producers with asynchronous shutdown |
| `tests/kernel-regressions.test.ts` | K11-K15: regressions for the 2026-10-16 review findings |
| `KERNEL-CHANGES.md` | The 2026-10-16 kernel fixes, their laws, and the lowerings the compiler must emit for tail resume and source `catch` |
| `scripts/v3-wakeup-chain.mjs` | The F10 wake-up chain on `effect@3.22.3`, showing the Effect 4 regression |
| `reference-machine/` | Strategy B: an explicit-frame machine over public APIs, written independently by Codex (GPT-6.1 Sol) |
| `scripts/runtime-facts/` | Scripts behind `docs/research/effect4-runtime.md` |

The kernel reaches undocumented `FiberImpl` fields (`_stack`, `interruptible`, `_interruptedCause`). It is a prototype of an Effect runtime extension, not a supported integration.
