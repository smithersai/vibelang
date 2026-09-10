import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getNativeCompiler } from "../compiler/native.ts"
import type { NativePlanSourceRequest } from "../compiler/protocol.ts"
import { Action } from "./authoring.ts"
import { PlanArtifact, loadCompiledFlow } from "./artifact.ts"
import { validateEffectManifest } from "./manifest-artifact.ts"
import { digest, structuralSchema, type ActionDescriptor } from "./ir.ts"
import { Deployment, Provider, Worker } from "./provider.ts"
import { DurableExecutor, CoordinatorCrash } from "./engine.ts"
import { DurableStore } from "./store.ts"

const contract = (id = "native/Work", version = 3): ActionDescriptor => {
  const semantic = {
    id, version,
    inputSchema: structuralSchema("input", { kind: "number" }),
    successSchema: structuralSchema("success", { kind: "object", fields: [{ name: "value", optional: false, value: { kind: "number" } }] }),
    errorSchema: structuralSchema("error", { kind: "error", identity: "native/Failure@1", name: "Failure", payload: { kind: "object", fields: [] } }),
  } as const
  return { ...semantic, contractDigest: digest(semantic) }
}

const request = (source: string, descriptor = contract(), moduleSpecifier = "./actions"): NativePlanSourceRequest => ({
  source, fileName: "flows/bound.vibe", flowId: "native/Bound", flowVersion: 2, mode: "plan",
  actions: [{ moduleSpecifier, exportName: "Work", descriptorJson: JSON.stringify(descriptor) }],
})
const source = `import {durable} from "vibelang:flows"; import {Work as W} from "./actions";
throw new Error("must not evaluate source");
export const Build = durable((input:number) => {const result=W.run(input)!; return result.value})`

test("native explicit Action bindings preserve aliases, versions, schemas and independent failure rows", () => {
  for (const authored of [source, source.replace('{Work as W}', '* as Actions').replace('W.run', 'Actions.Work.run')]) {
    const input = request(authored)
    const got = getNativeCompiler().compilePlanSource(input)
    expect(got.diagnostics).toEqual([])
    expect(got.status).toBe("plan")
    expect(got.manifestFailure).toBe("")
    expect(got.derivedActions).toEqual([])
    const plan = PlanArtifact.validate(JSON.parse(got.planJson))
    const manifest = validateEffectManifest(JSON.parse(got.manifestJson))
    expect(plan.actions).toEqual([contract()])
    expect(plan.nodes[0]).toMatchObject({ kind: "action", actionId: "native/Work", actionVersion: 3 })
    expect(plan.flowSchemas?.success).toEqual(structuralSchema("success", { kind: "number" }))
    expect(manifest.actions).toEqual([contract()])
    expect(manifest.failures).toEqual(["native/Failure@1"])
    const independent = getNativeCompiler().compilePlanSource({ ...input, mode: "manifest" })
    expect(independent.status).toBe("manifest")
    expect(independent.manifestJson).toBe(got.manifestJson)
  }
})

test("native Action binding uses real value symbols, not spellings or erased assignability", () => {
  for (const authored of [
    source.replace('W.run(input)', 'W.run("wrong")'),
    source.replace('result.value', 'result.missing'),
    source.replace('import {Work as W}', 'import type {Work as W}'),
    source.replace('import {Work as W} from "./actions";', 'const W={run:(n:number)=>({value:n})};'),
    source.replace('W.run(input)', 'W.run?.(input)'),
    source.replace('W.run(input)', 'W.run<number>(input)'),
  ]) {
    const got = getNativeCompiler().compilePlanSource(request(authored))
    expect(got.status).toBe("refused")
    expect(got.diagnostics.length).toBeGreaterThan(0)
    expect(got.planJson).toBe("")
    expect(got.manifestJson).toBe("")
  }
})

test("native binding boundary rejects duplicate JSON keys, tampered codecs and module authority replacement", () => {
  const original = request(source)
  const binding = original.actions![0]!
  for (const bad of [
    { ...binding, descriptorJson: binding.descriptorJson.replace('"version":3', '"version":3,"version":3') },
    { ...binding, descriptorJson: binding.descriptorJson.replace('"kind":"number"', '"kind":"number","kind":"number"') },
    { ...binding, descriptorJson: binding.descriptorJson.replace('"version":3', '"version":4') },
    { ...binding, descriptorJson: binding.descriptorJson.replace('"kind":"number"', '"kind":"string"') },
    { ...binding, descriptorJson: binding.descriptorJson.replace('"version":3', '"version":-0') },
    { ...binding, descriptorJson: binding.descriptorJson.replace('"version":3', '"version":1e999') },
    { ...binding, descriptorJson: binding.descriptorJson.slice(0, -1) + ',"extra":true}' },
    { ...binding, moduleSpecifier: "vibelang:flows" },
    { ...binding, moduleSpecifier: "vibelang:exceptions" },
    { ...binding, exportName: "Work}; throw new Error()" },
    { ...binding, moduleSpecifier: "" },
  ]) expect(() => getNativeCompiler().compilePlanSource({ ...original, actions: [bad] })).toThrow()
  expect(() => getNativeCompiler().compilePlanSource({ ...original, actions: [binding, { ...binding, descriptorJson: JSON.stringify(contract("native/Other")) }] })).toThrow()
  expect(getNativeCompiler().compilePlanSource({ ...original, actions: [binding, binding] }).status).toBe("plan")
})

