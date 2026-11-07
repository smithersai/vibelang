import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repo = fileURLToPath(new URL("../", import.meta.url))
const cli = join(repo, ".smithers/node_modules/.bin/smthrs")
const witness = "//typescript/vibelang:tooling-format-tool-inputs"
const control = "//typescript/vibelang:unrelated-control"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tooling-witness-inputs-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  const declaration = readFileSync(process.env.TOOLING_CASE_DECLARATION ??
    join(repo, "typescript/vibelang/PACKAGE.ts"), "utf8")
  // Load the actual case declarations. Only unrelated native build products
  // are represented by files: explain must compute keys without compiling.
  put("typescript/vibelang/PACKAGE.ts", declaration)
  put("typescript/PACKAGE.ts", 'import { Smithers as S } from "@smthrs/targets"\nexport const Package = S.Package({ targets: { compiler: S.Filegroup({ srcs: [S.file("compiler-input")] }) } })\n')
  const packageDeclaration = readFileSync(join(repo, "packages/PACKAGE.ts"), "utf8")
  put("packages/PACKAGE.ts", packageDeclaration)
  put("migration-inputs.ts", readFileSync(join(repo, "migration-inputs.ts")))
  put("typescript/tsc/PACKAGE.ts", 'import { Smithers as S } from "@smthrs/targets"\nexport const Package = S.Package({ targets: { "go-vibelangfmt": S.Filegroup({ srcs: [] }), srcs: S.Filegroup({ srcs: [] }) } })\n')
  put("PACKAGE.ts", 'import { Smithers as S } from "@smthrs/targets"\nexport const Package = S.Package({ targets: {} })\n')
  put("package.json", '{"name":"tooling-input-fixture","private":true,"type":"module"}\n')
  for (const file of [".smithers/WORKSPACE.ts", ".smithers/package.json", ".smithers/bun.lock"]) {
    put(file, readFileSync(join(repo, file)))
  }
  for (const [source, owner] of [[declaration, "typescript/vibelang"], [packageDeclaration, "packages"]]) {
    for (const match of source.matchAll(/S\.file\("([^"]+)"\)/g)) {
      const file = match[1].startsWith("//") ? match[1].slice(2) : owner + "/" + match[1]
      put(file, existsSync(join(repo, file)) ? readFileSync(join(repo, file)) : "fixture input\n")
    }
  }
  for (const file of ["typescript/compiler-input", "packages/compiler-input", "packages/runtime-input", "packages/published-input"]) put(file, "unchanged native product\n")
  for (const name of ["tooling-format-tool-inputs", "unrelated-control"]) {
    put("typescript/vibelang/cases/" + name + "/tsconfig.json", "{}\n")
    put("typescript/vibelang/cases/" + name + "/run.mjs", 'console.log("fixture")\n')
  }
  put("typescript/vibelang/cases/_tooling-witness.mjs", "export const fixture = true\n")
  put("packages/vite/src/index.js", "export const adapter = 1\n")
  put("packages/compiler/eslint.mjs", "export const parser = 1\n")
  put("packages/compiler/register.mjs", "export const loader = 1\n")
  put("packages/vite/package.json", '{"name":"adapter-fixture","version":"1.0.0"}\n')
  put("packages/vite/bun.lock", "fixture lock version 1\n")
  symlinkSync(join(repo, ".smithers/node_modules"), join(root, "node_modules"), "dir")
  symlinkSync(join(repo, ".smithers/node_modules"), join(root, ".smithers/node_modules"), "dir")
  const key = label => {
    const result = spawnSync(cli, ["explain", label], {
      cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024
    })
    assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error ?? ""))
    const value = /^  key: ([0-9a-f]{64})$/m.exec(result.stdout)?.[1]
    assert.ok(value, result.stdout)
    return value
  }
  return { put, key }
}

test("adapter edits and dependency pins invalidate their real tooling witness only", t => {
  const { put, key } = fixture(t)
  const controlKey = key(control)
  let previous = key(witness)
  for (const [file, text] of [
    ["packages/vite/src/index.js", "export const adapter = 2\n"],
    ["packages/compiler/eslint.mjs", "export const parser = 2\n"],
    ["packages/compiler/register.mjs", "export const loader = 2\n"],
    ["packages/vite/package.json", '{"name":"adapter-fixture","version":"2.0.0"}\n'],
    ["packages/vite/bun.lock", "fixture lock version 2\n"]
  ]) {
    put(file, text)
    const next = key(witness)
    assert.notEqual(next, previous, file + " must invalidate its reader")
    previous = next
  }
  assert.equal(key(control), controlKey, "adapter changes must leave an unrelated case cached")
})

test("new adapter source neighbours invalidate the reader while unrelated files do not", t => {
  const { put, key } = fixture(t)
  const controlKey = key(control)
  let previous = key(witness)
  for (let index = 0; index < 8; index++) {
    const file = index % 2
      ? "packages/compiler/generated-" + index + ".mjs"
      : "packages/vite/src/nested/generated-" + index + ".js"
    put(file, "export const generated = " + index + "\n")
    const next = key(witness)
    assert.notEqual(next, previous, file)
    previous = next
  }
  const before = key(witness)
  put("docs/unrelated.txt", "an unrelated documentation edit\n")
  assert.equal(key(witness), before)
  assert.equal(key(control), controlKey)
})
