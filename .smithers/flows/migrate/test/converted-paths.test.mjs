import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { checkConvertedPaths, convertedModules, REFUSAL } from "../lib/converted-paths.mjs"
import { packageContext } from "../lib/converted-paths.mjs"
import { rewriteSourceLiterals } from "../lib/source-paths.mjs"
import { applyState, prepareState, saveState } from "../lib/codemod-state.mjs"
import * as Jj from "../lib/jj.mjs"
import { codemod, importers, makeConfig, paths, revert, verify } from "../lib/steps.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"
import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-path-references.json", import.meta.url)))

// One package with a converted Local module, another package, a live sibling and a .tsx twin.
const tree = {
  "package.json": '{"name":"root","private":true}',
  "packages/a/package.json": '{"name":"@acme/a"}',
  "packages/b/package.json": '{"name":"@acme/b"}',
  "packages/a/src/Local.vibe": "export const x = 1\n",
  "packages/a/src/View.vibe": "export const v = 1\n",
  "packages/a/src/View.tsx": "export const t = 1\n",
  "packages/a/src/Live.ts": "export const l = 1\n",
  "packages/b/src/Remote.vibe": "export const r = 1\n"
}
const run = (file, text, extra = {}) => {
  const files = { ...tree, ...extra, [file]: text }
  return checkConvertedPaths({ ts, tracked: Object.keys(files), read: path => files[path] })
}
const caller = "packages/a/src/caller.ts"
const local = "packages/a/src/Local.ts"
const renames = [{ from: local, to: "packages/a/src/Local.vibe" }, { from: "packages/a/src/View.ts", to: "packages/a/src/View.vibe" }, { from: "packages/b/src/Remote.ts", to: "packages/b/src/Remote.vibe" }]
const inventory = [...Object.keys(tree), caller, ...renames.map(r => r.from)]
const packages = packageContext(inventory, path => tree[path] ?? "{}")
const rewrite = (text, file = caller) => rewriteSourceLiterals(ts, text, file, renames, { inventory, packages, selectors: false })

// Each shape names the converted module: the codemod rewrites it, or verify refuses it.
const rewritten = {
  "string literal path": ['const p = "./Local.ts"', '"./Local.vibe"'],
  "new URL": ['const u = new URL("./Local.ts", import.meta.url)', '"./Local.vibe"'],
  "import.meta.resolve": ['const u = import.meta.resolve("./Local.ts")', '"./Local.vibe"'],
  "config main": ['export const c = { main: "./Local.ts" }', '"./Local.vibe"'],
  "config entry array": ['export default { entry: ["src/Local.ts"] }', '"src/Local.vibe"'],
  "dynamic import literal": ['const m = () => import("./Local.ts")', '"./Local.vibe"'],
  "worker": ['const w = new Worker(new URL("./Local.ts", import.meta.url))', '"./Local.vibe"'],
  "fork": ['const c = fork("./Local.ts")', '"./Local.vibe"'],
  "another package, relative": ['const p = new URL("../../b/src/Remote.ts", import.meta.url)', '"../../b/src/Remote.vibe"'],
  "another package, by name": ['const p = require.resolve("@acme/b/src/Remote.ts")', '"@acme/b/src/Remote.vibe"'],
  "the package's own root": ['const p = readFileSync("src/Local.ts")', '"src/Local.vibe"'],
  "path.join in the same directory": ['const p = path.join(__dirname, "Local.ts")', '"Local.vibe"']
}
for (const [name, [source, expected]] of Object.entries(rewritten)) test("rewrites a static reference: " + name, () => {
  const result = rewrite(source + "\n")
  assert.ok(result.text.includes(expected), result.text)
  assert.equal(result.edits.length, 1, result.text)
  assert.deepEqual(run(caller, result.text).refusals, [], "the rewritten source passes the check")
  // The same reference left as written fails the check: this is what an older journal holds.
  assert.equal(run(caller, source + "\n").refusals.length, 1, source)
})

