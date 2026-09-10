import { expect, test } from "bun:test"
import { loadDurableBody } from "./body-artifact.ts"
import {
  Action,
  compileActionContract,
  compileDurableFlow,
  compileDurableSource,
  Deployment,
  DurableExecutor,
  DurableStore,
  PlanUnrepresentable,
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
import { durable as lowerDurable } from "vibelang:flows"
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

const REPRESENTATIVE_OPTIONS = {
  fileName: "flows/build.vibe.ts",
  flowId: "test/source/Build",
  flowVersion: 3,
  actions: actionBindings
} as const

const compileRepresentative = (source = representativeSource) =>
  compileDurableSource(source, REPRESENTATIVE_OPTIONS)

/**
 * The same program through the **Flow** compiler.
 *
 * `compileDurableSource` answers "what Plan does this lower to?" and, since
 * `MIGRATION-PLAN.md` step 11 withdrew the six walls, raises
 * {@link PlanUnrepresentable} for a body that has no Plan rather than refusing
 * it. Every test below that asks "is this program refused?" has to ask the
 * entry point whose answer is a verdict, which is this one.
 */
const compileRepresentativeFlow = (source = representativeSource) =>
  compileDurableFlow(source, REPRESENTATIVE_OPTIONS)

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
import { durable } from "vibelang:flows"
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
import { Action } from "vibelang:flows"
interface Input { readonly value: number }
interface Output { readonly value: number; readonly selected: "action" }
class Rejected extends Error { constructor(readonly code: string) { super(code) } }
export abstract class Work extends Action<(input: Input) => Result<Output, Rejected>> {}
`, {
    fileName: "contracts/branch-work.vibe",
    exportName: "Work",
    id: "test/source/BranchWork",
    version: 1
  })
  if (!action.ok) throw new Error(JSON.stringify(action.diagnostics))
  const compiled = compileDurableSource(`
import { durable } from "vibelang:flows"
import { Work } from "test:branch-actions"
export const Branch = durable(function Branch(input: { value: number; chooseInput: boolean }) {
  return (input.chooseInput
    ? Work.run({ value: input.value })!
    : Work.run({ value: 0 })!).value
})
`, {
    fileName: "flows/structural-branch.vibe",
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
import * as Flows from "vibelang:flows"
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
import { durable } from "vibelang:flows"
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
  const unrelatedDurable = compileRepresentativeFlow(`
import { durable as compilerDurable } from "vibelang:flows"
function durable(value: unknown) { return value }
const Build = durable(function (input: unknown) { return input })
void compilerDurable
`)
  expect(unrelatedDurable.ok).toBe(false)
  if (unrelatedDurable.ok) throw new Error("expected unrelated durable spelling to fail")
  expect(unrelatedDurable.diagnostics[0].code).toBe("VIBE4102")

  const unrelatedAction = compileRepresentativeFlow(`
import { durable } from "vibelang:flows"
import { Compile as ImportedCompile } from "test:source-actions"
const Compile = { run(value: unknown) { return value } }
export const Build = durable(function Build(input: { source: string }) {
  return Compile.run({ source: input.source })
})
void ImportedCompile
`)
  // A checked local method is ordinary code, never an Action by spelling.
  // Its declared unknown return cannot cross the durable output boundary.
  expect(unrelatedAction.ok).toBe(false)
  if (unrelatedAction.ok) throw new Error("expected unrelated Action spelling to fail")
  expect(unrelatedAction.diagnostics[0].code).toBe("VIBE4110")
  expect(unrelatedAction.diagnostics[0].message).toContain("Flow output")

  const duplicateIntrinsic = compileRepresentativeFlow(`
import { durable } from "vibelang:flows"
const durable = (value: unknown) => value
export const Build = durable(function (input: unknown) { return input })
`)
  expect(duplicateIntrinsic.ok).toBe(false)
  if (duplicateIntrinsic.ok) throw new Error("expected conflicting intrinsic declaration to fail")
  expect(duplicateIntrinsic.diagnostics[0].code).toBe("VIBE4100")

  const duplicateAction = compileRepresentativeFlow(`
import { durable } from "vibelang:flows"
import { Compile } from "test:source-actions"
const Compile = { run(value: unknown) { return value } }
export const Build = durable(function Build(input: { source: string }) {
  return Compile.run({ source: input.source })
})
`)
  expect(duplicateAction.ok).toBe(false)
  if (duplicateAction.ok) throw new Error("expected conflicting Action declaration to fail")
  expect(duplicateAction.diagnostics[0].code).toBe("VIBE4100")
})

test("type-only, optional, and mutable bindings cannot impersonate static intrinsics", () => {
  const typeOnlyIntrinsic = compileRepresentativeFlow(`
import type * as Flows from "vibelang:flows"
export const Build = Flows.durable(function Build(input: unknown) { return input })
`)
  expect(typeOnlyIntrinsic.ok).toBe(false)
  if (typeOnlyIntrinsic.ok) throw new Error("expected type-only intrinsic failure")
  expect(typeOnlyIntrinsic.diagnostics[0].code).toBe("VIBE4102")

  const typeOnlyAction = compileRepresentativeFlow(`
import { durable } from "vibelang:flows"
import type * as Actions from "test:source-actions"
export const Build = durable(function Build(input: { source: string }) {
  return Actions.Compile.run({ source: input.source })
})
`)
  expect(typeOnlyAction.ok).toBe(false)
  if (typeOnlyAction.ok) throw new Error("expected type-only Action failure")
  // Same move as the unrelated-Action case above: the wall is gone and the
  // Manifest's soundness rule is what refuses it now.
  expect(typeOnlyAction.diagnostics[0].code).toBe("VIBE4199")

  const optionalIntrinsic = compileRepresentativeFlow(`
import { durable } from "vibelang:flows"
export const Build = durable?.(function Build(input: unknown) { return input })
`)
  expect(optionalIntrinsic.ok).toBe(false)
  if (optionalIntrinsic.ok) throw new Error("expected optional intrinsic failure")
  expect(optionalIntrinsic.diagnostics[0].code).toBe("VIBE4103")

  const reassignedFunction = compileRepresentativeFlow(`
import { durable } from "vibelang:flows"
import { Compile as C } from "test:source-actions"
function build(input: { source: string }) { return C.run({ source: input.source }) }
build = function replacement(input: { source: string }) { return C.run({ source: "replacement" }) }
export const Build = durable(build)
`)
  expect(reassignedFunction.ok).toBe(false)
  if (reassignedFunction.ok) throw new Error("expected assigned function failure")
  expect(reassignedFunction.diagnostics[0].code).toBe("VIBE4103")

  const mutableFunction = compileRepresentativeFlow(`
import { durable } from "vibelang:flows"
import { Compile as C } from "test:source-actions"
let build = (input: { source: string }) => C.run({ source: input.source })
export const Build = durable(build)
`)
  expect(mutableFunction.ok).toBe(false)
  if (mutableFunction.ok) throw new Error("expected mutable function failure")
  expect(mutableFunction.diagnostics[0].code).toBe("VIBE4103")
})

/**
 * The bodies the PLAN cannot hold, and the bodies the durable contract refuses.
 *
 * These were one list until 2026-08-31, under one heading, and that was the
 * confusion `MIGRATION-PLAN.md` step 11 removed. Five of the eight were WALLS:
 * `VIBE4106` on a branch, `VIBE4107` on a loop, `VIBE4112` on a
 * call the Plan could not name. They refused ordinary TypeScript because a
 * never-executed lowering had no node kind for it, and
 * `specification/durable-execution.mdx` §Flow now says such a body "MUST
 * execute unchanged inside a Flow". They are withdrawn.
 *
 * The other three are CONTRACT rules — a mutable binding, a capture the durable
 * boundary cannot encode, an intermediate Result left unconsumed — and they are
 * untouched, which is what keeps the withdrawal from being a general
 * relaxation.
 */
const planDeclinedBodies = [
  {
    was: "VIBE4106",
    body: `if (input.source) return C.run({ source: input.source })\n  return C.run({ source: "empty" })`
  },
  {
    was: "VIBE4106",
    body: `return input.source ? C.run({ source: input.source }) : C.run({ source: "empty" })`
  },
  {
    was: "VIBE4106",
    body: `return C.run({ source: input?.source })`
  },
  {
    was: "VIBE4107",
    body: `for (const value of []) { void value }\n  return C.run({ source: input.source })`
  }
] as const

test("the bodies the Plan cannot hold are declined without a diagnostic and publish an Effect Manifest", () => {
  for (const fixture of planDeclinedBodies) {
    const source = `
import { durable } from "vibelang:flows"
import { Compile as C } from "test:source-actions"
export const Build = durable(function Build(input: { source: string }) {
  ${fixture.body}
})
`
    // The Plan compiler SIGNALS rather than reports. A diagnostic here — under
    // `fixture.was` or any other code — is a wall being rebuilt.
    let raised: unknown
    try {
      compileRepresentative(source)
    } catch (error) {
      raised = error
    }
    expect(raised, fixture.was).toBeInstanceOf(PlanUnrepresentable)

    // And the Flow compiler publishes the artifact that CAN hold it. The
    // Manifest still names `Compile`, so nothing was dropped along with the
    // Plan: the two arms of the branch and the body of the loop are all just
    // children of a syntactic descent.
    const flow = compileDurableFlow(source, {
      fileName: "flows/build.vibe.ts",
      flowId: "test/source/Build",
      flowVersion: 3,
      actions: actionBindings
    })
    expect(flow.ok, fixture.was).toBe(true)
    if (!flow.ok) continue
    expect(flow.plan).toBeUndefined()
    expect(flow.flow.artifactSource).toBe("effect-manifest")
    expect(flow.manifest?.actions.map((action) => action.id)).toEqual(["test/source/Compile"])
  }
})

test("durable contract refusals fail closed at stable source locations", () => {
  const cases = [
    {
      code: "VIBE4105",
      body: `let request = { source: input.source }\n  return C.run(request)`
    },
    {
      code: "VIBE4110",
      prefix: `const captured = "outside"\n`,
      body: `return C.run({ source: captured })`
    },
    {
      code: "VIBE4115",
      body: `const result = C.run({ source: input.source })\n  return result`
    }
  ] as const

  for (const fixture of cases) {
    const source = `
import { durable } from "vibelang:flows"
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
    expect(first.diagnostics[0].file).toBe("flows/build.vibe.ts")
    expect(first.diagnostics[0].line).toBeGreaterThan(0)
    expect(first.diagnostics[0].column).toBeGreaterThan(0)
    expect(first.diagnostics[0].length).toBeGreaterThan(0)
  }
})

