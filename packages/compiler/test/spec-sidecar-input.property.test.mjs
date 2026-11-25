import assert from "node:assert/strict"
import test from "node:test"
import fc from "fast-check"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const spec = readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8")

// The vibelang compiler protects an explicitly listed declaration input
// (TS5055) and leaves it unwritten, exactly as stock tsc does, and writes it
// when include discovery drops it. Stock tsc is the oracle.
test("sidecar input protection follows native discovery, including no-write controls", () => {
 assert.ok(spec.includes("The required sidecar write is independent"))
 assert.ok(spec.includes("Listing both the source and its sidecar explicitly in "))
 fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.integer(), fc.constantFrom("alpha", "file space", "nested"), (explicit, noEmit, value, name) => {
  const dir = mkdtempSync(join(tmpdir(), "sidecar-input-"))
  try {
   const source = join(dir, name + ".ts"), declaration = join(dir, name + ".d.ts")
   const original = "export declare const n: string; // preserve\n"
   const reset = () => { writeFileSync(source, "export const n=" + value + ";"); writeFileSync(declaration, original) }
   const config = { compilerOptions: { declaration: true, noEmit, skipLibCheck: true, types: [] }, ...(explicit ? { files: [name + ".ts", name + ".d.ts"] } : { include: [name + ".ts", name + ".d.ts"] }) }
   const written = () => {
    const text = readFileSync(declaration, "utf8")
    if (explicit || noEmit) assert.equal(text, original)
    else assert.match(text, new RegExp("n = " + value + ";"))
   }
   reset()
   const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dir)
   assert.equal(parsed.fileNames.includes(declaration), explicit)
   const p = ts.createProgram(parsed.fileNames, parsed.options), out = p.emit()
   const stockCodes = [...ts.getPreEmitDiagnostics(p), ...out.diagnostics].map(d => d.code)
   assert.equal(stockCodes.includes(5055), explicit && !noEmit)
   written()
   reset()
   writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(config))
   const native = spawnSync(binary, ["-p", dir, "--pretty", "false"], { encoding: "utf8" })
   assert.ifError(native.error)
   const output = native.stdout + native.stderr
   assert.equal(/error TS5055:/.test(output), explicit && !noEmit, output)
   assert.equal(native.status === 0, !(explicit && !noEmit), output)
   written()
  } finally { rmSync(dir, { recursive: true, force: true }) }
 }), { seed: 259283, numRuns: 12 })
})
