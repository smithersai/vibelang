import assert from "node:assert/strict"
import { asyncArm } from "./out/main.js"

assert.equal(await asyncArm(true), 1)
await assert.rejects(asyncArm(false), reason => reason === "missing")
console.log("async match rejection preserved")
