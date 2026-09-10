// Explicit, read-only comparison against the reviewed external library.
// Run with Bun; dependencies belong to an isolated reference checkout, not
// this product. Output is deterministic fixture JSON on stdout.
// brand-gate: allow-start
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cases, appendCases } from "../compiler/testdata/keyed-plan-cases.mjs";

const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); assert.ok(index >= 0 && args[index + 1], `missing ${name}`); return resolve(args[index + 1]); };
const root = option("--reference");
const effectRoot = option("--effect-root");
const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(revision, "6bcbaa2d03a10afe8fe59934dabe262f55f012e7");
const effectVersion = JSON.parse(readFileSync(resolve(effectRoot, "package.json"), "utf8")).version;
assert.equal(effectVersion, "4.0.0-rc.112");
const load = (path) => import(pathToFileURL(path).href);
const Crypto = await load(resolve(effectRoot, "dist/Crypto.js"));
const Effect = await load(resolve(effectRoot, "dist/Effect.js"));
const Plan = await load(resolve(root, "packages/smithers/flows/plan/src/Plan.ts"));
const Key = await load(resolve(root, "packages/smithers/flows/keys/src/Key.ts"));
const crypto = Crypto.make({
  randomBytes() { throw new Error("planning requested randomness"); },
  digest(algorithm, data) {
    assert.equal(algorithm, "SHA-256");
    return Effect.sync(() => new Uint8Array(createHash("sha256").update(data).digest()));
  },
});
const run = (program) => Effect.runPromise(Effect.provideService(program, Crypto.Crypto, crypto));
const json = (value) => JSON.parse(JSON.stringify(value));
const result = (program, operation) => run(Effect.match(program, {
  onFailure: (failure) => ({ ok: false, errorCode: failure.code ?? (operation === "verify" ? "invalid_plan" : "invalid_node"), referenceError: failure._tag }),
  onSuccess: (value) => ({ ok: true, ...(operation === "derive-key" ? { key: value } : { plan: json(value) }) }),
}));
const records = [];
const sourceRecords = [];
const valueRecords = [];
if (args.includes("--source")) assert.ok(args.includes("--native"), "--source requires --native");
if (args.includes("--values")) assert.ok(args.includes("--source"), "--values requires --source and --native");
if (args.includes("--check-values")) assert.ok(args.includes("--values"), "--check-values requires --values");
for (const fixture of cases) {
  const input = json(fixture.input);
  const program = fixture.operation === "derive-key" ? Key.deriveKey(input) : Plan.compile(input);
  const expected = await result(program, fixture.operation);
  if (expected.ok && expected.plan) assert.deepEqual(json(await run(Plan.verify(expected.plan))), expected.plan);
  records.push({ ...fixture, input, expected });
}
for (const fixture of appendCases) {
  const base = json(await run(Plan.compile(json(fixture.base))));
  const input = { plan: base, nodes: json(fixture.nodes) };
  const expected = await result(Plan.append(base, input.nodes), "append");
  if (expected.ok) {
    assert.deepEqual(json(await run(Plan.verify(expected.plan))), expected.plan);
    assert.deepEqual(expected.plan.nodes.slice(0, base.nodes.length), base.nodes);
    assert.equal(expected.plan.baseDigest, base.baseDigest);
  }
  records.push({ name: `append-${fixture.name}`, operation: "append", input, expected });
}
if (args.includes("--native")) {
  const native = option("--native");
  const pin = JSON.parse(readFileSync(new URL("../typescript-fork.json", import.meta.url), "utf8"));
  const api = Number(readFileSync(new URL("../compiler/api.go", import.meta.url), "utf8").match(/^const APIVersion = (\d+)$/m)?.[1]);
  const identity = JSON.parse(execFileSync(native, ["--build-identity"], { encoding: "utf8", timeout: 30000 }));
  assert.equal(identity.apiVersion, api);
  assert.equal(identity.revision, pin.revision);
  assert.match(identity.compilerVersion, /^7\./);
  for (const fixture of records) {
    const wire = JSON.parse(execFileSync(native, ["--keyed-plan"], {
      input: JSON.stringify({ operation: fixture.operation, inputJson: JSON.stringify(fixture.input) }),
      encoding: "utf8", timeout: 30000, maxBuffer: 40*1024*1024,
    }));
    assert.equal(wire.apiVersion, identity.apiVersion, fixture.name);
    assert.equal(wire.compilerRevision, identity.revision, fixture.name);
    assert.equal(wire.error, undefined, fixture.name);
    const actual = wire.result;
    assert.equal(actual.ok, fixture.expected.ok, `${fixture.name}: ${JSON.stringify(actual)}`);
    if (!actual.ok) assert.equal(actual.errorCode, fixture.expected.errorCode, fixture.name);
    else if (fixture.operation === "derive-key") assert.equal(actual.key, fixture.expected.key, fixture.name);
    else {
      const plan = JSON.parse(actual.planJson);
      assert.deepEqual(plan, fixture.expected.plan, fixture.name);
      // This verifies the native-produced artifact, not only the oracle's own.
      assert.deepEqual(json(await run(Plan.verify(plan))), plan, fixture.name);
    }
  }
  if (args.includes("--source")) {
    const provider = { actionId: "oracle.vibe#Work", implementationId: "work/v1", implementationDigest: "a".repeat(64),
      tier: "sealed", effects: { boundaryMode: "hard", reads: [], writes: [] }, layers: [], capabilities: [] };
    const header = 'import {Action,durable,fanOut} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};';
    const fanChild = (key, step=0, ordinal=0) => `fanout/${ordinal}/key1_${createHash("sha256").update(JSON.stringify(key)).digest("hex")}/${step}`;
    const branchEdges=(prefix,actions=true)=>{
      const condition=`${prefix}/condition`,yes=`${prefix}/then/result`,no=`${prefix}/else/result`;
      return actions?[[],[condition],[`${prefix}/then/action/0`,condition],[condition],[`${prefix}/else/action/0`,condition],[condition,yes,no]]
        :[[],[condition],[condition],[condition,yes,no]];
    };
    const logicalEdges=(prefix,operator)=>{
      const condition=`${prefix}/condition`,yes=`${prefix}/then/result`,no=`${prefix}/else/result`;
      return operator==="||"
        ?[[],[condition],[condition],[`${prefix}/else/action/0`,condition],[condition,yes,no]]
        :[[],[condition],[`${prefix}/then/action/0`,condition],[condition],[condition,yes,no]];
    };
    for (const fixture of [
      { name: "independent", source: header + 'export const Flow=durable((n:number)=>{const a=Work.run(n)!;const b=Work.run(2)!;return {b,a}})', inputJson: "1", providers: [provider], dependencies: [[], [], ["action/1", "action/0"]] },
      { name: "data-edge", source: header + 'export const Flow=durable((n:number)=>{const a=Work.run(n)!;return Work.run(a)})', inputJson: "1", providers: [provider], dependencies: [[], ["action/0"], ["action/1", "action/0"]] },
      { name: "pure-computation", source:'import {durable} from "vibelang:flows";export const Flow=durable((n:number)=>{return {value:n*2+1,ok:n>0}})',
        inputJson:"1",providers:[],dependencies:[[]] },
      { name: "planned-computation", source:header+'export const Flow=durable((n:number)=>{const a=Work.run(n+1)!;return Work.run(a*2)})',
        inputJson:"1",providers:[provider],dependencies:[[],["action/0"],["action/1","action/0"]] },
      { name: "fanout-computation", source:header+'export const Flow=durable((n:number)=>{const a=Work.run(n)!;return fanOut([2,1],v=>v,v=>Work.run(v+a*2))})',
        inputJson:"1",providers:[provider],dependencies:[[],["action/0"],["action/0"],[fanChild(2,0,1),fanChild(1,0,1),"action/0"]] },
      { name:"source-branch",source:header+'export const Flow=durable((n:number)=>{return n>0?Work.run(1):Work.run(2)})',
        inputJson:"-1",providers:[provider],dependencies:[...branchEdges("branch/0"),["branch/0"]] },
      { name:"pure-branch",source:'import {durable} from "vibelang:flows";export const Flow=durable((n:number)=>{return n>0?{z:n,a:1}:{a:n,z:2}})',
        inputJson:"1",providers:[],dependencies:[...branchEdges("branch/0",false),["branch/0"]] },
      { name:"source-child-branch",source:header+'const Child=durable((n:number)=>{return n>0?Work.run(1):Work.run(2)});export const Flow=durable((n:number)=>{return Child.run(n)})',
        inputJson:"1",providers:[provider],dependencies:[...branchEdges("flow/0/branch/0"),["flow/0/branch/0"]] },
      { name:"fanout-child-branch",source:header+'const Child=durable((n:number)=>{return n>0?Work.run(n):Work.run(-n)});export const Flow=durable((n:number)=>{return fanOut([2,-1],v=>v,v=>Child.run(v))})',
        inputJson:"1",providers:[provider],dependencies:[...branchEdges(fanChild(-1)+"/branch/0"),...branchEdges(fanChild(2)+"/branch/0"),[fanChild(2)+"/branch/0",fanChild(-1)+"/branch/0"]] },
      { name:"source-if-early-return",source:header+'export const Flow=durable((n:number)=>{if(n>0)return Work.run(n);return Work.run(-n)})',
        inputJson:"1",providers:[provider],dependencies:[...branchEdges("branch/0"),["branch/0"]] },
      { name:"source-if-braced-arms",source:header+'export const Flow=durable((n:number)=>{if(n>0){return Work.run(n)!}else{return Work.run(-n)!}})',
        inputJson:"-1",providers:[provider],dependencies:[...branchEdges("branch/0"),["branch/0"]] },
      { name:"source-if-null-guard",source:header+'export const Flow=durable((n:number|null)=>{if(n===null)return 0;return Work.run(n)})',
        inputJson:"null",providers:[provider],dependencies:[...logicalEdges("branch/0","||"),["branch/0"]] },
      { name:"source-nullable-action-guard",source:header.replace("Result<number,never>","Result<number|null,never>")+
        'export const Flow=durable((n:number)=>{const value=Work.run(n)!;if(value===null)return 0;return value+1})',
        inputJson:"1",providers:[provider],dependencies:[[],["action/0"],["branch/1/condition"],["action/0","branch/1/condition"],
          ["branch/1/condition","branch/1/then/result","branch/1/else/result"],["branch/1","action/0"]] },
      { name:"source-if-discriminated-input",source:header+'export const Flow=durable((n:{kind:"a";x:number}|{kind:"b";y:number})=>{if(n.kind==="a")return Work.run(n.x);return Work.run(n.y)})',
        inputJson:'{"kind":"b","y":3}',providers:[provider],dependencies:[...branchEdges("branch/0"),["branch/0"]] },
      { name:"source-child-if",source:header+'const Child=durable((n:number)=>{if(n>0)return Work.run(n);return Work.run(-n)});export const Flow=durable((n:number)=>{return Child.run(n)})',
        inputJson:"1",providers:[provider],dependencies:[...branchEdges("flow/0/branch/0"),["flow/0/branch/0"]] },
      { name:"fanout-child-if",source:header+'const Child=durable((n:number)=>{if(n>0)return Work.run(n);return Work.run(-n)});export const Flow=durable((n:number)=>{return fanOut([2,-1],v=>v,v=>Child.run(v))})',
        inputJson:"1",providers:[provider],dependencies:[...branchEdges(fanChild(-1)+"/branch/0"),...branchEdges(fanChild(2)+"/branch/0"),[fanChild(2)+"/branch/0",fanChild(-1)+"/branch/0"]] },
      { name:"source-logical-and",source:header+'export const Flow=durable((n:number)=>{return n>0&&Work.run(n)!})',
        inputJson:"1",providers:[provider],dependencies:[...logicalEdges("branch/0","&&"),["branch/0"]] },
      { name:"source-logical-or",source:header+'export const Flow=durable((n:number)=>{return n<0||Work.run(n)!})',
        inputJson:"1",providers:[provider],dependencies:[...logicalEdges("branch/0","||"),["branch/0"]] },
      { name:"source-logical-nullish",source:header+'export const Flow=durable((n:number|null)=>{return n??Work.run(2)!})',
        inputJson:"null",providers:[provider],dependencies:[...logicalEdges("branch/0","??"),["branch/0"]] },
      { name:"source-logical-final-action",source:header+'export const Flow=durable((n:number)=>{return n>0&&Work.run(n)})',
        inputJson:"1",providers:[provider],dependencies:[...logicalEdges("branch/0","&&"),["branch/0"]] },
      { name:"source-child-logical",source:header+'const Child=durable((n:number)=>{return n>0&&Work.run(n)!});export const Flow=durable((n:number)=>{return Child.run(n)})',
        inputJson:"1",providers:[provider],dependencies:[...logicalEdges("flow/0/branch/0","&&"),["flow/0/branch/0"]] },
      { name:"fanout-child-logical",source:header+'const Child=durable((n:number)=>{return n>0&&Work.run(n)!});export const Flow=durable((n:number)=>{return fanOut([2,-1],v=>v,v=>Child.run(v))})',
        inputJson:"1",providers:[provider],dependencies:[...logicalEdges(fanChild(-1)+"/branch/0","&&"),...logicalEdges(fanChild(2)+"/branch/0","&&"),[fanChild(2)+"/branch/0",fanChild(-1)+"/branch/0"]] },
      { name: "conflicting-writes", source: header + 'export const Flow=durable((n:number)=>{const a=Work.run(n)!;const b=Work.run(2)!;return {b,a}})', inputJson: "1", providers: [{ ...provider, effects: { ...provider.effects, writes: ["shared.txt"] } }], dependencies: [[], ["action/0"], ["action/1", "action/0"]] },
      { name: "irreversible", source: header + 'export const Flow=durable((n:number)=>{return Work.run(n)})', inputJson: "1", providers: [{ ...provider, tier: "irreversible" }], dependencies: [[], ["action/0"]] },
      { name: "source-object-order", source: 'import {durable} from "vibelang:flows";export const Flow=durable((n:number)=>{return {z:n,a:n}})', inputJson: "1", providers: [], dependencies: [[]] },
      { name: "input-object-order", source: 'import {durable} from "vibelang:flows";export const Flow=durable((n:{z:number;a:number})=>{return n})', inputJson: '{"z":1,"a":2}', providers: [], dependencies: [[]] },
      { name: "keyed-fanout", source: header+'export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Work.run(n))})',
        inputJson:"[3,1,2]",providers:[provider],dependencies:[[],[],[],[fanChild(3),fanChild(1),fanChild(2)]] },
      { name: "keyed-fanout-data-edges", source: header+'export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>{const value=Work.run(n)!;return Work.run(value)})})',
        inputJson:"[2,1]",providers:[provider],dependencies:[[],[fanChild(1)],[],[fanChild(2)],[fanChild(2,1),fanChild(1,1),fanChild(1),fanChild(2)]] },
      { name: "keyed-fanout-empty", source: header+'export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Work.run(n))})',
        inputJson:"[]",providers:[provider],dependencies:[[]] },
      { name: "source-child-data-edge", source: header+'const Child=durable((n:number)=>{return Work.run(n)});export const Flow=durable((n:number)=>{const a=Child.run(n)!;return Work.run(a)})',
        inputJson:"1",providers:[provider],dependencies:[[],["flow/0/action/0"],["action/1","flow/0/action/0"]] },
      { name: "source-child-independent", source: header+'const Child=durable((n:number)=>{return Work.run(n)});export const Flow=durable((n:number)=>{const a=Child.run(n)!;const b=Child.run(2)!;return {b,a}})',
        inputJson:"1",providers:[provider],dependencies:[[],[],["flow/1/action/0","flow/0/action/0"]] },
      { name: "source-child-selected", source: header+'export const Child=durable((n:number)=>{return Work.run(n)});export const Flow=durable((n:number)=>{return Child.run(n)!})',exportName:"Flow",
        inputJson:"1",providers:[provider],dependencies:[[],["flow/0/action/0"]] },
      { name: "typed-child-success", source: header+'const Child=durable((n:number):Result<number,never>=>{return Work.run(n)!});export const Flow=durable((n:number):Result<number,never>=>{return Child.run(n)!})',
        inputJson:"1",providers:[provider],dependencies:[[],["flow/0/action/0"]] },
      { name: "typed-child-collection", source: header+'const Child=durable((n:number):Result<readonly number[],never>=>{return [n,2]});export const Flow=durable((n:number)=>{const items=Child.run(n)!;return fanOut(items,v=>v,(v:number):Result<number,never>=>{return Work.run(v)!})})',
        inputJson:"1",providers:[provider],dependencies:[[],[],[fanChild(1,0,1),fanChild(2,0,1)]] },
      { name: "fanout-source-child", source: header+'const Child=durable((n:number)=>{return Work.run(n)});export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Child.run(n))})',
        inputJson:"[2,1]",providers:[provider],dependencies:[[],[],[fanChild(2)+"/action/0",fanChild(1)+"/action/0"]] },
      { name: "fanout-pure-child", source: 'import {durable,fanOut} from "vibelang:flows";const Child=durable((n:number)=>{return {z:n,a:1}});export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Child.run(n)!)})',
        inputJson:"[2,1]",providers:[],dependencies:[[]] },
      { name: "fanout-captured-input", source: header+'export const Flow=durable((n:number)=>{return fanOut([2,1],v=>v,v=>Work.run(n))})',
        inputJson:"41",providers:[provider],dependencies:[[],[],[fanChild(2),fanChild(1)]] },
      { name: "fanout-captured-action", source: header+'const Child=durable((n:number)=>{return Work.run(n)});export const Flow=durable((n:number)=>{const captured=Work.run(n)!;return fanOut([2,1],v=>v,v=>Child.run(captured))})',
        inputJson:"41",providers:[provider],dependencies:[[],["action/0"],["action/0"],[fanChild(2,0,1)+"/action/0",fanChild(1,0,1)+"/action/0","action/0"]] },
      { name: "source-modules", source: 'import {durable} from "vibelang:flows";import {Work} from "./api";export const Flow=durable((n:number)=>{return Work.run(n)!})',
        inputJson: "1", providers: [{...provider,actionId:"work.vibe#Work"}], dependencies: [[],["action/0"]],
        sourceModules: [{fileName:"api.vibe",source:'export {Work} from "./work";'},
          {fileName:"work.vibe",source:'import {Action} from "vibelang:flows";export class Work extends Action<(n:number)=>Result<number,never>>{}'}] },
    ]) {
      const request = { source: fixture.source, fileName: "oracle.vibe", flowId: "oracle/Flow", flowVersion: 1,
        planId: `oracle/${fixture.name}`, inputJson: fixture.inputJson, providersJson: JSON.stringify(fixture.providers),
        ...(fixture.exportName ? {exportName:fixture.exportName} : {}),
        ...(fixture.sourceModules ? {dependencies:fixture.sourceModules} : {}) };
      const wire = JSON.parse(execFileSync(native, ["--keyed-plan-source"], { input: JSON.stringify(request), encoding: "utf8", timeout: 30000, maxBuffer: 40*1024*1024 }));
      assert.equal(wire.apiVersion, identity.apiVersion);
      assert.equal(wire.compilerRevision, identity.revision);
      assert.equal(wire.error, undefined);
      assert.equal(wire.result.ok, true, JSON.stringify(wire.result));
      assert.deepEqual(wire.result.diagnostics, []);
      const plan = JSON.parse(wire.result.planJson);
      assert.deepEqual(plan.nodes.map(node => node.dependsOn), fixture.dependencies);
      assert.deepEqual(json(await run(Plan.verify(plan))), plan, fixture.name);
      const changed = structuredClone(plan);
      changed.nodes[0].priority++;
      const refused = await result(Plan.verify(changed), "verify");
      assert.equal(refused.ok, false, "upstream accepted an altered approval target");
      sourceRecords.push({ name: fixture.name, request, plan, upstreamVerified: true, changedPriorityRefused: true });
    }
  }
  if (args.includes("--values")) {
    const CacheStore = await load(resolve(root, "packages/smithers/flows/step-cache/src/CacheStore.ts"));
    const StepKey = await load(resolve(root, "packages/smithers/flows/plan/src/StepKey.ts"));
    const { getNativeCompiler } = await import("../poc/src/compiler/native.ts");
    const { KeyedSourceInterpreter } = await import("../poc/src/durable/keyed-interpreter.ts");
    const { encodeKeyedValue, decodeKeyedValue } = await import("../poc/src/durable/keyed-value.ts");
    const sdk = getNativeCompiler();
    assert.equal(sdk.identity.sha256, createHash("sha256").update(readFileSync(native)).digest("hex"));
    const cache = async value => JSON.parse(await run(CacheStore.encodeCanonical(value, "result")));
    // A real reference-code control: canonical storage changes raw object
    // order. The language adapter must carry that order as explicit data.
    assert.equal(JSON.stringify(await cache({ z: 1, a: 2 })), '{"a":2,"z":1}');
    for (const value of [null, [1, { z: 2, a: 3 }], { z: 1, a: { y: 2, b: 3 } },
      JSON.parse('{"__proto__":{"z":1,"a":2},"constructor":3}'),
      { kind: "object", items: { z: 1, a: 2 }, order: ["authored", "data"] }]) {
      const encoded = encodeKeyedValue(value), stored = await cache(encoded);
      assert.equal(JSON.stringify(decodeKeyedValue(stored)), JSON.stringify(value));
      valueRecords.push({ name: `cache-value-${valueRecords.length}`, value, encoded, stored, orderPreserved: true });
    }
    assert.notEqual(await run(Key.deriveKey(encodeKeyedValue({z: 1, a: 2}))), await run(Key.deriveKey(encodeKeyedValue({a: 2, z: 1}))));
    const request = { fileName: "oracle.vibe", flowId: "oracle/Flow", flowVersion: 1, planId: "oracle/ordered-values", inputJson: "41",
      source: 'import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<{nested:[{z:number;a:number}]},never>>{};export const Flow=durable((n:number)=>{const a=Work.run(n)!;return {whole:a.nested[0],scalar:a.nested[0].z}})',
      providersJson: JSON.stringify([{actionId: "oracle.vibe#Work", implementationId: "work/v1", implementationDigest: "a".repeat(64),
        tier: "sealed", effects: {boundaryMode: "hard", reads: [], writes: []}, layers: [], capabilities: []}]) };
    const compiled = sdk.compileKeyedPlanSource(request);
    assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
    const plan = await run(Plan.verify(JSON.parse(compiled.planJson)));
    const interpreter = new KeyedSourceInterpreter(compiled.planJson);
    const action = interpreter.prepare("action/0", []);
    assert.equal(action.operation, "action");
    assert.equal(action.input, 41);
    // Test answer only. This deliberately does not authenticate or execute a
    // provider, create a run, or claim to be a crash/restart scheduler test.
    const encoded = interpreter.encodeSuccess("action/0", {nested: [{z: action.input, a: 2}]});
    const stored = await cache(encoded);
    const refs = plan.nodes[1].material.inputs.filter(input => input._tag === "Ref")
      .map(input => ({from: input.from, path: input.path, value: StepKey.project(stored, input.path)}));
    const prepared = interpreter.prepare("result", refs);
    assert.equal(prepared.operation, "result");
    const resultStored = await cache(prepared.value);
    const decoded = decodeKeyedValue(resultStored);
    assert.equal(JSON.stringify(decoded), '{"whole":{"z":41,"a":2},"scalar":41}');
    valueRecords.push({name: "source-ref-cache-roundtrip", request, plan, stored, refs, resultStored, decoded, orderPreserved: true});
  }
}
const measurement = { revision, effectVersion, records };
if (args.includes("--check")) assert.deepEqual(measurement, JSON.parse(readFileSync(option("--check"), "utf8")), "reference fixtures drifted");
if (args.includes("--check-values")) assert.deepEqual({revision, effectVersion, abi: "vibelang/keyed-source/v2",
  records: valueRecords.filter(record => record.name.startsWith("cache-value-"))},
  JSON.parse(readFileSync(option("--check-values"), "utf8")), "reference value-codec fixtures drifted");
console.log(JSON.stringify({...measurement, ...(sourceRecords.length ? {sourceRecords} : {}), ...(valueRecords.length ? {valueRecords} : {})}, null, 2));
// brand-gate: allow-end
