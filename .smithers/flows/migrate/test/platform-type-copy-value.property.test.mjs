// The platform split refused a module when the sibling had to copy a private
// type that reads a value of the module, `type Item = typeof Issue.Type`: the
// sibling never imports its module, so the copy had no value to read. Two
// Smithers modules stayed TypeScript this way. Moved code already takes the
// values it reads into the sibling; a private type copy now does the same, and
// the module imports the value back or re-exports it.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { compareApiIdentity } from "../../../../scripts/api-identity.mjs"
import { splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-split-type-copy-value.json", import.meta.url), "utf8"))

// The declaration files stock TypeScript emits for files, and its errors.
function emit(files, ambient) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-type-copy-"))
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
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-type-copy-api-"))
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

// What the module returns for probe when loaded.
async function behaviour(dir, files, probe) {
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(dir, name.replace(/\.ts$/, ".mjs")), js.replace(/"\.\/([\w.]+)\.ts"/g, '"./$1.mjs"'))
  }
  const m = await import(pathToFileURL(join(dir, "m.mjs")).href)
  return new Function("m", probe)(m)
}

// The split compiles, keeps the module's API, never imports the module from
// the sibling, and loads the same.
async function assertSplit(root, label, text, ambient, others, probe) {
  const before = emit({ ...others, "m.ts": text }, ambient)
  assert.deepEqual(before.errors, [], "the original compiles\n" + text)
  const split = splitPlatform(text, "m.ts", ts)
  assert.ok(split && !split.refused, `${label}: ${split?.refused ?? "no split"}\n${text}`)
  assert.doesNotMatch(split.platform, /from "\.\/m\.ts"/, split.platform)
  const after = emit({ ...others, "m.ts": split.module, "m.platform.ts": split.platform }, ambient)
  assert.deepEqual(after.errors, [], text + "\n----\n" + split.module + "\n----\n" + split.platform)
  const declarations = (out) => Object.fromEntries(Object.entries(out).filter(([name]) => !name.startsWith("ambient")))
  const api = sameApi(declarations(before.out), declarations(after.out), ambient)
  assert.ok(api.comparisonComplete && api.identical, JSON.stringify(api, null, 2) + "\n" + split.module)
  if (probe) {
    const original = await behaviour(join(root, label, "o"), { ...others, "m.ts": text }, probe)
    const moved = await behaviour(join(root, label, "s"), { ...others, "m.ts": split.module, "m.platform.ts": split.platform }, probe)
    assert.deepEqual(moved, original, label)
  }
  return split
}

test("smithers: a private type the sibling copies takes the value it reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-type-copy-run-"))
  try {
    for (const { name, text, value, probe } of corpus.modules) {
      const split = await assertSplit(root, name.replace(/\W+/g, "-"), text, corpus.ambient, corpus.others, probe)
      // The schema value now lives in the sibling, once.
      assert.match(split.platform, new RegExp(`^const ${value} = `, "m"), split.platform)
      assert.doesNotMatch(split.module, new RegExp(`^(?:export )?const ${value} = literals`, "m"), split.module)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// Neighbourhood: a private type the platform code reads, an alias or an
// interface, reading a module value through `typeof` directly or through
// another private type; the value private or exported, a schema-like object or
// a class, read or not by kept code, with or without a same-name type. Each
// split compiles, keeps the API identity gate's verdict, never imports the
// module from the sibling and loads the same; only an exported value whose
// same-name type is private stays refused.
test("a private type copy that reads a value moves the value, keeping API and behaviour", async () => {
  const ambient = 'declare module "node:fs" { export function readFileSync(path: string, encoding: "utf8"): string }\n'
  const shape = fc.record({
    kind: fc.constantFrom("object", "class"),
    valueExported: fc.boolean(),
    twin: fc.boolean(),
    interface: fc.boolean(),
    indirect: fc.boolean(),
    keptRead: fc.boolean(),
  })
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-type-copy-prop-"))
  let split = 0, refused = 0, runs = 0
  try {
    await fc.assert(fc.asyncProperty(shape, async (s) => {
      runs++
      const lines = ['import { readFileSync } from "node:fs"']
      const exp = s.valueExported ? "export " : ""
      lines.push(s.kind === "object" ? `${exp}const V = { label: "v" as const, size: 2 }` : `${exp}class V { readonly label = "v" as const }`)
      const valueType = s.kind === "object" ? "typeof V" : "InstanceType<typeof V>"
      const typeName = s.twin && s.kind === "object" ? "V" : "Shape"
      if (typeName === "V" || !s.indirect) lines.push(`type ${typeName} = ${valueType}`)
      else lines.push(`type Inner = ${valueType}`, `type ${typeName} = { readonly inner: Inner }`)
      lines.push(s.interface ? `interface Row { readonly id: string; readonly shape: ${typeName} }` : `type Row = { readonly id: string; readonly shape: ${typeName} }`)
      lines.push(`export const rows = (path: string): ReadonlyArray<Row> => { const none: ReadonlyArray<Row> = []; return readFileSync(path, "utf8") === "" ? none : none }`)
      if (s.keptRead || !s.valueExported) lines.push(s.kind === "object" ? "export const label = (): string => V.label" : "export const label = (): string => new V().label")
      const text = lines.join("\n") + "\n"
      const result = splitPlatform(text, "m.ts", ts)
      // An exported value whose same-name type is private stays, as before.
      if (s.valueExported && typeName === "V") {
        assert.match(result?.refused ?? "", /the value V would move to m\.platform\.ts but the type V stays/, text)
        refused++
        return
      }
      const probe = "return JSON.stringify([Object.keys(m).sort(), typeof m.label === \"function\" ? m.label() : null])"
      await assertSplit(root, `p${runs}`, text, ambient, {}, probe)
      split++
    }), { seed: 2026110719, numRuns: 48 })
  } finally { rmSync(root, { recursive: true, force: true }) }
  assert.ok(split > 25 && refused > 3, `split ${split}, refused ${refused}`)
})
