import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { compareDeclarations } from "../../../.smithers/flows/migrate/lib/declarations.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const ts = require("typescript")
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/" + (process.platform === "win32" ? "vibelang.exe" : "vibelang"), import.meta.url))
const fixture = JSON.parse(readFileSync(new URL("./property-regressions/t3code-throw-helper-reexport.json", import.meta.url), "utf8"))
test("helper declaration checks retain the published declaration contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes("Declarations are exactly what idiomatic Effect TypeScript would declare."))
})

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "t3code-throw-helper-declarations-"))
  try {
    const helper = "export function " + input.name + "(" + input.parameter + ": string | undefined): string {\n" +
      "if (" + input.parameter + " === undefined) throw new Error(" + JSON.stringify(input.message) + ");\nreturn " + input.parameter + ";\n}\n"
    const size = "export function size(value: string): number { return value.length; }\n"
    const dirs = {}
    for (const side of ["before", "bare", "wrapped"]) {
      const directory = join(root, side), extension = side === "before" ? "ts" : "vibe"
      const put = (path, source) => { mkdirSync(dirname(join(directory, path)), { recursive: true }); writeFileSync(join(directory, path), source) }
      put("package.json", '{"type":"module"}')
      put("required.ts", helper)
      put("main." + extension, side === "before" ? helper + size : side === "bare" ? 'export { ' + input.name + ' } from "./required.ts";\n' + size : 'import { ' + input.name + ' as implementation } from "./required.ts";\n' +
        "export function " + input.name + "(" + input.parameter + ": string | undefined): string { return implementation(" + input.parameter + "); }\n" + size)
      put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
        strict: true, skipLibCheck: true, types: [], declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true,
        rootDir: ".", outDir: "out" }, files: ["main." + extension, "required.ts"] }))
      const compiled = spawnSync(native, ["--singleThreaded", "--pretty", "false", "-p", "tsconfig.json"], { cwd: directory, encoding: "utf8" })
      assert.ifError(compiled.error)
      assert.equal(compiled.signal, null)
      assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
      assert.equal(readFileSync(join(directory, "required.ts"), "utf8"), helper, "the throwing TypeScript body stays unchanged")
      dirs[side] = join(directory, "out")
    }
    // Independent stock TypeScript proves that both exported callable types
    // agree. That fact alone does not grant a declaration-byte waiver.
    const consumer = join(root, "consumer.ts")
    writeFileSync(consumer, 'import { ' + input.name + ' as a } from "./before/out/main.js";\n' +
      'import { ' + input.name + ' as b } from "./wrapped/out/main.js";\n' +
      "type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;\n" +
      "const forward: true = null as unknown as Equal<typeof a,typeof b>;\nconst backward: true = null as unknown as Equal<typeof b,typeof a>;\n")
    const program = ts.createProgram([consumer], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, types: [] })
    assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => d.code), [])
    for (const directory of Object.values(dirs)) assert.equal(compareDeclarations(ts, directory, directory).identical, true)
    const bare = compareDeclarations(ts, dirs.before, dirs.bare)
    assert.equal(bare.files, 2)
    assert.deepEqual(bare.added, [])
    assert.deepEqual(bare.removed, [])
    assert.equal(bare.identical, false, "bare reexports must not bypass the declaration gate")
    assert.deepEqual(bare.changed.map(row => row.file), ["main.d.ts"])
    const wrapped = compareDeclarations(ts, dirs.before, dirs.wrapped)
    assert.equal(wrapped.files, 2)
    assert.equal(wrapped.identical, true, JSON.stringify(wrapped))

  } finally { rmSync(root, { recursive: true, force: true }) }
}

test(fixture.key, () => check(fixture.input))
test("helper boundary identity varies exported names, parameter spellings and exception messages", () => {
  fc.assert(fc.property(fc.record({
    name: fc.constantFrom("required", "readRequired", "decodeRequired"),
    parameter: fc.constantFrom("value", "input"), message: fc.constantFrom("missing", "required", "empty input"),
  }), check), { seed: 114204, numRuns: 8, endOnFailure: true })
})
