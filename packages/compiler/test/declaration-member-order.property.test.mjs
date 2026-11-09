import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { createRequire } from "node:module"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const ts = createRequire(new URL("../../runtime/package.json", import.meta.url))("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-timeline-declaration-order.json", import.meta.url), "utf8"))

function witness({ discriminant, value, padding, readonly }, compareStock = false) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-declaration-order-"))
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    const subject = "export function choose(flag: boolean) { if (flag) return {" + discriminant + ': "taken" as const}; return {' + value + ': "ok"} }\n'
    const noise = "function noise(flag: boolean) {if(flag) return {" + discriminant + ': "noise"}' + (readonly ? " as const" : "") + '; return {other: 1}}\n'
    const file = join(root, "subject.ts")
    const fragment = text => text.slice(text.indexOf("export declare function choose"))
    const native = []
    const stock = []
    for (const warm of [false, true]) {
      writeFileSync(file, (warm ? "export const warm = noise(true);\n" : "") + "\n".repeat(padding) + subject + noise)
      const outDir = join(root, warm ? "warm" : "cold")
      const compilerOptions = { strict: true, skipLibCheck: true, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", types: [], declaration: true, emitDeclarationOnly: true, outDir }
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions, files: ["subject.ts"] }))
      const result = spawnSync(binary, ["-p", "tsconfig.json", "--singleThreaded", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 15000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      native.push(fragment(readFileSync(join(outDir, "subject.d.ts"), "utf8")))
      if (compareStock) {
        const options = ts.convertCompilerOptionsFromJson(compilerOptions, root).options
        const program = ts.createProgram([file], options)
        assert.equal(ts.getPreEmitDiagnostics(program).length, 0)
        let declaration
        const emitted = program.emit(undefined, (name, text) => { if (name.endsWith("subject.d.ts")) declaration = text })
        assert.equal(emitted.emitSkipped, false)
        assert.ok(declaration)
        stock.push(fragment(declaration))
      }
    }
    if (compareStock) assert.equal(stock[1], stock[0], "stock TypeScript keeps unrelated inference out of the declaration")
    assert.equal(native[1], native[0], "unrelated inferred unions must not change synthetic member origins")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("unrelated inferred unions cannot reorder a function's declaration members", () => witness(corpus, true))
// Compare full native declarations across independent contexts. The minimized
// witness also uses stock TypeScript; TypeScript 5.9's readonly-cache defect is not
// an oracle for the generated readonly neighbours.
test("declaration member origins remain stable across names, trivia and readonly neighbours", () => {
  fc.assert(fc.property(fc.record({
    discriminant: fc.constantFrom("outcome", "status", "kind"),
    value: fc.constantFrom("summary", "spans", "result"),
    padding: fc.integer({ min: 0, max: 4 }), readonly: fc.boolean()
  }), witness), { seed: 20261109, numRuns: 20 })
})
