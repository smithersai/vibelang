import test from "node:test"

// Pending slow runtime probes. These are unverified contracts, not observed compiler mismatches.

// Chapter 002: race/any interrupt losing ensuring-finalized Effects; interruptible timeout of each empty array observes no completion
// Spec rule: docs/design/src/002-running.md#066b04424cddd82d
test.todo("docs/design/src/002-running.md#066b04424cddd82d \u2014 race/any interrupt losing ensuring-finalized Effects; interruptible timeout of each empty array observes no completion")

// Chapter 002: all returns successes in operand order; a delayed failure interrupts a started never operand and runs its finalizer
// Spec rule: docs/design/src/002-running.md#4e47540836e1902e
test.todo("docs/design/src/002-running.md#4e47540836e1902e \u2014 all returns successes in operand order; a delayed failure interrupts a started never operand and runs its finalizer")

// Chapter 002: all [Effect.fail(error), loggingEffect] fails before loggingEffect starts
// Spec rule: docs/design/src/002-running.md#74e70215bf4c1621
test.todo("docs/design/src/002-running.md#74e70215bf4c1621 \u2014 all [Effect.fail(error), loggingEffect] fails before loggingEffect starts")

// Chapter 002: race returns first success, typed failure or defect, and interrupts every started loser
// Spec rule: docs/design/src/002-running.md#b9d4e033c9f28df5
test.todo("docs/design/src/002-running.md#b9d4e033c9f28df5 \u2014 race returns first success, typed failure or defect, and interrupts every started loser")

// Chapter 002: any ignores an early typed failure, returns later success and interrupts started losers
// Spec rule: docs/design/src/002-running.md#af6bef04532f9e41
test.todo("docs/design/src/002-running.md#af6bef04532f9e41 \u2014 any ignores an early typed failure, returns later success and interrupts started losers")

// Chapter 002: any all-failure Cause keeps chronological failure order; catch gets fast second operand before slow first operand
// Spec rule: docs/design/src/002-running.md#2b1dc350e866bd6e
test.todo("docs/design/src/002-running.md#2b1dc350e866bd6e \u2014 any all-failure Cause keeps chronological failure order; catch gets fast second operand before slow first operand")

// Chapter 002: any with a defect converts the combined chronological failures and defects to defects and never invokes catch
// Spec rule: docs/design/src/002-running.md#97ca8b24c542c92c
test.todo("docs/design/src/002-running.md#97ca8b24c542c92c \u2014 any with a defect converts the combined chronological failures and defects to defects and never invokes catch")

// Chapter 002: allSettled spread builds array once then wraps by index; replaced Array.prototype iterator sees only source spread iteration
// Spec rule: docs/design/src/002-running.md#f0a28a93bf9dc8de
test.todo("docs/design/src/002-running.md#f0a28a93bf9dc8de \u2014 allSettled spread builds array once then wraps by index; replaced Array.prototype iterator sees only source spread iteration")

