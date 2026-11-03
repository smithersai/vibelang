import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { wireDeveloperTools } from "../lib/tooling.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const specsFor = () => ({ vibelang: "0.0.11" })

function fixture(t, entries) {
  const root = mkdtempSync(join(tmpdir(), "migrate-vite-lint-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const all = {
    "node_modules/vibelang/package.json": '{"name":"vibelang","type":"module","exports":{"./eslint":"./eslint.mjs"}}',
    "node_modules/vibelang/eslint.mjs": "export default { parseForESLint() {} }",
    ...entries,
  }
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  wireDeveloperTools({ root, specsFor, ts })
  return root
}
const load = async root => (await import(join(root, ".vibelang/eslint.config.mjs") + "?" + Math.random())).default
const ruleOf = (configs, name) => configs.find(config => config.languageOptions?.parser)?.rules[name]
const lint = {
  ignorePatterns: ["gen/**"],
  jsPlugins: ["./house.mjs"],
  rules: { "no-debugger": "error", "house/own": "error" },
  overrides: [{ files: ["src/**/*.ts"], rules: { "house/own": "off", "no-new": "error" } }],
}
const house = 'export default { meta: { name: "house" }, rules: { own: { create() { return {} } } } }'
const vp = '{"type":"module","scripts":{"lint":"vp lint"}}'

for (const [form, config] of [
  ["an object", `export default ${JSON.stringify({ lint })}`],
  ["a function", `export default () => (${JSON.stringify({ lint })})`],
  ["an async function", `export default async () => (${JSON.stringify({ lint })})`],
]) {
  test(`vp lint: .vibe files get the lint section of a Vite config written as ${form}`, async t => {
    const root = fixture(t, { "package.json": vp, "house.mjs": house, "vite.config.mjs": config })
    const configs = await load(root)
    assert.deepEqual(ruleOf(configs, "no-debugger"), ["error"])
    assert.deepEqual(ruleOf(configs, "house/own"), ["error"])
    assert.ok(configs[0].ignores.some(glob => glob.includes("gen/")), JSON.stringify(configs[0].ignores))
    assert.deepEqual(configs.at(-1).files, ["src/**/*.vibe"])
    assert.deepEqual(configs.at(-1).rules, { "house/own": ["off"], "no-new": ["error"] })
    assert.ok(configs.find(c => c.plugins?.house)?.plugins.house.rules.own)
  })
}

test("vp lint prefers the Vite lint section over an .oxlintrc, and falls back when it has none", async t => {
  const both = fixture(t, { "package.json": vp, "vite.config.mjs": 'export default { lint: { rules: { "no-debugger": "error" } } }', ".oxlintrc.json": '{"rules":{"no-new":"error"}}' })
  const fromVite = await load(both)
  assert.deepEqual(ruleOf(fromVite, "no-debugger"), ["error"])
  assert.equal(ruleOf(fromVite, "no-new"), undefined)
  const none = fixture(t, { "package.json": vp, "vite.config.mjs": "export default { server: {} }", ".oxlintrc.json": '{"rules":{"no-new":"error"}}' })
  assert.deepEqual(ruleOf(await load(none), "no-new"), ["error"])
})

test("plain oxlint never loads the Vite config", async t => {
  const root = fixture(t, { "package.json": '{"type":"module","scripts":{"lint":"oxlint"}}', "vite.config.mjs": 'throw new Error("loaded")', ".oxlintrc.json": '{"rules":{"no-new":"error"}}' })
  assert.deepEqual(ruleOf(await load(root), "no-new"), ["error"])
})

test("vp lint: a Vite config that fails to load fails the pass instead of linting with no rules", async t => {
  const root = fixture(t, { "package.json": vp, "vite.config.mjs": 'throw new Error("broken config")' })
  await assert.rejects(load(root), /broken config/)
})

// Categories decide most of a .ts file's rules (t3code: 170 of 188).
test("rules a category turns on reach .vibe files through the tool's resolution", async t => {
  const printer = (rules) => `#!/bin/sh\ncat <<'J'\n${JSON.stringify({ rules })}\nJ\n`
  const root = fixture(t, {
    "package.json": vp,
    "house.mjs": house,
    "vite.config.mjs": `export default ${JSON.stringify({ lint: { categories: { perf: "warn" }, jsPlugins: ["./house.mjs"], rules: { "house/own": "error" } } })}`,
    "node_modules/.bin/vp": printer({ "no-await-in-loop": "warn", "unicorn/not-under-eslint": "warn", "shadow/not-loaded": "warn" }),
  })
  chmodSync(join(root, "node_modules/.bin/vp"), 0o755)
  const logged = []
  t.mock.method(console, "error", line => logged.push(line))
  const configs = await load(root)
  assert.deepEqual(ruleOf(configs, "no-await-in-loop"), ["warn"])
  assert.deepEqual(ruleOf(configs, "house/own"), ["error"])
  assert.match(logged.join(""), /1 Oxlint rules do not run on \.vibe files: shadow\/not-loaded/)
})

test("a failing rule resolution fails the pass", async t => {
  const root = fixture(t, {
    "package.json": vp,
    "vite.config.mjs": 'export default { lint: { rules: {} } }',
    "node_modules/.bin/vp": "#!/bin/sh\necho nope >&2\nexit 3\n",
  })
  chmodSync(join(root, "node_modules/.bin/vp"), 0o755)
  await assert.rejects(load(root), /--print-config failed: nope/)
})

// typescript-eslint refuses TypeScript 7, so a repository on it runs ESLint's
// core no-unused-vars. t3code: 489 reports over 452 files, nearly all of them
// these forms, on code oxlint accepts as .ts.
const eslintDeps = new URL("../../../../packages/compiler/test/eslint/node_modules/", import.meta.url).pathname
const installed = existsSync(join(eslintDeps, "eslint"))
test("without typescript-eslint, no-unused-vars reads TypeScript forms and still reports real unused names", { skip: !installed && "run bun install in packages/compiler/test/eslint" }, async t => {
  const parserPath = dirname(createRequire(eslintDeps + "x.js").resolve("@typescript-eslint/parser/package.json"))
  const root = fixture(t, {
    "package.json": '{"type":"module","scripts":{"lint":"oxlint"}}',
    ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } }),
    "node_modules/vibelang/eslint.mjs": `import parser from ${JSON.stringify(parserPath + "/dist/index.js")}\nexport default parser`,
    "src/main.vibe": `import * as Effect from "effect/Effect"
import { kept } from "effect"
import * as Other from "other"
export type Join = (first: string, ...rest: string[]) => string
export interface Reader { read(path: string, { at }: { at: number }): string; new (size: number): Reader; (call: string): void }
export declare function declared(name: string): void
export abstract class Base { abstract run(input: string): void }
declare module "router" { interface HistoryState { index?: string } }
const unusedConst = 1
export function run(used: string, unusedParam: string, _ignored: string) { return used }
`,
  })
  symlinkSync(join(eslintDeps, "eslint"), join(root, "node_modules/eslint"), "dir")
  const { ESLint } = createRequire(eslintDeps + "x.js")("eslint")
  const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, ".vibelang/eslint.config.mjs") })
  const [result] = await eslint.lintFiles(["src/main.vibe"])
  assert.deepEqual(result.messages.filter(m => m.fatal), [])
  const names = result.messages.map(m => [m.ruleId, m.message.match(/^'([^']+)'/)?.[1]])
  assert.deepEqual(names.sort(), [
    ["vibelang/no-unused-vars", "Other"],
    ["vibelang/no-unused-vars", "unusedConst"],
    ["vibelang/no-unused-vars", "unusedParam"],
  ])
})
