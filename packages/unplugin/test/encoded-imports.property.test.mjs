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

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const viteRequire = createRequire(import.meta.url)
const names = ["créé", "日本", "space name", "percent%20"]
const arbitrary = fc.array(fc.constantFrom("a", "é", "日", " ", "%", "2", "0"), { minLength: 1, maxLength: 8 }).map(chars => "module-" + chars.join(""))

for (const tool of ["webpack", "rspack", "rollup", "esbuild", "vite", "vite7"]) {
  test(`${tool}: emitted relative URLs resolve the original source filename`, async () => {
    async function check(input) {
      const { name, authored = "vibe", collision, declarationOnly = false } = typeof input === "string" ? { name: input } : input
      const directory = join(repo, "packages/unplugin/test/.fixtures")
      await mkdir(directory, { recursive: true })
      const root = await mkdtemp(join(directory, "encoded-source-"))
      await mkdir(join(root, "src"))
      await mkdir(join(root, "node_modules"))
      await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
      await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
      await writeFile(join(root, "package.json"), '{"type":"module"}')
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [] },
        include: ["src"]
      }))
      await writeFile(join(root, "src", name + (declarationOnly ? ".d.ts" : ".vibe")), declarationOnly
        ? "export declare function value(n: number): number\n"
        : "export function value(n: number) { return n + 1 }\n")
      if (collision) await writeFile(join(root, "src", collision + ".vibe"), "export function value(n: number) { return n - 34 }\n")
      await writeFile(join(root, "src/main.vibe"), `import {value} from ${JSON.stringify("./" + name + "." + authored)}\nexport {value}\n`)
      const entry = join(root, "src/entry.mjs")
      await writeFile(entry, 'import {value} from "./main.vibe"; console.log(value(Number(process.argv[2])))\n')
      const output = join(root, "out", ["webpack", "rspack"].includes(tool) ? "main.cjs" : "main.mjs")
      let close
      try {
        const bundle = async () => {
          if (tool === "vite" || tool === "vite7") {
            const { build } = tool === "vite" ? await import("vite") : await import(viteRequire.resolve("vite7"))
            await build({
              root, configFile: false, plugins: [vitePlugin({ compiler: binary })], logLevel: "silent",
              build: { ssr: entry, outDir: join(root, "out"), minify: false, sourcemap: true, rollupOptions: { output: { entryFileNames: "main.mjs" } } }
            })
          } else {
            const plugin = (await import(`../src/${tool}.js`)).default
            if (tool === "rollup") {
              const bundle = await (await import("rollup")).rollup({ input: entry, plugins: [plugin({ root, compiler: binary })] })
              close = () => bundle.close()
              await bundle.write({ file: output, format: "es", sourcemap: true })
            } else if (tool === "esbuild") {
              await (await import("esbuild")).build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: output, plugins: [plugin({ root, compiler: binary })], sourcemap: true, logLevel: "silent" })
            } else {
              const api = tool === "webpack" ? (await import("webpack")).default : (await import("@rspack/core")).rspack
              const compiler = api({ context: root, mode: "none", target: "node", entry, devtool: "source-map", output: { path: join(root, "out"), filename: "main.cjs" }, plugins: [plugin({ compiler: binary })], infrastructureLogging: { level: "error" } })
              close = () => new Promise((accept, reject) => compiler.close(error => error ? reject(error) : accept()))
              await new Promise((accept, reject) => compiler.run((error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : accept()))
            }
          }
        }
        if (declarationOnly) {
          await assert.rejects(bundle, error => error.message.includes(name), "a missing literal runtime import must not load its decoded alias")
          return
        }
        await bundle()
        const result = spawnSync(process.execPath, [output, "41"], { encoding: "utf8" })
        assert.equal(result.status, 0, result.stderr)
        assert.equal(result.stdout.trim(), "42")
        const map = JSON.parse(await readFile(output + ".map", "utf8"))
        assert.ok(map.sources.some(source => (source.endsWith(name + ".vibe") || decodeURI(source).endsWith(name + ".vibe"))), `the map keeps ${name}`)
      } finally {
        await close?.()
        await rm(root, { recursive: true, force: true })
      }
    }
    for (const name of names) await check(name)
    for (const input of [
      { name: "percent%20", authored: "js" },
      { name: "percent%20", authored: "js", collision: "percent " },
      { name: "percent%20", authored: "js", collision: "percent ", declarationOnly: true },
      { name: "créé", collision: "cr%C3%A9%C3%A9" },
      { name: "percent%20", collision: "percent%2520" }
    ]) await check(input)
    await checkProperty(fc, {
      name: `encoded-source-${tool}`,
      rule: "packages/unplugin/README.md: Unicode file names and diagnostic text are preserved",
      arbitrary, numRuns: 10, check,
      command: "node --test test/encoded-imports.property.test.mjs"
    })
  })
}

