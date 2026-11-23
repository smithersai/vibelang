import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { replaceTsc } from "../lib/wire.mjs"
import { wireDeveloperTools } from "../lib/tooling.mjs"
import { nativeConfigScripts } from "../lib/vite-config.mjs"

const write = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

test("replaceTsc rewrites tsc/tsgo/tsrs only in command position (#534)", () => {
  assert.deepEqual(
    replaceTsc({
      tsc: "tsc -p .",
      check: "npm run tsc",
      clean: "rm -rf out tsc",
      lint: "eslint --ext tsc .",
      npx: "echo ok && npx tsgo --noEmit",
    }),
    {
      tsc: "vibelang -p .",
      check: "npm run tsc",
      clean: "rm -rf out tsc",
      lint: "eslint --ext tsc .",
      npx: "echo ok && npx vibelang --noEmit",
    },
  )
})

test("prettier wiring inserts --plugin only at command-position prettier (#534)", (t) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-534-prettier-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  write(root, "package.json", JSON.stringify({
    name: "app",
    scripts: { fmt: "eslint -c eslint-prettier.cjs . && prettier --check ." },
  }, null, 2) + "\n")
  wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.13" }) })
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  assert.equal(pkg.scripts.fmt, "eslint -c eslint-prettier.cjs . && prettier --plugin vibelang/prettier --check .")
})

test("wireDeveloperTools preserves existing eslint/typescript-eslint versions and warns on incompatible major (#534)", (t) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-534-eslint-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  write(root, "package.json", JSON.stringify({
    name: "app",
    scripts: { lint: "oxlint ." },
    devDependencies: { eslint: "^8.57.0", "typescript-eslint": "^7.0.0" },
  }, null, 2) + "\n")
  const result = wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.13" }) })
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  assert.equal(pkg.devDependencies.eslint, "^8.57.0")
  assert.equal(pkg.devDependencies["typescript-eslint"], "^7.0.0")
  assert.ok(result.warnings.some((w) => /eslint/i.test(w) && /8\.57\.0/.test(w)), JSON.stringify(result.warnings))
})

test("wireDeveloperTools leaves fixture .prettierrc and dprint.json untouched (#534)", (t) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-534-fixtures-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const prettierText = JSON.stringify({ semi: false }, null, 2) + "\n"
  const dprintText = JSON.stringify({ plugins: ["https://plugins.dprint.dev/json-0.19.3.wasm"] }, null, 2) + "\n"
  write(root, "package.json", JSON.stringify({ name: "app" }, null, 2) + "\n")
  write(root, "packages/x/test/fixtures/format/.prettierrc", prettierText)
  write(root, "test/fixtures/dprint.json", dprintText)
  wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.13" }) })
  assert.equal(readFileSync(join(root, "packages/x/test/fixtures/format/.prettierrc"), "utf8"), prettierText)
  assert.equal(readFileSync(join(root, "test/fixtures/dprint.json"), "utf8"), dprintText)
})

test("wireDeveloperTools and nativeConfigScripts quote paths containing spaces (#534)", (t) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-534-quote-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  write(root, "package.json", JSON.stringify({ name: "app" }, null, 2) + "\n")
  write(root, "tools/ast grep/sgconfig.yml", "ruleDirs:\n  - rules\n")
  write(root, "tools/ast grep/rules/no-foo.yml", "id: no-foo\nlanguage: typescript\nrule:\n  pattern: foo\n")
  wireDeveloperTools({ root, specsFor: () => ({ vibelang: "0.0.13" }) })
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  assert.ok(pkg.scripts.postinstall.includes("cd 'tools/ast grep'"), pkg.scripts.postinstall)

  const { scripts } = nativeConfigScripts(
    { build: "vite build" },
    { root, dir: ".", renames: [{ from: "vite.config.ts", to: "my dir/vite.config.vibe" }] },
  )
  assert.ok(scripts.build.includes("--config 'my dir/vite.config.vibe'"), scripts.build)
})
