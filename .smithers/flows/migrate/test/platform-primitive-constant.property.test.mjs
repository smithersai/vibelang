// The platform split moved the declarations its platform code reads into the
// sibling, and refused the module when one was an export that is not a
// function with written types. Smithers kept 22 modules in TypeScript only
// because their platform code read an exported primitive constant such as
// `export const MAX_QUEUED_FRAMES = 64`. A primitive has no identity, so the
// module now keeps the export and the sibling a private copy. The copy is
// initialized before the module body runs; where the original could read the
// constant in its temporal dead zone, the split still refuses.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { platformPath, splitPlatform } from "../lib/platform.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-split-primitive-constant.json", import.meta.url), "utf8"))

// Stock TypeScript over the files: the errors and each declaration file. The
// module's text stands at <file>.vibe.ts, where the sibling's import resolves.
function check(files, ambient) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-constant-"))
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

function assertSplitCompiles(file, text, ambient, before = check({ [file]: text }, ambient)) {
  assert.deepEqual(before.errors, [], "the original compiles")
  const split = splitPlatform(text, file, ts)
  assert.ok(split, "the module imports a builtin")
  if (split.refused) return split
  const after = check({ [file.replace(/\.ts$/, ".vibe.ts")]: split.module, [platformPath(file)]: split.platform }, ambient)
  assert.deepEqual(after.errors, [], split.module + "\n---\n" + split.platform)
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.ts$/, "")
  assert.equal(after.out[`${name}.vibe.d.ts`], before.out[`${name}.d.ts`], "the module's declarations are unchanged")
  return split
}

const declares = (text, name) => new RegExp(`^export const ${name} = `, "m").test(text)
const copies = (text, name) => new RegExp(`^const ${name} = `, "m").test(text)

test("smithers: an exported primitive const the platform code reads stays exported, and the sibling copies it", () => {
  for (const { file, text, copied, wrapped } of corpus.modules) {
    const split = assertSplitCompiles(file, text, corpus.ambient)
    assert.ok(!split.refused, `${file}: ${split.refused}`)
    assert.deepEqual(split.wrapped, wrapped, file)
    for (const name of copied) {
      assert.ok(!split.moved.includes(name), `${file}: ${name} moved`)
      assert.ok(copies(split.platform, name), `${file}: the sibling copies ${name}\n${split.platform}`)
      assert.ok(!declares(split.platform, name), `${file}: the sibling exports ${name}`)
    }
    for (const name of copied.filter((n) => declares(text, n))) assert.ok(declares(split.module, name), `${file}: the module keeps export ${name}`)
  }
})

test("a primitive const read in its temporal dead zone keeps the refusal", () => {
  // The original throws ReferenceError at load: `early` runs answer() before STATUS exists.
  const tdz = 'import { sep } from "node:path"\nexport const early = answer()\nexport const STATUS = 499\nexport function answer(): number { return sep.length + STATUS }\n'
  assert.match(splitPlatform(tdz, "src/source.ts", ts).refused, /export STATUS uses platform code/)
  // A callback passed to a call may run at load, so it counts as a read there.
  const callback = 'import { sep } from "node:path"\nexport const checked = [1].map((n) => answer() + n)\nexport const STATUS = 499\nexport function answer(): number { return sep.length + STATUS }\n'
  assert.match(splitPlatform(callback, "src/source.ts", ts).refused, /export STATUS uses platform code/)
  // So does a kept function the statement calls that reaches the moved code.
  const indirect = 'import { sep } from "node:path"\nfunction through(): number { return answer() }\nexport const early = through()\nexport const STATUS = 499\nexport function answer(): number { return sep.length + STATUS }\n'
  assert.match(splitPlatform(indirect, "src/source.ts", ts).refused, /export STATUS uses platform code/)
  // The same call below the const reads it after it is initialized.
  const after = 'import { sep } from "node:path"\nexport const STATUS = 499\nexport const late = answer()\nexport function answer(): number { return sep.length + STATUS }\n'
  assert.ok(!splitPlatform(after, "src/source.ts", ts).refused)
  // A const whose value is not a primitive computed from literals is not copied: it moves and is re-exported.
  for (const value of ["[64]", "{ limit: 64 }", "Number(\"64\")", "limit()", "other.length"]) {
    const text = `import { sep } from "node:path"\nexport const LIMIT = ${value}\nexport function answer(): number { return sep.length + Number(LIMIT) }\n`
    const split = splitPlatform(text, "src/source.ts", ts)
    assert.deepEqual(split.reexported, ["LIMIT"], value)
    assert.match(split.platform, /^export const LIMIT = /m, value)
  }
})

