import { expect, test } from "bun:test"
import {
  Action,
  compileActionContract,
  compileDurableSource,
  Deployment,
  DurableActionDefect,
  DurableExecutor,
  DurableStore,
  fail,
  Flow,
  Provider,
  validatePlanTemplate,
  Worker,
  type ActionDescriptor,
  durableErrorPayload,
  type DurableTypeDescriptor,
  type WorkerExit
} from "./index.ts"

const representativeContract = `
import { Action } from "vibelang:flows"

interface WorkInput {
  readonly value: number
  readonly label?: string
  readonly pair: readonly [string, true]
  readonly modes: readonly ("fast" | "safe")[]
}

type WorkOutput =
  | { readonly kind: "done"; readonly answer: number }
  | { readonly kind: "skipped"; readonly reason: string }

class BadInput extends Error {
  constructor(readonly field: string) { super(field) }
}
class Unavailable extends Error {
  constructor(readonly retryAfter: number) { super("unavailable") }
}

export abstract class Work extends Action<
  (input: WorkInput) => Promise<Result<WorkOutput, BadInput | Unavailable>>
> {}
`

const compileWork = (source = representativeContract): ActionDescriptor => {
  const result = compileActionContract(source, {
    fileName: "contracts/work.vibe",
    exportName: "Work",
    id: "test/schema/Work",
    version: 3
  })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result.descriptor
}

const descriptorOf = (schema: ActionDescriptor["inputSchema"]): DurableTypeDescriptor => {
  if (schema.shape !== "structural") throw new Error("expected structural schema")
  return schema.descriptor
}

test("checker-derived Action contracts are deterministic and type-sensitive", () => {
  const first = compileWork()
  const second = compileWork()
  expect(second).toEqual(first)
  expect(Object.isFrozen(first)).toBe(true)
  expect(descriptorOf(first.inputSchema)).toEqual({
    kind: "object",
    fields: [
      { name: "label", optional: true, value: { kind: "string" } },
      { name: "modes", optional: false, value: {
        kind: "array",
        element: { kind: "union", variants: [
          { kind: "literal", value: "fast" },
          { kind: "literal", value: "safe" }
        ] }
      } },
      { name: "pair", optional: false, value: { kind: "tuple", items: [
        { kind: "string" }, { kind: "literal", value: true }
      ] } },
      { name: "value", optional: false, value: { kind: "number" } }
    ]
  })
  expect(descriptorOf(first.errorSchema)).toMatchObject({
    kind: "union",
    variants: [
      { kind: "error", name: expect.any(String), identity: expect.any(String) },
      { kind: "error", name: expect.any(String), identity: expect.any(String) }
    ]
  })

  const changed = compileWork(representativeContract.replace("readonly value: number", "readonly value: string"))
  expect(changed.id).toBe(first.id)
  expect(changed.version).toBe(first.version)
  expect(changed.contractDigest).not.toBe(first.contractDigest)
  expect(changed.inputSchema.digest).not.toBe(first.inputSchema.digest)
})

