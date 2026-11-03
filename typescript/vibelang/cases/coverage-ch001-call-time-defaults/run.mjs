import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as native } from "./out/native.js"
const reference=await Effect.runPromiseExit(native());assert.equal(reference._tag,"Success");assert.deepEqual(reference.value,[[1,0],1,1,1,2]);assert.deepEqual(await Effect.runPromiseExit(main()),reference);console.log("coverage-ok")
