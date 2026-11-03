// An import is read-only (TS2632). When the sibling split moved a `let` with
// the platform code that reads it, a kept function that assigned the `let`
// stayed in the .vibe module and failed to compile (t3code web useSettings on
// the a444 compiler). Whatever writes a moved binding now moves with it, as
// the VIP-40 body route already does.
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
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-platform-sibling-moved-let-writer.json", import.meta.url), "utf8"))

// Stock TypeScript over the files; the module's text stands at <file>.vibe.ts,
// where the sibling's "./<name>.vibe" import resolves.
function check(files, ambient) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-writer-"))
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

function assertSplitCompiles(file, text, globals, ambient) {
  const before = check({ [file]: text }, ambient)
  assert.deepEqual(before.errors, [], "the original compiles")
  const split = splitPlatform(text, file, ts, { globals })
  assert.ok(split, "the module reads the global")
  if (split.refused) return split
  const after = check({ [file.replace(/\.ts$/, ".vibe.ts")]: split.module, [platformPath(file)]: split.platform }, ambient)
  assert.deepEqual(after.errors, [], split.module + "\n---\n" + split.platform)
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.ts$/, "")
  assert.equal(after.out[`${name}.vibe.d.ts`], before.out[`${name}.d.ts`])
  return split
}

test("t3code useSettings: a kept function that assigns moved state moves with it", () => {
  const split = assertSplitCompiles(corpus.file, corpus.text, corpus.globals, corpus.ambient)
  assert.ok(!split.refused, split.refused)
  for (const writer of ["hydrateClientSettings", "resetClientSettingsForTests"]) assert.ok(split.moved.includes(writer) && split.wrapped.includes(writer), JSON.stringify(split))
})

// Neighbourhood: a platform reader that takes some `let`s, and kept code that
// assigns them by =, +=, ++, destructuring or inside a closure, always yields
// a module that compiles with identical declarations, or a refusal.
test("every writer of a moved let moves with it or the split refuses", () => {
  const ambient = "declare var window: { readonly n?: number }\n"
  const write = fc.constantFrom("s{i} = 1", "s{i} += 1", "s{i}++", "[s{i}] = [2]", "({ v: s{i} } = { v: 3 })", "queueMicrotask(() => { s{i} = 4 })")
  const writer = fc.record({ target: fc.nat(2), how: write, exported: fc.boolean() })
  fc.assert(fc.property(fc.array(writer, { maxLength: 4 }), fc.integer({ min: 1, max: 3 }), (writers, lets) => {
    const state = Array.from({ length: lets }, (_, i) => `let s${i} = 0\n`).join("")
    const reader = `function host(): number {\n  return (typeof window === "undefined" ? 0 : (window.n ?? 0)) + ${Array.from({ length: lets }, (_, i) => `s${i}`).join(" + ")}\n}\n`
    const fns = writers.map((w, k) => `${w.exported ? "export " : ""}function w${k}(): void {\n  ${w.how.replaceAll("{i}", String(w.target % lets))}\n}\n`).join("")
    const uses = writers.filter((w) => !w.exported).map((_, k) => k)
    const text = state + reader + fns + `export function read(): number {\n  ${writers.map((w, k) => (w.exported ? "" : `w${k}()\n  `)).join("")}return host()\n}\n`
    const ambientAll = ambient + "declare function queueMicrotask(f: () => void): void\n"
    void uses
    assertSplitCompiles("src/m.ts", text, ["window"], ambientAll)
  }), { numRuns: 80 })
})
