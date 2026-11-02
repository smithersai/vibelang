import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { codemod, makeConfig, paths, revert } from "../lib/steps.mjs"
import { onePassStep } from "../lib/onepass.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-vite-build-entry.json", import.meta.url), "utf8"))

// drive-t3code-apps: native compilation succeeds after the rename, but Vite
// cannot resolve its unchanged build.lib.entry. No target test is rewritten.
test("t3code: codemod keeps a Vite library entry reachable and revert restores it", async t => {
  const root = mkdtempSync(join(tmpdir(), "migrate-build-entry-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, "repo"), run = join(root, "run")
  mkdirSync(join(repo, "src"), { recursive: true })
  mkdirSync(join(repo, "node_modules/.bin"), { recursive: true })
  symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(repo, "node_modules/typescript"))
  writeFileSync(join(repo, "package.json"), '{"name":"app","private":true}\n')
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n")
  writeFileSync(join(repo, "tsconfig.json"), '{"compilerOptions":{"noEmit":true},"include":["src"]}\n')
  const source = corpus.source
  const config = corpus.config
  writeFileSync(join(repo, "src/entry.ts"), source)
  writeFileSync(join(repo, "vite.config.ts"), config)
  writeProbeAwareCompiler(join(repo, "node_modules/.bin/vibelang"), '#!/bin/sh\necho "vibelang --fix: 0 fixes in 0 files."\n', { mode: 0o755 })
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: repo })
  await Jj.commit(repo, "base")
  writeJson(paths(run).config, makeConfig({ target: repo, test: "true", vibelangVersion: "0.0.0" }))
  writeJson(paths(run).plan, { batches: [{ files: ["src/entry.ts"] }] })
  const result = await codemod({ run, batch: "01" })
  const after = readFileSync(join(repo, "vite.config.ts"), "utf8")
  assert.match(after, /entry: "src\/entry\.vibe"/)
  const entry = /entry: "([^"]+)"/.exec(after)[1]
  assert.ok(existsSync(join(repo, entry)), "the configured build input must exist after migration")
  assert.equal(readFileSync(join(repo, "src/entry.vibe"), "utf8"), source, "source declarations and behavior are untouched")
  assert.equal(result.buildEntries.edits.length, 1)
  await revert({ run, batch: "01", file: "src/entry.vibe", reason: "entry regression rollback" })
  assert.equal(readFileSync(join(repo, "vite.config.ts"), "utf8"), config)
})

test("t3code one-pass: a literal Vite input follows rename and survives recovery and revert", async t => {
  const root = mkdtempSync(join(tmpdir(), "migrate-build-entry-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, "repo"), run = join(root, "run")
  mkdirSync(join(repo, "src"), { recursive: true })
  mkdirSync(join(repo, "node_modules/.bin"), { recursive: true })
  symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(repo, "node_modules/typescript"))
  writeFileSync(join(repo, "package.json"), '{"name":"app","private":true}\n')
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n")
  writeFileSync(join(repo, "tsconfig.json"), '{"compilerOptions":{"noEmit":true},"include":["src"]}\n')
  const source = corpus.source
  const config = corpus.config
  writeFileSync(join(repo, "src/entry.ts"), source)
  writeFileSync(join(repo, "vite.config.ts"), config)
  writeProbeAwareCompiler(join(repo, "node_modules/.bin/vibelang"), '#!/bin/sh\necho "vibelang --fix: 0 fixes in 0 files."\n', { mode: 0o755 })
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: repo })
  await Jj.commit(repo, "base")
  writeJson(paths(run).config, makeConfig({ target: repo, test: "true", vibelangVersion: "0.0.0" }))
  writeJson(paths(run).plan, { mode: "one-pass", batches: [{ files: ["src/entry.ts"] }] })
  const result = await onePassStep("rename", { run })
  const after = readFileSync(join(repo, "vite.config.ts"), "utf8")
  assert.match(after, /entry: "src\/entry\.vibe"/)
  const entry = /entry: "([^"]+)"/.exec(after)[1]
  assert.ok(existsSync(join(repo, entry)), "the configured build input must exist after migration")
  assert.equal(readFileSync(join(repo, "src/entry.vibe"), "utf8"), source, "source declarations and behavior are untouched")
  assert.equal(result.buildEntries.edits.length, 1)
  assert.deepEqual(await onePassStep("rename", { run }), result, "a repeated rename keeps the saved build receipt")
  await revert({ run, batch: "01", file: "src/entry.vibe", reason: "entry regression rollback" })
  assert.equal(readFileSync(join(repo, "vite.config.ts"), "utf8"), config)
})

