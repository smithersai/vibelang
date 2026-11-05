import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"
const fc = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("fast-check")
assert.equal(ts.version, "5.9.3")
const chapter = fs.readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
assert.ok(chapter.includes("Ordinary declarations use the native twin's relative specifiers;"))
fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.constantFrom("", ".ts", ".js"), fc.boolean(),
  (rewrite, nested, suffix, singleQuote) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inferred-declaration-twin-"))
    try {
      const quote = value => (singleQuote ? "'" : '"') + value + (singleQuote ? "'" : '"')
      const view = (nested ? "nested/" : "") + "view"
      const shared = {
        "main.ts": 'import { use } from "./bridge.vibe"; import { item } from "./banners"; export function run(flag: boolean) { use(1); return { now: flag ? item() : null }; }',
        "banners.ts": "import type { View } from " + quote("./" + view + suffix) + "; export declare function item(): View;",
        [view + ".ts"]: "export interface View { readonly id: string; }",
        "bridge.vibe": "export function use(value: number): number { return value; }",
      }
      const options = { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true,
        declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: rewrite, rootDir: ".", outDir: "out" }
      for (const side of ["native", "stock"]) {
        const root = path.join(dir, side)
        fs.mkdirSync(root, { recursive: true })
        fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}')
        for (const [name, source] of Object.entries(shared)) {
          const file = path.join(root, side === "stock" ? name.replace(".vibe", ".ts") : name)
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, side === "stock" ? source.replace("./bridge.vibe", "./bridge.ts") : source)
        }
        if (side === "stock") {
          const converted = ts.convertCompilerOptionsFromJson(options, root)
          assert.deepEqual(converted.errors, [])
          const files = Object.keys(shared).map(name => path.join(root, name.replace(".vibe", ".ts")))
          const program = ts.createProgram(files, converted.options)
          assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "ordinary stock twin compiles")
          assert.equal(program.emit().emitSkipped, false)
        } else {
          fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: Object.keys(shared), vibe: { effectGlobals: false, effectModules: false } }))
          const result = spawnSync(process.env.VIBELANG_BINARY, ["-p", root, "--pretty", "false"], { encoding: "utf8", timeout: 30000 })
          assert.ifError(result.error)
          assert.equal(result.status, 0, result.stdout + result.stderr)
        }
      }
      assert.equal(fs.readFileSync(path.join(dir, "native/out/main.d.ts"), "utf8"), fs.readFileSync(path.join(dir, "stock/out/main.d.ts"), "utf8"),
        "inferred declaration imports match the unmodified stock twin")
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }), { seed: 27195, numRuns: 12, examples: [[true, false, "", false], [false, true, ".ts", true], [true, true, ".js", false]] })
console.log("ok")
