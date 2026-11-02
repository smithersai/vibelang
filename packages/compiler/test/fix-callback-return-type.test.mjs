import { strict as assert } from "node:assert"
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


for (const prefix of ["", "import { Effect } from \"effect\"\n"]) {
 test("--fix infers collected results after callback helper annotations: " + (prefix ? "imported" : "prelude"), { skip }, (t) => {
  const source = prefix + `function modality(value: string) { return value.split("/")[0] }
function modalities(values: readonly string[]) { return values.map(modality) }
const output: string[] = modalities(["image/png"])
export { output }
`
  const root = project(t, source)
  const first = vibelang(root, "-p", "tsconfig.json", "--fix", "--pretty", "false")
  assert.equal(first.status, 0, first.stdout + first.stderr)
  assert.doesNotMatch(first.stdout, /not fixed|refused/)
  const fixed = readFileSync(join(root, "main.vibe"), "utf8")
  assert.match(fixed, /function modalities\([^)]*\): infer _/)
  const second = vibelang(root, "-p", "tsconfig.json", "--fix", "--pretty", "false")
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.match(second.stdout, /0 fixes in 0 files/)
  assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), fixed)
 })
}
