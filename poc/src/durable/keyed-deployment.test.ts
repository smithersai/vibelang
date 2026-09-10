import { beforeAll, expect, test } from "bun:test"
import { createPrivateKey, sign } from "node:crypto"
import { compileActionContract } from "./schema.ts"
import { compileActionImplementationSourceContract } from "./implementation-contract.ts"
import { buildWorkerPoolBundle, requireCheckedKeyedWorkerPoolBundle, type WorkerPoolBundle } from "./pool-bundle.ts"
import { SignedDeployment, SignedBodyDeployment, encodeSignedKeyedSourceEnvelope } from "./signed-deployment.ts"
import { canonicalJson, digest } from "./value.ts"
import {
  createKeyedWorkerRuntime, buildKeyedSourceDeployment, encodeSignedKeyedSourceDeployment,
  authenticateKeyedSourceDeployment, compileAuthenticatedKeyedInvocation,
  restoreAuthenticatedKeyedInvocation,
  keyedInvocationApprovalTarget,
  requireAuthenticatedKeyedSourceDeployment, requireAuthenticatedKeyedInvocation,
  type KeyedWorkerRuntime, type KeyedSourceDeployment, type AuthenticatedKeyedSourceDeployment,
  type KeyedSourceDeclaration, type KeyedProviderPolicy,
} from "./keyed-deployment.ts"

const declaration = `import {Action,durable} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{};
export const Flow=durable((n:number)=>{const a=Work.run(n)!;const b=Work.run(2)!;return {b,a}});`
const source: KeyedSourceDeclaration = {source: declaration, fileName: "flow.vibe", flowId: "test/Flow", flowVersion: 1}
const fanOutDeclaration = declaration.replace("{Action,durable}", "{Action,durable,fanOut}")
  .replace("const a=Work.run(n)!;const b=Work.run(2)!;return {b,a}", "return fanOut([n,2],item=>item,item=>Work.run(item))")
const childDeclaration = declaration.replace('export const Flow=',
  'export const Child=durable((n:number)=>{return Work.run(n)});export const Flow=')
  .replace("const a=Work.run(n)!;const b=Work.run(2)!", "const a=Child.run(n)!;const b=Child.run(2)!")
const typedCollectionDeclaration = `import {Action,durable,fanOut} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{};
const Child=durable((n:number):Result<readonly number[],never>=>{return [n,2]});
export const Flow=durable((n:number)=>{const items=Child.run(n)!;return fanOut(items,v=>v,(v:number):Result<number,never>=>{return Work.run(v)!})});`
const fanOutChildDeclaration = `import {Action,durable,fanOut} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{};
const Child=durable((n:number):Result<number,never>=>{return Work.run(n)!});
export const Flow=durable((n:number)=>{return fanOut([n,2],item=>item,item=>Child.run(item)!)});`
const fanOutCaptureDeclaration = `import {Action,durable,fanOut} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{};
const Child=durable((n:number):Result<number,never>=>{return Work.run(n)!});
export const Flow=durable((n:number)=>{const captured=Work.run(n)!;return fanOut([2,1],item=>item,item=>Child.run(captured)!)});`
const policy: KeyedProviderPolicy = {actionId: "flow.vibe#Work", tier: "sealed",
  effects: {boundaryMode: "hard", reads: [], writes: []}, layers: [], capabilities: []}
const key = SignedDeployment.generateKeyPair(), trust = [SignedDeployment.verificationKey(key)]
let runtime: KeyedWorkerRuntime, bundle: WorkerPoolBundle, deployment: KeyedSourceDeployment
let bytes: Uint8Array, authenticated: AuthenticatedKeyedSourceDeployment
const build = (changes: Partial<Parameters<typeof buildKeyedSourceDeployment>[0]> = {}) =>
  buildKeyedSourceDeployment({source, providers: [policy], bundles: [bundle], runtime, ...changes})

