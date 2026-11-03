import assert from "node:assert/strict"
import {Effect} from "effect"
import * as actual from "./out/main.js"
import * as twin from "./typescript/out/main.js"
import {checkEffectTwin} from "../../test/census-vibex.mjs"
const exit=await Effect.runPromiseExit(actual.main())
assert.deepEqual(exit,await Effect.runPromiseExit(twin.main()))
assert.equal(exit._tag,"Success")
assert.deepEqual(exit.value,[3,3,2])
checkEffectTwin(import.meta.url,exit.value)

console.log("VIP-39 PASS")
