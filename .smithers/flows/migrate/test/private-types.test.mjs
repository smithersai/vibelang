import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { canonicalize, compareDeclarations, loadTypeScript, privateUnusedTypes } from "../lib/declarations.mjs"

const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const same = (a, b) => canonicalize(ts, a) === canonicalize(ts, b)

// t3code chatAttachment.ts: `const State = Schema.Struct(…)`, private, became
// `schema State { … }`, whose declaration adds `type State = typeof State.Type`.
// Nothing names the alias; the module's contract is the same.
test("corpus: a migrated private schema's unused type alias is no declaration change", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-private-schema-alias.json", import.meta.url), "utf8"))
  assert.ok(same(corpus.before, corpus.after), corpus.key)
})

// chatAttachment.d.ts is published (the package's index re-exports it), and a
// published file is compared byte for byte (done criterion 3): the alias is a
// change there. In a declaration file nothing publishes, it is none.
test("corpus: compareDeclarations ignores the unused private alias only in a file nothing publishes", (t) => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-private-schema-alias.json", import.meta.url), "utf8"))
  const compare = (surface) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-private-types-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    for (const [side, text] of [["before", corpus.before], ["after", corpus.after]]) {
      mkdirSync(join(root, side))
      writeFileSync(join(root, side, "public-surface.json"), JSON.stringify(surface))
      writeFileSync(join(root, side, "chatAttachment.d.ts"), text)
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  }
  assert.equal(compare({ roots: ["chatAttachment.d.ts"], reachable: ["chatAttachment.d.ts"], unresolved: [] }).identical, false, "a published file keeps every byte")
  const unpublished = compare({ roots: [], reachable: [], unresolved: [] })
  assert.equal(unpublished.identical, true, JSON.stringify(unpublished.changed))
})

test("an alias that is exported, named by a type, re-exported or in a global script is part of the contract", () => {
  const base = "declare const State: { readonly a: number };\n"
  const changes = [
    ["export type State = typeof State;\n", "an exported alias"],
    ["type State = typeof State;\nexport interface Node { readonly s: State }\n", "an alias a type names"],
    ["type State = typeof State;\ntype Inner = State;\nexport type Outer = Inner;\n", "an alias named through another alias"],
    ["type State = typeof State;\nexport { type State };\n", "an alias an export names"],
    ["type State = typeof State;\nexport interface Node extends State {}\n", "an alias a heritage clause names"],
    ["interface State { readonly a: number }\n", "an interface"]
  ]
  for (const [extra, what] of changes) assert.ok(!same(base + "export {};\n", base + extra + "export {};\n"), what)
  assert.ok(!same(base, base + "type State = typeof State;\n"), "a global script's alias")
  assert.deepEqual([...privateUnusedTypes(ts, ts.createSourceFile("x.d.ts", base + "type State = typeof State;\ntype Self = Self[];\nexport {};\n", ts.ScriptTarget.Latest, true))], [1, 2])
})

test("property: private aliases nothing names never change a module's canonical declarations; a named one does", () => {
  const name = fc.stringMatching(/^[A-Z][a-z]{1,5}$/)
  fc.assert(fc.property(fc.uniqueArray(name, { minLength: 2, maxLength: 5 }), fc.nat(), (names, pick) => {
    const [used, ...others] = names
    const module = `declare const ${used}: { readonly a: number };\nexport interface Node { readonly v: typeof ${used} }\nexport {};\n`
    const aliases = others.map((n, i) => `type ${n} = ${i ? others[i - 1] : `typeof ${used}`} | string;\n`).join("")
    assert.ok(same(module, aliases + module), aliases)
    // Any of them named by an exported type is part of the contract again.
    const named = others[pick % others.length]
    assert.ok(!same(module, aliases + module.replace("export {};", `export type Uses = ${named};\nexport {};`)), named)
  }), { numRuns: 200 })
})
