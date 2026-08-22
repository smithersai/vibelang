import { expect, test } from "bun:test"
import {
  Action,
  compileActionContract,
  compileActionImplementationContract,
  Deployment,
  digest,
  fail,
  Flow,
  Provider,
  LocalWorker,
  validateDeploymentManifest,
  Worker,
  type ActionDescriptor,
  type ActionImplementationContract,
  type ActionProvider
} from "./index.ts"

const TYPED_ACTION_FILE = "typed-action.vibe"
const TYPED_FAILURE_IDENTITY = "vibe:typed-action.vibe_Missing@1"

const typedActionSource = (payloadType = "string") => `
import { Action } from "vibelang:flows"
class Missing extends Error {
  constructor(readonly code: ${payloadType}) { super(String(code)) }
}
export abstract class Work extends Action<
  (input: { mode: string }) => Result<{ value: number }, Missing>
> {}
`

const exactTypedImplementationSource = `
import { Panic, panic } from "vibelang:exceptions"
class Missing extends Error {
  constructor(readonly code: string) { super(code) }
}
export function typedFailureImplementation(
  input: { mode: string }
): Result<{ value: number }, Missing | Panic> {
  if (input.mode === "typed") throw new Missing("missing")
  if (input.mode === "panic") panic("unexpected")
  return { value: 1 }
}
`

function typedFailureImplementation(input: { mode: string }) {
  if (input.mode === "typed") {
    fail({ version: 1, identity: TYPED_FAILURE_IDENTITY, payload: { code: "missing" } })
  }
  if (input.mode === "panic") throw new Error("unexpected")
  return { value: 1 }
}

const compileTypedAction = (id: string, source = typedActionSource()) => {
  const compiled = compileActionContract(source, {
    fileName: TYPED_ACTION_FILE,
    exportName: "Work",
    id,
    version: 1
  })
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((diagnostic) => diagnostic.message).join("\n"))
  return Action.fromDescriptor<{ mode: string }, { value: number }, { code: string }>(compiled.descriptor)
}

const compileTypedImplementation = (
  action: ActionDescriptor,
  implementationId: string,
  source = exactTypedImplementationSource,
  entryFile = TYPED_ACTION_FILE
) => compileActionImplementationContract({
  action,
  implementationId,
  implementationVersion: "1",
  entryFile,
  exportName: "typedFailureImplementation",
  implementation: typedFailureImplementation,
  sources: [{ fileName: entryFile, source }]
})

const readThroughHelper = (value: number): number => value + 1
function checkedImplementation(input: { value: number }) {
  return { value: readThroughHelper(input.value) }
}
function substitutedImplementation(input: { value: number }) {
  return { value: input.value + 10_000 }
}

const implementationSource = `
import { Context } from "vibelang/context"

export abstract class Database extends Context {
  abstract read(value: number): number
}

function readThroughHelper(value: number) {
  return Database.context().read(value)
}

export function checkedImplementation(input: { value: number }) {
  return { value: readThroughHelper(input.value) }
}
`

const compileContract = (
  action: ActionDescriptor,
  implementationId: string,
  implementationVersion = "1",
  source = implementationSource
) =>
  compileActionImplementationContract({
    action,
    implementationId,
    implementationVersion,
    entryFile: "implementation.vibe",
    exportName: "checkedImplementation",
    implementation: checkedImplementation,
    sources: [{ fileName: "implementation.vibe", source }]
  })

const defineProgram = (suffix: string) => {
  const Work = Action.define<{ value: number }, { value: number }>({
    id: `test/checked-provider-${suffix}`,
    version: 1
  })
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: `test/checked-flow-${suffix}`, version: 1 },
    (input) => Work.run({ value: input.value })
  )
  return { Work, Program }
}

