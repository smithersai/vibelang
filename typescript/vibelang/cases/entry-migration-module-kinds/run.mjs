// run-seconds: 120
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | CommonJS does not justify retaining the retired dispatcher; ESM cannot introduce `import.meta.main`.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Preserve entry-only execution and import-only behavior.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Refuse an unavailable runner or layer, an entry test not expressible in admitted source, or any other loss of types, behavior or declarations: keep the marker and report its file, line and reason as not fixed, with a nonzero exit.
// Why both module kinds refuse: the legacy compiler started main only when
// the host started the module. ESM cannot use import.meta.main, CommonJS
// source cannot name require.main, and no other admitted source tests which
// module the host started, so a runner written here would start main on
// import too. --fix keeps the marker, which stays an error, and the compiler
// keeps no dispatcher: importing or starting the module starts nothing.
import assert from "node:assert/strict"
import { codes, importer, marked, probe } from "../../tests/entry-migration.mjs"

const source = 'import "vibelang/platform/node"\n\nexport effect function main() {\n  try Console.log("main ran")\n}\n'

for (const [name, type] of [["esm", "module"], ["cjs", "commonjs"]]) {
  const p = probe(import.meta.url, name, { "main.vibe": source }, { type })
  const after = p.compile()
  assert.deepEqual(codes(after.output), ["EK2601"], `${name}: a kept marker is an error\n${after.output}`)
  const js = p.read("build/main.js")
  assert.doesNotMatch(js, /\$entry|\$runMain|import\.meta\.main/, `${name}: the retired dispatcher remains:\n${js}`)
  assert.equal(p.node("build/main.js").stdout, "", `${name}: starting the module starts nothing implicitly`)
  p.write("importer.mjs", importer("./build/main.js"))
  const imported = p.node("importer.mjs")
  assert.equal(imported.status, 0, imported.output)
  assert.equal(imported.stdout, "", `${name}: importing the module starts nothing`)
}

console.log("entry-migration-ok")
