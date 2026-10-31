import assert from "node:assert/strict"
import {AsyncFiberError} from "effect/Cause"
import * as Plain from "./out/plain.js"
import * as Matched from "./out/matched.js"
import * as Shadow from "./out/shadow.js"
import * as Written from "./out/written.js"
for(const value of[Plain,Matched,Shadow,Written])assert.equal(value.ctor,AsyncFiberError)
assert.equal(Shadow.identity(1),1)
console.log("ok")