test("rewrites the last fragment of a join from another directory", () => {
  const source = 'const p = path.join(__dirname, "..", "src", "Local.ts")\n', file = "packages/a/tools/x.ts"
  const result = rewrite(source, file)
  assert.equal(result.text, 'const p = path.join(__dirname, "..", "src", "Local.vibe")\n')
  assert.deepEqual(run(file, result.text).refusals, [])
  assert.equal(run(file, source).refusals.length, 1)
})

const refused = {
  "extension helper in a template": ["const u = import.meta.resolve(`./Local${moduleExtension(import.meta.url)}`, import.meta.url)", local],
  "extension helper outside a call": ["const n = `./Local${moduleExtension(import.meta.url)}`", local],
  "extension helper in new URL": ["const m = { main: new URL(`./Local${moduleExtension(import.meta.url)}`, import.meta.url).href }", local],
  "a conditional extension": ['const n = new URL("./Local" + (dev ? ".ts" : ".js"), import.meta.url)', local],
  "a built stem with a .ts tail": ["const m = (name) => import(`./${name}.ts`)", local],
  "a local helper's literal argument": ["const load = (n) => import.meta.resolve(`./${n}${moduleExtension(import.meta.url)}`)\nload('Local')", local],
  "a helper reached through a helper, whose parameter shares its name": ["const a = (n) => import.meta.resolve(`./${n}${ext}`)\nconst b = (n) => a(n)\nb('Local')\na('Live')", local],
  "a child process argument": ['spawn("bun", ["packages/a/src/Local.ts"])', local],
  "a child process command line": ['execSync("bun run packages/a/src/Local.ts")', local],
  "a shell template": ["await $`bun packages/a/src/Local.ts ${arg}`", local],
  "another package in a template": ["const u = new URL(`../../b/src/Remote${ext}`, import.meta.url)", "packages/b/src/Remote.ts"],
  "a query suffix": ['const w = new Worker(new URL("./Local.ts?worker", import.meta.url))', local]
}
for (const [name, [source, module]] of Object.entries(refused)) test("refuses a reference it cannot rewrite: " + name, () => {
  const before = rewrite(source + "\n")
  assert.equal(before.text, source + "\n", "the codemod leaves it as written")
  const { refusals, ok } = run(caller, source + "\n")
  assert.equal(ok, false)
  const hit = refusals.find(r => r.module === module)
  assert.ok(hit, JSON.stringify(refusals))
  assert.equal(hit.refusal, REFUSAL)
  assert.equal(hit.file, caller)
  assert.ok(hit.line >= 1)
  assert.match(hit.reason, /revert/)
})

test("a parameter handed to code this file does not show stays unknown", () => {
  const source = "export const load = (n) => import.meta.resolve(`./${n}${ext}`)\n"
  const { refusals } = run(caller, source)
  assert.deepEqual(refusals.map(r => r.module).sort(), [local, "packages/a/src/View.ts"])
})

test("a local helper whose literals name only live modules passes", () => {
  const source = "const load = (n) => import.meta.resolve(`./${n}${ext}`)\nload('Live')\n"
  assert.deepEqual(run(caller, source).refusals, [])
})

test("a module reading its own extension is refused once it is .vibe", () => {
  const file = "packages/a/src/Probe.vibe"
  const hits = source => run(file, source).refusals.map(r => [r.module, r.kind])
  assert.deepEqual(hits('const a = import.meta.url.endsWith(".ts") ? "../bin.ts" : "./bin.mjs"\n'), [["packages/a/src/Probe.ts", "caller-extension"]])
  assert.deepEqual(hits("const a = moduleExtension(import.meta.url)\n"), [["packages/a/src/Probe.ts", "caller-extension"]])
  // The same line in a module that stays TypeScript is correct.
  assert.deepEqual(run("packages/a/src/Probe.ts", 'const a = import.meta.url.endsWith(".ts")\n').refusals, [])
})

