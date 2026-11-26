import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "vite"
import vibelang from "../src/index.js"

// Another plugin's virtual module whose `\0` id ends in .ts or .vibe is that
// plugin's, as Rollup's convention says: vibelang-vite must neither compile it
// nor read it from disk. vibelang-unplugin's twin is
// packages/unplugin/test/virtual-source-ids.test.mjs.
const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const compiler = join(packageRoot, "../compiler/bin/vibelang")

for (const suffix of [".vibe", ".ts", ".vibex"]) {
  test(`a \\0 virtual module ending in ${suffix} is left to the plugin that serves it`, async (t) => {
    const base = join(packageRoot, "test/.fixtures")
    await mkdir(base, { recursive: true })
    const root = await mkdtemp(join(base, "virtual-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, module: "ESNext", target: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true, noEmit: true },
      include: ["*.vibe"]
    }))
    const id = "virtual:generated" + suffix
    await writeFile(join(root, "main.vibe"), `// @ts-ignore: a virtual module\nimport { generated } from ${JSON.stringify(id)}\nexport const answer: number = generated + 1\n`)
    // The plugin's text is not VibeLang: compiling it would fail.
    const generator = {
      name: "virtual-generator",
      resolveId: (source) => source === id ? "\0" + id : undefined,
      load: (loaded) => loaded === "\0" + id ? "export const generated = 41 /* not VibeLang: try */" : undefined
    }
    const [{ output }] = [await build({
      root, configFile: false, logLevel: "silent", plugins: [generator, vibelang({ compiler })],
      build: { write: false, minify: false, lib: { entry: join(root, "main.vibe"), formats: ["es"], fileName: "out" } }
    })].flat()
    // The bundler inlines the virtual module's value: 41 + 1.
    assert.match(output[0].code, /answer = (?:42|generated \+ 1)/)
    if (!/answer = 42/.test(output[0].code)) assert.match(output[0].code, /generated = 41/)
  })
}