test("syntax errors fail closed as stable VIBE4100 diagnostics", () => {
  const source = `
import { durable } from "vibelang:flows"
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
  expect(first.diagnostics[0].code).toBe("VIBE4100")
})

test("same-file Action declarations are derived from the checked program without descriptor bindings", () => {
  const source = `
import { durable, Action, sequential } from "vibelang:flows"

class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
class Audit extends Action<(input: { value: string }) => Result<{ saved: boolean }, Error>> {}

export const Build = durable((input: { key: string }) => {
  const found = Lookup.run({ key: input.key })!
  const pair = sequential(Lookup.run({ key: found.value }), Audit.run({ value: found.value }))
  return { found, pair }
})
`
  const compiled = compileDurableSource(source, { fileName: "flows/orders.vibe" })
  const repeated = compileDurableSource(source, { fileName: "flows/orders.vibe" })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok || !repeated.ok) throw new Error(JSON.stringify(compiled.ok ? [] : compiled.diagnostics))

  // The Action identity is anchored on the authored file name, not on the
  // TypeScript-normalized one, so it matches every other compiler for this
  // language.
  expect(compiled.plan.requirements).toEqual([
    "flows/orders.vibe#Audit",
    "flows/orders.vibe#Lookup"
  ])
  expect(compiled.plan.nodes.map((node) => node.kind)).toEqual(["action", "action", "action"])
  expect(compiled.plan.digest).toBe(repeated.plan.digest)

  // The input/success contracts are the authored ones, structurally derived.
  const lookup = compiled.plan.actions.find((action) => action.id === "flows/orders.vibe#Lookup")
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
import { Action } from "vibelang:flows"
export class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, LookupFailed>> {}
export class LookupFailed extends Error {
  constructor(readonly key: string) { super("missing") }
}
`
  const separate = compileActionContract(declaration, {
    fileName: "flows/orders.vibe",
    exportName: "Lookup",
    id: "flows/orders.vibe#Lookup",
    version: 1
  })
  expect(separate.ok).toBe(true)
  if (!separate.ok) throw new Error(JSON.stringify(separate.diagnostics))

  const compiled = compileDurableSource(`${declaration}
import { durable } from "vibelang:flows"
export const Build = durable((input: { key: string }) => {
  return Lookup.run({ key: input.key })
})
`, { fileName: "flows/orders.vibe" })
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const derived = compiled.plan.actions.find((action) => action.id === "flows/orders.vibe#Lookup")
  expect(derived).toEqual(separate.descriptor)
})

