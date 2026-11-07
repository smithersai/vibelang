import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import vitePlugin from "../../vite/src/index.js"

// packages/unplugin/README.md: "Imports between `.vibe` modules also preserve
// Unicode, spaces and literal `%` in file names." T3code's desktop artifact
// check bundles a TypeScript entry that imports bridge.vibe, which re-exports
// `export { value } from "./with space.vibe"`; esbuild could not resolve the
// emitted "./with%20space.js". encoded-imports.property.test.mjs covers an
// import-then-export bridge reached from an .mjs entry; this file covers the
// other re-export forms and a TypeScript entry.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const viteRequire = createRequire(import.meta.url)
const rule = "Imports between `.vibe` modules also preserve Unicode, spaces and literal `%` in file names."
const corpus = JSON.parse(await readFile(new URL("./corpus/t3code-encoded-native-reexport.json", import.meta.url), "utf8"))
const forms = {
  "import-export": name => `import {value} from ${JSON.stringify("./" + name + ".vibe")}\nexport {value}\n`,
  "export-from": name => `export { value } from ${JSON.stringify("./" + name + ".vibe")}\n`,
  "export-star": name => `export * from ${JSON.stringify("./" + name + ".vibe")}\n`
}
const names = ["with space", "créé", "percent%20", "plain"]
// webpack, Rspack and Rollup bundle no TypeScript entry without another plugin.
const entries = tool => ["esbuild", "vite", "vite7"].includes(tool) ? ["mjs", "ts"] : ["mjs"]

async function bundleAndRun(tool, { name, form, entry: kind }) {
  const directory = join(repo, "packages/unplugin/test/.fixtures")
  await mkdir(directory, { recursive: true })
  const root = await mkdtemp(join(directory, "encoded-reexport-"))
  await mkdir(join(root, "src"))
  await mkdir(join(root, "node_modules"))
  await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
  await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
  await writeFile(join(root, "package.json"), '{"type":"module"}')
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], allowImportingTsExtensions: true, allowArbitraryExtensions: true },
    include: ["src"]
  }))
  await writeFile(join(root, "src", name + ".vibe"), "export function value(n: number) { return n + 1 }\n")
  await writeFile(join(root, "src/bridge.vibe"), forms[form](name))
  const entry = join(root, "src", "entry." + kind)
  await writeFile(entry, 'import { value } from "./bridge.vibe"\nconsole.log(value(Number(process.argv[2])))\n')
  const output = join(root, "out", ["webpack", "rspack"].includes(tool) ? "main.cjs" : "main.mjs")
  let close
  try {
    if (tool === "vite" || tool === "vite7") {
      const { build } = tool === "vite" ? await import("vite") : await import(viteRequire.resolve("vite7"))
      await build({ root, configFile: false, plugins: [vitePlugin({ compiler: binary })], logLevel: "silent",
        build: { ssr: entry, outDir: join(root, "out"), minify: false, rollupOptions: { output: { entryFileNames: "main.mjs" } } } })
    } else {
      const plugin = (await import(`../src/${tool}.js`)).default
      if (tool === "rollup") {
        const bundle = await (await import("rollup")).rollup({ input: entry, plugins: [plugin({ root, compiler: binary })] })
        close = () => bundle.close()
        await bundle.write({ file: output, format: "es" })
      } else if (tool === "esbuild") {
        await (await import("esbuild")).build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: output, plugins: [plugin({ root, compiler: binary })], logLevel: "silent" })
      } else {
        const api = tool === "webpack" ? (await import("webpack")).default : (await import("@rspack/core")).rspack
        const compiler = api({ context: root, mode: "none", target: "node", entry, output: { path: join(root, "out"), filename: "main.cjs" }, plugins: [plugin({ compiler: binary })], infrastructureLogging: { level: "error" } })
        close = () => new Promise((accept, reject) => compiler.close(error => error ? reject(error) : accept()))
        await new Promise((accept, reject) => compiler.run((error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : accept()))
      }
    }
    const result = spawnSync(process.execPath, [output, "41"], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), "42")
  } finally {
    await close?.()
    await rm(root, { recursive: true, force: true })
  }
}

test("the unplugin README still states the encoded-name import rule", async () => {
  assert.ok((await readFile(join(repo, "packages/unplugin/README.md"), "utf8")).includes(rule), rule)
})

for (const tool of ["webpack", "rspack", "rollup", "esbuild", "vite", "vite7"]) {
  test(`${tool}: native re-exports keep encoded leaf names`, async () => {
    for (const witness of corpus.cases.filter(c => entries(tool).includes(c.entry))) await bundleAndRun(tool, witness)
    for (const name of names) for (const form of Object.keys(forms)) for (const entry of entries(tool)) await bundleAndRun(tool, { name, form, entry })
    await checkProperty(fc, {
      name: `encoded-reexport-${tool}`, rule: "packages/unplugin/README.md: " + rule, numRuns: 6,
      arbitrary: fc.record({
        name: fc.array(fc.constantFrom("a", "é", "日", " ", "%", "2", "0"), { minLength: 1, maxLength: 8 }).map(chars => "leaf-" + chars.join("")),
        form: fc.constantFrom(...Object.keys(forms)),
        entry: fc.constantFrom(...entries(tool))
      }),
      check: input => bundleAndRun(tool, input),
      command: "node --test test/encoded-reexports.property.test.mjs"
    })
  })
}