// What a module does when it loads: the error it throws, or each export's
// value, calling each function export and each `run` it holds.
async function load(dir, files, entry) {
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(dir, name.replace(/\.ts$/, ".mjs")), js.replace(/"\.\/([\w.]+)\.ts"/g, '"./$1.mjs"'))
  }
  let ns
  try { ns = await import(pathToFileURL(join(dir, entry.replace(/\.ts$/, ".mjs"))).href) } catch (e) { return { load: e.name } }
  const seen = {}
  for (const key of Object.keys(ns).sort()) {
    const v = ns[key]
    const run = typeof v === "function" ? v : v && typeof v.run === "function" ? v.run : null
    try { seen[key] = run ? ["called", run()] : ["value", JSON.stringify(v)] } catch (e) { seen[key] = ["threw", e.name] }
  }
  return seen
}

// Neighbourhood: one or two primitive consts, a platform function that reads
// them, and kept statements that call it, at load, later, through a stored
// function, through a callback, or through another kept function, in any
// order. A split module behaves as the original did when it loads: the same
// error, or the same values. It compiles with identical declarations.
test("a split with copied constants loads and behaves as the original, or refuses", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-constant-run-"))
  const ambient = 'declare module "node:path" { export const sep: string }\n'
  const kept = fc.constantFrom(
    "export const e{k} = answer()",
    "export const f{k} = (): number => answer()",
    "export const o{k} = { run: (): number => answer() }",
    "export const m{k} = [0].map(() => answer())[0]",
    "export function g{k}(): number { return answer() }",
    "function h{k}(): number { return answer() }\nexport const i{k} = h{k}()",
    "export const v{k} = LIMIT + 1",
    "export const w{k} = `${LIMIT}`")
  const value = fc.constantFrom("64", '"ps"', "4 * 1024", "-1", "`v${1}`", "true ? 2 : 3", "1 as const")
  let splits = 0, runs = 0
  try {
    await fc.assert(fc.asyncProperty(fc.array(kept, { maxLength: 4 }), value, fc.boolean(), fc.nat(5), fc.nat(5), async (uses, literal, chained, at, answerAt) => {
      const consts = chained ? [`const BASE = ${literal}`, "export const LIMIT = BASE"] : [`export const LIMIT = ${literal}`]
      const answer = "export function answer(): number { return sep.length + String(LIMIT).length }"
      const body = uses.map((u, k) => u.replaceAll("{k}", String(k)))
      body.splice(Math.min(at, body.length), 0, ...consts)
      body.splice(Math.min(answerAt, body.length), 0, answer)
      const text = 'import { sep } from "node:path"\n' + body.join("\n") + "\n"
      // TypeScript rejects a direct read above the declaration (TS2448); a read through a call it admits.
      const before = check({ "m.ts": text }, ambient)
      fc.pre(before.errors.length === 0)
      const split = assertSplitCompiles("m.ts", text, ambient, before)
      runs++
      if (split.refused) return
      splits++
      const original = await load(join(root, `o${runs}`), { "m.ts": text }, "m.ts")
      const after = await load(join(root, `s${runs}`), { "m.ts": split.module, "m.platform.ts": split.platform }, "m.ts")
      assert.deepEqual(after, original, text + "\n---\n" + split.module + "\n---\n" + split.platform)
    }), { numRuns: 60 })
  } finally { rmSync(root, { recursive: true, force: true }) }
  assert.ok(splits > runs / 4, `only ${splits} of ${runs} modules split`)
})
