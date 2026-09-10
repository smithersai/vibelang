import { expect, test } from "bun:test"
import { compileDurableBody } from "./body-compiler.ts"
import { BodyDeployment } from "./body-deployment.ts"
import { BodyExecutor } from "./body-executor.ts"
import { Action } from "./authoring.ts"
import { Deployment, Provider, Worker } from "./provider.ts"
import { CoordinatorCrash } from "./errors.ts"
import { SignedBodyDeployment, deploymentVerificationKey, generateDeploymentSigningKeyPair } from "./signed-deployment.ts"
import { DurableStore } from "./store.ts"
import { materializeDurableValue, validateDurableValue } from "./schema.ts"
import { deepFreeze, structuralSchema, type Invocation } from "./ir.ts"
import { runBundleInvocation } from "./worker-host.ts"
import { compileDurableSource } from "./source-compiler.ts"
import { DurableExecutor } from "./engine.ts"
import { Flow } from "./authoring.ts"

// §Flow preserves ordinary computation. Immutable persistence evidence is not
// a readonly modifier on the source function's input or an Action's answer.
function fixture(source: string, implementation?: (input: any, context: any) => any) {
  const compiled = compileDurableBody(source, { fileName: "mutable-body-value.vibe" })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const body = compiled.body
  const pools = implementation ? [Worker.pool("worker", { target: "typescript-bun", providers: [
    Provider.provide(Action.fromDescriptor(body.manifest.actions[0]!), implementation, {
      implementationId: "mutable-values", implementationVersion: "1", recovery: { mode: "repeatable", maxAttempts: 1 },
    }),
  ] })] : []
  const deployment = BodyDeployment.build({ id: "mutable-values", flow: { id: body.manifest.flowId, version: 1, body }, pools })
  const key = generateDeploymentSigningKeyPair()
  const proof = SignedBodyDeployment.authenticate(deployment, SignedBodyDeployment.encode(body, deployment.manifest, key),
    [deploymentVerificationKey(key)])
  return { proof, body, deployment }
}

const mutableRecordSchema = structuralSchema("input", {
  kind: "object", fields: [
    { name: "items", optional: false, value: { kind: "array", element: { kind: "number" } } },
    { name: "value", optional: false, value: { kind: "number" } },
  ],
})

test("materialization separates mutable program values from immutable validation evidence", () => {
  const original = { value: 1, items: [0] }
  const evidence = validateDurableValue(mutableRecordSchema, original) as typeof original
  const first = materializeDurableValue(mutableRecordSchema, evidence) as typeof original
  const second = materializeDurableValue(mutableRecordSchema, evidence) as typeof original
  expect(Object.getPrototypeOf(evidence)).toBeNull()
  expect(Object.isFrozen(evidence.items)).toBe(true)
  expect(Object.getPrototypeOf(first)).toBe(Object.prototype)
  expect(Object.getPrototypeOf(first.items)).toBe(Array.prototype)
  first.value++
  first.items.push(2)
  expect(first).toEqual({ value: 2, items: [0, 2] })
  expect(second).toEqual(original)
  expect(evidence).toEqual(original)
  expect(Object.isFrozen(original)).toBe(false)
  expect(Object.isFrozen(original.items)).toBe(false)
})

test("ordinary objects retain __proto__ as an own data field without changing prototypes", () => {
  const schema = structuralSchema("success", {
    kind: "object", fields: [
      { name: "__proto__", optional: false, value: { kind: "object", fields: [
        { name: "polluted", optional: false, value: { kind: "boolean" } },
      ] } },
      { name: "constructor", optional: false, value: { kind: "number" } },
    ],
  })
  const input = JSON.parse('{"__proto__":{"polluted":true},"constructor":1}')
  const output = materializeDurableValue(schema, input) as typeof input
  expect(Object.getPrototypeOf(output)).toBe(Object.prototype)
  expect(Object.hasOwn(output, "__proto__")).toBe(true)
  expect(output.polluted).toBeUndefined()
  expect(Object.getOwnPropertyDescriptor(output, "__proto__")).toEqual({
    value: { polluted: true }, writable: true, enumerable: true, configurable: true,
  })
  output.__proto__.polluted = false
  expect(input.__proto__.polluted).toBe(true)
  expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false)
})

