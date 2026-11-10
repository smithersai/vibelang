import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { splitImportMeta } from "../lib/import-meta-platform.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-import-meta-dirname-strict-index.json", import.meta.url)))
const ambient = [
  "interface ImportMetaEnv { readonly MODE: string }",
  "interface ImportMeta { url: string; dirname: string | undefined; filename: string | undefined; env: ImportMetaEnv }",
  'declare module "node:url" { export class URL { constructor(input: string, base?: string) }; export function fileURLToPath(url: string | URL): string }',
].join("\n")
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "metadata-indexed-access-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "ambient.d.ts"), ambient)
  const diagnostics = (source, platform) => {
    writeFileSync(join(root, "entry.ts"), source)
    writeFileSync(join(root, "entry.platform.ts"), platform ?? "")
    const program = ts.createProgram([join(root, "entry.ts"), join(root, "entry.platform.ts"), join(root, "ambient.d.ts")], {
      strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, types: [],
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ["lib.es2022.d.ts"], allowImportingTsExtensions: true, noEmit: true,
    })
    return ts.getPreEmitDiagnostics(program).map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, "\n") }))
  }
  return diagnostics
}
function split(source) {
  const result = splitImportMeta(source, "entry.ts", "entry.platform.ts", ts)
  assert.ok(result && !result.refused, JSON.stringify(result))
  return result
}
test("directory metadata companions type-check with strict indexed access", t => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.quote))
  const diagnostics = fixture(t)
  assert.deepEqual(diagnostics(corpus.source), [], "original TypeScript source is valid")
  const result = split(corpus.source)
  assert.deepEqual(diagnostics(result.module, result.platform), [], "generated TypeScript must preserve that validity (" + ts.version + ")")
})
test("property: strict directory helpers remain valid with other metadata reads and name collisions", async t => {
  const diagnostics = fixture(t)
  await checkProperty(fc, {
    name: corpus.key, rule: corpus.quote,
    command: "node --test .smithers/flows/migrate/test/platform-import-meta-dirname-strict-index.property.test.mjs",
    numRuns: 50,
    arbitrary: fc.record({ collisions: fc.integer({ min: 0, max: 3 }), filename: fc.boolean(), env: fc.boolean(), crlf: fc.boolean() }),
    check: ({ collisions, filename, env, crlf }) => {
      let source = Array.from({ length: collisions }, (_, i) => "export const $importMetaDirname" + (i ? i + 1 : "") + " = " + i + ";\n").join("") +
        corpus.source + (filename ? "export const filename = () => import.meta.filename;\n" : "") +
        (env ? "export const mode = () => import.meta.env.MODE;\n" : "")
      if (crlf) source = source.replaceAll("\n", "\r\n")
      const result = split(source)
      assert.deepEqual(diagnostics(result.module, result.platform), [], ts.version)
    },
  })
})