test("checked Action providers close compiler-derived transitive requirements and pin the evidence", async () => {
  const { Work, Program } = defineProgram("valid")
  const contract = compileContract(Work.descriptor, "checked-valid")
  expect(contract.requirements).toEqual(["Database"])
  expect(contract.typedFailures).toEqual([])
  expect(contract.panic).toBe(false)
  expect(Object.isFrozen(contract)).toBe(true)
  expect(Object.isFrozen(contract.requirements)).toBe(true)

  const Live = Provider.provideChecked(Work, checkedImplementation, {
    implementationId: "checked-valid",
    implementationVersion: "1",
    implementationContract: contract,
    capabilities: ["Database"]
  })
  const deployment = Deployment.build({
    id: "checked-valid",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })]
  })
  const route = deployment.manifest.routes[0]!
  expect(route.implementationContract).toEqual(contract)
  expect(route.policy.capabilityGrant).toEqual(["Database"])
  expect(route.policy.dependencyDigests).toContain(contract.digest)
  expect(Live.implementationDigest).toBe(route.implementationDigest)

})

test("checked providers bind the exact Action error schema while keeping Panic out of typed E", async () => {
  const Work = compileTypedAction("test/typed-provider-exact")
  const contract = compileTypedImplementation(Work.descriptor, "typed-provider-exact")
  expect(contract.typedFailures).toEqual(["Missing"])
  expect(contract.panic).toBe(true)
  expect(contract.failureSchemaDigest).toBe(Work.descriptor.errorSchema.digest)
  expect(contract.actionContractDigest).toBe(Work.descriptor.contractDigest)

  const Program = Flow.define<{ mode: string }, { value: number }>(
    { id: "test/typed-provider-flow", version: 1 },
    (input) => Work.run({ mode: input.mode })
  )
  const Live = Provider.provideChecked(Work, typedFailureImplementation, {
    implementationId: "typed-provider-exact",
    implementationVersion: "1",
    implementationContract: contract
  })
  const pool = Worker.pool("typed-local", { target: "typescript-bun", providers: [Live] })
  const deployment = Deployment.build({ id: "typed-provider", flow: Program, pools: [pool] })
  const route = deployment.manifest.routes[0]!
  const node = Program.plan.nodes[0]!
  const worker = new LocalWorker(pool, deployment.manifest, deployment.providers)
  const invoke = (mode: string) => worker.invoke({
    schemaVersion: 1,
    executionId: `typed-${mode}`,
    nodeId: node.id,
    attempt: 1,
    actionId: route.actionId,
    actionVersion: route.actionVersion,
    actionContractDigest: route.actionContractDigest,
    implementationDigest: route.implementationDigest,
    input: { mode },
    deadline: Date.now() + 10_000,
    downstreamIdempotencyKey: digest({ mode }),
    capabilityGrant: [],
    lease: { owner: "test", expiresAt: Date.now() + 10_000 },
    fencingToken: 1,
    traceContext: {}
  })
  expect(await invoke("typed")).toEqual({
    kind: "failure",
    error: { version: 1, identity: TYPED_FAILURE_IDENTITY, payload: { code: "missing" } }
  })
  expect(await invoke("panic")).toMatchObject({
    kind: "defect",
    defect: { name: "Error", message: "unexpected" }
  })
})

test("implementation compilation rejects omitted, introduced, and forged typed failures", () => {
  const Work = compileTypedAction("test/typed-provider-mismatch")
  const omitted = `
    import { Panic, panic } from "vibelang:exceptions"
    export function typedFailureImplementation(input: { mode: string }): Result<{ value: number }, Panic> {
      if (input.mode === "panic") panic("unexpected")
      return { value: 1 }
    }
  `
  expect(() => compileTypedImplementation(Work.descriptor, "typed-omitted", omitted))
    .toThrow("typed failures never do not exactly match")

  const introduced = `
    import { Panic } from "vibelang:exceptions"
    class Missing extends Error { constructor(readonly code: string) { super(code) } }
    class Extra extends Error { constructor(readonly detail: string) { super(detail) } }
    export function typedFailureImplementation(
      input: { mode: string }
    ): Result<{ value: number }, Missing | Extra | Panic> {
      if (input.mode === "missing") throw new Missing("missing")
      if (input.mode === "extra") throw new Extra("extra")
      return { value: 1 }
    }
  `
  expect(() => compileTypedImplementation(Work.descriptor, "typed-introduced", introduced))
    .toThrow("Extra | Missing")

  const forgedPayload = exactTypedImplementationSource.replace("readonly code: string", "readonly code: number")
    .replace("super(code)", "super(String(code))")
    .replace('new Missing("missing")', "new Missing(404)")
  expect(() => compileTypedImplementation(Work.descriptor, "typed-forged-payload", forgedPayload))
    .toThrow("nominal failure schema does not exactly match")

  expect(() => compileTypedImplementation(
    Work.descriptor,
    "typed-forged-identity",
    exactTypedImplementationSource,
    "other-action.vibe"
  )).toThrow("nominal failure schema does not exactly match")
})