// t3code's witnesses, for the same defect with no file to miss: nothing throws, the branch just flips.
for (const [name, source] of Object.entries({
  "endsWith .ts on the module URL": 'const fromSource = import.meta.url.endsWith(".ts")',
  "endsWith .tsx": 'const a = import.meta.url.endsWith(".tsx")',
  "a regex on the module URL": 'const a = /\\.tsx?$/.test(import.meta.url)',
  "extname of the module path": 'const a = path.extname(import.meta.filename) === ".ts"',
  "a const holding the module URL": 'const self = new URL(import.meta.url).pathname; const a = self.endsWith(".ts")',
  "t3code's bin branch": 'const b = new URL(import.meta.url.endsWith(".mts") ? "./bin.ts" : "./bin.mjs", import.meta.url)'
})) test("refuses a converted module testing its own extension: " + name, () => {
  const file = "packages/a/src/Probe.vibe"
  assert.deepEqual(run(file, source + "\n").refusals.map(r => [r.module, r.kind]), [["packages/a/src/Probe.ts", "caller-extension"]])
  assert.deepEqual(run("packages/a/src/Probe.ts", source + "\n").refusals, [], "a module that stays TypeScript still answers correctly")
})

test("an extension test on a value this file does not show is reported, and one naming .vibe too is not", () => {
  assert.deepEqual(run(caller, 'export const a = (id) => /\\.tsx?$/.test(id)\n').reports.map(r => r.kind), ["extension-test"])
  assert.deepEqual(run(caller, 'export const a = (id) => id.endsWith(".ts")\n').reports.map(r => r.kind), ["extension-test"])
  assert.deepEqual(run(caller, 'export const a = (id) => extname(id) === ".ts"\n').reports.map(r => r.kind), ["extension-test"])
  assert.deepEqual(run(caller, 'export const a = (id) => id.endsWith(".ts") || id.endsWith(".vibe")\n').reports, [])
  assert.deepEqual(run(caller, 'export const a = (id) => /\\.(?:tsx?|vibe)$/.test(id)\n').reports, [])
})

// A selector that matched x.ts and does not match x.vibe drops the module with no error.
const config = "packages/a/vite.config.ts"
for (const [name, source] of Object.entries({
  "a transform filter": 'export default { plugins: [{ transform(code, id) { if (!/\\.tsx?$/.test(id)) return; return code } }] }',
  "a filter with endsWith": 'export default { plugins: [{ transform(code, id) { if (!id.endsWith(".ts")) return; return code } }] }',
  "a test regex": "export default { module: { rules: [{ test: /\\.tsx?$/ }] } }",
  "an include array": 'export default { include: ["src/**/*.ts"] }',
  "an exclude array": 'export default { exclude: ["src/**/*.ts"] }',
  "a brace glob": 'export default { input: ["src/**/*.{js,jsx,ts,tsx}"] }',
  "a glob call": 'export const files = glob("src/**/*.ts")',
  "a regex include": "export default { include: [/\\.ts$/] }"
})) test("refuses a selector that drops converted modules: " + name, () => {
  const { refusals } = run(config, source + "\n")
  assert.deepEqual(refusals.map(r => [r.kind, r.file, r.line]), [["selector", config, 1]])
  assert.ok(refusals[0].modules.includes(local), JSON.stringify(refusals))
  assert.equal(refusals[0].moduleCount, refusals[0].modules.length)
})

for (const [name, source] of Object.entries({
  "a selector naming .vibe too": 'export default { include: ["src/**/*.ts", "src/**/*.vibe"] }',
  "a regex that widened": "export default { test: /(?<!\\.d\\.vibe)\\.(?:tsx?|vibe)$/ }",
  "a directory glob": 'export default { include: ["src/**/*"] }',
  "a glob for a fixed file name": 'export default { include: ["apps/*/PACKAGE.ts"] }',
  "a glob for another package": 'export default { include: ["../b/lib/**/*.ts"] }',
  "a negated glob": 'export default { input: ["src/*.worker.ts", "!src/**/*.ts"] }',
  "both spellings of one file": 'export default { include: ["src/**/*", "src/Local.ts", "src/Local.vibe"] }',
  "a filter for JavaScript": "export default { test: /\\.jsx?$/ }"
})) test("control leaves a selector alone: " + name, () => {
  assert.deepEqual(run(config, source + "\n").refusals, [])
})

