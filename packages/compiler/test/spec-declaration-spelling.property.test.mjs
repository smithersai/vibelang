// VIP-27 native declaration emit retains written TypeScript specifiers: docs/design/vips/0027-declaration-output.md#c7e3caa9afb8fa5d
// VIP-34 native declaration emit retains written TypeScript specifiers: docs/design/vips/0034-compiler-and-tooling.md#0b9f771c5bbc9e2a
import assert from "node:assert/strict"
import test from "node:test"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const spec = readFileSync(join(repo, "docs/design/src/001-functions.md"), "utf8")

// The vibelang compiler's declaration for a .ts or .vibe importer keeps a
// written `.ts` specifier's spelling and quote, and its .ts output equals
// stock tsc's.
test("native declarations preserve unrelated written TypeScript specifiers", () => {
 assert.ok(spec.includes("written `./user.js`, `./App.jsx`, `./user` and native `./plain.ts` keep their spelling."))
 for (const name of ["helper", "file space"]) for (const quote of ["'", '"']) for (const extension of ["ts", "vibe"]) {
  const dir = mkdtempSync(join(tmpdir(), "declaration-spelling-"))
  try {
   const specifier = quote + "./" + name + ".ts" + quote
   writeFileSync(join(dir, "main." + extension), "export type { Value } from " + specifier + ";")
   writeFileSync(join(dir, name + ".ts"), "export interface Value { n: number }")
   const native = spawnSync(binary, ["--declaration", "--emitDeclarationOnly", "--skipLibCheck", "--types", "", "--allowImportingTsExtensions", "--outDir", join(dir, "native"), join(dir, "main." + extension)], { encoding: "utf8" })
   assert.equal(native.status, 0, native.stdout + native.stderr)
   const declared = readFileSync(join(dir, "native/main.d.ts"), "utf8")
   assert.ok(declared.includes(specifier), declared)
   if (extension === "ts") {
    const p = ts.createProgram([join(dir, "main.ts")], { declaration: true, emitDeclarationOnly: true, skipLibCheck: true, types: [], allowImportingTsExtensions: true, outDir: join(dir, "stock") })
    assert.deepEqual(p.emit().diagnostics, [])
    assert.equal(declared, readFileSync(join(dir, "stock/main.d.ts"), "utf8"))
   }
  } finally { rmSync(dir, { recursive: true, force: true }) }
 }
})