test("materialization never bypasses structural or strict JSON validation", () => {
  for (const input of [
    { value: "1", items: [0] },
    { value: 1, items: [0], hidden: true },
    { value: 1, items: [NaN] },
    { value: 1, items: new Array(1) },
    { value: 1, items: [0], toJSON() { return { value: 1, items: [0] } } },
  ]) expect(() => materializeDurableValue(mutableRecordSchema, input)).toThrow()
  let reads = 0
  expect(() => materializeDurableValue(mutableRecordSchema, {
    get value() { reads++; return 1 }, items: [0],
  })).toThrow("accessor")
  expect(reads).toBe(0)
  expect(materializeDurableValue(structuralSchema("success", { kind: "null" }), null)).toBeNull()
  expect(() => materializeDurableValue(structuralSchema("success", { kind: "never" }), null)).toThrow("never")
})

test("mutable Flow input is an isolated ordinary object, not frozen journal evidence", async () => {
  const { proof } = fixture(`import { durable } from "vibelang:flows"
export const Flow = durable((input: { value: number; items: number[] }) => {
  input.value++
  input.items.push(input.value)
  return { value: input.value, items: input.items, own: input.hasOwnProperty("value") }
})`)
  const store = new DurableStore()
  const input = { value: 1, items: [0] }
  try {
    expect(await new BodyExecutor(proof, store).execute(input, { executionId: "mutable-input" }))
      .toEqual({ value: 2, items: [0, 2], own: true })
    expect(input).toEqual({ value: 1, items: [0] })
    expect(store.getExecutionInput("mutable-input")).toEqual(input)
    expect(await new BodyExecutor(proof, store).resume("mutable-input").result())
      .toEqual({ value: 2, items: [0, 2], own: true })
  } finally { store.close() }
})

test("an executable Flow's public result is mutable and separate from the terminal record", async () => {
  const { proof } = fixture(`import { durable } from "vibelang:flows"
export const Flow = durable((input: { value: number; items: number[] }) => input)`)
  const store = new DurableStore()
  const input = { value: 1, items: [0] }
  try {
    const executor = new BodyExecutor(proof, store)
    const result = await executor.execute(input, { executionId: "mutable-output" }) as typeof input
    expect(result.hasOwnProperty("value")).toBe(true)
    result.value++
    result.items.push(2)
    expect(result).toEqual({ value: 2, items: [0, 2] })
    expect(store.getExecution("mutable-output").output).toEqual(input)
    const reattached = await executor.resume("mutable-output").result() as typeof input
    expect(reattached).toEqual(input)
    reattached.items.push(3)
    expect(store.getExecution("mutable-output").output).toEqual(input)
    expect(result.items).toEqual([0, 2])
  } finally { store.close() }
})

for (const structural of [true, false]) {
  test(`the compatibility executor materializes terminal values (${structural ? "structural" : "legacy JSON"} schema)`, async () => {
    type Value = { value: number; items: number[] }
    const compiled = compileDurableSource(`import { durable } from "vibelang:flows"
export const Copy = durable((input: { value: number; items: number[] }) => { return input })`, {
      fileName: "mutable-compatibility-output.vibe", flowId: "mutable-compatibility-output", flowVersion: 1, actions: [],
    })
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
    const flow = structural ? compiled.flow : Flow.define<Value, Value>(
      { id: "mutable-compatibility-output-untyped", version: 1 }, input => input,
    )
    expect(flow.plan.flowSchemas === undefined).toBe(!structural)
    const deployment = Deployment.build({ id: "mutable-compatibility-output", flow, pools: [] })
    const store = new DurableStore()
    const input = { value: 1, items: [0] }
    try {
      const executor = new DurableExecutor(deployment, store)
      const options = { executionId: "mutable-plan-output" }
      const result = await executor.execute(input, options) as Value
      expect(result.hasOwnProperty("value")).toBe(true)
      result.value++
      result.items.push(2)
      expect(result).toEqual({ value: 2, items: [0, 2] })
      const reattached = await executor.execute(input, options) as Value
      expect(reattached).toEqual(input)
      reattached.items.push(3)
      expect(store.getExecution(options.executionId).output).toEqual(input)
      expect(result.items).toEqual([0, 2])
    } finally { store.close() }
  })
}