function fixture(text, run) {
  const root = mkdtempSync(join(tmpdir(), "migrate-entry-property-"))
  try {
    mkdirSync(join(root, "packages/app/src"), { recursive: true })
    writeFileSync(join(root, "package.json"), '{}\n')
    writeFileSync(join(root, "packages/app/package.json"), '{}\n')
    writeFileSync(join(root, "packages/app/src/leaf.vibe"), corpus.source)
    writeFileSync(join(root, "packages/app/vite.config.ts"), text)
    return run(root, "packages/app/vite.config.ts", [{ from: "packages/app/src/leaf.ts", to: "packages/app/src/leaf.vibe" }])
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("property: literal Vite entries follow exactly their renamed modules, once, and round trip", async () => {
  const { rewriteBuildEntrypoints, restoreBuildEntrypoints } = await import("../lib/build-entrypoints.mjs")
  fc.assert(fc.property(
    fc.constantFrom("lib", "rollupOptions", "rolldownOptions", "pack"),
    fc.constantFrom("single", "array", "map"), fc.constantFrom('"', "'", "`"),
    fc.boolean(), fc.constantFrom("object", "alias", "namespace", "callback", "block"),
    (kind, shape, quote, rooted, wrapper) => {
      const path = rooted ? "./leaf.ts" : "./src/leaf.ts"
      const value = quote + path + quote
      const keep = quote + "./untouched.ts" + quote
      const input = shape === "single" ? value : shape === "array" ? `[${value}, ${keep}]` : `{ main: ${value}, untouched: ${keep} }`
      const field = kind === "lib" ? "entry" : "input"
      const build = kind === "pack" ? `pack: { entry: ${input} }` : `build: { ${kind}: { ${field}: ${input} } }`
      const config = `{ ${rooted ? 'root: "src", ' : ""}${build}, define: { SOURCE: ${value} } }`
      const prefix = wrapper === "namespace" ? 'import * as Vite from "vite";\n' : 'import { defineConfig as dc } from "vite-plus";\n'
      const exported = wrapper === "object" ? config : wrapper === "alias" ? `dc(${config})` : wrapper === "namespace" ? `Vite.defineConfig(${config})`
        : wrapper === "callback" ? `dc(() => (${config}))` : `dc(() => { return ${config}; })`
      const text = prefix + `// do not rewrite ${path}\nexport default ${exported};\n`
      fixture(text, (root, file, renames) => {
        const result = rewriteBuildEntrypoints(root, [file], renames, ts)
        assert.equal(result.edits.length, 1)
        assert.deepEqual(result.warnings, [])
        const after = readFileSync(join(root, file), "utf8")
        const expectedInput = input.replace(path, path.replace(/\.ts$/, ".vibe"))
        assert.equal(after, text.replace(input, expectedInput))
        assert.ok(existsSync(join(root, "packages/app", rooted ? "src" : ".", result.edits[0].to)))
        assert.equal(readFileSync(join(root, renames[0].to), "utf8"), corpus.source)
        assert.equal(rewriteBuildEntrypoints(root, [file], renames, ts).edits.length, 0)
        assert.equal(restoreBuildEntrypoints(root, result.edits, renames[0].from, ts).length, 1)
        assert.equal(readFileSync(join(root, file), "utf8"), text)
      })
    }
  ), { seed: 441016, numRuns: 180 })
})

test("computed roots, entries and later spreads are left as written with a location", async () => {
  const { rewriteBuildEntrypoints } = await import("../lib/build-entrypoints.mjs")
  for (const text of [
    'export default { root: getRoot(), build: { lib: { entry: "src/leaf.ts" } } };\n',
    'export default { build: { lib: { entry: `${stem}.browser.ts` } } };\n',
    'export default { build: { lib: { entry: "src/leaf.ts" } }, ...other };\n',
    'export default { build: { lib: { entry: "src/leaf.ts", ...other } } };\n'
  ]) fixture(text, (root, file, renames) => {
    const result = rewriteBuildEntrypoints(root, [file], renames, ts)
    assert.deepEqual(result.edits, [])
    assert.ok(result.warnings.some(w => w.startsWith(file + ":1:")))
    assert.equal(readFileSync(join(root, file), "utf8"), text)
  })
})

test("a build config test or fixture and unrelated source strings stay byte identical", async () => {
  const { rewriteBuildEntrypoints } = await import("../lib/build-entrypoints.mjs")
  fixture(corpus.config.replaceAll("entry.ts", "leaf.ts"), (root, file, renames) => {
    const protectedFile = "packages/app/tests/vite.config.ts"
    mkdirSync(join(root, "packages/app/tests"))
    const text = readFileSync(join(root, file), "utf8")
    writeFileSync(join(root, protectedFile), text)
    const result = rewriteBuildEntrypoints(root, [protectedFile, file], renames, ts)
    assert.equal(readFileSync(join(root, protectedFile), "utf8"), text)
    assert.equal(result.edits.length, 1)
  })
})

function declaration(text) {
  const file = "/vibe-entry-oracle/config.ts"
  const options = { strict: true, types: [], declaration: true, emitDeclarationOnly: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host)
  host.readFile = path => path === file ? text : read(path)
  host.getSourceFile = (path, version) => {
    const input = host.readFile(path)
    return input === undefined ? undefined : ts.createSourceFile(path, input, version, true)
  }
  let emitted
  host.writeFile = (path, output) => { if (path.endsWith(".d.ts")) emitted = output }
  const program = ts.createProgram([file], options, host)
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")), [])
  program.emit()
  assert.ok(emitted)
  return emitted
}

test("property: rewritten literal entry configurations retain their TypeScript declarations", async () => {
  const { rewriteBuildEntrypoints } = await import("../lib/build-entrypoints.mjs")
  fc.assert(fc.property(fc.constantFrom("lib", "rollupOptions", "rolldownOptions", "pack"), fc.boolean(), (kind, many) => {
    const value = many ? '["src/leaf.ts", "src/keep.ts"]' : '"src/leaf.ts"'
    const input = kind === "pack" ? `pack: { entry: ${value} }` : `build: { ${kind}: { ${kind === "lib" ? "entry" : "input"}: ${value} } }`
    const before = `export default { ${input} };\n`
    fixture(before, (root, file, renames) => {
      rewriteBuildEntrypoints(root, [file], renames, ts)
      assert.equal(declaration(readFileSync(join(root, file), "utf8")), declaration(before))
    })
  }), { seed: 441017, numRuns: 12 })
})

test("CommonJS Vite configs follow their literal entries too", async () => {
  const { rewriteBuildEntrypoints, restoreBuildEntrypoints } = await import("../lib/build-entrypoints.mjs")
  for (const name of ["module.exports", "exports.default"]) {
    const text = `${name} = { build: { lib: { entry: "src/leaf.ts" } } };\n`
    fixture(text, (root, file, renames) => {
      const result = rewriteBuildEntrypoints(root, [file], renames, ts)
      assert.equal(result.edits.length, 1)
      assert.match(readFileSync(join(root, file), "utf8"), /leaf\.vibe/)
      restoreBuildEntrypoints(root, result.edits, renames[0].from, ts)
      assert.equal(readFileSync(join(root, file), "utf8"), text)
    })
  }
})

test("revert preserves a configuration whose root was independently redirected", async () => {
  const { rewriteBuildEntrypoints, restoreBuildEntrypoints } = await import("../lib/build-entrypoints.mjs")
  fixture(corpus.config.replaceAll("entry.ts", "leaf.ts"), (root, file, renames) => {
    const result = rewriteBuildEntrypoints(root, [file], renames, ts)
    const redirected = readFileSync(join(root, file), "utf8").replace("export default {", 'export default { root: "other",')
    writeFileSync(join(root, file), redirected)
    assert.deepEqual(restoreBuildEntrypoints(root, result.edits, renames[0].from, ts), [])
    assert.equal(readFileSync(join(root, file), "utf8"), redirected)
  })
})

test("t3code desktop: pack arrays retain disjoint conditional options and follow the renamed entry", async () => {
  const { rewriteBuildEntrypoints, restoreBuildEntrypoints } = await import("../lib/build-entrypoints.mjs")
  const text = corpus.packConfig
  fixture(text, (root, file, renames) => {
    const result = rewriteBuildEntrypoints(root, [file], renames, ts)
    assert.equal(result.edits.length, 1)
    assert.deepEqual(result.warnings, [])
    assert.equal(readFileSync(join(root, file), "utf8"), text.replace('"src/leaf.ts"', '"src/leaf.vibe"'))
    restoreBuildEntrypoints(root, result.edits, renames[0].from, ts)
    assert.equal(readFileSync(join(root, file), "utf8"), text)
  })
})

test("property: pack arrays only follow a batch entry when later options cannot override it", async () => {
  const { rewriteBuildEntrypoints } = await import("../lib/build-entrypoints.mjs")
  fc.assert(fc.property(fc.boolean(), fc.integer({ min: 1, max: 5 }), (overrides, count) => {
    const spread = overrides ? '...(flag ? { entry: ["src/other.ts"] } : {})' : '...(flag ? { onSuccess: "node launch.mjs" } : {})'
    const rows = Array.from({ length: count }, () => `{ entry: ["src/leaf.ts"], ${spread} }`)
    const text = `export default { pack: [${rows.join(", ")}] };\n`
    fixture(text, (root, file, renames) => {
      const result = rewriteBuildEntrypoints(root, [file], renames, ts)
      assert.equal(result.edits.length, overrides ? 0 : count)
      assert.equal(readFileSync(join(root, file), "utf8"), overrides ? text : text.replaceAll('"src/leaf.ts"', '"src/leaf.vibe"'))
      if (overrides) assert.ok(result.warnings.length)
    })
  }), { seed: 441018, numRuns: 80 })
})

test("repair sees both build rewrites and unsupported input locations", async () => {
  const { rewriteBuildEntrypoints } = await import("../lib/build-entrypoints.mjs")
  const { repairPrompt } = await import("../lib/repair.mjs")
  fixture('export default { pack: [{ entry: "src/leaf.ts" }, { entry: computeEntry() }] };\n', (root, file, renames) => {
    const buildEntries = rewriteBuildEntrypoints(root, [file], renames, ts)
    assert.equal(buildEntries.edits.length, 1)
    assert.equal(buildEntries.warnings.length, 1)
    const prompt = repairPrompt({ context: "rules", run: "run", batch: "01", target: ".", packages: ["."], test: "tests", files: [], step: "step",
      codemod: { buildEntries, fix: { byFile: {}, refused: [] } }, compile: { diagnostics: [], newErrors: [] } })
    assert.ok(prompt.includes("src/leaf.vibe"))
    assert.ok(prompt.includes(buildEntries.warnings[0]))
    assert.ok(prompt.includes("Build inputs requiring review"))
  })
})