test("a same-file Action input mismatch stays a checked contract error, not a silent Plan", () => {
  const compiled = compileDurableSource(`
import { durable, Action } from "vibelang:flows"

class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}

export const Build = durable((input: { key: number }) => {
  return Lookup.run({ key: input.key })
})
`, { fileName: "flows/orders.vibe" })
  expect(compiled.ok).toBe(false)
  if (compiled.ok) throw new Error("expected a contract failure")
  expect(compiled.diagnostics[0].code).toBe("VIBE4100")
  expect(compiled.diagnostics[0].file).toBe("flows/orders.vibe.ts")
})

test("descriptor bindings still describe Actions imported from other modules", () => {
  const compiled = compileRepresentative()
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.requirements).toEqual(["test/source/Compile", "test/source/Package"])
  expect(compiled.derivedActions).toEqual([])
})

test("an unrelated local class named Action never gains compiler authority", () => {
  const compiled = compileDurableFlow(`
import { durable } from "vibelang:flows"

class Action<Signature> {
  declare readonly signature: Signature
  static run(input: unknown): { unwrap(): unknown } { throw new Error("local") }
}
class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}

export const Build = durable((input: { key: string }) => {
  return Lookup.run({ key: input.key })
})
`, { fileName: "flows/orders.vibe" })
  expect(compiled.ok).toBe(false)
  if (compiled.ok) throw new Error("a local Action must not lower")
  // The local method is checked as ordinary authored code: throwing without
  // a Result channel is invalid. The spelling Action grants it no authority.
  expect(compiled.diagnostics[0].code).toBe("VIBE1101")
})

test("the durable source compiler derives native Error contracts without weakening unencodable failures", () => {
  const compileWithErrorChannel = (errorType: string) => compileDurableFlow(`
import { durable, Action } from "vibelang:flows"
class LookupFailed extends Error { constructor(readonly key: string) { super("missing") } }
class LooksLikeError { name = "LooksLikeError"; message = "not nominal" }
class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, ${errorType}>> {}
export const Build = durable((input: { key: string }) => {
  return Lookup.run({ key: input.key })
})
`, { fileName: "flows/orders.vibe" })

  const errorSchemaFor = (errorType: string) => {
    const compiled = compileWithErrorChannel(errorType)
    if (!compiled.ok) return { refused: true as const, code: compiled.diagnostics[0]?.code }
    if (!compiled.plan) throw new Error("expected a compatibility Plan for this straight-line fixture")
    const action = compiled.plan.actions.find((candidate) => candidate.id === "flows/orders.vibe#Lookup")
    if (action === undefined) return { refused: false as const, shape: "absent" }
    return { refused: false as const, shape: action.errorSchema.shape }
  }

  // Native Error uses the runtime's existing message codec. No untyped JSON
  // fallback is needed at either compiler entry point.
  expect(errorSchemaFor("Error")).toEqual({ refused: false, shape: "structural" })

  // A nominal failure class is described exactly, unweakened.
  expect(errorSchemaFor("LookupFailed")).toEqual({ refused: false, shape: "structural" })

  // "`any` and `unknown` MUST require an explicit codec at the boundary."
  // (Locked, same page.) A silent json-value contract is not an explicit codec.
  //
  // Go retains the underivable declaration's reason and reports the Action
  // contract error at its use, before attempting an independent Manifest.
  expect(errorSchemaFor("any")).toEqual({ refused: true, code: "VIBE4113" })

  // A structural impostor that does not extend Error is refused here for the
  // same reason `compileActionContract` already refuses it (see
  // `schema.test.ts`, "does not extend Error"). Two derivation entry points,
  // one answer on identical source.
  expect(errorSchemaFor("LooksLikeError")).toEqual({ refused: true, code: "VIBE4113" })
})

