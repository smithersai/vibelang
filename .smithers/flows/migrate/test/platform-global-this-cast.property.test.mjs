import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { platformGlobalsFromCauses, platformGlobalsOf, splitPlatformToModule } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-global-this-cast-platform-handoff.json", import.meta.url), "utf8"))
const native = process.env.VIBELANG_BINARY
const platformQuote = "The quick fix and the codemod move the code into a sibling `.ts` module that does not exist yet"
const moduleQuote = "A named top-level `module` body is TypeScript"

test("platform handoff follows the quoted platform and module-body rules", () => {
  const spec = readFileSync(new URL("../../../../docs/design/src/005-services.md", import.meta.url), "utf8")
  assert.ok(spec.includes(platformQuote), platformQuote)
  assert.ok(spec.includes(moduleQuote), moduleQuote)
})
const related = ["alias", "index"].map(pattern => JSON.parse(readFileSync(new URL("./corpus/alchemy-global-this-" + pattern + "-platform-handoff.json", import.meta.url), "utf8")))
for (const witness of related) {
  test("the saved " + witness.file + " platform pattern follows its exact diagnostic receipt", () => {
    const cause = platformGlobalsFromCauses([receipts(witness.file.replace(/\.ts$/, ".vibe"), "settle")])
    assert.deepEqual(cause(witness.file), ["globalThis"])
    const result = splitPlatformToModule(witness.source, witness.file, ts, { globals: cause(witness.file) })
    assert.ok(result && !result.refused, JSON.stringify(result))
    assert.deepEqual(result.moved, witness.moved)
    assert.deepEqual(result.kept, witness.retained)
    assert.ok(result.module.includes(witness.source.split("\n")[0]), "the original alias or write remains verbatim")
  })
}

const roots = ["src/HttpServer.ts", "src/HttpServer.mts"]
const diagnostic = { code: "EK0107", message: corpus.message }
const receipts = (file, shape, message = corpus.message, code = "EK0107") => shape === "settle"
  ? { [file]: { diagnostics: [{ code, message }] } }
  : [{ file, reason: `compile error: ${code}: ${message}` }]

for (const shape of ["settle", "reverted"]) {
  test(`globalThis cast platform access is handed to the module split from ${shape} receipts`, () => {
    const cause = platformGlobalsFromCauses([receipts("src/HttpServer.vibe", shape)])
    for (const root of roots) assert.deepEqual(cause(root), ["globalThis"])
    const result = splitPlatformToModule(corpus.source, corpus.file, ts, { globals: cause(corpus.file) })
    assert.ok(result && !result.refused, JSON.stringify(result))
    assert.deepEqual(result.moved, corpus.moved)
    assert.deepEqual(result.kept, corpus.retained)
    assert.ok(result.module.includes(corpus.source.split("\n")[0]), "the platform code and its cast stay verbatim")
    assert.match(result.module, /^export \{ getClient \} from platform$/m)
    assert.match(result.module, /^export const retained = 42;$/m)
  })
}

test("the explicit globalThis platform escape wording names its global", () => {
  assert.deepEqual(platformGlobalsOf(["error EK0107: " + corpus.message]), ["globalThis"])
})

test("unrelated legacy diagnostics and modules do not name platform globals", () => {
  for (const message of [
    "Use let or const instead of var.",
    "globalThis.eval runs a string as code and is not allowed in a .vibe file.",
    "window is platform code, which VibeLang code does not use directly.",
    corpus.message.replace("globalThis", "localThis"),
    corpus.message + " unrelated suffix",
  ]) {
    assert.deepEqual(platformGlobalsOf(["error EK0107: " + message]), [], message)
    for (const shape of ["settle", "reverted"]) {
      assert.deepEqual(platformGlobalsFromCauses([receipts("src/HttpServer.vibe", shape, message)])(corpus.file), [], message)
    }
  }
  assert.deepEqual(platformGlobalsFromCauses([receipts("src/HttpServer.vibe", "settle", corpus.message, "TS0107")])(corpus.file), [])
  assert.deepEqual(platformGlobalsFromCauses([receipts("src/Other.vibe", "settle")])(corpus.file), [])
})

