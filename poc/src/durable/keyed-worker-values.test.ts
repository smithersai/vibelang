import { expect, test } from "bun:test"
import { DenoSubprocessSandbox } from "../agent/sandbox.ts"
import { getNativeCompiler } from "../compiler/native.ts"
import { compileActionContract } from "./schema.ts"
import { compileActionImplementationContract, compileActionImplementationSourceContract } from "./implementation-contract.ts"
import { buildWorkerPoolBundle, keyedBundleInvocationDriver, validateWorkerPoolBundle } from "./pool-bundle.ts"
import { decodeKeyedValue, encodeKeyedValue } from "./keyed-value.ts"
import { KeyedSourceInterpreter } from "./keyed-interpreter.ts"
import { canonicalJson } from "./value.ts"

const checked = (signature: string, source: string, prefix = "") => {
  const action = compileActionContract(`${prefix}
import { Action } from "vibelang:flows";
export abstract class Work extends Action<${signature}> {}
`, { fileName: "flow.vibe", exportName: "Work", id: "flow.vibe#Work", version: 1 })
  if (!action.ok) throw new Error(JSON.stringify(action.diagnostics))
  const options = { action: action.descriptor, implementationId: "work/v1", implementationVersion: "1",
    entryFile: "flow.vibe", exportName: "work", sources: [{ fileName: "flow.vibe", source: prefix + source }] }
  const contract = compileActionImplementationSourceContract(options)
  const bundle = buildWorkerPoolBundle({ poolId: "work", target: "typescript-deno", sandbox: "deno-subprocess/no-permissions",
    valueCodec: "vibelang/keyed-source/v2", selections: [{ action: action.descriptor, contract }] })
  return { action: action.descriptor, options, contract, bundle }
}
const invoke = async (compiled: ReturnType<typeof checked>, input: unknown, inspect = true) => {
  const bundle = validateWorkerPoolBundle(compiled.bundle)
  const invocation = { actionId: compiled.action.id, actionVersion: compiled.action.version,
    actionContractDigest: compiled.action.contractDigest, input: encodeKeyedValue(input) }
  const sandbox = new DenoSubprocessSandbox({ timeoutMs: 3_000, runtimeValueInspection: inspect })
  return sandbox.execute(bundle.javascript + keyedBundleInvocationDriver(canonicalJson(invocation)), {},
    { sourceDigest: bundle.digest, turnId: "keyed-value-test" })
}

test("native source Plan and compiled provider exchange ordered values through a real worker", async () => {
  const compiled = checked("(n: { z: number; a: number }) => Result<{ keys: string[]; z: number; a: number }, never>", `
export function work(n: { z: number; a: number }): { keys: string[]; z: number; a: number } {
  return { keys: Object.keys(n), z: n.z, a: n.a };
}`)
  const source = `import {Action,durable} from "vibelang:flows";
class Work extends Action<(n:{z:number;a:number})=>Result<{keys:string[];z:number;a:number},never>>{}
export const Build=durable((n:{z:number;a:number})=>{const a=Work.run(n)!;return {z:a.z,keys:a.keys,a:a.a}});`
  const plan = getNativeCompiler().compileKeyedPlanSource({ source, fileName: "flow.vibe", flowId: "test/Build", flowVersion: 1,
    planId: "ordered-worker", inputJson: '{"z":41,"a":1}', providersJson: JSON.stringify([{ actionId: compiled.action.id,
      implementationId: compiled.contract.implementationId, implementationDigest: compiled.bundle.digest, tier: "sealed",
      effects: { boundaryMode: "hard", reads: [], writes: [] }, layers: [], capabilities: [] }]) })
  expect(plan.diagnostics).toEqual([])
  expect(plan.ok).toBe(true)
  const interpreter = new KeyedSourceInterpreter(plan.planJson)
  const prepared = interpreter.prepare("action/0", [])
  if (prepared.operation !== "action") throw new Error("expected Action")
  expect(prepared.contract).toEqual(compiled.action)
  expect(prepared.implementationDigest).toBe(compiled.bundle.digest)
  const execution = await invoke(compiled, prepared.input)
  expect(execution.error).toBeUndefined()
  expect(execution.ok).toBe(true)
  const exit = execution.result as { kind: string; value: unknown }
  expect(exit.kind).toBe("success")
  const success = decodeKeyedValue(exit.value)
  expect(success).toEqual({ keys: ["z", "a"], z: 41, a: 1 })
  const stored = JSON.parse(canonicalJson(interpreter.encodeSuccess("action/0", success)))
  const body = JSON.parse(plan.planJson).nodes.find((node: any) => node.id === "result")
  const refs = body.material.inputs.filter((input: any) => input._tag === "Ref").map((input: any) => ({
    from: input.from, path: input.path, value: input.path.reduce((value: any, key: string) => value[key], stored),
  }))
  const result = interpreter.prepare("result", refs)
  if (result.operation !== "result") throw new Error("expected result")
  expect(JSON.stringify(decodeKeyedValue(JSON.parse(canonicalJson(result.value))))).toBe('{"z":41,"keys":["z","a"],"a":1}')
  // This is source/provider/value execution, not scheduler, approval or journal evidence.
})

