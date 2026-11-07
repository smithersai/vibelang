// VIP-40: unplugin serves each module body under the compiler's canonical
// filename, from the compiled parent, and a rebuild after the parent changes
// bundles the new body. Run test/run.sh, which links the fixtures' node_modules.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { rollup } from "rollup"
import { rolldown } from "rolldown"
import vibelangRollup from "../src/rollup.js"
import vibelangRolldown from "../src/rolldown.js"

// rule-evidence: docs/design/vips/0040-module-declarations.md#f7120f477684687d
const rule = "**Loaders and bundlers.** `vibelang/register`, the Bun plugin, Vite and unplugin serve each body's canonical filename from the compiled parent, using the same source basename, encoded name and output suffix as the compiler, cached by the parent's version."
const here = fileURLToPath(new URL(".", import.meta.url))
const compiler = process.env.VIBELANG_BINARY

const parent = (n) => [
  `module Über { export const n = ${n} }`,
  "module $x { export const n = 2 }",
  "module Text { export const n = 3 }",
  "module snake_case9 { export const n = 4 }",
  "import { n as a } from Über",
  "import { n as b } from $x",
  "import { n as c } from Text",
  "import { n as d } from snake_case9",
  "export const all = [a, b, c, d]",
  ""
].join("\n")

async function project(t) {
  // Fixtures share test/.fixtures/node_modules, which run.sh links.
  const root = await mkdtemp(join(here, ".fixtures", "body-names-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, "package.json"), '{"type":"module"}')
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [],
    rootDir: ".", outDir: "dist", rewriteRelativeImportExtensions: true }, include: ["main.vibe"] }))
  await writeFile(join(root, "main.vibe"), parent(1))
  return root
}

for (const [name, bundle, plugin] of [["rollup", rollup, vibelangRollup], ["rolldown", rolldown, vibelangRolldown]]) {
  test(`${name} bundles each body under the compiler's canonical filename, cached by the parent's version (VIP-40)`, async (t) => {
    assert.ok(rule.includes("unplugin"))
    const root = await project(t)
    const emitted = spawnSync(compiler, ["-p", "tsconfig.json", "--outDir", "names", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr)
    const names = (await readdir(join(root, "names"))).filter((file) => /^main\.vibe\..+\.js$/.test(file)).sort()
    assert.deepEqual(names, ["main.vibe.-24-x.js", "main.vibe.-54-ext.js", "main.vibe.-dc-ber.js", "main.vibe.snake_case9.js"])
    // One plugin instance across both builds, as a watcher keeps it.
    const vibelang = plugin({ root, compiler })
    // Records what each import of the compiled parent resolves to, before any
    // bundler inlines or drops a module.
    const resolved = new Set()
    const spy = { name: "resolved-ids", async resolveId(source, importer, options) {
      const result = await this.resolve(source, importer, { ...options, skipSelf: true })
      const file = result?.id.split(/[\\/]/).at(-1)
      if (file?.startsWith("main.vibe.")) resolved.add(file)
      return result
    } }
    const once = async () => {
      resolved.clear()
      const built = await bundle({ input: join(root, "main.vibe"), plugins: [spy, vibelang], cwd: root, logLevel: "silent" })
      try {
        const { output } = await built.generate({ format: "esm" })
        const chunk = output.find((file) => file.type === "chunk")
        const module = await import("data:text/javascript," + encodeURIComponent(chunk.code))
        return { ids: [...resolved].sort(), all: module.all }
      } finally {
        await built.close()
      }
    }
    assert.deepEqual(await once(), { ids: names, all: [1, 2, 3, 4] })
    await writeFile(join(root, "main.vibe"), parent(10))
    assert.deepEqual(await once(), { ids: names, all: [10, 2, 3, 4] })
  })
}
