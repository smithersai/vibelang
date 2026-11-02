import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const ts = require("typescript")
const native = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../native/vibelang", import.meta.url))
const tick = String.fromCharCode(96)
const quote = tick + "allowArbitraryExtensions" + tick + " resolves it, so plain " + tick + "tsc" + tick + " and TypeDoc understand imports of " + tick + ".vibe" + tick + " files."
const fixture = JSON.parse(readFileSync(new URL("./property-regressions/r14-sidecar-style-scope.json", import.meta.url), "utf8"))
test("source-adjacent declaration references keep stock sidecar resolution", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(quote))
})

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "sidecar-style-scope-"))
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
    mkdirSync(join(root, "src"))
    const specifier = "./" + input.name + ".vibe"
    const quoted = input.quote + specifier + input.quote
    const forms = {
      import: "import type { B } from " + quoted + ";\nexport type A = B;\n",
      reexport: "export type { B as A } from " + quoted + ";\n",
      importType: "export type A = import(" + quoted + ").B;\n",
    }
    writeFileSync(join(root, "src", "a.vibe"), forms[input.form])
    writeFileSync(join(root, "src", input.name + ".vibe"), 'export type B = { readonly tag: "ok" };\n')
    const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      types: [], declaration: true, emitDeclarationOnly: true, rootDir: "src", outDir: "out",
      allowImportingTsExtensions: true, skipLibCheck: true }
    for (const style of [".js", "extensionless", ".ts"]) {
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: ["src/a.vibe", "src/" + input.name + ".vibe"],
        vibelang: { declarationImportStyle: style } }))
      const result = spawnSync(native, ["-p", "tsconfig.json"], { cwd: root, encoding: "utf8", timeout: 30000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const sidecar = readFileSync(join(root, "src", "a.d.vibe.ts"), "utf8")
      assert.ok(sidecar.includes(quoted), "detail263: " + style + " must retain the source sidecar reference: " + sidecar)
      const ending = style === "extensionless" ? "" : style
      const declaration = readFileSync(join(root, "out", "a.d.ts"), "utf8")
      assert.ok(declaration.includes(input.quote + "./" + input.name + ending + input.quote), "the package declaration still uses its selected style: " + declaration)
      const stock = join(root, "stock")
      mkdirSync(stock, { recursive: true })
      writeFileSync(join(stock, "a.d.vibe.ts"), sidecar)
      writeFileSync(join(stock, input.name + ".d.vibe.ts"), readFileSync(join(root, "src", input.name + ".d.vibe.ts"), "utf8"))
      const consumer = join(stock, "consumer.ts")
      const diagnostics = source => {
        writeFileSync(consumer, source)
        const program = ts.createProgram([consumer], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, noEmit: true,
          allowArbitraryExtensions: true, types: [], skipLibCheck: false })
        return ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => d.code)
      }
      const prefix = 'import type { A } from "./a.vibe";\n'
      assert.deepEqual(diagnostics(prefix + 'export const value: A = { tag: "ok" };\n'), [], "plain TypeScript consumes only the emitted sidecars")
      assert.deepEqual(diagnostics(prefix + 'export const value: A = { tag: "wrong" };\n'), [2322], "the sidecar carries its actual field type")
      // Prove that the observed stock checker rejects changing a source-side
      // reference to any of the package-style spellings in this layout.
      for (const wrong of [".js", ".ts", ""]) {
        writeFileSync(join(stock, "a.d.vibe.ts"), sidecar.replace(specifier, "./" + input.name + wrong))
        const errors = diagnostics(prefix + 'export const value: A = { tag: "ok" };\n')
        assert.ok(errors.some(code => [2307, 2834, 2835].includes(code)), JSON.stringify({ style, wrong, errors }))
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
test("r14-astra-1: package declaration spelling leaves source sidecars usable", () => check(fixture.input))
test("sidecar scope spans styles, quote choices, reexports and import types", () => {
  fc.assert(fc.property(fc.record({
    name: fc.constantFrom("b", "other-type", "model.shared"),
    quote: fc.constantFrom('"', "'"),
    form: fc.constantFrom("import", "reexport", "importType"),
  }), check), { seed: 14263, numRuns: 8, endOnFailure: true })
})