/**
 * `VIBE4124`: the collision has its own diagnostic, and the reason it needs
 * one is that the code it replaced was a *swallow artifact*.
 *
 * `deriveSameFileActions` skips a declaration whose contract it cannot derive.
 * For a colliding failure channel that left `Pick.run({ ... })` — an ordinary
 * compiler-bound Action call, with no higher-order call and no dynamic call
 * anywhere in the program — refused as VIBE4112, "higher-order and dynamic
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
 *
 * WHY SIBLING NAMESPACES, and not the `$Failed`/`_Failed` pair this fixture
 * carried until 2026-08-28. That pair was a collision only because
 * `stableIdentity` folded every character outside `[A-Za-z0-9._/@:+-]` onto `_`;
 * `durableFailureIdentity` escapes both components reversibly, so the two names
 * now mint two identities and the program is ordinary, legal source —
 * `durable-failure-identity.test.ts` pins that, and the benign test below holds
 * the same pair as a compiling program so the repair cannot silently regress
 * into a refusal again.
 *
 * The residual is what this fixture must be built on instead: the identity is a
 * function of (logical source file, class name), so two DIFFERENT declarations
 * sharing both collide under any injective encoding whatsoever. Sibling
 * namespaces are the smallest spelling of that in authored `.vibe`, and unlike the
 * old pair it is not something a better algorithm can take away. Note the
 * diagnostic now names one class twice — "Error classes Failed and Failed" —
 * which is exactly right: the two declarations really do have the same name.
 */
const collidingChannelSource = (body: string) => `
import { durable, Action, fanOut, loopWhile } from "vibelang:flows"
namespace Left  { export class Failed extends Error { constructor(readonly code: string) { super("left") } } }
namespace Right { export class Failed extends Error { constructor(readonly reason: string) { super("right") } } }
${body}
`

test("two Error classes under one durable failure identity draw VIBE4124, naming both classes", () => {
  const forms = {
    "a returned Action.run": `
class Pick extends Action<(input: { key: string }) => Result<{ value: string }, Left.Failed | Right.Failed>> {}
export const Build = durable((input: { key: string }) => {
  return Pick.run({ key: input.key })
})`,
    // The postfix-! path had its own false sentence — "postfix ! is supported
    // only directly on a compiler-bound Action.run(...) Result" — which is
    // exactly what this operand is.
    "an intermediate Action.run with postfix !": `
class Pick extends Action<(input: { key: string }) => Result<{ value: string }, Left.Failed | Right.Failed>> {}
class Tail extends Action<(input: { value: string }) => Result<{ out: string }, Left.Failed>> {}
export const Build = durable((input: { key: string }) => {
  const first = Pick.run({ key: input.key })!
  return Tail.run({ value: first.value })
})`,
    // "fanOut body must target one compiler-bound Action" — it does.
    "a fanOut step": `
class Pick extends Action<(input: { id: string }) => Result<{ value: string }, Left.Failed | Right.Failed>> {}
export const Build = durable((input: { ids: readonly string[] }) => {
  return fanOut(input.ids, (id) => id, (id) => Pick.run({ id }))
})`,
    // "loopWhile body must target one compiler-bound Action" — it does.
    "a loopWhile body": `
class Pick extends Action<(input: { more: boolean }) => Result<{ more: boolean }, Left.Failed | Right.Failed>> {}
export const Build = durable((input: { more: boolean }) => {
  return loopWhile({ more: input.more }, (state) => state.more, (state) => Pick.run({ more: state.more }), 8)
})`
  } as const

  for (const [label, body] of Object.entries(forms)) {
    const compiled = compileDurableSource(collidingChannelSource(body), { fileName: "flows/orders.vibe" })
    expect(compiled.ok, label).toBe(false)
    if (compiled.ok) throw new Error(`${label} must be refused`)
    expect(compiled.diagnostics.length, label).toBe(1)
    expect(compiled.diagnostics[0].code, label).toBe("VIBE4124")
    // The payload is the promise: a code alone would let the old sentence
    // survive under a new number, which is the renumbering accident this repair
    // exists to avoid.
    expect(compiled.diagnostics[0].message, label).toContain("Error classes Failed and Failed")
    expect(compiled.diagnostics[0].message, label).toContain("share one durable failure identity")
    expect(compiled.diagnostics[0].message, label).not.toContain("higher-order")
  }
})

test("a channel whose names only used to normalize together now compiles", () => {
  // RED BEFORE THE FIX, and the exact program the corpus case
  // `17-durable/two-error-classes-whose-durable-identities-collide-are-rejected`
  // refused until 2026-08-28. `stableIdentity` folded `$` onto `_`, so `$Failed`
  // and `_Failed` were one identity and this drew VIBE4124 on both backends.
  // The refusal was the right verdict for the identity it had; escaping the
  // class name instead of folding it makes the program ordinary.
  //
  // It is held here, as a COMPILING program with two Action failure variants,
  // so that a future edit which re-narrows the escape cannot quietly restore the
  // refusal and still be green.
  const compiled = compileDurableSource(`
import { durable, Action } from "vibelang:flows"
class $Failed extends Error { constructor(readonly code: string) { super("dollar") } }
class _Failed extends Error { constructor(readonly reason: string) { super("under") } }
class Pick extends Action<(input: { key: string }) => Result<{ value: string }, $Failed | _Failed>> {}
export const Build = durable((input: { key: string }) => {
  return Pick.run({ key: input.key })
})
`, { fileName: "flows/orders.vibe" })
  if (!compiled.ok) throw new Error(`must compile: ${JSON.stringify(compiled.diagnostics)}`)
  const schema = compiled.plan.actions[0]!.errorSchema
  if (schema.shape !== "structural" || schema.descriptor.kind !== "union") throw new Error("expected an Error union")
  expect(schema.descriptor.variants.map((variant) => {
    if (variant.kind !== "error") throw new Error("expected an Error variant")
    return variant.identity
  })).toEqual([
    "vibelang:flows/orders.vibe@+0024Failed@1",
    "vibelang:flows/orders.vibe@_Failed@1"
  ])
})

