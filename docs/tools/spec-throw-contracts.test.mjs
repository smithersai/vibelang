import { read } from "./spec-witness.mjs"
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import fc from "fast-check"
import * as Module from "node:module"
import { Effect } from "effect"

const failures = readFileSync(process.env.SPEC_FAILURES ?? new URL("../design/src/003-failures.md", import.meta.url), "utf8")
// VIP-4, amended 2026-10-31: @rethrows defaults exist only in .ts and JavaScript declarations, whose written
// @throws states the bound; VibeLang reads no bodies, so it infers no default-callback contract.
test("default-callback bounds come from written foreign tags, never a .vibe body", () => {
  assert.ok(failures.includes("Nothing is inferred from a body."), "a .vibe callable has no inferred contract")
  assert.ok(!failures.includes("emit it in `@throws`"), "no .vibe default-callback inference remains")
})
test("the retained native generic bridge fails with the contract's throw and the constrained Effect succeeds", async () => {
  const block = read("docs/tools/fixtures/generic-contracts.ts")
  const source = block.replace('from "effect"', "from " + JSON.stringify(import.meta.resolve("effect")))
    + "\nexport { genericContract, constrainedContract, omittedContract, undefinedContract, suppliedContract }"
  const code = typeof Bun === "undefined"
    ? Module.stripTypeScriptTypes(source, { mode: "strip" })
    : new Bun.Transpiler({ loader: "ts" }).transformSync(source)
  const module = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
  for (const [program, error] of [[module.genericContract, "boom"], [module.omittedContract, "default"], [module.undefinedContract, "default"]]) {
    const exit = Effect.runSyncExit(program)
    assert.equal(exit._tag, "Failure")
    assert.deepEqual(exit.cause.reasons.map((r) => [r._tag, r.error]), [["Fail", error]])
  }
  assert.equal(Effect.runSync(module.constrainedContract), 2)
  assert.equal(Effect.runSync(module.suppliedContract), 7)
})


test("accepted VIP-4 publishes generic classification and conservative default bounds", () => {
  const text = read("docs/design/vips/0004-throw.md")
  assert.match(text, /before type-argument substitution/)
  assert.ok(text.includes("`@throws {T}` means it throws `T`, and no `@throws` means it throws `unknown`"))
  assert.ok(failures.includes("its own thrown type, plus the thrown type of the callback passed for `p`; `@throws {never}` does not erase it"))
})

test("fast-check: foreign generic and default-callback witnesses preserve explicit failure values", () => {
  fc.assert(fc.property(fc.string(), fc.integer(), (reason, value) => {
    const keep = input => { throw reason }
    const invoke = (callback = () => { throw reason }) => callback()
    for (const call of [() => keep(Effect.succeed(value)), () => invoke(), () => invoke(undefined)]) {
      const exit = Effect.runSyncExit(Effect.try({ try: call, catch: error => error }))
      assert.equal(exit._tag, "Failure")
      assert.deepEqual(exit.cause.reasons.map(r => [r._tag, r.error]), [["Fail", reason]])
    }
    assert.equal(Effect.runSync(Effect.try({ try: () => invoke(() => value), catch: error => error })), value)
    const passEffect = input => input
    assert.equal(Effect.runSync(passEffect(Effect.succeed(value))), value)
  }), { seed: 40016, numRuns: 150 })
})