test("a lint configuration's glob stays as written", () => {
  assert.deepEqual(run("packages/a/eslint.config.ts", 'export default [{ files: ["src/**/*.ts"], include: ["src/**/*.ts"] }]\n').refusals, [])
})

// Smithers' sweep: repository-rooted labels, a data table, a manifest's sideEffects.
test("a build label from any file names the module by the repository root", () => {
  const source = 'export const a = S.file("//packages/a/src/Local.ts")\n', file = "apps/site/PACKAGE.ts"
  const result = rewrite(source, file)
  assert.equal(result.text, 'export const a = S.file("//packages/a/src/Local.vibe")\n')
  assert.deepEqual(run(file, result.text).refusals, [])
  assert.deepEqual(run(file, source).refusals.map(r => r.module), [local])
})

test("a repository-rooted entry in a data table is rewritten, and a manifest's sideEffects is refused", () => {
  const table = 'export const t = [{ name: "@acme/a", entry: "packages/a/src/Local.ts" }]\n', file = "scripts/table.mjs"
  assert.ok(rewrite(table, file).text.includes('"packages/a/src/Local.vibe"'))
  assert.deepEqual(run(file, table).refusals.map(r => r.module), [local])
  const manifest = '{"name":"@acme/a","sideEffects":["./src/Local.ts","./dist/esm/Local.js"]}'
  assert.deepEqual(run("packages/a/package.json", manifest).refusals.map(r => [r.module, r.line]), [[local, 1]])
  // Exports and imports belong to the codemod's manifest pass; a data file's path field is data.
  assert.deepEqual(run("packages/a/package.json", '{"name":"@acme/a","exports":{".":"./dist/index.js"},"bun":"./src/Local.ts"}').refusals, [])
  assert.deepEqual(run("docs/queue.json", '{"path":"packages/a/src/Local.ts"}').refusals, [])
})

test("a regex naming a converted path is refused: t3code's CI list", () => {
  const source = 'const RUNS_EVERYTHING = [/^packages\\/a\\/src\\/(Local|testing\\/temp)\\.ts$/, /^apps\\/mobile\\//]\n'
  assert.deepEqual(run(".github/scripts/ci.cjs", source).refusals.map(r => [r.kind, r.module, r.line]), [["selector", local, 1]])
  const live = 'const a = [/^packages\\/a\\/src\\/Live\\.ts$/, /[ xX]/.test(x), /^src\\/[^.]+$/]\n'
  assert.deepEqual(run(".github/scripts/ci.cjs", live).refusals, [])
  assert.deepEqual(run(".github/scripts/ci.cjs", live).reports, [])
})

test("code that already handles both spellings passes: foldkit", () => {
  // scripts/build-examples.test.mjs picks whichever file exists.
  const pick = "const root = join(import.meta.dirname, '..')\nconst ext = existsSync(join(root, 'scripts/t.vibe')) ? 'vibe' : 'ts'\nreadFileSync(join(root, 'scripts/t.' + ext))\n"
  assert.deepEqual(run("scripts/a.mjs", pick, { "scripts/t.vibe": "export {}\n" }).refusals, [])
  // packages/website/scripts/playgroundFilesPlugin: a fragment compared with relative paths of another tree.
  const fragment = "const SERVER_ENTRY_PATH = paths.join('src', 'Local.ts')\n"
  const result = run("packages/a/scripts/plugin.ts", fragment)
  assert.deepEqual(result.refusals, [])
  assert.deepEqual(result.reports.map(r => r.kind), ["unanchored-path"])
  // deploy-website.yml's path filter lists both.
  const yml = "paths:\n  - 'packages/a/src/Local.ts'\n  - 'packages/a/src/Local.vibe'\n"
  assert.deepEqual(run(".github/workflows/d.yml", yml).refusals, [])
})

