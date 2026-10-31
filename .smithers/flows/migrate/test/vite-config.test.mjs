import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { wireViteApps } from "../lib/wire.mjs"

const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const specsFor = () => ({ vibelang: "0.0.11", "vibelang-vite": "0.0.11" })
const write = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

function fixture(t, { typeOnly = false, sources = ["src"], existing = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-vite-config-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  write(root, "package.json", JSON.stringify({ workspaces: ["packages/*"], scripts: { web: "cd packages/web && vite build" } }))
  write(root, "packages/web/package.json", JSON.stringify({ scripts: {
    build: "vibelang && vite build", dev: "pnpm exec vite --host", preview: "vite preview",
    custom: "npx vite build --config=vite.prod.config.ts --configLoader=bundle",
    unrelated: "echo vite; node helper.mjs vite; vitest run", check: "node check.ts"
  } }))
  write(root, "packages/other/package.json", JSON.stringify({ scripts: { build: "vite build" } }))
  write(root, "packages/web/vite.config.ts", 'import { defineConfig } from "vite"\nimport ' + (typeOnly ? "type " : "") + '{ enabled } from "./bridge.ts"\nexport default defineConfig({})\n')
  write(root, "packages/web/vite.prod.config.ts", 'import { defineConfig } from "vite"\nimport { enabled } from "./bridge.ts"\nexport default defineConfig({})\n')
  write(root, "packages/web/bridge.ts", 'export { enabled } from "./src/leaf.' + (existing ? "vibe" : "ts") + '"\n')
  write(root, "packages/web/src/leaf." + (existing ? "vibe" : "ts"), "export const enabled = true\n")
  write(root, "packages/other/vite.config.ts", 'export default defineConfig({})\n')
  return { root, packages: [{ dir: "packages/web", sources }], ts, specsFor }
}

test("setup preloads Node and selects native config loading before migrating a transitive dependency", t => {
  const options = fixture(t)
  const result = wireViteApps(options)
  const pkg = JSON.parse(readFileSync(join(options.root, "packages/web/package.json")))
  for (const name of ["build", "dev", "preview", "custom"]) {
    assert.match(pkg.scripts[name], /NODE_OPTIONS=.*--import=vibelang\/register/)
    assert.match(pkg.scripts[name], /--configLoader native/)
  }
  assert.ok(pkg.scripts.build.startsWith("vibelang && "))
  assert.equal(pkg.scripts.unrelated, "echo vite; node helper.mjs vite; vitest run")
  assert.equal(pkg.scripts.check, "node check.ts")
  assert.equal(pkg.devDependencies.vibelang, "0.0.11")
  assert.match(JSON.parse(readFileSync(join(options.root, "package.json"))).scripts.web, /cd packages\/web && NODE_OPTIONS=/)
  assert.equal(JSON.parse(readFileSync(join(options.root, "packages/other/package.json"))).scripts.build, "vite build")
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(wireViteApps(options).changed, [])
})

test("setup skips type-only config imports and sources outside the migration scope", t => {
  const options = fixture(t, { typeOnly: true, sources: ["elsewhere"] })
  wireViteApps(options)
  assert.equal(JSON.parse(readFileSync(join(options.root, "packages/web/package.json"))).scripts.build, "vibelang && vite build")
})

test("setup covers existing native sources and reports configs with no Vite invocation", t => {
  const options = fixture(t, { existing: true, sources: ["elsewhere"] })
  write(options.root, "packages/web/package.json", "{}")
  const result = wireViteApps(options)
  assert.ok(result.warnings.some(w => w.includes("vite.prod.config.ts: config imports migrated sources") && w.includes("--configLoader native")))
  assert.match(JSON.parse(readFileSync(join(options.root, "package.json"))).scripts.web, /--configLoader native/)
})

test("type-only imports never preload Node even when the referenced source will migrate", t => {
  const options = fixture(t, { typeOnly: true })
  wireViteApps(options)
  const scripts = JSON.parse(readFileSync(join(options.root, "packages/web/package.json"))).scripts
  assert.equal(scripts.build, "vibelang && vite build")
  assert.match(scripts.custom, /--configLoader native/)
})

test("root config can reach a migrated package through relative imports without a manifest dependency", t => {
  const options = fixture(t)
  write(options.root, "vite.config.ts", 'import { enabled } from "./packages/web/src/leaf.ts"\nexport default defineConfig({})\n')
  write(options.root, "package.json", JSON.stringify({ workspaces: ["packages/*"], scripts: { build: "vite build" } }))
  wireViteApps(options)
  assert.match(JSON.parse(readFileSync(join(options.root, "package.json"))).scripts.build, /--configLoader native/)
})

test("setup preserves NODE_OPTIONS assigned by a script as well as inherited options", t => {
  const options = fixture(t)
  const scripts = {
    double: 'NODE_OPTIONS="--trace-warnings $NODE_OPTIONS" vite build',
    single: "NODE_OPTIONS='--no-warnings' vite build",
    bare: "NODE_OPTIONS=--enable-source-maps vite build",
    multiple: 'NODE_OPTIONS="--no-warnings" FOO=bar vite build'
  }
  write(options.root, "packages/web/package.json", JSON.stringify({ scripts }))
  wireViteApps(options)
  const next = JSON.parse(readFileSync(join(options.root, "packages/web/package.json"))).scripts
  assert.match(next.double, /NODE_OPTIONS="--trace-warnings \$NODE_OPTIONS --import=vibelang\/register"/)
  assert.match(next.single, /NODE_OPTIONS='--no-warnings --import=vibelang\/register'/)
  assert.match(next.bare, /NODE_OPTIONS="--enable-source-maps --import=vibelang\/register"/)
  assert.match(next.multiple, /NODE_OPTIONS="--no-warnings --import=vibelang\/register" FOO=bar vite/)
  assert.deepEqual(wireViteApps(options).changed, [])
})

test("setup distinguishes runtime edges from import types and commented examples", t => {
  const options = fixture(t, { existing: true })
  const config = 'import { defineConfig } from "vite"\nexport default defineConfig({})\n'
  for (const edge of [
    '// import { enabled } from "./src/leaf.vibe"\n',
    '/* import "./src/leaf.vibe" */\n',
    'type Flag = import("./src/leaf.vibe").Flag\n',
    'import { type Flag } from "./src/leaf.vibe"\n',
    'export { type Flag } from "./src/leaf.vibe"\n'
  ]) {
    write(options.root, "packages/web/vite.config.ts", edge + config)
    write(options.root, "packages/web/package.json", JSON.stringify({ scripts: { build: "vite build" } }))
    wireViteApps(options)
    assert.equal(JSON.parse(readFileSync(join(options.root, "packages/web/package.json"))).scripts.build, "vite build", edge)
  }
  for (const edge of [
    'import {} from "./src/leaf.vibe"\n',
    'export * from "./src/leaf.vibe"\n',
    'await import("./src/leaf.vibe")\n',
    'await import(`./src/leaf.vibe`)\n'
  ]) {
    write(options.root, "packages/web/vite.config.ts", edge + config)
    write(options.root, "packages/web/package.json", JSON.stringify({ scripts: { build: "vite build" } }))
    wireViteApps(options)
    assert.match(JSON.parse(readFileSync(join(options.root, "packages/web/package.json"))).scripts.build, /--configLoader native/, edge)
  }
})

test("a cycle of ordinary config helpers terminates without native wiring", t => {
  const options = fixture(t)
  write(options.root, "packages/web/bridge.ts", 'export { enabled } from "./other.ts"\n')
  write(options.root, "packages/web/other.ts", 'export { enabled } from "./bridge.ts"\n')
  wireViteApps(options)
  assert.equal(JSON.parse(readFileSync(join(options.root, "packages/web/package.json"))).scripts.build, "vibelang && vite build")
})
