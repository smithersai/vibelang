// run-seconds: 180
// VIP-9 / VIP-34: migration retains eager once-only work and cached static reads.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { snapshot } from "./out/main.js"

const here = dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? resolve(here, "../../../built/local/tsc")
const stock = resolve(here, "../../../../experiments/node_modules/typescript/bin/tsc")
const expected = { same: true, initializations: 1, enabled: true }
assert.deepEqual(snapshot(), expected, "original eager static value")
const dir = mkdtempSync(join(here, ".cached-default-"))
try {
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  for (const file of ["main.vibe", "events.ts", "tsconfig.json"]) copyFileSync(join(here, file), join(dir, file))
  const cli = (...args) => {
    const result = spawnSync(compiler, ["-p", dir, "--pretty", "false", ...args], { encoding: "utf8", timeout: 120000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }

  writeFileSync(join(dir, "twin.ts"), `import { Context } from "effect"
import { initialize, state } from "./events.js"
class Flags extends Context.Service<Flags, { enabled: boolean }>()("relic-static-default/Flags") {
  static readonly default: Context.Service.Shape<typeof Flags> = initialize()
}
export function probe(): unknown { return Flags.default === Flags.default }
export function snapshot() { return { same: probe(), initializations: state.initializations, enabled: Flags.default.enabled } }
`)
  const tsc = spawnSync(process.execPath, [stock, "--target", "es2022", "--module", "nodenext", "--strict", "--skipLibCheck", "--outDir", join(dir, "stock"), join(dir, "twin.ts"), join(dir, "events.ts")], { encoding: "utf8", timeout: 60000 })
  assert.ifError(tsc.error)
  assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr)
  const twin = await import(pathToFileURL(join(dir, "stock/twin.js")))
  assert.deepEqual(twin.snapshot(), expected, "stock TypeScript twin")
  console.log("cached service default preserved")
} finally {
  rmSync(dir, { recursive: true, force: true })
}