test("esbuild source maps preserve the exact source filename like TypeScript", async () => {
  const { build } = viteRequire("esbuild")
  const { pathToFileURL } = await import("node:url")
  const plugin = (await import(pathToFileURL(viteRequire.resolve("../src/esbuild.js")).href)).default
  async function check(name) {
    const directory = join(repo, "packages/unplugin/test/.fixtures")
    await mkdir(directory, { recursive: true })
    const root = await mkdtemp(join(directory, "source-map-name-"))
    try {
      await mkdir(join(root, "node_modules"))
      await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
      await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
      await writeFile(join(root, "package.json"), '{"type":"module"}')
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [] }, include: ["*.vibe"] }))
      const source = "export function explode() {\n  return (null as unknown as string).toUpperCase()\n}\n"
      for (const extension of ["ts", "vibe"]) {
        const filename = name + "." + extension, output = join(root, extension + ".mjs")
        await writeFile(join(root, filename), source)
        await writeFile(join(root, "entry.mjs"), `import {explode} from ${JSON.stringify("./" + filename)};explode()\n`)
        await build({ entryPoints: [join(root, "entry.mjs")], bundle: true, platform: "node", format: "esm", outfile: output, sourcemap: true, logLevel: "silent", plugins: extension === "ts" ? [] : [plugin({ root, compiler: binary })] })
        const run = spawnSync(process.execPath, ["--enable-source-maps", output], { encoding: "utf8" })
        assert.notEqual(run.status, 0)
        assert.ok(run.stderr.includes(filename + ":2:" + (source.split("\n")[1].indexOf("toUpperCase") + 1)), run.stderr)
        const map = JSON.parse(await readFile(output + ".map", "utf8"))
        assert.ok(map.sourcesContent.includes(source), "the map embeds the original source")
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  }
  for (const name of ["créé %20", "日本", "space name", "percent%2520"]) await check(name)
  await checkProperty(fc, {
    name: "esbuild-source-map-filename",
    rule: "Source-map filenames and positions match the native TypeScript control without interpreting literal percent escapes.",
    arbitrary, numRuns: 20, check,
    command: "node --test test/encoded-imports.property.test.mjs"
  })
})

