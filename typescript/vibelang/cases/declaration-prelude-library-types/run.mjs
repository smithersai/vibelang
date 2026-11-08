// run-seconds: 120
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { decodeName, done } from "./out/main.js"

// Ordinary TypeScript must resolve every name in the emitted declaration.
execFileSync(fileURLToPath(new URL("../../../built/local/tsc", import.meta.url)), ["-p", fileURLToPath(new URL("consumer/tsconfig.json", import.meta.url))], { stdio: "inherit" })
assert.equal(done(null), 0)
assert.equal(await Effect.runPromise(decodeName("ada")), "ada")
console.log("declaration consumer ok")
