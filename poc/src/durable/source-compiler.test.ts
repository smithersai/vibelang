import { expect, test } from "bun:test"
import {
  Action,
  compileActionContract,
  compileDurableSource,
  Deployment,
  DurableExecutor,
  DurableStore,
  Provider,
  Worker,
  type DurableSourceActionBinding
} from "./index.ts"

const Compile = Action.define<{ source: string }, { code: string }>({
  id: "test/source/Compile",
  version: 1
})
const Package = Action.define<{ code: string }, { artifact: string }>({
  id: "test/source/Package",
  version: 1
})

const actionBindings: readonly DurableSourceActionBinding[] = Object.freeze([
  Object.freeze({
    moduleSpecifier: "test:source-actions",
    exportName: "Compile",
    descriptor: Compile.descriptor
  }),
  Object.freeze({
    moduleSpecifier: "test:source-actions",
    exportName: "Package",
    descriptor: Package.descriptor
  })
])

const representativeSource = `
import { durable as lowerDurable } from "smithers:flows"
import { Compile as C, Package as P } from "test:source-actions"

throw new Error("compilation evaluated the authored module")

function build(input: { source: string }) {
  const request = { source: input.source }
  const compiled = C.run(request)!
  const packageInput = { code: compiled.code }
  return P.run(packageInput)
}

export const Build = lowerDurable(build)
`

const compileRepresentative = (source = representativeSource) => compileDurableSource(source, {
  fileName: "flows/build.sm.ts",
  flowId: "test/source/Build",
  flowVersion: 3,
  actions: actionBindings
})

test("static durable source lowering follows imported aliases and never evaluates source or implementations", async () => {
  let compileImplementations = 0
  let packageImplementations = 0
  const result = compileRepresentative()
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))

  expect(compileImplementations).toBe(0)
  expect(packageImplementations).toBe(0)
  expect(result.flow.artifactSource).toBe("static-plan-artifact")
  expect(result.plan.nodes.map((node) => node.kind)).toEqual(["action", "action"])
  expect(result.plan.nodes.map((node) => node.kind === "action" ? node.actionId : "")).toEqual([
    Compile.descriptor.id,
    Package.descriptor.id
  ])
  const [compileNode, packageNode] = result.plan.nodes
  expect(packageNode.dependencies).toEqual([compileNode.id])
  expect(packageNode.controlDependencies).toEqual([compileNode.id])

  const CompileLive = Provider.provide(Compile, ({ source }) => {
    compileImplementations += 1
    return { code: `compiled:${source}` }
  }, {
    implementationId: "source-compile-live",
    implementationVersion: "1"
  })
  const PackageLive = Provider.provide(Package, ({ code }) => {
    packageImplementations += 1
    return { artifact: `packaged:${code}` }
  }, {
    implementationId: "source-package-live",
    implementationVersion: "1"
  })
  const deployment = Deployment.build({
    id: "source-compiler-executable",
    flow: result.flow,
    pools: [Worker.pool("source-worker", {
      target: "typescript-bun",
      providers: [CompileLive, PackageLive]
    })]
  })
  const store = new DurableStore()
  try {
    expect(await new DurableExecutor(deployment, store).execute(
      { source: "hello" },
      { executionId: "source-compiler-executable" }
    )).toEqual({ artifact: "packaged:compiled:hello" })
    expect(compileImplementations).toBe(1)
    expect(packageImplementations).toBe(1)
  } finally {
    store.close()
  }
})

