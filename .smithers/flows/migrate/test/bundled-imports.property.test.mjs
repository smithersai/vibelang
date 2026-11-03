// opencode-32: an unchanged Bun.build or `bun build` in a test bundles TypeScript
// that names a relative .vibe module. The route must reach the bundler without
// touching a test, and must leave everything no test bundles as it is.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { routeBundledImports } from "../lib/bundled-imports.mjs"
import { testBundleDeferrals } from "../lib/test-bundles.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const fc = createRequire(join(repo, "packages/runtime/package.json"))("fast-check")
const ts = loadTypeScript([join(repo, "packages/compiler/test/eslint"), join(repo, ".smithers")])
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-bun-build-relative.json", import.meta.url)))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "opencode-bundled-imports-"))
  put(root, "package.json", JSON.stringify({ name: "@demo/core", type: "module", imports: { "#sqlite": "./src/sqlite.js" }, scripts: { test: "bun test" } }, null, 2) + "\n")
  for (const group of [corpus.files, corpus.emitted, corpus.tests]) for (const [file, text] of Object.entries(group)) put(root, file, text)
  return root
}
const packages = [{ dir: ".", sources: ["src"] }]
const snapshot = root => Object.fromEntries(["package.json", ...Object.keys(corpus.files), ...Object.keys(corpus.tests)].map(f => [f, readFileSync(join(root, f), "utf8")]))
const bun = () => spawnSync("bun", ["--version"]).status === 0 ? "bun" : null

