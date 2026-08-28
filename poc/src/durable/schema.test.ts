import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  buildWorkerPoolBundle,
  compileActionContract,
  compileActionImplementationContract,
  compileDurableSource,
  decodeWorkerExit,
  Deployment,
  digest,
  DurableActionDefect,
  DurableExecutor,
  DurableStore,
  fail,
  Flow,
  Provider,
  structuralSchema,
  validatePlanTemplate,
  Worker,
  type ActionDescriptor,
  type ActionRouteManifest,
  durableErrorPayload,
  type DurableSchema,
  type DurableTypeDescriptor,
  type WorkerExit,
  type WorkerExitSurface
} from "./index.ts"
import { derivedSchema } from "./ir.ts"

const representativeContract = `
import { Action } from "smithers:flows"

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
    fileName: "contracts/work.sm",
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
    import { Action as DurableAction } from "smithers:flows"
    interface Input { value: boolean | null }
    interface Output { value: string }
    class Failure extends Error { declare readonly code: "failed" }
    export abstract class Renamed extends DurableAction<(input: Input) => Result<Output, Failure>> {}
  `, { fileName: "alias.sm", exportName: "Renamed", id: "test/Renamed", version: 1 })
  expect(aliased.ok).toBe(true)

  const namespaced = compileActionContract(`
    import * as Flows from "smithers:flows"
    class Failure extends Error {}
    export abstract class Namespaced extends Flows.Action<(input: string) => Result<number, Failure>> {}
  `, { fileName: "namespace.sm", exportName: "Namespaced", id: "test/Namespaced", version: 1 })
  expect(namespaced.ok).toBe(true)

  const impostor = compileActionContract(`
    class Action<Signature> {}
    class Failure extends Error {}
    export abstract class Renamed extends Action<(input: string) => Result<string, Failure>> {}
  `, { fileName: "impostor.sm", exportName: "Renamed", id: "test/Renamed", version: 1 })
  expect(impostor.ok).toBe(false)
  if (impostor.ok) throw new Error("expected compiler identity failure")
  expect(impostor.diagnostics[0].code).toBe("SMITHERS4202")

  const resultImpostor = compileActionContract(`
    import { Action } from "smithers:flows"
    type Result<A, E> = { success: A; failure: E }
    class Failure extends Error {}
    export abstract class Renamed extends Action<(input: string) => Result<number, Failure>> {}
  `, { fileName: "result-impostor.sm", exportName: "Renamed", id: "test/Renamed", version: 1 })
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
      import { Action } from "smithers:flows"
      interface Box<T> { readonly value: T }
      interface Recursive { readonly next?: Recursive }
      class Context {}
      class Clock extends Context { now(): number { return 0 } }
      class Failure extends Error {}
      export abstract class Unsafe extends Action<(input: ${input}) => Result<string, Failure>> {}
    `, { fileName: `unsafe-${expected}.sm`, exportName: "Unsafe", id: "test/Unsafe", version: 1 })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error(`expected ${input} to fail`)
    expect(result.diagnostics[0].code).toBe("SMITHERS4203")
    expect(result.diagnostics[0].message).toContain(expected)
    expect(result.diagnostics[0].line).toBeGreaterThan(0)
    expect(result.diagnostics[0].column).toBeGreaterThan(0)
  }

  const nestedReturn = compileActionContract(`
    import { Action } from "smithers:flows"
    class Failure extends Error {}
    export abstract class Unsafe extends Action<
      (input: string) => Promise<Promise<Result<string, Failure>>>
    > {}
  `, { fileName: "nested-return.sm", exportName: "Unsafe", id: "test/Unsafe", version: 1 })
  expect(nestedReturn.ok).toBe(false)
  if (nestedReturn.ok) throw new Error("expected nested return Promise to fail")
  expect(nestedReturn.diagnostics[0].message).toContain("nested Promise")

  const infallible = compileActionContract(`
    import { Action } from "smithers:flows"
    export abstract class Plain extends Action<(input: string) => string> {}
  `, { fileName: "plain.sm", exportName: "Plain", id: "test/Plain", version: 1 })
  expect(infallible.ok).toBe(false)
  if (infallible.ok) throw new Error("expected bounded infallible Action form to fail")
  expect(infallible.diagnostics[0].message).toContain("must return Result")

  const generic = compileActionContract(`
    import { Action } from "smithers:flows"
    class Failure extends Error {}
    export abstract class Generic<T> extends Action<(input: T) => Result<string, Failure>> {}
  `, { fileName: "generic.sm", exportName: "Generic", id: "test/Generic", version: 1 })
  expect(generic.ok).toBe(false)
  if (generic.ok) throw new Error("expected generic Action form to fail")
  expect(generic.diagnostics[0].message).toContain("generic")

  const structuralErrorImpostor = compileActionContract(`
    import { Action } from "smithers:flows"
    class LooksLikeError { name = "LooksLikeError"; message = "not nominal" }
    export abstract class Unsafe extends Action<(input: string) => Result<string, LooksLikeError>> {}
  `, { fileName: "error-impostor.sm", exportName: "Unsafe", id: "test/Unsafe", version: 1 })
  expect(structuralErrorImpostor.ok).toBe(false)
  if (structuralErrorImpostor.ok) throw new Error("expected structural Error impostor to fail")
  expect(structuralErrorImpostor.diagnostics[0].message).toContain("does not extend Error")
})

test("descriptor depth, node, field, and union budgets fail deterministically", () => {
  const nested = ["interface Depth0 { readonly value: string }"]
  for (let index = 1; index < 70; index++) nested.push(`interface Depth${index} { readonly next: Depth${index - 1} }`)
  const deep = compileActionContract(`
    import { Action } from "smithers:flows"
    ${nested.join("\n")}
    class Failure extends Error {}
    export abstract class Deep extends Action<(input: Depth69) => Result<string, Failure>> {}
  `, { fileName: "deep.sm", exportName: "Deep", id: "test/Deep", version: 1 })
  expect(deep.ok).toBe(false)
  if (deep.ok) throw new Error("expected deep descriptor to fail")
  expect(deep.diagnostics[0].message).toContain("depth limit")

  const fields = Array.from({ length: 1_025 }, (_, index) => `readonly field${index}: string`).join(";")
  const wide = compileActionContract(`
    import { Action } from "smithers:flows"
    interface Wide { ${fields} }
    class Failure extends Error {}
    export abstract class WideAction extends Action<(input: Wide) => Result<string, Failure>> {}
  `, { fileName: "wide.sm", exportName: "WideAction", id: "test/Wide", version: 1 })
  expect(wide.ok).toBe(false)
  if (wide.ok) throw new Error("expected wide descriptor to fail")
  expect(wide.diagnostics[0].message).toContain("field limit")

  const variants = Array.from({ length: 129 }, (_, index) => JSON.stringify(`variant-${index}`)).join(" | ")
  const union = compileActionContract(`
    import { Action } from "smithers:flows"
    class Failure extends Error {}
    export abstract class UnionAction extends Action<(input: ${variants}) => Result<string, Failure>> {}
  `, { fileName: "union.sm", exportName: "UnionAction", id: "test/Union", version: 1 })
  expect(union.ok).toBe(false)
  if (union.ok) throw new Error("expected wide union to fail")
  expect(union.diagnostics[0].message).toContain("variant limit")
})

test("typed synthetic Action declarations reject wrong inputs and projections", () => {
  const descriptor = compileWork()
  const binding = [{ moduleSpecifier: "test:typed-actions", exportName: "Work", descriptor }]
  const wrongInput = compileDurableSource(`
    import { durable } from "smithers:flows"
    import { Work } from "test:typed-actions"
    export const Bad = durable(function Bad(input: { value: number }) {
      return Work.run({ value: "wrong", pair: ["x", true], modes: ["safe"] })
    })
  `, { fileName: "wrong-input.sm", flowId: "test/WrongInput", flowVersion: 1, actions: binding })
  expect(wrongInput.ok).toBe(false)
  if (wrongInput.ok) throw new Error("expected wrong Action input to fail")
  expect(wrongInput.diagnostics[0].code).toBe("SMITHERS4100")
  expect(wrongInput.diagnostics[0].message).toMatch(/string.*number|number.*string/)

  const wrongProjection = compileDurableSource(`
    import { durable } from "smithers:flows"
    import { Work } from "test:typed-actions"
    export const Bad = durable(function Bad(input: { value: number }) {
      const output = Work.run({ value: input.value, pair: ["x", true], modes: ["fast"] })!
      return output.missing
    })
  `, { fileName: "wrong-projection.sm", flowId: "test/WrongProjection", flowVersion: 1, actions: binding })
  expect(wrongProjection.ok).toBe(false)
  if (wrongProjection.ok) throw new Error("expected wrong projection to fail")
  expect(wrongProjection.diagnostics[0].code).toBe("SMITHERS4100")
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
    // A hostile TRANSPORT, injected the supported way. This used to reassign
    // `invoke` on the executor's live LocalWorker; the worker transports are
    // frozen after admission now (their public provider table and pinned
    // digests are what they authenticate against), so a custom transport is
    // both the honest spelling and the exact shape this test is about.
    const worker: { invoke: () => Promise<WorkerExit> } = {
      invoke: async () => ({ kind: "success", value: { kind: "done", answer: "hostile" } }) as unknown as WorkerExit
    }
    const executor = new DurableExecutor(deployment, store, { workerFactory: () => worker })
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
    import { Action } from "smithers:flows"
    interface Input { readonly value: number }
    interface Output { readonly value: number; readonly evidence: string }
    class Rejected extends Error { constructor(readonly code: string) { super(code) } }
    export abstract class Work extends Action<(input: Input) => Result<Output, Rejected>> {}
  `, {
    fileName: "contracts/flow-work.sm",
    exportName: "Work",
    id: "test/schema/FlowWork",
    version: 1
  })
  if (!compiledAction.ok) throw new Error(JSON.stringify(compiledAction.diagnostics))
  const compiledFlow = compileDurableSource(`
    import { durable } from "smithers:flows"
    import { Work } from "test:flow-actions"
    interface Input { readonly value: number }
    export const Checked = durable(function Checked(input: Input) {
      return Work.run(input)!.value
    })
  `, {
    fileName: "flows/checked.sm",
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
    import { durable } from "smithers:flows"
    import { Work } from "test:flow-actions"
    export const Unsafe = durable(function Unsafe(input: { callback: () => string }) {
      return Work.run({ value: 1 })!.value
    })
  `, {
    fileName: "flows/unsafe.sm",
    actions: [{
      moduleSpecifier: "test:flow-actions",
      exportName: "Work",
      descriptor: compiledAction.descriptor
    }]
  })
  expect(unsupported.ok).toBe(false)
  if (unsupported.ok) throw new Error("expected non-durable Flow input to fail")
  expect(unsupported.diagnostics[0]).toMatchObject({ code: "SMITHERS4110" })
  expect(unsupported.diagnostics[0].message).toContain("executable")
})

test("the underivable-failure refusal is reachable and is what the standalone contract compiler does", () => {
  // This guard is NOT dead code. `deriveActionContract` has two callers:
  // `compileActionContract` here, which never sets `weakenUnderivableErrors`
  // and therefore refuses every underivable failure channel, and the durable
  // source compiler, which sets it and reaches the weakening only for a channel
  // that is wholly the built-in `Error`.
  const refusalFor = (errorType: string) => {
    const compiled = compileActionContract(`
      import { Action } from "smithers:flows"
      class Failure extends Error {}
      class LooksLikeError { name = "LooksLikeError"; message = "not nominal" }
      export abstract class Work extends Action<(input: string) => Result<string, ${errorType}>> {}
    `, { fileName: "underivable.sm", exportName: "Work", id: "test/Work", version: 1 })
    return compiled.ok ? { ok: true as const, shape: compiled.descriptor.errorSchema.shape } : {
      ok: false as const,
      code: compiled.diagnostics[0].code,
      message: compiled.diagnostics[0].message
    }
  }

  // The built-in `Error` is refused HERE even though the durable source
  // compiler weakens it. The two entry points differ on exactly one channel,
  // deliberately, and on nothing else.
  const builtIn = refusalFor("Error")
  expect(builtIn.ok).toBe(false)
  if (builtIn.ok) throw new Error("expected the built-in Error channel to fail closed here")
  expect(builtIn.code).toBe("SMITHERS4203")
  expect(builtIn.message).toContain("must be an ordinary named class extending Error")

  // `any` and a structural impostor are refused on BOTH entry points.
  const anyChannel = refusalFor("any")
  expect(anyChannel.ok).toBe(false)
  if (anyChannel.ok) throw new Error("expected an any failure channel to fail closed")
  expect(anyChannel.message).toContain("must name a concrete Error class or union")

  const impostor = refusalFor("LooksLikeError")
  expect(impostor.ok).toBe(false)
  if (impostor.ok) throw new Error("expected a structural Error impostor to fail closed")
  expect(impostor.message).toContain("does not extend Error")

  // A nominal failure class still derives a structural contract.
  expect(refusalFor("Failure")).toEqual({ ok: true, shape: "structural" })
})

const COLLIDE_FILE = "contracts/collide.sm"

const compileCollisionContract = (body: string, id: string, fileName = COLLIDE_FILE) =>
  compileActionContract(
    `import { Action } from "smithers:flows"\n${body}`,
    { fileName, exportName: "Work", id, version: 1 }
  )

/**
 * Build the real worker pool bundle for one contract and EXECUTE it, returning
 * what each invocation actually produced. A compile-only assertion cannot see
 * this defect: the broken contract type-checked, built, and only then proved
 * unable to report the failure it declared.
 */
const runDeclaredFailures = async (
  descriptor: ActionDescriptor,
  implementationSource: string,
  modes: readonly string[]
): Promise<readonly unknown[]> => {
  const contract = compileActionImplementationContract({
    action: descriptor,
    implementationId: "schema-collision",
    implementationVersion: "1",
    entryFile: COLLIDE_FILE,
    exportName: "work",
    implementation: ((input: { mode: string }) => {
      if (input.mode !== "ok") fail({ version: 1, identity: "unused", payload: {} })
      return { value: 1 }
    }) as never,
    sources: [{ fileName: COLLIDE_FILE, source: implementationSource }]
  })
  const bundle = buildWorkerPoolBundle({
    poolId: "schema-collision-pool",
    target: "typescript-bun",
    sandbox: "remote-http-poc",
    selections: [{ action: descriptor, contract }]
  })
  const directory = mkdtempSync(join(tmpdir(), "smithers-schema-collision-"))
  try {
    const modulePath = join(directory, `${digest({ javascript: bundle.javascript }).slice(0, 16)}.mjs`)
    writeFileSync(modulePath, bundle.javascript, "utf8")
    const loaded = await import(modulePath)
    const outcomes: unknown[] = []
    for (const mode of modes) {
      outcomes.push(await loaded.__smithersInvokeAction({
        schemaVersion: 1,
        executionId: "schema-collision",
        nodeId: "n1",
        attempt: 1,
        actionId: descriptor.id,
        actionVersion: descriptor.version,
        actionContractDigest: descriptor.contractDigest,
        input: { mode },
        deadline: Date.now() + 10_000,
        downstreamIdempotencyKey: digest({ mode }),
        capabilityGrant: [],
        lease: { owner: "test", expiresAt: Date.now() + 10_000 },
        fencingToken: 1,
        traceContext: {}
      }))
    }
    return outcomes
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test("distinct Error classes may not collapse onto one durable failure identity, and an accepted contract still emits every failure it declares", async () => {
  // `stableIdentity` is a function of (logical source file, class name) ONLY.
  // Every spelling below smuggles two DIFFERENT Error classes into one failure
  // channel under one identity. Each was accepted before this guard existed.
  const collisions = [
    ["sibling namespaces, different payloads", `
namespace Left  { export class Failed extends Error { constructor(readonly code: string) { super(code) } } }
namespace Right { export class Failed extends Error { constructor(readonly reason: string) { super(reason) } } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Left.Failed | Right.Failed>> {}`],
    ["sibling namespaces, identical payloads", `
namespace Left  { export class Failed extends Error { constructor(readonly code: string) { super(code) } } }
namespace Right { export class Failed extends Error { constructor(readonly code: string) { super(code) } } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Left.Failed | Right.Failed>> {}`],
    ["top-level class beside a same-named namespaced one", `
class Failed extends Error { constructor(readonly code: string) { super(code) } }
namespace N { export class Failed extends Error { constructor(readonly reason: string) { super(reason) } } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Failed | N.Failed>> {}`],
    ["nested namespaces", `
namespace A { export namespace B { export class Failed extends Error { constructor(readonly code: string) { super(code) } } } }
namespace C { export class Failed extends Error { constructor(readonly reason: string) { super(reason) } } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, A.B.Failed | C.Failed>> {}`],
    ["a subclass shadowing its own base class name", `
class Failed extends Error { constructor(readonly code: string) { super(code) } }
const Base = Failed
namespace N { export class Failed extends Base { constructor(readonly reason: string) { super(reason) } } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Failed | N.Failed>> {}`],
    // Distinct NAMES, one identity: `stableIdentity` normalizes every character
    // outside [A-Za-z0-9._/@:+-] to `_`, so `$Failed` and `_Failed` are one
    // identity. This spelling was not merely unimplementable — it built, ran,
    // and emitted two different payloads under a single wire identity.
    ["two names that normalize to one identity", `
class $Failed extends Error { constructor(readonly code: string) { super(code) } }
class _Failed extends Error { constructor(readonly reason: string) { super(reason) } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, $Failed | _Failed>> {}`]
  ] as const

  for (const [label, body] of collisions) {
    const compiled = compileCollisionContract(body, `test/schema/collide/${label}`)
    expect(compiled.ok, label).toBe(false)
    if (compiled.ok) throw new Error(`expected ${label} to fail closed`)
    expect(compiled.diagnostics.length, label).toBe(1)
    expect(compiled.diagnostics[0].code, label).toBe("SMITHERS4203")
    expect(compiled.diagnostics[0].message, label).toContain("shares durable failure identity")
    expect(compiled.diagnostics[0].file, label).toBe(COLLIDE_FILE)
    // Located, not file-scoped: the diagnostic lands on the Action signature
    // that declares the colliding failure channel, not on the whole file.
    const lines = `import { Action } from "smithers:flows"\n${body}`.split("\n")
    expect(lines[compiled.diagnostics[0].line - 1], label).toContain("extends Action")
  }

  // The EXECUTED half. `$Failed | _Failed` is the one collision spelling that
  // survives every downstream gate — the implementation closure holds two
  // differently-named classes, so the nominal failure schema matches and a
  // bundle builds. Before the guard this ran and returned two different
  // payloads under ONE identity, which is a wrong answer no compile-time
  // assertion can see. If the refusal is ever relaxed, this executes the bundle
  // and fails on the identity that comes back.
  const normalizing = compileCollisionContract(`
class $Failed extends Error { constructor(readonly code: string) { super(code) } }
class _Failed extends Error { constructor(readonly reason: string) { super(reason) } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, $Failed | _Failed>> {}`,
    "test/schema/collide/executed")
  if (normalizing.ok) {
    const outcomes = await runDeclaredFailures(normalizing.descriptor, `
class $Failed extends Error { constructor(readonly code: string) { super(code) } }
class _Failed extends Error { constructor(readonly reason: string) { super(reason) } }
export function work(input: { mode: string }): Result<{ value: number }, $Failed | _Failed> {
  if (input.mode === "dollar") throw new $Failed("boom")
  if (input.mode === "under") throw new _Failed("bang")
  return { value: 1 }
}`, ["dollar", "under"])
    const identities = outcomes.map((outcome) => (outcome as { error?: { identity?: string } }).error?.identity)
    expect(new Set(identities).size, `two declared Error classes must not share a wire identity: ${JSON.stringify(outcomes)}`)
      .toBe(identities.length)
  }

  // BOTH DIRECTIONS, by execution: a contract whose failures have distinct
  // identities still compiles, still builds, and still delivers each declared
  // typed failure with its own identity and payload.
  const accepted = compileCollisionContract(`
class NotFound extends Error { constructor(readonly path: string) { super(path) } }
class Denied extends Error { constructor(readonly who: string) { super(who) } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, NotFound | Denied>> {}`,
    "test/schema/collide/accepted")
  expect(accepted.ok).toBe(true)
  if (!accepted.ok) throw new Error(accepted.diagnostics.map((diagnostic) => diagnostic.message).join("\n"))
  expect(await runDeclaredFailures(accepted.descriptor, `
class NotFound extends Error { constructor(readonly path: string) { super(path) } }
class Denied extends Error { constructor(readonly who: string) { super(who) } }
export function work(input: { mode: string }): Result<{ value: number }, NotFound | Denied> {
  if (input.mode === "missing") throw new NotFound("/tmp/x")
  if (input.mode === "denied") throw new Denied("root")
  return { value: 1 }
}`, ["missing", "denied", "ok"])).toEqual([
    { kind: "failure", error: { version: 1, identity: `smithers:${COLLIDE_FILE}_NotFound@1`, payload: { path: "/tmp/x" } } },
    { kind: "failure", error: { version: 1, identity: `smithers:${COLLIDE_FILE}_Denied@1`, payload: { who: "root" } } },
    { kind: "success", value: { value: 1 } }
  ])
})

test("one Error class reached through several spellings is not a collision", () => {
  // The guard keys on the class DECLARATION, not on the identity string alone,
  // so every way of naming one class twice must still compile. Refusing these
  // would be the over-correction.
  const benign = [
    ["the same class twice in one union", `
class Failed extends Error { constructor(readonly code: string) { super(code) } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Failed | Failed>> {}`, 1],
    ["a class and a type alias of it", `
class Failed extends Error { constructor(readonly code: string) { super(code) } }
type Alias = Failed
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Failed | Alias>> {}`, 1],
    ["a namespaced class and an import-equals alias of it", `
namespace N { export class Failed extends Error { constructor(readonly code: string) { super(code) } } }
import Aliased = N.Failed
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, N.Failed | Aliased>> {}`, 1],
    ["a namespaced class as the only failure", `
namespace N { export class Failed extends Error { constructor(readonly code: string) { super(code) } } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, N.Failed>> {}`, 1],
    ["two differently-named namespaced classes", `
namespace Left  { export class Failed extends Error { constructor(readonly code: string) { super(code) } } }
namespace Right { export class Denied extends Error { constructor(readonly reason: string) { super(reason) } } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Left.Failed | Right.Denied>> {}`, 2],
    ["a subclass declared beside its parent under a distinct name", `
class Base extends Error { constructor(readonly code: string) { super(code) } }
class Derived extends Base { constructor(code: string, readonly extra: number) { super(code) } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Base | Derived>> {}`, 2],
    ["a leading-underscore class name", `
class _Failed extends Error { constructor(readonly code: string) { super(code) } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, _Failed>> {}`, 1]
  ] as const

  for (const [label, body, expectedIdentities] of benign) {
    const compiled = compileCollisionContract(body, `test/schema/benign/${label}`)
    expect(compiled.ok, label).toBe(true)
    if (!compiled.ok) throw new Error(`${label}: ${compiled.diagnostics.map((d) => d.message).join("\n")}`)
    const identities = new Set(
      [...JSON.stringify(compiled.descriptor.errorSchema).matchAll(/"identity":"([^"]*)"/g)].map((match) => match[1])
    )
    expect(identities.size, label).toBe(expectedIdentities)
  }

  // Two same-named classes in DIFFERENT logical files stay distinct: identity
  // is (file, name), and the file half is what separates them.
  const first = compileCollisionContract(`
class Failed extends Error { constructor(readonly code: string) { super(code) } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Failed>> {}`,
    "test/schema/file-a/Work", "contracts/a.sm")
  const second = compileCollisionContract(`
class Failed extends Error { constructor(readonly code: string) { super(code) } }
export abstract class Work extends Action<(input: { mode: string }) => Result<{ value: number }, Failed>> {}`,
    "test/schema/file-b/Work", "contracts/b.sm")
  expect(first.ok && second.ok).toBe(true)
  if (!first.ok || !second.ok) throw new Error("expected both single-file contracts to compile")
  expect(JSON.stringify(first.descriptor.errorSchema)).toContain("smithers:contracts/a.sm_Failed@1")
  expect(JSON.stringify(second.descriptor.errorSchema)).toContain("smithers:contracts/b.sm_Failed@1")
  expect(first.descriptor.errorSchema.digest).not.toBe(second.descriptor.errorSchema.digest)
})

// ---------------------------------------------------------------------------
// One WorkerExit decoder, two surfaces.
//
// `engine.ts#validateWorkerExit` and `worker-host.ts#validateBundleExit` used to
// spell this whole walk out twice. They agreed on every shape but one: the
// coordinator normalized with a bare `assertJson`, which has no size limit, so
// it ADMITTED an exit over the canonical 8 MiB bound that the bundle host
// refused. An admitted over-size exit does not survive — `commitSuccess`
// canonicalizes it — so the coordinator turned a clean protocol defect into an
// uncaught store error. These tests pin both directions of the merge.
const exitRoute = (success: DurableSchema, error: DurableSchema): ActionRouteManifest => ({
  actionId: "test/schema/ExitAction",
  actionVersion: 1,
  actionContractDigest: "contract-digest",
  poolId: "pool",
  artifactDigest: "artifact-digest",
  implementationDigest: "implementation-digest",
  implementationContract: null,
  policyDigest: "policy-digest",
  policy: { retry: null, timeoutMs: null } as unknown as ActionRouteManifest["policy"],
  schemas: { input: derivedSchema("input"), success, error }
})

const WORKER: WorkerExitSurface = { label: "worker", protocolDefectName: "WorkerProtocolCodecDefect" }
const BUNDLE: WorkerExitSurface = { label: "bundle", protocolDefectName: "BundleProtocolDefect" }

test("decodeWorkerExit accepts every well-formed exit and preserves the defect payload", () => {
  const route = exitRoute(derivedSchema("success"), derivedSchema("error"))
  for (const surface of [WORKER, BUNDLE]) {
    expect(decodeWorkerExit(route, { kind: "success", value: { a: 1 } }, surface))
      .toEqual({ kind: "success", value: { a: 1 } })
    expect(decodeWorkerExit(route, { kind: "success", value: null }, surface))
      .toEqual({ kind: "success", value: null })
    expect(decodeWorkerExit(route, { kind: "failure", error: { code: "E" } }, surface))
      .toEqual({ kind: "failure", error: { code: "E" } })
    // both defect-payload key sets: the two-element and the three-element one
    expect(decodeWorkerExit(route, { kind: "defect", defect: { name: "N", message: "M" } }, surface))
      .toEqual({ kind: "defect", defect: { name: "N", message: "M" } })
    expect(decodeWorkerExit(route, { kind: "defect", defect: { name: "N", message: "M", stack: "S" } }, surface))
      .toEqual({ kind: "defect", defect: { name: "N", message: "M", stack: "S" } })
    // an absent stack must not become a present `stack: undefined` key
    expect("stack" in (decodeWorkerExit(route, { kind: "defect", defect: { name: "N", message: "M" } }, surface) as {
      defect: Record<string, unknown>
    }).defect).toBe(false)
  }
})

test("decodeWorkerExit refuses every malformed exit and never throws", () => {
  const route = exitRoute(derivedSchema("success"), derivedSchema("error"))
  const refused: readonly (readonly [string, unknown, string])[] = [
    ["extra key on success", { kind: "success", value: 1, extra: 2 }, "SuccessCodecDefect"],
    ["missing value", { kind: "success" }, "SuccessCodecDefect"],
    ["extra key on failure", { kind: "failure", error: 1, extra: 2 }, "FailureCodecDefect"],
    ["failure carrying value", { kind: "failure", value: 1 }, "FailureCodecDefect"],
    ["extra key on defect exit", { kind: "defect", defect: { name: "N", message: "M" }, extra: 1 }, "PROTOCOL"],
    ["extra key in defect payload", { kind: "defect", defect: { name: "N", message: "M", extra: 1 } }, "PROTOCOL"],
    ["defect payload with a non-string name", { kind: "defect", defect: { name: 42, message: "M" } }, "PROTOCOL"],
    ["defect payload with a non-string message", { kind: "defect", defect: { name: "N", message: 42 } }, "PROTOCOL"],
    ["defect payload with a non-string stack", { kind: "defect", defect: { name: "N", message: "M", stack: 1 } }, "PROTOCOL"],
    ["defect payload missing name", { kind: "defect", defect: { message: "M" } }, "PROTOCOL"],
    ["defect payload that is null", { kind: "defect", defect: null }, "PROTOCOL"],
    ["defect payload that is an array", { kind: "defect", defect: [] }, "PROTOCOL"],
    ["unknown kind", { kind: "other", value: 1 }, "PROTOCOL"],
    ["missing kind", { value: 1 }, "PROTOCOL"],
    ["null", null, "PROTOCOL"],
    ["undefined", undefined, "PROTOCOL"],
    ["an array", [], "PROTOCOL"],
    ["a string", "success", "PROTOCOL"],
    ["a class instance", new Error("hostile"), "PROTOCOL"],
    // Non-durable JSON is refused while the exit is being normalized, i.e.
    // before `kind` has been read, so it is a protocol defect and not a
    // success-codec one. Both original decoders agreed on this.
    ["a non-finite success value", { kind: "success", value: Number.NaN }, "PROTOCOL"],
    ["an undefined success value", { kind: "success", value: undefined }, "PROTOCOL"],
    ["a cyclic success value", (() => { const a: Record<string, unknown> = { kind: "success" }; a.value = a; return a })(), "PROTOCOL"]
  ]
  for (const surface of [WORKER, BUNDLE]) {
    for (const [label, value, expected] of refused) {
      const exit = decodeWorkerExit(route, value, surface)
      const name = expected === "PROTOCOL" ? surface.protocolDefectName : expected
      expect(exit.kind, `${surface.label}: ${label}`).toBe("defect")
      expect(exit.kind === "defect" && exit.defect.name, `${surface.label}: ${label}`).toBe(name)
    }
  }
  // A prototype-polluted exit keeps `__proto__` as data, so it is an extra key,
  // not a hijacked prototype: refused, and nothing is mutated.
  const polluted: Record<string, unknown> = {}
  Object.defineProperty(polluted, "__proto__", { value: "polluted", enumerable: true, writable: true, configurable: true })
  polluted.kind = "success"
  polluted.value = 1
  const exit = decodeWorkerExit(route, polluted, WORKER)
  expect(exit).toMatchObject({ kind: "defect", defect: { name: "SuccessCodecDefect" } })
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
})

test("decodeWorkerExit refuses an exit over the canonical 8 MiB bound at BOTH surfaces", () => {
  const route = exitRoute(derivedSchema("success"), derivedSchema("error"))
  const oversize = "x".repeat(9 * 1024 * 1024)
  for (const surface of [WORKER, BUNDLE]) {
    for (const value of [
      { kind: "success", value: oversize },
      { kind: "failure", error: oversize },
      { kind: "defect", defect: { name: "N", message: oversize } }
    ]) {
      const exit = decodeWorkerExit(route, value, surface)
      expect(exit, `${surface.label}: ${value.kind}`).toMatchObject({
        kind: "defect",
        defect: { name: surface.protocolDefectName }
      })
      expect(exit.kind === "defect" && exit.defect.message).toContain("canonical message size limit")
    }
  }
  // and the bound is not so tight that an ordinary large exit is refused
  expect(decodeWorkerExit(route, { kind: "success", value: "y".repeat(1024 * 1024) }, WORKER).kind).toBe("success")
})

test("decodeWorkerExit applies the route's structural schemas to success and failure", () => {
  const route = exitRoute(
    structuralSchema("success", { kind: "string" } as DurableTypeDescriptor),
    structuralSchema("error", { kind: "number" } as DurableTypeDescriptor)
  )
  for (const surface of [WORKER, BUNDLE]) {
    expect(decodeWorkerExit(route, { kind: "success", value: "ok" }, surface)).toEqual({ kind: "success", value: "ok" })
    expect(decodeWorkerExit(route, { kind: "success", value: 1 }, surface))
      .toMatchObject({ kind: "defect", defect: { name: "SuccessCodecDefect" } })
    expect(decodeWorkerExit(route, { kind: "failure", error: 1 }, surface)).toEqual({ kind: "failure", error: 1 })
    expect(decodeWorkerExit(route, { kind: "failure", error: "no" }, surface))
      .toMatchObject({ kind: "defect", defect: { name: "FailureCodecDefect" } })
  }
})
