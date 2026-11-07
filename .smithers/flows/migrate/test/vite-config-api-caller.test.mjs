import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { planScope } from "../lib/onepass.mjs"
import { wireViteApps } from "../lib/wire.mjs"

const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const specsFor = () => ({ vibelang: "0.0.11", "vibelang-vite": "0.0.11" })
const cfg = "apps/web/vite.config.ts", leaf = "apps/web/src/leaf.ts", caller = "apps/web/scripts/warm-dep-cache.ts"

// t3code apps/web/scripts/warm-dep-cache.ts calls resolveConfig({ root }) with
// no configFile, so Vite discovers vite.config.ts by name; as .vibe it finds none.
function wire(t, callerText) {
  const root = mkdtempSync(join(tmpdir(), "migrate-vite-api-caller-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", JSON.stringify({ private: true, workspaces: ["apps/*"] }))
  put("apps/web/package.json", JSON.stringify({ name: "web", private: true, type: "module", scripts: { dev: "vite" } }))
  put(cfg, 'import { leaf } from "./src/leaf.ts";\nexport default { leaf };\n')
  put(leaf, "export const leaf = 1;\n")
  if (callerText !== undefined) put(caller, callerText)
  const apps = wireViteApps({ root, packages: [{ dir: "apps/web", sources: ["src"], tsconfig: "tsconfig.json" }], ts, specsFor })
  return { apps, plan: planScope(root, [cfg, leaf], { nativeConfigs: apps.nativeConfigs }) }
}

const api = [
  ['import { resolveConfig } from "vite";\nexport const warm = (root: string) => resolveConfig({ root }, "serve");\n', "named"],
  ['import { createServer as serve } from "vite";\nexport const warm = (root: string) => serve({ root });\n', "aliased"],
  ['import * as Vite from "vite";\nexport const warm = (root: string) => Vite.build({ root });\n', "namespace"],
  ['import * as Vite from "vite";\nconst { preview } = Vite;\nexport const warm = (root: string) => preview({ root });\n', "destructured"],
  ['export const warm = async (root: string) => (await import("vite")).resolveConfig({ root }, "serve");\n', "dynamic"],
]

for (const [text, form] of api) test(`Vite config API caller (${form}) keeps the config's TypeScript name`, t => {
  const { apps, plan } = wire(t, text)
  assert.deepEqual(apps.nativeConfigs, [])
  assert.ok(apps.warnings.some(w => w.startsWith(cfg + ": " + caller)), apps.warnings.join("\n"))
  assert.ok(plan.deferred.some(row => row.file === cfg))
  assert.equal(JSON.parse(JSON.stringify(plan.batches)).flatMap(b => b.files).includes(leaf), true)
})

for (const [text, form] of [[undefined, "no caller"],
  ['import type { UserConfig } from "vite";\nexport const config: UserConfig = {};\n', "type-only import"],
  ['import { defineConfig } from "vite";\nexport const config = defineConfig({});\n', "non-loading API"],
  ['const resolveConfig = (root: string) => root;\nexport const warm = (root: string) => resolveConfig(root);\n', "local namesake"]])
  test(`Vite config with ${form} stays renamable`, t => {
    const { apps, plan } = wire(t, text)
    assert.deepEqual(apps.nativeConfigs, [cfg])
    assert.ok(plan.batches.flatMap(b => b.files).includes(cfg))
  })