test("conditional expressions lower to replay-stable Plan branches and never run the unselected arm", async () => {
  const source = `
import { durable } from "smithers:flows"
import { Compile as C } from "test:source-actions"

throw new Error("branch source module must not be evaluated")

export const Build = durable(function Build(input: { source: string; useSource: boolean }) {
  return input.useSource
    ? C.run({ source: input.source })
    : C.run({ source: "fallback" })
})
`
  const result = compileRepresentative(source)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  expect(result.plan.nodes).toHaveLength(1)
  const branch = result.plan.nodes[0]
  expect(branch.kind).toBe("branch")
  if (branch.kind !== "branch") throw new Error("expected branch Plan node")
  expect(branch.whenTrue.nodes).toHaveLength(1)
  expect(branch.whenFalse.nodes).toHaveLength(1)
  expect(branch.whenTrue.nodes[0].kind).toBe("action")
  expect(branch.whenFalse.nodes[0].kind).toBe("action")

  const repeated = compileRepresentative(`// unrelated leading edit\n${source}`)
  if (!repeated.ok) throw new Error(JSON.stringify(repeated.diagnostics))
  const repeatedBranch = repeated.plan.nodes[0]
  if (repeatedBranch.kind !== "branch") throw new Error("expected repeated branch Plan node")
  expect([
    repeatedBranch.id,
    repeatedBranch.whenTrue.nodes[0].id,
    repeatedBranch.whenFalse.nodes[0].id
  ]).toEqual([
    branch.id,
    branch.whenTrue.nodes[0].id,
    branch.whenFalse.nodes[0].id
  ])

  let calls = 0
  const Live = Provider.provide(Compile, ({ source: value }) => {
    calls += 1
    return { code: `compiled:${value}` }
  }, {
    implementationId: "source-branch-live",
    implementationVersion: "1"
  })
  const deployment = Deployment.build({
    id: "source-branch-executable",
    flow: result.flow,
    pools: [Worker.pool("source-worker", { target: "typescript-bun", providers: [Live] })]
  })
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.execute(
      { source: "authored", useSource: true },
      { executionId: "source-branch-true" }
    )).toEqual({ code: "compiled:authored" })
    expect(calls).toBe(1)
    expect(store.getNode("source-branch-true", branch.whenTrue.nodes[0].id).status).toBe("succeeded")
    expect(store.getNode("source-branch-true", branch.whenFalse.nodes[0].id).status).toBe("skipped")

    // Reopening a completed execution returns the journaled branch result and
    // cannot reevaluate either arm.
    expect(await executor.execute(
      { source: "authored", useSource: true },
      { executionId: "source-branch-true" }
    )).toEqual({ code: "compiled:authored" })
    expect(calls).toBe(1)
    await expect(executor.execute(
      { source: "changed", useSource: false },
      { executionId: "source-branch-true" }
    )).rejects.toThrow("pinned to different input")
    expect(calls).toBe(1)

    expect(await executor.execute(
      { source: "ignored", useSource: false },
      { executionId: "source-branch-false" }
    )).toEqual({ code: "compiled:fallback" })
    expect(calls).toBe(2)
    expect(store.getNode("source-branch-false", branch.whenTrue.nodes[0].id).status).toBe("skipped")
    expect(store.getNode("source-branch-false", branch.whenFalse.nodes[0].id).status).toBe("succeeded")
  } finally {
    store.close()
  }
})