for (const [name, type, expression] of [
  ["negative zero", "number", "-0"], ["non-finite", "number", "1 / 0"],
  ["unpaired surrogate", "string", '"\\ud800"'],
] as const) test(`worker codec refuses ${name} before transport can repair it`, async () => {
  const compiled = checked(`(n: number) => Result<${type}, never>`, `export function work(n: number): ${type} { return ${expression}; }`)
  const execution = await invoke(compiled, 1)
  expect(execution.ok).toBe(false)
  expect(execution.error?.name).toBe("KeyedValueError")
  expect(execution.result).toBeUndefined()
})

test("typed failures are encoded distinctly and payload accessors are never read", async () => {
  const prefix = 'class Failed extends Error { constructor(readonly code: string) { super(code); } }\n'
  for (const accessor of [false, true]) {
    const compiled = checked("(n: number) => Result<number, Failed>", `export function work(n: number): Result<number, Failed> {
      const failure = new Failed("denied");
      ${accessor ? 'Object.defineProperty(failure, "code", { get() { return "changed"; }, enumerable: true });' : ""}
      throw failure;
    }`, prefix)
    const execution = await invoke(compiled, 1)
    expect(execution.error).toBeUndefined()
    expect(execution.ok).toBe(true)
    const exit = execution.result as any
    if (accessor) {
      expect(exit).toEqual({ kind: "defect", defect: { name: "BundleFailureMappingDefect", message: "typed failure payload is not inert data" } })
    } else {
      expect(exit).toMatchObject({ kind: "failure" })
      expect(decodeKeyedValue(exit.error)).toEqual({ version: 1, identity: "vibelang:flow.vibe@Failed@1", payload: { code: "denied", message: "denied", name: "Error" } })
    }
  }
})

test("native completion conventions preserve sync data and await declared Promises", async () => {
  for (const source of [
    "export function work(n: number): { value: number } { return { value: n }; }",
    "export async function work(n: number): Promise<{ value: number }> { return { value: n }; }",
    "async function helper(n: number) { return { value: n }; } export function work(n: number): Promise<{ value: number }> { return helper(n); }",
  ]) {
    const compiled = checked("(n: number) => Result<{ value: number }, never>", source)
    const execution = await invoke(compiled, 42)
    expect(execution.error).toBeUndefined()
    expect(execution.ok).toBe(true)
    const exit = execution.result as any
    expect(exit.kind).toBe("success")
    expect(decodeKeyedValue(exit.value)).toEqual({ value: 42 })
  }
})

