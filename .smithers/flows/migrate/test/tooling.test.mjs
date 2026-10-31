import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { eslintConfigName, oxlintPasses, wireDeveloperTools } from "../lib/tooling.mjs"
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
// smithers: every dprint.json pins its plugins by checksum, which
// DprintPlugins.test.ts checks, and dprint and ESLint read the declaration
// sidecars as source (batch 01: Canonical.d.vibe.ts failed fmt and lint).
const pin = "@" + "a".repeat(64)
test("setup leaves a pinned dprint configuration's plugins alone and keeps dprint and ESLint off the sidecars", t => {
  const pinnedConfig = { includes: ["**/*.{ts,json}"], excludes: ["**/dist"], plugins: [`https://plugins.dprint.dev/typescript-0.93.4.wasm${pin}`] }
  const root = fixture(t, {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "packages/pinned/package.json": JSON.stringify({ name: "pinned", scripts: { fmt: "dprint check", "fmt:write": "dprint fmt" } }),
    "packages/pinned/dprint.json": JSON.stringify(pinnedConfig),
    "packages/pinned/eslint.config.js": 'import tseslint from "typescript-eslint"\n\nexport default tseslint.config(\n  { ignores: ["**/dist"] },\n  { files: ["src/**/*.ts"] }\n)\n',
    "packages/open/package.json": JSON.stringify({ name: "open", scripts: { fmt: "dprint check" } }),
    "packages/open/dprint.json": JSON.stringify({ plugins: ["https://plugins.dprint.dev/typescript-0.93.4.wasm"] }),
    "packages/open/eslint.config.mjs": "export default [\n  { files: [\"**/*.ts\"] },\n]\n",
    "packages/named/package.json": JSON.stringify({ name: "named" }),
    "packages/named/eslint.config.js": "const config = [{ files: [\"**/*.ts\"] }]\nexport default config\n"
  })
  const result = wireDeveloperTools({ root, specsFor })
  const read = file => readFileSync(join(root, file), "utf8")
  assert.deepEqual(JSON.parse(read("packages/pinned/dprint.json")), { ...pinnedConfig, excludes: ["**/dist", "**/*.d.vibe.ts"] })
  const pinned = JSON.parse(read("packages/pinned/package.json"))
  assert.deepEqual(pinned.scripts, { fmt: "(dprint check) && vibelang-format --check", "fmt:write": "(dprint fmt) && vibelang-format --write" })
  assert.equal(pinned.devDependencies.vibelang, "0.0.11")
  const open = JSON.parse(read("packages/open/dprint.json"))
  assert.ok(open.plugins.includes("npm:vibelang/dprint-plugin.json"))
  assert.deepEqual(open.excludes, ["**/*.d.vibe.ts"])
  assert.equal(JSON.parse(read("packages/open/package.json")).scripts.fmt, "dprint check")
  assert.equal(read("packages/pinned/eslint.config.js"), 'import tseslint from "typescript-eslint"\n\nexport default tseslint.config(\n  { ignores: ["**/*.d.vibe.ts"] },\n  { ignores: ["**/dist"] },\n  { files: ["src/**/*.ts"] }\n)\n')
  assert.equal(read("packages/open/eslint.config.mjs"), 'export default [\n  { ignores: ["**/*.d.vibe.ts"] },\n  { files: ["**/*.ts"] },\n]\n')
  assert.equal(read("packages/named/eslint.config.js"), "const config = [{ files: [\"**/*.ts\"] }]\nexport default config\n")
  assert.equal(result.warnings.length, 2)
  assert.match(result.warnings[0], /^1 dprint configuration pins every plugin by checksum \(packages\/pinned\/dprint\.json\)/)
  assert.match(result.warnings[1], /^packages\/named\/eslint\.config\.js: add \{ ignores/)
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
// foldkit: lint:applications runs oxlint --config .oxlintrc.app.json on examples and
// the website, and lint:effect runs oxlint -c .oxlintrc.effect.json; their .vibe
// files got the root .oxlintrc.json's rules over the whole tree instead.
test("each oxlint invocation's .vibe pass uses the configuration it names with -c and the paths it lints", async t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ workspaces: ["packages/*"], scripts: {
      lint: "oxlint",
      "lint:applications": "oxlint --config .oxlintrc.app.json --disable-nested-config examples packages/website/src",
      "lint:both": "oxlint -D no-debugger && oxlint -c .oxlintrc.effect.json --deny-warnings packages scripts",
      "lint:root": "oxlint --config=.oxlintrc.json src"
    } }),
    "packages/x/package.json": JSON.stringify({ scripts: { lint: "oxlint -c ../../.oxlintrc.app.json src" } }),
    ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-debugger": "error" } }),
    ".oxlintrc.app.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "sort-imports": "error" }, jsPlugins: ["./plugin.mjs"] }),
    ".oxlintrc.effect.json": JSON.stringify({ categories: { correctness: "off" }, rules: { "no-unused-vars": "warn" } }),
    "plugin.mjs": 'export default { meta: { name: "app" }, rules: { only: { create: () => ({}) } } }\n',
    "node_modules/vibelang/package.json": '{"name":"vibelang","type":"module","exports":{"./eslint":"./eslint.mjs"}}',
    "node_modules/vibelang/eslint.mjs": "export default { parseForESLint() {} }\n",
    "node_modules/eslint/package.json": '{"name":"eslint","type":"module","exports":{"./use-at-your-own-risk":"./risk.mjs"}}',
    "node_modules/eslint/risk.mjs": 'export const builtinRules = new Map([["no-debugger", {}], ["sort-imports", {}], ["no-unused-vars", {}]])\n'
  })
  wireDeveloperTools({ root, specsFor })
  const scripts = JSON.parse(readFileSync(join(root, "package.json"))).scripts
  const pass = (config, paths) => `eslint --config .vibelang/${config} ${paths} --no-error-on-unmatched-pattern`
  assert.equal(scripts.lint, `(oxlint) && ${pass("eslint.config.mjs", '"**/*.vibe"')}`)
  assert.equal(scripts["lint:applications"], `(oxlint --config .oxlintrc.app.json --disable-nested-config examples packages/website/src) && ${pass("eslint.app.config.mjs", "examples packages/website/src")}`)
  assert.equal(scripts["lint:both"], `(oxlint -D no-debugger && oxlint -c .oxlintrc.effect.json --deny-warnings packages scripts) && ${pass("eslint.config.mjs", '"**/*.vibe"')} && ${pass("eslint.effect.config.mjs", "packages scripts")} --max-warnings 0`)
  assert.equal(scripts["lint:root"], `(oxlint --config=.oxlintrc.json src) && ${pass("eslint.config.mjs", "src")}`)
  assert.equal(JSON.parse(readFileSync(join(root, "packages/x/package.json"))).scripts.lint, "(oxlint -c ../../.oxlintrc.app.json src) && eslint --config ../../.vibelang/eslint.app.config.mjs src --no-error-on-unmatched-pattern")
  const rulesOf = async (file) => (await import(join(root, ".vibelang", file))).default.find(entry => entry.languageOptions?.parser).rules
  assert.deepEqual(await rulesOf("eslint.config.mjs"), { "no-debugger": ["error"] })
  assert.deepEqual(await rulesOf("eslint.app.config.mjs"), { "sort-imports": ["error"] })
  assert.deepEqual(await rulesOf("eslint.effect.config.mjs"), { "no-unused-vars": ["warn"] })
  // The app configuration's JS plugin loads from that configuration's directory.
  assert.ok((await import(join(root, ".vibelang/eslint.app.config.mjs"))).default.some(entry => entry.plugins?.app))
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
})