test("VIBE4124 fires on a COLLISION, not on two Error classes", () => {
  // The over-correction this repair could ship: a check that refuses any
  // two-class failure channel. Two DECLARATIONS sharing (file, class name)
  // collide; `Failed`/`Denied` do not, and every form above must still compile.
  const benign = (body: string) => `
import { durable, Action, fanOut, loopWhile } from "vibelang:flows"
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
    const compiled = compileDurableSource(benign(body), { fileName: "flows/orders.vibe" })
    if (!compiled.ok) throw new Error(`${label} must still compile: ${JSON.stringify(compiled.diagnostics)}`)
    expect(compiled.plan.actions.length, label).toBe(1)
  }

  // A generic local helper is ordinary executable code, not an opaque effect.
  const higherOrder = compileDurableFlow(`
import { durable } from "vibelang:flows"
const identity = <T,>(value: T): T => value
export const Build = durable((input: { key: string }) => {
  return identity({ key: input.key })
})
`, { fileName: "flows/orders.vibe" })
  expect(higherOrder.ok).toBe(true)
  if (!higherOrder.ok || !higherOrder.flow.body) throw new Error("expected an executable body")
  expect(higherOrder.flow.body.manifest.actions).toEqual([])
  expect(loadDurableBody(higherOrder.flow.body).create({ key: "ordinary" }).computation.next()).toEqual({
    done: true, value: { key: "ordinary" },
  })
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
import { durable } from "vibelang:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { source: string; items: readonly string[] }) {
  const compiled = Compile.run({ source: input.source })!
  return { code: compiled.code, count: input.items.length }
})
`
  const refused = compileRepresentative(defective)
  expect(refused.ok).toBe(false)
  if (refused.ok) throw new Error("a projection the output does not have must be refused")
  expect(refused.diagnostics[0].code).toBe("VIBE4110")
  expect(refused.diagnostics[0].message).toContain("Flow output cannot project length from durable array")

  // Traversal order must not decide it. `code` sorts before `count`, so the
  // legitimately weak legacy leg is visited FIRST above; here the defect is
  // visited first. A first-failure-wins walk passes one of these two and fails
  // the other, which is the same fail-open wearing traversal order as a hat.
  const reordered = compileRepresentative(`
import { durable } from "vibelang:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { source: string; items: readonly string[] }) {
  const compiled = Compile.run({ source: input.source })!
  return { aaa: input.items.length, zzz: compiled.code }
})
`)
  expect(reordered.ok).toBe(false)
  if (reordered.ok) throw new Error("the defect must be found whichever leg is walked first")
  expect(reordered.diagnostics[0].code).toBe("VIBE4110")
  expect(reordered.diagnostics[0].message).toContain("Flow output cannot project length from durable array")

  // The same program with no legacy artifact anywhere was ALREADY refused, and
  // must still be refused at the same code with the same sentence: the repair
  // removed a difference, it did not add a rule.
  const noLegacyArtifact = compileDurableSource(`
import { durable, Action } from "vibelang:flows"
class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { key: string; items: readonly string[] }) => {
  const found = Lookup.run({ key: input.key })!
  return { value: found.value, count: input.items.length }
})
`, { fileName: "flows/orders.vibe" })
  expect(noLegacyArtifact.ok).toBe(false)
  if (noLegacyArtifact.ok) throw new Error("a projection defect must be refused without a legacy artifact too")
  expect(noLegacyArtifact.diagnostics[0].code).toBe("VIBE4110")
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
import { durable } from "vibelang:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { source: string }) {
  const compiled = Compile.run({ source: input.source })!
  return { code: compiled.code }
})`,
    "a branch join": `
import { durable } from "vibelang:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { source: string; pick: boolean }) {
  return input.pick ? Compile.run({ source: input.source }) : Compile.run({ source: "fallback" })
})`,
    "a fanOut": `
import { durable, fanOut } from "vibelang:flows"
import { Compile } from "test:source-actions"
export const Build = durable(function Build(input: { items: readonly string[] }) {
  const seen = fanOut(input.items, (item) => item, (item) => Compile.run({ source: item }))
  return { seen }
})`,
    "a loopWhile": `
import { durable, loopWhile } from "vibelang:flows"
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

// ---------------------------------------------------------------------------
// The Flow OUTPUT was only half the rule.
//
// `flowSuccessDescriptor` walked the output expression and nothing else, so the
// same projection defect placed in an ACTION INPUT reached no descriptor at all:
//
//   class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
//   export const Flow = durable((input: { items: readonly string[] }) => {
//     return Step.run({ key: input.items.length })
//   })
//
// Measured before this check existed: that program compiled with zero
// diagnostics, deployed, executed — and then FAULTED, with `DurableActionDefect`
// wrapping `{"_tag":"ProjectionDefect","path":["items","length"]}` raised by
// `pathValue` (engine.ts:209) while evaluating the Action's input. A
// compile-time-knowable error deferred into a runtime defect, exactly as the
// Flow-output fail-open above did. The Go fork shared it: it compiled and ran
// the same source, and the Plan it emitted carries the same
// `{"kind":"input","path":["items","length"]}`.
//
// The repair is the SAME walk, not a second one: `planNodeValues` collects every
// value a Plan node consumes and `flowSchemas` hands each to
// `flowSuccessDescriptor` with its own subject. Every code, position and
// sentence below was measured against the Go fork on the same source text.
// ---------------------------------------------------------------------------