test("conditional branch joins participate in compiler-derived Flow success and failure schemas", () => {
  const action = compileActionContract(`
import { Action } from "smithers:flows"
interface Input { readonly value: number }
interface Output { readonly value: number; readonly selected: "action" }
class Rejected extends Error { constructor(readonly code: string) { super(code) } }
export abstract class Work extends Action<(input: Input) => Result<Output, Rejected>> {}
`, {
    fileName: "contracts/branch-work.sm",
    exportName: "Work",
    id: "test/source/BranchWork",
    version: 1
  })
  if (!action.ok) throw new Error(JSON.stringify(action.diagnostics))
  const compiled = compileDurableSource(`
import { durable } from "smithers:flows"
import { Work } from "test:branch-actions"
export const Branch = durable(function Branch(input: { value: number; chooseInput: boolean }) {
  return (input.chooseInput
    ? Work.run({ value: input.value })!
    : Work.run({ value: 0 })!).value
})
`, {
    fileName: "flows/structural-branch.sm",
    flowId: "test/source/StructuralBranch",
    flowVersion: 1,
    actions: [{
      moduleSpecifier: "test:branch-actions",
      exportName: "Work",
      descriptor: action.descriptor
    }]
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.flowSchemas?.success).toMatchObject({
    shape: "structural",
    descriptor: { kind: "number" }
  })
  expect(compiled.plan.flowSchemas?.error).toEqual(action.descriptor.errorSchema)
})

test("static durable artifacts are deterministic and node IDs ignore unrelated leading source edits", () => {
  const first = compileRepresentative()
  const second = compileRepresentative()
  if (!first.ok) throw new Error(JSON.stringify(first.diagnostics))
  if (!second.ok) throw new Error(JSON.stringify(second.diagnostics))
  expect([...first.artifact]).toEqual([...second.artifact])
  expect(first.plan.digest).toBe(second.plan.digest)

  const edited = compileRepresentative(`// unrelated banner\n// another unrelated line\n${representativeSource}`)
  if (!edited.ok) throw new Error(JSON.stringify(edited.diagnostics))
  expect(edited.plan.nodes.map((node) => node.id)).toEqual(first.plan.nodes.map((node) => node.id))
})

test("namespace aliases resolve by imported symbol identity", () => {
  const result = compileRepresentative(`
import * as Flows from "smithers:flows"
import * as Actions from "test:source-actions"

export const Build = Flows.durable(function Build(input: { source: string }) {
  const compiled = Actions.Compile.run({ source: input.source })!
  return Actions.Package.run({ code: compiled.code })
})
`)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  expect(result.plan.nodes.map((node) => node.kind === "action" ? node.actionId : "")).toEqual([
    Compile.descriptor.id,
    Package.descriptor.id
  ])
})

test("postfix propagation creates a sequencing edge even when its success value is ignored", () => {
  const result = compileRepresentative(`
import { durable } from "smithers:flows"
import { Compile as C, Package as P } from "test:source-actions"

export const Build = durable(function Build(input: { source: string }) {
  const checked = C.run({ source: input.source })!
  const packageInput = { code: "constant" }
  return P.run(packageInput)
})
`)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  const [checkedNode, packageNode] = result.plan.nodes
  expect(checkedNode.dependencies).toEqual([])
  expect(packageNode.dependencies).toEqual([])
  expect(packageNode.controlDependencies).toEqual([checkedNode.id])
})

test("unrelated local durable and Action spellings are never treated as compiler intrinsics", () => {
  const unrelatedDurable = compileRepresentative(`
import { durable as compilerDurable } from "smithers:flows"
function durable(value: unknown) { return value }
const Build = durable(function (input: unknown) { return input })
void compilerDurable
`)
  expect(unrelatedDurable.ok).toBe(false)
  if (unrelatedDurable.ok) throw new Error("expected unrelated durable spelling to fail")
  expect(unrelatedDurable.diagnostics[0].code).toBe("SMITHERS4102")

  const unrelatedAction = compileRepresentative(`
import { durable } from "smithers:flows"
import { Compile as ImportedCompile } from "test:source-actions"
const Compile = { run(value: unknown) { return value } }
export const Build = durable(function Build(input: { source: string }) {
  return Compile.run({ source: input.source })
})
void ImportedCompile
`)
  expect(unrelatedAction.ok).toBe(false)
  if (unrelatedAction.ok) throw new Error("expected unrelated Action spelling to fail")
  expect(unrelatedAction.diagnostics[0].code).toBe("SMITHERS4112")

  const duplicateIntrinsic = compileRepresentative(`
import { durable } from "smithers:flows"
const durable = (value: unknown) => value
export const Build = durable(function (input: unknown) { return input })
`)
  expect(duplicateIntrinsic.ok).toBe(false)
  if (duplicateIntrinsic.ok) throw new Error("expected conflicting intrinsic declaration to fail")
  expect(duplicateIntrinsic.diagnostics[0].code).toBe("SMITHERS4100")

  const duplicateAction = compileRepresentative(`
import { durable } from "smithers:flows"
import { Compile } from "test:source-actions"
const Compile = { run(value: unknown) { return value } }
export const Build = durable(function Build(input: { source: string }) {
  return Compile.run({ source: input.source })
})
`)
  expect(duplicateAction.ok).toBe(false)
  if (duplicateAction.ok) throw new Error("expected conflicting Action declaration to fail")
  expect(duplicateAction.diagnostics[0].code).toBe("SMITHERS4100")
})

test("type-only, optional, and mutable bindings cannot impersonate static intrinsics", () => {
  const typeOnlyIntrinsic = compileRepresentative(`
import type * as Flows from "smithers:flows"
export const Build = Flows.durable(function Build(input: unknown) { return input })
`)
  expect(typeOnlyIntrinsic.ok).toBe(false)
  if (typeOnlyIntrinsic.ok) throw new Error("expected type-only intrinsic failure")
  expect(typeOnlyIntrinsic.diagnostics[0].code).toBe("SMITHERS4102")

  const typeOnlyAction = compileRepresentative(`
import { durable } from "smithers:flows"
import type * as Actions from "test:source-actions"
export const Build = durable(function Build(input: { source: string }) {
  return Actions.Compile.run({ source: input.source })
})
`)
  expect(typeOnlyAction.ok).toBe(false)
  if (typeOnlyAction.ok) throw new Error("expected type-only Action failure")
  expect(typeOnlyAction.diagnostics[0].code).toBe("SMITHERS4112")

  const optionalIntrinsic = compileRepresentative(`
import { durable } from "smithers:flows"
export const Build = durable?.(function Build(input: unknown) { return input })
`)
  expect(optionalIntrinsic.ok).toBe(false)
  if (optionalIntrinsic.ok) throw new Error("expected optional intrinsic failure")
  expect(optionalIntrinsic.diagnostics[0].code).toBe("SMITHERS4103")

  const reassignedFunction = compileRepresentative(`
import { durable } from "smithers:flows"
import { Compile as C } from "test:source-actions"
function build(input: { source: string }) { return C.run({ source: input.source }) }
build = function replacement(input: { source: string }) { return C.run({ source: "replacement" }) }
export const Build = durable(build)
`)
  expect(reassignedFunction.ok).toBe(false)
  if (reassignedFunction.ok) throw new Error("expected assigned function failure")
  expect(reassignedFunction.diagnostics[0].code).toBe("SMITHERS4103")

  const mutableFunction = compileRepresentative(`
import { durable } from "smithers:flows"
import { Compile as C } from "test:source-actions"
let build = (input: { source: string }) => C.run({ source: input.source })
export const Build = durable(build)
`)
  expect(mutableFunction.ok).toBe(false)
  if (mutableFunction.ok) throw new Error("expected mutable function failure")
  expect(mutableFunction.diagnostics[0].code).toBe("SMITHERS4103")
})

test("unsupported control flow, captures, mutation, and higher-order calls fail closed at stable source locations", () => {
  const cases = [
    {
      code: "SMITHERS4106",
      body: `if (input.source) return C.run({ source: input.source })\n  return C.run({ source: "empty" })`
    },
    {
      code: "SMITHERS4106",
      body: `return input.source ? C.run({ source: input.source }) : C.run({ source: "empty" })`
    },
    {
      code: "SMITHERS4106",
      body: `return C.run({ source: input?.source })`
    },
    {
      code: "SMITHERS4107",
      body: `for (const value of []) { void value }\n  return C.run({ source: input.source })`
    },
    {
      code: "SMITHERS4105",
      body: `let request = { source: input.source }\n  return C.run(request)`
    },
    {
      code: "SMITHERS4110",
      prefix: `const captured = "outside"\n`,
      body: `return C.run({ source: captured })`
    },
    {
      code: "SMITHERS4112",
      prefix: `function identity(value: unknown) { return value }\n`,
      body: `return identity(input)`
    },
    {
      code: "SMITHERS4115",
      body: `const result = C.run({ source: input.source })\n  return result`
    }
  ] as const

  for (const fixture of cases) {
    const source = `
import { durable } from "smithers:flows"
import { Compile as C } from "test:source-actions"
${"prefix" in fixture ? fixture.prefix : ""}export const Build = durable(function Build(input: { source: string }) {
  ${fixture.body}
})
`
    const first = compileRepresentative(source)
    const second = compileRepresentative(source)
    expect(first.ok).toBe(false)
    expect(second.ok).toBe(false)
    if (first.ok || second.ok) throw new Error(`expected ${fixture.code}`)
    expect(first.diagnostics).toEqual(second.diagnostics)
    expect(first.diagnostics[0].code).toBe(fixture.code)
    expect(first.diagnostics[0].file).toBe("flows/build.sm.ts")
    expect(first.diagnostics[0].line).toBeGreaterThan(0)
    expect(first.diagnostics[0].column).toBeGreaterThan(0)
    expect(first.diagnostics[0].length).toBeGreaterThan(0)
  }
})

test("syntax errors fail closed as stable SMITHERS4100 diagnostics", () => {
  const source = `
import { durable } from "smithers:flows"
export const Build = durable(function Build(input: unknown) {
  return { broken:
})
`
  const first = compileRepresentative(source)
  const second = compileRepresentative(source)
  expect(first.ok).toBe(false)
  expect(second.ok).toBe(false)
  if (first.ok || second.ok) throw new Error("expected syntax failure")
  expect(first.diagnostics).toEqual(second.diagnostics)
  expect(first.diagnostics[0].code).toBe("SMITHERS4100")
})

test("same-file Action declarations are derived from the checked program without descriptor bindings", () => {
  const source = `
import { durable, Action, sequential } from "smithers:flows"

class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
class Audit extends Action<(input: { value: string }) => Result<{ saved: boolean }, Error>> {}

export const Build = durable((input: { key: string }) => {
  const found = Lookup.run({ key: input.key })!
  const pair = sequential(Lookup.run({ key: found.value }), Audit.run({ value: found.value }))
  return { found, pair }
})
`
  const compiled = compileDurableSource(source, { fileName: "flows/orders.sm" })
  const repeated = compileDurableSource(source, { fileName: "flows/orders.sm" })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok || !repeated.ok) throw new Error(JSON.stringify(compiled.ok ? [] : compiled.diagnostics))

  // The Action identity is anchored on the authored file name, not on the
  // TypeScript-normalized one, so it matches every other compiler for this
  // language.
  expect(compiled.plan.requirements).toEqual([
    "flows/orders.sm#Audit",
    "flows/orders.sm#Lookup"
  ])
  expect(compiled.plan.nodes.map((node) => node.kind)).toEqual(["action", "action", "action"])
  expect(compiled.plan.digest).toBe(repeated.plan.digest)

  // The input/success contracts are the authored ones, structurally derived.
  const lookup = compiled.plan.actions.find((action) => action.id === "flows/orders.sm#Lookup")
  if (lookup === undefined) throw new Error("expected a derived Lookup contract")
  expect(lookup.version).toBe(1)
  expect(lookup.inputSchema.shape).toBe("structural")
  expect(lookup.successSchema.shape).toBe("structural")
  if (lookup.inputSchema.shape !== "structural" || lookup.successSchema.shape !== "structural") {
    throw new Error("expected structural derived schemas")
  }
  expect(lookup.inputSchema.descriptor).toEqual({
    kind: "object",
    fields: [{ name: "key", optional: false, value: { kind: "string" } }]
  })
  expect(lookup.successSchema.descriptor).toEqual({
    kind: "object",
    fields: [{ name: "value", optional: false, value: { kind: "string" } }]
  })

  // Consumed declarations are reported so a consumer can erase them with the
  // compiler-owned import instead of guessing their extent.
  expect(compiled.derivedActions.map((action) => action.name)).toEqual(["Lookup", "Audit"])
  for (const action of compiled.derivedActions) {
    expect(source.slice(action.start, action.end).startsWith(`class ${action.name} extends Action<`)).toBe(true)
    expect(source.slice(action.start, action.end).endsWith("{}")).toBe(true)
  }
})