beforeAll(() => {
  runtime = createKeyedWorkerRuntime({timeoutMs: 5_000})
  const contract = compileActionContract('import {Action} from "vibelang:flows";export abstract class Work extends Action<(n:number)=>Result<number,never>>{}',
    {fileName: "flow.vibe", exportName: "Work", id: policy.actionId, version: 1})
  if (!contract.ok) throw new Error(JSON.stringify(contract.diagnostics))
  const implementation = compileActionImplementationSourceContract({action: contract.descriptor,
    implementationId: "work/v1", implementationVersion: "1", entryFile: "provider.vibe", exportName: "work",
    sources: [{fileName: "provider.vibe", source: "const table={n:1}; table.n=41; export function work(n:number){return table.n+n}"}]})
  bundle = buildWorkerPoolBundle({poolId: "work", target: "typescript-deno", sandbox: "deno-subprocess/no-permissions",
    valueCodec: "vibelang/keyed-source/v2", selections: [{action: contract.descriptor, contract: implementation}]})
  deployment = build()
  bytes = encodeSignedKeyedSourceDeployment(deployment, key)
  authenticated = authenticateKeyedSourceDeployment(bytes, trust, runtime)
}, 300_000)

test("a static signed source deployment compiles separate Control-assigned invocation ids", () => {
  const a = compileAuthenticatedKeyedInvocation(authenticated, {planId: "plan-1", inputJson: "1"})
  const b = compileAuthenticatedKeyedInvocation(authenticated, {planId: "plan-2", inputJson: "2"})
  expect(a.executionDigest).toBe(deployment.executionDigest)
  expect(b.executionDigest).toBe(a.executionDigest)
  expect(a.planId).toBe("plan-1"); expect(b.planId).toBe("plan-2")
  expect(a.planDigest).not.toBe(b.planDigest)
  expect(JSON.parse(a.planJson).nodes.map((node: any) => node.dependsOn)).toEqual([[], [], ["action/1", "action/0"]])
  expect(JSON.parse(a.planJson).nodes[0].material.body.implementationDigest).toBe(bundle.digest)
  expect(requireAuthenticatedKeyedInvocation(a).interpreter.prepare("action/0", [])).toMatchObject({input: 1, implementationDigest: bundle.digest})
  expect(authenticated.signerKeyId).toBe(key.keyId)
  expect(Object.isFrozen(authenticated.deployment.providers[0].action)).toBe(true)
  // No executable method, approval, lease, scheduler or journal is published.
  expect("execute" in a).toBe(false)
  expect("approved" in a).toBe(false)
  expect(Object.isFrozen(requireAuthenticatedKeyedSourceDeployment(authenticated))).toBe(true)
  expect(Object.isFrozen(requireAuthenticatedKeyedInvocation(a))).toBe(true)
})

test("source deployment construction/signing is byte-deterministic", () => {
  const repeated = build()
  expect(repeated).toEqual(deployment)
  expect(encodeSignedKeyedSourceDeployment(repeated, key)).toEqual(bytes)
  expect(authenticateKeyedSourceDeployment(Buffer.from(bytes).toString("utf8"), trust, runtime)).toEqual(authenticated)
})

test("a signed source builder cannot certify erased fan-out error rows",()=>{
  const text=`import {Action,durable,fanOut} from "vibelang:flows";class Bad extends Error{};
  class Work extends Action<(n:number)=>Result<number,Bad>>{};
  export const Flow=durable((n:number):Result<readonly number[],never>=>{return fanOut([n],v=>v,v=>Work.run(v))});`
  expect(()=>build({source:{...source,source:text}})).toThrow("native language checker")
})

