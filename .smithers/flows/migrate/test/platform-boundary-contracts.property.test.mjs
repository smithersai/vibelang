import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const native = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const effect = fileURLToPath(new URL("../../../../experiments/node_modules/effect", import.meta.url))
const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
const moveQuote = "The quick fix and the codemod move the code into a sibling"
const pragma = "// @effect-diagnostics nodeBuiltinImport:off -- approved existing TypeScript platform boundary"
const corpora = ["t3code-platform-split-file-pragmas.json", "t3code-platform-split-schema-value-import.json"]
  .map(name => JSON.parse(readFileSync(new URL("./corpus/" + name, import.meta.url), "utf8")))
function sourceOf(input) {
  const gap = input.detached ? input.newline.repeat(input.blank) : input.newline
  const head = pragma + gap
  if (input.kind === "pragma") return head + 'import { readFileSync } from "node:fs";' + input.newline +
    'export function read(path: string): string { return readFileSync(path, "utf8"); }' + input.newline
  const typeName = input.collision ? input.name : "Public" + input.name
  return head + 'import { existsSync } from "node:fs";\nimport * as Schema from "effect/Schema";\nconst ' + input.name +
    " = Schema.String;\nexport type " + typeName + " = typeof " + input.name +
    '.Type;\nconst decode = Schema.decodeUnknownSync(Schema.fromJsonString(' + input.name +
    '));\nexport function read(path: string): ' + typeName + ' { existsSync(path); return decode(\'"x"\'); }\n'
}
function check(input) {
  const root = mkdtempSync(join(tmpdir(), "platform-boundary-contract-"))
  try {
    mkdirSync(join(root, "node_modules"), { recursive: true })
    symlinkSync(effect, join(root, "node_modules/effect"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "ambient.d.ts"), 'declare module "node:fs" { export function readFileSync(path: string, encoding: "utf8"): string; export function existsSync(path: string): boolean }\n')
    const compilerOptions = { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true,
      allowImportingTsExtensions: true, skipLibCheck: true, types: [],
      plugins: [{ name: "@effect/language-service", diagnosticSeverity: { nodeBuiltinImport: "error" } }] }
    const compile = files => {
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions, vibe: { effectGlobals: false, effectModules: false }, files: [...files, "ambient.d.ts"] }))
      const result = spawnSync(native, ["--singleThreaded", "--pretty", "false", "-p", join(root, "tsconfig.json")], { encoding: "utf8", timeout: 30000 })
      assert.equal(result.error, undefined)
      return { status: result.status, output: result.stdout + result.stderr }
    }
    const original = input.source ?? sourceOf(input)
    writeFileSync(join(root, "original.ts"), original)
    const before = compile(["original.ts"])
    assert.equal(before.status, 0, "invalid native original: " + before.output)
    writeFileSync(join(root, "control.ts"), original.replace(pragma, ""))
    const unsuppressed = compile(["control.ts"])
    assert.ok(unsuppressed.status !== 0 && unsuppressed.output.includes("EK3877"),
      "the pragma control must prove the native lint is active: " + unsuppressed.output)
    const split = splitPlatform(original, "original.ts", ts)
    assert.ok(split, "platform import is a real split candidate")
    // 3e2aa319488c: an exported type that reads the moved schema value, under
    // its own name or another, would change the module's declarations, so the
    // split refuses and the module stays whole. A directive boundary moves.
    if (input.kind === "schema") {
      const typeName = input.collision ? input.name : "Public" + input.name
      assert.match(split.refused ?? "", new RegExp("^original\\.ts: the type " + typeName + " reads the value " + input.name + ","))
      return
    }
    assert.ok(!split.refused, "the split moves the platform boundary: " + split.refused)
    assert.ok(split.platform.includes("node:fs"))
    const helper = split.platform.replaceAll('"./original.ts"', '"./main.vibe"')
    writeFileSync(join(root, "main.vibe"), split.module)
    writeFileSync(join(root, "original.platform.ts"), helper)
    // 350a4ae40429: the sibling keeps the module's file-wide directives.
    const after = compile(["main.vibe", "original.platform.ts"])
    assert.equal(after.status, 0, "a moved platform boundary retains source validity: " + after.output)
    assert.ok(helper.includes(pragma), "the sibling carries the file directive")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("platform boundary properties quote the accepted source contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
  assert.ok(readFileSync(SpecPath("005-services.md"), "utf8").includes(moveQuote))
})
test("T3code platform splitting retains file directives and schema value bindings", () => {
  for (const corpus of corpora) check(corpus.input)
  check({ kind: "pragma", detached: false, newline: "\n", blank: 1 })
  check({ kind: "schema", collision: false, name: "Shape", detached: false, newline: "\n", blank: 1 })
})
test("platform boundaries span directive gaps, line endings and same-name schema aliases", () => {
  fc.assert(fc.property(fc.record({
    kind: fc.constantFrom("pragma", "schema"), newline: fc.constantFrom("\n", "\r\n"),
    blank: fc.integer({ min: 2, max: 4 }), name: fc.constantFrom("Shape", "Settings", "Payload"),
  }), input => check({ ...input, collision: true, detached: input.kind === "pragma" })),
  { seed: 9012245, numRuns: 12, endOnFailure: true })
})
