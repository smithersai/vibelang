import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { isPlatformModule, platformPath, splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const spec = readFileSync(new URL("../../../../docs/design/src/005-services.md", import.meta.url), "utf8")
// The EK4402 row's fix, which the codemod applies before a batch's rename.
const quote = "The quick fix and the codemod move the code into a sibling `.ts` module, or point to the Effect service"

// Ambient builtins, so the in-memory programs need no @types/node.
const ambient = `declare module "node:fs" { export function readFileSync(path: string): string; export function closeSync(fd: number): void }
declare module "node:crypto" { export function createHash(algorithm: string): { update(data: string): { digest(encoding: "hex"): string } } }
declare module "node:path" { export function resolve(...paths: string[]): string; export function basename(path: string): string }
`

// Stock TypeScript's declaration of each file and the errors of the program, from in-memory files.
function emit(files) {
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true, declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true, noUnusedLocals: true, types: [], noLib: false, skipLibCheck: true }
  const all = { "/p/ambient.d.ts": ambient, "/p/package.json": '{"type":"module"}', ...Object.fromEntries(Object.entries(files).map(([k, v]) => ["/p/" + k, v])) }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host)
  const exists = host.fileExists.bind(host)
  host.readFile = (name) => all[name] ?? read(name)
  host.fileExists = (name) => name in all || exists(name)
  host.directoryExists = (dir) => Object.keys(all).some((k) => k.startsWith(dir.replace(/\/?$/, "/"))) || ts.sys.directoryExists(dir)
  host.getCurrentDirectory = () => "/p"
  host.getSourceFile = (name, version) => {
    const text = host.readFile(name)
    return text === undefined ? undefined : ts.createSourceFile(name, text, version, true)
  }
  const out = {}
  host.writeFile = (name, text) => { out[name.replace(/^.*\//, "")] = text }
  const program = ts.createProgram(Object.keys(all).filter((k) => k.endsWith(".ts")), { ...options, outDir: "/out" }, host)
  program.emit()
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `${d.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
  return { out, errors }
}

// The module and its sibling after the split, beside the files it imports.
function splitProject(name, text, others = {}) {
  const result = splitPlatform(text, name, ts)
  assert.ok(result && !result.refused, result?.refused ?? "nothing to split")
  return { result, files: { ...others, [name]: result.module, [platformPath(name)]: result.platform } }
}

test("smithers flows/database: a module's platform code moves to a sibling and its declarations stay identical", () => {
  assert.ok(spec.includes(quote), "update the quoted EK4402 fix")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-split.json", import.meta.url), "utf8"))
  for (const { file, text, others, moved, wrapped } of corpus.modules) {
    const before = emit({ ...others, [file]: text })
    assert.deepEqual(before.errors, [], file)
    const { result, files } = splitProject(file, text, others)
    assert.deepEqual(result.moved.sort(), moved.sort(), file)
    assert.deepEqual(result.wrapped.sort(), wrapped.sort(), file)
    const after = emit(files)
    assert.deepEqual(after.errors, [], file)
    const dts = file.replace(/\.ts$/, ".d.ts").replace(/^.*\//, "")
    assert.equal(after.out[dts], before.out[dts], file)
    // The module imports no builtin as a value; the sibling holds them.
    for (const line of result.module.split("\n")) {
      const m = /^import (?!type )[^"]*"([^"]+)"/.exec(line)
      if (m) assert.ok(!isPlatformModule(m[1]), `${file} still imports ${m[1]}`)
    }
  }
})

test("a module keeps its platform code when an export that uses it cannot stay in the .vibe module", () => {
  const value = 'import { readFileSync } from "node:fs"\nexport const config = readFileSync("config.json")\n'
  assert.match(splitPlatform(value, "src/Config.ts", ts).refused, /export config uses platform code/)
  const inferred = 'import { readFileSync } from "node:fs"\nexport const read = (path: string) => readFileSync(path)\n'
  assert.match(splitPlatform(inferred, "src/Read.ts", ts).refused, /written parameter and return types/)
  // A private type the platform code reads stays, and the sibling gets a copy.
  const privateType = 'import { readFileSync } from "node:fs"\ntype Text = string\nconst decode = (t: Text): Text => readFileSync(t)\nexport const read = (path: Text): Text => decode(path)\n'
  const { files } = splitProject("Typed.ts", privateType)
  assert.deepEqual(emit(files).errors, [])
  assert.equal(emit(files).out["Typed.d.ts"], emit({ "Typed.ts": privateType }).out["Typed.d.ts"])
  assert.equal(splitPlatform('import type { Stats } from "node:fs"\nexport const size = (s: Stats): number => 1\n', "src/T.ts", ts), null)
  assert.equal(splitPlatform('import { Effect } from "effect"\nexport const one = Effect.succeed(1)\n', "src/E.ts", ts), null)
})

// Modules of exported functions with written signatures and private helpers,
// some reading builtins: the split module's declaration is stock
// TypeScript's declaration of the original, the program still checks, and
// the module imports no builtin as a value.
test("splitPlatform keeps the declarations of any module of written functions", () => {
  const callee = fc.constantFrom('readFileSync("x")', 'resolve("a", "b")', 'createHash("sha256").update("v").digest("hex")', "String(1)", "helper0(s)")
  const fn = fc.record({ exported: fc.boolean(), body: callee, arrow: fc.boolean(), doc: fc.boolean(), defaulted: fc.boolean() })
  fc.assert(fc.property(fc.array(fn, { minLength: 1, maxLength: 6 }), (fns) => {
    const lines = ['import { readFileSync } from "node:fs"', 'import { resolve } from "node:path"', 'import { createHash } from "node:crypto"', ""]
    const used = new Set()
    fns.forEach((f, i) => {
      const name = (f.exported ? "fn" : "helper") + i
      const body = f.body === "helper0(s)" && (i === 0 || fns[0].exported) ? "String(s)" : f.body
      for (const m of ["readFileSync", "resolve", "createHash", "helper0"]) if (body.includes(m + "(")) used.add(m)
      const params = f.defaulted ? 's: string = "d"' : "s: string"
      const doc = f.doc ? `/** Doc of ${name}. */\n` : ""
      const exp = f.exported ? "export " : ""
      lines.push(doc + (f.arrow ? `${exp}const ${name} = (${params}): string => ${body} + s` : `${exp}function ${name}(${params}): string {\n  return ${body} + s\n}`))
    })
    if (!fns.some((f) => f.exported)) lines.push("export const kept = 1")
    // A private helper nobody reads would be TS6133 under noUnusedLocals; read each.
    lines.push(`export const all = (s: string): string => [${fns.map((f, i) => (f.exported ? "fn" : "helper") + i + "(s)").join(", ")}].join("")`)
    for (const [m, name] of [["readFileSync", 'import { readFileSync } from "node:fs"'], ["resolve", 'import { resolve } from "node:path"'], ["createHash", 'import { createHash } from "node:crypto"']]) {
      if (!used.has(m)) lines.splice(lines.indexOf(name), 1, "")
    }
    const text = lines.join("\n") + "\n"
    const before = emit({ "m.ts": text })
    fc.pre(before.errors.length === 0)
    const result = splitPlatform(text, "m.ts", ts)
    if (result === null) {
      assert.ok(!["readFileSync", "resolve", "createHash"].some((m) => used.has(m)))
      return
    }
    assert.ok(!result.refused, result.refused)
    const after = emit({ "m.ts": result.module, "m.platform.ts": result.platform })
    assert.deepEqual(after.errors, [], result.module + "\n----\n" + result.platform)
    assert.equal(after.out["m.d.ts"], before.out["m.d.ts"], result.module)
    assert.ok(!/from "node:/.test(result.module.split("\n").filter((l) => !l.startsWith("import type")).join("\n")), result.module)
  }), { seed: 31108, numRuns: 40 })
})