test("a list naming both spellings keeps both", () => {
  const source = 'export const a = ["src/Local.ts", "src/Local.vibe"]\n'
  assert.equal(rewrite(source).text, source)
  assert.deepEqual(run(caller, source).refusals, [])
})

test("a child process argument from another directory is reported, not guessed", () => {
  // foldkit's check-host-parity: spawn("node", ["scripts/serve.ts"], { cwd: "examples/ssr" }).
  const tree2 = { "examples/ssr/package.json": "{}", "examples/ssr/scripts/serve.vibe": "export {}\n" }
  for (const source of ['spawn("node", ["scripts/serve.ts"], { cwd })\n', "startHost('node', ['scripts/serve.ts'], PORT)\n"]) {
    const { refusals, reports } = run("scripts/check.ts", source, tree2)
    assert.deepEqual(refusals, [], source)
    assert.deepEqual(reports.map(r => [r.kind, r.modules]), [["unanchored-path", ["examples/ssr/scripts/serve.ts"]]], source)
  }
  // Rooted at the repository, the wrapper's path is the module's: it is refused and left as written.
  const wrapper = "startHost('node', ['packages/a/src/Local.ts'], PORT)\n"
  assert.equal(rewrite(wrapper).text, wrapper)
  assert.deepEqual(run("scripts/check.ts", wrapper).refusals.map(r => [r.kind, r.module]), [["process-entry", local]])
})

const controls = {
  "a comment": '// see ./Local.ts\n/* new URL("./Local.ts", import.meta.url) */\nexport {}',
  "a doc comment link": '/** {@link import("./Local.ts")} */\nexport const z = 1',
  "a remote URL": 'const a = "https://example.com/packages/a/src/Local.ts"; const b = new URL("./Local.ts", "https://cdn.example.com/")',
  "a doc string": 'const d = "See ./Local.ts for details"',
  "a file that was not renamed": 'const p = new URL("./Live.ts", import.meta.url); const q = `./Live${ext}`',
  "a template for a file that was not renamed": "const q = import(`./Live${moduleExtension(import.meta.url)}`)",
  "generated output": 'const a = new URL("../dist/Local.ts", import.meta.url); const b = `../dist/Local${ext}`; const c = new URL("../../lib/Local.js", import.meta.url); const d = import("./gen/Local.ts")',
  "a declaration file": 'const a = new URL("./Local.d.ts", import.meta.url)',
  "an unrelated string ending in .ts": 'const a = "types.ts"; const b = "other/Local.ts"; const c = "report.mts"',
  "a message with a hole": 'const a = `Cannot load ./${name}.ts`; const b = "failed: " + name + ".ts"',
  "the .tsx twin": 'const a = new URL("./View.tsx", import.meta.url); const b = "./View.tsx"',
  "a type": 'type A = "./Local.ts"; const b: "./Local.ts" = "./Local.ts"',
  "an assertion and a test name": 'test("./Local.ts", () => { expect(x).toBe("./Local.ts"); assert.equal(x, "./Local.ts") })',
  "an import and an import type": 'import { a } from "./Local.ts"\nexport * from "./Local.ts"\ntype T = import("./Local.ts").T',
  "a directory built from a hole": "const a = new URL(`./${client}/`, import.meta.url)",
  "an opaque sink": "const a = (p) => import(p); const b = import(specifier)",
  "a regex and a database exec": 'const a = /x/.exec("packages/a/src/Local.ts"); db.exec("packages/a/src/Local.ts x")'.replace('/x/.exec("packages/a/src/Local.ts")', '/x/.exec(line)'),
  "array.join and Promise.resolve": 'const a = parts.join("/"); const b = Promise.resolve("x", "y")'
}
for (const [name, source] of Object.entries(controls)) test("control leaves the source alone: " + name, () => {
  const result = rewrite(source + "\n")
  if (name !== "an import and an import type") assert.equal(result.text, source + "\n", "the codemod does not touch it")
  assert.deepEqual(run(caller, source + "\n").refusals, [])
})

