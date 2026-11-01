import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { addRolldownPlugins } from "../../../.smithers/flows/migrate/lib/rolldown-builds.mjs"
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript")
const runtime = join(repo, "packages/unplugin/test/.fixtures/vibelang-runtime")

test("a real lazy Rolldown build fails before wiring and bundles a native source afterward", async () => {
  const root = mkdtempSync(join(tmpdir(), "alchemy-native-rolldown-"))
  const prior = Object.fromEntries(["VIBELANG_BINARY", "VIBELANG_RUNTIME", "VIBELANG_PROJECT", "VIBELANG_CACHE_DIR"].map(k => [k, process.env[k]]))
  try {
    const native = resolve(repo, "packages/compiler/native/vibelang")
    assert.ok(existsSync(native), "build the native compiler before this regression")
    assert.ok(existsSync(join(runtime, "dist")), "run through packages/unplugin/test/run.sh to build the runtime fixture")
    mkdirSync(join(root, "node_modules"))
    for (const [name, path] of [
      ["vibelang", join(repo, "packages/compiler")], ["vibelang-runtime", runtime],
      ["vibelang-unplugin", join(repo, "packages/unplugin")],
      ["rolldown", realpathSync(join(repo, "packages/unplugin/node_modules/rolldown"))],
      ["effect", realpathSync(join(repo, "experiments/node_modules/effect"))]
    ]) symlinkSync(path, join(root, "node_modules", name), "dir")
    writeFileSync(join(root, "package.json"), '{"type":"module","private":true}')
    writeFileSync(join(root, "tsconfig.json"), '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"skipLibCheck":true},"include":["entry.vibe"]}')
    writeFileSync(join(root, "entry.vibe"), "export const value: number = 42;\n")
    Object.assign(process.env, { VIBELANG_BINARY: native, VIBELANG_RUNTIME: runtime, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache/vibelang") })
    const source = 'const loadRolldown = () => import("rolldown"); export async function build(input) { const {rolldown} = await loadRolldown(); const bundle = await rolldown({input,plugins:[{name:"own"}]}); try { const output=await bundle.generate({format:"esm"});return output.output[0].code; } finally { await bundle.close(); } }\n'
    writeFileSync(join(root, "before.mjs"), source)
    const before = await import(pathToFileURL(join(root, "before.mjs")).href)
    await assert.rejects(() => before.build(join(root, "entry.vibe")))
    const result = addRolldownPlugins(source, ts, { file: "after.mjs" })
    assert.deepEqual(result.refusals, [])
    writeFileSync(join(root, "after.mjs"), result.text)
    const after = await import(pathToFileURL(join(root, "after.mjs")).href)
    const code = await after.build(join(root, "entry.vibe"))
    const module = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))
    assert.equal(module.value, 42)
  } finally {
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    rmSync(root, { recursive: true, force: true })
  }
})