test("an Action-input projection defect is refused instead of being deferred into a runtime ProjectionDefect", () => {
  const flowInput = "{ items: readonly string[]; text: string; n: number; " +
    "obj: { a: string }; nested: { inner: { a: string } }; pair: readonly [string, number] }"
  // Spelling x position. Only spellings TypeScript itself accepts are here;
  // `input.obj.missing` draws TS2339 and `input.pair[5]` draws TS2493 long
  // before lowering, which is why `.length` is the sharp one.
  const cells: readonly { readonly name: string; readonly action: string; readonly body: string; readonly message: string }[] = [
    {
      name: "object literal field",
      action: "{ key: number }",
      body: "  return Step.run({ key: input.items.length })",
      message: "Action flows/orders.vibe#Step input cannot project length from durable array"
    },
    {
      name: "bare argument",
      action: "number",
      body: "  return Step.run(input.items.length)",
      message: "Action flows/orders.vibe#Step input cannot project length from durable array"
    },
    {
      name: "nested object field",
      action: "{ outer: { key: number } }",
      body: "  return Step.run({ outer: { key: input.items.length } })",
      message: "Action flows/orders.vibe#Step input cannot project length from durable array"
    },
    {
      name: "array literal element",
      action: "{ keys: readonly number[] }",
      body: "  return Step.run({ keys: [input.items.length] })",
      message: "Action flows/orders.vibe#Step input cannot project length from durable array"
    },
    {
      name: "projection of a prior const binding",
      action: "{ key: number }",
      body: "  const c = input.items\n  return Step.run({ key: c.length })",
      message: "Action flows/orders.vibe#Step input cannot project length from durable array"
    },
    {
      name: "bare identifier bound to the projection",
      action: "{ key: number }",
      body: "  const n = input.items.length\n  return Step.run({ key: n })",
      message: "Action flows/orders.vibe#Step input cannot project length from durable array"
    },
    {
      name: "computed key spelling",
      action: "{ key: number }",
      body: '  return Step.run({ key: input.items["length"] })',
      message: "Action flows/orders.vibe#Step input cannot project length from durable array"
    },
    {
      name: "projection through a durable string",
      action: "{ key: number }",
      body: "  return Step.run({ key: input.text.length })",
      message: "Action flows/orders.vibe#Step input cannot project length from durable string"
    },
    {
      name: "nested projection whose last component misses",
      action: "{ key: number }",
      body: "  return Step.run({ key: input.nested.inner.a.length })",
      message: "Action flows/orders.vibe#Step input cannot project length from durable string"
    },
    {
      // TypeScript types `pair.length` as the literal `2`, so nothing else
      // objects and the projection reaches the Plan.
      name: "non-numeric key on a durable tuple",
      action: "{ key: number }",
      body: "  return Step.run({ key: input.pair.length })",
      message: "Action flows/orders.vibe#Step input cannot project length from durable tuple"
    },
    {
      // Two defective fields whose SOURCE order is the reverse of their sorted
      // order. `flowSuccessDescriptor` visits `Object.keys(...).sort()`, so the
      // named defect is `alpha`'s and not `zulu`'s — and the Go fork's
      // `sortUTF16` chooses the same one, which is what lets one corpus case
      // pin one sentence for both backends. Measured on both: "durable string".
      name: "two defective fields, source order reversed from sorted order",
      action: "{ zulu: number; alpha: number }",
      body: "  return Step.run({ zulu: input.items.length, alpha: input.text.length })",
      message: "Action flows/orders.vibe#Step input cannot project length from durable string"
    },
    {
      // Not an Action input, but the same walk over the same question: a timer
      // duration is a value the Plan evaluates too, and it names its own node.
      name: "sleep duration",
      action: "{ key: string }",
      body: "  sleep(input.items.length)\n  return Step.run({ key: input.obj.a })",
      message: "sleep duration cannot project length from durable array"
    }
  ]

  for (const cell of cells) {
    const compiled = compileDurableSource(`
import { durable, Action, sleep } from "vibelang:flows"
class Step extends Action<(input: ${cell.action}) => Result<{ value: string }, Error>> {}
export const Build = durable((input: ${flowInput}) => {
${cell.body}
})
`, { fileName: "flows/orders.vibe" })
    if (compiled.ok) throw new Error(`${cell.name}: an Action input the descriptor cannot answer must be refused`)
    expect(compiled.diagnostics[0].code, cell.name).toBe("VIBE4110")
    expect(compiled.diagnostics[0].message, cell.name).toBe(
      `durable Flow boundary is not structurally encodable: ${cell.message}`
    )
    // Reported at the durable source function, which is where the Flow-output
    // rule reports and where the Go fork reports, so both name one position.
    expect([compiled.diagnostics[0].line, compiled.diagnostics[0].column], cell.name).toEqual([4, 30])
  }

  // The walk's other legs, reached from an Action INPUT rather than an output.
  // These are the cells that show the check reuses the descriptor walk instead
  // of re-deriving one that only understands the Flow input.
  const reuse: readonly { readonly name: string; readonly source: string; readonly message: string }[] = [
    {
      name: "a prior Action's success",
      source: `
import { durable, Action } from "vibelang:flows"
class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
class Second extends Action<(input: { key: number }) => Result<{ done: string }, Error>> {}
export const Build = durable((input: { key: string }) => {
  const first = Step.run({ key: input.key })!
  return Second.run({ key: first.value.length })
})
`,
      message: "Action flows/orders.vibe#Second input cannot project length from durable string"
    },
    {
      name: "a signal payload",
      source: `
import { durable, Action, waitSignal } from "vibelang:flows"
class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { key: string }) => {
  const ticket = waitSignal<{ token: string }>("build.approval")
  return Step.run({ key: ticket.token.length })
})
`,
      message: "Action flows/orders.vibe#Step input cannot project length from durable string"
    },
    {
      name: "an Action input inside a branch arm",
      source: `
import { durable, Action } from "vibelang:flows"
class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { flag: boolean; items: readonly string[]; n: number }) => {
  return input.flag ? Step.run({ key: input.items.length }) : Step.run({ key: input.n })
})
`,
      message: "Action flows/orders.vibe#Step input cannot project length from durable array"
    },
    {
      name: "a sequential argument",
      source: `
import { durable, Action, sequential } from "vibelang:flows"
class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
class Second extends Action<(input: { key: string }) => Result<{ done: string }, Error>> {}
export const Build = durable((input: { items: readonly string[]; text: string }) => {
  const pair = sequential(Step.run({ key: input.items.length }), Second.run({ key: input.text }))
  return { pair }
})
`,
      message: "Action flows/orders.vibe#Step input cannot project length from durable array"
    },
    {
      // `loopWhile`'s initial state is a Plan value too. This one was ALREADY
      // refused before the node walk, by the OUTPUT walk, because the loop
      // node's descriptor joins the initial state into the Flow's output — and
      // the output-first ordering is what keeps its sentence unchanged.
      name: "a loopWhile initial state",
      source: `
import { durable, Action, loopWhile } from "vibelang:flows"
class Step extends Action<(input: { n: number }) => Result<{ n: number }, Error>> {}
export const Build = durable((input: { items: readonly string[] }) => {
  const final = loopWhile({ n: input.items.length }, (state) => state.n > 0, (state) => Step.run({ n: state.n }), 4)
  return { final }
})
`,
      message: "Flow output cannot project length from durable array"
    }
  ]
  // `fanOut` items has no cell: its expression must type as an array, and every
  // projection a durable descriptor cannot answer types as something else, so
  // TypeScript refuses first (measured: VIBE4100, "Argument of type
  // 'undefined' is not assignable to parameter of type 'readonly unknown[]'").
  // The position IS walked — the digest pin below is the evidence — but no
  // authored program can reach a defect in it.
  for (const probe of reuse) {
    const compiled = compileDurableSource(probe.source, { fileName: "flows/orders.vibe" })
    if (compiled.ok) throw new Error(`${probe.name}: the defect must be refused`)
    expect(compiled.diagnostics[0].code, probe.name).toBe("VIBE4110")
    expect(compiled.diagnostics[0].message, probe.name).toBe(
      `durable Flow boundary is not structurally encodable: ${probe.message}`
    )
  }

  // A defect in an Action input outranks the legacy weak-contract excuse in
  // exactly the way one in the output does. Without the cause split reaching
  // the node walk, the legacy artifact below would swallow it and this Flow
  // would compile with `json-value` and no diagnostic.
  const legacy = compileRepresentative(`
import { durable, Action } from "vibelang:flows"
import { Compile } from "test:source-actions"
class Package extends Action<(input: { code: number }) => Result<{ artifact: string }, Error>> {}
export const Build = durable(function Build(input: { source: string; items: readonly string[] }) {
  const compiled = Compile.run({ source: input.source })!
  return Package.run({ code: input.items.length })
})
`)
  if (legacy.ok) throw new Error("a defect must outrank a legacy artifact on the input path too")
  expect(legacy.diagnostics[0].code).toBe("VIBE4110")
  expect(legacy.diagnostics[0].message).toContain(
    "Action flows/build.vibe.ts#Package input cannot project length from durable array"
  )
})