test("platform receipt variants preserve casted member and element reads without widening other diagnostics", () => {
  // Spec 005 quotes above require a preserving TypeScript boundary for the host access.
  // The routing must preserve the original TypeScript statements and the compiler restriction.
  const generated = fc.record({
    shape: fc.constantFrom("settle", "reverted"),
    pattern: fc.constantFrom("member", "alias", "index-write", "in-test"),
    suffix: fc.constantFrom(".vibe", ".ts", ".mts"),
    member: fc.constantFrom(".Bun", '["Bun"]', "?.Bun"),
    wrapped: fc.integer({ min: 1, max: 4 }),
    extra: fc.array(fc.constantFrom("EK0107", "EK0401", "TS2345"), { maxLength: 8 }),
  })
  fc.assert(fc.property(generated, item => {
    const file = "src/HttpServer" + item.suffix
    const list = [receipts(file, item.shape), ...item.extra.map(code => receipts("src/Other.vibe", item.shape, "unrelated", code))]
    const root = "src/HttpServer" + (item.suffix === ".mts" ? ".mts" : ".ts")
    const globals = platformGlobalsFromCauses(list)(root)
    assert.deepEqual(globals, ["globalThis"])
    const access = "(".repeat(item.wrapped) + 'globalThis as { Bun?: unknown }' + ")".repeat(item.wrapped) + item.member
    let moved = "getClient", statement
    if (item.pattern === "alias") {
      const cast = "(".repeat(item.wrapped) + "globalThis as unknown as { client?: unknown }" + ")".repeat(item.wrapped)
      statement = "export const getClient = () => { const g = " + cast + "; return g.client; };"
    } else if (item.pattern === "index-write") {
      moved = "register"
      const cast = "(".repeat(item.wrapped) + "globalThis as Record<string, unknown>" + ")".repeat(item.wrapped)
      statement = 'export const register = (value: unknown) => { ' + cast + '["__runtime"] = value; };'
    } else if (item.pattern === "in-test") {
      statement = 'export const getClient = () => "WebSocketPair" in globalThis;'
    } else statement = "export const getClient = () => " + access + ";"
    const source = statement + "\nexport const retained = 42;\n"
    const result = splitPlatformToModule(source, root, ts, { globals })
    assert.ok(result && !result.refused)
    assert.ok(result.module.includes(statement))
    assert.deepEqual(result.moved, [moved])
    assert.deepEqual(result.kept, ["retained"])
  }), { seed: 561105, numRuns: 160 })
})

test("the stock TypeScript cast twin compiles and the native platform body removes only the escape diagnostic", { skip: !native }, t => {
  const root = mkdtempSync(join(tmpdir(), "platform-cast-member-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const original = join(root, "main.ts")
  writeFileSync(original, corpus.source)
  const program = ts.createProgram([original], {
    strict: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true,
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
  const config = join(root, "tsconfig.json")
  writeFileSync(config, JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", types: [] },
    vibe: { effectModules: false }, files: ["main.vibe"],
  }))
  const path = join(root, "main.vibe")
  writeFileSync(path, corpus.source)
  const before = spawnSync(native, ["-p", config, "--pretty", "false", "--singleThreaded"], { encoding: "utf8" })
  assert.notEqual(before.status, 0)
  assert.match(before.stdout + before.stderr, /EK0107.*Use globalThis only/)
  const globals = platformGlobalsFromCauses([receipts("src/HttpServer.vibe", "settle")])(corpus.file)
  const result = splitPlatformToModule(corpus.source, corpus.file, ts, { globals })
  assert.ok(result && !result.refused)
  writeFileSync(path, result.module)
  const after = spawnSync(native, ["-p", config, "--pretty", "false", "--singleThreaded"], { encoding: "utf8" })
  assert.equal(after.status, 0, after.stdout + after.stderr)
})
