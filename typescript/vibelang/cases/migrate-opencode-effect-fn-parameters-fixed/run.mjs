import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect, Schema } from "effect"
import { canonical, cleanup, explicit, optional, Path } from "./out/lib.js"
import * as twin from "./out/twin.js"
import { main } from "./out/main.js"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
const tsc = require.resolve("typescript/bin/tsc")
const checked = spawnSync(process.execPath, [tsc, "--target", "es2022", "--module", "nodenext",
  "--strict", "--skipLibCheck", "--declaration", "--emitDeclarationOnly", "--outDir", "out/stock", "twin.ts"],
  { cwd: fileURLToPath(new URL(".", import.meta.url)), encoding: "utf8", timeout: 60000 })
assert.ifError(checked.error)
assert.equal(checked.status, 0, checked.stdout + checked.stderr)
for (const file of ["out/lib.d.ts", "out/stock/twin.d.ts"]) {
  assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /canonical: \(input: Path\)/,
    file + " preserves the written parameter alias")
}
fc.assert(fc.property(fc.string(), fc.array(fc.string(), { maxLength: 12 }), fc.integer(),
  (path, files, value) => {
    const branded = Schema.decodeUnknownSync(Path)(path)
    assert.deepEqual(Effect.runSyncExit(canonical(branded)), Effect.runSyncExit(twin.canonical(branded)))
    assert.deepEqual(Effect.runSyncExit(canonical(branded)), Effect.runSyncExit(twin.legacy(branded)))
    assert.equal(Effect.runSync(cleanup(files)), files.length)
    assert.equal(Effect.runSync(explicit(files)), files.length)
    const callback = () => value
    assert.equal(Effect.runSync(optional(callback)), callback)
    assert.equal(Effect.runSync(optional()), undefined)
  }), { seed: 3407, numRuns: 100 })
console.log("@@result " + JSON.stringify(await Effect.runPromise(main())))
