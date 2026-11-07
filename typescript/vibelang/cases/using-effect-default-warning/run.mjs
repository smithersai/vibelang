import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { Effect } from "effect"
import { inEffect, plain, native } from "./out/main.js"

// A warning-only compilation succeeds: exit status 0, one EK0801 warning.
const checked = spawnSync(process.env.VIBELANG_BINARY, ["-p", ".", "--pretty", "false", "--noEmit"], { cwd: new URL(".", import.meta.url), encoding: "utf8", timeout: 30000 })
assert.ifError(checked.error)
assert.equal(checked.status, 0, checked.stdout + checked.stderr)
assert.deepEqual((checked.stdout + checked.stderr).match(/(warning|error) EK\d+/g), ["warning EK0801"])

// The warning changes no disposal: each resource is still disposed once.
const events = []
const sync = (name) => ({ [Symbol.dispose]() { events.push(name) } })
assert.equal(Effect.runSync(inEffect(sync("effect"))), 1)
assert.equal(plain(sync("plain")), 2)
assert.equal(await native({ async [Symbol.asyncDispose]() { events.push("native") } }), 3)
assert.deepEqual(events, ["effect", "plain", "native"])
console.log("ok")
