import assert from "node:assert/strict"
import {Effect} from "effect"
import {main} from "./out/main.js"
import {reference} from "./out/reference.js"
assert.equal(await Effect.runPromise(reference()),12)
assert.equal(await Effect.runPromise(main()),12)