test("runtime and build proofs reject structural copies, proxies and inherited lookalikes", () => {
  for (const copy of [{...bundle}, Object.create(bundle), new Proxy(bundle, {})]) {
    expect(() => requireCheckedKeyedWorkerPoolBundle(copy)).toThrow("not issued")
    expect(() => build({bundles: [copy]})).toThrow("not issued")
  }
  for (const copy of [{...runtime}, Object.create(runtime), new Proxy(runtime, {})]) expect(() => build({runtime: copy})).toThrow("not issued")
  for (const copy of [{...deployment}, Object.create(deployment), new Proxy(deployment, {})]) {
    expect(() => encodeSignedKeyedSourceDeployment(copy, key)).toThrow("not issued")
  }
  for (const copy of [{...authenticated}, Object.create(authenticated), new Proxy(authenticated, {})]) {
    expect(() => requireAuthenticatedKeyedSourceDeployment(copy)).toThrow("not issued")
    expect(() => compileAuthenticatedKeyedInvocation(copy, {planId: "test", inputJson: "1"})).toThrow("not issued")
  }
  const invocation = compileAuthenticatedKeyedInvocation(authenticated, {planId: "test", inputJson: "1"})
  for (const copy of [{...invocation}, Object.create(invocation), new Proxy(invocation, {})]) {
    expect(() => requireAuthenticatedKeyedInvocation(copy)).toThrow("not issued")
  }
})

test("legacy envelope decoders cannot reinterpret keyed source signatures", () => {
  expect(() => SignedDeployment.decode(bytes, trust)).toThrow()
  expect(() => SignedBodyDeployment.decode(bytes, trust)).toThrow()
})

test("unknown signers, altered bytes, repaired digests and wrong signature domains refuse", () => {
  const other = SignedDeployment.generateKeyPair()
  expect(() => authenticateKeyedSourceDeployment(bytes, [SignedDeployment.verificationKey(other)], runtime)).toThrow("not trusted")
  const change = JSON.parse(Buffer.from(bytes).toString("utf8"))
  change.payload.source.source += "\n// altered"
  const {executionDigest: _, ...material} = change.payload
  change.payload.executionDigest = digest(material)
  const {digest: old, ...signed} = change
  change.digest = digest(signed)
  expect(() => authenticateKeyedSourceDeployment(canonicalJson(change), trust, runtime)).toThrow("signature verification")
  const {signature: __, digest: ___, ...unsigned} = change
  change.signature = sign(null, Buffer.concat([Buffer.from("vibelang.executable-deployment.v1\0"), Buffer.from(canonicalJson(unsigned))]),
    createPrivateKey({key: Buffer.from(key.privateKey, "base64url"), format: "der", type: "pkcs8"})).toString("base64url")
  const {digest: ____, ...resigned} = change
  change.digest = digest(resigned)
  expect(() => authenticateKeyedSourceDeployment(canonicalJson(change), trust, runtime)).toThrow("signature verification")
  const flipped = new Uint8Array(bytes); flipped[12] ^= 1
  expect(() => authenticateKeyedSourceDeployment(flipped, trust, runtime)).toThrow()
})

test("runtime configuration and actual bundle bytes are part of the authenticated identity", () => {
  expect(() => authenticateKeyedSourceDeployment(bytes, trust, createKeyedWorkerRuntime({timeoutMs: 5_001}))).toThrow("runtime")
  const changed = {...bundle, javascript: bundle.javascript + "\n// changed"}
  expect(() => build({bundles: [changed]})).toThrow("not issued")
  expect(() => createKeyedWorkerRuntime({runtimeValueInspection: false} as any)).toThrow("authority-changing")
})

