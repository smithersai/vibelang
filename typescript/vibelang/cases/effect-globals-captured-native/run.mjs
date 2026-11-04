// run-seconds: 180
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { main, identities } from "./out/main.js"
import { events } from "./out/events.js"

assert.deepEqual(events, [], "the Effect body stays cold")
assert.ok(identities().every(Boolean), "native function/value identities")
const task = main()
assert.deepEqual(events, [], "constructing the Effect does not run its callback")
assert.equal(Effect.runSync(task), 2)
assert.deepEqual(events, ["e0"])
const stock = fileURLToPath(new URL("../../../../experiments/node_modules/typescript/bin/tsc", import.meta.url))
assert.equal(JSON.parse(readFileSync(new URL("../../../../experiments/node_modules/typescript/package.json", import.meta.url))).version, "5.9.3")
const result = spawnSync(process.execPath, [stock, "-p", fileURLToPath(new URL("reference/tsconfig.json", import.meta.url))], { encoding: "utf8", timeout: 60000 })
assert.ifError(result.error)
assert.equal(result.status, 0, result.stdout + result.stderr)
const twin = await import("./reference/out/main.js")
const trace = await import("./reference/out/events.js")
assert.deepEqual(trace.events, [])
assert.ok(twin.identities().every(Boolean))
assert.equal(Effect.runSync(twin.main()), 2)
assert.deepEqual(trace.events, events)
console.log("native Effect globals preserve captures")
