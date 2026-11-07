import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Effect, Exit } from "effect"

const out = new URL("./out/", import.meta.url)
const js = readFileSync(new URL("main.js", out), "utf8")
// A hoisted function declaration that returns Effect.gen, as the counterpart writes it.
assert.match(js, /^export function loadPort\(raw\) \{\s*return Effect(?:_\d+)?\.gen\(/m, js)
const main = await import(new URL("main.js", out))
assert.equal(main.early, main.loadPort)
assert.equal("BadPort" in main, false)
assert.doesNotMatch(readFileSync(new URL("main.d.ts", out), "utf8"), /export (?:declare )?(?:class|const) BadPort\b|export \{[^}]*\bBadPort\b/)
const ok = await Effect.runPromise(main.loadPort("80"))
const bad = await Effect.runPromiseExit(main.loadPort("0"))
assert.ok(Exit.isFailure(bad))
console.log(JSON.stringify({ ok, failure: bad.cause.reasons?.[0]?.error?._tag ?? JSON.stringify(bad.cause) }))
