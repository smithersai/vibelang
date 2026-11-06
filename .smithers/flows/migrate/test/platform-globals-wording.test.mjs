// EK4402 names the host global a module reads only in its message text, and
// platformGlobalsOf reads the global from that text (lib/platform.mjs). The
// compiler's third wording, "AbortSignal.timeout reaches the host" (platform
// members, platform_host_members.go), was missing, so opencode's CLI login
// module kept AbortSignal.timeout(5000) in .vibe and failed EK4402 after every
// pass (drive2-opencode, 2026-11-04). These tests read the Go message table:
// a new EK4402 wording fails here until platformGlobalsOf classifies it.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { globalWordings, platformGlobalsFromCauses, platformGlobalsOf, platformPath } from "../lib/platform.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const compiler = fileURLToPath(new URL("../../../../typescript/tsc/internal/vibelang/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-platform-reaches-host.json", import.meta.url), "utf8"))

// Every EK4402 text in the compiler: the code's own message and each EK4402.With(...).
function ek4402Templates() {
  const templates = new Set()
  for (const name of readdirSync(compiler)) {
    if (!name.endsWith(".go") || name.endsWith("_test.go")) continue
    const source = readFileSync(join(compiler, name), "utf8")
    for (const m of source.matchAll(/EK4402\s*=\s*message\(\s*4402\s*,\s*\w+\s*,\s*"((?:[^"\\]|\\.)*)"/g)) templates.add(JSON.parse(`"${m[1]}"`))
    for (const m of source.matchAll(/EK4402\.With\(\s*"((?:[^"\\]|\\.)*)"/g)) templates.add(JSON.parse(`"${m[1]}"`))
  }
  return [...templates].sort()
}

// What {0} stands for in each template the compiler has: a host global or a
// member path from one (the split moves the declarations that read it), or
// something else (a module, an import, a directive), which names no global.
const kinds = {
  "{0} is platform code, which VibeLang code does not use directly.": "global",
  "{0} reads a host global. Use an injected Effect service, or move the platform code to a .ts file.": "global",
  "{0} reaches the host and cannot be used in a .vibe file.": "global",
  "{0} is platform code, which VibeLang code does not import.": "module",
  "{0} from {1} is platform code, which a .vibe file does not import as a value.": "import",
  "This import keeps a runtime load of {0}; write import type for type bindings, or move the import to a .ts file.": "module",
  "Only import.meta.url is available in a .vibe file; use the Path or Config service for host state, or move this import.meta use to a .ts file.": "none",
}

const fill = (template, args) => template.replace(/\{(\d)\}/g, (_, i) => args[Number(i)])

test("the opencode witness: AbortSignal.timeout reaches the host names AbortSignal", () => {
  const message = corpus.settleCauses["packages/cli/src/login.vibe"].diagnostics[0].message
  assert.deepEqual(platformGlobalsOf([message]), ["AbortSignal"])
  assert.deepEqual(platformGlobalsOf([`error EK4402: ${message}`]), ["AbortSignal"])
  assert.deepEqual(platformGlobalsOf(["URL.createObjectURL reaches the host and cannot be used in a .vibe file."]), ["URL"])
})

test("smithers: a clock or randomness read names its global through the call", () => {
  const text = (name) => `${name} is platform code, which VibeLang code does not use directly.`
  assert.deepEqual(platformGlobalsOf([text("crypto.randomUUID()")]), ["crypto"])
  assert.deepEqual(platformGlobalsOf([text("crypto.getRandomValues()")]), ["crypto"])
  assert.deepEqual(platformGlobalsOf([text("performance.now()")]), ["performance"])
  assert.deepEqual(platformGlobalsOf([text("globalThis.crypto.randomUUID()")]), ["globalThis"])
  assert.deepEqual(platformGlobalsOf([text("new Date()")]), ["Date"])
})