test("a Flow with defects in both its output and a node input still names the output's", () => {
  // The one place this addition could have changed an answer for a program that
  // ALREADY refused. `flowSchemas` searches the output's failures before any
  // node's, so a program that refused before the node walk existed keeps its
  // exact sentence; the addition is strictly narrowing.
  const compiled = compileDurableSource(`
import { durable, Action } from "vibelang:flows"
class Step extends Action<(input: { key: number }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { items: readonly string[]; text: string }) => {
  const first = Step.run({ key: input.items.length })!
  return { v: first.value, n: input.text.length }
})
`, { fileName: "flows/orders.vibe" })
  if (compiled.ok) throw new Error("both defects must refuse the Flow")
  expect(compiled.diagnostics[0].code).toBe("VIBE4110")
  expect(compiled.diagnostics[0].message).toBe(
    "durable Flow boundary is not structurally encodable: Flow output cannot project length from durable string"
  )
})

test("a node input that reads a legacy Action's success keeps the Flow's structural output contract", () => {
  // The over-correction this repair could ship. The node walk records the SAME
  // `non-structural` cause the output walk does — that reuse is the point — so
  // merging the two failure lists would let a legacy leg reached only through an
  // Action's INPUT push a Flow whose OUTPUT is perfectly structural onto
  // `derivedSchema("success")`, changing its emitted schema and its Plan digest
  // for no authoring reason. The lists are kept apart, and this is the program
  // that says so: its digest was measured before the node walk existed.
  const compiled = compileRepresentative(`
import { durable, Action } from "vibelang:flows"
import { Compile } from "test:source-actions"
class Package extends Action<(input: { code: string }) => Result<{ artifact: string }, Error>> {}
export const Build = durable(function Build(input: { source: string }) {
  const compiled = Compile.run({ source: input.source })!
  return Package.run({ code: compiled.code })
})
`)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.flowSchemas?.success.shape).toBe("structural")
})

