// run-seconds: 120
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | A remaining marker keeps `EK2601`; `main` alone is ordinary source, gets no entry diagnostic and causes no implicit startup ([VIP-26](../vips/0026-top-level-and-main.md#decision), [VIP-34](../vips/0034-compiler-and-tooling.md#decision)).
import assert from "node:assert/strict"
import { codes, marked, probe } from "../../tests/entry-migration.mjs"

// The browser runner is not installed here, so the fix refuses: it keeps the
// marker, reports its file and line, exits nonzero, and EK2601 remains.
const refused = probe(import.meta.url, "refused", {
  "main.vibe": 'import "vibelang/platform/browser"\n\nexport effect function main() {\n  try Console.log("browser main ran")\n}\n',
})
const fix = refused.compile("--fix")
assert.notEqual(fix.status, 0, fix.output)
assert.match(fix.output, /main\.vibe\D*1\b/, `the refusal names the marker's file and line\n${fix.output}`)
assert.ok(marked(refused.read("main.vibe")))
assert.deepEqual(codes(refused.compile().output), ["EK2601"])

// main without a marker is an ordinary export: no diagnostic, no startup.
const alone = probe(import.meta.url, "alone", {
  "main.vibe": 'export effect function main() {\n  try Console.log("implicit startup")\n}\n\nexport function helper() {\n  return 1\n}\n',
})
const check = alone.compile()
assert.equal(check.status, 0, check.output)
assert.equal(check.output.trim(), "", check.output)
assert.equal(alone.node("build/main.js").stdout, "", "main alone started")

console.log("entry-migration-ok")
