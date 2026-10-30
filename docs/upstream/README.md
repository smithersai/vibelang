# Upstream drafts

Every entry is **drafted, not filed** (D59). Nothing in this directory
authorizes filing an issue, opening a pull request, or contacting maintainers.
The behavior below is pinned to `effect@4.0.5`, or to the version a draft names; the drafts make no claim about
later releases or the current state of upstream issues.

| Draft | Target | Summary | Status |
| --- | --- | --- | --- |
| [Bound synchronous wake-up depth](effect-wakeup-depth.md) | Effect runtime | Deferred wake-up chains overflow and strand waiting fibers; preserve the inline fast path with a depth budget. | drafted, not filed |
| [Define generator cleanup semantics](effect-gen-finally.md) | Effect runtime | Generator `finally`, `catch`, and disposal are skipped when yielded Effects fail or are interrupted. | drafted, not filed |
| [Warn on generator cleanup syntax](language-service-generator-cleanup.md) | Effect language service | Remove the cleanup exemption for JavaScript `try/finally` in Effect generators. | drafted, not filed |
| [Preserve defects during typed recovery](effect-catch-mixed-causes.md) | Effect runtime | Propose recovery restricted to causes containing only expected failures; ordinary `Effect.catch` discards mixed-cause defects. | drafted, not filed |
| [Budget completed generator yields](effect-gen-fairness.md) | Effect runtime | Completed Exit yields stay inside the iterator loop and bypass cooperative scheduling. | drafted, not filed |
| [Clarify Layer memoization boundaries](effect-layer-memoization-docs.md) | Effect migration docs | Explain why overlapping sibling provides build twice and how a prebuilt ambient MemoMap shares a resource. | drafted, not filed |
| [Support same-fiber delimited continuations](effect-prompt-primitive.md) | Effect runtime | Expose a supported prompt or stack-segment API with one-shot ownership and abandonment. | drafted, not filed |
| [Prototype segmented continuation storage](effect-segmented-stack.md) | Effect runtime | Avoid quadratic copying when capturing at every depth; benchmark before changing the stack representation. | drafted, not filed |
| [Explain repeated interruption reasons](effect-interrupt-reasons.md) | Effect runtime | Tracing adds several Interrupt reasons for one interruptor; preserve trace information without misleading counts. | drafted, not filed |
| [Ship custom matchers](effect-custom-matchers.md) | Effect data types | `Option`, `Exit`, `Result` and tagged errors get TC39 `Symbol.customMatcher` methods, so VibeLang can drop its fixed `match` checks (D208, VIP-7). | drafted, not filed |

Each draft contains a minimal reproduction, the expected behavior or proposed
contract, the VibeLang impact, and a suggested fix. Runtime observations
come from the [Effect research](../research/effect4-runtime.md),
[historical kernel changes](https://github.com/smithersai/vibelang/blob/e130b5d26d024100797feafde55c5a0cd6b31eec/experiments/KERNEL-CHANGES.md),
[historical prototype findings](https://github.com/smithersai/vibelang/blob/e130b5d26d024100797feafde55c5a0cd6b31eec/prototype/esc/FINDINGS.md), and the tests linked in
each draft. The supported-prompt and segmented-stack entries are API and
performance proposals, not claims that Effect violates a public contract.

The review's abandonment, tail-resume, and transferred-owner defects were
VibeLang kernel bugs, not Effect bugs, and K11-K13 fix them. Masked acquisition
is an existing policy with an `interruptible` option (K15). Service class
identity, Layer provider precedence, and hidden forks also have local language
rules; these drafts request no upstream semantic changes for those behaviors.
