import { read } from "./spec-witness.mjs"
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import * as Module from "node:module"
import { Effect } from "effect"

const failures = readFileSync(process.env.SPEC_FAILURES ?? new URL("../design/src/003-failures.md", import.meta.url), "utf8")
test("generic substitution and erased defaults preserve their synchronous thrown contracts", () => {
  assert.ok(failures.includes("before type-argument substitution"), "classify the declaration before substituting its return type")
  assert.ok(failures.includes("emit it in `@throws`"), "default callback throws must survive declaration output")
  assert.ok(failures.includes("remains even when a caller supplies a safe callback"), "retain the conservative single own bound")
})
test("the documented contract-preserving bridges distinguish actual failures from a safe supplied callback", async () => {
  const block = [...failures.matchAll(/```ts effect\n([\s\S]*?)```/g)]
    .map((m) => m[1]).find((s) => s.includes("const genericContract ="))
  assert.ok(block, "chapter 003 needs the generic and default-callback contrast")
  const source = block.replace('from "effect"', "from " + JSON.stringify(import.meta.resolve("effect")))
    + "\nexport { genericContract, omittedContract, undefinedContract, suppliedContract, constrainedContract }"
  const code = typeof Bun === "undefined"
    ? Module.stripTypeScriptTypes(source, { mode: "strip" })
    : new Bun.Transpiler({ loader: "ts" }).transformSync(source)
  const module = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
  for (const [program, error] of [[module.genericContract, "boom"], [module.omittedContract, "default"], [module.undefinedContract, "default"]]) {
    const exit = Effect.runSyncExit(program)
    assert.equal(exit._tag, "Failure")
    assert.deepEqual(exit.cause.reasons.map((r) => [r._tag, r.error]), [["Fail", error]])
  }
  assert.equal(Effect.runSync(module.suppliedContract), 7)
  assert.equal(Effect.runSync(module.constrainedContract), 2)
})


test("accepted VIP-4 publishes generic classification and conservative default bounds", () => {
  const text = read("docs/design/vips/0004-throw.md")
  assert.match(text, /before type-argument substitution/)
  assert.match(text, /calls retain it even with a supplied safe callback/)
  assert.match(text, /without active synchronous rethrows/)
})
