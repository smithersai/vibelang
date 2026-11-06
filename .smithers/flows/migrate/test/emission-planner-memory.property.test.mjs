import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-emission-planner-memory.json", import.meta.url), "utf8"))
const spec = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
assert.ok(spec.includes(corpus.rule))
const library = new URL("../lib/declarations.mjs", import.meta.url).href

function exercise({ declarations = corpus.declarations, explicit = false, depth = 0, runtime = "node", fullStep = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "emission-layout-memory-"))
  const put = (file, value) => {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value))
  }
  try {
    const source = "src/" + "nested/".repeat(depth) + "tool.vibe"
    put("package.json", { type: "module" })
    put("tsconfig.json", { vibe: { sidecarDir: ".vibe/declarations" }, compilerOptions: {
      module: "ESNext", target: "ES2022", types: [], ...(explicit ? { rootDir: "src" } : {})
    }, include: ["src"] })
    put(source, "export const value = 1\n")
    let large = ""
    for (let i = 0; i < declarations; i++) large += "export interface Type" + i + " { nested: { value: string; count: number }; readonly id: " + i + " }\n"
    put("src/large.ts", large)
    const compiler = join(root, ".bin/compiler.mjs")
    put(".bin/compiler.mjs", '#!/usr/bin/env node\n' +
      'import { mkdirSync, writeFileSync } from "node:fs"; import { dirname, join } from "node:path";\n' +
      'const args=process.argv; const out=args[args.indexOf("--outDir")+1]; const file=join(out,"tool.js");\n' +
      'mkdirSync(dirname(file),{recursive:true}); writeFileSync(file,"export const value=1;");\n' +
      'writeFileSync(file+".map",JSON.stringify({version:3,sourceRoot:' + JSON.stringify(root + "/") +
      ',sources:[' + JSON.stringify(source) + '],names:[],mappings:""}));\n' +
      'console.log("TSFILE: "+file);console.log("TSFILE: "+file+".map");\n')
    chmodSync(compiler, 0o755)
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(root, "node_modules/typescript"))
    symlinkSync(compiler, join(root, "node_modules/.bin/vibelang"))
    put("run.mjs", 'import assert from "node:assert/strict"; import {emitPackageJs} from ' + JSON.stringify(library) + ';\n' +
      'const result=await emitPackageJs({compiler:' + JSON.stringify(compiler) +
      ',packageDir:' + JSON.stringify(root) + ',root:' + JSON.stringify(root) + ',tsconfigs:["tsconfig.json"]});\n' +
      'assert.equal(result.code,0); assert.equal(result.files,1); assert.equal(result.layoutPlans.length,1); assert.equal(result.layoutPlans[0].stage,"declaration-layout"); assert.ok(result.layoutPlans[0].pid>0); assert.ok(result.layoutPlans[0].ms>=0); console.log(JSON.stringify(result.outputs));\n')
    if (fullStep) put("run.mjs", 'import assert from "node:assert/strict"; import {emitMigratedJs} from ' +
      JSON.stringify(new URL("../lib/steps.mjs", import.meta.url).href) + ';\n' +
      'const root=process.cwd(); const results=await emitMigratedJs({target:root,toolchain:{kind:"installed"},packages:[{dir:".",tsconfig:"tsconfig.json"}]},root,root+"/logs");\n' +
      'const result=results.find(r=>r.package==="."); assert.equal(result.code,0); assert.equal(result.files,1); assert.equal(result.layoutPlans.length,1); console.log(JSON.stringify(result.layoutPlans[0]));\n')
    const args = runtime === "node" ? ["--max-old-space-size=" + corpus.parentHeapMiB, "run.mjs"] : ["run.mjs"]
    const run = spawnSync(runtime, args, { cwd: root, encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024 })
    assert.equal(run.status, 0, JSON.stringify({ runtime, declarations, explicit, depth, signal: run.signal }) + "\n" + run.stderr.slice(-2500))
    const outputs = JSON.parse(run.stdout.trim().split("\n").at(-1))
    if (fullStep) {
      assert.equal(outputs.project, "tsconfig.json")
      assert.equal(outputs.sourceRoot, "src")
      assert.equal(outputs.stage, "declaration-layout")
      assert.ok(outputs.pid > 0)
      assert.ok(outputs.ms >= 0)
    } else assert.equal(outputs["./" + source], "./.vibelang/js/" + source.replace(/\.vibe$/, ".js"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("large inferred declaration graphs do not remain in the emission coordinator", () => exercise())
test("an explicit declaration root does not load the large graph in the coordinator", () => exercise({ explicit: true }))
test("small inferred roots retain normal emission behavior", () => exercise({ declarations: 100 }))
test("generated nested layouts work under a bounded coordinator heap", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 100, max: 1500 }), fc.integer({ min: 0, max: 3 }), fc.boolean(),
    async (declarations, depth, explicit) => exercise({ declarations, depth, explicit })), { numRuns: 8, seed: 1066 })
})
test("Bun can run the isolated declaration layout planner", { skip: spawnSync("bun", ["--version"]).status !== 0 },
  () => exercise({ declarations: 200, depth: 1, runtime: "bun" }))

test("the migration step preserves declaration layout progress in its receipt", () => exercise({ declarations: 100, fullStep: true }))
