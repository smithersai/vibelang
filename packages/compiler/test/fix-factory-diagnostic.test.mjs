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

test("--fix retains an existing factory callback diagnostic across body rewrites", {skip}, (t)=>{
 const root=project(t, "export const cb:(...args:any[])=>void=Effect.catchTags({Bad:()=>Effect.fail(1)})\n")
 const result=vibelang(root,"--fix","--pretty","false")
 assert.equal(result.status,2,result.stdout+result.stderr)
 assert.match(result.stdout,/EK4301/)
 assert.doesNotMatch(result.stdout,/not fixed|refused/)
 const text=readFileSync(join(root,"main.vibe"),"utf8")
 // No try runs the handler's Effect.fail, so no fix writes a throw (VIP-1, VIP-5).
 assert.match(text,/Effect\.fail\(1\)/)
 const second=vibelang(root,"--fix","--pretty","false")
 assert.equal(second.status,2,second.stdout+second.stderr)
 assert.match(second.stdout,/0 fixes in 0 files/)
 assert.equal(readFileSync(join(root,"main.vibe"),"utf8"),text)
})
