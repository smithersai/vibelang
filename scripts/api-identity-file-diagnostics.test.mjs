import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { fileDiagnosticKeys } from "./api-identity-diagnostics-cache.mjs"
import { SpecPath } from "./testing/spec-path.mjs"

const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const stock = loadTypeScript()
// Counts programs and which source files a checker was asked about.
function observed() {
  const counts = { programs: 0, checked: new Map() }
  const ts = {
    ...stock,
    createProgram(...args) {
      const program = stock.createProgram(...args)
      counts.programs++
      const semantic = program.getSemanticDiagnostics
      program.getSemanticDiagnostics = source => {
        counts.checked.set(source.fileName, (counts.checked.get(source.fileName) ?? 0) + 1)
        return semantic.call(program, source)
      }
      return program
    },
  }
  return { ts, counts }
}
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const options = { compilerOptions: { lib: ["lib.esnext.d.ts"], types: [] }, entryBatchSize: 2, diagnosticBatchSize: 1 }

// entries of one package, each importing a shared module.
function fixture(t, { shared = "export interface Shared { value: string }\n", extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "identity-file-diagnostics-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const before = join(root, "before"), after = join(root, "after")
  for (const dir of [before, after]) {
    const exports = {}
    for (let index = 0; index < 8; index++) {
      exports["./e" + index] = { types: `./e${index}.d.ts` }
      put(join(dir, `e${index}.d.ts`), `import type { Shared } from "./shared.js";\nexport declare const value${index}: Shared;\n`)
    }
    put(join(dir, "shared.d.ts"), shared)
    put(join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", type: "module", exports }))
    for (const [file, text] of Object.entries(extra)) put(join(dir, file), text)
  }
  return { before, after }
}
function same(before, after, comparison = options) {
  const on = observed(), off = observed()
  const reused = compareApiIdentity(on.ts, before, after, comparison)
  const fresh = compareApiIdentity(off.ts, before, after, { ...comparison, identityReuse: false })
  assert.deepEqual(reused, fresh, "reuse must preserve the complete comparison")
  return { result: reused, on: on.counts, off: off.counts }
}

test("file diagnostics reuse quotes strict published API identity", () => {
  const quote = "the same exported names, each export's type identical to `tsc`'s in both directions (a type-level check)"
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(quote))
})

test("a module reached by every entry group is checked once per environment", t => {
  const { before, after } = fixture(t)
  const { result, on, off } = same(before, after)
  assert.equal(result.identical, true)
  assert.equal(on.checked.get(join(before, "shared.d.ts")), 1)
  assert.ok(off.checked.get(join(before, "shared.d.ts")) >= 8, "unreused comparison rechecks it in each group")
  assert.ok(on.programs < off.programs / 2, `programs ${on.programs} against ${off.programs}`)
})

test("an unequal export in a later entry group still reports", t => {
  const { before, after } = fixture(t)
  put(join(after, "e7.d.ts"), `import type { Shared } from "./shared.js";\nexport declare const value7: Shared | number;\n`)
  const { result } = same(before, after)
  assert.equal(result.identical, false)
  assert.deepEqual(result.typeDifferences.map(item => item.export), ["value7"])
})

test("a broken shared module blocks through a reused diagnostic", t => {
  const { before, after } = fixture(t, { shared: "export interface Shared { value: Missing }\n" })
  const { result } = same(before, after)
  assert.equal(result.comparisonComplete, false)
  assert.ok(result.environmentDiagnostics.some(item => /Cannot find name 'Missing'/.test(item.diagnostic) && item.blocking))
})

test("a module checks again in a group whose global scope differs", t => {
  const { before, after } = fixture(t, {
    shared: "export interface Shared { value: string }\nexport declare const late: LateGlobal;\n",
    extra: { "late.d.ts": "export {}\ndeclare global { interface LateGlobal { late: true } }\n" },
  })
  for (const dir of [before, after])
    put(join(dir, "e0.d.ts"), `import "./late.js";\nimport type { Shared } from "./shared.js";\nexport declare const value0: Shared;\n`)
  const { on } = same(before, after)
  assert.ok(on.checked.get(join(before, "shared.d.ts")) >= 2, "the augmentation's group is another environment")
})

test("a saved nominal alignment keeps equal classes equal and a changed class different", t => {
  const shared = "export declare class Shared { private readonly brand: unknown; value: string }\n"
  const { before, after } = fixture(t, { shared })
  assert.equal(same(before, after).result.identical, true)
  put(join(after, "shared.d.ts"), shared.replace("value: string", "value: string; added: number"))
  const { result } = same(before, after)
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.length > 0)
})

test("the batch size reaches diagnostics through every setting without changing the result", t => {
  const { before, after } = fixture(t, { shared: "export interface Shared { value: Missing }\n" })
  const whole = same(before, after, { ...options, entryBatchSize: 1000, diagnosticBatchSize: 1000 }).result
  assert.equal(same(before, after).result.comparisonComplete, whole.comparisonComplete)
})

