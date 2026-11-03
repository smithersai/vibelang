import assert from "node:assert/strict"
import {Effect} from "effect"
import * as actual from "./out/main.js"
import * as twin from "./typescript/out/main.js"
import {checkEffectTwin} from "../../test/census-vibex.mjs"
const exit=Effect.runSyncExit(actual.main())
assert.deepEqual(exit,Effect.runSyncExit(twin.main()))
assert.equal(exit._tag,"Success")
checkEffectTwin(import.meta.url,exit.value)
console.log("VIP-39 PASS")
