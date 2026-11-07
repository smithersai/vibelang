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
import { codes, importer, marked, probe, refusal } from "../../tests/entry-migration.mjs"

const source = 'import "vibelang/platform/node"\n\nexport effect function main() {\n  try Console.log("main ran")\n}\n'

for (const [name, type] of [["esm", "module"], ["cjs", "commonjs"]]) {
  const p = probe(import.meta.url, name, { "main.vibe": source }, { type })
  const fix = p.compile("--fix")
  assert.notEqual(fix.status, 0, `${name}: a refusal exits nonzero\n${fix.output}`)
  const text = p.read("main.vibe")
  assert.equal(text, source, `${name}: a refused startup keeps its source`)
  assert.ok(marked(text))
  const advice = refusal(fix.output, "main.vibe", 1)
  assert.ok(advice, `${name}: the refusal names its file and the marker's line\n${fix.output}`)
  assert.doesNotMatch(advice.line, /import\.meta\.main|require\.main|\$entry/, advice.line)
  assert.equal(advice.runner, "NodeRuntime.runMain(main())", advice.line)
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
