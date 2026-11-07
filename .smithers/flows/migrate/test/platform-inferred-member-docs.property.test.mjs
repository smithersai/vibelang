import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { compareApiIdentity } from "../../../../scripts/api-identity.mjs"

const { splitPlatform, splitPlatformToModule } = await import(process.env.PLATFORM_DOCS_UNDER_TEST ?? "../lib/platform.mjs")
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const modules = fileURLToPath(new URL("../../../../packages/runtime/node_modules", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-inferred-member-docs.json", import.meta.url), "utf8"))
const options = { strict: true, allowImportingTsExtensions: true, declaration: true, emitDeclarationOnly: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true, types: ["node"], typeRoots: [join(modules, "@types")] }

function write(root, name, text) {
  mkdirSync(dirname(join(root, name)), { recursive: true })
  writeFileSync(join(root, name), text)
}

// A VIP-40 body is an independent TypeScript module. This twin uses that
// boundary, then asks stock TypeScript and the public API oracle about docs.
function moduleTwin(result) {
  const source = ts.createSourceFile("index.ts", result.module, ts.ScriptTarget.Latest, true)
  const body = source.statements.find(node => ts.isModuleDeclaration(node) && node.name.getText(source) === result.name)
  assert.ok(body && ts.isModuleBlock(body.body), "the split must contain its named body")
  return {
    "helper.ts": source.text.slice(body.body.getStart(source) + 1, body.body.end - 1),
    "index.ts": (source.text.slice(0, body.pos) + source.text.slice(body.end)).replaceAll("from " + result.name, 'from "./helper.js"'),
  }
}

function emit(root, files) {
  write(root, "package.json", JSON.stringify({ type: "module", types: "dist/index.d.ts" }))
  symlinkSync(modules, join(root, "node_modules"), "dir")
  for (const [name, text] of Object.entries(files)) write(root, "src/" + name, text)
  const program = ts.createProgram(Object.keys(files).map(name => join(root, "src", name)), { ...options, rootDir: join(root, "src"), outDir: join(root, "dist") })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], "the stock TypeScript twin must compile")
  const emitted = program.emit()
  assert.equal(emitted.emitSkipped, false)
}

function check(source, kind = "body") {
  const root = mkdtempSync(join(tmpdir(), "platform-member-docs-"))
  try {
    const result = kind === "body" ? splitPlatformToModule(source, "src/index.ts", ts) : splitPlatform(source, "src/index.ts", ts)
    assert.ok(result && !result.refused, result?.refused)
    const files = kind === "body" ? moduleTwin(result) : { "index.ts": result.module, "index.platform.ts": result.platform }
    emit(join(root, "before"), { "index.ts": source })
    assert.match(readFileSync(join(root, "before/dist/index.d.ts"), "utf8"), /Read decoded bytes\./, "the native declaration must expose the member documentation")
    emit(join(root, "after"), files)
    const comparison = compareApiIdentity(ts, join(root, "before"), join(root, "after"), { compilerOptions: { types: [], lib: ["lib.es2022.d.ts"] } })
    assert.equal(comparison.comparisonComplete, true, JSON.stringify(comparison))
    assert.deepEqual(comparison.environmentDiagnostics, [])
    assert.equal(comparison.identical, true, JSON.stringify({ names: comparison.nameDifferences, types: comparison.typeDifferences, docs: comparison.docDifferences }))
    return { result, files }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a platform factory keeps inferred exported member documentation", () => {
  check(corpus.source)
})

test("a private platform factory keeps docs across a sibling module", () => {
  check(corpus.source.replace("export const make", "const make"), "sibling")
})

test("the platform factory call and declaration order stay unchanged", () => {
  const { result } = check(corpus.source.replace("export const api = make()", 'export const api /* keep this comment */ = make()'))
  assert.match(result.module, /api\s*:\s*ReturnType<typeof make>\s*\/\* keep this comment \*\/\s*=\s*make\(\)/)
  assert.ok(result.kept.includes("api"), "the initializer must remain outside the body")
  assert.ok(result.module.indexOf("export const pure") < result.module.indexOf("export const api"))
})

