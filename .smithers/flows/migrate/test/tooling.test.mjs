import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { wireDeveloperTools } from "../lib/tooling.mjs"
const specsFor = () => ({ vibelang: "0.0.11" })
function fixture(t, entries) {
  const root = mkdtempSync(join(tmpdir(), "vibe-tooling-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(entries)) {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}
test("migration extends existing format, lint and Prettier commands idempotently", t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ scripts: { format: "oxfmt .", "format:check": "oxfmt --check .", lint: "oxlint", pretty: "prettier --check ." } }),
    ".prettierrc": '{"semi": false}',
    ".vite-hooks/pre-commit": "vp staged\n",
    "packages/x/package.json": '{ "scripts": { "fmt": "vp fmt", "lint": "vp lint" } }'
  })
  wireDeveloperTools({ root, specsFor })
  const pkg = JSON.parse(readFileSync(join(root, "package.json")))
  assert.match(pkg.scripts.format, /&& vibelang-format --write/)
  assert.match(pkg.scripts["format:check"], /&& vibelang-format --check/)
  assert.match(pkg.scripts.lint, /&& eslint .*eslint.config.mjs/)
  assert.match(pkg.scripts.pretty, /prettier --plugin vibelang\/prettier/)
  assert.ok(pkg.devDependencies.eslint)
  assert.match(readFileSync(join(root, ".vite-hooks/pre-commit"), "utf8"), /vibelang-format --check/)
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".prettierrc"))).plugins, ["vibelang/prettier"])
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
})
test("ast-grep registration uses the canonical grammar and extends TS rules", t => {
  const root = fixture(t, {
    "package.json": "{}",
    "sgconfig.yml": "ruleDirs:\n  - rules\n",
    "rules/no-debugger.yml": "id: no-debugger\nlanguage: \"tsx\"\nfiles: [\"src/**/*.{ts,tsx}\"]\nignores:\n  - src/ignored.tsx\nseverity: error\nrule:\n  kind: debugger_statement\n"
  })
  const result = wireDeveloperTools({ root, specsFor })
  assert.match(readFileSync(join(root, "sgconfig.yml"), "utf8"), /languageSymbol: tree_sitter_vibe/)
  assert.match(readFileSync(join(root, "rules/no-debugger.vibelang.yml"), "utf8"), /language: VibeLang/)
  const cloned = readFileSync(join(root, "rules/no-debugger.vibelang.yml"), "utf8")
  assert.match(cloned, /src\/\*\*\/\*\.vibe/)
  assert.match(cloned, /src\/ignored\.vibe/)
  assert.equal(result.builds.length, 1)
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
})
test("the lint config loads where typescript-eslint refuses the repository's TypeScript", async t => {
  const root = fixture(t, {
    "package.json": '{"scripts":{"lint":"oxlint"}}',
    "node_modules/vibelang/package.json": '{"name":"vibelang","type":"module","exports":{"./eslint":"./eslint.mjs"}}',
    "node_modules/vibelang/eslint.mjs": "export default { parseForESLint() {} }\n",
    "node_modules/typescript-eslint/package.json": '{"name":"typescript-eslint","type":"module","exports":"./index.mjs"}',
    "node_modules/typescript-eslint/index.mjs": 'throw new Error("typescript-eslint does not support TS 7.0.")\n'
  })
  wireDeveloperTools({ root, specsFor })
  const config = (await import(join(root, ".vibelang/eslint.config.mjs"))).default
  assert.deepEqual(config.at(-1).files, ["**/*.vibe"])
  assert.equal(config.length, 2)
})
// foldkit: its .oxlintrc.json turns the correctness category off, enables
// no-explicit-any and turns it off under packages/foldkit/src, and the .vibe
// files there failed lint on typescript-eslint's recommended rules.
test("the lint config applies the repository's Oxlint rules and overrides to .vibe files, and no rule it did not choose", async t => {
  const oxlintrc = {
    categories: { correctness: "off" },
    rules: { "typescript/no-explicit-any": "error", "sort-imports": ["error", { ignoreCase: false }], "no-unused-vars": "deny", "eslint/no-debugger": "warn", "unicorn/no-null": "error", "oxc/no-barrel-file": "warn", "no-oxlint-only": "error" },
    overrides: [{ files: ["src/**/*.ts"], rules: { "typescript/no-explicit-any": "off" } }, { files: ["**/*.json"], rules: { "sort-imports": "off" } }]
  }
  const typescriptEslint = 'const plugin = { rules: { "no-explicit-any": {}, "no-unused-vars": {} } }\nexport default { plugin, configs: { recommended: [{ plugins: { "@typescript-eslint": plugin }, rules: { "@typescript-eslint/ban-ts-comment": "error" } }] } }\n'
  const root = fixture(t, {
    "package.json": '{"scripts":{"lint":"oxlint"}}',
    ".oxlintrc.json": "{\n  // the repository's own choices\n" + JSON.stringify(oxlintrc, null, 2).slice(1),
    "node_modules/vibelang/package.json": '{"name":"vibelang","type":"module","exports":{"./eslint":"./eslint.mjs"}}',
    "node_modules/vibelang/eslint.mjs": "export default { parseForESLint() {} }\n",
    "node_modules/typescript-eslint/package.json": '{"name":"typescript-eslint","type":"module","exports":"./index.mjs"}',
    "node_modules/typescript-eslint/index.mjs": typescriptEslint,
    "node_modules/eslint/package.json": '{"name":"eslint","type":"module","exports":{"./use-at-your-own-risk":"./risk.mjs"}}',
    "node_modules/eslint/risk.mjs": 'export const builtinRules = new Map([["no-debugger", {}], ["sort-imports", {}], ["no-unused-vars", {}]])\n'
  })
  wireDeveloperTools({ root, specsFor })
  const config = (await import(join(root, ".vibelang/eslint.config.mjs"))).default
  assert.equal(config.some(entry => entry.rules?.["@typescript-eslint/ban-ts-comment"]), false)
  const vibe = config.find(entry => entry.languageOptions?.parser)
  assert.deepEqual(vibe.rules, { "no-debugger": ["warn"], "@typescript-eslint/no-explicit-any": ["error"], "sort-imports": ["error", { ignoreCase: false }], "@typescript-eslint/no-unused-vars": ["error"] })
  assert.deepEqual(config.at(-1), { files: ["src/**/*.vibe"], rules: { "@typescript-eslint/no-explicit-any": ["off"] } })
})
test("setup regenerates the .vibe lint config where the lint script already runs it", t => {
  const step = "oxlint && eslint --config .vibelang/eslint.config.mjs \"**/*.vibe\" --no-error-on-unmatched-pattern"
  const root = fixture(t, { "package.json": JSON.stringify({ scripts: { lint: step } }), ".vibelang/eslint.config.mjs": "export default []\n" })
  wireDeveloperTools({ root, specsFor })
  assert.match(readFileSync(join(root, ".vibelang/eslint.config.mjs"), "utf8"), /vibelang\/eslint/)
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).scripts.lint, step)
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
})
const deps = process.env.VIBELANG_TOOLING_NODE_MODULES
test("the migrated lint command reports a debugger at its .vibe source location", { skip: !deps && "set VIBELANG_TOOLING_NODE_MODULES" }, t => {
  const root = fixture(t, { "package.json": '{"scripts":{"lint":"oxlint"}}', "probe.vibe": "export const value = 1\ndebugger;\n" })
  wireDeveloperTools({ root, specsFor })
  symlinkSync(resolve(deps), join(root, "node_modules"), "dir")
  const run = () => spawnSync(process.execPath, [join(deps, "eslint/bin/eslint.js"), "--config", ".vibelang/eslint.config.mjs", "**/*.vibe"], { cwd: root, encoding: "utf8" })
  const bad = run()
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
  assert.match(bad.stdout, /probe.vibe/)
  assert.match(bad.stdout, /2:1.*no-debugger/)
  writeFileSync(join(root, "probe.vibe"), "export const value = 1\n")
  const good = run()
  assert.equal(good.status, 0, good.stdout + good.stderr)
})
test("ast-grep scan applies the migrated TS rule to .vibe and VibeLang syntax", { skip: !deps && "set VIBELANG_TOOLING_NODE_MODULES" }, t => {
  const root = fixture(t, {
    "package.json": "{}",
    "sgconfig.yml": "ruleDirs:\n  - rules\n",
    "rules/no-debugger.yml": "id: no-debugger\nlanguage: typescript\nfiles: [src/**/*.ts]\nignores: [src/ignored.ts]\nseverity: error\nmessage: debugger is forbidden\nrule:\n  kind: debugger_statement\n",
    "src/ignored.vibe": "debugger;\n",
    "other/probe.vibe": "debugger;\n",
    "src/probe.vibe": 'export function f(): string!! { return sync(() => "ok") }\ndebugger;\n'
  })
  wireDeveloperTools({ root, specsFor })
  const build = spawnSync(process.execPath, [new URL("../../../../packages/compiler/bin/vibelang-ast-grep", import.meta.url).pathname, join(root, ".vibelang/vibelang-parser")], { encoding: "utf8" })
  assert.equal(build.status, 0, build.stderr)
  const run = () => spawnSync(join(deps, ".bin/ast-grep"), ["scan", "--config", "sgconfig.yml", "."], { cwd: root, encoding: "utf8" })
  const bad = run()
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
  assert.match(bad.stdout + bad.stderr, /no-debugger-vibelang/)
  assert.match(bad.stdout + bad.stderr, /probe.vibe:2/)
  writeFileSync(join(root, "src/probe.vibe"), 'export function f(): string!! { return sync(() => "ok") }\n')
  const good = run()
  assert.equal(good.status, 0, good.stdout + good.stderr)
})

