import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { compileProjectSync, projectBackend } from "../../../../packages/compiler/project.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const directory = fileURLToPath(new URL("./out/api-case/", import.meta.url))
rmSync(directory, { recursive: true, force: true })
mkdirSync(join(directory, "node_modules"), { recursive: true })
symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(directory, "node_modules/effect"))
symlinkSync(join(repo, "packages/runtime"), join(directory, "node_modules/vibelang-runtime"))
writeFileSync(join(directory, "package.json"), '{"type":"module"}')
writeFileSync(join(directory, "main.vibe"), "export const answer = 42\n")
writeFileSync(join(directory, "main.ts"), "export const answer = 42\n")
writeFileSync(join(directory, "unrelated.ts"), 'import { Effect } from "effect"\nexport const n: number = "bad"\nexport const pause = () => Effect.sleep(0)\n')
const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], noEmitOnError: false, outDir: "dist" }
const settings = { compilerOptions: options, files: ["main.vibe", "unrelated.ts"], vibe: { effectGlobals: false, effectModules: false, severities: { EK3833: "warning" } } }
const project = join(directory, "tsconfig.json")
writeFileSync(project, JSON.stringify(settings))
writeFileSync(join(directory, "tsconfig.native.json"), JSON.stringify({ compilerOptions: { ...options, noEmit: true }, files: ["main.ts", "unrelated.ts"] }))
const native = spawnSync(process.execPath, [join(repo, "docs/tools/node_modules/typescript/bin/tsc"), "-p", "tsconfig.native.json", "--pretty", "false"], { cwd: directory, encoding: "utf8", timeout: 90000 })
assert.notEqual(native.status, 0)
assert.match(native.stdout, /unrelated.ts\(2,14\): error TS2322:/)
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const backend = projectBackend({ root: directory, compiler, cache: false })
const failures=[]
try {
  for (const [name, result] of [
    ["sync", compileProjectSync({ project, compiler, cache: false })],
    ["async", await backend.compile(project)],
  ]) {
    assert.ok(result.outputs.has(join(directory, "main.vibe")), name + ": output scope still includes main.vibe")
    try { assert.ok(result.errors.some(d => d.code === "TS2322" && d.file === join(directory, "unrelated.ts")), name + ": missing unrelated.ts project error: " + JSON.stringify(result.errors)) }catch(error){failures.push(error.message)}
    try { assert.ok(result.warnings.some(d => d.code === "EK3833" && d.file === join(directory, "unrelated.ts")), name + ": missing unrelated.ts project warning: " + JSON.stringify(result.warnings)) }catch(error){failures.push(error.message)}
  }
} finally { await backend.close() }
assert.deepEqual(failures,[])
console.log("ok")
