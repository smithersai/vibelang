import { readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"

const config = JSON.parse(process.argv[2])
const { bundler, root, mode = "build", access = "import", explicit = false } = config
const require = createRequire(import.meta.url)
const namespace = access === "require" ? require(bundler) : await import(bundler)
const api = access === "default" ? namespace.default : namespace
let calls = 0
const ownPlugin = bundler === "rolldown"
  ? { name: "caller", buildStart() { calls++ } }
  : { name: "caller", setup(build) { build.onStart(() => { calls++ }) } }
const plugins = [ownPlugin]
if (explicit) {
  const { default: native } = await import(`vibelang-unplugin/${bundler}`)
  plugins.push(native({ root }))
}
Object.freeze(plugins)
const request = Object.freeze(bundler === "rolldown"
  ? { cwd: root, input: "src/entry.ts", platform: "node", plugins, onLog() {} }
  : { absWorkingDir: root, entryPoints: ["src/entry.ts"], bundle: true,
      write: false, format: "esm", platform: "node", logLevel: "silent", plugins })
const answers = []
const valueOf = async code => (await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"))).answer
const resultCode = result => bundler === "rolldown"
  ? result.output.find(item => item.type === "chunk").code
  : result.outputFiles[0].text
async function one() {
  if (bundler === "esbuild") return resultCode(await api.build(request))
  if (mode === "shortcut") return resultCode(await api.build({ ...request, write: false, output: { format: "es" } }))
  const bundle = await api.rolldown(request)
  try { return resultCode(await bundle.generate({ format: "es" })) }
  finally { await bundle.close() }
}
try {
  if (mode === "context") {
    const context = await api.context(request)
    try {
      answers.push(await valueOf(resultCode(await context.rebuild())))
      await writeFile(join(root, "src/leaf.vibe"), "export const answer: number = 99\n")
      answers.push(await valueOf(resultCode(await context.rebuild())))
    } finally { await context.dispose() }
  } else if (mode === "watch") {
    const file = join(root, "out/bundle.mjs")
    const watcher = api.watch({ ...request, output: { file, format: "es" } })
    try {
      await new Promise((accept, reject) => {
        const timer = setTimeout(() => reject(new Error("Rolldown watch did not produce a bundle")), 30000)
        watcher.on("event", async event => {
          if (event.code === "BUNDLE_END") {
            await event.result.close()
            clearTimeout(timer)
            accept()
          } else if (event.code === "ERROR") {
            clearTimeout(timer)
            reject(event.error)
          }
        })
      })
      answers.push(await valueOf(await readFile(file, "utf8")))
    } finally { await watcher.close() }
  } else if (mode === "recovery") {
    await writeFile(join(root, "src/leaf.vibe"), 'export const answer: number = "bad"\n')
    try { await one(); throw new Error("invalid source was accepted") }
    catch (error) {
      if (!/TS2322/.test(error.message)) throw error
    }
    await writeFile(join(root, "src/leaf.vibe"), "export const answer: number = 99\n")
    answers.push(await valueOf(await one()))
  } else {
    answers.push(await valueOf(await one()))
  }
  if (bundler === "esbuild") {
    if (typeof api.transformSync !== "function" || !api.transformSync("let x: number = 1", { loader: "ts" }).code.includes("1")) {
      throw new Error("unrelated esbuild API was lost")
    }
  } else if (api.defineConfig(request) !== request) {
    throw new Error("Rolldown defineConfig was changed")
  }
  console.log(JSON.stringify({ ok: true, answers, calls, callerIntact: request.plugins === plugins && plugins[0] === ownPlugin }))
} catch (error) {
  console.log(JSON.stringify({ ok: false, message: error.message }))
  process.exitCode = 1
}
