import assert from "node:assert/strict"
import { Cause, Effect, Exit } from "effect"
import { main } from "./out/main.js"
import { main as native, namespaces } from "./out/native.js"

const actual = await Effect.runPromiseExit(main())
assert.deepEqual(actual, await Effect.runPromiseExit(native()))
assert.deepEqual(actual, Exit.succeed({ exists: "function", joined: "a/b" }))
// rule-evidence: docs/design/vips/0033-platform-stdlib.md#23a5d1fa40a9b502 | *Corrected 2026-10-29: the module `FileSystem` is a namespace, and the service key it exports is `FileSystem.FileSystem` (likewise `Path.Path`); in effect 4.1.1, `yield*` of the namespace is a defect.
for (const program of namespaces) {
  const exit = await Effect.runPromiseExit(program)
  assert.ok(Exit.isFailure(exit) && Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause), String(exit))
}
console.log("service keys succeed; yielded namespaces die")