for (const [name, mutate] of [
  ["version", (value: any) => {value.deploymentVersion = 2}],
  ["ABI", (value: any) => {value.abi = "vibelang/keyed-source/v1"}],
  ["source fields", (value: any) => {value.source.extra = true}],
  ["source path", (value: any) => {value.source.fileName = "../flow.vibe"}],
  ["source version", (value: any) => {value.source.flowVersion = 1.5}],
  ["compiler bytes", (value: any) => {value.compiler.sha256 = "0".repeat(64)}],
  ["runtime bytes", (value: any) => {value.runtime.artifactDigest = "0".repeat(64)}],
  ["driver bytes", (value: any) => {value.driverDigest = "0".repeat(64)}],
  ["bundle bytes", (value: any) => {value.bundles[0].javascript += "\n// changed"}],
  ["unselected bundles", (value: any) => {value.providers = []}],
  ["duplicate pools", (value: any) => {value.bundles.push(value.bundles[0])}],
  ["duplicate providers", (value: any) => {value.providers.push(value.providers[0])}],
  ["unbound bundle", (value: any) => {value.providers[0].bundleDigest = "0".repeat(64)}],
  ["Action metadata", (value: any) => {value.providers[0].action.id = "wrong"}],
  ["implementation metadata", (value: any) => {value.providers[0].implementation.implementationId = "wrong"}],
  ["capability grant", (value: any) => {value.providers[0].capabilities = ["Host"]}],
] as const) test(`a trusted signature does not make invalid ${name} valid`, () => {
  const changed = JSON.parse(canonicalJson(deployment))
  mutate(changed)
  const {executionDigest: _, ...material} = changed
  changed.executionDigest = digest(material)
  // Explicit test signer bypasses the local build API, as a hostile/incorrect
  // external builder could. Semantic and local-runtime checks still refuse.
  const signed = encodeSignedKeyedSourceEnvelope(changed, key)
  expect(() => authenticateKeyedSourceDeployment(signed, trust, runtime)).toThrow()
})

test("keyed signatures reject noncanonical bytes, duplicate fields and oversized messages", () => {
  const json = Buffer.from(bytes).toString("utf8")
  for (const value of [json + "\n", "\ufeff" + json, json.replace('{"artifactVersion":1,', '{"artifactVersion":1,"artifactVersion":1,')]) {
    expect(() => authenticateKeyedSourceDeployment(value, trust, runtime)).toThrow("canonical JSON")
    expect(() => authenticateKeyedSourceDeployment(Buffer.from(value, "utf8"), trust, runtime)).toThrow("canonical JSON")
  }
  expect(() => authenticateKeyedSourceDeployment(new Uint8Array(4 * 1024 * 1024 + 1), trust, runtime)).toThrow("exceeds")
})

test("no checked bundle or abstract Action implicitly supplies effects, tiers or authority", () => {
  for (const providers of [[], [policy, policy], [{...policy, actionId: "absent"}], [{...policy, tier: undefined}],
    [{...policy, capabilities: ["Host"]}], [{...policy, layers: ["Layer"]}],
    [{...policy, effects: {boundaryMode: "expected", reads: [], writes: []}}],
    [{...policy, effects: {boundaryMode: "hard", reads: [], writes: ["out.txt"]}}],
  ]) expect(() => build({providers: providers as any})).toThrow()
  expect(() => build({bundles: []})).toThrow()
  expect(() => build({bundles: [bundle, bundle]})).toThrow()
})

test("native invocation checking refuses wrong input, duplicate JSON and unsupported source graphs", () => {
  for (const inputJson of ['"wrong"', "-0", "1e400", '{"n":1,"n":2}', "", "[1]"]) {
    expect(() => compileAuthenticatedKeyedInvocation(authenticated, {planId: "refused", inputJson})).toThrow()
  }
  const unsupported = build({source: {...source, source: declaration.replace("const a=Work.run(n)!;", "const a=Work.run(n)!;switch(n){case 0:return {b:a,a}}")}})
  const proof = authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(unsupported, key), trust, runtime)
  expect(() => compileAuthenticatedKeyedInvocation(proof, {planId: "not-symbolic", inputJson: "1"})).toThrow("no supported keyed invocation")
  expect(() => build({source: {...source, source: "export const broken: number = 'wrong';"}})).toThrow("native language checker")
})