test("a derived same-file contract equals the separately compiled contract for the same declaration", () => {
  const declaration = `
import { Action } from "smithers:flows"
export class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, LookupFailed>> {}
export class LookupFailed extends Error {
  constructor(readonly key: string) { super("missing") }
}
`
  const separate = compileActionContract(declaration, {
    fileName: "flows/orders.sm",
    exportName: "Lookup",
    id: "flows/orders.sm#Lookup",
    version: 1
  })
  expect(separate.ok).toBe(true)
  if (!separate.ok) throw new Error(JSON.stringify(separate.diagnostics))

  const compiled = compileDurableSource(`${declaration}
import { durable } from "smithers:flows"
export const Build = durable((input: { key: string }) => {
  return Lookup.run({ key: input.key })
})
`, { fileName: "flows/orders.sm" })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const derived = compiled.plan.actions.find((action) => action.id === "flows/orders.sm#Lookup")
  expect(derived).toEqual(separate.descriptor)
})

test("a same-file Action input mismatch stays a checked contract error, not a silent Plan", () => {
  const compiled = compileDurableSource(`
import { durable, Action } from "smithers:flows"

class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}

export const Build = durable((input: { key: number }) => {
  return Lookup.run({ key: input.key })
})
`, { fileName: "flows/orders.sm" })
  expect(compiled.ok).toBe(false)
  if (compiled.ok) throw new Error("expected a contract failure")
  expect(compiled.diagnostics[0].code).toBe("SMITHERS4100")
  expect(compiled.diagnostics[0].file).toBe("flows/orders.sm.ts")
})