for (const tool of ["webpack", "rspack", "rollup", "esbuild", "vite", "vite7"]) for (const plain of [false, true]) {
  test(`${tool}: mixed ${plain ? "sibling" : "escaped"} source and literal JavaScript imports keep distinct identities`, async () => {
    async function check({ name, form = "named", escaped = false }) {
      const directory = join(repo, "packages/unplugin/test/.fixtures")
      await mkdir(directory, { recursive: true })
      const root = await mkdtemp(join(directory, "mixed-imports-"))
      await mkdir(join(root, "src"))
      await mkdir(join(root, "node_modules"))
      await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
      await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
      await writeFile(join(root, "package.json"), '{"type":"module"}')
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], rewriteRelativeImportExtensions: true },
        include: ["src"]
      }))
      const literal = "./" + encodeURIComponent(name) + ".js"
      await writeFile(join(root, "src", encodeURIComponent(name) + ".js"), "export const value = 7\n")
      await writeFile(join(root, "src", encodeURIComponent(name) + ".d.ts"), "export declare const value: number\n")
      try {
        for (const extension of ["ts", "vibe"]) {
          await writeFile(join(root, "src", name + "." + extension), "export const value = 42\n")
          const source = "./" + name + "." + extension
          const spelling = escaped ? JSON.stringify(source).replaceAll("é", "\\u00e9").replace("." + extension, "\\u002e" + extension) : JSON.stringify(source)
          const data = `import {value} from ${JSON.stringify(source)}`
          const imports = form === "namespace"
            ? `import * as source from ${spelling}\nimport * as literal from ${JSON.stringify(literal)}\nexport const value = source.value * 100 + literal.value\n`
            : form === "reexport"
            ? `export {value as source} from ${spelling}\nexport {value as literal} from ${JSON.stringify(literal)}\n`
            : `import {value as source} from ${spelling}\nimport {value as literal} from ${JSON.stringify(literal)}\nexport const value = source * 100 + literal\n`
          const original = "// 😀 imports keep their own targets\n" + imports + `export const data = ${JSON.stringify(data)}\nexport function explode(value = "safe") {\n  return value.toUpperCase()\n}\n`
          const main = join(root, "src/main." + extension)
          await writeFile(main, original)
          const entry = join(root, "src/entry.mjs")
          await writeFile(entry, `import * as result from "./main.${extension}"; if(process.argv[2]) result.explode(null); console.log(JSON.stringify([${form === "reexport" ? "result.source * 100 + result.literal" : "result.value"}, result.data]))\n`)
          const output = join(root, "out", ["webpack", "rspack"].includes(tool) ? "main.cjs" : "main.mjs")
          let close
          try {
            if (tool === "vite" || tool === "vite7") {
              const { build } = tool === "vite" ? await import("vite") : await import(viteRequire.resolve("vite7"))
              await build({ root, configFile: false, plugins: extension === "vibe" ? [vitePlugin({ compiler: binary })] : [], logLevel: "silent",
                build: { ssr: entry, outDir: join(root, "out"), minify: false, sourcemap: true, rollupOptions: { output: { entryFileNames: "main.mjs" } } } })
            } else {
              const plugin = (await import(`../src/${tool}.js`)).default
              const plugins = extension === "vibe" ? [plugin({ root, compiler: binary })] : []
              if (tool === "rollup") {
                const bundle = await (await import("rollup")).rollup({ input: entry, plugins })
                close = () => bundle.close()
                await bundle.write({ file: output, format: "es", sourcemap: true })
              } else if (tool === "esbuild") {
                await (await import("esbuild")).build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: output, plugins, sourcemap: true, logLevel: "silent" })
              } else {
                const api = tool === "webpack" ? (await import("webpack")).default : (await import("@rspack/core")).rspack
                const compiler = api({ context: root, mode: "none", target: "node", entry, devtool: "source-map",
                  output: { path: join(root, "out"), filename: "main.cjs" }, plugins, infrastructureLogging: { level: "error" } })
                close = () => new Promise((accept, reject) => compiler.close(error => error ? reject(error) : accept()))
                await new Promise((accept, reject) => compiler.run((error, stats) => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : accept()))
              }
            }
            const run = spawnSync(process.execPath, [output], { encoding: "utf8" })
            assert.equal(run.status, 0, run.stderr)
            assert.deepEqual(JSON.parse(run.stdout), [4207, data], `${name}; ${form}; ${extension}: source and runtime imports, and ordinary string data, retain their original meanings`)
            const failed = spawnSync(process.execPath, ["--enable-source-maps", output, "throw"], { encoding: "utf8" })
            const lines = original.split("\n"), line = lines.findIndex(text => text.includes("return value.toUpperCase")) + 1
            assert.notEqual(failed.status, 0)
            // Native webpack/Rspack parse this untyped TypeScript control as
            // JavaScript and provide line-level maps; compiler maps retain columns.
            const column = extension === "ts" && ["webpack", "rspack"].includes(tool) ? 1 : lines[line - 1].indexOf("toUpperCase") + 1
            assert.ok(failed.stderr.includes("main." + extension + ":" + line + ":" + column), failed.stderr)
            const map = JSON.parse(await readFile(output + ".map", "utf8"))
            assert.ok(map.sourcesContent.includes(original), "source maps retain the complete original module")
          } finally { await close?.() }
          await rm(main)
          await rm(join(root, "src", name + "." + extension))
        }
      } finally { await rm(root, { recursive: true, force: true }) }
    }
    for (const name of (plain ? ["plain", "nested-name", "module_20"] : [...names, "rocket-😀 %20"])) for (const form of ["named", "namespace", "reexport"]) await check({ name, form })
    await check({ name: plain ? "plain" : "créé", escaped: true })
    await checkProperty(fc, {
      name: `mixed-${plain ? "sibling" : "escaped"}-imports-${tool}`,
      rule: "Relative source imports and literal JavaScript imports denote distinct files, matching the native TypeScript bundler control.",
      arbitrary: fc.record({ name: plain ? fc.array(fc.constantFrom("a", "b", "_", "-", "2", "0"), { minLength: 1, maxLength: 10 }).map(chars => "module-" + chars.join("")) : arbitrary.map(name => name + "é"), form: fc.constantFrom("named", "namespace", "reexport"), escaped: fc.boolean() }),
      numRuns: 8, check, command: "node --test test/encoded-imports.property.test.mjs"
    })
  })
}
