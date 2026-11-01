import assert from "node:assert/strict"
import test from "node:test"
import { Data, Effect, Option, Result, Schema } from "effect"
import { chapter } from "./spec-witness.mjs"
test("migration selects original run phase and never invents conversion", () => {
 const text=chapter("007-tooling")
 assert.ok(text.includes("original resolved callable and migration provenance"))
 assert.ok(text.includes("ordinary `--fix` never removes a valid `try`"))
 assert.ok(text.includes("the migration inserts no conversion and unwraps nothing"))
 assert.ok(!text.includes("A non-Effect Yieldable still needs"))
})
test("wrapper removal preserves generated error, schema-error and nested Effect data", () => {
 class Missing extends Data.TaggedError("Missing") {}
 class Bad extends Schema.TaggedError()("Bad", {value:Schema.Number}) {}
 for(let n=-24;n<24;n++){
  let runs=0
  for(const value of [new Missing(),new Bad({value:n}),Effect.sync(()=>{runs++;return n}),{asEffect(){throw new Error("must not guess")}},Option.some(n),Result.succeed(n)]){
   assert.strictEqual(Effect.runSync(Effect.gen(function*(){return yield* Effect.succeed(value)})),value)
   assert.strictEqual(Effect.runSync(Effect.sync(()=>value)),value)
  }
  assert.equal(runs,0)
  for(const error of [new Missing(),new Bad({value:n})]){
   assert.equal(Effect.runSyncExit(error)._tag,"Failure")
   assert.strictEqual(Effect.runSync(Effect.succeed(error)),error)
  }
  assert.equal(typeof Option.some(n).asEffect,"undefined")
  assert.equal(typeof Result.succeed(n).asEffect,"undefined")
 }
})
