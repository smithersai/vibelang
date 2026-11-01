import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { preloadRegister, wireOxlintPlugins } from "../lib/oxlint-plugins.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-oxlint-jsplugin-loader.json", import.meta.url), "utf8"))
const register = "--import=vibelang/register"

function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-oxlint-plugins-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, posix.dirname(file)), { recursive: true })
    writeFileSync(join(root, file), typeof text === "string" ? text : JSON.stringify(text, null, 2) + "\n")
  }
  return root
}
const scripts = (root, file) => JSON.parse(readFileSync(join(root, file), "utf8")).scripts

// t3code (drive-t3code 01:58Z, 02:50Z): .oxlintrc.json names
// oxlint-plugin-t3code in jsPlugins; once its 16 modules were .vibe, `vp lint`
// failed with ERR_UNKNOWN_FILE_EXTENSION ".vibe" until NODE_OPTIONS loaded
// vibelang/register, and the plugin's RuleTester suites passed 379/379 with it.
test("corpus: t3code's lint and its plugin's tests load vibelang/register once the plugin is migrated", (t) => {
  const root = repo(t, corpus.files)
  assert.deepEqual(wireOxlintPlugins({ root, migrated: corpus.migrated, ts }).sort(), Object.keys(corpus.after).sort())
  for (const [file, expected] of Object.entries(corpus.after)) assert.deepEqual(scripts(root, file), expected, file)
  assert.deepEqual(wireOxlintPlugins({ root, migrated: corpus.migrated, ts }), [], "a second setup changes nothing")
})

test("a plugin package the migration does not move keeps every script as written", (t) => {
  const root = repo(t, corpus.files)
  assert.deepEqual(wireOxlintPlugins({ root, migrated: ["packages/other"], ts }), [])
  assert.deepEqual(scripts(root, "package.json"), corpus.files["package.json"].scripts)
})

test("preloadRegister adds to a NODE_OPTIONS the command sets, keeps one that loads it, and touches only the commands it names", () => {
  const oxlint = (words) => words[0] === "oxlint"
  assert.equal(preloadRegister("oxlint . && eslint .", oxlint), `NODE_OPTIONS="\${NODE_OPTIONS:+$NODE_OPTIONS }${register}" oxlint . && eslint .`)
  assert.equal(preloadRegister("NODE_OPTIONS=--max-old-space-size=4096 oxlint .", oxlint), `NODE_OPTIONS="--max-old-space-size=4096 ${register}" oxlint .`)
  assert.equal(preloadRegister(`(NODE_OPTIONS=${register} oxlint .) && eslint .`, oxlint), `(NODE_OPTIONS=${register} oxlint .) && eslint .`)
  assert.equal(preloadRegister("eslint . | tee lint.log", oxlint), "eslint . | tee lint.log")
})

test("property: each Oxlint command loads vibelang/register once, every other command stays, and a second pass changes nothing", () => {
  const command = fc.constantFrom("oxlint .", "vp lint --fix", "eslint .", "tsc -b", "vp test run", "NODE_OPTIONS=--trace-warnings oxlint src", "(vp lint)")
  fc.assert(fc.property(fc.array(command, { minLength: 1, maxLength: 4 }), fc.constantFrom(" && ", " ; ", " || "), (parts, joiner) => {
    const script = parts.join(joiner)
    const runs = (words) => words[0] === "oxlint" || (words[0] === "vp" && words[1] === "lint")
    const once = preloadRegister(script, runs)
    assert.equal(preloadRegister(once, runs), once)
    const out = once.split(joiner)
    parts.forEach((part, i) => {
      const lints = /(^|\s|\()oxlint\b|vp lint/.test(part)
      if (lints) assert.equal(out[i].split("vibelang/register").length - 1, 1, out[i])
      else assert.equal(out[i], part)
    })
  }), { numRuns: 300 })
})