test("a synchronous result's then property is refused as data, never assimilated", async () => {
  const compiled = checked("(n: number) => Result<{ value: number }, never>", `
export function work(n: number): { value: number } {
  const output = { value: n };
  Object.defineProperty(output, "then", { value: () => {}, enumerable: true });
  return output;
}`)
  // Awaiting this object would hang until timeout. The native value convention
  // reaches the codec directly, which refuses its non-data function property.
  const execution = await invoke(compiled, 1)
  expect(execution.ok).toBe(false)
  expect(execution.error?.name).toBe("KeyedValueError")
})

test("a provider proxy result is refused before Promise or Result inspection", async () => {
  const compiled = checked("(n: number) => Result<{ value: number }, never>", `
export function work(n: number): { value: number } { return new Proxy({ value: n }, {}); }
`)
  const execution = await invoke(compiled, 1)
  expect(execution.ok).toBe(true)
  expect(execution.result).toMatchObject({ kind: "defect", defect: { message: "keyed provider value has a proxy or excessive prototype chain" } })
})

test("keyed bundle requires both the source value proof and explicit native runner inspection", async () => {
  const compiled = checked("(n: number) => Result<number, never>", "export function work(n: number): number { return n; }")
  const legacy = compileActionImplementationContract({ ...compiled.options, implementation: (n: number) => n })
  expect(() => buildWorkerPoolBundle({ poolId: "wrong", target: "typescript-deno", sandbox: "deno-subprocess/no-permissions",
    valueCodec: "vibelang/keyed-source/v2", selections: [{ action: compiled.action, contract: legacy }] })).toThrow("value-boundary")
  const execution = await invoke(compiled, 1, false)
  expect(execution.ok).toBe(false)
  expect(execution.error?.message).toContain("native value inspector")
})

test("the same codec refuses proxies and accessors in Deno without evaluating their traps", async () => {
  const compiled = checked("(n: number) => Result<number, never>", "export function work(n: number): number { return n; }")
  const driver = `export default function (_functions, inspection) {
    const codec = __vibelangLoad("value-codec", "keyed-value-core.ts").createKeyedValueCodec(inspection.isProxy);
    let invoked = 0;
    const array = [1]; Object.defineProperty(array, "0", {get(){invoked++;return 1},enumerable:true});
    const object = Object.defineProperty({}, "x", {get(){invoked++;return 1},enumerable:true});
    const proxy = new Proxy({}, {getPrototypeOf(){invoked++;return Object.prototype},ownKeys(){invoked++;return []}});
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    let refused = 0;
    for (const value of [array,object,proxy,revoked.proxy,{nested:proxy}]) {
      try { codec.encodeKeyedValue(value); } catch(error) { if(error.name === "KeyedValueError") refused++; else throw error; }
    }
    return {invoked,refused};
  }`
  const sandbox = new DenoSubprocessSandbox({ timeoutMs: 3_000, runtimeValueInspection: true })
  const execution = await sandbox.execute(compiled.bundle.javascript + driver, {}, { sourceDigest: compiled.bundle.digest, turnId: "native-codec" })
  expect(execution.error).toBeUndefined()
  expect(execution.result).toEqual({ invoked: 0, refused: 5 })
})

test("native value inspection is explicit, identity-bound, and absent from the legacy entry ABI", async () => {
  const plain = new DenoSubprocessSandbox({ timeoutMs: 3_000 })
  const inspected = new DenoSubprocessSandbox({ timeoutMs: 3_000, runtimeValueInspection: true })
  expect(plain.identity.artifactDigest).toBe(inspected.identity.artifactDigest)
  expect(plain.identity.configDigest).not.toBe(inspected.identity.configDigest)
  const source = 'export default function (_functions, inspection) { return { count: arguments.length, inspector: typeof inspection?.isProxy }; }'
  expect((await plain.execute(source, {}, { sourceDigest: "test", turnId: "plain" })).result).toEqual({ count: 1, inspector: "undefined" })
  expect((await inspected.execute(source, {}, { sourceDigest: "test", turnId: "inspected" })).result).toEqual({ count: 2, inspector: "function" })
  expect(() => new DenoSubprocessSandbox({ runtimeValueInspection: "yes" as unknown as boolean })).toThrow("must be a boolean")
})