test("signed statement restoration preserves early-return demand and both alternatives",()=>{
  // This exact source was previously a deliberate unsupported-if probe.
  const selected=build({source:{...source,source:declaration.replace("const a=Work.run(n)!;","const a=Work.run(n)!;if(n){return {b:a,a}}")}})
  const proof=authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(selected,key),trust,runtime)
  for(const inputJson of ["1","0"]) {
    const invocation=compileAuthenticatedKeyedInvocation(proof,{planId:"statements",inputJson})
    const restored=restoreAuthenticatedKeyedInvocation(proof,{planId:invocation.planId,inputJson,planJson:invocation.planJson})
    expect(restored.planDigest).toBe(invocation.planDigest)
    const interpreter=requireAuthenticatedKeyedInvocation(restored).interpreter
    expect(interpreter.nodes.filter(node=>node.operation==="action")).toHaveLength(2)
    const control=interpreter.createControl(),ready=control.claim(10000)
    expect(ready.map(ticket=>ticket.nodeId).sort()).toEqual(["action/0","branch/1/condition"])
    for(const ticket of ready) {
      // Explicit test answers; real provider execution is covered separately.
      if(ticket.nodeId==="action/0")control.complete(ticket,{kind:"success",value:interpreter.encodeSuccess(ticket.nodeId,41+Number(inputJson))})
      else {
        const prepared=interpreter.prepareSelected(ticket.nodeId,[],[])
        if(prepared.operation==="action")throw new Error("expected a pure condition")
        control.complete(ticket,{kind:"success",value:prepared.value})
      }
    }
    expect(control.claim(10000).map(ticket=>ticket.nodeId)).toEqual(inputJson==="1"?["branch/1/then/result"]:["branch/1/else/action/0"])
  }
})

test("source and provider Action codecs must agree even when ids coincide", () => {
  const different = build({source: {...source, source: declaration.replace("(n:number)=>Result<number,never>", "(n:string)=>Result<number,never>")
    .replace("Work.run(n)", 'Work.run("x")').replace("Work.run(2)", 'Work.run("y")')}})
  const proof = authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(different, key), trust, runtime)
  expect(() => compileAuthenticatedKeyedInvocation(proof, {planId: "wrong-contract", inputJson: "1"})).toThrow("Action contract")
})

test("source input object order survives signed deployment and invocation compilation", () => {
  const data = build({source: {...source, source: 'import {durable} from "vibelang:flows";export const Flow=durable((n:{z:number;a:number})=>{return n})'}, providers: [], bundles: []})
  const proof = authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(data, key), trust, runtime)
  const a = compileAuthenticatedKeyedInvocation(proof, {planId: "ordered", inputJson: '{"z":1,"a":2}'})
  const b = compileAuthenticatedKeyedInvocation(proof, {planId: "ordered", inputJson: '{"a":2,"z":1}'})
  expect(a.inputJson).toBe('{"z":1,"a":2}')
  expect(a.planDigest).not.toBe(b.planDigest)
})

test("signed source dependencies are checked, byte-bound and restored as one module closure", () => {
  const modules: KeyedSourceDeclaration = {fileName:"entry.vibe",flowId:source.flowId,flowVersion:1,
    source:`import {durable} from "vibelang:flows";import {Work} from "./api";
export const Flow=durable((n:number)=>{const value=Work.run(n)!;return value});`,
    dependencies:[
      {fileName:"flow.vibe",source:'import {Action} from "vibelang:flows";export abstract class Work extends Action<(n:number)=>Result<number,never>>{}'},
      {fileName:"api.vibe",source:'export {Work} from "./flow";'},
    ]}
  const data=build({source:modules})
  expect(data.source.dependencies?.map(file=>file.fileName)).toEqual(["api.vibe","flow.vibe"])
  expect(build({source:{...modules,dependencies:[...modules.dependencies!].reverse()}})).toEqual(data)
  const proof=authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(data,key),trust,runtime)
  const invocation=compileAuthenticatedKeyedInvocation(proof,{planId:"modules",inputJson:"41"})
  const issued=requireAuthenticatedKeyedInvocation(invocation)
  expect(issued.interpreter.source.projectDigest).toMatch(/^[0-9a-f]{64}$/)
  expect(issued.interpreter.prepare("action/0",[])).toMatchObject({input:41,contract: {id:policy.actionId}})
  expect(restoreAuthenticatedKeyedInvocation(proof,{planId:invocation.planId,inputJson:invocation.inputJson,planJson:invocation.planJson})).toEqual(invocation)
  for (const mutate of [
    (value: any) => value.source.dependencies.reverse(),
    (value: any) => {value.source.dependencies = []},
    (value: any) => value.source.dependencies.push(value.source.dependencies[0]),
  ]) {
    const malformed = JSON.parse(canonicalJson(data))
    mutate(malformed)
    const {executionDigest: _, ...material} = malformed
    malformed.executionDigest = digest(material)
    // An external signer cannot bypass exact, sorted, non-aliased module sets.
    expect(() => authenticateKeyedSourceDeployment(encodeSignedKeyedSourceEnvelope(malformed,key),trust,runtime)).toThrow()
  }
  const tampered = JSON.parse(Buffer.from(encodeSignedKeyedSourceDeployment(data,key)).toString("utf8"))
  tampered.payload.source.dependencies[0].source += "\n// substituted dependency"
  const {executionDigest: _, ...material} = tampered.payload
  tampered.payload.executionDigest = digest(material)
  const {digest: __, ...unsigned} = tampered
  tampered.digest = digest(unsigned)
  expect(() => authenticateKeyedSourceDeployment(canonicalJson(tampered),trust,runtime)).toThrow("signature verification")
  const changed=build({source:{...modules,dependencies:modules.dependencies!.map(file=>({...file,source:file.source+"\n// new bytes"}))}})
  expect(changed.executionDigest).not.toBe(data.executionDigest)
  const changedProof=authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(changed,key),trust,runtime)
  expect(()=>restoreAuthenticatedKeyedInvocation(changedProof,{planId:invocation.planId,inputJson:invocation.inputJson,planJson:invocation.planJson})).toThrow("differs")
  for(const dependencies of [[modules.dependencies![0]],
    [...modules.dependencies!,{fileName:"bad.vibe",source:'export const bad:number="wrong"'}]]) {
    expect(()=>build({source:{...modules,dependencies}})).toThrow("native language checker")
  }
})

