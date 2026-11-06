// node bundle.mjs <bundler>, run in a fixture: bundles src/entry.mjs to
// out/main.js with its map through the bundler itself and vibelang-unplugin.
import { join } from "node:path"
import { plugin as pluginFile } from "./helpers.mjs"

const bundler = process.argv[2]
const started = performance.now()
const mark = (stage) => {
  if (process.env.VIBELANG_SOURCE_MAP_TRACE === "1") console.error("source-map bundle " + JSON.stringify({ bundler, stage, elapsedMs: Math.round(performance.now() - started) }))
}
const root = process.cwd()
const entry = join(root, "src/entry.mjs")
const outDir = join(root, "out")
const plugin = (name) => import(pluginFile(`unplugin/src/${name}.js`)).then((module) => module.default)
const external = (id) => /^(?:effect|vibelang-runtime)(?:\/|$)/.test(id)

if (bundler === "esbuild") {
  const esbuild = await import("esbuild")
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", format: "esm", packages: "external", sourcemap: true,
    outfile: join(outDir, "main.js"), plugins: [(await plugin("esbuild"))()], logLevel: "error"
  })
} else if (bundler === "esbuild-minify") {
  const esbuild = await import("esbuild")
  await esbuild.build({
    entryPoints: [entry], bundle: true, platform: "node", format: "esm", packages: "external", sourcemap: true, minify: true,
    outfile: join(outDir, "main.js"), plugins: [(await plugin("esbuild"))()], logLevel: "error"
  })
} else if (bundler === "rollup") {
  const { rollup } = await import("rollup")
  const bundle = await rollup({ input: entry, external, plugins: [(await plugin("rollup"))()], onwarn() {} })
  await bundle.write({ dir: outDir, format: "es", sourcemap: true, entryFileNames: "main.js" })
  await bundle.close()
} else if (bundler === "rolldown") {
  mark("import")
  const { rolldown } = await import("rolldown")
  mark("create")
  const bundle = await rolldown({ input: entry, platform: "node", external, plugins: [(await plugin("rolldown"))()], onLog() {} })
  mark("write")
  await bundle.write({ dir: outDir, format: "es", sourcemap: true, entryFileNames: "main.js" })
  mark("close")
  await bundle.close()
  mark("done")
} else if (bundler === "webpack") {
  const { default: webpack } = await import("webpack")
  const compiler = webpack({
    mode: "none", context: root, target: "node", devtool: "source-map", entry,
    output: { path: outDir, filename: "main.cjs" }, plugins: [(await plugin("webpack"))()],
    infrastructureLogging: { level: "error" }
  })
  await new Promise((done, failed) => compiler.run((error, stats) => {
    if (error) return failed(error)
    if (stats.hasErrors()) return failed(new Error(stats.compilation.errors.map((item) => item.message).join("\n")))
    compiler.close(() => done())
  }))
} else if (bundler === "vite") {
  const { build } = await import("vite")
  const vibelang = (await import(pluginFile("vite/src/index.js"))).default
  await build({
    root, configFile: false, logLevel: "error", plugins: [vibelang()],
    build: { ssr: entry, outDir, sourcemap: true, emptyOutDir: true, rolldownOptions: { output: { entryFileNames: "main.js" } } }
  })
} else if (bundler === "vite-sentry") {
  // Sentry's plugin, as opencode configures it. Upload needs a token, so only
  // its debug ID injection runs, which rewrites the bundle and its map.
  const { build } = await import("vite")
  const { sentryVitePlugin } = await import("@sentry/vite-plugin")
  const vibelang = (await import(pluginFile("vite/src/index.js"))).default
  await build({
    root, configFile: false, logLevel: "error",
    plugins: [vibelang(), sentryVitePlugin({ telemetry: false, release: { name: "test", create: false }, sourcemaps: { assets: "./out/**" } })],
    build: { ssr: entry, outDir, sourcemap: true, emptyOutDir: true, rolldownOptions: { output: { entryFileNames: "main.js" } } }
  })
} else {
  throw new Error(`bundle.mjs: no bundler ${bundler}`)
}
