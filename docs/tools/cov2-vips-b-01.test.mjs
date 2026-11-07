// Pending coverage obligations for this lane; no compiler conformance is claimed.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#657b0febacc88ea2
// VIP-26: ordinary function main.
// Activation: Export a plain main with an observable counter; module import must not call it, and an explicit call must increment once.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#decision | cov2-vips-b ordinary function main | present | A function named `main` is an ordinary function, and you call a runner yourself, exactly as in Effect TS.")

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#f60cc1f65858f126
// VIP-26: no implicit runner.
// Activation: Import an exported effect main and observe zero body executions until the consumer explicitly runs its Effect.
test.todo("rule-evidence: docs/design/vips/0026-top-level-and-main.md#amendment-source-file-kind | cov2-vips-b no implicit runner | present | This adds no implicit runner or special `main`.")
