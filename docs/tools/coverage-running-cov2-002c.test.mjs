import test from "node:test"

// Pending slow runtime and multi-context probes. These are unverified contracts, not observed compiler mismatches.

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

// Chapter 002: every numeric limit at or below one runs in operand order on the enclosing fiber; include negative infinity zero and fractions
// Spec rule: docs/design/src/002-running.md#5af68a59385fc4fb
test.todo("docs/design/src/002-running.md#5af68a59385fc4fb \u2014 every numeric limit at or below one runs in operand order on the enclosing fiber; include negative infinity zero and fractions")

// Chapter 002: fractional numeric limits fork item fibers with ceil(n) peak; NaN forks distinct fibers one at a time, explicit unbounded forks all items
// Spec rule: docs/design/src/002-running.md#a544ddbf8b6957aa
test.todo("docs/design/src/002-running.md#a544ddbf8b6957aa \u2014 fractional numeric limits fork item fibers with ceil(n) peak; NaN forks distinct fibers one at a time, explicit unbounded forks all items")

// Chapter 002: a plain fork in concurrent(1) survives its item until parent termination; concurrent(2) interrupts the child when its item ends
// Spec rule: docs/design/src/002-running.md#512df570595080b9
test.todo("docs/design/src/002-running.md#512df570595080b9 \u2014 a plain fork in concurrent(1) survives its item until parent termination; concurrent(2) interrupts the child when its item ends")

// Chapter 002: parallel forEach materializes non-array iterable first, including NaN, but reuses an array by reference without its custom iterator and observes later indexed mutations
// Spec rule: docs/design/src/002-running.md#411a9a40b36c59b9
test.todo("docs/design/src/002-running.md#411a9a40b36c59b9 \u2014 parallel forEach materializes non-array iterable first, including NaN, but reuses an array by reference without its custom iterator and observes later indexed mutations")

// Chapter 002: omitted concurrency uses unbounded; two barrier-blocked items start together, while written numeric values retain native forEach behavior
// Spec rule: docs/design/src/002-running.md#39585efa1ff27806
test.todo("docs/design/src/002-running.md#39585efa1ff27806 \u2014 omitted concurrency uses unbounded; two barrier-blocked items start together, while written numeric values retain native forEach behavior")

// Chapter 002: forEach failure adds no IteratorClose; compare custom iterator return calls, pull order and array indexed mutation with pinned Effect
// Spec rule: docs/design/src/002-running.md#307c4871ff805451
test.todo("docs/design/src/002-running.md#307c4871ff805451 \u2014 forEach failure adds no IteratorClose; compare custom iterator return calls, pull order and array indexed mutation with pinned Effect")

// Chapter 002: stream loop pulls one element at a time in order; track suspended channel pulls independently from producer buffer
// Spec rule: docs/design/src/002-running.md#0cfb4b43fc7d8bff
test.todo("docs/design/src/002-running.md#0cfb4b43fc7d8bff \u2014 stream loop pulls one element at a time in order; track suspended channel pulls independently from producer buffer")

// Chapter 002: stream continue skips one item; break interrupts an active producer and runs scope finalizers; body failure fails the loop
// Spec rule: docs/design/src/002-running.md#894c0ae7f58dd3eb
test.todo("docs/design/src/002-running.md#894c0ae7f58dd3eb \u2014 stream continue skips one item; break interrupts an active producer and runs scope finalizers; body failure fails the loop")

// Chapter 002: inside stream loop scoped and explicit-scope forks end with their Scope, detached forks survive; break/failure still finalize the stream
// Spec rule: docs/design/src/002-running.md#bd9bae9b506d5b38
test.todo("docs/design/src/002-running.md#bd9bae9b506d5b38 \u2014 inside stream loop scoped and explicit-scope forks end with their Scope, detached forks survive; break/failure still finalize the stream")

// Chapter 002: const and let stream head destructuring defaults run first inside each element generator, before the body, including defaults that run Effects
// Spec rule: docs/design/src/002-running.md#b3e58a9dda65d2dd
test.todo("docs/design/src/002-running.md#b3e58a9dda65d2dd \u2014 const and let stream head destructuring defaults run first inside each element generator, before the body, including defaults that run Effects")

// Chapter 002: public protected private static and computed producer methods follow async member modifiers, and effect generator declarations return Streams
// Spec rule: docs/design/src/002-running.md#a952084cd18c9408
test.todo("docs/design/src/002-running.md#a952084cd18c9408 \u2014 public protected private static and computed producer methods follow async member modifiers, and effect generator declarations return Streams")

// Chapter 002: written Stream<A,E,R> rejects each incompatible yield, escaping typed error and unsupplied service independently, with admitted A/E/R controls
// Spec rule: docs/design/src/002-running.md#9dafad92148e5b62
test.todo("docs/design/src/002-running.md#9dafad92148e5b62 \u2014 written Stream<A,E,R> rejects each incompatible yield, escaping typed error and unsupplied service independently, with admitted A/E/R controls")

// Chapter 002: Stream annotations admit aliases any unknown and compatible unions; reject number[] and returning never with EK2102
// Spec rule: docs/design/src/002-running.md#5b6be87d7a6699cf
test.todo("docs/design/src/002-running.md#5b6be87d7a6699cf \u2014 Stream annotations admit aliases any unknown and compatible unions; reject number[] and returning never with EK2102")

// Chapter 002: restore across independent effect declarations expressions arrows methods producers or blocks, and concurrent head/body, requires EK2202; own inner masks are allowed
// Spec rule: docs/design/src/002-running.md#d07d206f3e47eb78
test.todo("docs/design/src/002-running.md#d07d206f3e47eb78 \u2014 restore across independent effect declarations expressions arrows methods producers or blocks, and concurrent head/body, requires EK2202; own inner masks are allowed")

// Chapter 002: whole unparenthesized arrow pipe body is EK2301; parenthesized (() => %) is admitted, while missing and nested-only outer topics retain EK2301
// Spec rule: docs/design/src/002-running.md#81cb4ca641279c2c
test.todo("docs/design/src/002-running.md#81cb4ca641279c2c \u2014 whole unparenthesized arrow pipe body is EK2301; parenthesized (() => %) is admitted, while missing and nested-only outer topics retain EK2301")

