// The EK4402 host-global hand-off (lib/platform.mjs header): a module an
// earlier pass returned to TypeScript for reading a host global splits on the
// next pass when the run lists that pass's receipts as "platformCauses".
// Before this, nothing passed globalsOf to the split, so t3code's 65 roots
// that the sibling split can serve (web window/timers, mobile console and
// timers, server process.*) went back to TypeScript on every pass.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { platformCausesOf, platformGlobalsFromCauses, platformGlobalsOf, platformPath } from "../lib/platform.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-platform-global-causes.json", import.meta.url), "utf8"))

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-causes-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, dirname(corpus.file)), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", private: true }))
  writeFileSync(join(root, corpus.file), corpus.text)
  const run = join(root, ".run")
  mkdirSync(run)
  writeFileSync(join(run, "settle-causes.json"), JSON.stringify(corpus.settleCauses))
  writeFileSync(join(run, "reverted.json"), JSON.stringify(corpus.reverted))
  return { root, run }
}

// Stock TypeScript's declarations for the files, with the corpus's ambient window.
function declarations(root, files) {
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true, outDir: join(root, ".out") }
  writeFileSync(join(root, "ambient.d.ts"), corpus.ambient)
  const program = ts.createProgram([join(root, "ambient.d.ts"), ...files.map(f => join(root, f))], options)
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => ts.flattenDiagnosticMessageText(d.messageText, " "))
  const out = {}
  program.emit(undefined, (name, text) => { out[name.slice(name.lastIndexOf("/") + 1)] = text })
  return { errors, out }
}

for (const receipt of ["settle-causes.json", "reverted.json"]) {
  test(`t3code desktopCliCommand: a window read an earlier pass reported in ${receipt} moves to a sibling`, (t) => {
    const { root, run } = project(t)
    const before = declarations(root, [corpus.file])
    assert.deepEqual(before.errors, [])
    // Without the receipts the split sees no platform code: the module is renamed as is and EK4402 returns it.
    const unaware = prepareState(root, [corpus.file], [corpus.file], { ts })
    assert.deepEqual(unaware.platform.splits, [])

    const state = prepareState(root, [corpus.file], [corpus.file], { ts, globalsOf: platformCausesOf({ platformCauses: [receipt] }, run) })
    assert.equal(state.platform.splits.length, 1, JSON.stringify(state.platform))
    const [split] = state.platform.splits
    assert.equal(split.platform, platformPath(corpus.file))
    assert.deepEqual([...split.moved].sort(), corpus.moved)
    assert.deepEqual([...split.wrapped].sort(), corpus.wrapped)
    applyState(root, state)
    const vibe = corpus.file.replace(/\.ts$/, ".vibe")
    assert.ok(existsSync(join(root, vibe)) && existsSync(join(root, split.platform)))
    assert.doesNotMatch(readFileSync(join(root, vibe), "utf8"), /\bwindow\b/, "the .vibe module reads no host global")
    assert.match(readFileSync(join(root, split.platform), "utf8"), /window\.desktopBridge\?\.cliCommand/, "the sibling keeps the read verbatim")

    // The module's declarations are unchanged: stock TypeScript reads the .vibe text as
    // desktopCliCommand.vibe.ts, which is where the sibling's "./desktopCliCommand.vibe" resolves.
    const asTs = vibe + ".ts"
    writeFileSync(join(root, asTs), readFileSync(join(root, vibe), "utf8"))
    const after = declarations(root, [asTs, split.platform])
    assert.deepEqual(after.errors, [])
    assert.match(before.out["desktopCliCommand.d.ts"] ?? "", /getDesktopCliCommandBridge\(\): DesktopCliCommandBridge \| undefined/)
    assert.equal(after.out["desktopCliCommand.vibe.d.ts"], before.out["desktopCliCommand.d.ts"])
  })
}

test("platformCausesOf refuses a listed receipt that is missing", (t) => {
  const { run } = project(t)
  assert.throws(() => platformCausesOf({ platformCauses: ["nope.json"] }, run), /platformCauses receipt missing/)
  assert.deepEqual(platformCausesOf({}, run)(corpus.file), [])
})

// Neighbourhood: any mix of receipt shapes, path spellings and other diagnostics
// hands the split exactly the globals EK4402 named for that module.
test("platformGlobalsFromCauses hands each module exactly the globals its EK4402 messages name", () => {
  const global = fc.constantFrom("window", "document", "localStorage", "navigator", "process", "Buffer", "console", "setTimeout", "clearTimeout", "globalThis")
  const member = fc.constantFrom("", ".env", ".pid", ".warn", ".innerWidth", "?.desktopBridge", ".from")
  const other = fc.constantFrom("EK4401", "EK1002", "EK4403", "TS2345")
  const site = fc.record({ module: fc.constantFrom("src/a", "src/b", "lib/c"), mts: fc.boolean(), code: fc.oneof(fc.constant("EK4402"), other), name: global, member, shape: fc.constantFrom("settle", "reverted"), spelling: fc.constantFrom("vibe", "ts") })
  fc.assert(fc.property(fc.array(site, { maxLength: 12 }), (sites) => {
    const settle = {}, reverted = []
    for (const s of sites) {
      const message = `${s.name}${s.member} is platform code, which VibeLang code does not use directly.`
      const ext = s.mts ? ".mts" : ".ts"
      const file = s.module + (s.spelling === "vibe" ? ".vibe" : ext)
      if (s.shape === "settle") (settle[file] ??= { diagnostics: [] }).diagnostics.push({ code: s.code, message })
      else reverted.push({ file, reason: `platform access: ${s.code} ${message}` })
    }
    const globalsOf = platformGlobalsFromCauses([settle, reverted])
    for (const module of ["src/a", "src/b", "lib/c"]) for (const ext of [".ts", ".mts"]) {
      const expected = platformGlobalsOf(sites.filter(s => s.module === module && s.code === "EK4402" && (s.spelling === "vibe" || (s.mts ? ".mts" : ".ts") === ext)).map(s => `${s.name}${s.member} is platform code`))
      assert.deepEqual(globalsOf(module + ext), expected, `${module}${ext}`)
    }
  }), { numRuns: 300 })
})
