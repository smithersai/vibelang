// docs/design/vips/0030-config-files.md#db98fb52cfeb7075
// VIP-30: top-level public Vibe wrapper and existing TypeScript fields.
// VIP-30 native config superset, root wrapper, declaring path inheritance, all config filenames.
// VIP-30 native config superset, root wrapper, declaring path inheritance, all config filenames: docs/design/vips/0030-config-files.md#83c3bbb278e84948
// VIP-30 native config superset, root wrapper, declaring path inheritance, all config filenames: docs/design/vips/0030-config-files.md#e906185297b3976b
// VIP-30 native config superset, root wrapper, declaring path inheritance, all config filenames: docs/design/vips/0030-config-files.md#c745d1ef9156e68c
// VIP-27 native config superset, root wrapper, declaring path inheritance, all config filenames: docs/design/vips/0027-declaration-output.md#628fae187968a29f
// VIP-30 native config superset, root wrapper, declaring path inheritance, all config filenames: docs/design/vips/0030-config-files.md#32d6b1a28564f86c
// VIP-30 native config superset, root wrapper, declaring path inheritance, all config filenames: docs/design/vips/0030-config-files.md#cea8c9f10d9e4cbe
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import fc from "fast-check"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "Set VIBELANG_BINARY to the workspace compiler; missing setup is not a skip")
const configNames = ["vibe.config.json", "tsconfig.json", "jsconfig.json"]
function project(t) {
  const root = mkdtempSync(join(tmpdir(), "vip30-config-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return {
    root,
    put(name, text) {
      const path = join(root, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, typeof text === "string" ? text : JSON.stringify(text))
    },
    show(args = []) {
      const result = spawnSync(binary, [...args, "--showConfig"], { cwd: root, encoding: "utf8", timeout: 60000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return JSON.parse(result.stdout)
    }
  }
}

// VIP-30 config precedence: exercise every nonempty subset, including fallback.
test("VIP-30 selects the first existing config in its nearest directory", t => {
  for (let mask = 1; mask < 8; mask++) {
    const p = project(t)
    p.put("src/main.vibe", "export const n = 1")
    let first
    for (const [index, name] of configNames.entries()) {
      if (!(mask & (1 << index))) continue
      first ??= index
      p.put(name, { compilerOptions: { target: ["ES2020", "ES2021", "ES2022"][index] }, files: ["src/main.vibe"] })
    }
    assert.equal(p.show().compilerOptions.target.toLowerCase(), ["es2020", "es2021", "es2022"][first])
  }
  const p = project(t)
  p.put("vibe.config.json", { compilerOptions: { target: "ES2020" }, files: ["src/main.vibe"] })
  p.put("src/main.vibe", "export const n = 1")
  p.put("src/jsconfig.json", { compilerOptions: { target: "ES2022" }, files: ["main.vibe"] })
  const result = spawnSync(binary, ["--showConfig"], { cwd: join(p.root, "src"), encoding: "utf8" })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(JSON.parse(result.stdout).compilerOptions.target, "es2022")
})

for (const name of configNames) {
  test("VIP-30 native fields, JSONC extends, and independent vibe entries survive in " + name, t => {
    const p = project(t)
    p.put("src/main.vibe", "export const n = 1")
    p.put("base.json", '{ // inherited native and Vibe settings\n "compilerOptions": {"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"declaration":true,"outDir":"js","declarationDir":"public","rootDir":"src","rootDirs":["src","generated"],"types":[]}, "vibe":{"effectGlobals":false,"severities":{"EK0508":"off"}} }')
    p.put(name, { extends: "./base.json", files: ["src/main.vibe"], vibe: { effectModules: false, sidecarDir: "types", severities: { EK3801: "warning" } } })
    const got = p.show(["-p", name])
    assert.equal(got.compilerOptions.strict, true)
    assert.equal(got.compilerOptions.target, "es2022")
    assert.equal(got.compilerOptions.declaration, true)
    assert.equal(got.compilerOptions.outDir, "./js")
    assert.equal(got.compilerOptions.declarationDir, "./public")
    assert.deepEqual(got.compilerOptions.rootDirs, ["./src", "./generated"])
    assert.equal(got.vibe.effectGlobals, false)
    assert.equal(got.vibe.effectModules, false)
    assert.equal(got.vibe.sidecarDir, "types")
    assert.deepEqual(got.vibe.severities, { EK0508: "off", EK3801: "warning" })
  })
}

test("VIP-30 top-level vibe is ignored by stock TypeScript while compilerOptions.vibe is rejected", () => {
  fc.assert(fc.property(fc.constantFrom(...configNames), fc.boolean(), (name, disabled) => {
    const host = { ...ts.sys, readDirectory: () => [] }
    const common = { compilerOptions: { strict: true }, files: ["/fixture/main.ts"] }
    const top = ts.parseJsonConfigFileContent({ ...common, vibe: { effectGlobals: disabled, sidecarDir: "types" }, vibelang: { diagnostics: { EK4609: "off" } } }, host, "/fixture", undefined, name)
    assert.deepEqual(top.errors, [])
    assert.equal(top.options.strict, true)
    for (const key of ["vibe", "vibelang"]) {
      const nested = ts.parseJsonConfigFileContent({ ...common, compilerOptions: { strict: true, [key]: {} } }, host, "/fixture", undefined, name)
      assert.deepEqual(nested.errors.map(d => d.code), [5023])
    }
  }), { seed: 300034, numRuns: 12 })
})

test("VIP-30 sidecar paths inherit their declaring config base and present child paths override it", t => {
  for (const name of configNames) {
    for (const value of [undefined, "child-output", ""]) {
      const p = project(t)
      p.put("shared/base.json", { vibe: { sidecarDir: "base-output" } })
      p.put("app/main.vibe", "export const n = 1")
      p.put("app/" + name, { extends: "../shared/base.json", files: ["main.vibe"], ...(value === undefined ? {} : { vibe: { sidecarDir: value } }) })
      const got = p.show(["-p", "app/" + name])
      assert.equal(got.vibe.sidecarDir, value === undefined ? "../shared/base-output" : value)
    }
  }
})
