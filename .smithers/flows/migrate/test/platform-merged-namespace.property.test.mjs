import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { splitBatchPlatform, splitPlatformToModule } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-platform-merged-namespace.json", import.meta.url), "utf8"))
const spec = readFileSync(new URL("../../../../docs/design/vips/0040-module-declarations.md", import.meta.url), "utf8")
assert.ok(spec.includes(corpus.rule))
const split = text => splitPlatformToModule(text, "src/index.ts", ts, { throws: true, platform: false })

function fixture(name = "Asset", nested = false, reopened = false, shadow = false) {
  const depth = Number(nested)
  const member = "Metadata.".repeat(depth) + "Input"
  const body = (shadow ? "type Local = number;\n" : "") +
    "export interface Input { readonly value: " + (shadow ? "Local" : "number") + " }\n"
  let namespaceBody = body
  for (let i = 0; i < depth; i++) namespaceBody = "export namespace Metadata {\n" + namespaceBody + "}\n"
  return (shadow ? "type Local = { unrelated: true }\nexport const unrelated = (value: Local): Local => value\n" : "") +
    "export class " + name + " {\nconstructor(readonly input: " + name + "." + member +
    ") { if (input.value < 0) throw new Error(\"negative\") }\n}\n" +
    "export namespace " + name + " {\n" + namespaceBody + "}\n" +
    (reopened ? "export namespace " + name + " { export type Alias = " + member + " }\n" : "") +
    "export type Input = " + name + "." + member + "\nexport const kept = 42\n"
}

function exercise(text, name = "Asset") {
  const result = split(text)
  assert.ok(result?.module, JSON.stringify(result))
  const root = mkdtempSync(join(tmpdir(), "merged-namespace-"))
  try {
    for (const side of ["native", "converted"]) {
      const dir = join(root, side)
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}')
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
          declaration: true, skipLibCheck: true, types: [], outDir: "out", rootDir: "." },
        include: ["index.ts", "index.vibe"]
      }))
      writeFileSync(join(dir, side === "native" ? "index.ts" : "index.vibe"), side === "native" ? text : result.module)
      const args = side === "native" ? [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"] : ["-p", "tsconfig.json"]
      const run = spawnSync(side === "native" ? process.execPath : compiler, args, { cwd: dir, encoding: "utf8", timeout: 30000 })
      assert.equal(run.status, 0, side + ": " + run.stdout + run.stderr + "\n" + result.module)
    }
    const observe = side => {
      const script = 'const m = await import("./out/index.js"); const C=m[' + JSON.stringify(name) +
        ']; let error; try { new C({value:-1}) } catch(e) { error=e.message }; console.log(JSON.stringify([new C({value:7}).input.value,error,m.kept,Object.keys(m).sort()]));'
      const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: join(root, side), encoding: "utf8" })
      assert.equal(run.status, 0, run.stderr)
      return run.stdout
    }
    assert.equal(observe("converted"), observe("native"))
    if (text.includes("type Local")) {
      const outside = result.module.slice(result.module.indexOf("export {"))
      assert.match(outside, /type Local = \{ unrelated: true \}/)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a throwing class keeps its merged namespace across the module boundary", { skip: !compiler && "set VIBELANG_BINARY" }, () => exercise(corpus.source))

test("reopened nested namespaces retain their local types and runtime constructor", { skip: !compiler && "set VIBELANG_BINARY" }, () => exercise(fixture("Resource", true, true, true), "Resource"))

test("namespaces with runtime initialization refuse a partial split", () => {
  const source = corpus.source.replace("export interface Input { readonly value: number }",
    "export interface Input { readonly value: number }\n  export const initialized = (() => 1)()")
  const files = { "src/index.ts": source }
  const result = splitBatchPlatform(".", ["src/index.ts"], ts, {
    moduleBodies: true, exists: file => file in files, read: file => files[file], write: (file, text) => { files[file] = text }
  })
  assert.equal(files["src/index.ts"], source)
  assert.equal(result.splits.length, 0)
  assert.ok(result.refused.length)
})

test("an unrelated namespace without host or throwing code is unchanged", () => {
  assert.equal(split("export namespace Safe { export interface Input { value: number } }\nexport const kept = 1\n"), null)
})

test("generated merged namespace shapes preserve native types and constructor behavior", { skip: !compiler && "set VIBELANG_BINARY" }, async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("Asset", "Resource", "Entry"), fc.integer({ min: 0, max: 3 }), fc.boolean(), fc.boolean(),
    async (name, nested, reopened, shadow) => exercise(fixture(name, nested, reopened, shadow), name)
  ), { numRuns: 24, seed: 1066 })
})
