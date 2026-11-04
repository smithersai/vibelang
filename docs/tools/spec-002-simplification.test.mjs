import assert from "node:assert/strict"
import { test } from "node:test"
import { read } from "./spec-witness.mjs"

// 002 simplification changes wording, not behavior. Existing compiler coverage is
// cited below. This historical base predates exact rule-evidence citations, so
// inheritance cannot be claimed without fabricating old evidence. Keep explicit
// pending obligations until those compiler witnesses can be repointed and run.

// Existing behavioral witness: typescript/vibelang/cases/catch-expression/main.vibe
// Pending: rerun that case against this sentence with an exact evidence citation.
test.todo("rule-evidence: docs/design/src/002-running.md#meaning | 002-cut-1 existing catch-expression | present | On a failure in its error channel it calls `h` with the error.")

test("002 cut 1 retains its rule and existing catch-expression witness", () => {
  assert.ok(read("docs/design/src/002-running.md").includes("On a failure in its error channel it calls `h` with the error."))
  const witness = read("typescript/vibelang/cases/catch-expression/main.vibe")
  assert.ok(witness.includes("catch () => \"guest\""))
  assert.ok(witness.includes("orGuest(\"missing\")"))
})

// Existing behavioral witness: typescript/vibelang/cases/do-jump-operand-order/main.vibe
// Pending: rerun that case against this sentence with an exact evidence citation.
test.todo("rule-evidence: docs/design/src/002-running.md#do-expressions | 002-cut-2 existing do-jump-operand-order | present | <a id=\"evaluation-order\"></a>**Evaluation order.** A `do` or `match` runs where ECMAScript evaluates the expression that holds it, never earlier or more often.")

test("002 cut 2 retains its rule and existing do-jump-operand-order witness", () => {
  assert.ok(read("docs/design/src/002-running.md").includes("<a id=\"evaluation-order\"></a>**Evaluation order.** A `do` or `match` runs where ECMAScript evaluates the expression that holds it, never earlier or more often."))
  const witness = read("typescript/vibelang/cases/do-jump-operand-order/main.vibe")
  assert.ok(witness.includes("inCall"))
  assert.ok(witness.includes("inObject"))
  assert.ok(witness.includes("inArray"))
})

// Existing behavioral witness: typescript/vibelang/cases/do-jump-operand-order/main.vibe
// Pending: rerun that case against this sentence with an exact evidence citation.
test.todo("rule-evidence: docs/design/src/002-running.md#do-expressions | 002-cut-3 existing do-jump-operand-order | present | Everything to its left runs first, in source order, fully evaluated as ECMA-262 specifies (callee and receiver read, spreads iterated, keys converted, earlier template substitutions stringified), so `o.m(try a(), match (x) { … })` reads `o.m`, runs `a()`, runs the `match`, and calls the method with `this` as `o`.")

test("002 cut 3 retains its rule and existing do-jump-operand-order witness", () => {
  assert.ok(read("docs/design/src/002-running.md").includes("Everything to its left runs first, in source order, fully evaluated as ECMA-262 specifies (callee and receiver read, spreads iterated, computed object-literal keys converted, earlier template substitutions stringified), so `o.m(try a(), match (x) { … })` reads `o.m`, runs `a()`, runs the `match`, and calls the method with `this` as `o`."))
  const witness = read("typescript/vibelang/cases/do-jump-operand-order/main.vibe")
  assert.ok(witness.includes("callee()(rec(\"a\""))
  assert.ok(witness.includes("rec(\"a\""))
})

// Existing behavioral witness: typescript/vibelang/cases/do-method-bind-shadow/main.vibe
// Pending: rerun that case against this sentence with an exact evidence citation.
test.todo("rule-evidence: docs/design/src/002-running.md#do-expressions | 002-cut-4 existing do-method-bind-shadow | present | Calls keep ECMA-262's `EvaluateCall` and `ArgumentListEvaluation`, and lowering adds no observable helper lookup, temporary name ([source names](001-functions.md#source-names)) or change to `this` and `super()` order.")

test("002 cut 4 retains its rule and existing do-method-bind-shadow witness", () => {
  assert.ok(read("docs/design/src/002-running.md").includes("Calls keep ECMA-262's `EvaluateCall` and `ArgumentListEvaluation`, and lowering adds no observable helper lookup, temporary name ([source names](001-functions.md#source-names)) or change to `this` and `super()` order."))
  const witness = read("typescript/vibelang/cases/do-method-bind-shadow/main.vibe")
  assert.ok(witness.includes("Object.defineProperty(receiver.f, \"bind\""))
  assert.ok(witness.includes("\"wrong-bind\""))
})