test("legitimate Action input Plans have deterministic checked contracts and still run", async () => {
  // Re-pinned when native Error acquired its exact nominal codec in place of
  // the old arbitrary-JSON failure channel.
  // Re-pinned again on 2026-09-05 when the source extension became `.vibe`: the
  // plan digest covers the file name (`flows/orders.vibe`), so every value moved. Input validation itself remains
  // observational: all seven accepted input forms still execute unchanged.
  const pinned: readonly { readonly name: string; readonly source: string; readonly digest: string }[] = [
    {
      name: "an Action input reading a prior Action success",
      source: `
import { durable, Action } from "vibelang:flows"
class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
class Second extends Action<(input: { key: string }) => Result<{ done: string }, Error>> {}
export const Build = durable((input: { key: string }) => {
  const first = Step.run({ key: input.key })!
  return Second.run({ key: first.value })
})
`,
      digest: "dcaad5def3f086c43c41e18d8ef824710cf61892424917fc3d36c23d06a1d455"
    },
    {
      name: "an Action input reading a signal payload",
      source: `
import { durable, Action, waitSignal } from "vibelang:flows"
class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { key: string }) => {
  const ticket = waitSignal<{ token: string }>("build.approval")
  return Step.run({ key: ticket.token })
})
`,
      digest: "2b926b0f8c002e6a41ec8ae65da9db134757f2da8be74b87d4b5e317a7b6366c"
    },
    {
      name: "Action inputs inside both branch arms",
      source: `
import { durable, Action } from "vibelang:flows"
class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { flag: boolean; key: string; other: string }) => {
  return input.flag ? Step.run({ key: input.key }) : Step.run({ key: input.other })
})
`,
      digest: "76f11dc2c55dbc8948ed6bd18e197a81550ce0b7a63c2576dfaf705ce77d1644"
    },
    {
      name: "a literal sleep duration beside an Action input",
      source: `
import { durable, Action, sleep } from "vibelang:flows"
class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { key: string }) => {
  sleep(25)
  return Step.run({ key: input.key })
})
`,
      digest: "e1a490d23c10fc6c66726f605391894f9c996f1f38ab1a1ad6ba9c2769319b62"
    },
    {
      name: "an Action input holding a nested object and an array literal",
      source: `
import { durable, Action } from "vibelang:flows"
class Step extends Action<(input: { outer: { key: string }; keys: readonly string[] }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { a: string; b: string }) => {
  return Step.run({ outer: { key: input.a }, keys: [input.a, input.b] })
})
`,
      digest: "8277d787ad345f00c49753813c5d1f98c3a5ca7e8c58f037e4bec64e0864fe08"
    },
    {
      name: "a fanOut whose items project the Flow input",
      source: `
import { durable, Action, fanOut } from "vibelang:flows"
class Step extends Action<(input: { source: string }) => Result<{ code: string }, Error>> {}
export const Build = durable((input: { items: readonly string[] }) => {
  const seen = fanOut(input.items, (item) => item, (item) => Step.run({ source: item }))
  return { seen }
})
`,
      digest: "c386c5e1118f690ad7213d25e9aa77425a19385b1cbe55652dfed7bc3708c594"
    },
    {
      name: "a loopWhile whose initial state projects the Flow input",
      source: `
import { durable, Action, loopWhile } from "vibelang:flows"
class Step extends Action<(input: { source: string }) => Result<{ source: string }, Error>> {}
export const Build = durable((input: { source: string }) => {
  const final = loopWhile({ source: input.source }, (state) => state.source !== "", (state) => Step.run({ source: state.source }), 4)
  return { final }
})
`,
      digest: "847c260209e6627d841249c03f9c7eafd4a619c964d66025c9034520520ded5c"
    }
  ]

  for (const probe of pinned) {
    const compiled = compileDurableSource(probe.source, { fileName: "flows/orders.vibe" })
    if (!compiled.ok) throw new Error(`${probe.name}: ${JSON.stringify(compiled.diagnostics)}`)
    expect(compiled.plan.flowSchemas?.success.shape, probe.name).toBe("structural")
    expect(compiled.plan.digest, probe.name).toBe(probe.digest)
  }

  // And the accepted Flow is not merely compiled — it executes, with the
  // Action's input evaluated through the same `pathValue` that faulted before.
  const executable = compileDurableSource(`
import { durable, Action } from "vibelang:flows"
class Step extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
export const Build = durable((input: { items: readonly string[]; obj: { a: string } }) => {
  return Step.run({ key: input.obj.a })
})
`, { fileName: "flows/orders.vibe" })
  if (!executable.ok) throw new Error(JSON.stringify(executable.diagnostics))
  const descriptor = executable.plan.actions[0]
  const StepLive = Provider.provide(
    { descriptor } as never,
    ((value: { key: string }) => ({ value: `ran:${value.key}` })) as never,
    { implementationId: "node-input-live", implementationVersion: "1" }
  )
  const deployment = Deployment.build({
    id: "node-input-executable",
    flow: executable.flow,
    pools: [Worker.pool("node-input-worker", { target: "typescript-bun", providers: [StepLive] })]
  })
  const store = new DurableStore()
  try {
    expect(await new DurableExecutor(deployment, store).execute(
      { items: ["a"], obj: { a: "hello" } },
      { executionId: "node-input-executable" }
    )).toEqual({ value: "ran:hello" })
  } finally {
    store.close()
  }
})