test("Action recognition follows the compiler-owned import rather than spelling", () => {
  const aliased = compileActionContract(`
    import { Action as DurableAction } from "vibelang:flows"
    interface Input { value: boolean | null }
    interface Output { value: string }
    class Failure extends Error { declare readonly code: "failed" }
    export abstract class Renamed extends DurableAction<(input: Input) => Result<Output, Failure>> {}
  `, { fileName: "alias.vibe", exportName: "Renamed", id: "test/Renamed", version: 1 })
  expect(aliased.ok).toBe(true)

  const namespaced = compileActionContract(`
    import * as Flows from "vibelang:flows"
    class Failure extends Error {}
    export abstract class Namespaced extends Flows.Action<(input: string) => Result<number, Failure>> {}
  `, { fileName: "namespace.vibe", exportName: "Namespaced", id: "test/Namespaced", version: 1 })
  expect(namespaced.ok).toBe(true)

  const impostor = compileActionContract(`
    class Action<Signature> {}
    class Failure extends Error {}
    export abstract class Renamed extends Action<(input: string) => Result<string, Failure>> {}
  `, { fileName: "impostor.vibe", exportName: "Renamed", id: "test/Renamed", version: 1 })
  expect(impostor.ok).toBe(false)
  if (impostor.ok) throw new Error("expected compiler identity failure")
  expect(impostor.diagnostics[0].code).toBe("VIBE4202")

  const resultImpostor = compileActionContract(`
    import { Action } from "vibelang:flows"
    type Result<A, E> = { success: A; failure: E }
    class Failure extends Error {}
    export abstract class Renamed extends Action<(input: string) => Result<number, Failure>> {}
  `, { fileName: "result-impostor.vibe", exportName: "Renamed", id: "test/Renamed", version: 1 })
  expect(resultImpostor.ok).toBe(false)
  if (resultImpostor.ok) throw new Error("expected Result identity failure")
  expect(resultImpostor.diagnostics[0].message).toContain("must return Result")
})

test("non-durable boundary types fail closed with bounded source diagnostics", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["any", "any"],
    ["unknown", "unknown"],
    ["() => string", "executable"],
    ["Promise<string>", "nested Promise"],
    ["symbol", "symbol"],
    ["bigint", "bigint"],
    ["Date", "class instance"],
    ["{ readonly [key: string]: string }", "index signature"],
    ["Box<string>", "generic declaration"],
    ["Recursive", "recursive"],
    ["Clock", "class instance"]
  ]
  for (const [input, expected] of cases) {
    const result = compileActionContract(`
      import { Action } from "vibelang:flows"
      interface Box<T> { readonly value: T }
      interface Recursive { readonly next?: Recursive }
      class Context {}
      class Clock extends Context { now(): number { return 0 } }
      class Failure extends Error {}
      export abstract class Unsafe extends Action<(input: ${input}) => Result<string, Failure>> {}
    `, { fileName: `unsafe-${expected}.vibe`, exportName: "Unsafe", id: "test/Unsafe", version: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error(`expected ${input} to fail`)
    expect(result.diagnostics[0].code).toBe("VIBE4203")
    expect(result.diagnostics[0].message).toContain(expected)
    expect(result.diagnostics[0].line).toBeGreaterThan(0)
    expect(result.diagnostics[0].column).toBeGreaterThan(0)
  }

  const nestedReturn = compileActionContract(`
    import { Action } from "vibelang:flows"
    class Failure extends Error {}
    export abstract class Unsafe extends Action<
      (input: string) => Promise<Promise<Result<string, Failure>>>
    > {}
  `, { fileName: "nested-return.vibe", exportName: "Unsafe", id: "test/Unsafe", version: 1 })
  expect(nestedReturn.ok).toBe(false)
  if (nestedReturn.ok) throw new Error("expected nested return Promise to fail")
  expect(nestedReturn.diagnostics[0].message).toContain("nested Promise")

  const infallible = compileActionContract(`
    import { Action } from "vibelang:flows"
    export abstract class Plain extends Action<(input: string) => string> {}
  `, { fileName: "plain.vibe", exportName: "Plain", id: "test/Plain", version: 1 })
  expect(infallible.ok).toBe(false)
  if (infallible.ok) throw new Error("expected bounded infallible Action form to fail")
  expect(infallible.diagnostics[0].message).toContain("must return Result")

  const generic = compileActionContract(`
    import { Action } from "vibelang:flows"
    class Failure extends Error {}
    export abstract class Generic<T> extends Action<(input: T) => Result<string, Failure>> {}
  `, { fileName: "generic.vibe", exportName: "Generic", id: "test/Generic", version: 1 })
  expect(generic.ok).toBe(false)
  if (generic.ok) throw new Error("expected generic Action form to fail")
  expect(generic.diagnostics[0].message).toContain("generic")

  const structuralErrorImpostor = compileActionContract(`
    import { Action } from "vibelang:flows"
    class LooksLikeError { name = "LooksLikeError"; message = "not nominal" }
    export abstract class Unsafe extends Action<(input: string) => Result<string, LooksLikeError>> {}
  `, { fileName: "error-impostor.vibe", exportName: "Unsafe", id: "test/Unsafe", version: 1 })
  expect(structuralErrorImpostor.ok).toBe(false)
  if (structuralErrorImpostor.ok) throw new Error("expected structural Error impostor to fail")
  expect(structuralErrorImpostor.diagnostics[0].message).toContain("does not extend Error")
})

