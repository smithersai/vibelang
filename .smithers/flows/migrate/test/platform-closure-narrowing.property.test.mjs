// A sibling split must keep the module's typing. A moved private const came
// back as an import, and TypeScript narrows a local const inside a closure
// but not an import, so `x ? { f: () => x.g() } : null` failed TS18047 after
// the split (t3code web previewBridge on the a444 compiler).
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
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-platform-split-closure-narrowing.json", import.meta.url), "utf8"))

// Stock TypeScript over the files, with the module's text standing at <file>.vibe.ts
// (where the sibling's "./<name>.vibe" import resolves): errors and declarations.
function check(files, ambient) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-narrowing-"))
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

function splitChecks(file, text, globals, ambient) {
  const before = check({ [file]: text }, ambient)
  assert.deepEqual(before.errors, [], "the original compiles")
  const split = splitPlatform(text, file, ts, { globals })
  assert.ok(split && !split.refused, split?.refused ?? "nothing split")
  const after = check({ [file.replace(/\.ts$/, ".vibe.ts")]: split.module, [platformPath(file)]: split.platform }, ambient)
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.ts$/, "")
  return { before, after, split, name }
}

test("t3code previewBridge: a moved const read inside closures keeps its narrowing", () => {
  const { before, after, split, name } = splitChecks(corpus.file, corpus.text, corpus.globals, corpus.ambient)
  assert.deepEqual(after.errors, [], split.module)
  assert.match(split.module, /const nativePreviewBridge = nativePreviewBridge\$platform/)
  assert.equal(after.out[`${name}.vibe.d.ts`], before.out[`${name}.d.ts`])
})

// Neighbourhood: any number of private consts the module reads under a guard,
// directly or in closures, split cleanly with identical declarations.
test("split modules keep narrowing of every moved const in closures", () => {
  const ambient = "declare var window: { readonly v?: { readonly n: number } }\n"
  const use = fc.constantFrom("closure", "direct", "nested")
  fc.assert(fc.property(fc.array(use, { minLength: 1, maxLength: 4 }), fc.boolean(), (uses, alsoWrapped) => {
    const consts = uses.map((_, i) => `const c${i}: { readonly n: number } | null =\n  typeof window === "undefined" ? null : (window.v ?? null)\n`).join("\n")
    const exports = uses.map((u, i) => u === "closure" ? `export const e${i} = c${i} ? { get: () => c${i}.n } : null\n`
      : u === "nested" ? `export const e${i} = c${i} ? { get: () => [1].map(() => c${i}.n) } : null\n`
      : `export const e${i}: number | null = c${i} ? c${i}.n : null\n`).join("")
    const wrapped = alsoWrapped ? `export function now(): number {\n  return typeof window === "undefined" ? 0 : 1\n}\n` : ""
    const { before, after, split } = splitChecks("src/m.ts", consts + "\n" + exports + wrapped, ["window"], ambient)
    assert.deepEqual(after.errors, [], split.module)
    assert.equal(after.out["m.vibe.d.ts"], before.out["m.d.ts"])
  }), { numRuns: 60 })
})
