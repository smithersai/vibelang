import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { compareDeclarations, loadTypeScript } from "../lib/declarations.mjs"

const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

// The declaration gate: a package whose `types` is index.d.ts, before and
// after, compared through the checker. `files` are other declarations both
// sides share, or { before, after } when they differ.
function gate(before, after, files = {}, root = mkdtempSync(join(tmpdir(), "migrate-private-types-"))) {
  try {
    for (const [side, index] of [["before", before], ["after", after]]) {
      const all = { "package.json": JSON.stringify({ name: "p", types: "./index.d.ts" }), "index.d.ts": index }
      for (const [file, text] of Object.entries(files)) all[file] = typeof text === "string" ? text : text[side]
      for (const [file, text] of Object.entries(all)) {
        mkdirSync(dirname(join(root, side, file)), { recursive: true })
        writeFileSync(join(root, side, file), text)
      }
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const identical = (before, after, files) => {
  const result = gate(before, after, files)
  assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
  return result.identical
}

// t3code chatAttachment.ts: `const State = Schema.Struct(…)`, private, became
// `schema State { … }`, whose declaration adds `type State = typeof State.Type`.
// Nothing names the alias; the module's contract is the same. A private alias
// is not an exported API change, including in a file reached from the
// published package entrypoint.
test("corpus: compareDeclarations ignores an unused private alias on the published surface", (t) => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-private-schema-alias.json", import.meta.url), "utf8"))
  const compare = (surface, after = corpus.after) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-private-types-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    for (const [side, text] of [["before", corpus.before], ["after", after]]) {
      mkdirSync(join(root, side))
      writeFileSync(join(root, side, "public-surface.json"), JSON.stringify(surface))
      writeFileSync(join(root, side, "package.json"), JSON.stringify({
        exports: Object.fromEntries(surface.roots.map((file, i) => ["./entry-" + i, { types: "./" + file }]))
      }))
      writeFileSync(join(root, side, "chatAttachment.d.ts"), text)
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  }
  assert.equal(compare({ roots: ["chatAttachment.d.ts"], reachable: ["chatAttachment.d.ts"], unresolved: [] }).identical, true, "the published API keeps the same names, types and comments")
  assert.equal(compare({ roots: ["chatAttachment.d.ts"], reachable: ["chatAttachment.d.ts"], unresolved: [] },
    corpus.after + "\nexport type Public = string;\n").identical, false, "a genuinely added exported name still fails")
  const unpublished = compare({ roots: [], reachable: [], unresolved: [] })
  assert.equal(unpublished.identical, true, JSON.stringify(unpublished.changed))
})

test("a private alias's change is no API change until an exported declaration, re-export or heritage clause names it", () => {
  // `export {}` keeps the module's other declarations private: a declaration
  // file without it exports every top-level declaration.
  const base = "export {};\ndeclare const State: { readonly a: number };\nexport declare const kept: number;\n"
  const changed = text => text.replace("type State = { readonly a: number }", "type State = { readonly a: string }")
  const alias = "type State = { readonly a: number };\n"
  assert.equal(identical(base + alias, changed(base + alias)), true, "an alias nothing names")
  for (const [use, what] of [
    ["export interface Node { readonly s: State }\n", "an alias a type names"],
    ["type Inner = State;\nexport type Outer = Inner;\n", "an alias named through another alias"],
    ["export { type State };\n", "an alias an export names"],
    ["export interface Node extends State {}\n", "an alias a heritage clause names"]
  ]) {
    const before = base + alias + use
    assert.equal(identical(before, changed(before)), false, what)
  }
  const unused = "interface State { readonly a: number }\n"
  assert.equal(identical(base + unused, base + unused.replace("number", "string")), true, "an interface nothing names")
})

test("property: private aliases nothing names never change a module's API; a named one does", () => {
  const name = fc.stringMatching(/^[A-Z][a-z]{1,5}$/).filter(n => n !== "Node" && n !== "Uses")
  fc.assert(fc.property(fc.uniqueArray(name, { minLength: 2, maxLength: 5 }), fc.nat(), (names, pick) => {
    const [used, ...others] = names
    const module = `declare const ${used}: { readonly a: number };\nexport interface Node { readonly v: typeof ${used} }\nexport {};\n`
    // Each alias names the one before it, so changing the first changes all.
    const aliases = (tail) => others.map((n, i) => `type ${n} = ${i ? others[i - 1] : `typeof ${used}`} | ${tail};\n`).join("")
    assert.equal(identical(aliases("string") + module, aliases("number") + module), true, aliases("string"))
    const named = `export type Uses = ${others[pick % others.length]};\n`
    assert.equal(identical(aliases("string") + module + named, aliases("number") + module + named), false, named)
  }), { seed: 3004, numRuns: 8 })
})

// t3code apps/server MCP toolkits (drive-t3code-server 03:25Z): ten modules
// whose declarations differ only in where an import stands. The gate reads
// what each import binds, not where it stands.
const modules = {
  "a.d.ts": "export interface A { readonly a: 1 }\nexport interface F { readonly f: 1 }\n",
  "b.d.ts": "export interface B { readonly b: 1 }\n",
  "bb.d.ts": "export interface B { readonly b: 2 }\n",
  "c.d.ts": "export interface C { readonly c: 1 }\n",
  "cc.d.ts": "export interface C { readonly c: 2 }\n",
  "d.d.ts": "export interface D { readonly d: 1 }\n",
  "e.d.ts": "export interface E { readonly e: 1 }\n"
}

test("corpus: declarations that differ only in the order of their imports are identical", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-import-order.json", import.meta.url), "utf8"))
  const pkg = (name, entries) => ({
    ["node_modules/" + name + "/package.json"]: JSON.stringify({ name, exports: Object.fromEntries(Object.keys(entries).map(entry =>
      [entry === "index" ? "." : "./" + entry, { types: "./" + entry + ".d.ts" }])) }),
    ...Object.fromEntries(Object.entries(entries).map(([entry, text]) => ["node_modules/" + name + "/" + entry + ".d.ts", text]))
  })
  const stubs = {
    ...pkg("@t3tools/contracts", { index: "export declare const OrchestratorMcpFailure: { readonly _tag: \"OrchestratorMcpFailure\" };\n" }),
    ...pkg("@t3tools/shared", { Crypto: "export interface Crypto { readonly crypto: true }\n" }),
    ...pkg("effect", {
      FileSystem: "export interface FileSystem { readonly fileSystem: true }\n",
      Schema: "export interface Struct<F> { readonly fields: F }\nexport interface String { readonly string: true }\n",
      ai: "export declare namespace Tool { interface Tool<N extends string, C, R> { readonly name: N; readonly config: C; readonly requirements: R } }\n" +
        "export declare namespace Toolkit { interface Toolkit<T> { readonly tools: T } }\n"
    })
  }
  assert.equal(identical(corpus.before, corpus.after, stubs), true, corpus.key)
  assert.equal(identical(corpus.before, corpus.after.replace('"read"', '"write"'), stubs), false, "a changed tool name")
})

test("import order is no change, but what an import or a re-export brings in is", () => {
  const a = 'import { A } from "./a.js";\nimport { B } from "./b.js";\nexport { C } from "./c.js";\nexport { D } from "./d.js";\nexport declare const x: A | B;\n'
  assert.equal(identical(a, 'import { B } from "./b.js";\nimport { A } from "./a.js";\nexport { D } from "./d.js";\nexport { C } from "./c.js";\nexport declare const x: A | B;\n', modules), true)
  assert.equal(identical(a, a.replace('"./b.js"', '"./bb.js"'), modules), false, "an import from another module")
  assert.equal(identical(a, a.replace('"./c.js"', '"./cc.js"'), modules), false, "a re-export from another module")
})

test("property: any order of a module's imports and re-exports compares identical", () => {
  const lines = ['import { A } from "./a.js";', 'import * as B from "./b.js";', 'import type { C } from "./c.js";', 'export { D } from "./d.js";', 'export * from "./e.js";', 'import { F as G } from "./a.js";']
  fc.assert(fc.property(fc.shuffledSubarray(lines, { minLength: 1 }), (chosen) => {
    const text = (order) => order.join("\n") + "\nexport declare const x: number;\n"
    assert.equal(identical(text(chosen), text([...chosen].reverse()), modules), true)
  }), { seed: 3005, numRuns: 8 })
})

// Class heritage reads its base as a runtime value; its type arguments still
// name types. Interface heritage and implements clauses read the type namespace.
test("corpus: a class base value does not retain its same-named private type alias", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-private-alias-class-heritage.json", import.meta.url), "utf8"))
  assert.equal(identical(corpus.before, corpus.after), true, corpus.key)
})