test("descriptor bindings still describe Actions imported from other modules", () => {
  const compiled = compileRepresentative()
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.requirements).toEqual(["test/source/Compile", "test/source/Package"])
  expect(compiled.derivedActions).toEqual([])
})

test("an unrelated local class named Action never gains compiler authority", () => {
  const compiled = compileDurableSource(`
import { durable } from "smithers:flows"

class Action<Signature> {
  declare readonly signature: Signature
  static run(input: unknown): { unwrap(): unknown } { throw new Error("local") }
}
class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}

export const Build = durable((input: { key: string }) => {
  return Lookup.run({ key: input.key })
})
`, { fileName: "flows/orders.sm" })
  expect(compiled.ok).toBe(false)
  if (compiled.ok) throw new Error("a local Action must not lower")
  // The call is an ordinary higher-order runtime call, not a durable Action.
  expect(compiled.diagnostics[0].code).toBe("SMITHERS4112")
})

test("the durable source compiler weakens an error contract only where the spec allows it", () => {
  const compileWithErrorChannel = (errorType: string) => compileDurableSource(`
import { durable, Action } from "smithers:flows"
class LookupFailed extends Error { constructor(readonly key: string) { super("missing") } }
class LooksLikeError { name = "LooksLikeError"; message = "not nominal" }
class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, ${errorType}>> {}
export const Build = durable((input: { key: string }) => {
  return Lookup.run({ key: input.key })
})
`, { fileName: "flows/orders.sm" })

  const errorSchemaFor = (errorType: string) => {
    const compiled = compileWithErrorChannel(errorType)
    if (!compiled.ok) return { refused: true as const, code: compiled.diagnostics[0]?.code }
    const action = compiled.plan.actions.find((candidate) => candidate.id === "flows/orders.sm#Lookup")
    if (action === undefined) return { refused: false as const, shape: "absent" }
    return { refused: false as const, shape: action.errorSchema.shape }
  }

  // The one authorized weakening. `docs/src/pages/specification/durable-execution.mdx`
  // (Locked) requires "compiler-derived persistence schemas or explicit codecs
  // where derivation is impossible"; the built-in `Error` has no nominal payload
  // this compiler can describe, and the input/success contracts it CAN describe
  // must not be lost with it.
  expect(errorSchemaFor("Error")).toEqual({ refused: false, shape: "json-value" })

  // A nominal failure class is described exactly, unweakened.
  expect(errorSchemaFor("LookupFailed")).toEqual({ refused: false, shape: "structural" })

  // "`any` and `unknown` MUST require an explicit codec at the boundary."
  // (Locked, same page.) A silent json-value contract is not an explicit codec.
  //
  // The refusal takes the documented undescribable-Action path: the declaration
  // is skipped, so `Lookup.run` finds no descriptor and the lowerer reports
  // against the authored call site. That is the same outcome every other
  // underivable signature already produces here.
  expect(errorSchemaFor("any")).toEqual({ refused: true, code: "SMITHERS4112" })

  // A structural impostor that does not extend Error is refused here for the
  // same reason `compileActionContract` already refuses it (see
  // `schema.test.ts`, "does not extend Error"). Two derivation entry points,
  // one answer on identical source.
  expect(errorSchemaFor("LooksLikeError")).toEqual({ refused: true, code: "SMITHERS4112" })
})

