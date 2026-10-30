import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const skip = !existsSync(native) && "run sh scripts/build-vibelang.sh"
const options = ["--noEmit", "--strict", "--skipLibCheck", "--target", "ESNext", "--module", "NodeNext", "--pretty", "false"]
function project(t, config, extension) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-explicit-files-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, "main." + extension), "export const value = 42\n")
  writeFileSync(join(dir, "poison.vibe"), "export const wrong: number = 'bad'\n")
  writeFileSync(join(dir, config), JSON.stringify({
    compilerOptions: { target: "ESNext", module: "NodeNext", strict: true, noEmit: true, skipLibCheck: true, types: [] },
    files: ["poison.vibe"]
  }))
  return dir
}
function run(dir, args) {
  return spawnSync(native, args, { cwd: dir, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } })
}
for (const mode of [[], ["lint"]]) {
  for (const config of ["vibe.config.json", "tsconfig.json", "jsconfig.json"]) {
    for (const extension of ["vibe", "ts"]) {
      test("vibelang " + mode.join(" ") + " explicit ." + extension + " bypasses " + config, { skip }, t => {
        const dir = project(t, config, extension)
        const result = run(dir, [...mode, ...options, "main." + extension])
        assert.equal(result.status, 0, result.stdout + result.stderr)
        assert.doesNotMatch(result.stdout + result.stderr, /TS5112|poison\.vibe/)
      })
    }
  }
}
test("explicit files bypass a parent config", { skip }, t => {
  const dir = project(t, "vibe.config.json", "vibe")
  const child = join(dir, "child")
  mkdirSync(child)
  writeFileSync(join(child, "main.vibe"), "export const value = 42\n")
  const result = run(child, [...options, "main.vibe"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
test("project selection still reads the config", { skip }, t => {
  const dir = project(t, "vibe.config.json", "vibe")
  const result = run(dir, ["-p", ".", "--pretty", "false"])
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /TS2322/)
})
test("project and explicit files remain incompatible", { skip }, t => {
  const dir = project(t, "vibe.config.json", "vibe")
  const result = run(dir, ["-p", ".", "main.vibe", "--pretty", "false"])
  assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /TS5042/)
})

test("explicit files without a config still compile", { skip }, t => {
  const dir = project(t, "tsconfig.json", "vibe")
  rmSync(join(dir, "tsconfig.json"))
  const result = run(dir, [...options, "main.vibe"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
test("the existing ignoreConfig flag still compiles explicit files", { skip }, t => {
  const dir = project(t, "tsconfig.json", "vibe")
  const result = run(dir, [...options, "--ignoreConfig", "main.vibe"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
