import assert from "node:assert/strict"
process.setSourceMapsEnabled(true)
const { Cause, Effect, Exit } = await import("effect")
const program = await import("./out/main.js")

assert.equal(program.counted.name, "counted")
assert.equal(program.counted.length, 1)
assert.deepEqual(await Effect.runPromise(program.counted.call({ value: 40 }, 2, 3, 4)), [40, 1, 1])
const exit = await Effect.runPromiseExit(program.main())
assert.ok(Exit.isFailure(exit))
const stack = Cause.pretty(exit.cause)
// Logical caller frames: the recursive call, then main's call.
assert.match(stack, /at leaf \(.*\/main\.vibe:7:25\)/, stack)
assert.match(stack, /at leaf \(.*\/main\.vibe:13:14\)/, stack)
console.log("traced self-referring expression callers: ok")
