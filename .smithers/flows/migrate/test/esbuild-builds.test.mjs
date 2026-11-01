import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { addEsbuildPlugin, wireEsbuildBuilds } from "../lib/esbuild-builds.mjs"

// The runtime package's TypeScript (bun install in packages/runtime) has the compiler API.
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const wire = (text, fileName) => addEsbuildPlugin(text, ts, { fileName })
const syntaxErrors = (text, fileName = "x.ts") => ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS).parseDiagnostics.length

test("addEsbuildPlugin adds vibelang() last to each build and context call, in the file's style", () => {
  const text = `import { build, context as watch } from 'esbuild'
import { join } from 'node:path'

await build({ entryPoints: ['a.ts'], bundle: true })
const ctx = await watch({
  entryPoints: ['b.ts'],
  plugins: [mine()],
})
await build({
  entryPoints: ['c.ts'],
  plugins: [],
})
`
  const { text: wired, refusals } = wire(text)
  assert.deepEqual(refusals, [])
  assert.equal(wired, `import { build, context as watch } from 'esbuild'
import { join } from 'node:path'
import vibelang from 'vibelang-unplugin/esbuild'

await build({ plugins: [vibelang()], entryPoints: ['a.ts'], bundle: true })
const ctx = await watch({
  entryPoints: ['b.ts'],
  plugins: [mine(), vibelang()],
})
await build({
  entryPoints: ['c.ts'],
  plugins: [vibelang()],
})
`)
  assert.deepEqual(wire(wired), { text: wired, refusals: [] })
})