test("source dependency envelopes cannot hide duplicates, paths or extra fields", () => {
  for(const dependencies of [null,[{}],[{fileName:source.fileName,source:""}],
    [{fileName:"../escape.vibe",source:""}],[{fileName:"ordinary.ts",source:""}],
    [{fileName:"dep.vibe",source:"",extra:true}],
    [{fileName:"dep.vibe",source:""},{fileName:"dep.vibe",source:""}],
    [{fileName:"dep.vibe",source:" ".repeat(2*1024*1024)}]]) {
    expect(()=>build({source:{...source,dependencies} as any})).toThrow()
  }
})

test("Control approval target covers full input, deployment, graph and exact envelope", () => {
  const constant = build({source: {...source, source: 'import {durable} from "vibelang:flows";export const Flow=durable((n:number)=>{return 1})'}, providers: [], bundles: []})
  const proof = authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(constant, key), trust, runtime)
  const a = compileAuthenticatedKeyedInvocation(proof, {planId: "review", inputJson: "41"})
  const b = compileAuthenticatedKeyedInvocation(proof, {planId: "review", inputJson: "42"})
  expect(a.planDigest).toBe(b.planDigest) // neither graph consumes the input
  const options = {envelope: {capabilities: ["a", "b"], flows: [], budget: {tokens: 10}}, deployClass: false}
  const target = keyedInvocationApprovalTarget(a, options)
  expect(target.digest).toBe(digest({flowId: source.flowId, input: 41, envelope: options.envelope, deployClass: false,
    executionDigest: constant.executionDigest, persistedPlan: a.planDigest}))
  expect(target.digest).toMatch(/^[0-9a-f]{64}$/)
  expect(target.digest).not.toBe(a.planDigest)
  expect(keyedInvocationApprovalTarget(b, options).digest).not.toBe(target.digest)
  expect(keyedInvocationApprovalTarget(a, {...options, deployClass: true}).digest).not.toBe(target.digest)
  expect(keyedInvocationApprovalTarget(a, {...options, envelope: {...options.envelope, capabilities: ["b", "a"]}}).digest).not.toBe(target.digest)
  expect("approved" in target).toBe(false)
  expect(Object.isFrozen(target.envelope.budget)).toBe(true)
  expect(() => keyedInvocationApprovalTarget({...a}, options)).toThrow("not issued")
  for (const envelope of [{}, {...options.envelope, budget: {other: 1}}, {...options.envelope, host: 1},
    {...options.envelope, capabilities: [1]}, {...options.envelope, extra: true}]) {
    expect(() => keyedInvocationApprovalTarget(a, {...options, envelope: envelope as any})).toThrow()
  }
})