// A virtual tree: every module reaches its imports, and each edit must change
// the key of exactly the modules that reach the edited file.
function keysOf(modules, scripts, compilerOptions = {}) {
  const files = new Map(Object.entries(modules).map(([name, { text, imports }]) => ["/p/" + name + ".d.ts",
    imports.map(target => `import type {} from "./${target}.js";\n`).join("") + `export declare const ${name}: ${JSON.stringify(text)};\n`]))
  for (const [name, text] of Object.entries(scripts)) files.set("/p/" + name + ".d.ts", text)
  const options = { noLib: true, types: [], module: stock.ModuleKind.ESNext, moduleResolution: stock.ModuleResolutionKind.Bundler, ...compilerOptions }
  const resolutions = new Map()
  const host = {
    ...stock.createCompilerHost(options),
    fileExists: file => files.has(file),
    readFile: file => files.get(file),
    getSourceFile: (file, target) => files.has(file) ? stock.createSourceFile(file, files.get(file), target, true) : undefined,
    resolveModuleNames: (names, from) => names.map(name => {
      const resolved = "/p/" + name.slice(2).replace(/\.js$/, ".d.ts"), target = files.has(resolved) ? { resolvedFileName: resolved, extension: ".d.ts" } : undefined
      resolutions.set(from + "\0" + name + "\0", target)
      return target
    }),
  }
  const program = stock.createProgram([...files.keys()], options, host)
  return fileDiagnosticKeys(stock, program, options, resolutions)
}
const reaches = (modules, from, to, seen = new Set()) => {
  if (from === to) return true
  if (seen.has(from)) return false
  seen.add(from)
  return modules[from].imports.some(next => reaches(modules, next, to, seen))
}
const names = ["a", "b", "c", "d", "e", "f"]
const graph = fc.tuple(...names.map(() => fc.uniqueArray(fc.constantFrom(...names), { maxLength: 3 })))
  .map(lists => Object.fromEntries(names.map((name, index) => [name, { text: name, imports: lists[index].filter(target => target !== name) }])))

test("a key changes for exactly the modules that reach an edited module", () => {
  fc.assert(fc.property(graph, fc.constantFrom(...names), (modules, edited) => {
    const first = keysOf(modules, {})
    const second = keysOf({ ...modules, [edited]: { ...modules[edited], text: "edited" } }, {})
    for (const name of names) assert.equal(first.get(`/p/${name}.d.ts`) !== second.get(`/p/${name}.d.ts`), reaches(modules, name, edited), name)
  }), { numRuns: 200, seed: 40711 })
})

test("every key changes with a global script, an augmentation or the options", () => {
  fc.assert(fc.property(graph, modules => {
    const base = keysOf(modules, {})
    const compare = other => { for (const name of names) assert.notEqual(base.get(`/p/${name}.d.ts`), other.get(`/p/${name}.d.ts`)) }
    compare(keysOf(modules, { added: "declare const added: 1;\n" }))
    compare(keysOf(modules, { added: "export {}\ndeclare global { const added: 1 }\n" }))
    compare(keysOf(modules, { added: `declare module "x" { export const added: 1 }\n` }))
    compare(keysOf(modules, { added: "export {}\nexport as namespace Added;\n" }))
    compare(keysOf(modules, {}, { strictNullChecks: true }))
  }), { numRuns: 50, seed: 40712 })
})

test("a module that reaches an unproved edge has no key", () => {
  const modules = { a: { text: "a", imports: ["b"] }, b: { text: "b", imports: ["c"] }, c: { text: "c", imports: [] }, d: { text: "d", imports: [] } }
  const options = { noLib: true, types: [] }
  const files = Object.fromEntries(Object.keys(modules).map(name => ["/p/" + name + ".d.ts", modules[name].imports.map(target => `import "./${target}.js";\n`).join("") + "export {}\n"]))
  const host = { ...stock.createCompilerHost(options), getSourceFile: (file, target) => files[file] ? stock.createSourceFile(file, files[file], target, true) : undefined, resolveModuleNames: names => names.map(() => undefined) }
  const program = stock.createProgram(Object.keys(files), options, host)
  const resolutions = new Map([["/p/a.d.ts\0./b.js\0", { resolvedFileName: "/p/b.d.ts" }], ["/p/b.d.ts\0./c.js\0", { resolvedFileName: "/p/outside.d.ts" }]])
  const keys = fileDiagnosticKeys(stock, program, options, resolutions)
  assert.deepEqual([...keys.keys()].sort(), ["/p/c.d.ts", "/p/d.d.ts"])
})

test("a chain past the call stack gets keys", () => {
  const options = { noLib: true, types: [] }, size = 30000
  const name = index => `/p/m${index}.d.ts`, sources = new Map(), resolutions = new Map()
  for (let index = 0; index < size; index++) {
    sources.set(name(index), stock.createSourceFile(name(index), "export {}\n", stock.ScriptTarget.ESNext))
    if (index) resolutions.set(name(index - 1) + `\0./m${index}.js\0`, { resolvedFileName: name(index) })
  }
  const program = { getSourceFiles: () => [...sources.values()], getSourceFile: file => sources.get(file) }
  assert.equal(fileDiagnosticKeys(stock, program, options, resolutions).size, size)
})
