import assert from "node:assert/strict";
import { Effect } from "effect";
import { $forConcurrent } from "vibelang-runtime";
import * as actual from "./out/main.js";
import * as native from "./out/reference.js";
const rows=[];
for(const key of Object.keys(actual)) {
 const got=await Effect.runPromise(actual[key]());
 const want=await Effect.runPromise(native[key]());
 rows.push({key,got,want});
 assert.equal(got.maximum, key === "limitOmitted" || key === "limitUnbounded" || key.startsWith("limitLegacy") ? 3 : 1, key + " native maximum");
 assert.equal(got.limits, key === "limitOmitted" || key.startsWith("limitLegacy") ? 0 : 1, key + " evaluates limit once");
 assert.equal(got.collections, 1, key + " evaluates iterable once");
}
assert.deepEqual(rows.map(r=>r.got),rows.map(r=>r.want),"written limits must reach Effect.forEach unchanged");
function helper(written, omitFlag=false) {
 let active=0, maximum=0;
 const body=()=>Effect.gen(function*() {
  active++;maximum=Math.max(maximum,active);yield* Effect.yieldNow;active--;
 });
 const loop=omitFlag?$forConcurrent([1,2,3],undefined,body):$forConcurrent([1,2,3],undefined,body,written);
 return Effect.map(loop,()=>maximum);
}
assert.equal(await Effect.runPromise(helper(false,true)),3,"legacy three-argument default");
assert.equal(await Effect.runPromise(helper(false)),3,"legacy explicit false default");
assert.equal(await Effect.runPromise(helper(true)),1,"new written undefined uses native default");
assert.equal($forConcurrent.length,3,"optional flag preserves helper arity");
console.log("written nullish limits retain native concurrency");