test("addEsbuildPlugin follows a namespace or default import, a const of options and a local helper that returns them", () => {
  const text = `import * as esbuild from "esbuild"
import bundler from "esbuild"

const shared = {
  bundle: true,
}
function optionsFor(entry: string) {
  if (entry) return { entryPoints: [entry], ...{ minify: true } }
  return { entryPoints: [] }
}
const arrow = (entry: string) => ({ entryPoints: [entry] } satisfies esbuild.BuildOptions)
await esbuild.build(shared)
await esbuild.context(optionsFor("a.ts"))
await bundler.build(arrow("b.ts"))
`
  const { text: wired, refusals } = wire(text)
  assert.deepEqual(refusals, [])
  assert.equal(wired.match(/vibelang\(\)/g).length, 4)
  assert.match(wired, /const shared = \{\n  plugins: \[vibelang\(\)\],\n  bundle: true,/)
  assert.match(wired, /return \{ plugins: \[vibelang\(\)\], entryPoints: \[entry\], \.\.\.\{ minify: true \} \}/)
  assert.match(wired, /\(\{ plugins: \[vibelang\(\)\], entryPoints: \[entry\] \} satisfies/)
  assert.equal(syntaxErrors(wired), 0)
})

test("addEsbuildPlugin keeps a plugins expression and a shorthand, spreading them first", () => {
  const text = `import { build } from "esbuild"
export const run = async (extra: Plugin[], plugins?: Plugin[]) => {
  await build({ entryPoints: ["a.ts"], plugins: extra })
  await build({ entryPoints: ["a.ts"], plugins })
}
`
  const { text: wired, refusals } = wire(text)
  assert.deepEqual(refusals, [])
  assert.match(wired, /plugins: \[\.\.\.\(extra \?\? \[\]\), vibelang\(\)\]/)
  assert.match(wired, /plugins: \[\.\.\.\(plugins \?\? \[\]\), vibelang\(\)\] \}/)
})

test("addEsbuildPlugin refuses, with the line, what it cannot edit safely and edits the rest", () => {
  const text = `import { build, buildSync } from "esbuild"
import * as esbuild from "esbuild"

export async function bundle(options: BuildOptions, base: BuildOptions) {
  await build(options)
  await build({ ...options, entryPoints: ["a.ts"] })
  await build({ plugins: [a()], ...base })
  await build({ ...{ plugins: [b()] }, bundle: true })
  buildSync({ entryPoints: ["a.ts"] })
  esbuild.buildSync({ entryPoints: ["a.ts"] })
  await build()
  await build({ ...(flag ? {} : { minify: true }), entryPoints: ["ok.ts"] })
}
const used = { bundle: true }
await build(used)
console.log(used)
const { build: late } = require("esbuild")
`
  const { text: wired, refusals } = wire(text)
  assert.deepEqual(refusals.map((refusal) => refusal.line), [5, 6, 7, 8, 9, 10, 11, 15, 17])
  assert.ok(refusals.every((refusal) => /by hand|no plugins/.test(refusal.reason)), JSON.stringify(refusals))
  assert.match(refusals[0].reason, /options, options, are not an object literal/)
  assert.match(refusals[1].reason, /spread options, which may set plugins/)
  assert.match(refusals[4].reason, /buildSync takes no plugins/)
  assert.match(refusals.at(-1).reason, /loads esbuild with require\(\)/)
  assert.equal(wired.match(/vibelang\(\)/g).length, 1)
  assert.match(wired, /build\(\{ plugins: \[vibelang\(\)\], \.\.\.\(flag \? \{\} : \{ minify: true \}\), entryPoints: \["ok.ts"\] \}\)/)
})

test("addEsbuildPlugin reuses an imported plugin, picks a free name, and leaves a file without esbuild calls as it is", () => {
  const imported = `import { build } from "esbuild"
import vibe from "vibelang-unplugin/esbuild"
await build({ plugins: [vibe()] })
await build({ entryPoints: ["b.ts"] })
`
  assert.equal(wire(imported).text, imported.replace('build({ entryPoints: ["b.ts"] })', 'build({ plugins: [vibe()], entryPoints: ["b.ts"] })'))
  const taken = `import { build } from "esbuild"
const vibelang = 1
await build({})
`
  assert.equal(wire(taken).text, `import { build } from "esbuild"
import vibelangEsbuild from "vibelang-unplugin/esbuild"
const vibelang = 1
await build({ plugins: [vibelangEsbuild()] })
`)
  for (const text of ["import { transformSync } from \"esbuild\"\ntransformSync(\"x\")\n", "export const build = (options: object) => options\nbuild({})\n", "import type { BuildOptions } from \"esbuild\"\n"]) {
    assert.deepEqual(wire(text), { text, refusals: [] })
  }
  const jsx = `import { build } from "esbuild"\nconst view = <div />\nawait build({ entryPoints: ["a.tsx"] })\n`
  assert.equal(syntaxErrors(wire(jsx, "a.test.tsx").text, "a.test.tsx"), 0)
})

test("Smithers' embedded esbuild calls (corpus): each is wired once and parses, or refused with its line", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-embedded-esbuild.json", import.meta.url), "utf8"))
  assert.ok(corpus.cases.length >= 10)
  for (const entry of corpus.cases) {
    const { text, refusals } = wire(entry.text, entry.file)
    const added = (text.match(/vibelang\(\)/g) ?? []).length - (entry.text.match(/vibelang\(\)/g) ?? []).length
    assert.equal(added, entry.plugins, entry.name)
    assert.deepEqual(refusals.map((refusal) => entry.refusals.some((reason) => refusal.reason.includes(reason))), entry.refusals.map(() => true), `${entry.name}: ${JSON.stringify(refusals)}`)
    if (entry.plugins) {
      assert.equal((text.match(/vibelang-unplugin\/esbuild/g) ?? []).length, 1, entry.name)
      assert.equal(syntaxErrors(text, entry.file), syntaxErrors(entry.text, entry.file), entry.name)
      // Everything the call had stays, in order: the edit only inserts.
      let at = 0
      assert.ok([...entry.text].every((char) => (at = text.indexOf(char, at) + 1) > 0), entry.name)
    }
    assert.deepEqual(wire(text, entry.file).text, text, `${entry.name}: a second run changes nothing`)
  }
  // The existing plugin of tab.test.ts keeps deciding first; vibelang() follows it.
  const tab = corpus.cases.find((entry) => entry.file === "apps/mvp/src/flows/tab.test.ts")
  assert.match(wire(tab.text, tab.file).text, /\n {6}\}, vibelang\(\)\],\n/)
})