test("documented generic factories refuse a split that cannot retain the inferred type", () => {
  const source = corpus.source.replace("make = ()", "make = <T>(value: T)").replace('read: () => EOL', 'read: () => ({ value, EOL })').replace("api = make()", "api = make(1)")
  const result = splitPlatformToModule(source, "src/index.ts", ts)
  assert.match(result?.refused ?? "", /inferred.*documentation|documentation.*inferred/)
})

test("documented overloads retain their native module", () => {
  const source = 'import { EOL } from "node:os"\n' +
    'export function make(value: string): { /** Read decoded bytes. */ read: () => string }\n' +
    'export function make(value: number): { /** Read decoded bytes. */ read: () => number }\n' +
    'export function make(value: string | number) { return {\n/** Read decoded bytes. */\nread: () => typeof value === "string" ? value + EOL : value } }\n' +
    'export const pure = 1\nexport const api = make("value")\n'
  const result = splitPlatformToModule(source, "src/index.ts", ts)
  assert.match(result?.refused ?? "", /overloaded/)
})

test("a shadowed ReturnType receives a preserving refusal", () => {
  const source = "type ReturnType<T> = string\n" + corpus.source
  const result = splitPlatformToModule(source, "src/index.ts", ts)
  assert.match(result?.refused ?? "", /ReturnType/)
})

test("a value named ReturnType does not shadow the utility type", () => {
  check("export const ReturnType = 1\n" + corpus.source)
})

test("several inferred bindings retain their individual factory docs", () => {
  check(corpus.source.replace("export const api = make()", "export const api = make(), another = make()"))
})

test("written result annotations and undocumented factories retain their source", () => {
  const written = corpus.source.replace("api = make()", "api: { read: () => string } = make()")
  const result = splitPlatformToModule(written, "src/index.ts", ts)
  assert.ok(!result.refused)
  assert.match(result.module, /api: \{ read: \(\) => string \} = make\(\)/)
  const plain = splitPlatformToModule(corpus.source.replace("/** Read decoded bytes. */", ""), "src/index.ts", ts)
  assert.ok(!plain.refused)
  assert.doesNotMatch(plain.module, /ReturnType/)
})

test("generated concrete factory exports preserve nested member docs and types", () => {
  fc.assert(fc.property(fc.record({
    factory: fc.constantFrom("make", "createClient", "readFactory"),
    binding: fc.constantFrom("api", "client", "value"),
    member: fc.constantFrom("read", "bytes", "decode"),
    nested: fc.boolean(),
    functionDeclaration: fc.boolean(),
    argument: fc.boolean(),
  }), settings => {
    const { factory, binding, member, nested, functionDeclaration, argument } = settings
    const item = `\n/** Read decoded bytes. */\n${member}: () => EOL\n`
    const returned = nested ? `{ nested: { ${item} } }` : `{ ${item} }`
    const parameters = argument ? "options: { enabled?: boolean } = {}" : ""
    const expression = argument ? `(options.enabled ? ${returned} : ${returned})` : returned
    const declaration = functionDeclaration
      ? `export function ${factory}(${parameters}) { return ${expression} }`
      : `export const ${factory} = (${parameters}) => (${expression})`
    const source = `import { EOL } from "node:os"\n${declaration}\nexport const pure = 1\nexport const ${binding} = ${factory}(${argument ? "{ enabled: true }" : ""})\n`
    check(source)
  }), { seed: 561136, numRuns: 24 })
})

test("the generated body and kept initializer compile as VibeLang", { skip: !process.env.VIBELANG_BINARY }, () => {
  const root = mkdtempSync(join(tmpdir(), "platform-docs-compile-"))
  try {
    symlinkSync(modules, join(root, "node_modules"), "dir")
    write(root, "package.json", '{"type":"module"}')
    write(root, "index.vibe", splitPlatformToModule(corpus.source, "index.ts", ts).module)
    write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, types: ["node"] }, files: ["index.vibe"] }))
    const result = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 90000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
