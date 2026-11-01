import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const deps = process.env.VIBELANG_UNUSED_ORACLE_NODE_MODULES
const eslintDeps = resolve(new URL("../../../../packages/compiler/test/eslint/node_modules", import.meta.url).pathname)
const oracle = { skip: !deps && "set VIBELANG_UNUSED_ORACLE_NODE_MODULES (oxlint)" }
const corpus = readFileSync(new URL("./corpus/foldkit-machine-declare-brand.ts", import.meta.url), "utf8")

function put(root, file, text) {
  mkdirSync(join(root, file, ".."), { recursive: true })
  writeFileSync(join(root, file), text)
}
async function compare(code, options = {}, explicit = true) {
  const root = mkdtempSync(join(tmpdir(), "foldkit-unused-"))
  try {
    put(root, "package.json", JSON.stringify({ type: "module", scripts: { lint: "oxlint" } }))
    put(root, ".oxlintrc.json", JSON.stringify(explicit
      ? { categories: { correctness: "off" }, rules: { "no-unused-vars": ["error", options] } }
      : {}))
    mkdirSync(join(root, "node_modules"), { recursive: true })
    for (const name of ["eslint", "typescript-eslint"]) symlinkSync(join(eslintDeps, name), join(root, "node_modules", name), "dir")
    symlinkSync(resolve(new URL("../../../../packages/compiler", import.meta.url).pathname), join(root, "node_modules/vibelang"), "dir")
    put(root, "machine.ts", code)
    put(root, "machine.vibe", code)
    const stock = spawnSync(join(deps, ".bin/oxlint"), ["--threads", "8", "--disable-nested-config", "-c", ".oxlintrc.json", "--format", "json", "machine.ts"], { cwd: root, encoding: "utf8" })
    assert.ok(stock.status === 0 || stock.status === 1, stock.stderr + stock.stdout)
    const expected = JSON.parse(stock.stdout).diagnostics.filter(d => d.code?.includes("no-unused-vars")).map(d => d.labels[0].label.match(/'([^']+)'/)[1]).sort()
    wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) })
    const { ESLint } = require(join(eslintDeps, "eslint"))
    const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, ".vibelang/eslint.config.mjs") })
    const [result] = await eslint.lintFiles(["machine.vibe"])
    assert.deepEqual(result.messages.filter(m => m.fatal), [])
    const actual = result.messages.filter(m => m.ruleId?.endsWith("/no-unused-vars") || m.ruleId === "no-unused-vars").map(m => m.message.match(/^'([^']+)'/)[1]).sort()
    assert.deepEqual(actual, expected, JSON.stringify({ code, options, messages: result.messages, stock: stock.stdout }))
    return actual
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("foldkit-96: the generated bridge accepts the machine's typeof brand as Oxlint does", oracle, async () => {
  assert.deepEqual(await compare(corpus), [])
  assert.deepEqual(await compare(corpus, {}, false), [])
})
test("Oxlint and the bridge agree on type-query reads, unused controls and configured patterns", oracle, async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("Brand", "Café", "機械", "_Brand"),
    fc.constantFrom("declare const", "declare let", "const"),
    fc.constantFrom("type", "value", "none"),
    fc.boolean(),
    async (name, declaration, read, ignore) => {
      const value = declaration === "const" ? " = Symbol()" : ": unique symbol"
      const use = read === "type" ? "export type Machine = { readonly id: typeof " + name + " }" :
        read === "value" ? "export const machine = " + name : "export const machine = 1"
      const code = declaration + " " + name + value + "\n" + use + "\nconst UnusedControl = 0\n"
      await compare(code, ignore ? { varsIgnorePattern: "^_" } : {})
    }
  ), { seed: 9601, numRuns: 60 })
})
