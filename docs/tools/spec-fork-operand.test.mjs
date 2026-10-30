import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("the chapter's quick-fix counterpart runs: the operand stays on the caller", () => {
  const result = run(block(chapter("002-running"), "function start(id"))
  assert.equal(result.status, 0, result.stderr)
})

test("a quick fix that wraps the operand in a new Effect changes the Exit", () => {
  const moved = `
import { Effect, Exit } from "effect"
const worker = (n: number) => Effect.succeed(n)
const id = Effect.fail("no id")
const program = Effect.gen(function* () {
  yield* Effect.forkChild(Effect.gen(function* () {
    return yield* Effect.catch(worker(yield* id), () => Effect.succeed(0))
  }))
  yield* Effect.yieldNow
  return "started"
})
const exit = await Effect.runPromiseExit(program)
if (!Exit.isSuccess(exit)) throw new Error("the failure reached the caller")
`
  const result = run(moved)
  assert.equal(result.status, 0, result.stderr)
})

test("the Promise precedent: the operand runs now, and its failure is the caller's", async () => {
  const seen = []
  const id = async () => { seen.push("id"); throw "no id" }
  const work = async (n) => { seen.push("work"); return n }
  const start = async () => { const p = work(await id()).catch(() => 0); return "started" }
  await assert.rejects(start(), (e) => e === "no id")
  assert.deepEqual(seen, ["id"])
})

test("no chapter or VIP keeps the fix that moved the operand", () => {
  for (const path of ["docs/design/src/002-running.md", "docs/design/vips/0005-try-runs-effects.md", "docs/design/vips/0017-fork.md"]) {
    assert.doesNotMatch(read(path), /fork effect \{ return e catch/)
    assert.match(read(path), /fork Effect\.catch\(e, /)
  }
})
