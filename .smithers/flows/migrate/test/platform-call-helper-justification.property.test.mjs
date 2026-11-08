import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { splitPlatformToModule } from "../lib/platform.mjs"
import { materialize, restore, statements } from "./helpers/host-operations-oracle.mjs"

// A moved call's helper keeps the callee's own type: the forwarding arrow is
// asserted to `typeof chain`, because an arrow cannot carry the host
// function's overloads and properties. A repository whose lint requires every
// type assertion to state its invariant (a `SAFETY:` comment before the
// statement) rejected these generated helpers, so the companion now states
// why each one is sound. Clock and randomness helpers have signatures of
// their own and assert nothing.

const runtime = new URL("../../../../packages/runtime/", import.meta.url)
const require = createRequire(new URL("package.json", runtime))
const ts = require("typescript"), fc = require("fast-check")
const split = (text, globals) => splitPlatformToModule(text, "src/x.ts", ts, { globals })

// The lint rule's shape: a comment ending before the asserted statement, whose
// text has the marker followed by a colon and a justification.
const justified = /(?:^|[^\p{L}\p{N}_])SAFETY\s*:\s*\S/u
function unjustifiedAssertions(body) {
  const lines = body.split("\n"), found = []
  lines.forEach((line, i) => {
    if (!/\bas typeof\b/.test(line)) return
    const before = lines.slice(0, i).reverse().find((l) => l.trim() !== "")
    if (!(before && /^\s*(\/\/|\/\*)/.test(before) && justified.test(before))) found.push(line)
  })
  return found
}

const calls = [
  { source: 'import { fileURLToPath } from "node:url";\nexport const here = fileURLToPath(new URL("./x", import.meta.url));\n', globals: [], chain: "fileURLToPath" },
  { source: "export const dir = () => [process.cwd(), import.meta.url];\n", globals: ["process"], chain: "process.cwd" },
  { source: "export const later = (f: () => void) => [setTimeout(f, 10), import.meta.url];\n", globals: ["setTimeout"], chain: "setTimeout" },
  { source: "export const say = (m: string) => [console.log(m), import.meta.url];\n", globals: ["console"], chain: "console.log" },
  { source: "export const get = (u: string) => [globalThis.fetch(u), import.meta.url];\n", globals: ["globalThis"], chain: "globalThis.fetch" },
]

test("a moved call's asserted helper states why the assertion is sound", () => {
  for (const { source, globals, chain } of calls) {
    const result = split(source + "export const value = 1;\n", globals)
    assert.ok(result && !result.refused, chain + JSON.stringify(result))
    const { body } = materialize(result.module)
    const escaped = chain.replaceAll(".", "\\.")
    const helper = new RegExp(String.raw`^// SAFETY: [^\n]*\b${escaped}\b[^\n]*\nexport const \$\w+: typeof ${escaped} = \(\(\.\.\.args: Parameters<typeof ${escaped}>\) => ${escaped}\(\.\.\.args\)\) as typeof ${escaped}$`, "m")
    assert.match(body, helper, chain + "\n" + body)
    assert.deepEqual(unjustifiedAssertions(body), [], chain + "\n" + body)
    assert.deepEqual(statements(restore(result.module)), statements(source + "export const value = 1;\n"), chain)
  }
})

test("clock and randomness helpers assert nothing and carry no justification", () => {
  const result = split("export const id = () => [crypto.randomUUID(), performance.now(), crypto.getRandomValues(new Uint8Array(4)), import.meta.url];\nexport const value = 1;\n", ["crypto", "performance"])
  assert.ok(result && !result.refused, JSON.stringify(result))
  const { body } = materialize(result.module)
  assert.doesNotMatch(body, /\bas typeof\b/, body)
  assert.doesNotMatch(body, /SAFETY/, body)
})

test("every asserted helper in a module of many host calls is justified, and the companion still types", () => {
  const root = mkdtempSync(join(tmpdir(), "call-helper-justification-"))
  try {
    const options = { strict: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true }
    const hosts = [
      { call: "setTimeout(f, 10)", globals: "setTimeout" },
      { call: "clearTimeout(undefined)", globals: "clearTimeout" },
      { call: "console.log(m)", globals: "console" },
      { call: "console.error(m)", globals: "console" },
      { call: "globalThis.fetch(m)", globals: "globalThis" },
      { call: "structuredClone(m)", globals: "structuredClone" },
      { call: "performance.now()", globals: "performance" },
      { call: "crypto.randomUUID()", globals: "crypto" },
    ]
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 0, max: hosts.length - 1 }), { minLength: 1, maxLength: hosts.length }), (picked) => {
      const used = picked.map((i) => hosts[i])
      const source = `export const run = (f: () => void, m: string) => [${used.map((h) => h.call).join(", ")}, import.meta.url];\nexport const value = 1;\n`
      const result = split(source, [...new Set(used.map((h) => h.globals))])
      assert.ok(result && !result.refused, source + JSON.stringify(result))
      const { body } = materialize(result.module, "./x.vibe.platform.ts")
      assert.deepEqual(unjustifiedAssertions(body), [], body)
      const asserted = used.filter((h) => !/^(performance\.now|crypto\.randomUUID)/.test(h.call)).length
      assert.equal((body.match(/^\/\/ SAFETY: /gm) ?? []).length, asserted, body)
      assert.deepEqual(statements(restore(result.module)), statements(source))
      writeFileSync(join(root, "x.vibe.platform.ts"), body)
      const program = ts.createProgram([join(root, "x.vibe.platform.ts")], options)
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], body)
    }), { numRuns: 40, seed: 4402804 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
