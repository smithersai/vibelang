import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { setTimeout as sleep } from "node:timers/promises"
import { compileProjectSync } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "cov900-cache-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = join(root, "tsconfig.json")
  const put = (file, value) => writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")), join(root, "node_modules/effect"))
  symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
  put("package.json", { type: "module" })
  const configure = target => put("tsconfig.json", { compilerOptions: { target, module: "nodenext", strict: true, types: [], skipLibCheck: true, rewriteRelativeImportExtensions: true }, include: ["*.vibe", "*.d.ts"] })
  const cache = { directory: join(root, "cache") }
  const compile = enabled => compileProjectSync({ root, project, compiler, cache: enabled ? cache : false })
  return { root, put, configure, compile }
}
const diagnostics = result => result.errors.map(d => [d.code, d.line, d.column, d.text])
const outputs = result => [...result.outputs].map(([file, value]) => [file, value.code]).sort()

// docs/design/src/900-appendices.md#390ba2fea82ebf3c — Chapter 900: cache target sensitivity and fresh-output equivalence.
// docs/design/src/900-appendices.md#7ed17507a5f31f47 — Chapter 900: cache target sensitivity and fresh-output equivalence.
// docs/design/src/900-appendices.md#ecbe14929425dd61 — Chapter 900: cache target sensitivity and fresh-output equivalence.
// docs/design/src/900-appendices.md#274931c027ed7c8b — Chapter 900: cache target sensitivity and fresh-output equivalence.
test("target changes invalidate an unchanged nullish-coalescing module and match a fresh compile", async t => {
  const f = fixture(t)
  f.put("main.vibe", "export const selected = (item: { value?: number }): number => item.value ?? 0\n")
  f.configure("es2018")
  await sleep(150)
  const old = f.compile(true)
  assert.deepEqual(old.errors, [])
  assert.doesNotMatch(old.outputs.get(join(f.root, "main.vibe")).code, /\?\?/)
  assert.deepEqual(outputs(f.compile(true)), outputs(old))
  for (const target of ["es2022", "es2018", "es2022"]) {
    f.configure(target)
    await sleep(150)
    const cached = f.compile(true), fresh = f.compile(false)
    assert.deepEqual(diagnostics(cached), diagnostics(fresh))
    assert.deepEqual(outputs(cached), outputs(fresh))
    assert.equal(cached.outputs.get(join(f.root, "main.vibe")).code.includes("??"), target === "es2022")
  }
})
// docs/design/src/900-appendices.md#462b0e11deabddb0 — Chapter 900: same nodes retain the imported contract edge.
// docs/design/src/900-appendices.md#e2cfe8a90d4c2bcc — Chapter 900: same nodes retain the imported contract edge.
test("an imported contract changes an owned diagnostic with the same two source filenames", async t => {
  const f = fixture(t)
  f.configure("es2022")
  f.put("main.vibe", 'import { value } from "./contract.js"\nexport const selected: number = value\n')
  for (const type of ["number", "string", "number"]) {
    f.put("contract.d.ts", "export declare const value: " + type + "\n")
    await sleep(150)
    const cached = f.compile(true), fresh = f.compile(false)
    assert.deepEqual(diagnostics(cached), diagnostics(fresh))
    assert.deepEqual(outputs(cached), outputs(fresh))
    assert.equal(cached.errors.some(d => d.code === "TS2322"), type === "string")
  }
})
