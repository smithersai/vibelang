import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { test } from "node:test"
import { typedProgram } from "../../eslint.mjs"
const typescript = dirname(dirname(createRequire(import.meta.url).resolve("typescript")))
function fixture(t, configs) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-config-lint-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(typescript, join(root, "node_modules/typescript"))
  for (const [name, source] of Object.entries(configs)) {
    writeFileSync(join(root, name), JSON.stringify({ compilerOptions: { strict: true, noLib: true }, files: [source] }))
    writeFileSync(join(root, source), "export const value: number = 1\n")
  }
  return root
}
for (const name of ["vibe.config.json", "jsconfig.json"]) {
  test(`typedProgram discovers ${name} when no project is specified`, t => {
    const root = fixture(t, { [name]: "selected.ts" })
    const program = typedProgram({ tsconfigRootDir: root })
    assert.deepEqual(program.getRootFileNames(), [join(root, "selected.ts")])
  })
}
test("typedProgram prefers canonical config but honors an explicit project", t => {
  const root = fixture(t, { "vibe.config.json": "canonical.ts", "tsconfig.json": "typescript.ts", "jsconfig.json": "javascript.ts" })
  assert.deepEqual(typedProgram({ tsconfigRootDir: root }).getRootFileNames(), [join(root, "canonical.ts")])
  assert.deepEqual(typedProgram({ tsconfigRootDir: root, project: "jsconfig.json" }).getRootFileNames(), [join(root, "javascript.ts")])
})
