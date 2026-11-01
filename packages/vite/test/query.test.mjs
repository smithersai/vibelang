// Run through test/run.sh. A query on a .vibe id (foldkit's x.vibe?highlighted,
// Vite's ?raw and ?url) names a resource another plugin loads from the source;
// the plugin compiles only the module itself and Vite's own module queries.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import fc from "fast-check"
import { build } from "vite"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import vibelang from "../src/index.js"

const here = new URL("./", import.meta.url)
const compiler = process.env.VIBELANG_BINARY
const regressions = new URL("./property-regressions/", here)
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/foldkit-highlighted-query.json", here)))
const rule = "docs/user/src/setup/vite.md: Queries on a .vibe import"

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true,
    types: [], rootDir: ".", outDir: "dist", noEmitOnError: true, rewriteRelativeImportExtensions: true,
    allowArbitraryExtensions: true
  },
  include: ["**/*.vibe", "**/*.ts"]
})

async function fixture(t, files) {
  const base = fileURLToPath(new URL("./.fixtures/", here))
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "query-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }))
  await writeFile(join(root, "tsconfig.json"), tsconfig)
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(root, file, ".."), { recursive: true })
    await writeFile(join(root, file), text)
  }
  return root
}

// foldkit's website plugin: the rendered HTML of a source, as its default export.
const highlighted = (rendered) => ({
  name: "website-test-highlighted", enforce: "pre",
  load(id) { if (id.endsWith("?highlighted")) return `export default ${JSON.stringify(rendered)}` }
})

async function bundle(root, entry, plugins) {
  const built = await build({
    root, configFile: false, logLevel: "silent", plugins: [vibelang({ compiler }), ...plugins],
    build: { write: false, minify: false, lib: { entry: join(root, entry), formats: ["es"], fileName: "entry" },
      rollupOptions: { external: [/^effect(\/|$)/, /^vibelang-runtime(\/|$)/] } }
  })
  const chunk = (built.output || built[0].output).find((file) => file.type === "chunk" && file.isEntry)
  const file = join(root, "bundle.mjs")
  await writeFile(file, chunk.code)
  return import(pathToFileURL(file).href)
}

test("foldkit corpus: a .vibe?highlighted resource another plugin loads keeps its default export", async (t) => {
  const root = await fixture(t, corpus.files)
  const { rendered } = await bundle(root, "entry.ts", [highlighted("<code>native</code>")])
  assert.equal(rendered, "<code>native</code>")
})

test("the plain import of the same module still compiles and runs", async (t) => {
  const root = await fixture(t, {
    ...corpus.files,
    "run.ts": "import { Effect } from \"effect\"\nimport { value } from \"./input.vibe\"\nexport const result = Effect.runSync(value)\n"
  })
  const { result } = await bundle(root, "run.ts", [])
  assert.equal(result, 1)
})

test("Vite's ?raw and ?url resources of a .vibe module are Vite's, not compiled", async (t) => {
  const root = await fixture(t, {
    ...corpus.files,
    "assets.ts": "import source from \"./input.vibe?raw\"\nimport url from \"./input.vibe?url\"\nexport { source, url }\n",
    "env.d.ts": corpus.files["env.d.ts"] + "declare module \"*?raw\" { const value: string; export default value }\ndeclare module \"*?url\" { const value: string; export default value }\n"
  })
  const { source, url } = await bundle(root, "assets.ts", [])
  assert.equal(source, corpus.files["input.vibe"])
  // Vite's asset URL: the file's path, or its content inlined as a data URL.
  const inlined = /^data:[^;]*;base64,(.*)$/.exec(url)
  if (inlined) assert.equal(Buffer.from(inlined[1], "base64").toString(), corpus.files["input.vibe"])
  else assert.match(url, /\.vibe$/)
})

// Hook level: the plugin compiles an id that is the module itself or carries
// only Vite's module queries, and returns nothing for any other query.
const hookContext = { addWatchFile() {}, error(error) { throw Object.assign(new Error(error.message || error), error) } }
const viteKeys = ["import", "v", "t", "worker_file", "type"]
const viteQuery = fc.oneof(
  fc.constant(""), fc.constant("?import"), fc.constant("?worker_file&type=module"),
  fc.stringMatching(/^[0-9a-f]{1,8}$/).map((hash) => `?v=${hash}`),
  fc.nat().map((time) => `?t=${time}`),
  fc.stringMatching(/^[0-9a-f]{1,8}$/).map((hash) => `?v=${hash}&import`))
const otherQuery = fc.oneof(
  fc.constant("?highlighted"), fc.constant("?raw"), fc.constant("?url"), fc.constant("?worker"), fc.constant("?inline"),
  fc.constant("?import&highlighted"), fc.constant("?v=1&raw"),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/).filter((key) => !viteKeys.includes(key)).map((key) => `?${key}`))
const name = fc.array(fc.constantFrom(..."abcXYZ012_-λ雪🙂é部件"), { minLength: 1, maxLength: 12 }).map((letters) => letters.join(""))
const arbitrary = fc.record({ name, owned: fc.boolean() }).chain(({ name, owned }) =>
  (owned ? viteQuery : otherQuery).map((query) => ({ name, query, owned })))

test("property: the query decides whether the plugin compiles the id", async (t) => {
  const root = await fixture(t, {})
  const plugin = vibelang({ compiler })
  plugin.configResolved({ root, logger: { warn() {} } })
  t.after(() => plugin.closeBundle())
  const source = corpus.files["input.vibe"]
  await checkProperty(fc, {
    name: "vite-query-id-ownership", rule, command: "node --test test/query.test.mjs", regressions, numRuns: 100,
    arbitrary,
    async check(input) {
      const file = join(root, `${input.name}.vibe`)
      await writeFile(file, source)
      plugin.watchChange(file)
      const id = file + input.query
      const result = await plugin.transform.call(hookContext, source, id)
      if (input.owned) {
        assert.ok(result && typeof result.code === "string", `${input.query}: the module itself compiles`)
        assert.match(result.code, /value/, `${input.query}: compiled JavaScript`)
        assert.doesNotMatch(result.code, /effect \{/, `${input.query}: no .vibe syntax remains`)
      } else {
        assert.equal(result, undefined, `${input.query}: another plugin's resource is left alone`)
        const output = join(root, `${input.name}.vibe.text.js`) + input.query
        assert.equal(await plugin.load.call(hookContext, output), undefined, `${input.query}: load leaves it alone`)
      }
    }
  })
})