test("oxlintPasses reads each invocation's configuration and paths", () => {
  assert.deepEqual(oxlintPasses("oxlint"), [{ config: null, paths: [] }])
  assert.deepEqual(oxlintPasses("pnpm build && oxlint -c a.json --tsconfig tsconfig.json -A no-console --fix src lib; echo"), [{ config: "a.json", paths: ["src", "lib"] }])
  assert.deepEqual(oxlintPasses("(cd x && oxlint src) && vp lint"), [{ config: null, paths: ["src"] }, { config: null, paths: [] }])
  assert.equal(eslintConfigName(".oxlintrc.app.json"), "eslint.app.config.mjs")
  assert.equal(eslintConfigName("config/lint.json"), "eslint.config-lint.config.mjs")
})

test("setup regenerates the .vibe lint config where the lint script already runs it", t => {
  const step = "oxlint && eslint --config .vibelang/eslint.config.mjs \"**/*.vibe\" --no-error-on-unmatched-pattern"
  const root = fixture(t, { "package.json": JSON.stringify({ scripts: { lint: step } }), ".vibelang/eslint.config.mjs": "export default []\n" })
  wireDeveloperTools({ root, specsFor })
  assert.match(readFileSync(join(root, ".vibelang/eslint.config.mjs"), "utf8"), /vibelang\/eslint/)
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).scripts.lint, step)
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
})
// foldkit: its .oxlintrc.json loads its own plugin, ./packages/oxlint-plugin-foldkit,
// and turns on 17 foldkit/* rules, none of which ran on .vibe files.
test("the lint config runs the rules of the repository's Oxlint JS plugins on .vibe files, under Oxlint's names", async t => {
  const oxlintrc = {
    jsPlugins: [{ name: "house", specifier: "./tools/house.js" }, "eslint-plugin-shared", "./tools/named.mjs"],
    rules: { "house/no-foo": "error", "house/missing": "error", "shared/bar": "warn", "@acme/named/baz": ["error", { strict: true }] },
    overrides: [{ files: ["src/**/*.ts"], rules: { "house/no-foo": "off" } }]
  }
  const rule = "{ create: () => ({}) }"
  const root = fixture(t, {
    "package.json": '{"type":"module","scripts":{"lint":"oxlint"}}',
    ".oxlintrc.json": JSON.stringify(oxlintrc),
    "tools/house.js": `export default { meta: { name: "not-the-alias" }, rules: { "no-foo": ${rule} } }\n`,
    "tools/named.mjs": `export default { meta: { name: "@acme/oxlint-plugin-named" }, rules: { baz: ${rule} } }\n`,
    "node_modules/eslint-plugin-shared/package.json": '{"name":"eslint-plugin-shared","type":"module","exports":"./index.js"}',
    "node_modules/eslint-plugin-shared/index.js": `export default { rules: { bar: ${rule} } }\n`,
    "node_modules/vibelang/package.json": '{"name":"vibelang","type":"module","exports":{"./eslint":"./eslint.mjs"}}',
    "node_modules/vibelang/eslint.mjs": "export default { parseForESLint() {} }\n"
  })
  wireDeveloperTools({ root, specsFor })
  const config = (await import(join(root, ".vibelang/eslint.config.mjs"))).default
  const vibe = config.find(entry => entry.languageOptions?.parser)
  assert.deepEqual(Object.keys(vibe.plugins).sort(), ["@acme/named", "house", "oxc", "shared"])
  assert.deepEqual(vibe.rules, { "no-debugger": "error", "house/no-foo": ["error"], "shared/bar": ["warn"], "@acme/named/baz": ["error", { strict: true }] })
  assert.deepEqual(config.at(-1), { files: ["src/**/*.vibe"], rules: { "house/no-foo": ["off"] } })
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
test("the migrated lint command reports a JS plugin's rules at their .vibe source location", { skip: !deps && "set VIBELANG_TOOLING_NODE_MODULES" }, t => {
  const report = "(context) => ({ Identifier(node) { if (node.name === \"foo\") context.report({ node, message: \"no foo\" }) } })"
  const root = fixture(t, {
    "package.json": '{"type":"module","scripts":{"lint":"oxlint"}}',
    ".oxlintrc.json": JSON.stringify({ jsPlugins: ["./house.js"], rules: { "house/no-foo": "error", "house/no-foo-once": "warn" } }),
    "house.js": `export default { meta: { name: "eslint-plugin-house" }, rules: { "no-foo": { create: ${report} }, "no-foo-once": { createOnce: ${report} } } }\n`,
    "probe.vibe": "export const value = 1\nexport const foo = value\n"
  })
  wireDeveloperTools({ root, specsFor })
  symlinkSync(resolve(deps), join(root, "node_modules"), "dir")
  const run = () => spawnSync(process.execPath, [join(deps, "eslint/bin/eslint.js"), "--config", ".vibelang/eslint.config.mjs", "**/*.vibe"], { cwd: root, encoding: "utf8" })
  const bad = run()
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
  assert.match(bad.stdout, /2:14\s+error\s+no foo\s+house\/no-foo\n/)
  assert.match(bad.stdout, /2:14\s+warning\s+no foo\s+house\/no-foo-once\n/)
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
  assert.equal(read("packages/ui/package.json").devDependencies?.vibelang, undefined)
  assert.equal(read("packages/ui/package.json").devDependencies?.oxlint, undefined)
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

// foldkit-17: foldkit's lint scripts ran Oxlint in parentheses, which setup
// did not take for an Oxlint run, and an earlier run's pass named the default
// configuration where the script names .oxlintrc.app.json.
test("a tool run in parentheses gets its .vibe pass, and setup rewrites the passes an earlier run wrote", t => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-parenthesized-oxlint.json", import.meta.url), "utf8"))
  const root = fixture(t, {
    "package.json": JSON.stringify({ scripts: { ...corpus.scripts, fmt: "(oxfmt --check .)", pretty: "(prettier --check .)", both: "(oxfmt --check . && oxlint)" } }),
    ".oxlintrc.json": "{}",
    ".oxlintrc.app.json": "{}",
    "src/main.vibe": ""
  })
  wireDeveloperTools({ root, specsFor })
  const scripts = JSON.parse(readFileSync(join(root, "package.json"))).scripts
  assert.equal(scripts.lint, corpus.wired.lint)
  assert.equal(scripts["lint:applications"], corpus.wired["lint:applications"])
  assert.equal(scripts.fmt, "(oxfmt --check .) && vibelang-format --check")
  assert.equal(scripts.pretty, "(prettier --plugin vibelang/prettier --check .)")
  assert.equal(scripts.both, '((oxfmt --check . && oxlint) && vibelang-format --check) && eslint --config .vibelang/eslint.config.mjs "**/*.vibe" --no-error-on-unmatched-pattern')
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
})

// foldkit-17 (drive-foldkit-examples): the old setup, run again, wrapped
// lint:effect in another layer each time, and re-added the ESLint sidecar
// ignore that oxfmt had requoted to single quotes.
test("setup run again on foldkit's wiring leaves one layer of passes and one ignore entry", t => {
  const pass = "eslint --config .vibelang/eslint.effect.config.mjs packages examples scripts --no-error-on-unmatched-pattern"
  const inner = "effect-tsgo patch --no-typescript --oxlint && oxlint --config .oxlintrc.effect.json --disable-nested-config --deny-warnings packages examples scripts && vibelang lint -c .oxlintrc.effect.json --deny-warnings packages examples scripts"
  const own = 'pnpm build && eslint --config .vibelang/eslint.config.mjs "**/*.vibe" --no-error-on-unmatched-pattern'
  const root = fixture(t, {
    "package.json": JSON.stringify({ scripts: { "lint:effect": `(((${inner}) && ${pass}) && ${pass}) && ${pass}`, own: `(pnpm build) && eslint --config .vibelang/eslint.config.mjs "**/*.vibe" --no-error-on-unmatched-pattern` } }),
    ".oxlintrc.effect.json": "{}",
    "packages/e2e/eslint.config.mjs": "import js from '@eslint/js'\n\nexport default [\n  { ignores: ['**/*.d.vibe.ts'] },\n  js.configs.recommended,\n]\n",
    "eslint.config.mjs": "import js from '@eslint/js'\n\nexport default [\n  js.configs.recommended,\n]\n"
  })
  wireDeveloperTools({ root, specsFor })
  const scripts = JSON.parse(readFileSync(join(root, "package.json"))).scripts
  assert.equal(scripts["lint:effect"], `(${inner}) && ${pass} --max-warnings 0`)
  assert.equal(scripts.own, `(pnpm build) && eslint --config .vibelang/eslint.config.mjs "**/*.vibe" --no-error-on-unmatched-pattern`)
  assert.equal(readFileSync(join(root, "packages/e2e/eslint.config.mjs"), "utf8"), "import js from '@eslint/js'\n\nexport default [\n  { ignores: ['**/*.d.vibe.ts'] },\n  js.configs.recommended,\n]\n")
  assert.equal(readFileSync(join(root, "eslint.config.mjs"), "utf8"), "import js from '@eslint/js'\n\nexport default [\n  { ignores: ['**/*.d.vibe.ts'] },\n  js.configs.recommended,\n]\n")
  assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
  void own
})
