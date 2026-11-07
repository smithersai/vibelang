// The platform split copies a private type the moved code reads into the
// sibling, and used to keep the module's copy too. When only the moved code
// read it, nothing in the module did, and the module failed TS6196 under
// noUnusedLocals (opencode app runtime/persistence/storage and
// runtime/plugin/host). The module now drops such a type, and a private type
// only a dropped type read; a type the module still reads stays.
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
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-platform-split-unused-private-type.json", import.meta.url), "utf8"))

// Stock TypeScript over the files under noUnusedLocals: the errors and each
// declaration file. The module's text stands at <file>.vibe.ts, where the
// sibling's import resolves.
function check(files, ambient) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-unused-type-"))
  try {
    for (const [file, text] of Object.entries({ ...files, "ambient.d.ts": ambient })) {
      mkdirSync(join(root, dirname(file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, noUnusedLocals: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true, outDir: join(root, ".out") }
    const program = ts.createProgram(Object.keys(files).concat("ambient.d.ts").map((f) => join(root, f)), options)
    const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    const out = {}
    program.emit(undefined, (name, text) => { out[name.slice(name.lastIndexOf("/") + 1)] = text })
    return { errors, out }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function assertSplitCompiles(file, text, ambient) {
  const before = check({ [file]: text }, ambient)
  assert.deepEqual(before.errors, [], "the original compiles")
  const split = splitPlatform(text, file, ts)
  assert.ok(split && !split.refused, `${file}: ${split?.refused}`)
  const after = check({ [file.replace(/\.ts$/, ".vibe.ts")]: split.module, [platformPath(file)]: split.platform }, ambient)
  assert.deepEqual(after.errors, [], split.module + "\n---\n" + split.platform)
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.ts$/, "")
  assert.equal(after.out[`${name}.vibe.d.ts`], before.out[`${name}.d.ts`], "the module's declarations are unchanged")
  return split
}

const declaresType = (text, name) => new RegExp(`^(?:export )?(?:type|interface) ${name}\\b`, "m").test(text)

test("opencode: a private type only the moved code read leaves the module", () => {
  for (const { file, text, dropped, kept } of corpus.modules) {
    const split = assertSplitCompiles(file, text, corpus.ambient)
    for (const name of dropped) {
      assert.ok(!declaresType(split.module, name), `${file}: the module still declares ${name}\n${split.module}`)
      assert.ok(declaresType(split.platform, name), `${file}: the sibling lost ${name}\n${split.platform}`)
    }
    for (const name of kept) assert.ok(declaresType(split.module, name), `${file}: the module dropped ${name}\n${split.module}`)
  }
})

test("a private type the module still reads stays, wherever it reads it", () => {
  // A wrapper signature, a kept function, a kept type, and an exported type.
  for (const [reader, keptName] of [
    ["export function load(path: string): Entry { return read(path) }", "Entry"],
    ["export function size(entry: Entry): number { return entry.value.length }\nexport function load(path: string): string { return read(path).value }", "Entry"],
    ["export type Entries = readonly Entry[]\nexport function load(path: string): string { return read(path).value }", "Entry"],
  ]) {
    const text = `import { readFileSync } from "node:fs"\ntype Entry = { value: string }\nfunction read(path: string): Entry { return { value: readFileSync(path, "utf8") } }\n${reader}\n`
    const split = assertSplitCompiles("src/a.ts", text, corpus.ambient)
    assert.ok(declaresType(split.module, keptName), split.module)
  }
})

test("split modules compile under noUnusedLocals for each way a private type is read", () => {
  const readers = fc.constantFrom("moved", "kept", "wrapper", "type", "none")
  fc.assert(fc.property(fc.array(readers, { minLength: 1, maxLength: 4 }), fc.boolean(), (uses, chained) => {
    const lines = [`import { readFileSync } from "node:fs"`]
    const exported = []
    uses.forEach((use, i) => {
      if (use === "none") return
      const t = `T${i}`
      if (chained) lines.push(`type ${t}Inner = { value: string }`, `type ${t} = { inner: ${t}Inner }`)
      else lines.push(`type ${t} = { inner: { value: string } }`)
      if (use === "moved") lines.push(`export function load${i}(path: string): string { const t: ${t} = { inner: { value: readFileSync(path, "utf8") } }; return t.inner.value }`)
      if (use === "kept") lines.push(`export function load${i}(path: string): string { return readFileSync(path, "utf8") }`, `export function size${i}(t: ${t}): number { return t.inner.value.length }`)
      if (use === "wrapper") lines.push(`export function load${i}(path: string): ${t} { return { inner: { value: readFileSync(path, "utf8") } } }`)
      if (use === "type") lines.push(`export function load${i}(path: string): string { const t: ${t} = { inner: { value: readFileSync(path, "utf8") } }; return t.inner.value }`, `export type Pair${i} = [${t}, ${t}]`)
      exported.push(i)
    })
    if (!exported.length) return
    assertSplitCompiles("src/a.ts", lines.join("\n") + "\n", corpus.ambient)
  }), { numRuns: 60 })
})
