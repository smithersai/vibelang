// Chapter 002: cold reruns and per-execution completion isolation; docs/design/src/002-running.md#ea517b187e25b80d
import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as native } from "./typescript/out/main.js"
const observe = async f => JSON.parse(JSON.stringify(await Effect.runPromiseExit(f())))
const actual = await observe(main)
assert.deepEqual(actual, await observe(native))
const result = await Effect.runPromise(main())
assert.deepEqual(JSON.parse(JSON.stringify(result)), [7,true,true,1,[null,{n:17},null,null,null,null],[5,true,7,9,11],13])
assert.deepEqual(await observe(() => Effect.all([main(),main()], {concurrency:"unbounded"})), await observe(() => Effect.all([native(),native()], {concurrency:"unbounded"})))
console.log("region Exit parity")
