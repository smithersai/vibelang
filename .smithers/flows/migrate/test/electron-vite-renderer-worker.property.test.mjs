// opencode's desktop renderer bundles gui-plugins, whose Office preview starts
// `new Worker(new URL("./document.worker.vibe", import.meta.url))`; the worker
// build imports slide-text.vibe and failed with a rolldown parse error,
// because setup gave a plain Vite config `worker.plugins` but an electron-vite
// config only its main, preload and renderer plugins, and left an already
// wired config untouched. The renderer now gains vibelang() in its
// worker.plugins whenever the package or a local workspace dependency starts
// a worker, once, and nothing else changes.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { addElectronVitePlugin } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const vite = join(repo, "packages/vite/node_modules/vite")
const native = process.env.VIBELANG_BINARY ?? join(repo, "packages/compiler/native/vibelang")

// Each build's plugin list and the renderer's worker plugin list, as source texts.
function lists(text) {
  const source = ts.createSourceFile("c.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(source.parseDiagnostics.length, 0, text)
  const strip = (n) => { while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n))) n = n.expression; return n }
  const prop = (o, name) => o.properties.find((p) => p.name?.getText(source) === name)
  const items = (n) => { n = strip(n); if (n && ts.isArrowFunction(n)) n = strip(n.body); return n ? n.elements.map((e) => e.getText(source)) : [] }
  let config
  const visit = (n) => {
    if (!config && ts.isCallExpression(n) && n.expression.getText(source) === "defineConfig") {
      let arg = strip(n.arguments[0])
      if (ts.isArrowFunction(arg)) arg = ts.isBlock(arg.body) ? strip(arg.body.statements.filter(ts.isReturnStatement).at(-1).expression) : strip(arg.body)
      config = arg
    }
    ts.forEachChild(n, visit)
  }
  visit(source)
  const out = {}
  for (const name of ["main", "preload", "renderer"]) {
    const section = prop(config, name)
    if (section) out[name] = items(prop(strip(section.initializer), "plugins")?.initializer)
  }
  const renderer = prop(config, "renderer")
  const worker = renderer && prop(strip(renderer.initializer), "worker")
  out.worker = worker ? items(prop(strip(worker.initializer), "plugins")?.initializer) : null
  return out
}

const desktop = (wired, worker = "") => `import { defineConfig } from "electron-vite"
${wired ? 'import vibelang from "vibelang-vite"\n' : ""}import { pickerPlugin } from "./script/picker"

export default defineConfig(async ({ command }) => {
  return {
    main: {
      plugins: [${wired ? "vibelang(), " : ""}{ name: "opencode:node-pty-narrower", enforce: "pre" }],
    },
    preload: {
      ${wired ? "plugins: [vibelang()],\n      " : ""}build: { minify: command === "build" },
    },
    renderer: {
      plugins: [${wired ? "vibelang(), " : ""}pickerPlugin()],${worker}
      root: "src/renderer",
    },
  }
})
`

test("opencode desktop: an already wired config gains vibelang() in the renderer's worker.plugins, once", () => {
  const before = desktop(true)
  const after = addElectronVitePlugin(before, ts, { worker: true })
  assert.deepEqual(lists(after), { ...lists(before), worker: ["vibelang()"] }, after)
  assert.equal(addElectronVitePlugin(after, ts, { worker: true }), after)
  assert.equal(addElectronVitePlugin(before, ts), before)
})

test("an unwired config gains vibelang() in every build and the renderer's worker", () => {
  const after = addElectronVitePlugin(desktop(false), ts, { worker: true })
  const got = lists(after)
  for (const name of ["main", "preload", "renderer"]) assert.equal(got[name][0], "vibelang()", after)
  assert.deepEqual(got.worker, ["vibelang()"], after)
  assert.equal(lists(addElectronVitePlugin(desktop(false), ts)).worker, null)
})

// Neighbourhood: wired or not, with the renderer's worker absent, holding
// other options, or holding plugins as an array or a function, empty or not.
// vibelang() comes first in the worker's plugins, the others stay in order,
// the builds' own plugins are what the build edit alone writes, and a second
// pass changes nothing.
test("property: the renderer's worker plugins gain vibelang() first in each shape", () => {
  const shapes = {
    absent: ["", []],
    options: ['\n      worker: { format: "es" },', []],
    "function-other": ["\n      worker: { plugins: () => [comlink()] },", ["comlink()"]],
    "array-other": ["\n      worker: { plugins: [comlink()] },", ["comlink()"]],
    "function-empty": ["\n      worker: { plugins: () => [] },", []],
  }
  fc.assert(fc.property(fc.boolean(), fc.constantFrom(...Object.keys(shapes)), (wired, shape) => {
    const [worker, others] = shapes[shape]
    const before = desktop(wired, worker)
    const after = addElectronVitePlugin(before, ts, { worker: true })
    const got = lists(after)
    assert.deepEqual(got.worker, ["vibelang()", ...others], after)
    const builds = lists(addElectronVitePlugin(before, ts))
    for (const name of ["main", "preload", "renderer"]) assert.deepEqual(got[name], builds[name], after)
    assert.equal(addElectronVitePlugin(after, ts, { worker: true }), after)
  }), { numRuns: 30 })
})

// The worker block the edit writes is the one a real Vite build applies: the
// renderer's worker imports slide-text.vibe and builds only with it.
test("a real Vite worker build compiles a .vibe import only with vibelang() in worker.plugins", { skip: !(existsSync(vite) && existsSync(native)) && "needs packages/vite's Vite and the native compiler" }, () => {
  const root = mkdtempSync(join(tmpdir(), "renderer-worker-build-"))
  try {
    mkdirSync(join(root, "node_modules"))
    for (const [name, target] of [["vite", vite], ["vibelang-vite", join(repo, "packages/vite")], ["vibelang", join(repo, "packages/compiler")], ["vibelang-runtime", join(repo, "packages/runtime")]]) symlinkSync(target, join(root, "node_modules", name))
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", noEmit: true }, include: ["src"] }))
    writeFileSync(join(root, "src/slide-text.vibe"), 'export const slideText = (n: number): string => "slide " + n\n')
    writeFileSync(join(root, "src/presentation.worker.ts"), 'import { slideText } from "./slide-text.vibe"\nself.postMessage(slideText(1))\n')
    writeFileSync(join(root, "src/main.ts"), 'const worker = new Worker(new URL("./presentation.worker.ts", import.meta.url), { type: "module" })\nworker.onmessage = (event) => console.log(event.data)\n')
    writeFileSync(join(root, "index.html"), '<!doctype html><script type="module" src="/src/main.ts"></script>\n')
    const build = (worker, out) => {
      writeFileSync(join(root, out + ".config.mjs"), `import vibelang from "vibelang-vite"\nexport default { logLevel: "silent", plugins: [vibelang()], worker: { format: "es"${worker} }, build: { outDir: "${out}", emptyOutDir: true } }\n`)
      return spawnSync(process.execPath, [join(vite, "bin/vite.js"), "build", "--config", out + ".config.mjs"], { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native } })
    }
    assert.notEqual(build("", "without").status, 0, "the worker build parses the .vibe without the plugin")
    const withPlugin = build(", plugins: () => [vibelang()]", "with")
    assert.equal(withPlugin.status, 0, withPlugin.stdout + withPlugin.stderr)
    const bundles = readdirSync(join(root, "with/assets")).filter((name) => name.startsWith("presentation.worker"))
    assert.ok(bundles.some((name) => readFileSync(join(root, "with/assets", name), "utf8").includes("slide ")), bundles.join(", "))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
