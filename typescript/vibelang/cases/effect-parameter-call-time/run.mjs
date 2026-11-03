import assert from "node:assert/strict"
import { Cause, Effect, Exit } from "effect"
for (const name of ["declaration", "expression", "arrow", "object", "class", "static", "destructure", "rest"]) {
  const actual = await import("./out/" + name + ".js")
  const reference = await import("./out/" + name + "-twin.js")
  const observe = async (mod) => {
    const program = mod.make()
    const atCall = mod.count()
    return [atCall, await Effect.runPromise(program), await Effect.runPromise(program), mod.count()]
  }
  const want = await observe(reference)
  assert.deepEqual(want, name === "rest" ? [0, 11, 21, 0] : [1, 11, 21, 1])
  assert.deepEqual(await observe(actual), want, name)
}
const errors = await import("./out/binding-failure.js")
for (const name of ["makeFailure", "makeArrowFailure", "makeDestructuringFailure"]) {
  let program
  assert.doesNotThrow(() => { program = errors[name]() }, name)
  const first = await Effect.runPromiseExit(program)
  const second = await Effect.runPromiseExit(program)
  assert.ok(Exit.isFailure(first) && Exit.isFailure(second), name)
  const a = first.cause.reasons.find(Cause.isDieReason)
  const b = second.cause.reasons.find(Cause.isDieReason)
  assert.ok(a && b, name)
  assert.equal(a.defect, b.defect, name + " replays the same binding failure")
  if (name !== "makeDestructuringFailure") assert.equal(a.defect, errors.sentinel)
}
const frames = await import("./out/frames.js")
const nativeFrames = await import("./out/frames-twin.js")
for (const [name, expected] of [["constructDefault", 2], ["directSuper", 37]]) {
  const reference = await Effect.runPromise(nativeFrames[name]())
  assert.equal(reference, expected, name)
  assert.equal(await Effect.runPromise(frames[name]()), reference, name)
}
console.log("8 parameter forms, 3 binding defects and 2 frame controls match native Effect")
