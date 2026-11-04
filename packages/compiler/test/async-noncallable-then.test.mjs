import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../../typescript/vibelang/lsp-connection.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `build the compiler and runtime first; missing ${missing}`

function offset(source, position) {
  const lines = source.split("\n")
  return lines.slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character
}

function apply(source, edits) {
  return [...edits].sort((a, b) => offset(source, b.range.start) - offset(source, a.range.start)).reduce(
    (text, edit) => text.slice(0, offset(source, edit.range.start)) + edit.newText + text.slice(offset(source, edit.range.end)), source)
}

// VIP-1 keeps Promise adoption: even a primitive-typed then may be a getter.
// Exercise the real native LSP action and execute the positive repaired file.
test("async conversion preserves then getter reads and fresh data properties", { skip }, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-async-then-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  symlinkSync(realpathSync(join(runtime, "node_modules/fast-check")), join(root, "node_modules/fast-check"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "esnext", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out" },
    include: ["*.vibe"]
  }))
  const cases = [
    ["fresh", "export async function load() { return { then: 7 } }", 1],
    ["fresh-primitive-parameter", "export async function load(value: string | number | boolean | null) { return { then: value } }", 1],
    ["getter", 'export async function load(events: string[]) { return { get then() { events.push("read"); return 7 } } }', 0],
    ["throwing-getter", "export async function load(error: Error) { return { get then(): number { throw error } } }", 0],
    ["alias", "export async function load(input: { then: number }) { return input }", 0]
  ]
  for (const [name, source] of cases) writeFileSync(join(root, name + ".vibe"), source)
  const connection = new Connection(native, ["--lsp", "--stdio"], root)
  try {
    const rootUri = pathToFileURL(root).href
    await connection.request("initialize", {
      processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "async-then" }],
      capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: {} }, workspace: { configuration: true, workspaceEdit: { documentChanges: true } } }
    })
    connection.notify("initialized", {})
    for (const [name, source, want] of cases) {
      await t.test(name, async () => {
        const uri = pathToFileURL(join(root, name + ".vibe")).href
        connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibelang", version: 1, text: source } })
        const diagnostics = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
        const position = { line: 0, character: source.indexOf("async") }
        const actions = await connection.request("textDocument/codeAction", {
          textDocument: { uri }, range: { start: position, end: position }, context: { diagnostics: [] }
        })
        const conversions = (actions ?? []).filter((action) => action.title.startsWith("Convert to a VibeLang function"))
        assert.equal(conversions.length, want, name + ": Promise-adoption preservation " + JSON.stringify({
          diagnostics: (diagnostics?.items ?? []).map(d => d.code),
          actions: (actions ?? []).map(a => a.title)
        }))
        if (want === 0) {
          assert.equal(readFileSync(join(root, name + ".vibe"), "utf8"), source, name + ": refused source stays unchanged")
          return
        }
        let action = conversions[0]
        if (!action.edit) action = await connection.request("codeAction/resolve", action)
        const edits = action.edit?.changes?.[uri] ?? action.edit?.documentChanges?.find((change) => change.textDocument?.uri === uri)?.edits
        assert.ok(edits?.length, "fresh conversion has executable edits")
        const fixed = apply(source, edits)
        assert.match(fixed, /effect function load/)
        writeFileSync(join(root, name + ".vibe"), fixed)
        connection.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] })
        // The LSP project retains every refusal fixture. Execute only the
        // repaired source: throwing-getter deliberately has a plain throw.
        writeFileSync(join(root, "tsconfig.execution.json"), JSON.stringify({
          extends: "./tsconfig.json", include: [name + ".vibe"]
        }))
        const compiled = spawnSync(native, ["--pretty", "false", "-p", "tsconfig.execution.json"], { cwd: root, encoding: "utf8" })
        assert.equal(compiled.status, 0, name + ": isolated repaired project\n" + compiled.stdout + compiled.stderr)
        assert.equal(existsSync(join(root, "out/throwing-getter.js")), false, "the negative neighbour is not emitted")
        writeFileSync(join(root, "twin.ts"), source)
        writeFileSync(join(root, "tsconfig.twin.json"), JSON.stringify({
          extends: "./tsconfig.json", compilerOptions: { outDir: "twin-out" }, include: ["twin.ts"]
        }))
        const twin = spawnSync(process.execPath, [join(runtime, "node_modules/typescript/bin/tsc"), "--pretty", "false", "-p", "tsconfig.twin.json"], {
          cwd: root, encoding: "utf8"
        })
        assert.equal(twin.status, 0, name + ": stock TypeScript twin\n" + twin.stdout + twin.stderr)
        const run = name === "fresh"
          ? 'import { Effect } from "effect"; import { load } from "./out/fresh.js"; console.log(JSON.stringify(await Effect.runPromise(load())))'
          : [
              'import { strict as assert } from "node:assert"; import fc from "fast-check"; import { Effect } from "effect";',
              'import { load } from "./out/fresh-primitive-parameter.js"; import { load as twin } from "./twin-out/twin.js";',
              'await fc.assert(fc.asyncProperty(fc.oneof(fc.integer(), fc.string({ maxLength: 64 }), fc.boolean(), fc.constant(null)), async value => {',
              '  const result = await Effect.runPromise(load(value));',
              '  assert.deepEqual(result, await twin(value));',
              '  const property = Object.getOwnPropertyDescriptor(result, "then");',
              '  assert.equal(property.get, undefined); assert.equal(property.writable, true);',
              '}), { seed: 301201, numRuns: 100 });',
              'console.log(JSON.stringify({ runs: 100 }));'
            ].join("\n")
        writeFileSync(join(root, "run.mjs"), run)
        const result = spawnSync(process.execPath, ["run.mjs"], { cwd: root, encoding: "utf8" })
        assert.equal(result.status, 0, name + ": repaired source\n" + fixed + "\n" + result.stdout + result.stderr)
        assert.deepEqual(JSON.parse(result.stdout), name === "fresh" ? { then: 7 } : { runs: 100 })
      })
    }
  } finally {
    await connection.close()
  }
})
