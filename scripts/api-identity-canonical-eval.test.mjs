import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
import { SpecPath } from "./testing/spec-path.mjs"

const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-canonical-eval-api.json", import.meta.url)))
const stockTs = loadTypeScript()
const ts = { ...stockTs, createProgram(...args) {
  const program = stockTs.createProgram(...args)
  assert.ok(!program.getSourceFiles().some(source => /[/\\]lib\.dom(?:\.iterable)?\.d\.ts$/.test(source.fileName)),
    "Canonical eval fixtures must not load unrelated browser libraries")
  return program
} }
const compilerOptions = { lib: ["lib.es5.d.ts"] }
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const chapter = readFileSync(SpecPath("001-functions.md"), "utf8")

test("canonical eval oracles quote the declaration identity contract", () => {
  assert.ok(chapter.includes("the same doc comment on each export"))
  assert.ok(chapter.includes("each export's type identical to `tsc`'s in both directions"))
  assert.ok(chapter.includes("Compare the ordinary stock-`tsc` twin without adding generated tags to it."))
})

function verify({ mode = "docs", form = "function", tag = corpus.authoredThrows[0], description = "Copies entries behind a frozen facade.", reverse = false, pretty = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-canonical-eval-"))
  const before = join(root, "before"), after = join(root, "after")
  const docs = withTag => `/** ${description}\n${withTag ? " * " + tag + "\n" : ""} * @since 1.0.0\n */\n`
  const signature = form === "arrow"
    ? "export declare const make: <T>(input: T) => T;\n"
    : form === "overloads"
      ? "export declare function make(input: string): string;\nexport declare function make(input: number): number;\n"
      : "export declare function make<T>(input: T): T;\n"
  const put = (dir, manifest, source) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, pretty ? 2 : 0))
    writeFileSync(join(dir, "index.d.ts"), source)
  }
  try {
    const manifest = structuredClone(corpus.before)
    if (mode === "json-field") manifest.publicRevision = 1
    put(before, manifest, docs(true) + signature)
    put(after, manifest, docs(true) + signature)
    const pair = reverse ? [after, before] : [before, after]
    const same = compareApiIdentity(ts, ...pair, { compilerOptions })
    assert.equal(same.comparisonComplete, true, JSON.stringify(same))
    assert.equal(same.identical, true, JSON.stringify(same))
    if (mode === "docs") {
      put(after, manifest, docs(false) + signature)
    } else if (mode === "json-conditional") {
      put(after, { ...manifest, exports: { ...manifest.exports, ".": structuredClone(corpus.after.exports["."]) } }, docs(true) + signature)
    } else if (mode === "json-field") {
      put(after, { ...manifest, publicRevision: "different kind" }, docs(true) + signature)
    } else if (mode === "json-order") {
      put(after, Object.fromEntries(Object.entries(manifest).reverse()), docs(true) + signature)
    } else {
      assert.fail("unknown oracle mode " + mode)
    }
    const changed = compareApiIdentity(ts, ...pair, { compilerOptions })
    assert.equal(changed.comparisonComplete, true, JSON.stringify(changed))
    const expectedSame = mode === "json-order"
    assert.equal(changed.identical, expectedSame, JSON.stringify(changed))
    if (mode === "docs") {
      assert.ok(changed.docDifferences.some(item => item.export === "make" && item.before !== item.after), JSON.stringify(changed))
      assert.equal(changed.typeDifferences.length, 0, JSON.stringify(changed))
    } else if (!expectedSame) {
      assert.ok(changed.typeDifferences.some(item => item.entrypoint === "./package.json" && item.export === "export="), JSON.stringify(changed))
      assert.equal(changed.docDifferences.length, 0, JSON.stringify(changed))
    }
    // Independent stock TypeScript control: these package JSON imports have
    // different types exactly when the JSON shape changes, not for key order.
    const consumer = join(root, "consumer.ts")
    writeFileSync(consumer, `import before from "./before/package.json";\nimport after from "./after/package.json";\ntype Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;\nconst same: Same<typeof before, typeof after> = true;\nexport { same };\n`)
    const program = ts.createProgram([consumer], {
      ...compilerOptions, strict: true, noEmit: true, types: [], resolveJsonModule: true, esModuleInterop: true,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    assert.deepEqual(diagnostics.map(item => item.code), mode.startsWith("json-") && !expectedSame ? [2322] : [],
      ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => "\n" }))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("canonical authored throw documentation cannot disappear from declaration identity", () => {
  for (const tag of corpus.authoredThrows) verify({ tag })
})
test("canonical public package JSON keeps its value type across an export condition rewrite", () => verify({ mode: "json-conditional" }))
test("unrelated exported JSON field types remain part of the API", () => verify({ mode: "json-field" }))
test("manifest key order preserves self identity", () => verify({ mode: "json-order", reverse: true, pretty: true }))

test("property: declaration documentation and public JSON mutations retain separate oracles", async () => {
  await checkProperty(fc, {
    name: "canonical-eval-docs-and-public-json",
    rule: "001 API identity: identical exported types and the same documentation; authored throws prose is not a generated never annotation, and exported package JSON is a value API.",
    command: "node --test scripts/api-identity-canonical-eval.test.mjs",
    generatorVersion: 1,
    numRuns: 32,
    arbitrary: fc.record({
      mode: fc.constantFrom("docs", "json-conditional", "json-field", "json-order"),
      form: fc.constantFrom("function", "arrow", "overloads"),
      tag: fc.constantFrom(...corpus.authoredThrows, "@throws {Error} Preserves the original failure.", "@rethrows input"),
      description: fc.constantFrom("Copies entries behind a frozen facade.", "Narrows a typed JSON-like value.", "Retains the caller's original value."),
      reverse: fc.boolean(), pretty: fc.boolean(),
    }),
    check: verify,
  })
})
