import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import fc from "fast-check"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const require = createRequire(new URL("../../../experiments/package.json", import.meta.url))
const ts = require("typescript")
const skip = !existsSync(binary) && "build the native compiler first"
// Captured from published vibelang@0.0.8; regenerate with that release only.
const goldens = JSON.parse(readFileSync(new URL("./fixtures/smithers-native-readonly-upgrade.json", import.meta.url), "utf8"))

function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-legacy-readonly-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [],
    rootDir: "src", outDir: "out", declaration: true, emitDeclarationOnly: true
  }, include: ["src"] }))
  return root
}
function run(root, ...flags) {
  const result = spawnSync(binary, ["-p", ".", "--pretty", "false", ...flags], { cwd: root, encoding: "utf8", timeout: 30000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result
}

// Chapter 7, fix-scopes: "Ordinary native members outside these declarations
// keep their written modifiers". The historical release output is an archive,
// not the oracle for current native TypeScript interfaces and object types.
function declarations(root) {
  return Object.fromEntries(readdirSync(join(root, "out")).filter(name => name.endsWith(".d.ts"))
    .sort().map(name => [name, readFileSync(join(root, "out", name), "utf8")]))
}
function twinDeclarations(root, files) {
  for (const [name, source] of Object.entries(files)) writeFileSync(join(root, "src", name), source)
  const parsed = ts.parseJsonConfigFileContent(JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")), ts.sys, root)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const emitted = program.emit()
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics]
  assert.equal(diagnostics.length, 0, ts.formatDiagnostics(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => "\n"
  }))
  assert.equal(emitted.emitSkipped, false)
  return declarations(root)
}
function currentTwin(key, source) {
  // VIP-40 encodes uppercase N as -4e- in the emitted body filename.
  if (key === "module-control") return {
    "a.ts": 'import { Shape } from "./a.vibe.-4e-ative.js"\nexport type Public = Shape\n',
    "a.vibe.-4e-ative.ts": "export interface Shape { value: number }\n"
  }
  // The legacy modifier is erased; a property named `mutable` is untouched.
  return { "a.ts": source.replace(/\bmutable (?=(?:open|x):)/g, "") }
}
function checkNativeUpgrade(t, key, source, files, exactOptionalPropertyTypes = false) {
  const root = project(t)
  const twin = project(t)
  for (const dir of [root, twin]) {
    const config = JSON.parse(readFileSync(join(dir, "tsconfig.json"), "utf8"))
    config.compilerOptions.exactOptionalPropertyTypes = exactOptionalPropertyTypes
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(config))
  }
  const expected = twinDeclarations(twin, files)
  writeFileSync(join(root, "src/a.vibe"), source)
  let fixed
  for (let repeat = 0; repeat < 2; repeat++) {
    run(root, "--fix", "--fix-migration-only")
    const actual = declarations(root)
    // VIP-27 permits this generated contract on local plain callables. These
    // fixtures contain no authored documentation; every other byte is compared.
    for (const name of Object.keys(actual)) actual[name] = actual[name].replace(/\/\*\*\s*@throws \{never\}\s*\*\/\s*/g, "")
    assert.deepEqual(actual, expected, key + " must preserve the TypeScript twin's modifiers")
    const text = readFileSync(join(root, "src/a.vibe"), "utf8")
    if (fixed !== undefined) assert.equal(text, fixed, key + " must reach a fixed point")
    fixed = text
  }
}

test("explicit readonly upgrade keeps every historical native example's TypeScript modifiers", { skip, timeout: 120000 }, t => {
  assert.equal(ts.version, "5.9.3")
  for (const [key, row] of Object.entries(goldens)) checkNativeUpgrade(t, key, row.source, currentTwin(key, row.source))
})

test("property: explicit migration preserves native readonly and writable members at every nesting level", { skip, timeout: 180000 }, t => {
  fc.assert(fc.property(fc.record({
    form: fc.constantFrom("interface", "object", "index", "mapped", "class", "namespace"),
    readonly: fc.boolean(), nestedReadonly: fc.boolean(), optional: fc.boolean(),
    exact: fc.boolean(), type: fc.constantFrom("number", "string", "readonly number[]")
  }), input => {
    const field = `${input.readonly ? "readonly " : ""}field${input.optional ? "?" : ""}: { ${input.nestedReadonly ? "readonly " : ""}value: ${input.type} }`
    const source = input.form === "interface" ? `export interface Shape { ${field} }\n`
      : input.form === "object" ? `export type Shape = { ${field} }\n`
      : input.form === "index" ? `export interface Shape { ${input.readonly ? "readonly " : ""}[key: string]: { ${field} } }\n`
      : input.form === "mapped" ? `export type Shape<A> = { ${input.readonly ? "readonly " : ""}[K in keyof A]: { ${field} } }\n`
      : input.form === "class" ? `export class Shape { declare ${field} }\n`
      : `export namespace N { export interface Shape { ${field} } }\n`
    checkNativeUpgrade(t, JSON.stringify(input), source, { "a.ts": source }, input.exact)
  }), { seed: 8008, numRuns: 24, examples: [
    [{ form: "interface", readonly: false, nestedReadonly: true, optional: true, exact: true, type: "number" }],
    [{ form: "mapped", readonly: true, nestedReadonly: false, optional: false, exact: false, type: "string" }]
  ] })
})

test("ordinary checking and fixes keep native members writable", { skip }, (t) => {
  const root = project(t)
  const source = 'export interface Options { name: string }\nexport function change(o: Options): void { o.name = "next" }\n'
  writeFileSync(join(root, "src/a.vibe"), source)
  for (const flags of [[], ["--fix"], ["--fix", "--fix-vip-only"]]) {
    run(root, ...flags)
    assert.equal(readFileSync(join(root, "src/a.vibe"), "utf8"), source)
  }
})

test("explicit migration leaves plain TypeScript properties writable", { skip }, (t) => {
  const root = project(t)
  const source = 'export interface Options { name: string }\n'
  writeFileSync(join(root, "src/a.ts"), source)
  run(root, "--fix", "--fix-migration-only")
  assert.equal(readFileSync(join(root, "src/a.ts"), "utf8"), source)
})
