// The platform split kept a module in TypeScript when its platform code read
// an export that is not a function with written types: an error class, a
// schema and the type of its name, an object. About 95 Smithers modules
// stayed TypeScript this way. The sibling now declares such an export and the
// module re-exports it, the same binding, so names, nominal identity, types
// and documentation are those the API identity gate compares; the sibling's
// declaration file ships beside the module's and joins no `exports` entry.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { compareApiIdentity } from "../../../../scripts/api-identity.mjs"
import { isPlatformModule, platformPath, splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-split-reexport.json", import.meta.url), "utf8"))

// The declaration files stock TypeScript emits for files, and its errors.
function emit(files, ambient) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-reexport-"))
  try {
    for (const [file, text] of Object.entries({ ...files, "ambient.d.ts": ambient })) {
      mkdirSync(join(root, dirname(file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, strict: true, noUnusedLocals: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true, outDir: join(root, ".out") }
    const program = ts.createProgram(Object.keys(files).concat("ambient.d.ts").map((f) => join(root, f)), options)
    const emitted = program.emit()
    const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    const out = {}
    for (const file of Object.keys(files)) {
      const name = file.replace(/\.ts$/, ".d.ts")
      try { out[name] = readFileSync(join(root, ".out", name), "utf8") } catch {}
    }
    return { errors, out }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// The API identity gate over the module's declarations before and after.
function sameApi(before, after, ambient) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-reexport-api-"))
  try {
    const dirs = [["before", before], ["after", after]].map(([side, files]) => {
      const dir = join(root, side)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "package.json"), '{"types":"m.d.ts"}')
      writeFileSync(join(dir, "ambient.d.ts"), ambient)
      for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text)
      return dir
    })
    return compareApiIdentity(ts, dirs[0], dirs[1], { compilerOptions: { lib: ["lib.es2022.d.ts"], types: [] } })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function assertReexportSplit(text, ambient, others = {}) {
  const before = emit({ ...others, "m.ts": text }, ambient)
  assert.deepEqual(before.errors, [], "the original compiles\n" + text)
  const split = splitPlatform(text, "m.ts", ts)
  assert.ok(split && !split.refused, split?.refused ?? "no split")
  const after = emit({ ...others, "m.ts": split.module, "m.platform.ts": split.platform }, ambient)
  assert.deepEqual(after.errors, [], split.module + "\n---\n" + split.platform)
  const declarations = (out) => Object.fromEntries(Object.entries(out).filter(([name]) => !name.startsWith("ambient")))
  const api = sameApi(declarations(before.out), declarations(after.out), ambient)
  assert.ok(api.comparisonComplete && api.identical, JSON.stringify(api, null, 2) + "\n" + split.module)
  for (const line of split.module.split("\n")) {
    const m = /^import (?!type )[^"]*"([^"]+)"/.exec(line)
    if (m) assert.ok(!isPlatformModule(m[1]), `the module still imports ${m[1]}`)
  }
  return split
}

// What the module does when loaded and called: each export's value, each
// function's result for the corpus probe, and whether an instance the module
// constructs is an instance of the class it exports.
async function behaviour(dir, files, probe) {
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(dir, name.replace(/\.ts$/, ".mjs")), js.replace(/"\.\/([\w.]+)\.ts"/g, '"./$1.mjs"'))
  }
  const m = await import(pathToFileURL(join(dir, "m.mjs")).href)
  return new Function("m", probe)(m)
}

test("smithers: a moved export that is not a function is re-exported from the sibling with the same API", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-reexport-run-"))
  try {
    for (const { name, text, reexported, probe } of corpus.modules) {
      const split = assertReexportSplit(text, corpus.ambient, corpus.others)
      assert.deepEqual(split.reexported.sort(), reexported.sort(), name)
      assert.match(split.module, /^export \{ [^}]+ \} from "\.\/m\.platform\.ts"$/m, name)
      const original = await behaviour(join(root, name, "o"), { ...corpus.others, "m.ts": text }, probe)
      const after = await behaviour(join(root, name, "s"), { ...corpus.others, "m.ts": split.module, "m.platform.ts": split.platform }, probe)
      assert.deepEqual(after, original, name)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a re-export the module would read before it is initialized keeps the refusal", () => {
  // The original throws ReferenceError at load: the array reads the class in its temporal dead zone.
  const early = 'import { sep } from "node:path"\nexport const known = [Refused]\nexport class Refused extends Error {}\nexport const check = (s: string): boolean => { if (s === sep) throw new Refused(); return true }\n'
  assert.match(splitPlatform(early, "src/m.ts", ts).refused, /export Refused would be initialized in m\.platform\.ts before a statement above it/)
  // An exported value whose type of the same name is private cannot be re-exported without exporting the type.
  const twin = 'import { sep } from "node:path"\nexport const Shape = { sep }\ntype Shape = typeof Shape\nexport const shape = (): Shape => Shape\n'
  assert.match(splitPlatform(twin, "src/m.ts", ts).refused ?? "", /the value Shape would move/)
  // A private value whose type is exported keeps the value private and re-exports the type as a type.
  const typeOnly = 'import { sep } from "node:path"\nconst Shape = { sep }\nexport type Shape = typeof Shape\nexport const shape = (): Shape => Shape\n'
  assert.match(splitPlatform(typeOnly, "src/m.ts", ts).module, /^export type \{ Shape \} from "\.\/m\.platform\.ts"$/m)
})

// Neighbourhood: a moved value of each kind, read or not by kept code, as a
// value, through `typeof` in a type, or by `instanceof`, beside a wrapped
// platform function. Each split compiles with declarations, the API identity
// gate finds the module's API identical, and the module behaves the same.
test("a re-exported value keeps the module's API and behaviour, or the split refuses", async () => {
  const ambient = 'declare module "node:path" { export const sep: string }\n'
  const values = {
    class: "export class Value extends Error { readonly tag = \"Value\" }\n",
    object: "export const Value = { label: \"v\", size: () => sep.length }\n",
    twin: "export const Value = { label: \"v\" as const }\nexport type Value = typeof Value\n",
    enum: "export enum Value { A = \"a\", B = \"b\" }\n",
  }
  const make = { class: "new Value()", object: "Value", twin: "Value", enum: "Value.A" }
  const readers = fc.constantFrom("none", "value", "type", "instance")
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-reexport-prop-"))
  let runs = 0, splits = 0
  try {
    await fc.assert(fc.asyncProperty(fc.constantFrom("class", "object", "twin", "enum"), readers, fc.boolean(), async (kind, reader, valueFirst) => {
      fc.pre(reader !== "instance" || kind === "class")
      const value = values[kind]
      const platform = `export const made = (): unknown => (sep.length > 0 ? ${make[kind]} : undefined)\n`
      const kept = reader === "value" ? `export const kept = (): unknown => ${make[kind]}\n`
        : reader === "type" ? (kind === "class" || kind === "enum" ? "export type Kept = Value\n" : "export type Kept = typeof Value\n")
        : reader === "instance" ? "export const isValue = (u: unknown): boolean => u instanceof Value\n" : ""
      const text = 'import { sep } from "node:path"\n' + (valueFirst ? value + platform : platform + value) + kept
      runs++
      const split = splitPlatform(text, "m.ts", ts)
      if (!split || split.refused) return
      splits++
      assertReexportSplit(text, ambient)
      const probe = reader === "instance" ? "return [m.isValue(m.made()), String(m.made() instanceof m.Value)]" : "return JSON.stringify(Object.keys(m).sort()) + String(typeof m.made())"
      const original = await behaviour(join(root, `o${runs}`), { "m.ts": text }, probe)
      const after = await behaviour(join(root, `s${runs}`), { "m.ts": split.module, "m.platform.ts": split.platform }, probe)
      assert.deepEqual(after, original, text)
    }), { numRuns: 24 })
  } finally { rmSync(root, { recursive: true, force: true }) }
  assert.ok(splits > runs / 2, `only ${splits} of ${runs} modules split`)
})