/**
 * `SMITHERS4124`: the collision has its own diagnostic, and the reason it needs
 * one is that the code it replaced was a *swallow artifact*.
 *
 * `deriveSameFileActions` skips a declaration whose contract it cannot derive.
 * For a colliding failure channel that left `Pick.run({ ... })` — an ordinary
 * compiler-bound Action call, with no higher-order call and no dynamic call
 * anywhere in the program — refused as SMITHERS4112, "higher-order and dynamic
 * calls are unavailable in durable source lowering". The verdict was right and
 * the stated reason was false, so an author was sent hunting for a call that
 * does not exist. `conformance/corpus/17-durable/` pins the same repair on both
 * backends; this file pins the reference's three lowering forms, two of which
 * the Go bridge cannot reach because it does not implement `fanOut`/`loopWhile`
 * at all.
 *
 * The code is 4124, not the 4114 the migration plan proposed as "the natural
 * neighbour": 4114 is TAKEN here and means "Action id <id> resolves to
 * incompatible durable contracts" — one id with two contracts, the mirror image
 * of this rule — and it does not exist in the Go bridge at all. 4100-4123 are
 * in use and 4199 is the durable internal-error code, so 4124 is the next free
 * code in the family.
 */
const collidingChannelSource = (body: string) => `
import { durable, Action, fanOut, loopWhile } from "smithers:flows"
class $Failed extends Error { constructor(readonly code: string) { super("dollar") } }
class _Failed extends Error { constructor(readonly reason: string) { super("under") } }
${body}
`

test("two Error classes under one durable failure identity draw SMITHERS4124, naming both classes", () => {
  const forms = {
    "a returned Action.run": `
class Pick extends Action<(input: { key: string }) => Result<{ value: string }, $Failed | _Failed>> {}
export const Build = durable((input: { key: string }) => {
  return Pick.run({ key: input.key })
})`,
    // The postfix-! path had its own false sentence — "postfix ! is supported
    // only directly on a compiler-bound Action.run(...) Result" — which is
    // exactly what this operand is.
    "an intermediate Action.run with postfix !": `
class Pick extends Action<(input: { key: string }) => Result<{ value: string }, $Failed | _Failed>> {}
class Tail extends Action<(input: { value: string }) => Result<{ out: string }, $Failed>> {}
export const Build = durable((input: { key: string }) => {
  const first = Pick.run({ key: input.key })!
  return Tail.run({ value: first.value })
})`,
    // "fanOut body must target one compiler-bound Action" — it does.
    "a fanOut step": `
class Pick extends Action<(input: { id: string }) => Result<{ value: string }, $Failed | _Failed>> {}
export const Build = durable((input: { ids: readonly string[] }) => {
  return fanOut(input.ids, (id) => id, (id) => Pick.run({ id }))
})`,
    // "loopWhile body must target one compiler-bound Action" — it does.
    "a loopWhile body": `
class Pick extends Action<(input: { more: boolean }) => Result<{ more: boolean }, $Failed | _Failed>> {}
export const Build = durable((input: { more: boolean }) => {
  return loopWhile({ more: input.more }, (state) => state.more, (state) => Pick.run({ more: state.more }), 8)
})`
  } as const

  for (const [label, body] of Object.entries(forms)) {
    const compiled = compileDurableSource(collidingChannelSource(body), { fileName: "flows/orders.sm" })
    expect(compiled.ok, label).toBe(false)
    if (compiled.ok) throw new Error(`${label} must be refused`)
    expect(compiled.diagnostics.length, label).toBe(1)
    expect(compiled.diagnostics[0].code, label).toBe("SMITHERS4124")
    // The payload is the promise: a code alone would let the old sentence
    // survive under a new number, which is the renumbering accident this repair
    // exists to avoid.
    expect(compiled.diagnostics[0].message, label).toContain("Error classes $Failed and _Failed")
    expect(compiled.diagnostics[0].message, label).toContain("share one durable failure identity")
    expect(compiled.diagnostics[0].message, label).not.toContain("higher-order")
  }
})

