import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import test from "node:test"

const ts = createRequire(new URL("../docs/tools/package.json", import.meta.url))("typescript")

test("the emitted runtime entry parses as a native ES module", () => {
  const source = readFileSync(new URL("../packages/runtime/src/entry.ts", import.meta.url), "utf8")
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  })
  // Parse the actual emitted entry without resolving its imports. This catches
  // duplicate exported bindings even when transpilation itself succeeds.
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: outputText, encoding: "utf8",
  })
  assert.equal(result.status, 0, result.stderr)
})
