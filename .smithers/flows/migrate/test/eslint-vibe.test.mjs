// A repository that runs ESLint itself names its files as *.ts. Setup passes its
// flat configurations through withVibe, so its rules reach .vibe modules
// (Smithers: a `debugger` planted in a .vibe module passed every lint command).
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { eslintScriptReadsVibe, wireDeveloperTools } from "../lib/tooling.mjs"
import { addEslintIgnore, addEslintVibe, wireKnips } from "../lib/wire.mjs"

const template = new URL("../templates/eslint-vibe.mjs", import.meta.url)
const compiler = new URL("../../../../packages/compiler", import.meta.url).pathname
const eslintDeps = new URL("../../../../packages/compiler/test/eslint/node_modules/", import.meta.url).pathname
const real = existsSync(join(eslintDeps, "eslint")) && (process.env.VIBELANG_BINARY || existsSync(join(compiler, "native/vibelang")))

function fixture(t, entries) {
  const root = mkdtempSync(join(tmpdir(), "vibe-eslint-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(entries)) {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

async function helper(t) {
  const root = fixture(t, {
    "node_modules/vibelang/package.json": '{"name":"vibelang","type":"module","exports":{"./eslint":"./eslint.mjs"}}',
    "node_modules/vibelang/eslint.mjs": 'export default { name: "stub parser" }\n',
    ".vibelang/eslint-vibe.mjs": readFileSync(template, "utf8")
  })
  return await import(join(root, ".vibelang/eslint-vibe.mjs"))
}

test("withVibe gives every TypeScript block its .vibe glob, and leaves other blocks and declaration globs", async t => {
  const { withVibe } = await helper(t)
  const config = withVibe([
    { files: ["src/**/*.ts", "examples/**/*.ts"], ignores: ["src/**/*.test.ts", "**/*.d.ts"] },
    { files: [["src/**/*.ts", "**/*.{ts,tsx}"]] },
    { files: ["**/*.mjs"] },
    { files: ["**/*.{js,jsx}"] },
    { ignores: ["src/generated.ts", "**/*.d.vibe.ts", "**/dist"] },
    { rules: { "no-debugger": "error" } }
  ])
  assert.deepEqual(config[0], { ignores: ["**/*.d.vibe.ts", "**/.vibelang/js/**"] })
  assert.deepEqual(config[1].files, ["src/**/*.ts", "examples/**/*.ts", "src/**/*.vibe", "examples/**/*.vibe"])
  assert.deepEqual(config[1].ignores, ["src/**/*.test.ts", "**/*.d.ts", "src/**/*.test.vibe"])
  assert.deepEqual(config[2].files, [["src/**/*.ts", "**/*.{ts,tsx}"], ["src/**/*.vibe", "**/*.vibe"]])
  assert.deepEqual(config[3].files, ["**/*.mjs"])
  assert.deepEqual(config[4].files, ["**/*.{js,jsx}"])
  assert.deepEqual(config[5].ignores, ["src/generated.ts", "**/*.d.vibe.ts", "**/dist", "src/generated.vibe"])
  assert.deepEqual(config.at(-1).files, ["**/*.vibe"])
  assert.equal(config.at(-1).languageOptions.parser.name, "stub parser")
})

test("withVibe turns off rules that need types, tells eslint-plugin-import about .vibe, and awaits a promise", async t => {
  const { withVibe } = await helper(t)
  const plugin = { rules: { typed: { meta: { docs: { requiresTypeChecking: true } } }, plain: { meta: { docs: {} } } } }
  const blocks = [
    { plugins: { "@typescript-eslint": plugin, import: {} }, settings: { "import/extensions": [".ts", ".js"] } },
    [{ rules: { "@typescript-eslint/typed": "error", "@typescript-eslint/plain": "error", "no-console": "error" } }]
  ]
  const config = await withVibe(Promise.resolve(blocks))
  assert.deepEqual(config.at(-1).rules, { "@typescript-eslint/typed": "off" })
  const { settings } = config.at(-2)
  assert.equal(config.at(-2).files, undefined)
  assert.deepEqual(settings["import/extensions"], [".ts", ".js", ".vibe"])
  assert.deepEqual(settings["import/parsers"], { "vibelang/eslint": [".vibe"] })
})

test("addEslintVibe wraps what a flat configuration exports", () => {
  const helperPath = "../.vibelang/eslint-vibe.mjs"
  const line = 'import { withVibe } from "../.vibelang/eslint-vibe.mjs"\n'
  assert.equal(addEslintVibe('import a from "a"\n\nexport default a.config(\n  { files: ["x;y"] },\n)\n', helperPath),
    line + 'import a from "a"\n\nexport default withVibe(a.config(\n  { files: ["x;y"] },\n))\n')
  assert.equal(addEslintVibe("const config = []\nexport default config;\n", helperPath),
    line + "\nconst config = []\nexport default withVibe(config);\n")
  assert.equal(addEslintVibe('import { p } from "./p.js"\nexport default await p({ root: 1 })\n', helperPath),
    line + 'import { p } from "./p.js"\nexport default withVibe(await p({ root: 1 }))\n')
  // An expression that goes on past its first line stays whole.
  assert.equal(addEslintVibe("export default a\n  .concat(b)\n\nconst later = 1\n", helperPath),
    line + "\nexport default withVibe(a\n  .concat(b))\n\nconst later = 1\n")
  // A rerun leaves it, and a later ignore still lands in the configuration, not in withVibe's arguments.
  const wrapped = addEslintVibe("export default [\n  { files: [] },\n]\n", helperPath)
  assert.equal(addEslintVibe(wrapped, helperPath), wrapped)
  assert.match(addEslintIgnore(wrapped, "**/later"), /withVibe\(\[\n {2}\{ ignores: \["\*\*\/later"\] \},\n/)
  assert.equal(addEslintVibe("module.exports = []\n", helperPath), null)
})

test("a script's TypeScript globs gain .vibe companions; directories, files and flag values stay", () => {
  assert.equal(eslintScriptReadsVibe('eslint --config eslint.config.js "packages/*/src/**/*.ts" --max-warnings=0'),
    'eslint --config eslint.config.js "packages/*/src/**/*.ts" "packages/*/src/**/*.vibe" --max-warnings=0 --no-error-on-unmatched-pattern')
  assert.equal(eslintScriptReadsVibe("eslint 'src/**/*.{ts,tsx}' && dprint check"), "eslint 'src/**/*.{ts,tsx}' 'src/**/*.vibe' --no-error-on-unmatched-pattern && dprint check")
  for (const same of ["eslint src examples --max-warnings=0 && dprint check", "eslint src/a.ts", "eslint --ignore-pattern '**/*.ts' src", "eslint 'src/**/*.d.ts'", "eslint-doctor '**/*.ts'", "eslint --config .vibelang/eslint.config.mjs 'src/**/*.ts'"]) {
    assert.equal(eslintScriptReadsVibe(same), same)
  }
  const once = eslintScriptReadsVibe('eslint "src/**/*.ts"')
  assert.equal(eslintScriptReadsVibe(once), once)
})

test("setup wires a repository's own ESLint configurations and lint scripts, once", t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { "lint:jsdoc": 'eslint --config eslint.config.js "packages/*/src/**/*.ts" --max-warnings=0' } }),
    "eslint.config.js": 'export default [\n  { files: ["packages/*/src/**/*.ts"] },\n]\n',
    "packages/a/package.json": JSON.stringify({ name: "a", scripts: { lint: "eslint src examples" } }),
    "packages/a/eslint.config.js": 'import { packageConfig } from "../../eslint.package.js"\n\nexport default await packageConfig({ tsconfigRootDir: import.meta.dirname })\n',
    "packages/b/package.json": JSON.stringify({ name: "b" }),
    "packages/b/test/fixtures/eslint.config.js": "export default []\n"
  })
  const result = wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) })
  const read = file => readFileSync(join(root, file), "utf8")
  assert.match(read("eslint.config.js"), /^import \{ withVibe \} from "\.\/\.vibelang\/eslint-vibe\.mjs"\n/)
  assert.match(read("eslint.config.js"), /export default withVibe\(\[/)
  assert.match(read("packages/a/eslint.config.js"), /^import \{ withVibe \} from "\.\.\/\.\.\/\.vibelang\/eslint-vibe\.mjs"\n/)
  assert.match(read("packages/a/eslint.config.js"), /export default withVibe\(await packageConfig\(\{ tsconfigRootDir: import\.meta\.dirname \}\)\)\n/)
  assert.doesNotMatch(read("packages/b/test/fixtures/eslint.config.js"), /withVibe/)
  assert.equal(read(".vibelang/eslint-vibe.mjs"), readFileSync(template, "utf8"))
  const manifest = JSON.parse(read("package.json"))
  assert.equal(manifest.devDependencies.vibelang, "0.0.11")
  assert.match(manifest.scripts["lint:jsdoc"], /"packages\/\*\/src\/\*\*\/\*\.vibe"/)
  assert.ok(result.changed.includes(".vibelang/eslint-vibe.mjs"))
  assert.deepEqual(wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) }).changed, [])
})

