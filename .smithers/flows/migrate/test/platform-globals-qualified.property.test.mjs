// vibelang --fix qualifies a host constructor the prelude hides, so a
// Smithers module's `new Response(…)` is checked as `new globalThis.Response(…)`
// and EK4402 reads "globalThis.Response reads a host global". platformGlobalsOf
// named only globalThis from that text, the TypeScript the split reads spells
// the global bare, and the split found no platform code: ImmutableCache,
// credentials and ElectricCollection stayed TypeScript with EK4402.
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
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-qualified-global.json", import.meta.url), "utf8"))

const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, noUnusedLocals: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true }

// Stock TypeScript's errors and declarations for files under root.
function declarations(root, files, out) {
  const program = ts.createProgram([join(root, "ambient.d.ts"), ...files.map((f) => join(root, f))], { ...options, outDir: join(root, out) })
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
  const texts = {}
  program.emit(undefined, (name, text) => { texts[name.slice(name.lastIndexOf("/") + 1)] = text })
  return { errors, texts }
}

test("smithers ImmutableCache: an EK4402 on globalThis.Response moves the declaration that constructs Response", (t) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-qualified-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, dirname(corpus.file)), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", private: true }))
  writeFileSync(join(root, corpus.file), corpus.text)
  writeFileSync(join(root, "ambient.d.ts"), corpus.ambient)
  const before = declarations(root, [corpus.file], ".before")
  assert.deepEqual(before.errors, [])
  const state = prepareState(root, [corpus.file], [corpus.file], { ts, globalsOf: platformGlobalsFromCauses([corpus.settleCauses]) })
  assert.equal(state.platform.splits.length, 1, JSON.stringify(state.platform))
  const [split] = state.platform.splits
  assert.equal(split.platform, platformPath(corpus.file))
  assert.deepEqual([...split.moved].sort(), corpus.moved)
  assert.deepEqual([...split.wrapped].sort(), corpus.wrapped)
  applyState(root, state)
  const vibe = readFileSync(join(root, corpus.file.replace(/\.ts$/, ".vibe")), "utf8")
  assert.doesNotMatch(vibe, /new Response\(/, "the .vibe module no longer constructs the host global")
  assert.match(readFileSync(join(root, split.platform), "utf8"), /new Response\(entry\.bytes\.slice\(\)/, "the sibling keeps the call as written")
  const asTs = corpus.file.replace(/\.ts$/, ".vibe.ts")
  writeFileSync(join(root, asTs), vibe)
  const after = declarations(root, [asTs, split.platform], ".after")
  assert.deepEqual(after.errors, [], vibe)
  assert.equal(after.texts["ImmutableCache.vibe.d.ts"], before.texts["ImmutableCache.d.ts"])
})

const hosts = ["Response", "Request", "Headers", "Blob", "URL", "crypto", "fetch", "AbortController"]
const ambient = `declare class Response { constructor(body?: string); readonly ok: boolean }
declare class Request { constructor(url: string); readonly url: string }
declare class Headers { constructor(); get(name: string): string | null }
declare class Blob { constructor(parts: string[]); readonly size: number }
declare class URL { constructor(url: string); readonly href: string; static canParse(url: string): boolean }
declare class AbortController { constructor(); readonly signal: object }
declare var crypto: { randomUUID(): string }
declare function fetch(url: string): Promise<Response>
`
// A read of each global that a string-typed function can return.
const reads = {
  Response: (s) => `String(new Response(${s}).ok)`,
  Request: (s) => `new Request(${s}).url`,
  Headers: () => `String(new Headers().get("a"))`,
  Blob: (s) => `String(new Blob([${s}]).size)`,
  URL: (s) => `new URL(${s}).href`,
  crypto: (s) => `crypto.randomUUID() + ${s}`,
  fetch: (s) => `String(fetch(${s}))`,
  AbortController: () => `String(new AbortController().signal)`,
}
// How the checked .vibe spells it once --fix qualified it, and the message
// texts that name a global.
const spellings = [(g) => `globalThis.${g}`, (g) => `new globalThis.${g}()`, (g) => `globalThis?.${g}`, (g) => `globalThis["${g}"]`, (g) => `globalThis.${g}.member`]
const wordings = ["{0} reads a host global. Use an injected Effect service, or move the platform code to a .ts file.", "{0} is platform code, which VibeLang code does not use directly."]

test("smithers ScopedToken: a source that spells globalThis.crypto keeps its bare crypto reads", () => {
  // The message is explained by the qualified read; the bare one is code
  // --fix covers, and moving it would pull Claims ahead of its readers.
  const text = [
    "export const tag = (s: string): string => s + 1",
    "export const available = (): boolean => (globalThis.crypto as { randomUUID?: unknown } | undefined)?.randomUUID !== undefined",
    "export const id = (s: string): string => crypto.randomUUID() + s",
  ].join("\n") + "\n"
  const globals = platformGlobalsOf(["globalThis.crypto is platform code, which VibeLang code does not use directly."])
  const split = splitPlatform(text, "ScopedToken.ts", ts, { globals })
  assert.ok(split && !split.refused, split?.refused)
  assert.deepEqual([...split.moved], ["available"])
})

test("a message on a qualified global names the global, and the split moves the declarations that read it bare", () => {
  let moved = 0
  fc.assert(fc.property(fc.constantFrom(...hosts), fc.constantFrom(...spellings), fc.constantFrom(...wordings), fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }), fc.boolean(), (host, spell, wording, readers, shadowed) => {
    const message = wording.replace("{0}", spell(host))
    assert.deepEqual(platformGlobalsOf([message]), ["globalThis", "globalThis." + host], message)
    const lines = shadowed ? [`const ${host} = { local: true }`, `export const local = (): boolean => ${host}.local`] : []
    readers.forEach((reads_, i) => lines.push(`export const f${i} = (s: string): string => ${reads_ && !shadowed ? reads[host]('"x" + s') : "s + " + i}`))
    const text = lines.join("\n") + "\n"
    const split = splitPlatform(text, "m.ts", ts, { globals: platformGlobalsOf([message]) })
    const expected = shadowed ? [] : readers.flatMap((r, i) => (r ? ["f" + i] : []))
    if (!expected.length) { assert.equal(split, null, text); return }
    assert.ok(split && !split.refused, split?.refused)
    assert.deepEqual([...split.moved].sort(), expected, text)
    moved++
    const root = mkdtempSync(join(tmpdir(), "migrate-platform-qualified-p-"))
    try {
      writeFileSync(join(root, "ambient.d.ts"), ambient)
      writeFileSync(join(root, "m.ts"), text)
      writeFileSync(join(root, "m.vibe.ts"), split.module)
      writeFileSync(join(root, "m.platform.ts"), split.platform.replaceAll('"./m.ts"', '"./m.vibe.ts"'))
      const before = declarations(root, ["m.ts"], ".before")
      const after = declarations(root, ["m.vibe.ts", "m.platform.ts"], ".after")
      assert.deepEqual(before.errors, [], text)
      assert.deepEqual(after.errors, [], split.module + "\n----\n" + split.platform)
      assert.equal(after.texts["m.vibe.d.ts"], before.texts["m.d.ts"])
      assert.doesNotMatch(split.module.split("\n").filter((l) => !/^import /.test(l)).join("\n"), new RegExp(`\\b${host}\\b`))
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 86086, numRuns: 120 })
  assert.ok(moved > 40, `only ${moved} runs split`)
})