test("restoration reconstructs the signed source invocation rather than trusting stored Plan data", () => {
  const invocation = compileAuthenticatedKeyedInvocation(authenticated, {planId: "restore", inputJson: "41"})
  const saved = {planId: invocation.planId, inputJson: invocation.inputJson, planJson: invocation.planJson}
  expect(restoreAuthenticatedKeyedInvocation(authenticated, {...saved, planJson: JSON.stringify(JSON.parse(saved.planJson), null, 2)})).toEqual(invocation)
  expect(() => restoreAuthenticatedKeyedInvocation(authenticated, {...saved, inputJson: "42"})).toThrow("differs")
  expect(() => restoreAuthenticatedKeyedInvocation(authenticated, {...saved, planId: "another"})).toThrow("differs")
  const extra = JSON.parse(saved.planJson); extra.approved = true
  expect(() => restoreAuthenticatedKeyedInvocation(authenticated, {...saved, planJson: JSON.stringify(extra)})).toThrow("differs")
  expect(() => restoreAuthenticatedKeyedInvocation(authenticated, {...saved, planJson: saved.planJson.replace('{', '{"planId":"forged",')})).toThrow("native verification")
  const other = compileAuthenticatedKeyedInvocation(authenticated, {planId: "restore", inputJson: "42"})
  expect(() => restoreAuthenticatedKeyedInvocation(authenticated, {...saved, planJson: other.planJson})).toThrow("differs")
})

for (const profile of ["single-module", "multi-module", "fan-out", "child-flow", "typed-collection", "fan-out-child", "fan-out-capture"] as const) test(`a fresh process reauthenticates ${profile} source bytes and restores the invocation with new local proofs`, async () => {
  const data = profile === "multi-module" ? build({source: {fileName: "entry.vibe", flowId: source.flowId, flowVersion: 1,
    source: 'import {durable} from "vibelang:flows";import * as API from "./api";export const Flow=durable((n:number)=>{return API.Work.run(n)!});',
    dependencies: [
      {fileName: "api.vibe", source: 'export {Work} from "./flow";'},
      {fileName: "flow.vibe", source: 'import {Action} from "vibelang:flows";export class Work extends Action<(n:number)=>Result<number,never>>{}'},
    ]}}) : profile === "fan-out" ? build({source: {...source, source: fanOutDeclaration}}) :
    profile === "child-flow" ? build({source:{...source,source:childDeclaration,exportName:"Flow"}}) :
    profile === "fan-out-child" ? build({source:{...source,source:fanOutChildDeclaration}}) :
    profile === "fan-out-capture" ? build({source:{...source,source:fanOutCaptureDeclaration}}) :
    profile === "typed-collection" ? build({source:{...source,source:typedCollectionDeclaration}}) : deployment
  const signed = encodeSignedKeyedSourceDeployment(data, key)
  const proof = authenticateKeyedSourceDeployment(signed, trust, runtime)
  const invocation = compileAuthenticatedKeyedInvocation(proof, {planId: "restart", inputJson: "41"})
  const moduleURL = new URL("./keyed-deployment.ts", import.meta.url).href
  const child = Bun.spawn(["bun", "-e", `
    const api = await import(${JSON.stringify(moduleURL)});
    const input = JSON.parse(await Bun.stdin.text());
    const runtime = api.createKeyedWorkerRuntime({timeoutMs:5000});
    let copyRefused = false;
    try { api.requireAuthenticatedKeyedInvocation(input.invocation); } catch { copyRefused = true; }
    const source = api.authenticateKeyedSourceDeployment(input.signed,input.trust,runtime);
    const restored = api.restoreAuthenticatedKeyedInvocation(source,{
      planId:input.invocation.planId,inputJson:input.invocation.inputJson,planJson:input.invocation.planJson});
    const interpreter=api.requireAuthenticatedKeyedInvocation(restored).interpreter;
    console.log(JSON.stringify({copyRefused,planDigest:restored.planDigest,executionDigest:restored.executionDigest,
      inputs:interpreter.nodes.filter(node=>node.operation==="action"&&node.dependsOn.length===0)
        .map(node=>interpreter.prepare(node.id,[]).input)}));
  `], {stdin: "pipe", stdout: "pipe", stderr: "pipe"})
  child.stdin.write(JSON.stringify({signed: Buffer.from(signed).toString("utf8"), trust, invocation}))
  child.stdin.end()
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(stderr).toBe("")
  expect(code).toBe(0)
  expect(JSON.parse(stdout)).toEqual({copyRefused: true, planDigest: invocation.planDigest, executionDigest: data.executionDigest,
    inputs: profile === "fan-out" || profile === "typed-collection" || profile === "fan-out-child" ? [2,41] : profile === "multi-module" || profile === "fan-out-capture" ? [41] : [41,2]})
}, 30_000)

