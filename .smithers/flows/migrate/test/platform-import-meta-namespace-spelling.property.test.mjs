import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { splitImportMeta } from "../lib/import-meta-platform.mjs"
import { splitPlatform, splitBatchPlatform } from "../lib/platform.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-import-meta-namespace-spelling.json", import.meta.url)))
const oxlint = fileURLToPath(new URL("../../../../packages/compiler/node_modules/.bin/oxlint", import.meta.url))
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "metadata-namespace-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  // Minimized repository policy; execute it in the real Oxlint JS-plugin host.
  writeFileSync(join(root, "policy.mjs"), 'export default { meta: { name: "t3code" }, rules: { "namespace-node-imports": { create(context) { return { ImportDeclaration(node) { if (node.source.value === "node:url" && !node.specifiers.some(s => s.type === "ImportNamespaceSpecifier" && s.local.name === "NodeURL")) context.report({ node, message: "node:url must use the NodeURL namespace" }) } } } } } }\n')
  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify({
    jsPlugins: [{ name: "t3code", specifier: "./policy.mjs" }],
    rules: { "t3code/namespace-node-imports": "error" },
  }))
  const lint = text => {
    writeFileSync(join(root, "companion.ts"), text)
    const result = spawnSync(oxlint, ["--config", ".oxlintrc.json", "companion.ts"], { cwd: root, encoding: "utf8" })
    assert.ifError(result.error)
    return { ...result, text: result.stdout + result.stderr }
  }
  return { root, lint }
}
function metadata(source) {
  const result = splitImportMeta(source, "entry.ts", "entry.platform.ts", ts)
  assert.ok(result && !result.refused, JSON.stringify(result))
  return result
}
test("the minimized repository namespace rule rejects a renamed URL binding", t => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.quote))
  const { lint } = fixture(t)
  const bad = lint('import * as $NodeURL from "node:url"; export const result = $NodeURL.fileURLToPath;\n')
  assert.equal(bad.status, 1, bad.text)
  assert.match(bad.text, /namespace-node-imports/)
  const good = lint('import * as NodeURL from "node:url"; export const result = NodeURL.fileURLToPath;\n')
  assert.equal(good.status, 0, good.text)
})
test("generated metadata companions obey the exact namespace policy", t => {
  const { lint } = fixture(t)
  const result = lint(metadata(corpus.source).platform)
  assert.equal(result.status, 0, result.text)
})
test("only bindings actually merged into a companion compete with its namespace", t => {
  const { root, lint } = fixture(t)
  const source = 'const NodeURL = process.pid;\nexport function id(): number { return NodeURL; }\n' + corpus.source
  const split = splitPlatform(source, "entry.ts", ts, { globals: ["process"] })
  assert.ok(split && !split.refused, JSON.stringify(split))
  writeFileSync(join(root, "entry.platform.ts"), split.platform)
  writeFileSync(join(root, "ambient.d.ts"),
    'declare const process: { pid: number }; interface ImportMeta { filename: string | undefined }; declare module "node:url" { export function fileURLToPath(url: string): string }\n')
  const program = ts.createProgram([join(root, "entry.platform.ts"), join(root, "ambient.d.ts")], {
    strict: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])

  const original = 'import * as NodeURL from "node:url";\nexport function decode(url: string): string { return NodeURL.fileURLToPath(url); }\n' + corpus.source
  writeFileSync(join(root, "package.json"), '{"type":"module","private":true}')
  writeFileSync(join(root, "native.ts"), original)
  const batch = splitBatchPlatform(root, ["native.ts"], ts, { moduleBodies: true })
  assert.deepEqual(batch.refused, [])
  assert.equal(batch.splits.length, 1)
  const result = lint(readFileSync(join(root, "native.platform.ts"), "utf8"))
  assert.equal(result.status, 0, result.text)
})
test("property: source-local namespace names do not rename an isolated helper import", async t => {
  const { lint } = fixture(t)
  await checkProperty(fc, {
    name: corpus.key, rule: corpus.quote,
    command: "node --test .smithers/flows/migrate/test/platform-import-meta-namespace-spelling.property.test.mjs",
    numRuns: 50,
    arbitrary: fc.record({
      binding: fc.constantFrom("NodeURL", "$NodeURL", "NodeURL2", "URL", "value"),
      nested: fc.boolean(), kind: fc.constantFrom("filename", "dirname"),
    }),
    check: ({ binding, nested, kind }) => {
      const prefix = nested ? "export function observe(" + binding + ": number) { return " + binding + "; }\n"
        : "const " + binding + " = 1; export const observed = " + binding + ";\n"
      const split = metadata(prefix + corpus.source.replaceAll("import.meta.filename", "import.meta." + kind))
      assert.ok(split.module.includes(prefix.trim()), "original source bindings are retained")
      const result = lint(split.platform)
      assert.equal(result.status, 0, result.text)
    },
  })
})