test("SMITHERS4124 fires on a COLLISION, not on two Error classes", () => {
  // The over-correction this repair could ship: a check that refuses any
  // two-class failure channel. `$Failed`/`_Failed` normalize to one identity;
  // `Failed`/`Denied` do not, and every form above must still compile.
  const benign = (body: string) => `
import { durable, Action, fanOut, loopWhile } from "smithers:flows"
class Failed extends Error { constructor(readonly code: string) { super("failed") } }
class Denied extends Error { constructor(readonly reason: string) { super("denied") } }
${body}
`
  const forms = {
    "a returned Action.run": `
class Pick extends Action<(input: { key: string }) => Result<{ value: string }, Failed | Denied>> {}
export const Build = durable((input: { key: string }) => {
  return Pick.run({ key: input.key })
})`,
    "a fanOut step": `
class Pick extends Action<(input: { id: string }) => Result<{ value: string }, Failed | Denied>> {}
export const Build = durable((input: { ids: readonly string[] }) => {
  return fanOut(input.ids, (id) => id, (id) => Pick.run({ id }))
})`,
    "a loopWhile body": `
class Pick extends Action<(input: { more: boolean }) => Result<{ more: boolean }, Failed | Denied>> {}
export const Build = durable((input: { more: boolean }) => {
  return loopWhile({ more: input.more }, (state) => state.more, (state) => Pick.run({ more: state.more }), 8)
})`
  } as const

  for (const [label, body] of Object.entries(forms)) {
    const compiled = compileDurableSource(benign(body), { fileName: "flows/orders.sm" })
    if (!compiled.ok) throw new Error(`${label} must still compile: ${JSON.stringify(compiled.diagnostics)}`)
    expect(compiled.plan.actions.length, label).toBe(1)
  }

  // The other direction of the same guard: a genuinely higher-order call must
  // still draw the REAL SMITHERS4112, whose sentence is true of it.
  const higherOrder = compileDurableSource(`
import { durable } from "smithers:flows"
const identity = <T,>(value: T): T => value
export const Build = durable((input: { key: string }) => {
  return identity({ key: input.key })
})
`, { fileName: "flows/orders.sm" })
  expect(higherOrder.ok).toBe(false)
  if (higherOrder.ok) throw new Error("a higher-order call must be refused")
  expect(higherOrder.diagnostics[0].code).toBe("SMITHERS4112")
  expect(higherOrder.diagnostics[0].message).toContain("higher-order and dynamic calls")
})

