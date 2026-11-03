import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a=Effect.runSyncExit(actual.main()),b=Effect.runSyncExit(reference.main())
assert.deepEqual(a,b)
assert.equal(a._tag,"Success")
assert.deepEqual(a.value,[7,[1,6,7],4,8,["left","head2","run2","right","arg-left","head6","run6","arg-right","head4","run4"]])
console.log("try precedence and ordinary left-to-right evaluation")
