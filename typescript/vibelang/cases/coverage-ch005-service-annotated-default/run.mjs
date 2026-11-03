import assert from "node:assert/strict"; import { Effect } from "effect"; import { Flags } from "./out/main.js"; import { Flags as Native } from "./out/native.js"; assert.deepEqual(await Effect.runPromiseExit(Flags),await Effect.runPromiseExit(Native))
console.log("coverage-ok")