test("a Flow-output projection defect is refused even when the Flow also uses a legacy Action artifact", async () => {
  // The fail-open this pins: `flowSchemas` used to catch EVERY failure of the
  // Flow-success descriptor walk and, if `actions.some(a => a.successSchema.shape
  // !== "structural")`, discard it and compile the Flow with the weaker
  // `json-value` contract and NO diagnostic. The guard asked "does this Flow
  // contain a legacy Action", not "is THIS failure caused by one" — so a
  // projection the output genuinely does not have was swallowed whenever a
  // legacy `Action.define` artifact happened to be bound. `.length` is the
  // sharpest spelling: TypeScript accepts it on an array, the durable descriptor
  // has no such field, and `pathValue` in the engine refuses a non-numeric part
  // on an array at run time. So the Flow compiled clean and then FAULTED, which
  // is the whole cost of the swallow.
  const defective = `
import { durable } from "smithers:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { source: string; items: readonly string[] }) {
  const compiled = Compile.run({ source: input.source })!
  return { code: compiled.code, count: input.items.length }
})
`
  const refused = compileRepresentative(defective)
  expect(refused.ok).toBe(false)
  if (refused.ok) throw new Error("a projection the output does not have must be refused")
  expect(refused.diagnostics[0].code).toBe("SMITHERS4110")
  expect(refused.diagnostics[0].message).toContain("Flow output cannot project length from durable array")

  // Traversal order must not decide it. `code` sorts before `count`, so the
  // legitimately weak legacy leg is visited FIRST above; here the defect is
  // visited first. A first-failure-wins walk passes one of these two and fails
  // the other, which is the same fail-open wearing traversal order as a hat.
  const reordered = compileRepresentative(`
import { durable } from "smithers:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { source: string; items: readonly string[] }) {
  const compiled = Compile.run({ source: input.source })!
  return { aaa: input.items.length, zzz: compiled.code }
})
`)
  expect(reordered.ok).toBe(false)
  if (reordered.ok) throw new Error("the defect must be found whichever leg is walked first")
  expect(reordered.diagnostics[0].code).toBe("SMITHERS4110")
  expect(reordered.diagnostics[0].message).toContain("Flow output cannot project length from durable array")

  // The same program with no legacy artifact anywhere was ALREADY refused, and
  // must still be refused at the same code with the same sentence: the repair
  // removed a difference, it did not add a rule.
  const noLegacyArtifact = compileDurableSource(`
import { durable, Action } from "smithers:flows"
class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { key: string; items: readonly string[] }) => {
  const found = Lookup.run({ key: input.key })!
  return { value: found.value, count: input.items.length }
})
`, { fileName: "flows/orders.sm" })
  expect(noLegacyArtifact.ok).toBe(false)
  if (noLegacyArtifact.ok) throw new Error("a projection defect must be refused without a legacy artifact too")
  expect(noLegacyArtifact.diagnostics[0].code).toBe("SMITHERS4110")
  expect(noLegacyArtifact.diagnostics[0].message).toContain("Flow output cannot project length from durable array")
})

test("the legacy Action.define compatibility path still compiles, and still runs", async () => {
  // The over-correction this repair could ship, and the reason the catch is
  // narrowed rather than deleted: a Flow whose success descriptor genuinely
  // cannot be derived BECAUSE an Action's success schema is non-structural must
  // still compile, stating the weaker contract explicitly. All four legs that
  // read a success schema are exercised, because each has its own `fail` site.
  const legacyForms = {
    "a returned Action.run": `
import { durable } from "smithers:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { source: string }) {
  const compiled = Compile.run({ source: input.source })!
  return { code: compiled.code }
})`,
    "a branch join": `
import { durable } from "smithers:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { source: string; pick: boolean }) {
  return input.pick ? Compile.run({ source: input.source }) : Compile.run({ source: "fallback" })
})`,
    "a fanOut": `
import { durable, fanOut } from "smithers:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { items: readonly string[] }) {
  const seen = fanOut(input.items, (item) => item, (item) => Compile.run({ source: item }))
  return { seen }
})`,
    "a loopWhile": `
import { durable, loopWhile } from "smithers:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { source: string }) {
  const final = loopWhile({ source: input.source }, (state) => state.source !== "", (state) => Compile.run({ source: state.source }), 4)
  return { final }
})`
  } as const

  for (const [label, source] of Object.entries(legacyForms)) {
    const compiled = compileRepresentative(source)
    if (!compiled.ok) throw new Error(`${label} must still compile: ${JSON.stringify(compiled.diagnostics)}`)
    // The weaker contract is STATED, not silently structural.
    expect(compiled.plan.flowSchemas?.success.shape, label).toBe("json-value")
  }

  // And the weakened Flow is not merely accepted — it executes.
  const compiled = compileRepresentative(legacyForms["a returned Action.run"])
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const CompileLive = Provider.provide(Compile, ({ source }) => ({ code: `compiled:${source}` }), {
    implementationId: "legacy-compat-live",
    implementationVersion: "1"
  })
  const deployment = Deployment.build({
    id: "legacy-compat",
    flow: compiled.flow,
    pools: [Worker.pool("legacy-compat-worker", { target: "typescript-bun", providers: [CompileLive] })]
  })
  const store = new DurableStore()
  try {
    expect(await new DurableExecutor(deployment, store).execute(
      { source: "hi" },
      { executionId: "legacy-compat" }
    )).toEqual({ code: "compiled:hi" })
  } finally {
    store.close()
  }
})
