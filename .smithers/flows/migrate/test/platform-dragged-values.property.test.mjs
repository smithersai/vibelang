import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { splitBatchPlatform, splitPlatform, splitPlatformToModule } from "../lib/platform.mjs"
import { materialize, restore, statements } from "./helpers/host-operations-oracle.mjs"

// alchemy-platform-dual-value-type: a provider that reads the host moved to a
// body with every declaration it reads, so a resource value and its
// same-named type moved too, the module was left with no value of its own,
// and it stayed TypeScript. The sibling split refused the same module, since
// the value would move without its type. The module now keeps its
// declarations, both namespaces of the name included, and only the host
// operations move. The sibling split now serves such a module by moving the
// value and its type together and re-exporting them; with module bodies the
// batch prefers the body, which keeps them. A module whose every value
// reaches the platform is platform code and still stays TypeScript.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-platform-dual-value-type.json", import.meta.url), "utf8"))
const split = (text, options = {}) => splitPlatformToModule(text, "src/x.ts", ts, options)

const image = [
  'import * as Effect from "effect/Effect";',
  "export interface Image { readonly kind: \"image\"; readonly tag: string }",
  'export const Image = Resource<Image>("Docker.Image");',
  "export const ImageProvider = () => Provider.effect(Image, Effect.gen(function* () {",
  "  const cwd = yield* Effect.sync(() => process.cwd());",
  "  return { cwd };",
  "}));",
  ""].join("\n")

test("a resource value and its type stay beside the provider; only the host read moves", () => {
  assert.deepEqual(splitPlatform(image, "src/x.ts", ts, { globals: ["process"] }).reexported, ["Image"])
  // A published package the sibling may serve: with bodies the batch keeps Image in the module.
  for (const moduleBodies of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), "dragged-values-prefer-"))
    try {
      mkdirSync(join(root, "src"), { recursive: true })
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", type: "module", exports: { ".": "./src/x.ts" } }))
      writeFileSync(join(root, "src/x.ts"), image)
      const batch = splitBatchPlatform(root, ["src/x.ts"], ts, { moduleBodies, globalsOf: () => ["process"] })
      assert.equal(batch.splits.length, 1, JSON.stringify(batch))
      assert.equal(batch.splits[0].platform, moduleBodies ? null : "src/x.platform.ts", JSON.stringify(batch))
      if (moduleBodies) assert.match(materialize(readFileSync(join(root, "src/x.ts"), "utf8")).module, /^export const Image = Resource<Image>\("Docker\.Image"\);$/m)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
  const result = split(image, { globals: ["process"] })
  assert.ok(result && !result.refused, JSON.stringify(result))
  const { body, module } = materialize(result.module)
  assert.match(module, /^export interface Image \{/m)
  assert.match(module, /^export const Image = Resource<Image>\("Docker\.Image"\);$/m)
  assert.match(module, /Effect\.sync\(\(\) => \$process_cwd\(\)\)/)
  assert.match(body, /^export const \$process_cwd: typeof process\.cwd = /m)
  assert.deepEqual(statements(restore(result.module)), statements(image))
})

test("a module whose every value reaches the platform is still platform code", () => {
  for (const text of [
    'import { sep } from "node:path"\nexport const a = sep\n',
    'import * as Effect from "effect/Effect";\nexport interface Value { readonly name: string; }\nexport const Value = Effect.sync(() => process.env.NAME);\n',
  ]) assert.match(split(text, { globals: ["process"] }).refused, /platform code only/, text)
})

test("a module with another value of its own keeps the whole move", () => {
  const result = split(image + 'export const label = "docker";\n', { globals: ["process"] })
  assert.ok(result && !result.refused, JSON.stringify(result))
  assert.equal(result.hostOperations, undefined)
  assert.match(result.module, /^export \{ Image, ImageProvider \} from platform$/m)
})

