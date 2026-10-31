import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, posix, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-eslint-ignore-patterns.json", import.meta.url)))
const deps = process.env.VIBELANG_LINT_ORACLE_NODE_MODULES
const oracle = { skip: !deps && "set VIBELANG_LINT_ORACLE_NODE_MODULES (eslint, oxlint, espree)" }
function put(root, file, text) {
  mkdirSync(join(root, posix.dirname(file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
async function compare(patterns, stems, { nestedConfig = false, childCwd = false, sourceExtension = ".ts" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "foldkit-ignore-oracle-"))
  try {
    const cwd = childCwd ? join(root, "packages/app") : root
    mkdirSync(cwd, { recursive: true })
    const config = nestedConfig ? "config/lint.json" : ".oxlintrc.json"
    put(root, "package.json", JSON.stringify({ type: "module", scripts: { lint: "oxlint -c " + config } }))
    put(root, config, JSON.stringify({ categories: { correctness: "off" }, rules: { "no-debugger": "error" }, ignorePatterns: patterns }))
    put(root, "node_modules/vibelang/package.json", JSON.stringify({ type: "module", exports: { "./eslint": "./eslint.mjs" } }))
    put(root, "node_modules/vibelang/eslint.mjs", 'import * as espree from "espree"; export default { parse(text) { return espree.parse(text, { ecmaVersion: "latest", sourceType: "module", range: true, loc: true, tokens: true, comment: true }) } }\n')
    for (const pkg of ["eslint", "espree", "@eslint"]) symlinkSync(resolve(deps, pkg), join(root, "node_modules", pkg), "dir")
    for (const stem of stems) for (const extension of [sourceExtension, ".vibe"]) put(cwd, stem + extension, corpus.source)
    const stock = spawnSync(join(deps, ".bin/oxlint"), ["--threads", "8", "--no-error-on-unmatched-pattern", "--ignore-pattern", "node_modules/", "-c", join(root, config), "--format", "json", "."], { cwd, encoding: "utf8" })
    assert.ok(stock.status === 0 || stock.status === 1, stock.stderr)
    const expected = JSON.parse(stock.stdout).diagnostics.map(d => d.filename.replace(/\.(?:ts|mts|tsx)$/, ".vibe")).sort()
    const wired = wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) })
    const { ESLint } = require(join(deps, "eslint"))
    const lintConfig = nestedConfig ? ".vibelang/eslint.config-lint.config.mjs" : ".vibelang/eslint.config.mjs"
    const eslint = new ESLint({ cwd, overrideConfigFile: join(root, lintConfig), errorOnUnmatchedPattern: false })
    const actual = (await eslint.lintFiles(["**/*.vibe"])).flatMap(r => r.messages.filter(m => m.severity === 2).map(m => {
      assert.equal(m.ruleId, "no-debugger", JSON.stringify(m))
      return posix.relative(cwd, r.filePath)
    })).sort()
    assert.deepEqual(actual, expected, JSON.stringify({ patterns, stems, nestedConfig, childCwd, stock: stock.stdout }))
    assert.ok(JSON.parse(readFileSync(join(root, "package.json"))).devDependencies.eslint)
    assert.deepEqual(wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) }).changed, [])
    return { actual, wired }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("the bridge reads original ignore patterns at lint time without editing their policy", async () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-ignore-config-"))
  try {
    const policy = { ignorePatterns: corpus.ignorePatterns, categories: { correctness: "off" } }
    put(root, "package.json", '{"scripts":{"lint":"oxlint"}}')
    put(root, ".oxlintrc.json", JSON.stringify(policy))
    put(root, "node_modules/vibelang/package.json", '{"type":"module","exports":{"./eslint":"./eslint.mjs"}}')
    put(root, "node_modules/vibelang/eslint.mjs", "export default { parseForESLint() {} }")
    wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) })
    const file = join(root, ".vibelang/eslint.config.mjs")
    const ignores = (await import(file)).default[0].ignores
    assert.ok(ignores.includes("**/ignored/**/*"))
    assert.deepEqual(JSON.parse(readFileSync(join(root, ".oxlintrc.json"))), policy)
    put(root, ".oxlintrc.json", JSON.stringify({ ...policy, ignorePatterns: ["**/*.ts", "!visible.ts"] }))
    const refreshed = (await import(file + "?updated")).default[0].ignores
    assert.ok(refreshed.includes("**/*.vibe"))
    assert.ok(refreshed.includes("!**/visible.vibe"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test("foldkit-43: native lint retains Oxlint's ignored directories and visible controls", oracle, async () => {
  const { actual } = await compare(corpus.ignorePatterns, corpus.files)
  assert.deepEqual(actual, ["ignored-sibling/main.vibe", "visible/main.vibe"])
})
test("native ignore translation preserves directory, rooted, extension and negated scopes against Oxlint", oracle, async () => {
  for (const patterns of [
    corpus.emptyPatterns,
    corpus.resetPatterns,
    ["**"],
    ["/**"],
    ["**/"],
    ["/ignored/"],
    ["ignored", "!ignored/keep.ts"],
    ["**/*.{ts,tsx}", "!visible.ts"],
    ["**/*.ts", "!visible/**/*.ts"],
    ["ignored/**", "!ignored/**/keep.ts"],
    ["*.ts", "!visible.ts"],
    ["ignored/", "!ignored/keep.ts"],
    ["src/*.ts", "!src/keep.ts"],
    ["literal{a,b}/"],
    ["name(with)/"],
    ["**/*.ts", "!visible/**/*.ts", "visible/again.ts"]
  ]) for (const options of [{}, { nestedConfig: true }, { childCwd: true }]) {
    await compare(patterns, ["ignored/a", "nested/ignored/a", "ignored/deep/keep", "ignored/keep", "visible", "visible/a", "visible/again", "src/a", "src/keep", "src/deep/a", "literal{a,b}/a", "literala/a", "name(with)/a", "outside/a"], options)
  }
})
test("generated native lint scopes agree with the original linter over varied ignore graphs", oracle, async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("ignored", "with space", "café", "a.b", "prefix-long"),
    fc.constantFrom("directory", "rooted", "extension", "negation", "all"),
    fc.boolean(), fc.boolean(), fc.constantFrom(...corpus.sourceExtensions), fc.constantFrom("**", "/**", "**/"),
    async (dir, kind, nestedConfig, childCwd, sourceExtension, wildcard) => {
      const patterns = kind === "all" ? [wildcard] : kind === "directory" ? [dir + "/"] :
        kind === "rooted" ? ["/" + dir + "/"] :
        kind === "extension" ? [dir + "/**/*" + sourceExtension] :
        [dir + "/**", "!" + dir + "/**/keep" + sourceExtension]
      await compare(patterns, [dir + "/a", dir + "/keep", dir + "/deep/a", dir + "/deep/keep", "nested/" + dir + "/a", dir + "-visible/a", "visible/a"], { nestedConfig, childCwd, sourceExtension })
    }), { seed: 430043, numRuns: 80 })
})