test("live and replayed Action answers are mutable without rewriting a committed payload", async () => {
  let calls = 0
  const { proof, body } = fixture(`import { durable, Action } from "vibelang:flows"
class Read extends Action<(input: number) => Result<{ value: number; items: number[] }, never>> {}
export const Flow = durable((input: number): Result<{ value: number; items: number[]; own: boolean }, never> => {
  const answer = Read.run(input)!
  answer.value++
  answer.items.push(answer.value)
  return { value: answer.value, items: answer.items, own: answer.hasOwnProperty("value") }
})`, () => { calls++; return { value: 1, items: [0] } })
  const store = new DurableStore()
  try {
    await expect(new BodyExecutor(proof, store).execute(0, { executionId: "mutable-answer", afterNodeAdopted: node => {
      throw new CoordinatorCrash(node)
    } })).rejects.toBeInstanceOf(CoordinatorCrash)
    const resumed = new BodyExecutor(proof, store).resume("mutable-answer")
    expect(await resumed.result()).toEqual({ value: 2, items: [0, 2], own: true })
    expect(resumed.audit()?.replayed).toBe(1)
    expect(calls).toBe(1)
    expect(store.getNode("mutable-answer", `${body.manifest.sites[0]!.id}#0`).exit)
      .toMatchObject({ kind: "success", value: { kind: "success", value: { value: 1, items: [0] } } })
    expect(await new BodyExecutor(proof, store).execute(0, { executionId: "mutable-answer-live" }))
      .toEqual({ value: 2, items: [0, 2], own: true })
    expect(calls).toBe(2)
  } finally { store.close() }
})

test("an Action implementation can mutate its input without changing invocation evidence", async () => {
  let observed = false
  const { proof } = fixture(`import { durable, Action } from "vibelang:flows"
class Work extends Action<(input: { value: number; items: number[] }) => Result<number, never>> {}
export const Flow = durable((input: { value: number; items: number[] }): Result<number, never> => Work.run(input)!)`, (input, context) => {
    input.value++
    input.items.push(input.value)
    expect(input.hasOwnProperty("value")).toBe(true)
    expect(context.invocation.input).toEqual({ value: 1, items: [0] })
    expect(Object.isFrozen(context.invocation.input)).toBe(true)
    observed = true
    return input.value + input.items.length
  })
  const store = new DurableStore()
  const input = { value: 1, items: [0] }
  try {
    expect(await new BodyExecutor(proof, store).execute(input, { executionId: "mutable-worker" })).toBe(4)
    expect(observed).toBe(true)
    expect(input).toEqual({ value: 1, items: [0] })
    expect(store.getExecutionInput("mutable-worker")).toEqual(input)
  } finally { store.close() }
})

test("the worker host materializes Action input while preserving its authenticated invocation", async () => {
  const { deployment } = fixture(`import { durable, Action } from "vibelang:flows"
class Work extends Action<(input: { value: number; items: number[] }) => Result<number, never>> {}
export const Flow = durable((input: { value: number; items: number[] }): Result<number, never> => Work.run(input)!)`, () => 0)
  const route = deployment.manifest.routes[0]!
  const input = validateDurableValue(route.schemas.input, { value: 1, items: [0] })
  const now = Date.now()
  const invocation: Invocation = deepFreeze({
    schemaVersion: 1,
    executionId: "mutable-worker-host",
    nodeId: "request#0",
    attempt: 1,
    actionId: route.actionId,
    actionVersion: route.actionVersion,
    actionContractDigest: route.actionContractDigest,
    implementationDigest: route.implementationDigest,
    input,
    deadline: now + 60_000,
    downstreamIdempotencyKey: "1".repeat(64),
    capabilityGrant: route.policy.capabilityGrant,
    lease: { owner: "coordinator", expiresAt: now + 30_000 },
    budget: { expiresAt: now + 30_000 },
    fencingToken: 1,
    traceContext: {},
  })
  let calls = 0
  const module = {
    meta: { formatVersion: 1, poolId: route.poolId, actionIds: [route.actionId] },
    invoke: async (raw: unknown) => {
      calls++
      const request = raw as Invocation & { input: { value: number; items: number[] } }
      expect<Invocation>(request).toEqual(invocation)
      expect(request).not.toBe(invocation)
      request.input.value++
      request.input.items.push(request.input.value)
      expect(request.input.hasOwnProperty("value")).toBe(true)
      return { kind: "success", value: request.input.value + request.input.items.length }
    },
  }
  expect(await runBundleInvocation(module, invocation, input, route)).toEqual({ kind: "success", value: 4 })
  expect(input).toEqual({ value: 1, items: [0] })
  expect(Object.isFrozen(input)).toBe(true)
  expect(calls).toBe(1)
  expect(await runBundleInvocation(module, invocation, { value: "bad", items: [0] }, route))
    .toMatchObject({ kind: "defect", defect: { name: "BundleDispatchDefect" } })
  expect(calls).toBe(1)
})
