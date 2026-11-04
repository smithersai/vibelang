import assert from "node:assert/strict";
import { Effect } from "effect";
import * as vibe from "./out/main.js";
import * as native from "./out/reference.js";
const mismatches=[];
{
const norm = x => x === undefined ? { undefined: true } : Array.isArray(x) ? x.map(norm) : x;
function observe(program) {
  const out = Effect.runSyncExit(program);
  return out._tag === "Success" ? { tag: out._tag, value: norm(out.value) } : {
    tag: out._tag, reasons: out.cause.reasons.map(r => ({
      tag: r._tag,
      value: r._tag === "Die" ? r.defect instanceof Error ? { name: r.defect.name, message: r.defect.message } : r.defect : r._tag === "Fail" ? r.error : "interrupted"
    }))
  };
}
const values = [
  ["number", () => 5], ["undefined", () => undefined], ["null", () => null],
  ["object", () => ({})], ["promise", () => Promise.resolve(7)],
  ["empty-array", () => []], ["return-iterator", () => (function* () { return 7 })()],
  ["effect-iterator", () => (function* () { const n = yield* Effect.succeed(7); return n + 1 })()],
  ["effect", () => Effect.succeed(9)], ["failure", () => Effect.fail("typed")],
  ["throw-iterator", () => (function* () { throw new Error("iterator") })()]
];
const rows = [];
for (const method of ["array", "bound", "factory", "grouped", "tail", "known", "knownFactory", "knownGeneric"]) for (const [key, make] of values) {
  const v = observe(vibe[method](["factory", "knownFactory"].includes(method) ? make : make()));
  const n = observe(native[method](["factory", "knownFactory"].includes(method) ? make : make()));
  const same = JSON.stringify(v) === JSON.stringify(n);
  rows.push({ method, key, same, vibe: v, native: n });
}
mismatches.push(...rows.filter(r => !r.same));
assert.equal(rows.length,88);

}
{
function inspect(module, key) {
 const value = Effect.succeed(7);
 const fn = module[key](value);
 const out = Effect.runSyncExit(fn.call({ value }, value));
 const result = out._tag === "Success" ? out.value : out.cause.reasons.map(r => [r._tag, r.defect?.name, r.defect?.message]);
 return { name: fn.name, length: fn.length, prototype: Object.hasOwn(fn, "prototype"), tag: out._tag, result };
}
const rows = ["makeZero", "makeNamedZero", "makeArrowZero", "makeOne", "makeThisZero", "makeSelfZero", "makeCapturedRestZero"].map(key => {
 const observed = inspect(vibe,key), ref = inspect(native,key);
 return { key, same: JSON.stringify(observed)===JSON.stringify(ref), vibe: observed, native:ref };
});
mismatches.push(...rows.filter(r => !r.same));
assert.equal(rows.length,7);

}
assert.deepEqual(mismatches,[], "tail delegation changed exact error messages or callable metadata");
console.log("tail delegation keeps native error messages and callable metadata");
