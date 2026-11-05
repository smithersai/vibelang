import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { importerPaths } from "../lib/importer-files.mjs"
import { importers } from "../lib/steps.mjs"
import { rewriteImports, restoreSpecifiers } from "../lib/codemod.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check"), ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-mdx-declaration-import.json", import.meta.url), "utf8"))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const fixture = () => mkdtempSync(join(tmpdir(), "declaration-imports-"))

test("authored MDX declarations follow renamed sources through the public importer selection", async () => {
  const root = fixture()
  try {
    put(root, corpus.source, corpus.sourceText)
    put(root, corpus.importer, corpus.importerText)
    put(root, "package.json", '{"type":"module"}')
    put(root, "tsconfig.json", '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","rootDir":".","noEmit":true,"allowArbitraryExtensions":true}}')
    execFileSync("jj", ["git", "init", root], { stdio: "pipe" })
    const check = () => {
      const program = ts.createProgram([join(root, corpus.importer)], {
        strict: true, noEmit: true, allowArbitraryExtensions: true,
        allowImportingTsExtensions: true, module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext, types: []
      })
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
    }
    check()
    const before = await importers(root)
    assert.ok(before.includes(corpus.importer), "authored declarations are importers")
    const vibe = corpus.source.replace(/\.ts$/, ".vibe")
    renameSync(join(root, corpus.source), join(root, vibe))
    const edits = rewriteImports(root, await importers(root), [vibe])
    assert.deepEqual(edits.map(({ file, from, to }) => ({ file, from, to })), [
      { file: corpus.importer, from: "../../../src/Prompt.ts", to: "../../../src/Prompt.vibe" }
    ])
    assert.equal(readFileSync(join(root, corpus.importer), "utf8"), corpus.importerText.replace("Prompt.ts", "Prompt.vibe"))
    put(root, "src/Prompt.d.vibe.ts", corpus.sourceText)
    check()
    renameSync(join(root, vibe), join(root, corpus.source))
    restoreSpecifiers(root, edits, corpus.source)
    assert.equal(readFileSync(join(root, corpus.importer), "utf8"), corpus.importerText)
    check()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("authored declaration imports retain exact text across rename and return", () => {
  fc.assert(fc.property(
    fc.constantFrom("types/header.d.ts", "types/header.d.mts", "types/header.d.cts", "test/fixtures/header.d.mdx.ts", "types/header.d.css.ts"),
    fc.constantFrom("import", "export", "type"),
    fc.constantFrom(".ts", ".js"),
    (file, kind, extension) => {
      const root = fixture()
      try {
        const relative = file.startsWith("test/") ? "../../src/Prompt" : "../src/Prompt"
        const specifier = relative + extension
        const text = kind === "import" ? 'import type { Component } from "' + specifier + '";\nexport type Props = Component<{label: string}>;\n'
          : kind === "export" ? 'export type { Component } from "' + specifier + '";\n'
          : 'export type Props = import("' + specifier + '").Component<{label: string}>;\n'
        put(root, file, text)
        put(root, "src/Prompt.vibe", corpus.sourceText)
        put(root, "src/untouched.ts", "export const untouched = 1\n")
        put(root, "types/unrelated.d.ts", 'export type Unrelated = import("../src/untouched.ts").untouched\n')
        const scope = importerPaths(root, [file, "src/Prompt.vibe", "src/untouched.ts", "types/unrelated.d.ts"])
        assert.ok(scope.includes(file))
        const edits = rewriteImports(root, scope, ["src/Prompt.vibe"])
        assert.equal(edits.length, 1)
        assert.equal(readFileSync(join(root, file), "utf8"), text.replace(specifier, relative + ".vibe"))
        assert.equal(readFileSync(join(root, "types/unrelated.d.ts"), "utf8"), 'export type Unrelated = import("../src/untouched.ts").untouched\n')
        renameSync(join(root, "src/Prompt.vibe"), join(root, "src/Prompt.ts"))
        restoreSpecifiers(root, edits, "src/Prompt.ts")
        assert.equal(readFileSync(join(root, file), "utf8"), text)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }), { seed: 505544, numRuns: 120 })
})

test("generated declarations stay untouched beside sources and in configured output directories", () => {
  const root = fixture()
  try {
    put(root, "package.json", '{"type":"module"}')
    put(root, "config/base.json", '{"compilerOptions":{"outDir":"../out-js","declarationDir":"../out-types"}}')
    put(root, "tsconfig.json", '{"extends":"./config/base.json","compilerOptions":{"rootDir":"."}}')
    const generated = [
      "src/Prompt.d.vibe.ts", "src/Prompt.vibe.parser.d.ts", "mirror/Prompt.d.vibex.ts",
      ".vibe/declarations/src/Prompt.d.vibe.ts", "src/native.d.ts", "out-types/custom.d.ts",
      "out-js/custom.d.ts", "dist/custom.d.ts", "types/marked.d.ts"
    ]
    const source = 'import type { Component } from "../src/Prompt.ts";\n'
    put(root, "src/Prompt.vibe", corpus.sourceText)
    put(root, "src/native.ts", "export const n = 1\n")
    for (const file of generated) put(root, file, (file.includes("marked") ? "// Generated by the schema tool. DO NOT EDIT.\n" : "") + source)
    put(root, "types/authored.d.ts", source)
    const tracked = ["package.json", "config/base.json", "tsconfig.json", "src/Prompt.vibe", "src/native.ts", ...generated, "types/authored.d.ts"]
    const selected = importerPaths(root, tracked)
    assert.ok(selected.includes("types/authored.d.ts"))
    assert.deepEqual(generated.filter(file => selected.includes(file)), [])
    rewriteImports(root, selected, ["src/Prompt.vibe"])
    for (const file of generated) assert.equal(readFileSync(join(root, file), "utf8"), (file.includes("marked") ? "// Generated by the schema tool. DO NOT EDIT.\n" : "") + source)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
