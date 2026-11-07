// Pending coverage obligations for this lane; no compiler conformance is claimed.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0017-fork.md#e3e140138d6af8a1
// VIP-17: parenthesized fork catch diagnostics.
// Activation: Compile fork (e catch h), (fork e) catch h, and unparenthesized controls; require no EK0505 for parentheses and EK0506 only for the Fiber catch.
test.todo("rule-evidence: docs/design/vips/0017-fork.md#decision | cov2-vips-b parenthesized fork catch diagnostics | present | *Corrected 2026-10-30: the quick fix was `fork (e catch h)`, which contradicted decided detail 99's own Effect TypeScript, `Effect.forkChild(Effect.catch(e, \u2026))` (found by the round-19 Fable review).* The parenthesized forms are not `EK0505`; `(fork e) catch h` is still `EK0506`, as a `Fiber` is not an Effect in Effect 4.1.1.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#657b0febacc88ea2
// VIP-26: ordinary function main.
// Activation: Export a plain main with an observable counter; module import must not call it, and an explicit call must increment once.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#decision | cov2-vips-b ordinary function main | present | A function named `main` is an ordinary function, and you call a runner yourself, exactly as in Effect TS.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#f60cc1f65858f126
// VIP-26: no implicit runner.
// Activation: Import an exported effect main and observe zero body executions until the consumer explicitly runs its Effect.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#amendment-source-file-kind | cov2-vips-b no implicit runner | present | This adds no implicit runner or special `main`.")