test("every EK4402 text in the compiler's message table is classified", () => {
  const templates = ek4402Templates()
  assert.ok(templates.includes("{0} reaches the host and cannot be used in a .vibe file."), "the table reader finds the platform-member text")
  assert.deepEqual(templates.filter((t) => !(t in kinds)), [], "a new EK4402 wording: add it to kinds and, when {0} is a global, to globalWordings")
  for (const template of templates) {
    const expected = kinds[template] === "global" ? ["AbortSignal"] : []
    const args = kinds[template] === "global" ? ["AbortSignal.timeout"] : kinds[template] === "import" ? ["timeout", "node:timers"] : ["node:fs"]
    assert.deepEqual(platformGlobalsOf([fill(template, args)]), expected, template)
  }
  for (const template of templates.filter((t) => kinds[t] === "global")) {
    assert.ok(globalWordings.some((w) => template.startsWith(`{0} ${w}`)), `globalWordings misses ${template}`)
  }
})

// Neighbourhood: any global, any member path, any of the compiler's texts,
// with the code prefix or without, mixed with texts that name no global.
test("platformGlobalsOf names exactly the globals of the compiler's global texts", () => {
  const templates = ek4402Templates()
  const globalTexts = templates.filter((t) => kinds[t] === "global")
  const otherTexts = templates.filter((t) => kinds[t] !== "global")
  const identifier = fc.stringMatching(/^[A-Za-z_$][A-Za-z0-9_$]{0,8}$/).filter((s) => s !== "import")
  const member = fc.array(fc.oneof(fc.stringMatching(/^\??\.[A-Za-z_$][A-Za-z0-9_$]{0,6}$/), fc.constant('["key"]')), { maxLength: 3 }).chain((parts) => fc.constantFrom("", "()").map((call) => parts.join("") + call))
  const site = fc.oneof(
    fc.record({ global: identifier, member, template: fc.constantFrom(...globalTexts), prefix: fc.boolean() }),
    fc.record({ global: fc.constant(null), member: fc.constant(""), template: fc.constantFrom(...otherTexts), prefix: fc.boolean() }),
  )
  fc.assert(fc.property(fc.array(site, { maxLength: 8 }), (sites) => {
    const messages = sites.map((s) => (s.prefix ? "error EK4402: " : "") + fill(s.template, s.global === null ? ["node:fs", "node:fs"] : [s.global + s.member, "node:fs"]))
    const expected = [...new Set(sites.filter((s) => s.global !== null).map((s) => s.global))].sort()
    assert.deepEqual(platformGlobalsOf(messages), expected, messages.join("\n"))
  }), { numRuns: 300 })
})

test("opencode login: the split moves the declaration that reaches the host into the sibling", (t) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-reaches-host-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, dirname(corpus.file)), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", private: true }))
  writeFileSync(join(root, corpus.file), corpus.text)
  writeFileSync(join(root, "ambient.d.ts"), corpus.ambient)
  const state = prepareState(root, [corpus.file], [corpus.file], { ts, globalsOf: platformGlobalsFromCauses([corpus.settleCauses]) })
  assert.equal(state.platform.splits.length, 1, JSON.stringify(state.platform))
  const [split] = state.platform.splits
  assert.equal(split.platform, platformPath(corpus.file))
  assert.deepEqual([...split.moved].sort(), corpus.moved)
  assert.deepEqual([...split.wrapped].sort(), corpus.wrapped)
  applyState(root, state)
  const vibe = readFileSync(join(root, corpus.file.replace(/\.ts$/, ".vibe")), "utf8")
  assert.doesNotMatch(vibe, /AbortSignal\.timeout/, "the .vibe module no longer reaches the host")
  assert.match(vibe, /export const value = 1/)
  assert.match(readFileSync(join(root, split.platform), "utf8"), /AbortSignal\.timeout\(50\)/, "the sibling keeps the call verbatim")

  // Stock TypeScript: the module's declarations are unchanged.
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true }
  const declarations = (files, out) => {
    const program = ts.createProgram([join(root, "ambient.d.ts"), ...files.map((f) => join(root, f))], { ...options, outDir: join(root, out) })
    const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
    const texts = {}
    program.emit(undefined, (name, text) => { texts[name.slice(name.lastIndexOf("/") + 1)] = text })
    return { errors, texts }
  }
  const asTs = corpus.file.replace(/\.ts$/, ".vibe.ts")
  writeFileSync(join(root, asTs), vibe)
  const after = declarations([asTs, split.platform], ".after")
  writeFileSync(join(root, ".before.ts"), corpus.text)
  const before = declarations([".before.ts"], ".before")
  assert.deepEqual(after.errors, [])
  assert.equal(after.texts["login.vibe.d.ts"], before.texts[".before.d.ts"])
})
