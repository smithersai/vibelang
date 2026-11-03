import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { isPlatformModule, platformGlobalsOf, platformPath, splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const spec = readFileSync(new URL("../../../../docs/design/src/005-services.md", import.meta.url), "utf8")
// The EK4402 row's fix, which the codemod applies before a batch's rename.
const quote = "The quick fix and the codemod move the code into a sibling `.ts` module that does not exist yet; never rewrite an existing foreign file, and refuse with the not-fixed explanation if the move cannot preserve run phase, captures, receiver and public types, or point to the Effect service (`HttpClient` for `fetch`)"

// Ambient builtins, so the in-memory programs need no @types/node.
const ambient = `declare module "node:fs" { export function readFileSync(path: string): string; export function closeSync(fd: number): void }
declare module "node:crypto" { export function createHash(algorithm: string): { update(data: string): { digest(encoding: "hex"): string } } }
declare module "node:path" { export function resolve(...paths: string[]): string; export function basename(path: string): string }
declare var process: { readonly env: Record<string, string | undefined>; kill(pid: number, signal: number): void }
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
// Chapter 007 / native split preserves exact public declarations or refuses: docs/design/src/007-tooling.md#af665f734ddf9e7b

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

// The hand-off with migfix-t3code-2's services quick fix: vibelang --fix
// rewrites the host globals an Effect service covers, and each EK4402 site it
// leaves sends the module back with its message. The next pass moves only
// the declarations that read the globals those messages name.
test("platformGlobalsOf names the host globals that EK4402 messages report", () => {
  assert.deepEqual(platformGlobalsOf([
    "EK4402: process.kill is platform code, which VibeLang code does not use directly.",
    "EK4402: globalThis.process?.env is platform code, which VibeLang code does not use directly.",
    "error EK4402: globalThis[\"setTimeout\"] is platform code, which VibeLang code does not use directly.",
    "process.env is platform code, which VibeLang code does not use directly.",
    "EK4402: createHash from node:crypto is platform code, which a .vibe file does not import as a value.",
    "EK4402: import.meta.dirname is platform code, which VibeLang code does not use directly.",
    "EK4401: Dialect.integer is a plain TypeScript function, and nothing says what its exceptions mean.",
  ]), ["globalThis", "process"])
})

// VIP-33's derived ban reports a global the platform table does not list in
// its own words. The reader takes every EK4402 text the compiler has, so
// these read from the compiler's source and a reworded message fails here.
test("platformGlobalsOf reads every EK4402 text that names a host global", () => {
  const compiler = new URL("../../../../typescript/tsc/internal/vibelang/", import.meta.url)
  const templates = [
    /EK4402 = message\(4402, errorCategory, "([^"]+)"\)/.exec(readFileSync(new URL("diagnostics.go", compiler), "utf8"))[1],
    /unlistedHostGlobal = EK4402\.With\("([^"]+)"\)/.exec(readFileSync(new URL("host_global_declarations.go", compiler), "utf8"))[1],
  ]
  assert.deepEqual(platformGlobalsOf(["Blob reads a host global. Use an injected Effect service, or move the platform code to a .ts file."]), ["Blob"])
  const name = fc.stringMatching(/^[A-Za-z_$][\w$]{0,8}$/).filter((n) => n !== "import")
  const member = fc.constantFrom("", ".subtle", "?.env", '["fetch"]', ".a.b")
  fc.assert(fc.property(fc.constantFrom(...templates), name, member, fc.constantFrom("", "EK4402: ", "error EK4402: "), (template, global, tail, prefix) => {
    assert.deepEqual(platformGlobalsOf([prefix + template.replace("{0}", () => global + tail)]), [global])
  }))
})

test("smithers ShapeSource and kernel HttpClient: a derived host global moves with the declaration that reads it", () => {
  const text = 'export const isBlob = (value: unknown): boolean => value instanceof Blob\nexport const one = (): number => 1\n'
  const messages = ["EK4402: Blob reads a host global. Use an injected Effect service, or move the platform code to a .ts file."]
  const result = splitPlatform(text, "m.ts", ts, { globals: platformGlobalsOf(messages) })
  assert.ok(result && !result.refused, result?.refused)
  assert.deepEqual(result.moved, ["isBlob"])
  assert.deepEqual(result.wrapped, ["isBlob"])
  assert.ok(!/instanceof Blob/.test(result.module), result.module)
  assert.ok(/instanceof Blob/.test(result.platform), result.platform)
})

test("smithers platform-node HostLiveness: a host global a pass left moves with the declarations that read it", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-globals.json", import.meta.url), "utf8"))
  for (const { file, text, messages, moved, wrapped } of corpus.modules) {
    assert.equal(splitPlatform(text, file, ts), null, `${file}: no builtin import, and no global named`)
    const before = emit({ [file]: text })
    assert.deepEqual(before.errors, [], file)
    const result = splitPlatform(text, file, ts, { globals: platformGlobalsOf(messages) })
    assert.ok(result && !result.refused, result?.refused)
    assert.deepEqual(result.moved.sort(), moved.sort(), file)
    assert.deepEqual(result.wrapped.sort(), wrapped.sort(), file)
    const after = emit({ [file]: result.module, [platformPath(file)]: result.platform })
    assert.deepEqual(after.errors, [], result.module + "\n----\n" + result.platform)
    const dts = file.replace(/\.ts$/, ".d.ts").replace(/^.*\//, "")
    assert.equal(after.out[dts], before.out[dts], file)
    assert.ok(!/\bprocess\b/.test(result.module.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), result.module)
  }
})

// Modules of written functions, some reading process.env or process.kill:
// with process named, exactly the readers and the private helpers they read
// move, the rest stay, the declarations are stock TypeScript's of the
// original, and the module reads no process.
test("splitPlatform moves only the declarations that read a named host global", () => {
  const body = fc.constantFrom('process.env["HOME"] ?? ""', "String(process.kill(1, 0))", "String(1)", "s.trim()")
  const fn = fc.record({ exported: fc.boolean(), body, arrow: fc.boolean() })
  fc.assert(fc.property(fc.array(fn, { minLength: 1, maxLength: 6 }), (fns) => {
    const lines = []
    fns.forEach((f, i) => {
      const name = (f.exported ? "fn" : "helper") + i
      const exp = f.exported ? "export " : ""
      lines.push(f.arrow ? `${exp}const ${name} = (s: string): string => ${f.body} + s` : `${exp}function ${name}(s: string): string {\n  return ${f.body} + s\n}`)
    })
    lines.push(`export const all = (s: string): string => [${fns.map((f, i) => (f.exported ? "fn" : "helper") + i + "(s)").join(", ")}].join("")`)
    const text = lines.join("\n") + "\n"
    const before = emit({ "m.ts": text })
    fc.pre(before.errors.length === 0)
    const readers = fns.flatMap((f, i) => (f.body.includes("process") ? [(f.exported ? "fn" : "helper") + i] : []))
    const result = splitPlatform(text, "m.ts", ts, { globals: ["process"] })
    if (!readers.length) {
      assert.equal(result, null)
      return
    }
    assert.ok(result && !result.refused, result?.refused)
    assert.deepEqual(result.moved.sort(), readers.sort(), result.module)
    const after = emit({ "m.ts": result.module, "m.platform.ts": result.platform })
    assert.deepEqual(after.errors, [], result.module + "\n----\n" + result.platform)
    assert.equal(after.out["m.d.ts"], before.out["m.d.ts"], result.module)
    assert.ok(!/\bprocess\b/.test(result.module), result.module)
  }), { seed: 31109, numRuns: 40 })
})