test("opencode core: both unchanged test bundles are found, Bun.spawn included", () => {
  const root = fixture()
  try {
    const found = testBundleDeferrals(root, Object.keys(corpus.files).filter(f => f.endsWith(".vibe")), { ts })
    assert.deepEqual(found.map(item => item.file).sort(), corpus.routed.concat("src/database/shape.vibe").filter(f => f !== "src/database/shape.vibe").sort())
    assert.ok(found.find(item => item.file === "src/effect/keyed-mutex.vibe").bundledBy.some(by => by.bundler === "bun build"))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("opencode core: a route changes the bundled value edges and nothing else, and restore undoes it", () => {
  const root = fixture()
  try {
    const before = snapshot(root)
    const routed = routeBundledImports({ root, packages, ts })
    assert.deepEqual(routed.modules, corpus.routed)
    const database = readFileSync(join(root, "src/database/database.ts"), "utf8")
    assert.match(database, /from "#vibelang\/emitted\/src\/database\/count"/)
    assert.match(database, /import type \{ Shape \} from "\.\/shape\.vibe"/)
    assert.equal(readFileSync(join(root, "src/free.ts"), "utf8"), before["src/free.ts"])
    for (const file of Object.keys(corpus.tests)) assert.equal(readFileSync(join(root, file), "utf8"), before[file])
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    assert.equal(manifest.imports["#vibelang/emitted/*"], undefined)
    for (const source of corpus.routed) {
      const path = source.replace(/\.vibe$/, "")
      assert.deepEqual(manifest.imports["#vibelang/emitted/" + path], {
        types: "./" + path + ".d.vibe.ts",
        "vibelang-source": "./" + source,
        default: "./.vibelang/js/" + path + ".js"
      })
    }
    assert.equal(manifest.imports["#sqlite"], "./src/sqlite.js")
    const after = snapshot(root)
    assert.deepEqual(routeBundledImports({ root, packages, ts }).changed, [], "a second route changes nothing")
    assert.deepEqual(snapshot(root), after)
    routeBundledImports({ root, packages, ts, restore: true })
    assert.deepEqual(snapshot(root), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("opencode core: unchanged bun build reads the routed modules", { skip: !bun() && "needs bun" }, () => {
  const root = fixture()
  try {
    const build = entry => spawnSync("bun", ["build", entry, "--target=node", "--format=esm", "--outdir=" + join(root, "out")], { cwd: root, encoding: "utf8" })
    const failed = build("src/mcp/index.ts")
    assert.notEqual(failed.status, 0)
    assert.match(failed.stdout + failed.stderr, /No matching export/)
    routeBundledImports({ root, packages, ts })
    const built = build("src/mcp/index.ts")
    assert.equal(built.status, 0, built.stdout + built.stderr)
    const run = spawnSync("bun", [join(root, "out/index.js")], { cwd: root, encoding: "utf8" })
    assert.equal(run.status, 0, run.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a module with no emitted JavaScript is left for the bundler to report", () => {
  const root = fixture()
  try {
    rmSync(join(root, ".vibelang/js/src/database/count.js"))
    const routed = routeBundledImports({ root, packages, ts })
    assert.deepEqual(routed.modules, ["src/effect/keyed-mutex.vibe"])
    assert.match(readFileSync(join(root, "src/database/database.ts"), "utf8"), /"\.\/count\.vibe"/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/)
const edge = fc.record({ dep: name, form: fc.constantFrom("named", "reexport", "dynamic", "side", "type", "comment", "string"), reached: fc.boolean() })
const render = (form, spec) => ({
  named: `import { value } from "${spec}"\nexport const v = value\n`,
  reexport: `export { value } from "${spec}"\n`,
  dynamic: `export const load = () => import("${spec}")\n`,
  side: `import "${spec}"\n`,
  type: `import type { T } from "${spec}"\nexport type U = T\n`,
  comment: `// import { value } from "${spec}"\n`,
  string: `export const text = 'from "${spec}"'\n`
})[form]

test("bundled-import-routes: only reached value edges move; tests and restore hold", async () => {
  await checkProperty(fc, {
    name: "opencode-bundled-import-routes",
    rule: "Only value edges to a bundled .vibe module move, and restore puts back every byte.",
    command: "node --test .smithers/flows/migrate/test/bundled-imports.property.test.mjs",
    arbitrary: fc.array(edge, { minLength: 1, maxLength: 6 }),
    numRuns: 60,
    check: edges => {
    const root = mkdtempSync(join(tmpdir(), "opencode-bundled-property-"))
    try {
      put(root, "package.json", JSON.stringify({ name: "@demo/x", type: "module" }, null, 2) + "\n")
      const reached = new Set(), sources = {}
      edges.forEach((item, i) => {
        const vibe = `src/d${i}/${item.dep}.vibe`
        put(root, vibe, "export const value = 1\n")
        put(root, `.vibelang/js/src/d${i}/${item.dep}.js`, "export const value = 1\n")
        const file = `src/m${i}.ts`
        sources[file] = render(item.form, `./d${i}/${item.dep}.vibe`)
        put(root, file, sources[file])
        if (item.reached) reached.add(vibe)
      })
      const manifest = readFileSync(join(root, "package.json"), "utf8")
      const result = routeBundledImports({ root, packages, ts, bundled: reached })
      edges.forEach((item, i) => {
        const file = `src/m${i}.ts`, text = readFileSync(join(root, file), "utf8")
        const moves = item.reached && ["named", "reexport", "dynamic", "side"].includes(item.form)
        if (moves) assert.equal(text, render(item.form, `#vibelang/emitted/src/d${i}/${item.dep}`))
        else assert.equal(text, sources[file])
      })
      const used = edges.some(item => item.reached && ["named", "reexport", "dynamic", "side"].includes(item.form))
      assert.equal(result.changed.includes("package.json"), used)
      routeBundledImports({ root, packages, ts, restore: true })
      for (const [file, text] of Object.entries(sources)) assert.equal(readFileSync(join(root, file), "utf8"), text)
      assert.equal(readFileSync(join(root, "package.json"), "utf8"), manifest)
    } finally { rmSync(root, { recursive: true, force: true }) }
    }
  })
})

test("a native importer migrated later keeps its exact route through native Vibe syntax", () => {
  const root = fixture()
  const compiler = process.env.VIBELANG_NATIVE_COMPILER || join(repo, "packages/compiler/native/vibelang")
  assert.ok(existsSync(compiler), "native compiler required for Vibe import routing")
  try {
    routeBundledImports({ root, packages, ts, compiler })
    const native = "src/database/database.ts", vibe = "src/database/database.vibe"
    const routed = readFileSync(join(root, native), "utf8")
    put(root, vibe, routed)
    rmSync(join(root, native))
    const before = readFileSync(join(root, "package.json"), "utf8")
    assert.deepEqual(routeBundledImports({ root, packages, ts, compiler }).changed, [])
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), before)
    routeBundledImports({ root, packages, ts, compiler, restore: true })
    assert.match(readFileSync(join(root, vibe), "utf8"), /from "\.\/count\.vibe"/)
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).imports["#sqlite"], "./src/sqlite.js")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
