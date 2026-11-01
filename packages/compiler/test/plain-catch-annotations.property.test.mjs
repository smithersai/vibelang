import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import test from "node:test"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const fc = require("fast-check")
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/sl3-typed-destructured-catch.json", import.meta.url), "utf8"))
const quote = "A `try { } catch { }` statement at the top level, or in a plain or `async` function, is JavaScript's, as in TypeScript."
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const runtime = process.env.VIBELANG_RUNTIME || join(repo, "packages/runtime")
const raw = process.env.VIBELANG_PLAIN_CATCH_RAW === "1"
const observed = new Set()

test("plain catch annotation coverage quotes Chapter 1", () => {
  assert.ok(readFileSync(join(repo, "docs/design/src/001-functions.md"), "utf8").includes(quote))
})

function sourceFor(input) {
  const binding = { identifier: "error", object: "{ code = 1 }", nested: "{ error: { code = 1 } }", array: "[code = 1]", rest: "{ code, ...rest }" }[input.binding]
  const annotation = input.annotation === "none" ? "" : ": " + input.annotation
  const statement = "try { work() } catch (" + binding + annotation + ") {}"
  const body = input.nested ? "if (true) { " + statement + " }" : statement
  const returnType = input.returnType || "void"
  const result = input.home === "async" ? ": Promise<" + returnType + ">" : ": " + returnType
  const form = input.home === "function" ? "export function sample()" + result + " { " + body + " }" :
    input.home === "arrow" ? "export const sample = ()" + result + " => { " + body + " }" :
    input.home === "class" ? "export class C { sample()" + result + " { " + body + " } }" :
    input.home === "async" ? "export async function sample()" + result + " { " + body + " }" :
    "export const c = { sample()" + result + " { " + body + " } }"
  return (returnType === "Void" ? "type Void = void;\n" : "") + "declare function work(): void\n" + form + "\n"
}

function compile(source, extension) {
  const root = mkdtempSync(join(tmpdir(), "plain-catch-annotations-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(join(modules, "effect"), join(root, "node_modules/effect"), "dir")
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"), "dir")
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "main." + extension), 'import * as Effect from "effect/Effect"\n' + source)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: [] },
      vibe: { effectModules: false, effectGlobals: false }, files: ["main." + extension],
    }))
    const result = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], {
      cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 2 << 20,
      env: { ...process.env, GOMAXPROCS: "2" },
    })
    assert.ifError(result.error)
    assert.equal(result.signal, null)
    const text = result.stdout + result.stderr
    return { exit: result.status, panic: text.includes("panic:"), frame: text.includes("vibelang.checkRetiredCatches") && text.includes("Node.Text"),
      diagnostics: text.split("\n").filter(line => /error (?:TS|EK)\d+:/.test(line)).slice(0, 8), codes: [...text.matchAll(/\berror ((?:TS|EK)\d+):/g)].map(match => match[1]).sort() }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// Written return types keep the controls plain on the transitional compiler.
// The original unannotated program is retained separately as a crash witness
// (r3: checkRetiredCatches read Node.Text of a binding pattern; fixed in c94a0a44c6cf).
function check(input, literal) {
  const source = literal || sourceFor(input), native = compile(source, "ts"), vibe = compile(source, "vibe")
  assert.equal(native.panic, false, "native TypeScript control must not panic")
  assert.equal(native.exit === 0, native.codes.length === 0)
  assert.equal(vibe.panic, false, "plain catch must not panic: " + JSON.stringify(input))
  if (literal) return // the historical witness promises no crash, irrespective of function-kind diagnostics
  if (!raw && JSON.stringify(vibe.codes) !== JSON.stringify(native.codes)) {
    const extra = vibe.codes.filter(code => !native.codes.includes(code))
    assert.ok(extra.length > 0)
    // The compiler still reads a typed plain catch as an Effect catch: EK2105/EK2112
    // on the annotation and EK9203 on the plain function that holds it.
    const legacy = new Set(["EK2105", "EK2112", "EK9203"])
    assert.ok(extra.every(code => legacy.has(code)), JSON.stringify({ input, native, vibe }))
    assert.deepEqual(vibe.codes.filter(code => !legacy.has(code)), native.codes)
    assert.notEqual(input.annotation, "none")
    observed.add(corpus.pending.diagnostics.key)
  } else assert.deepEqual(vibe.codes, native.codes, "plain catch follows native TypeScript: " + JSON.stringify(input))
  assert.equal(vibe.exit === 0, vibe.codes.length === 0)
}

test("r3: a typed destructured catch has native diagnostics and never crashes", () => {
  check(corpus.input, corpus.sourceCode)
})

test("plain catch annotations span binding patterns, callables, return annotations and nested blocks", () => {
  for (const binding of ["identifier", "object", "array"]) for (const annotation of ["none", "any", "unknown"])
    check({ ...corpus.input, binding, annotation })
  fc.assert(fc.property(fc.record({
    binding: fc.constantFrom("identifier", "object", "nested", "array", "rest"),
    annotation: fc.constantFrom("none", "any", "unknown"),
    home: fc.constantFrom("function", "arrow", "class", "object", "async"),
    returnType: fc.constantFrom("void", "Void"), nested: fc.boolean(),
  }), input => check(input)), { seed: 3030628, numRuns: 60, endOnFailure: true })
  if (!raw) {
    for (const entry of Object.values(corpus.pending))
      assert.ok(observed.has(entry.key), "XPASS " + entry.key + ": retire the exact pending entry")
  }
})