test("wireEsbuildBuilds wires the scripts and sources of packages that reach migrated sources, never a test or what only tests use", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-esbuild-builds-"))
  try {
    const put = (file, text) => {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const call = 'import { build } from "esbuild"\nawait build({ entryPoints: ["src/index.ts"] })\n'
    put("package.json", JSON.stringify({ name: "root", private: true }))
    put("packages/util/package.json", JSON.stringify({ name: "util" }))
    put("packages/util/test/BrowserBundle.test.ts", call)
    put("packages/web/package.json", JSON.stringify({ name: "web", exports: { "./check": "./dist/check.js" }, dependencies: { util: "workspace:*" }, devDependencies: { esbuild: "0.28.2" } }))
    put("packages/web/scripts/build.mjs", call)
    put("packages/web/test/bundle.test.ts", 'import { bundle } from "./fixtures/bundle.ts"\nimport { only } from "../src/only-tests.ts"\nimport { shared } from "../src/shared.ts"\nimport { check } from "../src/check.ts"\n')
    put("packages/web/test/fixtures/bundle.ts", call)
    put("packages/web/test/fixtures/input/app.ts", call)
    put("packages/web/test/sync.test.ts", 'import { buildSync } from "esbuild"\n\nbuildSync({})\n')
    // A helper under src that only a test imports is the test's; one a source imports too, or the manifest exports, is a source.
    put("packages/web/src/only-tests.ts", call)
    put("packages/web/src/shared.ts", call)
    put("packages/web/src/index.ts", 'export * from "./shared.js"\n')
    put("packages/web/src/check.ts", call)
    put("packages/web/dist/old.js", call)
    put("packages/host/package.json", JSON.stringify({ name: "host", dependencies: { util: "workspace:*", esbuild: "0.28.2" } }))
    put("packages/host/src/Sandbox.ts", call)
    put("packages/alone/package.json", JSON.stringify({ name: "alone" }))
    put("packages/alone/scripts/a.mjs", call)
    const specsFor = () => ({ vibelang: "file:/t/v.tgz", "vibelang-unplugin": "file:/t/u.tgz" })
    const wired = wireEsbuildBuilds({ root, packages: [{ dir: "packages/util" }], ts, specsFor })
    assert.deepEqual(wired.wired, ["packages/host/src/Sandbox.ts", "packages/web/scripts/build.mjs", "packages/web/src/check.ts", "packages/web/src/shared.ts"])
    for (const file of wired.wired) assert.match(readFileSync(join(root, file), "utf8"), /plugins: \[vibelang\(\)\]/)
    const untouched = ["packages/util/test/BrowserBundle.test.ts", "packages/web/test/fixtures/bundle.ts", "packages/web/test/fixtures/input/app.ts", "packages/web/src/only-tests.ts", "packages/alone/scripts/a.mjs", "packages/web/dist/old.js"]
    for (const file of untouched) assert.equal(readFileSync(join(root, file), "utf8"), call, file)
    const manifest = (dir) => JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"))
    assert.deepEqual(manifest("packages/web").devDependencies, { esbuild: "0.28.2", "vibelang-unplugin": "file:/t/u.tgz", vibelang: "file:/t/v.tgz" })
    // A source that bundles at run time, in a package that ships esbuild, ships the plugin too.
    assert.equal(manifest("packages/host").dependencies["vibelang-unplugin"], "file:/t/u.tgz")
    assert.equal(manifest("packages/host").devDependencies.vibelang, "file:/t/v.tgz")
    // A package whose only esbuild calls are its tests' keeps its manifest.
    assert.deepEqual(manifest("packages/util"), { name: "util" })
    const left = "a test bundles with esbuild; setup leaves tests as they are (decided detail 272), so a .vibe module it bundles resolves only through the migrated package's emitted JavaScript (opencode-32)"
    assert.deepEqual(wired.warnings.sort(), ["packages/util/test/BrowserBundle.test.ts", "packages/web/src/only-tests.ts", "packages/web/test/fixtures/bundle.ts", "packages/web/test/fixtures/input/app.ts"].map((file) => `${file}: ${left}`))
    assert.deepEqual(wireEsbuildBuilds({ root, packages: [{ dir: "packages/util" }], ts, specsFor }).changed, [], "a second run changes nothing")
    const old = wireEsbuildBuilds({ root, packages: [{ dir: "packages/alone" }], ts, specsFor: () => ({ vibelang: "file:/t/v.tgz" }) })
    assert.ok(old.warnings.some((warning) => /rebuild the toolchain/.test(warning)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
