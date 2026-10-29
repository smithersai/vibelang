import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
process.setSourceMapsEnabled(true)
const frozen = process.argv.includes("--frozen-stack-limit")
if (frozen) Object.defineProperty(Error, "stackTraceLimit", { writable: false })
const { Cause, Effect, Exit } = await import("effect")
const program = await import("./out/main.js")

const read = program.read
assert.equal(read, program.beforeRead)
assert.equal(read.name, "read")
assert.equal(read.length, 1)
assert.deepEqual(await Effect.runPromise(read.call({ value: 40 }, 2, 3, 4, 5)), [42, 4, 3])
const obj = { value: 50, read }
assert.deepEqual(await Effect.runPromise(obj.read(1)), [51, 1, 1])
assert.equal(program.defaulted.name, "defaulted")
assert.equal(program.defaulted.length, 0)
const { defaults } = await import("./out/defaults.js")
defaults.count = 0
const cold = program.defaulted()
assert.equal(defaults.count, 0)
assert.equal(await Effect.runPromise(cold), 1)
assert.equal(await Effect.runPromise(cold), 2)
assert.equal(defaults.count, 2)
const exit = await Effect.runPromiseExit(program.main())
assert.ok(Exit.isFailure(exit))
const stack = Cause.pretty(exit.cause)
// These are logical caller frames, including calls made after suspension.
// Keep exact coordinates: a closing brace or generated .apply is not a call.
assert.match(stack, /at leaf \(.*\/main\.vibe:10:14\)/, stack)
assert.match(stack, /at middle \(.*\/main\.vibe:15:14\)/, stack)
assert.doesNotMatch(stack, /at leaf \(.*\/main\.vibe:6:2\)/, stack)
assert.doesNotMatch(stack, /at middle \(.*\/main\.vibe:11:2\)/, stack)

// Force the heap entry of a plain cycle, then call it from two sites.
// A cached traced factory must not reuse the first invocation's capture.
const { $eager } = await import("vibelang-runtime")
const savedDepth = $eager.depth
try {
  $eager.depth = $eager.limit
  const firstCycle = () => program.recursive(1, undefined)
  const secondCycle = () => program.recursive(1, undefined)
  for (const [call, line, column] of [[firstCycle, 42, 36], [secondCycle, 43, 37]]) {
    const exit = await Effect.runPromiseExit(call())
    assert.ok(Exit.isFailure(exit))
    const stack = Cause.pretty(exit.cause)
    assert.match(stack, new RegExp("at recursive \\(.*run\\.mjs:" + line + ":" + column + "\\)"), stack)
    assert.match(stack, /at recursive \(.*\/main\.vibe:33:25\)/, stack)
  }
} finally {
  $eager.depth = savedDepth
}

// A caller-selected stack limit is restored, including Effect's opt-out.
const savedLimit = Error.stackTraceLimit
try {
  for (const limit of frozen ? [] : [1, 0]) {
    Error.stackTraceLimit = limit
    const exit = await Effect.runPromiseExit(program.main())
    assert.equal(Error.stackTraceLimit, limit)
    assert.ok(Exit.isFailure(exit))
    const stack = Cause.pretty(exit.cause)
    if (limit === 0) assert.doesNotMatch(stack, /main\.vibe:\d+:\d+/)
    else {
      assert.match(stack, /at leaf \(.*\/main\.vibe:10:14\)/, stack)
      assert.match(stack, /at middle \(.*\/main\.vibe:15:14\)/, stack)
    }
  }
} finally {
  if (!frozen) Error.stackTraceLimit = savedLimit
}
// Effect supports hardened Error intrinsics; the forwarding capture does too.
if (!frozen) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--frozen-stack-limit"], { encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
}
console.log("traced caller coordinates and callable behavior: ok")
