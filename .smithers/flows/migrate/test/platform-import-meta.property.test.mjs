import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { splitPlatform, splitBatchPlatform } from "../lib/platform.mjs"
import { prepareState, applyState } from "../lib/codemod-state.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-provider-import-meta.json", import.meta.url), "utf8"))
const alchemy = JSON.parse(readFileSync(new URL("./corpus/alchemy-import-meta-selectors.json", import.meta.url), "utf8"))
const js = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } }).outputText
const quotes = [
  "The quick fix moves the code into a sibling",
  "refuse with the not-fixed explanation if the move cannot preserve run phase, captures, receiver and public types",
  "\u0060import.meta\u0060 may appear only as the object of \u0060.url\u0060.",
]
// VIP-40's rule for code that needs module metadata.
const vipQuote = "A body that needs metadata receives it as an argument or lives in a \u0060.ts\u0060 file."
test("TestPlatformImportMetaQuoted", () => {
  const spec = readFileSync(SpecPath("005-services.md"), "utf8")
  for (const quote of quotes) assert.ok(spec.includes(quote), quote)
  const vip = readFileSync(new URL("../../../../docs/design/vips/0040-module-declarations.md", import.meta.url), "utf8")
  assert.ok(vip.includes(vipQuote), vipQuote)
})
test("minimal import.meta.resolve witness keeps the exported arrow in place", () => {
  const result = splitPlatform(corpus.minimal, "provider.ts", ts)
  assert.ok(result && !result.refused, JSON.stringify(result))
  assert.doesNotMatch(result.module, /import\.meta\.resolve/)
  assert.match(result.module, /export const resolvePackage/)
  assert.match(result.platform, /export function .*specifier: string.*: string/)
  assert.match(result.platform, /return import\.meta\.resolve\(specifier\)/)
})
const positions = [
  expression => "export const run = (specifier: string) => " + expression + ";",
  expression => "export function run(specifier: string) { try { return " + expression + " } catch { return undefined } }",
  expression => "export const run = (specifier: string) => () => " + expression + ";",
  expression => "export const run = (specifier: string) => { const later = () => " + expression + "; return later };",
  expression => "export const run = (specifier: string) => [0, " + expression + ", 2];",
]
// Each served member, its helper's base name and the call that replaces it.
// filename and dirname take the module's own URL (VIP-40: metadata is passed
// in); env and resolve read what every module of the build sees.
const served = {
  resolve: { helper: "$importMetaResolve", written: "import.meta.resolve(specifier)", call: h => h + "(specifier)" },
  filename: { helper: "$importMetaFilename", written: "import.meta.filename", call: h => h + "(import.meta.url)" },
  dirname: { helper: "$importMetaDirname", written: "import.meta.dirname", call: h => h + "(import.meta.url)" },
  env: { helper: "$importMetaEnv", written: "import.meta.env.API_URL", call: h => h + "().API_URL" },
}
const members = ["resolve", "dirname", "filename", "env", "url", "main"]
function checkMember(member, position, collision) {
  const expression = served[member]?.written ?? "import.meta." + member
  const prefix = collision && served[member] ? "const " + served[member].helper + " = 1;\n" : ""
  const source = prefix + positions[position](expression) + "\nexport const value = 1;\n"
  const split = splitPlatform(source, "provider.ts", ts)
  if (member === "url") { assert.equal(split, null); return }
  assert.ok(split, member + " must split or explain why not")
  // import.meta.main says whether this module is the entry; no argument carries that.
  if (member === "main") { assert.match(split.refused, /import\.meta/); return }
  assert.ok(!split.refused, split.refused)
  assert.doesNotMatch(split.module.replaceAll("import.meta.url", ""), /import\.meta/)
  const helper = /import \{ (\$\w+) \} from "\.\/provider\.platform\.ts"/.exec(split.module)?.[1]
  assert.ok(helper)
  // Only the member read changed: undoing it gives the source back.
  assert.equal(split.module.replace(/^import \{[^\n]+\n/, "").replaceAll(served[member].call(helper), expression), source)
  assert.equal(splitPlatform(split.module, "provider.ts", ts), null, "idempotent")
  if (collision) assert.notEqual(helper, served[member].helper)
}
test("import.meta members and call positions preserve calls or give a refusal", () => {
  for (const member of members)
    for (let position = 0; position < positions.length; position++) checkMember(member, position, false)
  fc.assert(fc.property(fc.constantFrom(...members),
    fc.integer({ min: 0, max: positions.length - 1 }), fc.boolean(), checkMember), { numRuns: 200, seed: 4402190 })
})
// What a companion cannot serve: a member that depends on the module in a
// way no argument carries, a write, a hidden member, a spread or extra input.
const refusedShapes = ["import.meta", 'import.meta["resolve"]("x")', 'import.meta["env"]', "import.meta.resolve", "import.meta.resolve?.('x')",
  "import.meta?.env", "import.meta.resolve(...args)", "import.meta.resolve('x', 'y', 'z')", "import.meta.main", "import.meta.hot",
  "import.meta.env = {}", "import.meta.env.KEY = 'x'", "import.meta.env.COUNT++", "delete import.meta.env.KEY", "import.meta.filename = 'x'",
  "[import.meta.dirname] = ['x']", "({ key: import.meta.env.KEY } = { key: 'x' })", "import.meta /* the env */ .env"]
test("unsupported import.meta shapes are refused without changing source", () => {
  for (const expression of refusedShapes) {
    const result = splitPlatform("export const f = () => " + expression, "provider.ts", ts)
    assert.match(result?.refused ?? "", /import\.meta/, expression)
  }
  fc.assert(fc.property(fc.constantFrom(...refusedShapes), fc.integer({ min: 0, max: positions.length - 1 }), (expression, position) => {
    const result = splitPlatform(positions[position](expression), "provider.ts", ts)
    assert.match(result?.refused ?? "", /import\.meta/, expression)
  }), { numRuns: 120, seed: 4402191 })
})
test("opencode provider corpus: no eager resolution, captures and catch stay in sync", () => {
  const result = splitPlatform(corpus.text, "provider.ts", ts)
  assert.ok(result && !result.refused, JSON.stringify(result))
  const originalBody = corpus.text.slice(corpus.text.indexOf("export const loadPackage"))
  const replacement = result.module.slice(result.module.indexOf("export const loadPackage"))
  const helper = /import \{ (\$\w+) \}/.exec(result.module)[1]
  assert.equal(replacement.replaceAll(helper + "(", "import.meta.resolve("), originalBody)
  assert.match(result.platform, /import\.meta\.resolve\(specifier\)/)
  assert.doesNotMatch(result.platform, /Effect|packageName|try\s*\{/)
})
test("batch journals fresh helper and blocks its new wildcard subpath", () => {
  const root = mkdtempSync(join(tmpdir(), "import-meta-journal-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/provider.ts"), corpus.minimal)
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "test", type: "module", exports: { "./*": { types: "./src/*.ts", default: "./src/*.ts" } } }))
    const state = prepareState(root, ["src/provider.ts"], ["src/provider.ts"], { ts })
    assert.equal(state.platform.splits.length, 1, JSON.stringify(state.platform))
    applyState(root, state)
    assert.match(readFileSync(join(root, "src/provider.platform.ts"), "utf8"), /import\.meta\.resolve/)
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).exports["./provider.platform"], null)
    assert.doesNotMatch(readFileSync(join(root, "src/provider.vibe"), "utf8"), /import\.meta\.resolve/)
    const saved = readFileSync(join(root, "src/provider.platform.ts"), "utf8")
    writeFileSync(join(root, "src/provider.ts"), corpus.minimal)
    const retry = splitBatchPlatform(root, ["src/provider.ts"], ts)
    assert.equal(retry.splits.length, 0)
    assert.match(retry.refused[0], /already exists/)
    assert.equal(readFileSync(join(root, "src/provider.platform.ts"), "utf8"), saved)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("resolver runtime keeps laziness, captured input and catch-undefined", async () => {
  const root = mkdtempSync(join(tmpdir(), "import-meta-runtime-"))
  try {
    const source = 'export const make = (specifier: string) => () => { try { return import.meta.resolve(specifier) } catch { return undefined } };\nexport const origin = import.meta.url;\n'
    const split = splitPlatform(source, "provider.ts", ts)
    const js = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(root, "provider.platform.mjs"), js(split.platform))
    writeFileSync(join(root, "provider.mjs"), js(split.module).replace("./provider.platform.ts", "./provider.platform.mjs"))
    const { make, origin } = await import("file://" + join(root, "provider.mjs"))
    assert.equal(origin, "file://" + join(root, "provider.mjs"), "url still denotes the caller")
    const later = make("package-that-does-not-exist-importmeta")
    assert.equal(typeof later, "function", "construction does not resolve or throw")
    assert.equal(later(), undefined, "the original catch handles resolution failure")
    assert.equal(make("node:fs")(), "node:fs")
    assert.equal(make("./neighbour.json")(), "file://" + join(root, "neighbour.json"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("wildcard exclusion refuses existing other-condition targets and reverses only its keys", async () => {
  const { restorePrivateResolverExports } = await import("../lib/import-meta-platform.mjs")
  for (const existing of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "import-meta-public-"))
    try {
      mkdirSync(join(root, "src")); mkdirSync(join(root, "lib"))
      const manifest = { name: "test", exports: { "./*": { types: "./src/*.ts", default: "./lib/*.js" } } }
      writeFileSync(join(root, "package.json"), JSON.stringify(manifest))
      writeFileSync(join(root, "src/provider.ts"), corpus.minimal)
      if (existing) writeFileSync(join(root, "lib/provider.platform.js"), "export const existing = 1")
      const result = splitBatchPlatform(root, ["src/provider.ts"], ts)
      if (existing) {
        assert.equal(result.splits.length, 0)
        assert.match(result.refused[0], /published module/)
        assert.equal(readFileSync(join(root, "src/provider.ts"), "utf8"), corpus.minimal)
      } else {
        assert.equal(result.splits.length, 1)
        const pkg = JSON.parse(readFileSync(join(root, "package.json")))
        assert.equal(pkg.exports["./provider.platform"], null)
        pkg.exports["./unrelated"] = "./src/other.ts"
        writeFileSync(join(root, "package.json"), JSON.stringify(pkg))
        restorePrivateResolverExports(root, result.splits[0])
        const after = JSON.parse(readFileSync(join(root, "package.json")))
        assert.equal(after.exports["./provider.platform"], undefined)
        assert.equal(after.exports["./unrelated"], "./src/other.ts")
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

test("stock TypeScript keeps the public declaration signature", () => {
  const root = mkdtempSync(join(tmpdir(), "import-meta-declarations-"))
  try {
    writeFileSync(join(root, "ambient.d.ts"), "interface ImportMeta { resolve(specifier: string): string }\n")
    const split = splitPlatform(corpus.minimal, "provider.ts", ts)
    const options = { strict: true, noUncheckedIndexedAccess: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], skipLibCheck: true, declaration: true,
      emitDeclarationOnly: true, allowImportingTsExtensions: true }
    const emit = (source, name) => {
      writeFileSync(join(root, name + ".ts"), source)
      const program = ts.createProgram([join(root, name + ".ts"), join(root, "ambient.d.ts")], options)
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
      let declaration
      program.emit(undefined, (path, text) => { if (path.endsWith("/" + name + ".d.ts")) declaration = text })
      return declaration
    }
    const before = emit(corpus.minimal, "before")
    writeFileSync(join(root, "provider.platform.ts"), split.platform)
    assert.equal(emit(split.module, "after"), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("ordinary builtin split shares the resolver companion without a self import", () => {
  const source = 'import { readFileSync } from "node:fs";\nexport function load(specifier: string): string { return readFileSync(import.meta.resolve(specifier), "utf8") }\nexport const value = 1;\n'
  const split = splitPlatform(source, "provider.ts", ts)
  assert.ok(split && !split.refused, JSON.stringify(split))
  assert.doesNotMatch(split.platform, /from "\.\/provider\.platform\.ts"/)
  assert.match(split.platform, /import\.meta\.resolve\(specifier\)/)
  assert.match(split.platform, /readFileSync\(\$importMetaResolve\(specifier\)/)
})

test("computed resolver inputs stay at the call site, in order, and resolve the same", async () => {
  // Nothing left in the module can write import.meta, so the helper's later
  // lookup of resolve is not observable: each input still runs once, first.
  const source = [
    "export const log: string[] = [];",
    "export const run = (name: string) => import.meta.resolve((log.push(\"input \" + name), \"./\" + name + \".json\"));",
    "export const local = (name: string) => import.meta.resolve(`./${name}${extension(import.meta.url)}`, import.meta.url);",
    "const extension = (url: string) => url.slice(url.lastIndexOf(\".\"));",
    ""].join("\n")
  const split = splitPlatform(source, "provider.ts", ts)
  assert.ok(split && !split.refused, JSON.stringify(split))
  assert.match(split.platform, /\.\.\.args: Parameters<ImportMeta\["resolve"\]>/)
  const root = mkdtempSync(join(tmpdir(), "import-meta-inputs-"))
  try {
    writeFileSync(join(root, "original.mjs"), js(source))
    writeFileSync(join(root, "provider.platform.mjs"), js(split.platform))
    writeFileSync(join(root, "provider.mjs"), js(split.module).replace("./provider.platform.ts", "./provider.platform.mjs"))
    const original = await import(pathToFileURL(join(root, "original.mjs")).href)
    const converted = await import(pathToFileURL(join(root, "provider.mjs")).href)
    for (const name of ["a", "b"]) assert.equal(converted.run(name), original.run(name))
    assert.deepEqual(converted.log, original.log)
    assert.deepEqual(converted.log, ["input a", "input b"])
    assert.equal(converted.local("x"), pathToFileURL(join(root, "x.mjs")).href)
    assert.equal(converted.local("x"), original.local("x"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("filename and dirname name the module itself, and stay undefined off file: URLs", async () => {
  const root = mkdtempSync(join(tmpdir(), "import-meta identity "))
  try {
    const source = "export const filename = import.meta.filename;\nexport const dirname = import.meta.dirname;\nexport const later = () => [import.meta.filename, import.meta.dirname];\n"
    const split = splitPlatform(source, "provider.ts", ts)
    assert.ok(split && !split.refused, JSON.stringify(split))
    writeFileSync(join(root, "original.mjs"), js(source))
    writeFileSync(join(root, "provider.platform.mjs"), js(split.platform))
    writeFileSync(join(root, "provider.mjs"), js(split.module).replace("./provider.platform.ts", "./provider.platform.mjs"))
    const original = await import(pathToFileURL(join(root, "original.mjs")).href)
    const converted = await import(pathToFileURL(join(root, "provider.mjs")).href)
    assert.equal(original.filename, join(root, "original.mjs"))
    assert.equal(converted.filename, join(root, "provider.mjs"), "the module, not its companion")
    assert.equal(converted.dirname, original.dirname)
    assert.deepEqual(converted.later(), [converted.filename, converted.dirname])
    const companion = await import(pathToFileURL(join(root, "provider.platform.mjs")).href)
    for (const url of ["data:text/javascript,0", "https://example.com/a.js", "node:fs"]) {
      assert.equal(companion.$importMetaFilename(url), undefined, url)
      assert.equal(companion.$importMetaDirname(url), undefined, url)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("stock TypeScript declares the same types for every served member", () => {
  const root = mkdtempSync(join(tmpdir(), "import-meta-members-"))
  try {
    writeFileSync(join(root, "ambient.d.ts"), [
      "interface ImportMetaEnv { readonly API_URL: string; readonly MODE: \"development\" | \"production\" }",
      "interface ImportMeta { url: string; resolve(specifier: string, parent?: string): string; filename: string; dirname: string; env: ImportMetaEnv }",
      "declare module \"node:url\" { export class URL { constructor(input: string, base?: string) }; export function fileURLToPath(url: string | URL): string }",
      "declare module \"node:path\" { export function dirname(path: string): string }",
      ""].join("\n"))
    const source = [
      "export const filename = import.meta.filename;",
      "export const dirname = import.meta.dirname;",
      "export const api = import.meta.env.API_URL;",
      "export const mode = import.meta.env.MODE;",
      "export const env = () => import.meta.env;",
      "export const local = (name: string) => import.meta.resolve(\"./\" + name, import.meta.url);",
      "export default class Job { readonly main = import.meta.filename; readonly options = { main: import.meta.filename, root: import.meta.dirname } }",
      ""].join("\n")
    const split = splitPlatform(source, "provider.ts", ts)
    assert.ok(split && !split.refused, JSON.stringify(split))
    const options = { strict: true, noUncheckedIndexedAccess: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts"], module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], skipLibCheck: true, declaration: true,
      emitDeclarationOnly: true, allowImportingTsExtensions: true }
    const emit = (text, name) => {
      writeFileSync(join(root, name + ".ts"), text)
      const program = ts.createProgram([join(root, name + ".ts"), join(root, "ambient.d.ts")], options)
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
      let declaration
      program.emit(undefined, (path, out) => { if (path.endsWith("/" + name + ".d.ts")) declaration = out })
      return declaration
    }
    const before = emit(source, "before")
    writeFileSync(join(root, "provider.platform.ts"), split.platform)
    assert.equal(emit(split.module, "after"), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("code that reads the module's location never moves to the companion", () => {
  const source = 'import { readFileSync } from "node:fs";\nexport const self = (): string => readFileSync(import.meta.filename, "utf8");\nexport const value = 1;\n'
  assert.match(splitPlatform(source, "provider.ts", ts).refused, /reads import\.meta, which would name provider\.platform\.ts/)
  const root = mkdtempSync(join(tmpdir(), "import-meta-identity-batch-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/provider.ts"), source)
    const result = splitBatchPlatform(root, ["src/provider.ts"], ts)
    assert.equal(result.splits.length, 0)
    assert.match(result.refused[0], /reads import\.meta/)
    assert.equal(readFileSync(join(root, "src/provider.ts"), "utf8"), source)
  } finally { rmSync(root, { recursive: true, force: true }) }
  // resolve and env are the same in the companion: such code moves and calls
  // the companion's own helpers, never the companion through itself.
  const both = 'import { readFileSync } from "node:fs";\nexport function read(): string { return readFileSync(import.meta.resolve(import.meta.env.FILE), "utf8") }\nexport const value = 1;\n'
  const split = splitPlatform(both, "provider.ts", ts)
  assert.ok(split && !split.refused, JSON.stringify(split))
  assert.doesNotMatch(split.platform, /from "\.\/provider\.platform\.ts"/)
  assert.match(split.platform, /readFileSync\(\$importMetaResolve\(\$importMetaEnv\(\)\.FILE\)/)
})

test("a private package with module bodies keeps the sibling when import.meta needs its helpers", () => {
  // A body cannot hold import.meta (EK4009): preferring one would leave the
  // filename read in the .vibe module.
  const source = 'import { readFileSync } from "node:fs";\nexport function load(path: string): string { return readFileSync(path, "utf8") }\nexport const main = import.meta.filename;\n'
  const root = mkdtempSync(join(tmpdir(), "import-meta-private-body-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", private: true, type: "module" }))
    writeFileSync(join(root, "src/provider.ts"), source)
    const result = splitBatchPlatform(root, ["src/provider.ts"], ts, { moduleBodies: true })
    assert.equal(result.splits.length, 1, JSON.stringify(result))
    assert.equal(result.splits[0].platform, "src/provider.platform.ts")
    const module = readFileSync(join(root, "src/provider.ts"), "utf8")
    assert.doesNotMatch(module.replaceAll("import.meta.url", ""), /import\.meta/)
    assert.match(module, /main = \$importMetaFilename\(import\.meta\.url\)/)
    assert.match(readFileSync(join(root, "src/provider.platform.ts"), "utf8"), /export function \$importMetaFilename/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("alchemy import.meta corpus: each module keeps its source apart from the member reads", () => {
  assert.ok(alchemy.cases.length >= 8)
  for (const { key, file, text } of alchemy.cases) {
    const split = splitPlatform(text, file, ts)
    assert.ok(split && !split.refused, key + ": " + JSON.stringify(split))
    assert.doesNotMatch(split.module.replaceAll("import.meta.url", ""), /import\.meta/, key)
    let back = split.module.replace(/^import \{[^\n]+\} from "\.\/[^"]+\.platform\.tsx?"\n/m, "")
    for (const [member, { call }] of Object.entries(served)) {
      const helper = new RegExp("\\" + served[member].helper + "\\d*").exec(split.module)?.[0]
      if (helper) back = back.replaceAll(member === "resolve" ? helper + "(" : member === "env" ? helper + "()" : call(helper), member === "resolve" ? "import.meta.resolve(" : member === "env" ? "import.meta.env" : "import.meta." + member)
    }
    assert.equal(back, text, key)
    assert.equal(splitPlatform(split.module, file, ts), null, key + " idempotent")
  }
})
