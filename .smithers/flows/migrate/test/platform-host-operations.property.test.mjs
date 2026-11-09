import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { splitBatchPlatform, splitPlatform, splitPlatformToModule } from "../lib/platform.mjs"
import { materialize, restore, statements } from "./helpers/host-operations-oracle.mjs"

// alchemy-platform-import-meta-moved-declaration: a declaration that reaches
// the platform and reads import.meta could not move. A module body cannot
// hold import.meta (EK4009), and a sibling's import.meta.url names the
// sibling, so the module stayed TypeScript, or, in the sibling split, the
// moved code silently named the companion. The declaration now stays where
// it is and only its host operations move into the body; the sibling split
// refuses a move that would rename the module.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-import-meta-moved-declaration.json", import.meta.url), "utf8"))
const js = (text) => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const split = (text, options = {}) => splitPlatformToModule(text, "src/x.ts", ts, options)

test("TestPlatformHostOperationsQuoted", () => {
  const vip = readFileSync(new URL("../../../../docs/design/vips/0040-module-declarations.md", import.meta.url), "utf8")
  for (const quote of ["A body that needs metadata receives it as an argument or lives in a `.ts` file.", "**`import.meta` is `EK4009` anywhere in a body.**"]) assert.ok(vip.includes(quote), quote)
  const spec = readFileSync(SpecPath("005-services.md"), "utf8")
  assert.ok(spec.includes("while preserving run phase, captures, receiver and public types"))
})

test("the minimal witness keeps its declaration and moves only the environment read", () => {
  const source = 'import * as Effect from "effect/Effect";\nconst options={main:import.meta.url,token:process.env.TOKEN};\nexport const program=Effect.succeed(options);\n'
  const result = split(source, { globals: ["process"] })
  assert.ok(result && !result.refused, JSON.stringify(result))
  assert.match(result.module, /^const options=\{main:import\.meta\.url,token:\$process_env_TOKEN\(\)\};$/m)
  assert.match(result.module, /^export const program=Effect\.succeed\(options\);$/m)
  const { body } = materialize(result.module)
  assert.doesNotMatch(body, /import\.meta/)
  assert.match(body, /export function \$process_env_TOKEN\(\) \{ return process\.env\.TOKEN \}/)
  assert.deepEqual(result.hostOperations, ["$process_env_TOKEN"])
})

test("kept declarations keep the module's URL, evaluation order, receivers and laziness", async () => {
  const source = [
    'import { fileURLToPath } from "node:url";',
    "export const log: string[] = [];",
    'const options = { main: import.meta.url, token: process.env.HOST_OPERATIONS_TOKEN, first: (log.push("options"), 1) };',
    'export const second = (log.push("second"), 2);',
    "export const read = () => options;",
    'export const file = fileURLToPath(new URL("./x.mjs", import.meta.url));',
    "export const id = (): string => crypto.randomUUID();",
    'export const kind = typeof Bun === "undefined" ? "node" : "bun";',
    "export const later = () => process.env.HOST_OPERATIONS_TOKEN;",
    "export const exit = (code: number) => { process.exitCode = code; return process.exitCode };",
    ""].join("\n")
  const result = split(source, { globals: ["process", "crypto", "Bun"] })
  assert.ok(result && !result.refused, JSON.stringify(result))
  const { body, module } = materialize(result.module)
  assert.doesNotMatch(body, /import\.meta/)
  const root = mkdtempSync(join(tmpdir(), "host-operations-"))
  const saved = process.env.HOST_OPERATIONS_TOKEN, exitCode = process.exitCode
  try {
    process.env.HOST_OPERATIONS_TOKEN = "first"
    writeFileSync(join(root, "original.mjs"), js(source))
    writeFileSync(join(root, "x.vibe.platform.mjs"), js(body))
    writeFileSync(join(root, "x.mjs"), js(module))
    const original = await import(pathToFileURL(join(root, "original.mjs")).href)
    const converted = await import(pathToFileURL(join(root, "x.mjs")).href)
    assert.equal(original.read().main, pathToFileURL(join(root, "original.mjs")).href)
    assert.equal(converted.read().main, pathToFileURL(join(root, "x.mjs")).href, "the module's URL, not its body's")
    assert.deepEqual(converted.log, ["options", "second"], "declarations evaluate in their own order")
    assert.deepEqual(converted.log, original.log)
    assert.equal(converted.read().token, "first")
    assert.equal(converted.file, join(root, "x.mjs"))
    assert.match(converted.id(), /^[0-9a-f-]{36}$/, "randomUUID keeps crypto as its receiver")
    assert.equal(converted.kind, original.kind)
    process.env.HOST_OPERATIONS_TOKEN = "later"
    assert.equal(converted.later(), "later", "a read runs when the module reaches it")
    assert.equal(converted.exit(7), 7)
    assert.equal(process.exitCode, 7)
  } finally {
    process.exitCode = exitCode
    if (saved === undefined) delete process.env.HOST_OPERATIONS_TOKEN
    else process.env.HOST_OPERATIONS_TOKEN = saved
    rmSync(root, { recursive: true, force: true })
  }
})

