// Run through test/run.sh. VIP-59 rule 8: an eval file (*.eval.vibe,
// *.eval.vibex) is never reachable from an application entry; the plugin
// refuses an import of one from a non-eval file.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "vite"
import vibelang from "../src/index.js"

const here = new URL("./", import.meta.url)
const compiler = process.env.VIBELANG_BINARY
const vip = readFileSync(new URL("../../../docs/design/vips/0059-eval-declarations.md", here), "utf8")

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true,
    types: [], rootDir: ".", outDir: "dist", noEmitOnError: true, rewriteRelativeImportExtensions: true,
    allowArbitraryExtensions: true, allowImportingTsExtensions: true, jsx: "react-jsx"
  },
  include: ["**/*.vibe", "**/*.vibex", "**/*.ts"]
})

const files = {
  "shared.vibe": "export const greeting = \"Hello\"\n",
  "greet.eval.vibe": "import { greeting } from \"./shared.vibe\"\nexport const cases = [greeting]\n",
  "other.eval.vibe": "import { cases } from \"./greet.eval.vibe\"\nexport const all = cases\n",
  "card.eval.vibex": "export const card = 1\n",
  "evaluate.vibe": "export const evaluate = 1\n"
}

async function fixture(t, extra = {}) {
  const base = fileURLToPath(new URL("./.fixtures/", here))
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "eval-files-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }))
  await writeFile(join(root, "tsconfig.json"), tsconfig)
  for (const [file, text] of Object.entries({ ...files, ...extra })) {
    await mkdir(join(root, file, ".."), { recursive: true })
    await writeFile(join(root, file), text)
  }
  return root
}

const bundle = (root, entry) => build({
  root, configFile: false, logLevel: "silent", plugins: [vibelang({ compiler })],
  build: { write: false, minify: false, lib: { entry: join(root, entry), formats: ["es"], fileName: "entry" },
    rollupOptions: { external: [/^effect(\/|$)/, /^vibelang-runtime(\/|$)/] } }
})
const entryCode = (built) => (built.output || built[0].output).find((file) => file.type === "chunk" && file.isEntry).code

test("VIP-59 states the bundle rule", () => {
  assert.ok(vip.includes("**Bundles.** An eval file is never reachable from an application entry. The bundler plugins refuse an import of one from a non-eval file."))
})

// Hook level: every spelling of an import of an eval file, from each kind of importer.
test("resolveId refuses an eval file imported from a non-eval file, in every spelling", async (t) => {
  const root = await fixture(t, { "main.ts": "", "app.vibe": "" })
  const plugin = vibelang({ compiler })
  plugin.configResolved({ root, logger: { warn() {} } })
  t.after(() => plugin.closeBundle())
  const context = { resolve: async () => null }
  const resolveId = (source, importer) => Promise.resolve().then(() => plugin.resolveId.call(context, source, importer, {}))
  const refused = (importer, source) => assert.rejects(resolveId(source, join(root, importer)), (error) => {
    assert.match(error.message, /imports the eval file .*(greet|card)\.eval\.vibex?/, `${importer} -> ${source}`)
    assert.ok(error.message.includes(join(root, importer)), error.message)
    assert.match(error.message, /`vibelang eval`/)
    assert.match(error.message, /never bundled into an application \(VIP-59\)/)
    return true
  }, `${importer} -> ${source}`)
  // A .ts importer needs no compile to resolve; a .vibe importer's emitted .js names do.
  for (const source of [
    "./greet.eval.vibe", "./greet.eval.js", "./greet.eval", "./greet.eval.vibe?import", "./card.eval.vibex", "./card.eval.jsx",
    join(root, "greet.eval.vibe")
  ]) await refused("main.ts", source)
  for (const source of ["./greet.eval.vibe", "./greet.eval", "./card.eval.vibex", join(root, "greet.eval.vibe")]) await refused("evaluate.vibe", source)
  // An eval file imports another eval file, and an eval file can be an entry.
  assert.match(await resolveId("./greet.eval.vibe", join(root, "other.eval.vibe")) ?? join(root, "greet.eval.vibe"), /greet\.eval\.vibe$/)
  await resolveId("./greet.eval.vibe", join(root, "card.eval.vibex"))
  await resolveId(join(root, "greet.eval.vibe"), undefined)
  // Names that only look alike are ordinary modules.
  await resolveId("./evaluate.vibe", join(root, "main.ts"))
  await resolveId("./shared.vibe", join(root, "main.ts"))
  await resolveId("./shared.vibe", join(root, "greet.eval.vibe"))
})

test("a build whose entry imports an eval file fails, and names both files", async (t) => {
  const root = await fixture(t, { "main.ts": "import { cases } from \"./greet.eval.vibe\"\nexport const total = cases.length\n" })
  await assert.rejects(bundle(root, "main.ts"), (error) => {
    assert.match(error.message, /main\.ts imports the eval file .*greet\.eval\.vibe/)
    assert.match(error.message, /never bundled into an application \(VIP-59\)/)
    return true
  })
})

test("a build fails when a .vibe module deep in the graph imports an eval file", async (t) => {
  const root = await fixture(t, {
    "app.vibe": "import { cases } from \"./greet.eval.vibe\"\nexport const total = cases.length\n",
    "main.ts": "export { total } from \"./app.vibe\"\n"
  })
  await assert.rejects(bundle(root, "main.ts"), /app\.vibe imports the eval file .*greet\.eval\.vibe/)
})

test("a build of an application that imports no eval file succeeds beside eval files", async (t) => {
  const root = await fixture(t, { "main.ts": "import { greeting } from \"./shared.vibe\"\nexport const text = greeting\n" })
  assert.match(entryCode(await bundle(root, "main.ts")), /Hello/)
})

test("an eval file builds as an entry, with the eval files it imports", async (t) => {
  const root = await fixture(t)
  assert.match(entryCode(await bundle(root, "other.eval.vibe")), /Hello/)
})