test("descriptor depth, node, field, and union budgets fail deterministically", () => {
  const nested = ["interface Depth0 { readonly value: string }"]
  for (let index = 1; index < 70; index++) nested.push(`interface Depth${index} { readonly next: Depth${index - 1} }`)
  const deep = compileActionContract(`
    import { Action } from "vibelang:flows"
    ${nested.join("\n")}
    class Failure extends Error {}
    export abstract class Deep extends Action<(input: Depth69) => Result<string, Failure>> {}
  `, { fileName: "deep.vibe", exportName: "Deep", id: "test/Deep", version: 1 })
  expect(deep.ok).toBe(false)
  if (deep.ok) throw new Error("expected deep descriptor to fail")
  expect(deep.diagnostics[0].message).toContain("depth limit")

  const fields = Array.from({ length: 1_025 }, (_, index) => `readonly field${index}: string`).join(";")
  const wide = compileActionContract(`
    import { Action } from "vibelang:flows"
    interface Wide { ${fields} }
    class Failure extends Error {}
    export abstract class WideAction extends Action<(input: Wide) => Result<string, Failure>> {}
  `, { fileName: "wide.vibe", exportName: "WideAction", id: "test/Wide", version: 1 })
  expect(wide.ok).toBe(false)
  if (wide.ok) throw new Error("expected wide descriptor to fail")
  expect(wide.diagnostics[0].message).toContain("field limit")

  const variants = Array.from({ length: 129 }, (_, index) => JSON.stringify(`variant-${index}`)).join(" | ")
  const union = compileActionContract(`
    import { Action } from "vibelang:flows"
    class Failure extends Error {}
    export abstract class UnionAction extends Action<(input: ${variants}) => Result<string, Failure>> {}
  `, { fileName: "union.vibe", exportName: "UnionAction", id: "test/Union", version: 1 })
  expect(union.ok).toBe(false)
  if (union.ok) throw new Error("expected wide union to fail")
  expect(union.diagnostics[0].message).toContain("variant limit")
})

test("typed synthetic Action declarations reject wrong inputs and projections", () => {
  const descriptor = compileWork()
  const binding = [{ moduleSpecifier: "test:typed-actions", exportName: "Work", descriptor }]
  const wrongInput = compileDurableSource(`
    import { durable } from "vibelang:flows"
    import { Work } from "test:typed-actions"
    export const Bad = durable(function Bad(input: { value: number }) {
      return Work.run({ value: "wrong", pair: ["x", true], modes: ["safe"] })
    })
  `, { fileName: "wrong-input.vibe", flowId: "test/WrongInput", flowVersion: 1, actions: binding })
  expect(wrongInput.ok).toBe(false)
  if (wrongInput.ok) throw new Error("expected wrong Action input to fail")
  expect(wrongInput.diagnostics[0].code).toBe("VIBE4100")
  expect(wrongInput.diagnostics[0].message).toMatch(/string.*number|number.*string/)

  const wrongProjection = compileDurableSource(`
    import { durable } from "vibelang:flows"
    import { Work } from "test:typed-actions"
    export const Bad = durable(function Bad(input: { value: number }) {
      const output = Work.run({ value: input.value, pair: ["x", true], modes: ["fast"] }).unwrap()
      return output.missing
    })
  `, { fileName: "wrong-projection.vibe", flowId: "test/WrongProjection", flowVersion: 1, actions: binding })
  expect(wrongProjection.ok).toBe(false)
  if (wrongProjection.ok) throw new Error("expected wrong projection to fail")
  expect(wrongProjection.diagnostics[0].code).toBe("VIBE4100")
  expect(wrongProjection.diagnostics[0].message).toContain("missing")
})

