import assert from "node:assert/strict"
import { test } from "node:test"
import { read } from "./spec-witness.mjs"

// 002 simplification changes wording, not behavior. The w01-002 compiler cases
// cite each sentence exactly and run it; these tests keep the rules and the
// original behavioral witnesses in place.

test("002 cut 1 retains its rule and existing catch-expression witness", () => {
  assert.ok(read("docs/design/src/002-running.md").includes("On a failure in its error channel it calls `h` with the error."))
  const witness = read("typescript/vibelang/cases/catch-expression/main.vibe")
  assert.ok(witness.includes("catch () => \"guest\""))
  assert.ok(witness.includes("orGuest(\"missing\")"))
})

test("002 cut 2 retains its rule and existing do-jump-operand-order witness", () => {
  assert.ok(read("docs/design/src/002-running.md").includes("<a id=\"evaluation-order\"></a>**Evaluation order.** A `do` or `match` runs where ECMAScript evaluates the expression that holds it, never earlier or more often."))
  const witness = read("typescript/vibelang/cases/do-jump-operand-order/main.vibe")
  assert.ok(witness.includes("inCall"))
  assert.ok(witness.includes("inObject"))
  assert.ok(witness.includes("inArray"))
})

test("002 cut 3 retains its rule and existing do-jump-operand-order witness", () => {
  assert.ok(read("docs/design/src/002-running.md").includes("Everything to its left runs first, in source order, fully evaluated as ECMA-262 specifies (callee and receiver read, spreads iterated, computed object-literal keys converted, earlier template substitutions stringified), so `o.m(try a(), match (x) { … })` reads `o.m`, runs `a()`, runs the `match`, and calls the method with `this` as `o`."))
  const witness = read("typescript/vibelang/cases/do-jump-operand-order/main.vibe")
  assert.ok(witness.includes("callee()(rec(\"a\""))
  assert.ok(witness.includes("rec(\"a\""))
})

test("002 cut 4 retains its rule and existing do-method-bind-shadow witness", () => {
  assert.ok(read("docs/design/src/002-running.md").includes("Calls keep ECMA-262's `EvaluateCall` and `ArgumentListEvaluation`, and lowering adds no observable helper lookup, temporary name ([source names](001-functions.md#source-names)) or change to `this` and `super()` order."))
  const witness = read("typescript/vibelang/cases/do-method-bind-shadow/main.vibe")
  assert.ok(witness.includes("Object.defineProperty(receiver.f, \"bind\""))
  assert.ok(witness.includes("\"wrong-bind\""))
})
