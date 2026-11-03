import { mkdtempSync, writeFileSync, symlinkSync, rmSync, existsSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
// run-seconds: 245
import { assertProgramTypes } from "../../test/assert-coverage-twin.mjs"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { Effect } from "effect"
import { main } from "./out/main.js"

const require = createRequire(import.meta.url)
const tsc = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
assert.equal(require("../../../../experiments/node_modules/typescript/package.json").version, "5.9.3")
const result = spawnSync(process.execPath, [tsc, "-p", "reference"], { encoding: "utf8", timeout: 60000 })
assert.equal(result.status, 0, result.stdout + result.stderr)
assertProgramTypes(import.meta.url, tsc, "reference")
const reference = await import("./reference/out/main.js")
assert.deepEqual(Effect.runSyncExit(main()), Effect.runSyncExit(reference.main()))
const fixture = mkdtempSync(join(tmpdir(), "cov-decls-no-package-"))
try {
 let parent = dirname(fixture)
 while (parent !== dirname(parent)) {
  assert.equal(existsSync(join(parent, "package.json")), false, "outside-package fixture unexpectedly inherits a package")
  parent = dirname(parent)
 }
 symlinkSync(resolve("node_modules"), join(fixture, "node_modules"), "dir")
 writeFileSync(join(fixture, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], noEmit: true }, files: ["main.vibe"] }))
 const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
 const check = source => {
  writeFileSync(join(fixture, "main.vibe"), source)
  const checked = spawnSync(compiler, ["-p", fixture, "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
  assert.equal(checked.error, undefined)
  return checked
 }
 const good = check("service Outside { static readonly key = \"coverage/Outside\"; value: number }\nexport {}\n")
 assert.equal(good.status, 0, good.stdout + good.stderr)
 const missing = check("service Outside { value: number }\nexport {}\n")
 assert.notEqual(missing.status, 0, "service outside every package compiled without an explicit key")
 assert.match(missing.stdout + missing.stderr, /error EK0901:/)
} finally { rmSync(fixture, { recursive: true, force: true }) }

console.log("types and Exit agree")