interface WorkInput {
  readonly value: number
  readonly pair: readonly [string, true]
  readonly modes: readonly ("fast" | "safe")[]
  readonly label?: string
}
type WorkOutput = { readonly kind: "done"; readonly answer: number } |
  { readonly kind: "skipped"; readonly reason: string }

const structuralRuntime = (implementation: (input: WorkInput) => WorkOutput | Promise<WorkOutput>, options?: {
  readonly content?: boolean
}) => {
  const descriptor = compileWork()
  const Work = Action.fromDescriptor<WorkInput, WorkOutput>(descriptor)
  const flow = Flow.define<WorkInput, WorkOutput>({ id: "test/schema/Flow", version: 1 }, (input) => Work.run(input))
  const provider = Provider.provide(Work, implementation, {
    implementationId: "schema-work",
    implementationVersion: "1",
    ...(options?.content ? { reuse: { kind: "content" as const } } : {})
  })
  const deployment = Deployment.build({
    id: "test/schema/deployment",
    flow,
    pools: [Worker.pool("schema-worker", { target: "typescript-bun", providers: [provider] })]
  })
  return { descriptor, deployment }
}

const validInput: WorkInput = { value: 4, pair: ["x", true], modes: ["safe"] }

test("invalid structural input never invokes the provider", async () => {
  let calls = 0
  const { deployment } = structuralRuntime(() => {
    calls += 1
    return { kind: "done", answer: 8 }
  })
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    await expect(executor.execute(
      { ...validInput, value: "not-a-number" } as unknown as WorkInput,
      { executionId: "bad-structural-input" }
    )).rejects.toMatchObject({
      name: "DurableActionDefect",
      defect: { name: "InvocationCodecDefect" }
    })
    expect(calls).toBe(0)
  } finally {
    store.close()
  }
})

test("invalid success and failure outputs become defects and never populate reuse", async () => {
  let successCalls = 0
  const badSuccess = structuralRuntime(() => {
    successCalls += 1
    return { kind: "done", answer: "wrong" } as unknown as WorkOutput
  }, { content: true })
  const successStore = new DurableStore()
  try {
    const executor = new DurableExecutor(badSuccess.deployment, successStore)
    for (const executionId of ["bad-success-1", "bad-success-2"]) {
      await expect(executor.execute(validInput, { executionId })).rejects.toMatchObject({
        name: "DurableActionDefect",
        defect: { name: "SuccessCodecDefect" }
      })
    }
    expect(successCalls).toBe(2)
    expect(successStore.getNode("bad-success-1", badSuccess.deployment.flow.plan.nodes[0].id).exit?.kind).toBe("defect")
  } finally {
    successStore.close()
  }

  let failureCalls = 0
  const descriptor = compileWork()
  const Work = Action.fromDescriptor<WorkInput, WorkOutput>(descriptor)
  const flow = Flow.define<WorkInput, WorkOutput>({ id: "test/schema/FailureFlow", version: 1 }, (input) => Work.run(input))
  const provider = Provider.provide(Work, (): WorkOutput => {
    failureCalls += 1
    return fail({ version: 1, identity: "forged:error", payload: { field: "value" } })
  }, { implementationId: "bad-failure", implementationVersion: "1", reuse: { kind: "content" } })
  const deployment = Deployment.build({
    id: "test/schema/failure-deployment",
    flow,
    pools: [Worker.pool("schema-worker", { target: "typescript-bun", providers: [provider] })]
  })
  const failureStore = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, failureStore)
    for (const executionId of ["bad-failure-1", "bad-failure-2"]) {
      await expect(executor.execute(validInput, { executionId })).rejects.toMatchObject({
        name: "DurableActionDefect",
        defect: { name: "FailureCodecDefect" }
      })
    }
    expect(failureCalls).toBe(2)
  } finally {
    failureStore.close()
  }
})