test("each package that installs Knip gets its compiler; a test's fixture does not", t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ name: "root" }),
    "packages/a/package.json": JSON.stringify({ name: "a", devDependencies: { knip: "6.34.0" } }),
    "packages/b/package.json": JSON.stringify({ name: "b" }),
    "packages/c/package.json": JSON.stringify({ name: "c", knip: { entry: ["src/main.ts"] } }),
    "packages/d/test/fixtures/x/package.json": JSON.stringify({ name: "x", devDependencies: { knip: "6.34.0" } })
  })
  const manifests = ["package.json", "packages/a/package.json", "packages/b/package.json", "packages/c/package.json", "packages/d/test/fixtures/x/package.json"]
  const wired = wireKnips({ root, manifests, specsFor: dir => ({ vibelang: `file:${dir}` }) })
  assert.deepEqual(wired.changed, ["packages/a/knip.config.ts", "packages/a/package.json", "packages/c/knip.config.ts", "packages/c/package.json"])
  assert.match(readFileSync(join(root, "packages/a/knip.config.ts"), "utf8"), /compilers: \{ vibe: vibelang \}/)
  assert.equal(JSON.parse(readFileSync(join(root, "packages/a/package.json"), "utf8")).devDependencies.vibelang, "file:packages/a")
  assert.equal(existsSync(join(root, "packages/d/test/fixtures/x/knip.config.ts")), false)
})

