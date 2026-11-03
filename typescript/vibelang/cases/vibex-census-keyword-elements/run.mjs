import assert from "node:assert/strict"
import {Effect} from "effect"
import * as actual from "./out/main.js"
import * as twin from "./typescript/out/main.js"
import {checkEffectTwin} from "../../test/census-vibex.mjs"
const exit=Effect.runSyncExit(actual.main())
assert.deepEqual(exit,Effect.runSyncExit(twin.main()))
assert.equal(exit._tag,"Success")
assert.deepEqual(exit.value[0].children.map(n=>n.tag),["try","match","effect","service","data","fork","join","provide","catch","when","is","control","handle","layer","map","select"])
assert.deepEqual(exit.value[1].props,{when:true,is:"a",match:1,try:2,effect:3,fork:true,provide:"y"})
assert.deepEqual(exit.value[2].children,["Hi! 50% off |>"])
assert.equal(exit.value[2].props.title,"{try p}")
checkEffectTwin(import.meta.url,exit.value)
console.log("VIP-39 PASS")