test("Panic is a defect channel and cannot be forged as a recoverable Action error", () => {
  const compiled = compileActionContract(`
    import { Action } from "vibelang:flows"
    class Panic extends Error {
      constructor(readonly reason: string) { super(reason) }
    }
    export abstract class Work extends Action<
      (input: { mode: string }) => Result<{ value: number }, Panic>
    > {}
  `, {
    fileName: TYPED_ACTION_FILE,
    exportName: "Work",
    id: "test/typed-panic-forgery",
    version: 1
  })
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((diagnostic) => diagnostic.message).join("\n"))
  const Work = Action.fromDescriptor<{ mode: string }, { value: number }, { reason: string }>(compiled.descriptor)

  expect(() => compileTypedImplementation(
    Work.descriptor,
    "typed-panic-forgery",
    `export function typedFailureImplementation(_input: { mode: string }): { value: number } {
      return { value: 1 }
    }`
  )).toThrow("reserved defect name Panic")
})

test("a checked implementation contract cannot be rebound to another Action", () => {
  const First = compileTypedAction("test/typed-provider-first")
  const Second = compileTypedAction("test/typed-provider-second")
  const contract = compileTypedImplementation(First.descriptor, "typed-action-binding")
  expect(() => Provider.provideChecked(Second, typedFailureImplementation, {
    implementationId: "typed-action-binding",
    implementationVersion: "1",
    implementationContract: contract
  })).toThrow("does not target exact Action")
})

test("deployment rejects missing or excess grants instead of trusting provider strings", () => {
  const { Work, Program } = defineProgram("missing")
  const contract = compileContract(Work.descriptor, "checked-missing")
  const Missing = Provider.provideChecked(Work, checkedImplementation, {
    implementationId: "checked-missing",
    implementationVersion: "1",
    implementationContract: contract,
    capabilities: []
  })
  expect(() => Deployment.build({
    id: "checked-missing",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Missing] })]
  })).toThrow("does not close its compiler-derived requirements")

  const Excess = Provider.provideChecked(Work, checkedImplementation, {
    implementationId: "checked-missing",
    implementationVersion: "1",
    implementationContract: contract,
    capabilities: ["Database", "RootAuthority"]
  })
  expect(() => Deployment.build({
    id: "checked-excess",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Excess] })]
  })).toThrow("does not close its compiler-derived requirements")

  expect(() => Provider.provide(Work, ({ value }) => ({ value }), {
    implementationId: "legacy-authority",
    implementationVersion: "1",
    capabilities: ["Database"]
  })).toThrow("cannot receive capability authority")
})

test("forged contracts and checked-to-legacy provider downgrades fail closed", () => {
  const { Work, Program } = defineProgram("tamper")
  const contract = compileContract(Work.descriptor, "checked-tamper")
  const { digest: _digest, ...semantic } = contract
  const forgedSemantic = { ...semantic, requirements: ["RootAuthority"] }
  const forged = Object.freeze({
    ...forgedSemantic,
    digest: digest(forgedSemantic)
  }) as ActionImplementationContract
  expect(() => Provider.provideChecked(Work, checkedImplementation, {
    implementationId: "checked-tamper",
    implementationVersion: "1",
    implementationContract: forged,
    capabilities: ["RootAuthority"]
  })).toThrow("exact frozen contract object issued")
  expect(() => Provider.provideChecked(Work, substitutedImplementation, {
    implementationId: "checked-tamper",
    implementationVersion: "1",
    implementationContract: contract,
    capabilities: ["Database"]
  })).toThrow("exact runtime callback paired")

  const Live = Provider.provideChecked(Work, checkedImplementation, {
    implementationId: "checked-tamper",
    implementationVersion: "1",
    implementationContract: contract,
    capabilities: ["Database"]
  })
  const downgraded = {
    ...Live,
    implementationContract: null,
    capabilityGrant: []
  } as unknown as ActionProvider<{ value: number }, { value: number }, unknown>
  expect(() => Deployment.build({
    id: "checked-downgrade",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [downgraded] })]
  })).toThrow("unauthenticated or mutated Action provider")

  const deployment = Deployment.build({
    id: "checked-tamper-manifest",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })]
  })
  const serialized = JSON.parse(JSON.stringify(deployment.manifest))
  serialized.routes[0].implementationContract.requirements = ["RootAuthority"]
  expect(() => validateDeploymentManifest(serialized, Program.plan)).toThrow("contract digest mismatch")
})

