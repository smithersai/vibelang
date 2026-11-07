// run-seconds: 120
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | CommonJS does not justify retaining the retired dispatcher; ESM cannot introduce `import.meta.main`.
import assert from "node:assert/strict"
import { codes, marked, probe } from "../../tests/entry-migration.mjs"

const source = 'import "vibelang/platform/node"\n\nexport effect function main() {\n  try Console.log("main ran")\n}\n'

// ESM: a migrated entry test is admitted source other than import.meta.main.
const esm = probe(import.meta.url, "esm", { "main.vibe": source })
const esmFix = esm.compile("--fix")
assert.equal(esmFix.status, 0, esmFix.output)
const esmText = esm.read("main.vibe")
assert.ok(!marked(esmText), esmText)
assert.doesNotMatch(esmText, /import\.meta\.main/, esmText)
assert.deepEqual(codes(esm.compile().output), [])
assert.doesNotMatch(esm.read("build/main.js"), /\$entry/)
assert.equal(esm.node("build/main.js").stdout, "main ran\n")

// CommonJS: the fix either writes an explicit runner or refuses and keeps the
// marker, which stays an error; it never keeps the retired dispatcher.
const cjs = probe(import.meta.url, "cjs", { "main.vibe": source }, { type: "commonjs" })
const cjsFix = cjs.compile("--fix")
const cjsText = cjs.read("main.vibe")
const cjsAfter = cjs.compile()
if (marked(cjsText)) {
  assert.notEqual(cjsFix.status, 0, `a refusal exits nonzero\n${cjsFix.output}`)
  assert.match(cjsFix.output, /main\.vibe/, `a refusal names its file\n${cjsFix.output}`)
  assert.ok(codes(cjsAfter.output).includes("EK2601"), `a kept marker is an error\n${cjsAfter.output}`)
} else {
  assert.equal(cjsFix.status, 0, cjsFix.output)
  assert.deepEqual(codes(cjsAfter.output), [], cjsAfter.output)
  assert.doesNotMatch(cjs.read("build/main.js"), /\$entry/)
  assert.equal(cjs.node("build/main.js").stdout, "main ran\n")
}

console.log("entry-migration-ok")