test("stock TypeScript declares the module the same, overloads, generics and assertions included", () => {
  const root = mkdtempSync(join(tmpdir(), "host-operations-dts-"))
  try {
    writeFileSync(join(root, "ambient.d.ts"), [
      "interface ImportMeta { url: string }",
      "interface URL { readonly href: string; readonly pathname: string }",
      "declare var URL: { new (url: string, base?: string): URL }",
      "declare const process: { env: Record<string, string | undefined>; exitCode?: number | string }",
      'declare module "node:url" { export function fileURLToPath(url: string | URL): string }',
      'declare module "node:fs" { interface Buffer { readonly length: number } export function readFileSync(path: string): Buffer; export function readFileSync(path: string, encoding: "utf8"): string }',
      'declare module "node:util" { export function promisify<T extends (...args: never[]) => unknown>(f: T): T }',
      'declare module "node:assert" { export function ok(value: unknown, message?: string): asserts value }',
      ""].join("\n"))
    const source = [
      'import { fileURLToPath } from "node:url";',
      'import * as NodeFs from "node:fs";',
      'import { promisify } from "node:util";',
      'import { ok } from "node:assert";',
      'export const here = fileURLToPath(new URL("./x", import.meta.url));',
      'export const text = NodeFs.readFileSync(new URL("./a", import.meta.url).pathname, "utf8");',
      'export const bytes = NodeFs.readFileSync(new URL("./a", import.meta.url).pathname);',
      "export const later = promisify((value: string) => value.length);",
      "export function check(value: string | undefined): string { ok(value, import.meta.url); return value }",
      "export const token = process.env.TOKEN;",
      "export type Reader = typeof NodeFs.readFileSync;",
      ""].join("\n")
    const result = split(source)
    assert.ok(result && !result.refused, JSON.stringify(result))
    const { body, module } = materialize(result.module, "./x.vibe.platform.ts")
    const options = { strict: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts"], module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], skipLibCheck: true, declaration: true,
      emitDeclarationOnly: true, allowImportingTsExtensions: true }
    const emit = (text, name) => {
      writeFileSync(join(root, name + ".ts"), text)
      const program = ts.createProgram([join(root, name + ".ts"), join(root, "ambient.d.ts")], options)
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], name)
      let declaration
      program.emit(undefined, (path, out) => { if (path.endsWith("/" + name + ".d.ts")) declaration = out })
      return declaration
    }
    // The module now imports node:fs for its type only. A declaration file's
    // import type and import mean the same (API identity compares names, types
    // and docs), so the comparison reads both as import.
    const before = emit(source, "before")
    writeFileSync(join(root, "x.vibe.platform.ts"), body)
    assert.equal(emit(module, "after").replace(/^import type /gm, "import "), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const refusals = [
  ["tagged template", 'import { sql } from "bun";\nexport const q = () => sql`select ${import.meta.url}`;\nexport const k = 1\n', /tags a template/, []],
  ["optional member call", 'import * as NodePath from "node:path";\nexport const p = () => NodePath.join?.(import.meta.url);\nexport const k = 1\n', /lose its receiver/, []],
  ["compound write", "export const f = () => { process.exitCode += 1; return import.meta.url };\nexport const k = 1\n", /written in place/, ["process"]],
  ["delete", "export const f = () => { delete process.env.X; return import.meta.url };\nexport const k = 1\n", /written in place/, ["process"]],
  ["re-export", 'import { sep } from "node:path";\nconst at = sep + import.meta.url;\nexport { sep, at };\n', /re-exports platform code/, []],
  ["default export", 'import { sep } from "node:path";\nexport const at = sep + import.meta.url;\nexport default sep;\n', /export default sep/, []],
]
test("a host constructor keeps its new expression beside the original module URL", () => {
  const result = split('import { Worker } from "node:worker_threads";\nexport const start = () => new Worker(new URL("./w.js", import.meta.url));\nexport const k = 1\n')
  assert.ok(result && !result.refused, JSON.stringify(result))
  assert.match(result.module, /new \(\$Worker\(\)\)\(new URL\("\.\/w.js", import\.meta\.url\)\)/)
  assert.match(materialize(result.module).body, /return Worker/)
})

test("host operations that cannot move alone keep the module in TypeScript, with the reason", () => {
  for (const [name, text, why, globals] of refusals) {
    const result = split(text, { globals })
    assert.match(result?.refused ?? "", /reads import\.meta, which a module body cannot \(EK4009\)/, name)
    assert.match(result.refused, why, name)
  }
})

test("the sibling split never moves a read of the module's URL", () => {
  const cases = [
    ["const options = { main: import.meta.url, token: process.env.TOKEN };\nexport const read = () => options;\n", false],
    ['import { readFileSync } from "node:fs";\nexport const self = (): string => readFileSync(import.meta.url, "utf8");\nexport const k = 1;\n', false],
    ['import { readFileSync } from "node:fs";\nexport function same(): string { return readFileSync(new URL("", import.meta.url), "utf8") }\nexport const k = 1;\n', false],
    ['import { readFileSync } from "node:fs";\nexport function query(): string { return readFileSync(new URL("?raw", import.meta.url), "utf8") }\nexport const k = 1;\n', false],
    // A path beside the module resolves the same from the sibling.
    ['import { readFileSync } from "node:fs";\nexport function load(): string { return readFileSync(new URL("./x.json", import.meta.url), "utf8") }\nexport const k = 1;\n', true],
    ['import { readFileSync } from "node:fs";\nexport function up(name: string): string { return readFileSync(new URL(`../${name}.json`, import.meta.url), "utf8") }\nexport const k = 1;\n', true],
    ['import { createRequire as make } from "node:module";\nexport function version(): string { return make(import.meta.url)("./package.json").version }\nexport const k = 1;\n', true],
  ]
  for (const [text, moves] of cases) {
    const result = splitPlatform(text, "src/x.ts", ts, { globals: ["process"] })
    if (moves) assert.ok(result && !result.refused && /import\.meta\.url/.test(result.platform), text + JSON.stringify(result))
    else assert.match(result?.refused ?? "", /reads import\.meta, which would name x\.platform\.ts after the move/, text)
  }
})

test("a wildcard package keeps the module with its body and a private companion for import.meta helpers", () => {
  const source = 'import * as Effect from "effect/Effect";\nconst options = { main: import.meta.url, token: process.env.TOKEN };\nexport const program = Effect.succeed(options);\nexport const loader = () => import.meta.resolve("vibelang/register");\n'
  for (const moduleBodies of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), "host-operations-batch-"))
    try {
      mkdirSync(join(root, "src"))
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", type: "module", exports: { "./*": "./src/*.ts" } }))
      writeFileSync(join(root, "src/input.ts"), source)
      const result = splitBatchPlatform(root, ["src/input.ts"], ts, { moduleBodies, globalsOf: () => ["process"] })
      if (!moduleBodies) {
        assert.equal(result.splits.length, 0)
        assert.match(result.refused[0], /would name input\.platform\.ts/)
        assert.equal(readFileSync(join(root, "src/input.ts"), "utf8"), source)
        continue
      }
      assert.equal(result.splits.length, 1, JSON.stringify(result))
      assert.equal(result.splits[0].platform, "src/input.platform.ts")
      assert.equal(result.splits[0].module, "platform")
      const written = readFileSync(join(root, "src/input.ts"), "utf8")
      const { body, module } = materialize(written)
      assert.doesNotMatch(body, /import\.meta/)
      assert.doesNotMatch(module.replaceAll("import.meta.url", ""), /import\.meta/)
      assert.match(module, /^const options = \{ main: import\.meta\.url, token: \$process_env_TOKEN\(\) \};$/m)
      assert.match(module, /^import \{ \$importMetaResolve \} from "\.\/input\.platform\.ts"$/m)
      assert.match(readFileSync(join(root, "src/input.platform.ts"), "utf8"), /return import\.meta\.resolve\(specifier\)/)
      assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports["./input.platform"], null)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})

// Host operations, the platform each needs and the text it should restore.
const operations = [
  { text: 'fileURLToPath(new URL("./a", import.meta.url))', imports: ['import { fileURLToPath } from "node:url";'] },
  { text: 'NodePath.join("a", "b")', imports: ['import * as NodePath from "node:path";'] },
  { text: "crypto.randomUUID()", globals: ["crypto"] },
  { text: "process.env.TOKEN", globals: ["process"] },
  { text: 'typeof Bun === "undefined"', globals: ["Bun"] },
  { text: "{ process }", globals: ["process"] },
  { text: "(process.exitCode = 1)", globals: ["process"] },
  { text: 'createRequire(import.meta.url)("./package.json")', imports: ['import { createRequire } from "node:module";'] },
]
const placements = [
  (i, op) => `const v${i} = ${op};\nexport const r${i} = () => v${i};`,
  (i, op) => `export const v${i} = () => ${op};`,
  (i, op) => `export class C${i} { readonly field = ${op}; readonly at = import.meta.url }`,
  (i, op) => `export const v${i} = [${op}, import.meta.url];`,
  (i, op) => `export function f${i}(): unknown { const inner = () => ${op}; return inner() }`,
  (i, op) => `export const m${i} = Make("m${i}", { main: import.meta.url, value: ${op} });`,
]
test("host operations in any placement move alone, and undoing them restores the module", () => {
  fc.assert(fc.property(fc.array(fc.record({ op: fc.integer({ min: 0, max: operations.length - 1 }), at: fc.integer({ min: 0, max: placements.length - 1 }) }), { minLength: 1, maxLength: 5 }), (picks) => {
    // The first placement always reads import.meta, so the module keeps its declarations.
    const chosen = [{ op: picks[0].op, at: 3 }, ...picks.slice(1)]
    const imports = [...new Set(chosen.flatMap((p) => operations[p.op].imports ?? []))]
    const globals = [...new Set(chosen.flatMap((p) => operations[p.op].globals ?? []))]
    const source = [...imports, ...chosen.map((p, i) => placements[p.at](i, operations[p.op].text)), ""].join("\n")
    const result = split(source, { globals })
    assert.ok(result && !result.refused, source + "\n" + JSON.stringify(result))
    const { body, module } = materialize(result.module)
    assert.doesNotMatch(body, /import\.meta/)
    assert.doesNotMatch(module, /^import (?!type)[^\n]* from "node:/m, "no builtin value import stays in the module")
    for (const text of [body, module]) assert.deepEqual(ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true).parseDiagnostics.map((d) => d.messageText), [])
    assert.deepEqual(statements(restore(result.module)), statements(source))
  }), { numRuns: 250, seed: 4009402 })
})

test("alchemy corpus: each moved-declaration witness keeps its module and moves only host operations", () => {
  assert.ok(corpus.cases.length >= 7)
  for (const { key, file, text, globals, package: layout } of corpus.cases) {
    const root = mkdtempSync(join(tmpdir(), "host-operations-corpus-"))
    try {
      mkdirSync(join(root, dirname(file)), { recursive: true })
      writeFileSync(join(root, "package.json"), JSON.stringify(layout === "private" ? { name: "example", private: true, type: "module" } : { name: "example", type: "module", exports: { "./*": "./src/*.ts" } }))
      writeFileSync(join(root, file), text)
      const result = splitBatchPlatform(root, [file], ts, { moduleBodies: true, globalsOf: () => globals })
      assert.equal(result.splits.length, 1, key + ": " + JSON.stringify(result))
      const written = readFileSync(join(root, file), "utf8")
      // A module keeps a body when a declaration that reaches the platform reads
      // its URL; a sibling alone serves code that no longer reads import.meta.
      const { body, module } = written.includes("module platform {\n") ? materialize(written) : { body: "", module: written }
      assert.doesNotMatch(body, /import\.meta/, key)
      assert.doesNotMatch(module.replaceAll("import.meta.url", ""), /import\.meta/, key)
      assert.doesNotMatch(module, /^import (?!type)[^\n]* from "node:/m, key)
      const sibling = result.splits[0].platform ? readFileSync(join(root, result.splits[0].platform), "utf8") : ""
      for (const line of sibling.split("\n").filter((l) => l.includes("import.meta"))) {
        assert.match(line, /^export function \$importMeta\w+\(/, key + ": only the import.meta helpers read import.meta in the companion")
      }
      if (body) assert.equal((module.match(/import\.meta\.url/g) ?? []).length, (text.match(/import\.meta\.url/g) ?? []).length, key + ": every module URL read stays")
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})