test("fan-out restoration binds the complete child graph and original result order", () => {
  const data=build({source:{...source,source:fanOutDeclaration}})
  const proof=authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(data,key),trust,runtime)
  const invocation=compileAuthenticatedKeyedInvocation(proof,{planId:"fanout-restore",inputJson:"41"})
  const saved={planId:invocation.planId,inputJson:invocation.inputJson,planJson:invocation.planJson}
  expect(restoreAuthenticatedKeyedInvocation(proof,saved)).toEqual(invocation)
  expect(JSON.parse(invocation.planJson).nodes).toHaveLength(3)
  expect(()=>restoreAuthenticatedKeyedInvocation(proof,{...saved,inputJson:"42"})).toThrow("differs")
  expect(()=>compileAuthenticatedKeyedInvocation(proof,{planId:"duplicate-key",inputJson:"2"})).toThrow("VIBE4199")
})

test("signed source selection binds the exact exported Flow and complete composition",()=>{
  const outer=build({source:{...source,source:childDeclaration,exportName:"Flow"}})
  const inner=build({source:{...source,source:childDeclaration,exportName:"Child"}})
  expect(outer.executionDigest).not.toBe(inner.executionDigest)
  const proof=authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(outer,key),trust,runtime)
  const invocation=compileAuthenticatedKeyedInvocation(proof,{planId:"composed",inputJson:"41"})
  expect(requireAuthenticatedKeyedInvocation(invocation).interpreter.source.exportName).toBe("Flow")
  expect(JSON.parse(invocation.planJson).nodes.map((node:any)=>node.id)).toEqual(["flow/0/action/0","flow/1/action/0","result"])
  const other=authenticateKeyedSourceDeployment(encodeSignedKeyedSourceDeployment(inner,key),trust,runtime)
  expect(()=>restoreAuthenticatedKeyedInvocation(other,{planId:invocation.planId,inputJson:invocation.inputJson,planJson:invocation.planJson})).toThrow("differs")
  // Test the public declaration validator independently of the signature.
  for(const exportName of ["", " ", "x\0", "x".repeat(16385), 1])
    expect(()=>build({source:{...source,source:childDeclaration,exportName:exportName as string}})).toThrow()
})

test("hostile data and authentication lookalikes cannot run their traps", () => {
  let ran = 0
  const hostile = new Proxy({}, {get(){ran++;return 1},getPrototypeOf(){ran++;return null},ownKeys(){ran++;return []}})
  expect(() => build({source: hostile as any})).toThrow()
  expect(() => createKeyedWorkerRuntime(hostile)).toThrow()
  expect(() => authenticateKeyedSourceDeployment(hostile as any, trust, runtime)).toThrow()
  expect(() => compileAuthenticatedKeyedInvocation(authenticated, hostile as any)).toThrow()
  expect(() => requireAuthenticatedKeyedInvocation(hostile as any)).toThrow()
  expect(ran).toBe(0)
})