test("native legacy Action compatibility never masks unrelated output or consumed-input defects", () => {
  const legacy = Action.define({ id: "native/Legacy", version: 1 }).descriptor
  const legacySource = `import {durable} from "vibelang:flows"; import {Work} from "./actions";
export const Build=durable((input:{items:readonly number[]})=>{const value=Work.run(input)!;return {value:value.anything}})`
  const got = getNativeCompiler().compilePlanSource(request(legacySource, legacy))
  expect(got.status).toBe("plan")
  expect(PlanArtifact.validate(JSON.parse(got.planJson)).flowSchemas?.success.shape).toBe("json-value")
  for (const bad of [
    legacySource.replace('{value:value.anything}', '{value:value.anything, bad:input.items.length}'),
    legacySource.replace('{value:value.anything}', '{bad:input.items.length, value:value.anything}'),
    legacySource.replace('return {value:value.anything}', 'const again=Work.run(input.items.length)!;return value'),
  ]) {
    const refused = getNativeCompiler().compilePlanSource(request(bad, legacy))
    expect(refused.status).toBe("refused")
    expect(refused.diagnostics.some(issue => issue.code === "VIBE4110" && issue.message.includes("cannot project length")), JSON.stringify(refused.diagnostics)).toBe(true)
  }
  const unaffected = getNativeCompiler().compilePlanSource(request(legacySource.replace('return {value:value.anything}', 'const again=Work.run(value.anything)!;return 1'), legacy))
  expect(unaffected.status).toBe("plan")
  expect(PlanArtifact.validate(JSON.parse(unaffected.planJson)).flowSchemas?.success).toEqual(structuralSchema("success", {kind:"literal",value:1}))
  for (const authored of [
    `import {durable,fanOut} from "vibelang:flows";import {Work} from "./actions";const Build=durable((items:readonly number[])=>{return fanOut(items,item=>item,item=>Work.run(item))})`,
    `import {durable,loopWhile} from "vibelang:flows";import {Work} from "./actions";const Build=durable((n:number)=>{return loopWhile(n,state=>state<4,state=>Work.run(state),5)})`,
  ]) {
    const compiled = getNativeCompiler().compilePlanSource(request(authored, legacy))
    expect(compiled.status, JSON.stringify(compiled.diagnostics)).toBe("plan")
    expect(PlanArtifact.validate(JSON.parse(compiled.planJson)).flowSchemas?.success.shape).toBe("json-value")
  }
})

const childRequest = (): NativePlanSourceRequest => {
  const child = getNativeCompiler().compilePlanSource(request(source))
  expect(child.status).toBe("plan")
  return {
    ...request(`import {durable} from "vibelang:flows";import {Work as W, Child as C} from "./actions";
const Parent=durable((input:number)=>{const first=W.run(input)!;const value=C.run(first.value);return {value}})`),
    flowId: "native/Parent",
    flows: [{ moduleSpecifier: "./actions", exportName: "Child", planJson: child.planJson, manifestJson: child.manifestJson }],
  }
}