test("a fixture keeps its own tree, and a test keeps its expected strings", () => {
  assert.deepEqual(run("packages/a/fixtures/x/a.ts", 'new URL("../../../src/Local.ts", import.meta.url)\n').refusals, [])
  assert.deepEqual(run("packages/a/test/a.test.ts", 'const expected = "../src/Local.ts"\n').refusals, [])
  assert.equal(run("packages/a/test/a.test.ts", 'new URL("../src/Local.ts", import.meta.url)\n').refusals.length, 1)
})

test("what stays unsure is reported, never passed in silence", () => {
  const reports = source => run(caller, source).reports.map(r => r.kind)
  assert.deepEqual(reports('const a = new URL("./Local.js", import.meta.url)\n'), ["javascript-output"])
  assert.deepEqual(reports("const a = (n) => import(`./${n}`); export { a }\n"), ["open-path"])
  assert.deepEqual(reports("const a = `./${name}.ts`\n"), ["open-path"])
  assert.deepEqual(reports('const a = "Local.ts"\n'), ["bare-name"])
  assert.deepEqual(reports('const a = path.join(root, "src", "Local.ts")\n'), ["unanchored-path"])
  assert.equal(run(caller, "const a = import(specifier)\n").opaque, 1)
})

test("a config outside TypeScript names the module too", () => {
  const files = { "packages/a/wrangler.jsonc": '{ "main": "src/Local.ts" }', "packages/a/run.sh": "# bun src/Local.ts\nbun src/Local.ts\n", ".github/workflows/ci.yml": "steps:\n  - run: bun packages/a/src/Local.ts\n" }
  const { refusals } = checkConvertedPaths({ ts, tracked: [...Object.keys(tree), ...Object.keys(files)], read: path => ({ ...tree, ...files })[path] })
  assert.deepEqual(refusals.map(r => [r.file, r.line]), [[".github/workflows/ci.yml", 2], ["packages/a/run.sh", 2], ["packages/a/wrangler.jsonc", 1]])
})

test("the converted set comes from the tree: a live twin is not converted", () => {
  assert.deepEqual(convertedModules(["a/X.vibe", "a/Y.vibe", "a/Y.ts"]).map(r => r.from), ["a/X.ts", "a/X.mts"])
  assert.deepEqual(checkConvertedPaths({ ts, tracked: ["a.ts"], read: () => 'new URL("./b.ts", import.meta.url)' }).modules, 0)
})

test("alchemy's witnesses at be1fa00d94e1 fail the batch for their modules", () => {
  for (const witness of corpus.witnesses) {
    const files = { "package.json": "{}", [witness.module.replace(/\.ts$/, ".vibe")]: "export const a = 1\n", [witness.file]: witness.source }
    const { refusals } = checkConvertedPaths({ ts, tracked: Object.keys(files), read: path => files[path] })
    assert.deepEqual(refusals.map(r => [r.module, r.file, r.line, r.refusal]), [[witness.module, witness.file, witness.line, REFUSAL]], witness.file)
  }
})

