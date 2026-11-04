import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { splitPlatform, splitBatchPlatform } from "../lib/platform.mjs"
import { prepareState, applyState } from "../lib/codemod-state.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-provider-import-meta.json", import.meta.url), "utf8"))
const quotes = [
  "The quick fix and the codemod move the code into a sibling",
  "refuse with the not-fixed explanation if the move cannot preserve run phase, captures, receiver and public types",
  "\u0060import.meta\u0060 may appear only as the object of \u0060.url\u0060.",
]
test("TestPlatformImportMetaQuoted", () => {
  const spec = readFileSync(SpecPath("005-services.md"), "utf8")
  for (const quote of quotes) assert.ok(spec.includes(quote), quote)
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
function checkMember(member, position, collision) {
  const expression = member === "resolve" ? "import.meta.resolve(specifier)" : "import.meta." + member
  const prefix = collision ? "const $importMetaResolve = 1;\n" : ""
  const source = prefix + positions[position](expression) + "\nexport const value = 1;\n"
  const split = splitPlatform(source, "provider.ts", ts)
  if (member === "url") { assert.equal(split, null); return }
  assert.ok(split, member + " must split or explain why not")
  if (member !== "resolve") { assert.match(split.refused, /import\.meta/); return }
  assert.ok(!split.refused, split.refused)
  assert.doesNotMatch(split.module, /import\.meta\.resolve/)
  const helper = /import \{ (\$\w+) \} from "\.\/provider\.platform\.ts"/.exec(split.module)?.[1]
  assert.ok(helper)
  assert.equal(split.module.replace(/^import \{[^\n]+\n/, "").replaceAll(helper + "(", "import.meta.resolve("), source)
  assert.equal(splitPlatform(split.module, "provider.ts", ts), null, "idempotent")
  if (collision) assert.notEqual(helper, "$importMetaResolve")
}
test("import.meta members and call positions preserve calls or give a refusal", () => {
  for (const member of ["resolve", "dirname", "filename", "env", "url"])
    for (let position = 0; position < positions.length; position++) checkMember(member, position, false)
  fc.assert(fc.property(fc.constantFrom("resolve", "dirname", "filename", "env", "url"),
    fc.integer({ min: 0, max: positions.length - 1 }), fc.boolean(), checkMember), { numRuns: 150, seed: 4402190 })
})
test("unsupported import.meta shapes are refused without changing source", () => {
  for (const expression of ["import.meta", 'import.meta["resolve"]("x")', "import.meta.resolve", "import.meta.resolve?.('x')", "import.meta.resolve(...args)", "import.meta.resolve('x', 'y')", "import.meta.resolve(next())", "import.meta.resolve(specifier++)"]) {
    const result = splitPlatform("export const f = () => " + expression, "provider.ts", ts)
    assert.match(result?.refused ?? "", /import\.meta/, expression)
  }
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
    const options = { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
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

test("runtime resolver lookup precedes argument effects, so effectful inputs refuse", () => {
  const source = 'export const resolve = () => import.meta.resolve((tick(), "node:fs"));'
  assert.match(splitPlatform(source, "provider.ts", ts).refused, /identifier or literal/)
})
