import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import vibelang from "../src/index.js"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-vite-paths-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

// drive-t3code-apps 22:10Z: apps/web's `~/…` imports, `"~/*": ["./src/*"]`,
// resolved from its .ts modules under `resolve: { tsconfigPaths: true }` but
// not from a .vibe module, so its browser tests could not load
// previewWebviewConfigState and openPreviewSession.
test("a .vibe module's tsconfig path alias resolves to the file vibelang compiles it against", (t) => {
  const root = project(t, {
    "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["./src/*"], "#lib": ["./lib/index.ts"] } } }),
    "src/main.vibe": "import { value } from \"~/value\"\nexport const result = value\n",
    "src/value.ts": "export const value = 1\n",
    "src/ui/state.vibe": "export const state = 1\n",
    "src/dir/index.vibe": "export const dir = 1\n",
    "lib/index.ts": "export const lib = 1\n",
    "src/plain.ts": "import { value } from \"~/value\"\n",
  })
  const plugin = vibelang()
  const main = join(root, "src/main.vibe")
  assert.equal(plugin.resolveId("~/value", main), join(root, "src/value.ts"))
  assert.equal(plugin.resolveId("~/ui/state", main), join(root, "src/ui/state.vibe"))
  assert.equal(plugin.resolveId("~/dir", main), join(root, "src/dir/index.vibe"))
  assert.equal(plugin.resolveId("#lib", main), join(root, "lib/index.ts"))
  assert.equal(plugin.resolveId("~/value?raw", main), join(root, "src/value.ts") + "?raw")
  // Unmatched and package specifiers, and a .ts importer, stay with Vite.
  assert.equal(plugin.resolveId("~/missing", main), undefined)
  assert.equal(plugin.resolveId("effect", main), undefined)
  assert.equal(plugin.resolveId("~/value", join(root, "src/plain.ts")), undefined)
})

test("the plugin's copy of paths-imports is the compiler's", () => {
  const vendored = readFileSync(join(packageRoot, "src/paths-imports.js"), "utf8")
  const compiler = readFileSync(join(packageRoot, "../compiler/paths-imports.mjs"), "utf8")
  assert.equal(vendored, compiler.replace("./relative-imports.mjs", "./relative-imports.js"))
})
