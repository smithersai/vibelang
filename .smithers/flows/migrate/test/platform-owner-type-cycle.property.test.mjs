// A sibling split must not add an import edge back to its module. The moved
// code read an exported interface, and the sibling imported it with
// `import type` from the module, which imports the sibling as a value: a cycle
// the original single module never had (t3code mobile use-vcs-action-state and
// queued-run-edit; its unchanged dependency-graph test rejects both). The
// sibling now copies an exported type as it already copies a private one, the
// same type structurally, whenever the copy reads no value of the module.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { platformPath, splitPlatform } from "../lib/platform.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-platform-sibling-owner-type-cycle.json", import.meta.url), "utf8"))

// Stock TypeScript over the files: the errors and each emitted declaration.
function check(files, ambient) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-cycle-"))
  try {
    for (const [file, text] of Object.entries({ ...files, "ambient.d.ts": ambient })) {
      mkdirSync(join(root, dirname(file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true, outDir: join(root, ".out") }
    const program = ts.createProgram(Object.keys(files).concat("ambient.d.ts").map((f) => join(root, f)), options)
    const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    const out = {}
    program.emit(undefined, (name, text) => { out[name.slice(name.lastIndexOf("/") + 1)] = text })
    return { errors, out }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// The specifiers the sibling's import declarations name.
function importsOf(text) {
  const source = ts.createSourceFile("s.ts", text, ts.ScriptTarget.Latest, true)
  return source.statements.filter((s) => ts.isImportDeclaration(s)).map((s) => s.moduleSpecifier.text)
}

function split(file, text, globals, ambient) {
  const before = check({ [file]: text }, ambient)
  assert.deepEqual(before.errors, [], "the original compiles\n" + text)
  const result = splitPlatform(text, file, ts, { globals })
  assert.ok(result && !result.refused, (result?.refused ?? "no split") + "\n" + text)
  const after = check({ [file]: result.module, [platformPath(file)]: result.platform }, ambient)
  assert.deepEqual(after.errors, [], text + "\n----\n" + result.module + "\n----\n" + result.platform)
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.ts$/, "")
  assert.equal(after.out[`${name}.d.ts`], before.out[`${name}.d.ts`], "the module's declarations are unchanged\n" + result.module)
  return { ...result, owner: "./" + file.slice(file.lastIndexOf("/") + 1) }
}

for (const c of corpus.cases) {
  test(`t3code mobile ${c.file}: the sibling copies the exported type and never imports its module`, () => {
    const result = split(c.file, c.text, c.globals, corpus.ambient)
    assert.ok(!importsOf(result.platform).includes(result.owner), result.platform)
    // The module keeps the type it exports; the sibling's copy is private.
    assert.match(result.module, /export interface /)
    assert.doesNotMatch(result.platform, /export interface /)
  })
}

// Neighbourhood: a chain of exported and private types, interfaces or
// aliases, generic or not, each reading the one before it, an imported type,
// or a kept value through `typeof`. The platform code reads one; kept code
// reads one. Walking the chain from the type the platform code reads: an
// exported type whose chain reads no kept value is copied; an exported type
// whose chain does is imported, as before; a private type that reads the kept
// value itself is copied and the value moves to the sibling, which the module
// re-exports. Every split compiles, the module's declarations are identical
// or, when the value moves, export the same names, and the sibling imports its
// module exactly when the walk reaches an imported type.
test("the sibling imports its module only for an exported type that reads a kept value", () => {
  const ambient = 'declare var window: { readonly n?: number }\ndeclare module "lib" { export type Id = string & { readonly Id: unique symbol } }\n'
  const shape = fc.record({
    exported: fc.boolean(),
    alias: fc.boolean(),
    generic: fc.boolean(),
    reads: fc.constantFrom("none", "prev", "import", "kept")
  })
  let copied = 0, imported = 0, moved = 0
  fc.assert(fc.property(fc.array(shape, { minLength: 1, maxLength: 4 }), fc.nat(3), fc.nat(3), (types, platformRead, keptRead) => {
    const n = types.length
    const ref = (i) => `T${i}${types[i].generic ? "<string>" : ""}`
    const readsPrev = (i) => types[i].reads === "prev" && i > 0
    const lines = ['import type { Id } from "lib"', "export const keptValue = { k: 1 }"]
    types.forEach((t, i) => {
      const field = readsPrev(i) ? ref(i - 1) : t.reads === "import" ? "Id" : t.reads === "kept" ? "typeof keptValue" : "number"
      const members = `readonly f${i}: ${field}; readonly g${i}: ${t.generic ? "A" : "string"}`
      const params = t.generic ? "<A>" : ""
      lines.push(`${t.exported ? "export " : ""}${t.alias ? `type T${i}${params} = { ${members} }` : `interface T${i}${params} { ${members} }`}`)
    })
    const p = platformRead % n, k = keptRead % n
    lines.push(`function host(x: ${ref(p)}): ${ref(p)} {\n  return typeof window === "undefined" ? x : x\n}`)
    lines.push(`export function read(x: ${ref(p)}): ${ref(p)} {\n  return host(x)\n}`)
    lines.push(`export const kept = (x: ${ref(k)}): number => keptValue.k + (x ? 0 : 1)`)
    const text = lines.join("\n") + "\n"
    const chainReadsKept = (i) => types[i].reads === "kept" || (readsPrev(i) && chainReadsKept(i - 1))
    let expected = "copy"
    for (let i = p; ; i--) {
      if (types[i].exported && chainReadsKept(i)) { expected = "import"; break }
      if (!types[i].exported && types[i].reads === "kept") { expected = "move"; break }
      if (!readsPrev(i)) break
    }
    if (expected === "move") {
      const before = check({ "src/m.ts": text }, ambient)
      const result = splitPlatform(text, "src/m.ts", ts, { globals: ["window"] })
      assert.ok(result && !result.refused, (result?.refused ?? "no split") + "\n" + text)
      const after = check({ "src/m.ts": result.module, "src/m.platform.ts": result.platform }, ambient)
      assert.deepEqual(after.errors, [], text + "\n----\n" + result.module + "\n----\n" + result.platform)
      assert.ok(!importsOf(result.platform).includes("./m.ts"), result.platform)
      assert.match(result.module, /^export \{ keptValue \} from "\.\/m\.platform\.ts"$/m, result.module)
      assert.match(after.out["m.platform.d.ts"], /declare const keptValue: \{\s+k: number;\s+\};/, after.out["m.platform.d.ts"])
      const exportsOf = (out) => [...out.matchAll(/^export (?:declare )?(?:const|function|type|interface) (\w+)|^export \{ (\w+) \}/gm)].map((m) => m[1] ?? m[2]).sort()
      assert.deepEqual(exportsOf(after.out["m.d.ts"]), exportsOf(before.out["m.d.ts"]), after.out["m.d.ts"] + "\n---\n" + before.out["m.d.ts"])
      moved++
      return
    }
    const result = split("src/m.ts", text, ["window"], ambient)
    const imports = importsOf(result.platform).includes(result.owner)
    assert.equal(imports, expected === "import", text + "\n----\n" + result.platform)
    expected === "import" ? imported++ : copied++
  }), { seed: 2026110405, numRuns: 120 })
  assert.ok(copied > 20 && imported > 10 && moved > 5, `copied ${copied}, imported ${imported}, moved ${moved}`)
})