test("nominal Error payloads use the provisional stable-identity envelope", async () => {
  const descriptor = compileWork()
  if (descriptor.errorSchema.shape !== "structural") throw new Error("expected structural Error schema")
  const union = descriptor.errorSchema.descriptor
  if (union.kind !== "union") throw new Error("expected Error union")
  const selected = union.variants.find((variant) => variant.kind === "error" && variant.name === "BadInput")
  if (selected?.kind !== "error") throw new Error("missing BadInput descriptor")
  const encoded = durableErrorPayload(descriptor.errorSchema, selected.identity, { field: "value" })
  expect(encoded).toEqual({ version: 1, identity: selected.identity, payload: { field: "value" } })

  const Work = Action.fromDescriptor<WorkInput, WorkOutput>(descriptor)
  const flow = Flow.define<WorkInput, WorkOutput>({ id: "test/schema/NominalFailureFlow", version: 1 }, (input) => Work.run(input))
  const provider = Provider.provide(Work, (): WorkOutput => fail(encoded), {
    implementationId: "nominal-failure",
    implementationVersion: "1"
  })
  const deployment = Deployment.build({
    id: "test/schema/nominal-failure-deployment",
    flow,
    pools: [Worker.pool("schema-worker", { target: "typescript-bun", providers: [provider] })]
  })
  const store = new DurableStore()
  try {
    await expect(new DurableExecutor(deployment, store).execute(validInput, { executionId: "nominal-failure" }))
      .rejects.toMatchObject({ name: "DurableActionFailure", failure: encoded })
    expect(store.getNode("nominal-failure", deployment.flow.plan.nodes[0].id).exit)
      .toMatchObject({ kind: "failure", error: encoded })
  } finally {
    store.close()
  }
})

test("the coordinator revalidates a hostile worker exit before persistence", async () => {
  let providerCalls = 0
  const { deployment } = structuralRuntime(() => {
    providerCalls += 1
    return { kind: "done", answer: 8 }
  })
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    const workers = (executor as unknown as { workers: Map<string, { invoke(): Promise<WorkerExit> }> }).workers
    const worker = workers.values().next().value!
    worker.invoke = async () => ({ kind: "success", value: { kind: "done", answer: "hostile" } }) as unknown as WorkerExit
    await expect(executor.execute(validInput, { executionId: "hostile-worker" })).rejects.toMatchObject({
      name: "DurableActionDefect",
      defect: { name: "SuccessCodecDefect" }
    })
    expect(providerCalls).toBe(0)
    expect(store.getNode("hostile-worker", deployment.flow.plan.nodes[0].id).exit?.kind).toBe("defect")

    worker.invoke = async () => ({
      kind: "defect",
      defect: { name: 42, message: "hostile protocol payload" }
    }) as unknown as WorkerExit
    await expect(executor.execute(validInput, { executionId: "hostile-worker-defect" })).rejects.toMatchObject({
      name: "DurableActionDefect",
      defect: { name: "WorkerProtocolCodecDefect" }
    })
    expect(store.getNode("hostile-worker-defect", deployment.flow.plan.nodes[0].id).exit)
      .toMatchObject({ kind: "defect", defect: { name: "WorkerProtocolCodecDefect" } })
  } finally {
    store.close()
  }
})

