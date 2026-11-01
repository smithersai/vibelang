// opencode-29 addendum: two builds the config's own plugins do not reach.
// electron-vite builds packages/desktop's main, preload and renderer each
// with its own plugin list, and Vite builds a `new Worker(new URL(...))`
// worker with `worker.plugins`; both loaded `.vibe` modules with no plugin.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { addElectronVitePlugin, addVitePlugin, startsWorkers } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

// The plugin lists of each named build in an electron-vite config, and of a Vite config's worker, as source texts.
function lists(text) {
  const source = ts.createSourceFile("c.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.equal(source.parseDiagnostics.length, 0, text)
  const strip = (n) => { while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n))) n = n.expression; return n }
  const prop = (o, name) => o.properties.find((p) => p.name?.getText(source) === name)
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
    const plugins = section && prop(strip(section.initializer), "plugins")
    if (section) out[name] = plugins ? strip(plugins.initializer).elements.map((e) => e.getText(source)) : []
  }
  const worker = prop(config, "worker")
  if (worker) {
    let plugins = prop(strip(worker.initializer), "plugins")?.initializer
    if (plugins && ts.isArrowFunction(plugins)) plugins = strip(plugins.body)
    out.worker = plugins ? strip(plugins).elements.map((e) => e.getText(source)) : []
  }
  out.plugins = prop(config, "plugins") ? strip(prop(config, "plugins").initializer).elements.map((e) => e.getText(source)) : []
  return out
}

const desktop = `import { defineConfig } from "electron-vite"
import { pickerPlugin } from "./script/picker"

export default defineConfig(async ({ command }) => {
  const channel = process.env.OPENCODE_CHANNEL
  return {
    main: {
      build: { minify: command === "build" },
      plugins: [
        { name: "opencode:node-pty-narrower", enforce: "pre" },
      ],
    },
    preload: {
      build: { minify: command === "build" },
    },
    renderer: {
      plugins: [pickerPlugin(), appPlugin, initialChunk],
      root: "src/renderer",
    },
  }
})
`

test("opencode desktop: each electron-vite build gains vibelang() first, and nothing else changes", () => {
  const wired = addElectronVitePlugin(desktop, ts)
  const found = lists(wired)
  assert.deepEqual(found.main, ["vibelang()", '{ name: "opencode:node-pty-narrower", enforce: "pre" }'])
  assert.deepEqual(found.preload, ["vibelang()"])
  assert.deepEqual(found.renderer, ["vibelang()", "pickerPlugin()", "appPlugin", "initialChunk"])
  assert.match(wired, /^import vibelang from "vibelang-vite"$/m)
  assert.equal(addElectronVitePlugin(wired, ts), wired)
  assert.throws(() => addElectronVitePlugin('export default { main: {} }\n', ts), /does not call defineConfig/)
})

test("a Vite config's worker build gains vibelang() in each worker.plugins shape, once", () => {
  const config = (worker) => `import { defineConfig } from "vite"\n\nexport default defineConfig({\n  plugins: [react()],${worker}\n})\n`
  for (const [worker, expected] of [
    ["", ["vibelang()"]],
    ["\n  worker: { format: \"es\" },", ["vibelang()"]],
    ["\n  worker: { plugins: () => [comlink()] },", ["vibelang()", "comlink()"]],
    ["\n  worker: { plugins: [comlink()] },", ["vibelang()", "comlink()"]],
    ["\n  worker: { plugins: () => [] },", ["vibelang()"]]
  ]) {
    const wired = addVitePlugin(config(worker), ts, { worker: true })
    assert.deepEqual(lists(wired).worker, expected, wired)
    assert.deepEqual(lists(wired).plugins, ["vibelang()", "react()"])
    assert.equal(addVitePlugin(wired, ts, { worker: true }), wired)
  }
  // A config wired before workers were: the worker build gains the plugin under its import's name.
  const earlier = 'import { defineConfig } from "vite"\nimport vibe from "vibelang-vite"\n\nexport default defineConfig({\n  plugins: [vibe()],\n})\n'
  assert.deepEqual(lists(addVitePlugin(earlier, ts, { worker: true })).worker, ["vibe()"])
  assert.throws(() => addVitePlugin(config("\n  worker: { plugins: makePlugins },"), ts, { worker: true }), /worker\.plugins is neither/)
  assert.equal(lists(addVitePlugin(config(""), ts)).worker, undefined)
})

test("startsWorkers finds a package whose sources start a Vite worker", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-workers-"))
  try {
    const write = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    write("packages/gui/src/office/slide.tsx", 'const w = new Worker(new URL("./slide-text.ts", import.meta.url), { type: "module" })\n')
    write("packages/app/src/a.ts", 'import Hash from "./hash?worker"\n')
    write("packages/core/src/a.ts", "const w = new Worker(path)\n")
    write("packages/dep/node_modules/x/a.js", 'new Worker(new URL("./b", import.meta.url))\n')
    assert.equal(startsWorkers(root, "packages/gui"), true)
    assert.equal(startsWorkers(root, "packages/app"), true)
    assert.equal(startsWorkers(root, "packages/core"), false)
    assert.equal(startsWorkers(root, "packages/dep"), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Generated electron-vite configs: which builds exist, whether each has
// plugins (empty, one, several), wrappers around a build object, object or
// function form. Every build gains vibelang() first; taking the inserted text
// back out restores the file.
const build = fc.constantFrom("absent", "none", "[a()]", "[a(), b]")
const wrap = fc.constantFrom((o) => o, (o) => `(${o})`, (o) => `${o} as any`)
const sections = fc.record({ main: build, preload: build, renderer: build }).filter((s) => Object.values(s).some((v) => v !== "absent"))
test("electron-vite-builds: every build of a generated config gains vibelang() first, and only that", () => {
  fc.assert(fc.property(sections, wrap, fc.boolean(), (builds, around, arrow) => {
    const present = Object.entries(builds).filter(([, p]) => p !== "absent")
    const body = present.map(([name, p]) =>
      `  ${name}: ${around(`{\n    build: { minify: true },${p === "none" ? "" : `\n    plugins: ${p},`}\n  }`)},`).join("\n")
    const object = `{\n${body}\n}`
    const text = `import { defineConfig } from "electron-vite"\n\nexport default defineConfig(${arrow ? `() => (${object})` : object})\n`
    const wired = addElectronVitePlugin(text, ts)
    const found = lists(wired)
    for (const [name] of present) assert.equal(found[name][0], "vibelang()", wired)
    // Each insertion is `vibelang(), ` before a first element, or a new `plugins: [vibelang()],` line.
    const back = wired.replace('import vibelang from "vibelang-vite"\n', "").replaceAll("vibelang(), ", "").replaceAll("\n    plugins: [vibelang()],", "")
    assert.equal(back, text, wired)
  }), { seed: 40040, numRuns: 200 })
})