test("only the root and packages that run vibelang themselves get the vibelang devDependency", t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ workspaces: ["packages/*"], scripts: { lint: "oxlint" } }),
    "packages/ui/package.json": JSON.stringify({ name: "ui", scripts: { lint: "oxlint src" } }),
    "packages/app/package.json": JSON.stringify({ name: "app", scripts: { format: "oxfmt ." } })
  })
  wireDeveloperTools({ root, specsFor })
  const read = (file) => JSON.parse(readFileSync(join(root, file)))
  // The ESLint config lives at the root and resolves vibelang/eslint from there.
  assert.match(read("packages/ui/package.json").scripts.lint, /eslint --config \.\.\/\.\.\/\.vibelang\/eslint\.config\.mjs/)
  assert.equal(read("packages/ui/package.json").devDependencies, undefined)
  assert.equal(read("packages/app/package.json").devDependencies.vibelang, "0.0.11")
  assert.equal(read("package.json").devDependencies.vibelang, "0.0.11")
})
test("a vendored tree that no workspace names keeps its bytes", t => {
  const vendored = {
    "repos/effect/package.json": '{ "scripts": { "lint": "oxlint", "format": "oxfmt ." } }',
    "repos/effect/dprint.json": '{"plugins":["https://plugins.dprint.dev/typescript-0.95.0.wasm"]}',
    "repos/effect/packages/effect/package.json": '{ "scripts": { "lint": "oxlint" } }'
  }
  const root = fixture(t, {
    "package.json": JSON.stringify({ scripts: { lint: "oxlint" } }),
    "pnpm-workspace.yaml": "packages:\n  - 'packages/*'\n",
    "packages/app/package.json": JSON.stringify({ name: "app", scripts: { format: "oxfmt ." } }),
    ...vendored
  })
  const { changed } = wireDeveloperTools({ root, specsFor })
  assert.match(JSON.parse(readFileSync(join(root, "packages/app/package.json"))).scripts.format, /vibelang-format/)
  for (const [file, text] of Object.entries(vendored)) assert.equal(readFileSync(join(root, file), "utf8"), text, file)
  assert.deepEqual(changed.filter(file => file.startsWith("repos/")), [])
})
test("dprint keeps the repo TypeScript plugin and adds VibeLang; unrelated manifests keep their bytes", t => {
  const root = fixture(t, {
    "package.json": '{"prettier":{"semi":false}}',
    "dprint.json": '{"plugins":["https://plugins.dprint.dev/typescript-0.95.0.wasm"],"includes":["src/**/*.ts"]}',
    "packages/untouched/package.json": '{ "name": "untouched" }'
  })
  wireDeveloperTools({ root, specsFor })
  const config = JSON.parse(readFileSync(join(root, "dprint.json")))
  assert.deepEqual(config.plugins, ["https://plugins.dprint.dev/typescript-0.95.0.wasm", "npm:vibelang/dprint-plugin.json"])
  assert.ok(config.includes.includes("**/*.vibe"))
  assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"))).prettier.plugins, ["vibelang/prettier"])
  assert.equal(readFileSync(join(root, "packages/untouched/package.json"), "utf8"), '{ "name": "untouched" }')
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
})

test("the migrated Vite+ hook checks .vibe without node_modules/.bin on PATH", { skip: !deps && "set VIBELANG_TOOLING_NODE_MODULES" }, t => {
  const root = fixture(t, {
    "package.json": "{}",
    ".vite-hooks/pre-commit": "vp staged\n",
    "tools/vp": "#!/bin/sh\nexit 0\n",
    "probe.vibe": "export const probe    =    { a:1,b:2 };\n"
  })
  wireDeveloperTools({ root, specsFor })
  chmodSync(join(root, "tools/vp"), 0o755)
  mkdirSync(join(root, "node_modules"))
  symlinkSync(new URL("../../../../packages/compiler", import.meta.url).pathname, join(root, "node_modules/vibelang"), "dir")
  const result = spawnSync("sh", [".vite-hooks/pre-commit"], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, PATH: [join(root, "tools"), dirname(process.execPath), "/usr/bin", "/bin"].join(":") }
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /probe.vibe: needs formatting/)
})