test("implementation identity and source drift change every pinned deployment identity", () => {
  const { Work, Program } = defineProgram("identity")
  const first = compileContract(Work.descriptor, "checked-identity", "1")
  const second = compileContract(
    Work.descriptor,
    "checked-identity",
    "1",
    implementationSource.replace(".read(value)", ".read(value) + 1")
  )
  expect(first.digest).not.toBe(second.digest)
  expect(first.projectDigest).not.toBe(second.projectDigest)
  expect(first.checkedExportDigest).toBe(second.checkedExportDigest)

  const changedVersion = compileContract(Work.descriptor, "checked-identity", "2")
  expect(() => Provider.provideChecked(Work, checkedImplementation, {
    implementationId: "checked-identity",
    implementationVersion: "2",
    implementationContract: first,
    capabilities: ["Database"]
  })).toThrow("identity does not match")

  const ProviderOne = Provider.provideChecked(Work, checkedImplementation, {
    implementationId: "checked-identity",
    implementationVersion: "1",
    implementationContract: first,
    capabilities: ["Database"]
  })
  const ProviderTwo = Provider.provideChecked(Work, checkedImplementation, {
    implementationId: "checked-identity",
    implementationVersion: "1",
    implementationContract: second,
    capabilities: ["Database"]
  })
  const firstDeployment = Deployment.build({
    id: "checked-identity",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [ProviderOne] })]
  })
  const secondDeployment = Deployment.build({
    id: "checked-identity",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [ProviderTwo] })]
  })
  expect(ProviderOne.implementationDigest).not.toBe(ProviderTwo.implementationDigest)
  expect(firstDeployment.manifest.routes[0]!.implementationDigest)
    .not.toBe(secondDeployment.manifest.routes[0]!.implementationDigest)
  expect(firstDeployment.manifest.digest).not.toBe(secondDeployment.manifest.digest)
  expect(changedVersion.digest).not.toBe(first.digest)
})

test("the compiler rejects incomplete source closures and never treats callback text as source evidence", () => {
  const { Work } = defineProgram("invalid-source")
  expect(() => compileActionImplementationContract({
    action: Work.descriptor,
    implementationId: "missing-closure",
    implementationVersion: "1",
    entryFile: "implementation.vibe",
    exportName: "checkedImplementation",
    implementation: checkedImplementation,
    sources: [{
      fileName: "implementation.vibe",
      source: `
        import { hidden } from "./not-supplied.vibe"
        export function checkedImplementation(input: { value: number }) {
          return { value: hidden(input.value) }
        }
      `
    }]
  })).toThrow("source closure is missing")

  const opaquePair = compileActionImplementationContract({
    action: Work.descriptor,
    implementationId: "source-substitution",
    implementationVersion: "1",
    entryFile: "implementation.vibe",
    exportName: "checkedImplementation",
    implementation: substitutedImplementation,
    sources: [{ fileName: "implementation.vibe", source: implementationSource }]
  })
  expect(opaquePair.checkedExportDigest)
    .toBe(compileContract(Work.descriptor, "source-reference").checkedExportDigest)
  expect(() => Provider.provideChecked(Work, checkedImplementation, {
    implementationId: "source-substitution",
    implementationVersion: "1",
    implementationContract: opaquePair,
    capabilities: ["Database"]
  })).toThrow("exact runtime callback paired")
})
