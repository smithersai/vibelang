import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-oxlint-type-aware-bridge.json", import.meta.url), "utf8"))
const quote = "with the repository's JS plugins, rule names, severities and override globs."

async function check({ name, level, override }) {
  const root = mkdtempSync(join(tmpdir(), "migrate-oxlint-type-aware-"))
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), typeof text === "string" ? text : JSON.stringify(text))
  }
  try {
    put("package.json", { type: "module", scripts: { lint: "oxlint" } })
    const rules = { [name]: level, "typescript/no-explicit-any": "warn", "house/no-foo": "error" }
    put(".oxlintrc.json", { categories: { correctness: "off" }, jsPlugins: [{ name: "house", specifier: "./house.mjs" }], rules,
      overrides: override ? [{ files: ["src/**/*.ts"], rules: { [name]: level } }] : [] })
    put("house.mjs", 'export default { rules: { "no-foo": { meta: { schema: [] }, create: () => ({}) } } }')
    put("node_modules/vibelang/package.json", { name: "vibelang", type: "module", exports: { "./eslint": "./eslint.mjs" } })
    put("node_modules/vibelang/eslint.mjs", "export default { parseForESLint() {} }")
    put("node_modules/typescript-eslint/package.json", { name: "typescript-eslint", type: "module", exports: "./index.mjs" })
    put("node_modules/typescript-eslint/index.mjs", `export default {
      configs: { recommended: [] },
      plugin: { rules: {
        "await-thenable": { meta: { docs: { requiresTypeChecking: true } }, create() { throw new Error("parser services required") } },
        "no-explicit-any": { meta: { docs: {} }, create: () => ({}) }
      } }
    }`)
    wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) })
    const bridge = await import(pathToFileURL(join(root, ".vibelang/eslint.config.mjs")).href)
    const configs = await bridge.configFor(undefined, true)
    const carried = Object.assign({}, ...configs.map(config => config.rules ?? {}))
    assert.equal(carried["@typescript-eslint/await-thenable"], undefined, "a syntax-only parser cannot run a type-aware rule")
    assert.deepEqual(carried["@typescript-eslint/no-explicit-any"], ["warn"])
    assert.deepEqual(carried["house/no-foo"], ["error"])
    const written = bridge.writtenConfigs.get(null).written
    assert.equal(written.rules[name], level, "the native projection retains the configured type-aware rule")
    if (override) assert.equal(written.overrides[0].rules[name], level)
    assert.deepEqual(wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) }).changed, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("Foldkit lint bridge keeps type-aware rules on the native pass beside repository JS rules", async () => {
  await check(corpus)
})

test("property: rule aliases, severities and overrides preserve the native type-aware rule and syntax plugin rules", async () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  await fc.assert(fc.asyncProperty(fc.record({
    name: fc.constantFrom("typescript/await-thenable", "@typescript-eslint/await-thenable", "await-thenable"),
    level: fc.constantFrom("off", "warn", "error", 0, 1, 2),
    override: fc.boolean()
  }), check), { seed: 255033, numRuns: 64 })
})