test("verify fails the batch with a named refusal in its receipt, and passes once the caller stops naming the module", async () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-converted-paths-"))
  const target = join(root, "repo"), run = join(root, "run")
  try {
    mkdirSync(join(target, "src"), { recursive: true })
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
    writeJson(join(target, "package.json"), { private: true })
    writeJson(join(target, "tsconfig.json"), { include: ["src/**/*.ts", "src/**/*.vibe"] })
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    writeFileSync(join(target, "src/Local.ts"), "export const value = 1\n")
    writeFileSync(join(target, "src/caller.ts"), "export const url = import.meta.resolve(`./Local${moduleExtension(import.meta.url)}`)\n")
    writeFileSync(join(target, "node_modules/.bin/vibelang"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await must("jj commit -m fixture", { cwd: target })
    renameSync(join(target, "src/Local.ts"), join(target, "src/Local.vibe"))
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.plan, { batches: [{ files: ["src/Local.ts"] }] })
    writeJson(p.inventory, { files: [{ path: "src/Local.ts", tokens: 1 }] })
    writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
    writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
    const failed = await verify({ run, batch: "01" })
    assert.equal(failed.ok, false)
    assert.equal(failed.checks.pathReferences, false)
    assert.deepEqual(failed.pathReferences.refusals.map(r => [r.refusal, r.module, r.file, r.line]), [[REFUSAL, "src/Local.ts", "src/caller.ts", 1]])
    assert.deepEqual(JSON.parse(readFileSync(p.verify("01"), "utf8")).pathReferences.refusals.map(r => r.module), ["src/Local.ts"])
    // The module going back to TypeScript clears it: the converted set is read from the tree.
    renameSync(join(target, "src/Local.vibe"), join(target, "src/Local.ts"))
    const back = await verify({ run, batch: "01" })
    assert.equal(back.checks.pathReferences, true)
    assert.deepEqual(back.pathReferences.refusals, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

for (const legacy of [false, true]) test("the codemod rewrites a static path outside the inventory, and revert restores it: legacy=" + legacy, async () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-path-sources-"))
  const target = join(root, "repo"), run = join(root, "run")
  const put = (file, text) => { mkdirSync(dirname(join(target, file)), { recursive: true }); writeFileSync(join(target, file), text) }
  const module = "packages/a/src/Local.ts"
  const outside = {
    "scripts/table.mjs": 'export const t = [{ entry: "packages/a/src/Local.ts" }]\n',
    "apps/site/PACKAGE.ts": 'export const f = S.file("//packages/a/src/Local.ts")\n',
    "packages/a/scripts/build.ts": 'export const f = new URL("../src/Local.ts", import.meta.url)\n'
  }
  const protectedFiles = {
    "packages/a/test/a.test.ts": 'export const f = new URL("../src/Local.ts", import.meta.url)\n',
    "packages/a/fixtures/x/a.ts": 'export const f = new URL("../../src/Local.ts", import.meta.url)\n'
  }
  try {
    put("package.json", JSON.stringify({ private: true, workspaces: ["packages/*", "apps/*"] }))
    put(".gitignore", "node_modules/\n")
    put("tsconfig.json", JSON.stringify({ include: ["packages/*/src/**/*.ts", "packages/*/src/**/*.vibe"] }))
    put("packages/a/package.json", '{"name":"@acme/a"}')
    put("apps/site/package.json", '{"name":"site"}')
    put(module, "export const value: number = 42\n")
    for (const [file, text] of Object.entries({ ...outside, ...protectedFiles })) put(file, text)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "original")
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    writeProbeAwareCompiler(join(target, "node_modules/.bin/vibelang"), "#!/bin/sh\necho 'vibelang --fix: 0 fixes in 0 files.'\n", { mode: 0o755 })
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.inventory, { files: [{ path: module }] })
    writeJson(p.plan, { batches: [{ files: [module] }] })
    if (legacy) {
      // A journal from before this scan: its rename is done and it knows only the inventory.
      const state = prepareState(target, [module], await importers(target), { ts, referenceFiles: [], references: [module], catalog: await Jj.trackedFiles(target) })
      applyState(target, state); state.phase = "fixing"; state.toolConfigReferences = 1
      saveState(p.codemodState("01"), state)
    }
    const result = await codemod({ run, batch: "01" })
    assert.equal(result.referenceScan.pathSourceFiles, 3)
    for (const [file, text] of Object.entries(outside)) {
      assert.equal(readFileSync(join(target, file), "utf8"), text.replace("Local.ts", "Local.vibe"), file)
      assert.ok(result.referenceEdits.some(edit => edit.file === file && edit.kind === "source-reference"), file)
    }
    for (const [file, text] of Object.entries(protectedFiles)) assert.equal(readFileSync(join(target, file), "utf8"), text, file)
    await Jj.commit(target, "migrated batch")
    await revert({ run, batch: "01", file: "packages/a/src/Local.vibe", reason: "path regression" })
    for (const [file, text] of Object.entries(outside)) assert.equal(readFileSync(join(target, file), "utf8"), text, file)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
