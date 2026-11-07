// EK4402 reports a host global read through a cast with the cast's own text:
// "(globalThis as { readonly location?: … }).location is platform code".
// platformGlobalsOf read a message's global only when the text started with
// an identifier, so it named nothing, the split found no platform code, and
// Smithers' observability FetchFailures.ts and platform-browser
// BrowserCache.ts stayed TypeScript.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { platformGlobalsFromCauses, platformGlobalsOf, platformPath, splitPlatform } from "../lib/platform.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-cast-global.json", import.meta.url), "utf8"))
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, noUnusedLocals: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true }

function declarations(root, files, out) {
  const program = ts.createProgram(files.map((f) => join(root, f)), { ...options, outDir: join(root, out) })
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
  const texts = {}
  program.emit(undefined, (name, text) => { texts[name.slice(name.lastIndexOf("/") + 1)] = text })
  return { errors, texts }
}

test("smithers FetchFailures and BrowserCache: an EK4402 on a cast globalThis read moves the declaration that reads it", (t) => {
  for (const { file, text, message, moved } of corpus.modules) {
    const root = mkdtempSync(join(tmpdir(), "migrate-platform-cast-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, dirname(file)), { recursive: true })
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", private: true }))
    writeFileSync(join(root, file), text)
    const before = declarations(root, [file], ".before")
    assert.deepEqual(before.errors, [], file)
    const receipt = { [file.replace(/\.ts$/, ".vibe")]: { cause: "platform access", codes: ["EK4402"], diagnostics: [{ code: "EK4402", message }] } }
    const state = prepareState(root, [file], [file], { ts, globalsOf: platformGlobalsFromCauses([receipt]) })
    assert.equal(state.platform.splits.length, 1, `${file}: ${JSON.stringify(state.platform)}`)
    const [split] = state.platform.splits
    assert.deepEqual([...split.moved].sort(), moved, file)
    applyState(root, state)
    const vibe = readFileSync(join(root, file.replace(/\.ts$/, ".vibe")), "utf8")
    assert.doesNotMatch(vibe, /globalThis as/, `${file}: the .vibe module no longer reads the host`)
    assert.match(readFileSync(join(root, split.platform), "utf8"), /\(globalThis as \{/, `${file}: the sibling keeps the read as written`)
    const asTs = file.replace(/\.ts$/, ".vibe.ts")
    writeFileSync(join(root, asTs), vibe)
    const after = declarations(root, [asTs, split.platform], ".after")
    assert.deepEqual(after.errors, [], vibe)
    const base = file.slice(file.lastIndexOf("/") + 1).replace(/\.ts$/, "")
    assert.equal(after.texts[`${base}.vibe.d.ts`], before.texts[`${base}.d.ts`], file)
  }
})

const wordings = ["{0} is platform code, which VibeLang code does not use directly.", "{0} reads a host global. Use an injected Effect service, or move the platform code to a .ts file.", "{0} reaches the host and cannot be used in a .vibe file."]
// Cast types as a program writes them, parentheses, braces and calls included.
const castTypes = ["{ readonly location?: { readonly href?: unknown } }", "{ readonly caches?: unknown }", "{ f(): void }", "Record<string, (() => void) | undefined>", "{ readonly a: { readonly b: (x: number) => string } }"]

test("a message on a cast read names the cast global, and the split moves the declarations that read it", () => {
  let moved = 0
  fc.assert(fc.property(fc.constantFrom("globalThis", "self", "window"), fc.constantFrom("as", "satisfies"), fc.constantFrom(...castTypes), fc.constantFrom(".location", "?.caches", '["key"]', ".f()", ""), fc.constantFrom(...wordings), fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }), (global, keyword, type, member, wording, readers) => {
    const message = wording.replace("{0}", `(${global} ${keyword} ${type})${member}`)
    assert.deepEqual(platformGlobalsOf([message]), [global], message)
    assert.deepEqual(platformGlobalsOf(["error EK4402: " + message]), [global], message)
    const lines = readers.map((r, i) => `export const f${i} = (s: string): string => ${r ? `String((${global} as unknown as { readonly x?: string }).x) + s` : `s + ${i}`}`)
    const text = (global === "globalThis" ? "" : `declare const ${global}: unknown\n`) + lines.join("\n") + "\n"
    const split = splitPlatform(text, "m.ts", ts, { globals: platformGlobalsOf([message]) })
    const expected = readers.flatMap((r, i) => (r ? ["f" + i] : []))
    if (!expected.length) { assert.equal(split, null, text); return }
    if (global !== "globalThis") { assert.equal(split, null, "a declared name is the module's, not the host's"); return }
    assert.ok(split && !split.refused, split?.refused)
    assert.deepEqual([...split.moved].sort(), expected, text)
    moved++
  }), { seed: 88088, numRuns: 150 })
  assert.ok(moved > 30, `only ${moved} runs split`)
})