test("stock TypeScript declares both namespaces of the name the same", () => {
  const root = mkdtempSync(join(tmpdir(), "dragged-values-dts-"))
  try {
    writeFileSync(join(root, "ambient.d.ts"), [
      "declare const process: { cwd(): string }",
      "declare function Resource<T>(kind: string): { readonly kind: string; readonly of?: T }",
      'declare namespace Provider { function effect<A, B>(resource: A, build: B): { resource: A; build: B } }',
      'declare module "effect/Effect" { interface Yieldable<A> { [Symbol.iterator](): Generator<unknown, A, unknown> } export function sync<A>(f: () => A): Yieldable<A>; export function gen<A>(f: () => Generator<unknown, A, unknown>): Yieldable<A> }',
      ""].join("\n"))
    const result = split(image, { globals: ["process"] })
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
    const before = emit(image, "before")
    writeFileSync(join(root, "x.vibe.platform.ts"), body)
    assert.equal(emit(module, "after"), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// A same-named value and type, readers of the value that reach the host, and
// optional values that reach nothing.
const hosts = [
  { text: "process.cwd()", globals: ["process"] },
  { text: 'createHash("sha256").update(input).digest("hex")', imports: ['import { createHash } from "node:crypto";'] },
  { text: "process.env.TOKEN", globals: ["process"] },
  { text: 'NodePath.resolve(process.cwd(), "x")', imports: ['import * as NodePath from "node:path";'], globals: ["process"] },
]
const typeForms = [
  (n) => `export interface ${n} { readonly kind: "${n}" }`,
  (n) => `export type ${n} = { readonly kind: "${n}" };`,
]
test("dragged values stay in any arrangement, and undoing the host operations restores the module", () => {
  fc.assert(fc.property(
    fc.constantFrom("Image", "Contract", "Gateway"), fc.integer({ min: 0, max: typeForms.length - 1 }),
    fc.array(fc.integer({ min: 0, max: hosts.length - 1 }), { minLength: 1, maxLength: 3 }), fc.boolean(),
    (name, form, picks, helper) => {
      const imports = [...new Set(picks.flatMap((i) => hosts[i].imports ?? []))]
      const globals = [...new Set(picks.flatMap((i) => hosts[i].globals ?? []))]
      const source = [
        ...imports,
        typeForms[form](name),
        `export const ${name} = Resource<${name}>("Example.${name}");`,
        // A private value the providers read is dragged as well.
        ...(helper ? ["const label = \"example\";"] : []),
        ...picks.map((i, k) => `export const provide${k} = (input: string) => Provider.effect(${name}, Effect.sync(() => [input, ${helper ? "label, " : ""}${hosts[i].text}]));`),
        ""].join("\n")
      const result = split(source, { globals })
      assert.ok(result && !result.refused, source + "\n" + JSON.stringify(result))
      const { body, module } = materialize(result.module)
      assert.match(module, new RegExp("^export (interface|type) " + name + "\\b", "m"))
      assert.match(module, new RegExp("^export const " + name + " = Resource<", "m"))
      assert.doesNotMatch(module, /^import (?!type)[^\n]* from "node:/m)
      assert.ok(result.hostOperations.length >= 1)
      for (const text of [body, module]) assert.deepEqual(ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true).parseDiagnostics.map((d) => d.messageText), [])
      assert.deepEqual(statements(restore(result.module)), statements(source))
    }), { numRuns: 200, seed: 4402505 })
})

test("alchemy corpus: each dual value/type module keeps both namespaces and moves only host operations", () => {
  assert.ok(corpus.cases.length >= 4)
  for (const { key, file, text, globals, names } of corpus.cases) {
    for (const moduleBodies of [true, false]) {
      const root = mkdtempSync(join(tmpdir(), "dragged-values-corpus-"))
      try {
        mkdirSync(join(root, dirname(file)), { recursive: true })
        writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", type: "module", exports: { "./*": "./src/*.ts" } }))
        writeFileSync(join(root, file), text)
        const result = splitBatchPlatform(root, [file], ts, { moduleBodies, globalsOf: () => globals })
        if (!moduleBodies) {
          assert.equal(result.splits.length, 0, key)
          assert.equal(readFileSync(join(root, file), "utf8"), text, key)
          continue
        }
        assert.equal(result.splits.length, 1, key + ": " + JSON.stringify(result))
        const written = readFileSync(join(root, file), "utf8")
        const { body, module } = materialize(written)
        for (const name of names) {
          assert.match(module, new RegExp("^export (interface|type) " + name + "\\b", "m"), key)
          assert.match(module, new RegExp("^export const " + name + " = ", "m"), key)
        }
        assert.doesNotMatch(module, /^import (?!type)[^\n]* from "node:/m, key)
        assert.doesNotMatch(body, /import\.meta/, key)
        assert.deepEqual(statements(restore(written)), statements(text), key)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  }
})
