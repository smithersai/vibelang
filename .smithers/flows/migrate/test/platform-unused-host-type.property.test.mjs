import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")

// Type-checks a split module and its sibling under noUnusedLocals, the
// target's setting, with `document` declared. Returns the diagnostics' text.
function check(files) {
  const all = Object.fromEntries(Object.entries({ ...files, "src/globals.d.ts": "declare const document: { readonly title: string }\n" })
    .map(([name, text]) => ["/v/" + name, text]))
  const options = { strict: true, noUnusedLocals: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, types: [], lib: ["lib.es2022.d.ts"], skipLibCheck: true }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), get = host.getSourceFile.bind(host)
  host.readFile = (name) => all[name] ?? read(name)
  host.fileExists = (name) => name in all || exists(name)
  host.getSourceFile = (name, version) => name in all ? ts.createSourceFile(name, all[name], version, true) : get(name, version)
  host.getCurrentDirectory = () => "/v"
  const directory = host.directoryExists?.bind(host)
  host.directoryExists = (name) => Object.keys(all).some((file) => file.startsWith(name.replace(/\/$/, "") + "/")) || (directory?.(name) ?? false)
  host.realpath = (name) => name
  const program = ts.createProgram(Object.keys(all), options, host)
  return ts.getPreEmitDiagnostics(program).map((d) => `${d.file?.fileName ?? ""} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`)
}

function split(text) {
  const result = splitPlatform(text, "src/leaf.ts", ts, { globals: ["document"] })
  assert.ok(result && !result.refused, JSON.stringify(result))
  return { "src/leaf.ts": result.module, "src/leaf.platform.ts": result.platform }
}

// dp-opencode-05, interaction.ts: the helper imported a host type that only
// another imported host type reads.
const witness = `export type Leaf = { readonly value: string }
export type View = { readonly leaf: Leaf }
export function read(view: View) {
  return document.title + view.leaf.value
}
`

test("an inferred-return split imports only the host types the moved code reads", () => {
  const files = split(witness)
  assert.match(files["src/leaf.platform.ts"], /^import type \{ View \} from "\.\/leaf\.ts"$/m)
  assert.deepEqual(check(files), [])
})

test("a written return still copies the types it reads, with no unused import", () => {
  const files = split(witness.replace("read(view: View) {", "read(view: View): string {"))
  assert.doesNotMatch(files["src/leaf.platform.ts"], /^import type/m)
  assert.deepEqual(check(files), [])
})

test("a private type that only an imported host type reads is not copied", () => {
  const files = split(`type Hidden = { readonly value: string }
export type View = { readonly leaf: Hidden }
export function read(view: View) {
  return document.title + view.leaf.value
}
`)
  assert.doesNotMatch(files["src/leaf.platform.ts"], /Hidden/)
  assert.deepEqual(check(files), [])
})

// Property: a chain of exported types T0 -> T1 -> ... where the moved
// function reads some of them directly, with an inferred or written return.
// The split pair type-checks under noUnusedLocals, and the sibling imports
// exactly the types the moved code names.
test("property: the split pair has no unused host type", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), fc.uniqueArray(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 3 }), fc.boolean(),
    (depth, readsRaw, written) => {
      const reads = [...new Set(readsRaw.map((r) => r % depth))].sort()
      const types = Array.from({ length: depth }, (_, i) => i + 1 < depth
        ? `export type T${i} = { readonly next: T${i + 1}; readonly n${i}: number }`
        : `export type T${i} = { readonly n${i}: number }`)
      const params = reads.map((r) => `t${r}: T${r}`).join(", ")
      const sum = reads.map((r) => `t${r}.n${r}`).join(" + ")
      const text = types.join("\n") + `\nexport function read(${params})${written ? ": string" : ""} {\n  return document.title + (${sum})\n}\n`
      const files = split(text)
      assert.deepEqual(check(files), [], text + "\n----\n" + files["src/leaf.platform.ts"])
      const imported = /^import type \{ ([^}]*) \} from "\.\/leaf\.ts"$/m.exec(files["src/leaf.platform.ts"])?.[1].split(", ") ?? []
      if (!written) assert.deepEqual(imported, reads.map((r) => `T${r}`).sort())
    }), { numRuns: 60, seed: 5196 })
})
