import assert from "node:assert/strict";
import { Effect } from "effect";
import { main } from "./out/main.js";
const result = Effect.runSyncExit(main());
assert.equal(result._tag, "Success");
assert.equal(result.value, 7);
console.log(JSON.stringify({ exit: result._tag, value: result.value }));
