import { read } from "./spec-witness.mjs"
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import * as Module from "node:module"
import { Effect } from "effect"

const failures = readFileSync(process.env.SPEC_FAILURES ?? new URL("../design/src/003-failures.md", import.meta.url), "utf8")
test("plain error payload keys are erased while schema field keys run at declaration", async () => {
  assert.ok(failures.includes("type-only payload members"), "distinguish payload type keys from schema object keys")
  const block = [...failures.matchAll(/```ts effect\n([\s\S]*?)```/g)]
    .map((m) => m[1]).find((s) => s.includes("const erasedPayloadKey ="))
  assert.ok(block, "chapter 003 needs a computed-key erasure and schema evaluation contrast")
  const source = block.replace('from "effect"', "from " + JSON.stringify(import.meta.resolve("effect")))
    + "\nexport { erasedPayloadKey, evaluatedSchemaKey }"
  const code = typeof Bun === "undefined"
    ? Module.stripTypeScriptTypes(source, { mode: "strip" })
    : new Bun.Transpiler({ loader: "ts" }).transformSync(source)
  const module = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
  assert.equal(Effect.runSync(module.erasedPayloadKey), 7)
  assert.deepEqual(Effect.runSync(module.evaluatedSchemaKey), [1, 7])
})


test("VIP-13 publishes type-key erasure separately from runtime field keys", () => {
  const text = process.env.SPEC_VIP13 ? readFileSync(process.env.SPEC_VIP13, "utf8") : read("docs/design/vips/0013-error-declarations.md")
  assert.match(text, /no runtime lookup, evaluation or TDZ read/)
  assert.match(text, /methods\/getters retain TypeScript/)
})
