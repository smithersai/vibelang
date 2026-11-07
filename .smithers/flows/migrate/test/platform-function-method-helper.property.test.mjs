import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { splitPlatformToModule } from "../lib/platform.mjs"
import { materialize, restore, statements } from "./helpers/host-operations-oracle.mjs"

// A moved call got a helper typed as its callee, `typeof fetch.bind`. bind,
// call and apply are Function.prototype methods whose signatures take the
// function as `this: T`, so the detached helper inferred `T` as void: the
// Smithers model host's `fetch.bind(globalThis)` became a call returning void
// (TS2322 against its FetchLike default). Such a call now moves only its
// receiver, `$fetch().bind(globalThis)`: bind, call and apply are ECMAScript
// lib methods, not platform code, and keep their receiver's type.

const runtime = new URL("../../../../packages/runtime/", import.meta.url)
const require = createRequire(new URL("package.json", runtime))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-bound-fetch.json", import.meta.url), "utf8"))
const compiler = process.env.VIBELANG_BINARY
const split = (text, globals) => splitPlatformToModule(text, "src/x.ts", ts, { globals })
const options = { strict: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], skipLibCheck: true, declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true }

// The declaration stock TypeScript emits for text, and its errors.
function emit(root, name, text) {
  writeFileSync(join(root, name + ".ts"), text)
  const program = ts.createProgram([join(root, name + ".ts")], options)
  const errors = ts.getPreEmitDiagnostics(program).map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
  let declaration
  program.emit(undefined, (path, out) => { if (path.endsWith("/" + name + ".d.ts")) declaration = out })
  return { errors, declaration }
}

// The split keeps the module's types and declarations, and restores to the source.
function assertSame(source, globals) {
  const result = split(source, globals)
  assert.ok(result && !result.refused, source + JSON.stringify(result))
  assert.deepEqual(statements(restore(result.module)), statements(source), source)
  const root = mkdtempSync(join(tmpdir(), "function-method-helper-"))
  try {
    const before = emit(root, "before", source)
    assert.deepEqual(before.errors, [], source)
    const { body, module } = materialize(result.module, "./x.vibe.platform.ts")
    writeFileSync(join(root, "x.vibe.platform.ts"), body)
    const after = emit(root, "after", module)
    assert.deepEqual(after.errors, [], module + "\n----\n" + body)
    assert.equal(after.declaration, before.declaration, module + "\n----\n" + body)
    return { body, module }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Smithers' bound fetch default keeps its type", () => {
  const { body } = assertSame(corpus.source, corpus.globals)
  assert.match(body, /^export function \$fetch\(\) \{ return fetch \}$/m)
  assert.doesNotMatch(body, /typeof fetch\.bind/)
})

test("bind, call and apply of a host function keep their receiver", () => {
  for (const call of ["fetch.bind(globalThis)", "fetch.call(globalThis, \"https://example.test\")", "fetch.apply(globalThis, [\"https://example.test\"])",
    "globalThis.fetch.bind(globalThis)", "queueMicrotask.bind(undefined)"]) {
    assertSame(`export const run = () => [${call}, import.meta.url] as const;\nexport const value = 1;\n`, ["fetch", "globalThis", "queueMicrotask"])
  }
})

test("any other host call keeps a helper of the callee's own type", () => {
  const result = split("export const run = () => [fetch(\"https://example.test\"), import.meta.url] as const;\nexport const value = 1;\n", ["fetch"])
  assert.match(materialize(result.module).body, /^export const \$fetch: typeof fetch = /m)
})

test("property: a Function.prototype call in any position keeps its type and restores", () => {
  const methods = ["fetch.bind(globalThis)", "fetch.call(globalThis, \"u\")", "fetch.apply(globalThis, [\"u\"])", "globalThis.fetch.bind(globalThis)"]
  const positions = [(c) => `export const v = () => [${c}, import.meta.url] as const;`, (c) => `export function f() { return [${c}, import.meta.url] as const }`,
    (c) => `export const g = (h: typeof fetch = ${c.startsWith("fetch.bind") || c.startsWith("globalThis") ? c : "fetch"}) => [h, import.meta.url] as const;`]
  fc.assert(fc.property(fc.integer({ min: 0, max: methods.length - 1 }), fc.integer({ min: 0, max: positions.length - 1 }), (m, p) => {
    assertSame(`${positions[p](methods[m])}\nexport const value = 1;\n`, ["fetch", "globalThis"])
  }), { numRuns: 12, seed: 4402701 })
})

test("the compiler accepts the module and reports no platform code", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  const root = mkdtempSync(join(tmpdir(), "function-method-helper-native-"))
  try {
    mkdirSync(join(root, "src"))
    symlinkSync(join(runtime.pathname, "node_modules"), join(root, "node_modules"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "bound", private: true, type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "Preserve", moduleResolution: "Bundler", target: "ESNext", lib: ["ESNext", "DOM"], noEmit: true, skipLibCheck: true, types: [] }, include: ["src"] }))
    writeFileSync(join(root, "src/x.vibe"), split(corpus.source, corpus.globals).module)
    const run = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.doesNotMatch(run.stdout + run.stderr, /EK4402|TS2322/, run.stdout + run.stderr)
    assert.equal(run.status, 0, run.stdout + run.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
