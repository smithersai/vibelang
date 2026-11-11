import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Effect, Exit } from "effect"

const out = new URL("./out/", import.meta.url)
// The body's declaration keeps the written contract for TypeScript callers.
assert.match(readFileSync(new URL("main.vibe.check.d.ts", out), "utf8"), /\/\*\* @throws \{Error\} \*\/\s*export declare function nonEmpty/)
const main = await import(new URL("main.js", out))
let thrown
try { main.nonEmpty("") } catch (error) { thrown = error instanceof Error ? error.message : "other" }
const ok = await Effect.runPromise(main.load("port"))
const bad = await Effect.runPromiseExit(main.load(""))
assert.ok(Exit.isFailure(bad))
console.log(JSON.stringify({ thrown, ok, failure: bad.cause.reasons?.[0]?.error?._tag ?? JSON.stringify(bad.cause) }))
