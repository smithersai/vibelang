// run-seconds: 120
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { Prompt } from "effect/cli"
import { plainBody, effectBody, noOperation } from "./out/main.js"

// Ordinary TypeScript must resolve every name in the emitted declaration.
execFileSync(fileURLToPath(new URL("../../../built/local/tsc", import.meta.url)), ["-p", fileURLToPath(new URL("consumer/tsconfig.json", import.meta.url))], { stdio: "inherit" })
for (const build of [plainBody, effectBody]) {
  for (const pick of [true, false]) assert.ok(Prompt.isPrompt(await Effect.runPromise(build(pick))))
}
assert.equal(await Effect.runPromise(noOperation()), 42)
console.log("declaration consumer and Prompt values ok")
