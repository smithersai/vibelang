import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, posix, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { resolveAlias } from "../lib/imports.mjs"
import { buildInventory, tsconfigPaths } from "../lib/inventory.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-path-alias-inventory.json", import.meta.url), "utf8"))

function repo(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "migrate-aliases-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, posix.dirname(file)), { recursive: true })
    writeFileSync(join(root, file), typeof text === "string" ? text : JSON.stringify(text, null, 2))
  }
  return root
}

// t3code apps/web: 1478 `~/…` imports were missing from the inventory, so
// BrowserProfileReporter.ts had `imports: []` and the rollback put 20
// candidates ahead of the aliased dependencies that failed.
test("corpus: an import through t3code's ~/ alias is an inventory edge, both ways", (t) => {
  const root = repo(t, corpus.files)
  const paths = { [corpus.package]: tsconfigPaths(ts, root, [join(root, corpus.package, "tsconfig.json")]) }
  assert.deepEqual(paths[corpus.package], corpus.paths)
  const inventory = buildInventory({ root, packages: [{ dir: corpus.package, sources: ["src"] }], paths })
  const record = (path) => inventory.files.find((f) => f.path === path)
  for (const [file, imports] of Object.entries(corpus.imports)) {
    assert.deepEqual(record(file).imports, imports, file)
    for (const target of imports) assert.ok(record(target).dependents.includes(file), `${target} dependents`)
  }
})

test("resolveAlias: an exact pattern wins, then the longest prefix, then each substitution in order", () => {
  const files = new Set(["src/a.ts", "src/lib/b.vibe", "shared/c.ts", "src/d/index.ts", "config.ts"])
  const paths = { "~/*": ["src/*", "shared/*"], "~/lib/*": ["src/lib/*"], "config": ["config.ts"], "@/*": ["missing/*"] }
  assert.equal(resolveAlias("~/a", paths, files), "src/a.ts")
  assert.equal(resolveAlias("~/a.js", paths, files), "src/a.ts")
  assert.equal(resolveAlias("~/lib/b", paths, files), "src/lib/b.vibe", "the longer prefix, and a module now .vibe")
  assert.equal(resolveAlias("~/lib/b.ts", paths, files), "src/lib/b.vibe")
  assert.equal(resolveAlias("~/c", paths, files), "shared/c.ts", "the second substitution")
  assert.equal(resolveAlias("~/d", paths, files), "src/d/index.ts")
  assert.equal(resolveAlias("config", paths, files), "config.ts")
  assert.equal(resolveAlias("@/a", paths, files), undefined)
  assert.equal(resolveAlias("./a", paths, files), undefined)
  assert.equal(resolveAlias("effect", paths, files), undefined)
})

test("property: resolveAlias names the file TypeScript's own resolution does", (t) => {
  const name = fc.constantFrom("a", "b", "util", "index")
  const dir = fc.constantFrom("src", "src/lib", "shared", "")
  const file = fc.tuple(dir, name, fc.constantFrom(".ts", ".tsx")).map(([d, n, e]) => (d ? `${d}/${n}${e}` : `${n}${e}`))
  const pattern = fc.constantFrom("~/*", "@/*", "~/lib/*", "@app/*", "lib")
  const substitution = fc.constantFrom("./src/*", "./src/lib/*", "./shared/*", "./*")
  const arbitrary = fc.record({
    files: fc.uniqueArray(file, { minLength: 1, maxLength: 6 }),
    paths: fc.dictionary(pattern, fc.uniqueArray(substitution, { minLength: 1, maxLength: 2 }), { minKeys: 1, maxKeys: 3 }),
    specifiers: fc.array(fc.tuple(fc.constantFrom("~/", "@/", "~/lib/", "@app/", "lib"), fc.constantFrom("", "a", "b", "util", "lib/a", "a.js", "a.ts"))
      .map(([p, s]) => (p === "lib" ? "lib" : p + s)), { minLength: 1, maxLength: 5 })
  })
  fc.assert(fc.property(arbitrary, (input) => {
    const paths = Object.fromEntries(Object.entries(input.paths).map(([p, subs]) => [p, subs.map((s) => (p.includes("*") ? s : s.replace("*", "a")))]))
    const files = { "tsconfig.json": { compilerOptions: { module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true, noEmit: true, paths }, files: ["main.ts"] }, "main.ts": "" }
    for (const f of input.files) files[f] = "export {}\n"
    const root = repo(t, files)
    const options = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }).options
    const ours = tsconfigPaths(ts, root, [join(root, "tsconfig.json")])
    const known = new Set(input.files)
    for (const specifier of input.specifiers) {
      const theirs = ts.resolveModuleName(specifier, join(root, "main.ts"), options, ts.sys).resolvedModule?.resolvedFileName
      const expected = theirs && !relative(root, theirs).startsWith("..") && !theirs.includes("node_modules") ? relative(root, theirs).split("\\").join("/") : undefined
      assert.equal(resolveAlias(specifier, ours, known), expected, `${specifier} with ${JSON.stringify(paths)} over ${input.files}`)
    }
    rmSync(root, { recursive: true, force: true })
  }), { numRuns: 80 })
})
