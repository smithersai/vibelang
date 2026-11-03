import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { wireDeveloperTools } from "../lib/tooling.mjs"
import { addEslintImportParsers, knipConfigText } from "../lib/wire.mjs"

const specsFor = () => ({ vibelang: "0.0.11" })
const fixture = (t, script) => {
  const root = mkdtempSync(join(tmpdir(), "vibex-eslint-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(join(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", JSON.stringify({ scripts: { lint: script } }))
  put("src/View.vibex", "export const View = () => <div/>")
  return root
}
for (const [script, glob] of [
  ["oxlint", "**/*.{vibe,vibex}"],
  ['oxlint "src/**/*.tsx"', "src/**/*.vibex"],
  ['oxlint "src/**/*.{ts,tsx}"', "src/**/*.{vibe,vibex}"],
  ['oxlint "src/**/*.ts"', "src/**/*.vibe"],
  ['oxlint "src/**/*.vibex"', "src/**/*.vibex"],
]) {
  test(`ESLint migration includes the VibeLang twin of ${script}`, t => {
    const root = fixture(t, script)
    wireDeveloperTools({ root, specsFor })
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    assert.ok(pkg.scripts.lint.includes(glob), pkg.scripts.lint)
    const config = readFileSync(join(root, ".vibelang/eslint.config.mjs"), "utf8")
    assert.ok(config.includes('files: ["**/*.{vibe,vibex}"]'), config)
    assert.ok(config.includes('"**/*.d.vibex.ts"'), config)
    assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
  })
}

test("import parser settings and Knip register both extensions", () => {
  const config = 'import i from "eslint-plugin-import"; export default [i.flatConfigs.recommended]'
  const mapped = addEslintImportParsers(config)
  assert.match(mapped, /"vibelang\/eslint": \[".vibe", ".vibex"\]/)
  assert.equal(addEslintImportParsers(mapped), mapped)
  const old = config.replace("export default [", 'export default [{ settings: { "import/parsers": { "vibelang/eslint": [".vibe"] } } },')
  assert.match(addEslintImportParsers(old), /"vibelang\/eslint": \[".vibe", ".vibex"\]/)
  const knip = knipConfigText("{}")
  assert.match(knip, /compilers: \{ vibe: vibelang, vibex: vibelang \}/)
  assert.ok(knip.includes('"**/*.d.vibex.ts"'))
})

test("upgrading an existing parser mapping preserves quoted and trailing-comma arrays", () => {
  for (const extensions of ['[]', '[".vibe",]', "['.vibe', /* keep */]", '[".vibe" /* keep */]']) {
    const config = 'import i from "eslint-plugin-import"; export default [{ settings: { "import/parsers": { "vibelang/eslint": ' + extensions + ' } } }]'
    const mapped = addEslintImportParsers(config)
    const value = Function("return " + mapped.split("export default ")[1])()
    assert.deepEqual(value[0].settings["import/parsers"]["vibelang/eslint"], extensions === "[]" ? [".vibex"] : [".vibe", ".vibex"])
    assert.equal(addEslintImportParsers(mapped), mapped)
  }
})
