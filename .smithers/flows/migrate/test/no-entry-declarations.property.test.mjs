import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { canonicalize, compareDeclarations, NO_ENTRY_POINTS } from "../lib/declarations.mjs"
import * as Jj from "../lib/jj.mjs"
import { makeConfig, paths, verify } from "../lib/steps.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-bin-only-manifest.json", import.meta.url), "utf8"))

// A manifest without exports, types, typings, main or module: TypeScript
// resolves the bare name to the package root's index and nothing else.
// Canonical comparison here is main's; 40cbbbfa adds import statement order.
function compare(before, after, manifest) {
  const root = mkdtempSync(join(tmpdir(), "migrate-no-entry-"))
  try {
    for (const [dir, files] of Object.entries({ before, after })) {
      mkdirSync(join(root, dir))
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest))
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(root, dir, file, ".."), { recursive: true })
        writeFileSync(join(root, dir, file), text)
      }
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("t3code apps/server: a package that publishes only a bin compares its declarations canonically", () => {
  for (const { before, after } of corpus.printing) {
    const result = compare({ "src/tools.d.ts": before }, { "src/tools.d.ts": after }, corpus.manifest)
    assert.equal(result.identical, true, after)
    assert.deepEqual(result.publicSurface.before, { roots: [], reachable: [], unresolved: [] })
  }
  for (const { before, after } of corpus.meaning) {
    assert.equal(compare({ "src/tools.d.ts": before }, { "src/tools.d.ts": after }, corpus.manifest).identical, false, after)
  }
  // A removed declaration still fails; an added one is private.
  assert.equal(compare({ "a.d.ts": "export {};\n", "b.d.ts": "export {};\n" }, { "a.d.ts": "export {};\n" }, corpus.manifest).identical, false)
  assert.deepEqual(compare({ "a.d.ts": "export {};\n" }, { "a.d.ts": "export {};\n", "b.d.ts": "export {};\n" }, corpus.manifest).addedPrivate, ["b.d.ts"])
})

test("without entry-point fields the root index and what it reaches stay byte for byte", () => {
  const manifest = { name: "lib" }
  const files = { "index.d.ts": "export * from \"./leaf.js\";\n", "leaf.d.ts": "export { b, a } from \"./x.js\";\n", "other.d.ts": "export { b, a } from \"./x.js\";\n", "x.d.ts": "export declare const a: 1, b: 2;\n" }
  const { roots, reachable, unresolved } = compare(files, files, manifest).publicSurface.before
  assert.deepEqual({ roots, reachable, unresolved }, { roots: ["index.d.ts"], reachable: ["index.d.ts", "leaf.d.ts", "x.d.ts"], unresolved: [] })
  const reordered = "export { a, b } from \"./x.js\";\n"
  assert.equal(compare(files, { ...files, "other.d.ts": reordered }, manifest).identical, true)
  assert.equal(compare(files, { ...files, "leaf.d.ts": reordered }, manifest).identical, false)
  // typesVersions redirects the bare name; without a resolver for it every file stays raw.
  const redirected = compare(files, { ...files, "other.d.ts": reordered }, { name: "lib", typesVersions: { "*": { "*": ["other.d.ts"] } } })
  assert.equal(redirected.identical, false)
  assert.equal(redirected.comparison, "all bytes")
})

test("verify records again a baseline an older flow marked as having no entry points", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-no-entry-verify-"))
  const target = join(root, "repo")
  const run = join(root, "run")
  const pkg = "apps/server"
  const { before, after } = corpus.printing[0]
  try {
    mkdirSync(join(target, pkg, "node_modules/.bin"), { recursive: true })
    mkdirSync(join(target, "node_modules"), { recursive: true })
    symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    writeFileSync(join(target, ".gitignore"), "node_modules/\n")
    writeJson(join(target, "package.json"), { private: true })
    writeJson(join(target, pkg, "package.json"), corpus.manifest)
    writeJson(join(target, pkg, "tsconfig.json"), { compilerOptions: { rootDir: "." }, include: ["*.vibe"] })
    writeFileSync(join(target, pkg, "tools.vibe"), "export const tool = 1\n")
    writeFileSync(join(target, pkg, "node_modules/.bin/vibelang"), [
      "#!/usr/bin/env node",
      'const fs = require("node:fs"), path = require("node:path");',
      'const out = process.argv[process.argv.indexOf("--outDir") + 1];',
      'if (process.argv.includes("--outDir")) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, "tools.d.ts"), ' + JSON.stringify(after) + "); }"
    ].join("\n") + "\n", { mode: 0o755 })
    const setupCommit = await Jj.commit(target, "set up")
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, packages: [pkg], test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.setup, { jj: { setupCommit } })
    writeJson(p.plan, { batches: [{ files: [pkg + "/tools.ts"] }] })
    writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
    writeJson(join(p.baseline, "compile-" + slug(pkg) + ".json"), [])
    const baseline = join(p.baseline, "dts", slug(pkg))
    mkdirSync(baseline, { recursive: true })
    writeFileSync(join(baseline, "tools.d.ts"), before)
    writeJson(join(baseline, "public-surface.json"), { roots: ["tools.d.ts"], unresolved: [NO_ENTRY_POINTS] })
    const result = await verify({ run, batch: "01" })
    assert.equal(result.declarations[pkg].identical, true, JSON.stringify(result.declarations[pkg]))
    assert.deepEqual(result.declarations[pkg].publicSurface.before.unresolved, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("property: a package without entry-point fields fails exactly the changes canonical comparison sees", () => {
  const witnesses = [...corpus.printing, ...corpus.meaning]
  fc.assert(fc.property(
    fc.integer({ min: 0, max: witnesses.length - 1 }), fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/), fc.boolean(),
    fc.constantFrom("src/tools.d.ts", "tools.d.ts", "src/deep/tools.d.ts"),
    (pick, name, changed, file) => {
      const before = witnesses[pick].before.replaceAll("store", name)
      const after = changed ? witnesses[pick].after.replaceAll("store", name) : before
      const result = compare({ [file]: before }, { [file]: after }, { ...corpus.manifest, name })
      assert.equal(result.identical, canonicalize(ts, before, file) === canonicalize(ts, after, file))
    }
  ), { seed: 1115, numRuns: 120 })
})
