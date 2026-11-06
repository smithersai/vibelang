import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { rolldown } from "rolldown"
import vibelang from "../src/rolldown.js"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const corpus = JSON.parse(await readFile(new URL("./property-regressions/alchemy-runtime-boundary.json", import.meta.url), "utf8"))
const rule = "Type checkers use \`.d.vibe.ts\`; linters, Knip, bundlers and test runners read \`.vibe\`."

test("runtime dependency coverage quotes the source interoperability contract", async () => {
  assert.ok((await readFile(SpecPath("007-tooling.md"), "utf8")).includes(rule))
  assert.ok((await readFile(SpecPath("005-services.md"), "utf8")).includes("Emitted code imports each namespace from its subpath."))
})

async function bundleGraph({ extension = "vibe", directory = "src", barrel = false, source, name = "MigrationError" }) {
  const root = await mkdtemp(join(here, ".fixtures", "runtime-boundary-"))
  try {
    const leaf = join(root, directory, "native." + extension)
    await mkdir(join(root, directory), { recursive: true })
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}')
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
        jsx: "preserve", strict: true, skipLibCheck: true, types: [], rootDir: ".", outDir: "dist",
        rewriteRelativeImportExtensions: true },
      include: ["**/*.vibe", "**/*.vibex", "**/*.ts"]
    }))
    await writeFile(leaf, source)
    const entry = barrel ? join(root, "entry.ts") : leaf
    if (barrel) await writeFile(entry, "export { " + name + ' } from "./' + directory + "/native." + extension + '"\n')
    const graph = []
    const bundle = await rolldown({
      cwd: root, input: entry, platform: "neutral",
      external: [/^effect\//, /^node:/],
      plugins: [vibelang(), {
        name: "record-runtime-boundary",
        moduleParsed(info) {
          graph.push({ id: info.id, imports: [...info.importedIds, ...info.dynamicallyImportedIds] })
        }
      }]
    })
    let output
    try { output = await bundle.generate({ format: "esm" }) } finally { await bundle.close() }
    const chunk = output.output.find(item => item.type === "chunk")
    const path = join(root, "bundle.mjs")
    await writeFile(path, chunk.code)
    const namespace = await import(pathToFileURL(path).href)
    return { graph, imports: chunk.imports, value: namespace[name] }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function hasFileSystem(result) {
  return result.graph.some(module => module.imports.includes("effect/FileSystem"))
}
function assertPortable(result, name) {
  const edges = result.graph.filter(module => module.imports.includes("effect/FileSystem"))
  assert.deepEqual(edges, [], "unused platform APIs must not enter the parsed bundle graph")
  assert.equal(result.imports.includes("effect/FileSystem"), false)
  assert.deepEqual(result.graph.filter(module => /\/effect\/dist\/FileSystem\.js$/.test(module.id)), [], "the physical Effect module must stay out too")
  const error = new result.value({ message: "missing migration" })
  assert.equal(error._tag, name)
  assert.equal(error.message, "missing migration")
}

test("the original TypeScript error keeps the runtime graph portable", async () => {
  const result = await bundleGraph({ extension: "ts",
    source: 'import * as Data from "effect/Data"; export class MigrationError extends Data.TaggedError("MigrationError")<{ message: string }> {}\n' })
  assertPortable(result, "MigrationError")
})

test(corpus.key, async () => {
  const result = await bundleGraph(corpus.input)
  assertPortable(result, "MigrationError")
})

test("an explicitly used experimental platform service keeps its dependency", async () => {
  const result = await bundleGraph({ source: "export const key = Experimental.FileSystem.FileSystem\n", name: "key" })
  assert.equal(hasFileSystem(result), true)
  assert.equal(typeof result.value, "function")
})

test("property: native error bundles retain behavior without unrelated platform dependencies", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    extension: fc.constantFrom("vibe", "vibex"),
    directory: fc.constantFrom("src", "nested/source", "source with spaces"),
    barrel: fc.boolean(),
    suffix: fc.integer({ min: 0, max: 9999 })
  }), async ({ suffix, ...layout }) => {
    const name = "MigrationError" + suffix
    const result = await bundleGraph({ ...layout, name, source: "export error " + name + " { message: string }\n" })
    assertPortable(result, name)
  }), { seed: 561106, numRuns: 16 })
})