test("Go child Flow binding preserves its separate Manifest and survives an on-disk coordinator restart", async () => {
  const input = childRequest()
  const got = getNativeCompiler().compilePlanSource(input)
  expect(got.diagnostics).toEqual([])
  expect(got.status).toBe("plan")
  expect(got.manifestFailure).toBe("")
  const plan = PlanArtifact.validate(JSON.parse(got.planJson))
  const manifest = validateEffectManifest(JSON.parse(got.manifestJson))
  expect(plan.formatVersion).toBe(2)
  expect(plan.childFlows).toHaveLength(1)
  expect(plan.nodes.map(node => node.kind)).toEqual(["action", "childFlow"])
  expect(plan.nodes[1]!.controlDependencies).toEqual([plan.nodes[0]!.id])
  expect(manifest.requirements).toEqual(["native/Work"])
  expect(manifest.failures).toEqual(["native/Failure@1"])
  expect(manifest.contracts).toEqual([{ kind: "childFlow", identity: "native/Bound", contractDigest: plan.childFlows![0]!.digest }])
  const independent = getNativeCompiler().compilePlanSource({ ...input, mode: "manifest" })
  expect(independent.manifestJson).toBe(got.manifestJson)
  const calls: number[] = []
  const Work = Action.fromDescriptor<number, { value: number }, Error>(contract())
  const deployment = Deployment.build({ id: "native-child-binding", flow: loadCompiledFlow(PlanArtifact.encode(plan)), pools: [
    Worker.pool("native-child-worker", { target: "typescript-bun", providers: [Provider.provide(Work, n => {
      calls.push(n); return { value: n + 1 }
    }, { implementationId: "native-work", implementationVersion: "1", recovery: { mode: "repeatable", maxAttempts: 2 } })] }),
  ] })
  const directory = mkdtempSync(join(tmpdir(), "vibelang-native-child-"))
  const filename = join(directory, "state.sqlite")
  let store: DurableStore | undefined
  try {
    store = new DurableStore(filename)
    await expect(new DurableExecutor(deployment, store).execute(40, {
      executionId: "native-child", afterNodeAdopted(nodeId) {
        if (nodeId === plan.nodes[1]!.id) throw new CoordinatorCrash(nodeId)
      },
    })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(calls).toEqual([40, 41])
    store.close()
    store = new DurableStore(filename)
    expect(await new DurableExecutor(deployment, store).resume("native-child").result()).toEqual({ value: 42 })
    expect(calls).toEqual([40, 41])
    expect(await new DurableExecutor(deployment, store).execute(40, { executionId: "native-child" })).toEqual({ value: 42 })
    expect(calls).toEqual([40, 41])
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("Go child binding refuses contract forgeries and does not invent an absent child Manifest", () => {
  const input = childRequest()
  const flow = input.flows![0]!
  const missing = getNativeCompiler().compilePlanSource({ ...input, flows: [{ ...flow, manifestJson: undefined }] })
  expect(missing.status).toBe("plan")
  expect(missing.manifestJson).toBe("")
  expect(missing.manifestFailure).toContain("has no Effect Manifest")
  expect(getNativeCompiler().compilePlanSource({ ...input, mode: "manifest", flows: [{ ...flow, manifestJson: undefined }] }).status).toBe("refused")
  for (const change of [
    { ...flow, planJson: flow.planJson.replace('"flowVersion":2', '"flowVersion":3') },
    { ...flow, manifestJson: flow.manifestJson!.replace('"flowVersion":2', '"flowVersion":3') },
    { ...flow, planJson: flow.planJson.replace('"flowVersion":2', '"flowVersion":2,"flowVersion":2') },
    { ...flow, exportName: "Work" },
    { ...flow, moduleSpecifier: "vibelang:flows" },
  ]) expect(() => getNativeCompiler().compilePlanSource({ ...input, flows: [change] })).toThrow()
  for (const authored of [input.source.replace('C.run(first.value)', 'C.run("wrong")'), input.source.replace('C.run(first.value)', 'C.run(first.value,1)')]) {
    const result = getNativeCompiler().compilePlanSource({ ...input, source: authored })
    expect(result.status).toBe("refused")
    expect(result.planJson).toBe("")
  }
})

test("public Plan, Manifest and imported-child APIs work with compiler-library imports prohibited", () => {
  const module = new URL("./index.ts", import.meta.url).href
  const authored = `import {Action,durable} from "vibelang:flows";
class Read extends Action<(n:number)=>Result<number,never>>{};
const Child=durable((n:number)=>{return Read.run(n)})`
  const child = Bun.spawnSync([process.execPath, "--eval", `
    import {plugin} from "bun";
    plugin({name:"durable-native-only",setup(build){
      build.onResolve({filter:/^typescript(?:-js)?(?:\\/|$)/},()=>{throw new Error("retired compiler dependency")});
    }});
    const {compileDurableSource,compileEffectManifest,compileDurableFlow,PlanArtifact}=await import(${JSON.stringify(module)});
    const compiled=compileDurableSource(${JSON.stringify(authored)},{fileName:"native-child.vibe"});
    if(!compiled.ok||!compiled.manifest)throw new Error(JSON.stringify(compiled));
    const manifest=compileEffectManifest(${JSON.stringify(authored)},{fileName:"native-child.vibe"});
    if(!manifest.ok||manifest.manifest.digest!==compiled.manifest.digest)throw new Error("Manifest mismatch");
    const parentSource='import {durable} from "vibelang:flows";import {Child} from "./child";const Parent=durable((n:number)=>{return Child.run(n)})';
    const options={fileName:"native-parent.vibe",flows:[{moduleSpecifier:"./child",exportName:"Child",plan:compiled.plan,manifest:compiled.manifest}]};
    const parent=compileDurableSource(parentSource,options);
    if(!parent.ok||parent.plan.childFlows?.[0].digest!==compiled.plan.digest)throw new Error(JSON.stringify(parent));
    PlanArtifact.validate(parent.plan);
    const flow=compileDurableFlow(parentSource,options);
    if(!flow.ok||flow.plan?.digest!==parent.plan.digest)throw new Error(JSON.stringify(flow));
    console.log("native-only durable frontends");
  `], { env: { ...process.env, VIBELANG_NATIVE_COMPILER: getNativeCompiler().executable }, stdout: "pipe", stderr: "pipe" })
  expect(child.stderr.toString()).toBe("")
  expect(child.exitCode).toBe(0)
  expect(child.stdout.toString()).toBe("native-only durable frontends\n")
})