test("a Smithers-shaped ESLint configuration reports a .vibe module's defects, with its .ts rules and no false reports", { skip: !real && "needs packages/compiler/test/eslint's install and a built compiler" }, async t => {
  const root = fixture(t, {
    "package.json": JSON.stringify({ name: "r", type: "module" }),
    "tsconfig.json": JSON.stringify({ include: ["src"], compilerOptions: { module: "nodenext", allowImportingTsExtensions: true, noEmit: true } }),
    "eslint.jsdoc.js": 'export const jsdocConvention = [{ files: ["src/**/*.ts"], ignores: ["src/**/*.test.ts"], rules: { "no-debugger": "error" } }]\n',
    "eslint.config.js": `import js from "@eslint/js"
import tseslint from "typescript-eslint"
import { jsdocConvention } from "./eslint.jsdoc.js"

export default tseslint.config(
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-unused-vars": "off",
      "no-console": "error"
    }
  },
  ...jsdocConvention
)
`,
    "src/clean.vibe": 'export const clean = (name: string): string => name\n',
    "src/planted.vibe": 'export const planted = (name: string): string => {\n  console.log(name)\n  debugger\n  return name\n}\n'
  })
  mkdirSync(join(root, "node_modules/@eslint"), { recursive: true })
  for (const name of ["eslint", "typescript-eslint", "@eslint/js", "typescript"]) symlinkSync(join(eslintDeps, name), join(root, "node_modules", name), "dir")
  symlinkSync(compiler, join(root, "node_modules/vibelang"), "dir")
  wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.11" }) })
  const { ESLint } = createRequire(join(eslintDeps, "x.js"))("eslint")
  const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, "eslint.config.js") })
  // A directory of only .vibe files, as `eslint src` walks it.
  const results = await eslint.lintFiles(["src"])
  const by = Object.fromEntries(results.map(result => [result.filePath.replace(/^.*\//, ""), result.messages.map(m => m.ruleId ?? m.message).sort()]))
  assert.deepEqual(by, { "clean.vibe": [], "planted.vibe": ["no-console", "no-debugger"] })
})
