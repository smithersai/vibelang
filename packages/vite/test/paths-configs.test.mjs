import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import vibelang from "../src/index.js"

// tsconfig `paths` from the config the compiler reads for a .vibe module:
// a project file other than tsconfig.json, an `extends` chain, a nearer nested
// tsconfig.json, and an edit while the plugin runs.
function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-vite-paths-configs-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), typeof text === "string" ? text : JSON.stringify(text))
  }
  return root
}

function started(root, options = {}) {
  const plugin = vibelang(options)
  plugin.configResolved?.({ root, command: "serve", logger: { warn() {}, info() {}, error() {} } })
  return plugin
}

const sources = {
  "src/main.vibe": 'import { value } from "~/value"\nexport const result = value\n',
  "src/value.ts": "export const value = 1\n",
  "other/value.ts": "export const value = 2\n"
}

test("a project option naming tsconfig.app.json uses that file's paths", (t) => {
  const root = project(t, {
    ...sources,
    "tsconfig.json": { compilerOptions: { paths: { "~/*": ["./other/*"] } } },
    "tsconfig.app.json": { compilerOptions: { paths: { "~/*": ["./src/*"] } }, include: ["src"] }
  })
  const plugin = started(root, { project: "tsconfig.app.json" })
  assert.equal(plugin.resolveId("~/value", join(root, "src/main.vibe")), join(root, "src/value.ts"))
})

test("paths inherited through an extends chain resolve from the config that declares them", (t) => {
  const root = project(t, {
    ...sources,
    "config/base.json": { compilerOptions: { paths: { "~/*": ["../src/*"] } } },
    "config/middle.json": { extends: "./base.json" },
    "tsconfig.json": { extends: "./config/middle.json", include: ["src"] }
  })
  const plugin = started(root)
  assert.equal(plugin.resolveId("~/value", join(root, "src/main.vibe")), join(root, "src/value.ts"))
})

test("a nearer nested tsconfig.json's paths win for the modules it holds", (t) => {
  const root = project(t, {
    ...sources,
    "tsconfig.json": { compilerOptions: { paths: { "~/*": ["./other/*"] } } },
    "apps/web/tsconfig.json": { compilerOptions: { paths: { "~/*": ["./lib/*"] } } },
    "apps/web/main.vibe": 'import { value } from "~/value"\nexport const result = value\n',
    "apps/web/lib/value.ts": "export const value = 3\n"
  })
  const plugin = started(root)
  assert.equal(plugin.resolveId("~/value", join(root, "apps/web/main.vibe")), join(root, "apps/web/lib/value.ts"))
  assert.equal(plugin.resolveId("~/value", join(root, "src/main.vibe")), join(root, "other/value.ts"))
})

test("an edit of paths while the plugin runs takes effect for the next resolution", (t) => {
  const root = project(t, { ...sources, "tsconfig.json": { compilerOptions: { paths: { "~/*": ["./src/*"] } } } })
  const plugin = started(root)
  const main = join(root, "src/main.vibe")
  assert.equal(plugin.resolveId("~/value", main), join(root, "src/value.ts"))
  const config = join(root, "tsconfig.json")
  writeFileSync(config, JSON.stringify({ compilerOptions: { paths: { "~/*": ["./other/*"] } } }))
  // A later stamp, so a cache keyed on the stamp sees the edit on any filesystem.
  const later = new Date(Date.now() + 5000)
  utimesSync(config, later, later)
  plugin.watchChange?.(config, { event: "update" })
  assert.equal(plugin.resolveId("~/value", main), join(root, "other/value.ts"))
})