test("structural contracts survive artifact validation, restart, and content reuse", async () => {
  let calls = 0
  const { deployment } = structuralRuntime(({ value }) => {
    calls += 1
    return { kind: "done", answer: value * 2 }
  }, { content: true })
  const store = new DurableStore()
  try {
    expect(await new DurableExecutor(deployment, store).execute(validInput, { executionId: "structural-first" }))
      .toEqual({ kind: "done", answer: 8 })
    expect(await new DurableExecutor(deployment, store).execute(validInput, { executionId: "structural-first" }))
      .toEqual({ kind: "done", answer: 8 })
    expect(await new DurableExecutor(deployment, store).execute(validInput, { executionId: "structural-cache-hit" }))
      .toEqual({ kind: "done", answer: 8 })
    expect(calls).toBe(1)

    const tampered = JSON.parse(JSON.stringify(deployment.flow.plan))
    tampered.actions[0].inputSchema.descriptor.fields.find((field: { name: string }) => field.name === "value").value.kind = "string"
    expect(() => validatePlanTemplate(tampered)).toThrow(/schema digest mismatch/)
  } finally {
    store.close()
  }
})

test("static Flow input, success, and failure schemas are derived into Plan IR and enforced", async () => {
  const compiledAction = compileActionContract(`
    import { Action } from "vibelang:flows"
    interface Input { readonly value: number }
    interface Output { readonly value: number; readonly evidence: string }
    class Rejected extends Error { constructor(readonly code: string) { super(code) } }
    export abstract class Work extends Action<(input: Input) => Result<Output, Rejected>> {}
  `, {
    fileName: "contracts/flow-work.vibe",
    exportName: "Work",
    id: "test/schema/FlowWork",
    version: 1
  })
  if (!compiledAction.ok) throw new Error(JSON.stringify(compiledAction.diagnostics))
  const compiledFlow = compileDurableSource(`
    import { durable } from "vibelang:flows"
    import { Work } from "test:flow-actions"
    interface Input { readonly value: number }
    export const Checked = durable(function Checked(input: Input) {
      return Work.run(input).unwrap().value
    })
  `, {
    fileName: "flows/checked.vibe",
    flowId: "test/schema/CheckedFlow",
    flowVersion: 1,
    actions: [{
      moduleSpecifier: "test:flow-actions",
      exportName: "Work",
      descriptor: compiledAction.descriptor
    }]
  })
  if (!compiledFlow.ok) throw new Error(JSON.stringify(compiledFlow.diagnostics))
  expect(compiledFlow.plan.flowSchemas?.input.shape).toBe("structural")
  expect(compiledFlow.plan.flowSchemas?.success).toMatchObject({
    shape: "structural",
    descriptor: { kind: "number" }
  })
  expect(compiledFlow.plan.flowSchemas?.error?.shape).toBe("structural")
  expect(validatePlanTemplate(compiledFlow.plan).flowSchemas).toEqual(compiledFlow.plan.flowSchemas)

  const Work = Action.fromDescriptor<{ value: number }, { value: number; evidence: string }>(
    compiledAction.descriptor
  )
  let calls = 0
  const Live = Provider.provide(Work, ({ value }) => {
    calls += 1
    return { value: value * 2, evidence: "worker" }
  }, {
    implementationId: "flow-schema-worker",
    implementationVersion: "1"
  })
  const deployment = Deployment.build({
    id: "flow-schema-deployment",
    flow: compiledFlow.flow,
    pools: [Worker.pool("flow-schema", { target: "typescript-bun", providers: [Live] })]
  })
  const store = new DurableStore()
  try {
    await expect(new DurableExecutor(deployment, store).execute(
      { value: "wrong", extra: true } as unknown as { value: number },
      { executionId: "invalid-flow-input" }
    )).rejects.toMatchObject({
      name: "DurableActionDefect",
      defect: { name: "FlowInputCodecDefect" }
    })
    expect(() => store.getExecution("invalid-flow-input")).toThrow("Unknown durable execution")
    expect(calls).toBe(0)
    expect(await new DurableExecutor(deployment, store).execute(
      { value: 4 },
      { executionId: "valid-flow" }
    )).toBe(8)
    expect(calls).toBe(1)
  } finally {
    store.close()
  }

  class HostileConcurrentWinnerStore extends DurableStore {
    override completeExecution(executionId: string, output: Parameters<DurableStore["completeExecution"]>[1]) {
      // Model another coordinator committing canonical JSON that violates this
      // Flow's structural success contract just before our final CAS.
      super.completeExecution(executionId, "forged")
      return super.completeExecution(executionId, output)
    }
  }
  const hostileStore = new HostileConcurrentWinnerStore()
  try {
    await expect(new DurableExecutor(deployment, hostileStore).execute(
      { value: 5 },
      { executionId: "hostile-flow-winner" }
    )).rejects.toMatchObject({
      name: "DurableActionDefect",
      defect: { name: "PersistedFlowCodecDefect" }
    })
    expect(hostileStore.getExecution("hostile-flow-winner")).toMatchObject({
      status: "completed",
      output: "forged"
    })
    await expect(new DurableExecutor(deployment, hostileStore).execute(
      { value: 5 },
      { executionId: "hostile-flow-winner" }
    )).rejects.toMatchObject({
      defect: { name: "PersistedFlowCodecDefect" }
    })
  } finally {
    hostileStore.close()
  }

  if (compiledAction.descriptor.errorSchema.shape !== "structural" ||
    compiledAction.descriptor.errorSchema.descriptor.kind !== "error") {
    throw new Error("expected one structural Rejected error schema")
  }
  const rejected = durableErrorPayload(
    compiledAction.descriptor.errorSchema,
    compiledAction.descriptor.errorSchema.descriptor.identity,
    { code: "expected" }
  )
  const FailureLive = Provider.provide(Work, (): { value: number; evidence: string } => fail(rejected), {
    implementationId: "flow-schema-failure-worker",
    implementationVersion: "1"
  })
  const failureDeployment = Deployment.build({
    id: "flow-schema-failure-deployment",
    flow: compiledFlow.flow,
    pools: [Worker.pool("flow-schema-failure", { target: "typescript-bun", providers: [FailureLive] })]
  })
  class HostileConcurrentFailureStore extends DurableStore {
    override failExecution(
      executionId: string,
      category: Parameters<DurableStore["failExecution"]>[1],
      error: Parameters<DurableStore["failExecution"]>[2]
    ) {
      if (category === "failure") {
        // Model a coherent but schema-invalid typed failure committed by an
        // older/hostile coordinator just before this coordinator's CAS.
        super.failExecution(executionId, "failure", "forged")
      }
      return super.failExecution(executionId, category, error)
    }
  }
  const hostileFailureStore = new HostileConcurrentFailureStore()
  try {
    await expect(new DurableExecutor(failureDeployment, hostileFailureStore).execute(
      { value: 5 },
      { executionId: "hostile-flow-failure" }
    )).rejects.toMatchObject({
      name: "DurableActionDefect",
      defect: { name: "PersistedFlowCodecDefect" }
    })
    expect(hostileFailureStore.getExecution("hostile-flow-failure")).toMatchObject({
      status: "failed",
      error: { category: "failure", error: "forged" }
    })
    await expect(new DurableExecutor(failureDeployment, hostileFailureStore).execute(
      { value: 5 },
      { executionId: "hostile-flow-failure" }
    )).rejects.toMatchObject({
      defect: { name: "PersistedFlowCodecDefect" }
    })
  } finally {
    hostileFailureStore.close()
  }

  const unsupported = compileDurableSource(`
    import { durable } from "vibelang:flows"
    import { Work } from "test:flow-actions"
    export const Unsafe = durable(function Unsafe(input: { callback: () => string }) {
      return Work.run({ value: 1 }).unwrap().value
    })
  `, {
    fileName: "flows/unsafe.vibe",
    actions: [{
      moduleSpecifier: "test:flow-actions",
      exportName: "Work",
      descriptor: compiledAction.descriptor
    }]
  })
  expect(unsupported.ok).toBe(false)
  if (unsupported.ok) throw new Error("expected non-durable Flow input to fail")
  expect(unsupported.diagnostics[0]).toMatchObject({ code: "VIBE4110" })
  expect(unsupported.diagnostics[0].message).toContain("executable")
})
