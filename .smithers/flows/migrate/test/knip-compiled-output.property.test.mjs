import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { wireKnips } from "../lib/wire.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-knip-compiled-output.json", import.meta.url)))
const mapperPath = "dist/util/to-source-path.js"
const put = (root, file, value) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n")
}
function fixture(manager = "pnpm", { nested = false, conflict = false, unsupported = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "knip-output-"))
  const manifest = nested ? "packages/lint/package.json" : "package.json"
  const patch = "patches/authored.patch"
  put(root, "package.json", { private: true, scripts: { check: "knip" },
    ...(conflict ? { [manager === "pnpm" ? "pnpm" : "patchedDependencies"]: manager === "pnpm"
      ? { patchedDependencies: { "knip@6.38.0": patch } } : { "knip@6.38.0": patch } } : {}) })
  if (nested) put(root, manifest, { private: true, devDependencies: { knip: corpus.version } })
  else {
    const pkg = JSON.parse(readFileSync(join(root, manifest)))
    pkg.devDependencies = { knip: corpus.version }
    put(root, manifest, pkg)
  }
  put(root, manager === "pnpm" ? "pnpm-lock.yaml" : "bun.lock", "")
  if (manager === "pnpm") put(root, "pnpm-workspace.yaml", "packages:\n  - packages/*\n")
  if (conflict) put(root, patch, "authored patch\n")
  put(root, "node_modules/knip/package.json", { name: "knip", version: corpus.version, type: "module" })
  put(root, "node_modules/knip/" + mapperPath, unsupported ? "export const changedUpstream = true\n" : corpus.mapper)
  return { root, manifest, patch, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}
const wire = f => wireKnips({ root: f.root, manifests: [f.manifest], specsFor: () => ({ vibelang: "0.0.12" }) })

test("Knip setup maps compiled output back to the native source through its configured compilers", () => {
  const f = fixture()
  try {
    const result = wire(f)
    const patch = result.changed.find(file => /^patches\/knip@/.test(file))
    assert.ok(patch, JSON.stringify(result))
    const applied = spawnSync("patch", ["-p1", "-i", join(f.root, patch)], { cwd: join(f.root, "node_modules/knip"), encoding: "utf8" })
    assert.equal(applied.status, 0, applied.stdout + applied.stderr)
    const text = readFileSync(join(f.root, "node_modules/knip/" + mapperPath), "utf8")
    const getMapper = new Function("files", text.replace("export const getModuleSourcePathHandler", "const getModuleSourcePathHandler") + "\nreturn getModuleSourcePathHandler")
    fc.assert(fc.property(fc.constantFrom("vibe", "vibex"), fc.array(fc.constantFrom("main", "café", "nested", "rule", "機械"), { minLength: 1, maxLength: 5 }).map(parts => parts.join("/")), (extension, stem) => {
      const source = "src/" + stem + "." + extension
      const output = "dist/" + stem + ".js"
      const handler = getMapper(new Set([source]))({ config: { compilers: new Map([['.' + extension, () => ""]]) } })
      assert.equal(handler(output), source)
      assert.equal(handler("dist/missing.js"), "dist/missing.js")
    }), { seed: 221, numRuns: 1000 })
    assert.equal(getMapper(new Set([corpus.source]))({ config: { compilers: new Map([[".vibe", () => ""]]) } })(corpus.output), corpus.source)
    assert.equal(getMapper(new Set(["src/main.ts"]))({ config: { compilers: new Map() } })("dist/main.js"), "src/main.ts")
    assert.deepEqual(wire(f).changed, [])
  } finally { f.cleanup() }
})

test("Knip setup persists patches for pnpm and Bun, including a nested installation", () => {
  for (const manager of ["pnpm", "bun"]) for (const nested of [false, true]) {
    const f = fixture(manager, { nested })
    try {
      const result = wire(f)
      assert.deepEqual(result.warnings, [])
      const patch = result.changed.find(file => /^patches\/knip@/.test(file))
      assert.ok(patch, JSON.stringify(result))
      const config = manager === "pnpm" ? readFileSync(join(f.root, "pnpm-workspace.yaml"), "utf8") : readFileSync(join(f.root, "package.json"), "utf8")
      assert.ok(config.includes("knip@6.38.0") && config.includes(patch))
      assert.deepEqual(JSON.parse(readFileSync(join(f.root, "package.json"))).scripts, { check: "knip" })
      assert.deepEqual(wire(f).changed, [])
    } finally { f.cleanup() }
  }
})

test("Knip setup preserves authored patches and reports unsupported mapper layouts", () => {
  for (const conflict of [false, true]) {
    const f = fixture("pnpm", { conflict, unsupported: !conflict })
    try {
      const result = wire(f)
      assert.ok(result.warnings.some(warning => /knip@6.38.0/.test(warning)), JSON.stringify(result))
      assert.ok(!result.changed.some(file => /^patches\//.test(file)))
      if (conflict) assert.equal(readFileSync(join(f.root, f.patch), "utf8"), "authored patch\n")
    } finally { f.cleanup() }
  }
})