test("property: class value heritage ignores a same-named private alias; type arguments and interface heritage do not", () => {
  const name = fc.stringMatching(/^[A-Z][a-z]{1,6}$/).filter(n => n !== "Shape" && n !== "Value")
  fc.assert(fc.property(name, fc.constantFrom("", ".Base"), fc.boolean(), (name, suffix, generic) => {
    const constructor = generic ? "new<T>(): { readonly value: T }" : "new(): { readonly value: string }"
    const value = "export {};\n" + (suffix
      ? `declare namespace ${name} { const Base: { ${constructor} }; }\n`
      : `declare const ${name}: { ${constructor} };\n`)
    const alias = (retained) => `type ${name} = { readonly retained: ${retained} };\n`
    const argument = generic ? "<Shape>" : ""
    const extra = generic ? "type Shape = string;\n" : ""
    const before = value + extra + `export declare class Value extends ${name}${suffix}${argument} {}\n`
    assert.equal(identical(before, value + alias("true") + before.slice(value.length)), true, "a class base is a value")
    if (generic) assert.equal(identical(before, before.replace("type Shape = string;", "type Shape = number;")), false, "base type arguments remain observable")
    // An interface's heritage is part of its type. (A class's `implements`
    // clause is not: it checks the class and leaves its type unchanged.)
    const used = value + alias("true") + `export interface Value extends ${name} {}\n`
    assert.equal(identical(used, used.replace(alias("true"), alias("false"))), false, "interface heritage names the alias")
  }), { seed: 102, numRuns: 8 })
})

test("an ambient @types package beside the snapshots cannot change the gate's verdict; a source error still blocks it", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-private-alias-class-heritage.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "migrate-isolated-declaration-"))
  mkdirSync(join(root, "node_modules/@types/incidental"), { recursive: true })
  writeFileSync(join(root, "node_modules/@types/incidental/index.d.ts"), "declare const incidental: Unavailable.Type;\n")
  const clean = gate(corpus.before, corpus.after, {}, join(root, "clean"))
  assert.equal(clean.comparisonComplete, true, JSON.stringify(clean.environmentDiagnostics))
  assert.equal(clean.identical, true)
  const invalid = "\nexport type Invalid = MissingSourceType;\n"
  const broken = gate(corpus.before + invalid, corpus.after + invalid, {}, join(root, "broken"))
  assert.equal(broken.identical, false)
  assert.ok(broken.environmentDiagnostics.some(d => d.blocking && /MissingSourceType/.test(d.diagnostic)), JSON.stringify(broken.environmentDiagnostics))
  rmSync(root, { recursive: true, force: true })
})
