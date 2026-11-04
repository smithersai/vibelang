import { strict as assert } from "node:assert"
import fc from "fast-check"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// vibelang --fix (D291), end to end through the native compiler: it rewrites
// TypeScript-style Effect code, prints what it fixed, then compiles; a second
// run finds nothing, and a fix that would add an error is not written.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

function project(t, source) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-fix-test-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, noEmit: true },
    include: ["*.vibe"]
  }))
  writeFileSync(join(root, "main.vibe"), source)
  return root
}

function vibelang(root, ...args) {
  return spawnSync(native, args, { cwd: root, encoding: "utf8" })
}

test("--fix accepts an ordinary factory at a void destination without running its Effect", { skip }, (t) => {
  const root = project(t, "export const cb:(...args:any[])=>void=Effect.catchTags({Bad:()=>Effect.fail(1)})\n")
  const result = vibelang(root, "--fix", "--pretty", "false")
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(result.stdout, /EK4301|not fixed|refused/)
  const text = readFileSync(join(root, "main.vibe"), "utf8")
  assert.match(text, /Effect\.fail\(1\)/)
  assert.doesNotMatch(text, /throw 1/)
  const second = vibelang(root, "--fix", "--pretty", "false")
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.match(second.stdout, /0 fixes in 0 files/)
  assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), text)
})

test("--fix retains a native factory return-type error across body rewrites", { skip }, (t) => {
  const root = project(t, "export const cb:(...args:any[])=>number=Effect.catchTags({Bad:effect ()=>try Effect.fail(1)})\n")
  const result = vibelang(root, "--fix", "--pretty", "false")
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.match(result.stdout, /TS2322/)
  assert.doesNotMatch(result.stdout, /not fixed|refused site changed|refused site:.*EK4834/)
  assert.match(result.stdout, /refused site: main\.vibe:1:14-1:16 \[13,15\) TS2322: no fix applies/)
  const text = readFileSync(join(root, "main.vibe"), "utf8")
  assert.match(text, /throw 1/)
  const second = vibelang(root, "--fix", "--pretty", "false")
  assert.equal(second.status, 2, second.stdout + second.stderr)
  assert.match(second.stdout, /0 fixes in 0 files/)
  assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), text)
})

test("unfixed factory errors quote the refusal contract", () => {
  const text = readFileSync(join(repo, "docs/user/src/getting-started/012-devtools.md"), "utf8")
  assert.ok(text.includes("the run ends with the diagnostic still there and no fix for it"))
  assert.ok(text.includes("Refused sites alone don't change the exit status."))
})

test("factory refusals preserve typed destinations while independent body fixes remain idempotent", { skip }, t => {
  fc.assert(fc.property(fc.record({
    destination: fc.constantFrom("number", "string", "boolean"),
    failure: fc.integer({ min: 1, max: 9 }),
  }), input => {
    const prefix = "export const cb:(...args:any[])=>" + input.destination + "="
    const root = project(t, prefix + "Effect.catchTags({Bad:effect ()=>try Effect.fail(" + input.failure + ")})\n")
    const first = vibelang(root, "--fix", "--pretty", "false")
    assert.equal(first.status, 2, first.stdout + first.stderr)
    assert.match(first.stdout, /refused site: main\.vibe:1:14-1:16 \[13,15\) TS2322: no fix applies/)
    assert.doesNotMatch(first.stdout, /not fixed|refused site changed|refused site:.*EK4834/)
    const fixed = readFileSync(join(root, "main.vibe"), "utf8")
    assert.ok(fixed.startsWith(prefix), "the refused typed destination keeps its bytes")
    assert.match(fixed, new RegExp("throw " + input.failure))
    const second = vibelang(root, "--fix", "--pretty", "false")
    assert.equal(second.status, 2, second.stdout + second.stderr)
    assert.match(second.stdout, /TS2322: no fix applies/)
    assert.match(second.stdout, /0 fixes in 0 files/)
    assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), fixed)
  }), { seed: 114260, numRuns: 12, endOnFailure: true })
})
