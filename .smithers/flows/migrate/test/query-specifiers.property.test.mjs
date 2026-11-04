import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { restoreSpecifiers, rewriteImports, rewriteSpecifier } from "../lib/codemod.mjs"
import { resolveAlias, resolveAliased, resolveRelative } from "../lib/imports.mjs"

const fc = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-query-snippet-reexports.json", import.meta.url), "utf8"))

test("foldkit snippet re-exports rename their source and revert to their exact authored spelling", () => {
  const root = mkdtempSync(join(tmpdir(), "query-specifiers-"))
  try {
    writeFileSync(join(root, "counter.vibe"), "export default 1\n")
    writeFileSync(join(root, "snippets.ts"), corpus.source)
    const edits = rewriteImports(root, ["counter.vibe", "snippets.ts"], ["counter.vibe"])
    assert.equal(readFileSync(join(root, "snippets.ts"), "utf8"), corpus.expected)
    assert.equal(edits.length, 2)
    assert.deepEqual(rewriteImports(root, ["counter.vibe", "snippets.ts"], ["counter.vibe"]), [])
    restoreSpecifiers(root, edits, "counter.ts")
    assert.equal(readFileSync(join(root, "snippets.ts"), "utf8"), corpus.source)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("query and fragment suffixes resolve the same source through relative, wildcard and package aliases", () => {
  const files = new Set(["src/counter.vibe"])
  for (const suffix of ["?raw", "?raw#snippet", "#snippet?raw", "?url=a.ts&value=%23", "#part"]) {
    assert.equal(resolveRelative("src/index.ts", "./counter.ts" + suffix, files), "src/counter.vibe")
    assert.equal(resolveAlias("@/counter.ts" + suffix, { "@/*": ["src/*"] }, files), "src/counter.vibe")
    assert.equal(resolveAliased("src/index.ts", "#counter" + suffix, files,
      () => [{ pattern: "#counter", targets: ["src/counter.ts"] }])?.target, "src/counter.vibe")
    assert.equal(rewriteSpecifier("src/index.ts", "./counter.ts" + suffix, "src/counter.vibe"), "./counter.vibe" + suffix)
  }
})

test("property: source queries preserve import syntax, suffix bytes, batch scope and emission policy", () => {
  fc.assert(fc.property(fc.record({
    form: fc.constantFrom("import value from SPEC", "export { default as counterRaw } from SPEC", "export * from SPEC", "const value = import(SPEC)", "import SPEC"),
    suffix: fc.tuple(fc.constantFrom("?", "#", "?raw#", "#part?"), fc.array(fc.constantFrom("a", "1", "&", "=", "%23", ".ts", "/", "?"), { minLength: 1, maxLength: 8 })).map(([prefix, parts]) => prefix + parts.join("")),
    quote: fc.constantFrom("'", '"'),
    importer: fc.constantFrom("index.ts", "index.vibe", "index.mjs", "index.test.ts"),
    alias: fc.boolean(),
    relative: fc.boolean(),
    emitted: fc.boolean()
  }), input => {
    const path = input.alias ? "@/counter.ts" : "./counter.ts"
    const specifier = path + input.suffix
    const source = input.form.replace("SPEC", input.quote + specifier + input.quote) +
      "\n// export * from './counter.ts?raw'\nexport * from './other.ts?raw'\n"
    const texts = new Map([[input.importer, source], ["counter.vibe", "export default 1"], ["other.ts", "export default 2"]])
    const aliases = () => [{ pattern: "@/*", targets: ["*"] }]
    aliases.rewriteRelativeImportExtensions = () => input.relative
    aliases.migratedSourceExtension = () => input.emitted ? ".js" : ".vibe"
    const options = { read: file => texts.get(file), write: (file, text) => texts.set(file, text) }
    const edits = rewriteImports(process.cwd(), [...texts.keys()], ["counter.vibe"], aliases, options)
    const prefix = input.alias && !input.relative ? "@/counter" : "./counter"
    const ext = input.emitted && (!input.alias || input.relative) ? ".js" : ".vibe"
    const expected = prefix + ext + input.suffix
    assert.equal(texts.get(input.importer), source.replace(input.quote + specifier + input.quote, input.quote + expected + input.quote))
    assert.equal(edits.length, 1)
    assert.deepEqual(rewriteImports(process.cwd(), [...texts.keys()], ["counter.vibe"], aliases, options), [])
  }), { seed: 239, numRuns: 150 })
})

test("protected tests allow only the source extension to change, keeping every query and fragment byte", async () => {
  const { verifyTestDiff, loadGlob } = await import("../lib/test-diff.mjs")
  const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
  const glob = loadGlob([new URL("../../../../docs/tools/", import.meta.url).pathname], ts)
  const scratch = mkdtempSync(join(tmpdir(), "query-verifier-"))
  try {
    for (const suffix of ["?raw", "#snippet", "?raw#snippet", "#snippet?raw"]) {
      const before = 'export { default as counterRaw } from "../counter.ts' + suffix + '"\n'
      const after = before.replace("counter.ts", "counter.vibe")
      const check = text => verifyTestDiff({ ts, glob, scratch, cwd: "test",
        before: { "counter.ts": "export default 1", "test/snippet.test.ts": before },
        after: { "counter.vibe": "export default 1", "test/snippet.test.ts": text },
        renames: [{ from: "counter.ts", to: "counter.vibe" }]
      })
      assert.equal(check(after).ok, true, JSON.stringify(check(after)))
      assert.equal(check(after.replace(suffix, suffix + "changed")).ok, false)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
