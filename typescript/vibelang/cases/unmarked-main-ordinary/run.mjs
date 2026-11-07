// run-seconds: 120
// rule-evidence: docs/design/vips/0026-top-level-and-main.md | A function named `main` is an ordinary function, and you call a runner yourself, exactly as in Effect TS.
import assert from "node:assert/strict"
import { probe } from "../../tests/entry-migration.mjs"
const body = 'import { Console, Effect } from "effect"\nexport effect function main() { try Console.log("main-called") }\n'
const cold = probe(import.meta.url, "ordinary", {
  "program.vibe": body,
  "loader.vibe": 'import "./program.vibe"\n'
})
const compiled = cold.compile()
assert.equal(compiled.status, 0, compiled.output)
const direct = cold.node("build/program.js")
assert.equal(direct.status, 0, direct.output)
assert.equal(direct.stdout, "", "exporting main must not start it")
assert.doesNotMatch(cold.read("build/program.js"), /\$entry/)
const imported = cold.node("build/loader.js")
assert.equal(imported.status, 0, imported.output)
assert.equal(imported.stdout, "", "importing main must not start it")
const explicit = probe(import.meta.url, "explicit", {
  "program.vibe": body + "await Effect.runPromise(main())\n"
})
const checked = explicit.compile()
assert.equal(checked.status, 0, checked.output)
const started = explicit.node("build/program.js")
assert.equal(started.status, 0, started.output)
assert.equal(started.stdout, "main-called\n", "the explicit runner starts main once")
assert.doesNotMatch(explicit.read("build/program.js"), /\$entry/)
console.log("ordinary-main-ok")
