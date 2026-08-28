import { expect, test } from "bun:test"
import {
  Action,
  buildWorkerPoolBundle,
  compileActionContract,
  compileActionImplementationContract,
  compileDurableSource,
  decodeSignedDeploymentArtifact,
  Deployment,
  deploymentVerificationKey,
  digest,
  encodeSignedDeploymentArtifact,
  generateDeploymentSigningKeyPair,
  PlanArtifact,
  Provider,
  validateDeploymentManifest,
  validateWorkerPoolBundle,
  WorkerPoolBundles,
  Worker,
  type ActionDescriptor,
  type ActionProvider,
  type PlanTemplate
} from "./index.ts"

const HEX_DIGEST = /^[0-9a-f]{64}$/

interface CompiledImplementation {
  readonly action: ReturnType<typeof Action.fromDescriptor<{ value: number }, { value: number }, { code: string }>>
  readonly provider: ActionProvider<{ value: number }, { value: number }, { code: string }>
  readonly contract: ReturnType<typeof compileActionImplementationContract>
}

const compileWorkAction = (id: string, fileName: string): ActionDescriptor => {
  const compiled = compileActionContract(`
import { Action } from "smithers:flows"
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Work extends Action<
  (input: { value: number }) => Result<{ value: number }, Failed>
> {}
`, { fileName, exportName: "Work", id, version: 1 })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled.descriptor
}

const compileImplementation = (
  actionId: string,
  fileName: string,
  implementationId: string,
  marker: string
): CompiledImplementation => {
  const descriptor = compileWorkAction(actionId, fileName)
  const action = Action.fromDescriptor<{ value: number }, { value: number }, { code: string }>(descriptor)
  const hostCallback = (): never => {
    throw new Error("host implementation must not run on the bundle path")
  }
  const contract = compileActionImplementationContract({
    action: descriptor,
    implementationId,
    implementationVersion: "1",
    entryFile: fileName,
    exportName: "work",
    implementation: hostCallback,
    sources: [{
      fileName,
      source: `
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export function work(input: { value: number }): Result<{ value: number }, Failed> {
  if (input.value < 0) throw new Failed("${marker}")
  return { value: input.value + ${marker.length} }
}
`
    }]
  })
  const provider = Provider.provideChecked(action, hostCallback, {
    implementationId,
    implementationVersion: "1",
    implementationContract: contract,
    recovery: { mode: "repeatable", maxAttempts: 1 }
  })
  return { action, provider, contract }
}

const singleActionPlan = (action: ActionDescriptor, flowId: string): PlanTemplate => {
  const compiled = compileDurableSource(`
import { durable } from "smithers:flows"
import { Work } from "test:pool-bundle-actions"
export const Program = durable(function Program(input: { value: number }) {
  return Work.run({ value: input.value })
})
`, {
    fileName: "flows/pool-bundle.sm",
    flowId,
    flowVersion: 1,
    actions: [Object.freeze({
      moduleSpecifier: "test:pool-bundle-actions",
      exportName: "Work",
      descriptor: action
    })]
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled.plan
}

test("identical inputs produce byte-identical bundles with matching digests", () => {
  const first = compileImplementation("test/bundle/Det", "det-action.sm", "det-impl", "abc")
  const second = compileImplementation("test/bundle/Det", "det-action.sm", "det-impl", "abc")
  expect(second.contract.digest).toBe(first.contract.digest)
  const buildFrom = (implementation: CompiledImplementation) => buildWorkerPoolBundle({
    poolId: "det-pool",
    target: "typescript-bun",
    sandbox: "remote-http-poc",
    selections: [{ action: implementation.action.descriptor, contract: implementation.contract }]
  })
  const left = buildFrom(first)
  const right = buildFrom(second)
  expect(right.javascript).toBe(left.javascript)
  expect(right.digest).toBe(left.digest)
  expect(HEX_DIGEST.test(left.digest)).toBe(true)
  expect(left.digest).toBe(WorkerPoolBundles.sha256(left.javascript))
  expect(validateWorkerPoolBundle(left)).toEqual(left)
})

test("deployment bundles are tree-shaken to exactly the selected Actions", () => {
  const used = compileImplementation("test/bundle/Used", "used-action.sm", "used-impl", "usedmarker")
  const unused = compileImplementation("test/bundle/Unused", "unused-action.sm", "unused-impl", "unusedmarker")
  const plan = singleActionPlan(used.action.descriptor, "test/bundle/UsedFlow")
  const deployment = Deployment.build({
    id: "bundle-tree-shake",
    flow: PlanArtifact.load(PlanArtifact.encode(plan)),
    pools: [Worker.pool("bundle-pool", {
      target: "typescript-bun",
      sandbox: "remote-http-poc",
      bundle: true,
      providers: [used.provider, unused.provider]
    })]
  })
  const bundle = deployment.bundles.get("bundle-pool")
  if (bundle === undefined) throw new Error("expected a bundle for bundle-pool")
  expect(bundle.actionIds).toEqual(["test/bundle/Used"])
  expect(bundle.javascript).toContain("usedmarker")
  expect(bundle.javascript).not.toContain("unusedmarker")
  const poolManifest = deployment.manifest.pools.find((pool) => pool.id === "bundle-pool")
  expect(poolManifest?.bundleDigest).toBe(bundle.digest)
  // The bundle digest participates in the pool artifact digest and manifest digest.
  expect(poolManifest?.artifactDigest).toBeDefined()
})

test("the pool artifact digest changes when only the bundle digest changes", () => {
  const first = compileImplementation("test/bundle/Art", "art-action.sm", "art-impl", "one")
  const plan = singleActionPlan(first.action.descriptor, "test/bundle/ArtFlow")
  const flow = PlanArtifact.load(PlanArtifact.encode(plan))
  const withBundle = Deployment.build({
    id: "bundle-artifact",
    flow,
    pools: [Worker.pool("art-pool", {
      target: "typescript-bun",
      sandbox: "remote-http-poc",
      bundle: true,
      providers: [first.provider]
    })]
  })
  const withoutBundle = Deployment.build({
    id: "bundle-artifact",
    flow,
    pools: [Worker.pool("art-pool", {
      target: "typescript-bun",
      sandbox: "remote-http-poc",
      providers: [first.provider]
    })]
  })
  const bundled = withBundle.manifest.pools[0]!
  const plain = withoutBundle.manifest.pools[0]!
  expect(bundled.bundleDigest).toBeDefined()
  expect(plain.bundleDigest).toBeUndefined()
  expect(bundled.artifactDigest).not.toBe(plain.artifactDigest)
  expect(withBundle.manifest.digest).not.toBe(withoutBundle.manifest.digest)
})

test("bundle emission fails closed on legacy, unauthenticated, and capability-requiring providers", () => {
  const checked = compileImplementation("test/bundle/Closed", "closed-action.sm", "closed-impl", "closed")
  const plan = singleActionPlan(checked.action.descriptor, "test/bundle/ClosedFlow")

  // A legacy provider (no checked contract) cannot join a bundle pool.
  const legacyAction = Action.define<{ value: number }, { value: number }>({ id: "test/bundle/Closed", version: 1 })
  const legacyProvider = Provider.provide(legacyAction, (input) => input, {
    implementationId: "legacy-impl",
    implementationVersion: "1"
  })
  expect(() => Deployment.build({
    id: "bundle-legacy",
    flow: PlanArtifact.load(PlanArtifact.encode(plan)),
    pools: [Worker.pool("legacy-pool", {
      target: "typescript-bun",
      sandbox: "remote-http-poc",
      bundle: true,
      providers: [legacyProvider]
    })]
  })).toThrow(/version\/schema contract mismatch|no checked implementation contract/)

  // A serialized round trip loses in-process compiler authentication, so the
  // retained checked sources cannot be recovered for bundling.
  const serialized = JSON.parse(JSON.stringify(checked.contract))
  expect(() => buildWorkerPoolBundle({
    poolId: "forged-pool",
    target: "typescript-bun",
    sandbox: "remote-http-poc",
    selections: [{ action: checked.action.descriptor, contract: serialized }]
  })).toThrow("exact frozen contract")

  // A capability-requiring implementation cannot execute inside a bundle.
  const capabilityDescriptor = compileWorkAction("test/bundle/Cap", "cap-action.sm")
  const capabilityCallback = (input: { value: number }) => ({ value: input.value })
  const capabilityContract = compileActionImplementationContract({
    action: capabilityDescriptor,
    implementationId: "cap-impl",
    implementationVersion: "1",
    entryFile: "cap-action.sm",
    exportName: "work",
    implementation: capabilityCallback,
    sources: [{
      fileName: "cap-action.sm",
      source: `
import { Context } from "smthrs/context"
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Database extends Context {
  abstract read(value: number): number
}
export function work(input: { value: number }): Result<{ value: number }, Failed> {
  if (input.value < 0) throw new Failed("negative")
  return { value: Database.context().read(input.value) }
}
`
    }]
  })
  expect(capabilityContract.requirements.length).toBeGreaterThan(0)
  expect(() => buildWorkerPoolBundle({
    poolId: "cap-pool",
    target: "typescript-bun",
    sandbox: "remote-http-poc",
    selections: [{ action: capabilityDescriptor, contract: capabilityContract }]
  })).toThrow("capability")
})

test("tampered bundle bytes and forged manifests fail closed", () => {
  const checked = compileImplementation("test/bundle/Tamper", "tamper-action.sm", "tamper-impl", "tamper")
  const plan = singleActionPlan(checked.action.descriptor, "test/bundle/TamperFlow")
  const deployment = Deployment.build({
    id: "bundle-tamper",
    flow: PlanArtifact.load(PlanArtifact.encode(plan)),
    pools: [Worker.pool("tamper-pool", {
      target: "typescript-bun",
      sandbox: "remote-http-poc",
      bundle: true,
      providers: [checked.provider]
    })]
  })
  const bundle = deployment.bundles.get("tamper-pool")!

  // Byte tampering is detected by content digest.
  expect(() => validateWorkerPoolBundle({ ...bundle, javascript: `${bundle.javascript} ` }))
    .toThrow("does not match its bytes")
  expect(() => validateWorkerPoolBundle({ ...bundle, digest: "0".repeat(64) }))
    .toThrow("does not match its bytes")

  // Swapping the pinned bundle digest inside the manifest breaks the pool
  // artifact digest chain.
  const forgedManifest = JSON.parse(JSON.stringify(deployment.manifest))
  forgedManifest.pools[0].bundleDigest = "0".repeat(64)
  expect(() => validateDeploymentManifest(forgedManifest, deployment.flow.plan))
    .toThrow("artifact digest mismatch")

  // Recomputing every unkeyed digest still cannot survive the Ed25519
  // signature: the signed artifact does not verify with different bundle bytes
  // pinned inside it.
  const keyPair = generateDeploymentSigningKeyPair()
  const trusted = [deploymentVerificationKey(keyPair)]
  const signed = encodeSignedDeploymentArtifact(deployment.flow.plan, deployment.manifest, keyPair)
  expect(decodeSignedDeploymentArtifact(signed, trusted).manifest.pools[0]!.bundleDigest).toBe(bundle.digest)

  const decoded = JSON.parse(new TextDecoder().decode(signed))
  decoded.manifest.pools[0].bundleDigest = "0".repeat(64)
  const forgedPool = decoded.manifest.pools[0]
  forgedPool.artifactDigest = digest({
    poolId: forgedPool.id,
    target: forgedPool.target,
    sandbox: forgedPool.sandbox,
    selected: decoded.manifest.routes
      .filter((route: { poolId: string }) => route.poolId === forgedPool.id)
      .map((route: { actionId: string; implementationDigest: string; policyDigest: string }) => ({
        actionId: route.actionId,
        implementationDigest: route.implementationDigest,
        policyDigest: route.policyDigest
      })),
    bundleDigest: forgedPool.bundleDigest
  })
  for (const route of decoded.manifest.routes) {
    if (route.poolId === forgedPool.id) route.artifactDigest = forgedPool.artifactDigest
  }
  const { digest: _manifestDigest, ...unsignedManifest } = decoded.manifest
  decoded.manifest.digest = digest(unsignedManifest)
  const { digest: _artifactDigest, ...unsignedArtifact } = decoded
  decoded.digest = digest(unsignedArtifact)
  const reEncoded = new TextEncoder().encode(JSON.stringify(decoded))
  expect(() => decodeSignedDeploymentArtifact(reEncoded, trusted)).toThrow()
})

test("worker bundle self-containment covers re-export edges, not only imports", () => {
  const descriptor = compileWorkAction("test/bundle/ReExport", "reexport-action.sm")
  const action = Action.fromDescriptor<{ value: number }, { value: number }, { code: string }>(descriptor)
  const hostCallback = (): never => {
    throw new Error("host implementation must not run on the bundle path")
  }
  const failedClass = "class Failed extends Error { constructor(readonly code: string) { super(code) } }\n"
  const workBody = "export function work(input: { value: number }): Result<{ value: number }, Failed> {\n" +
    '  if (input.value < 0) throw new Failed("neg")\n' +
    "  return { value: input.value + 1 }\n" +
    "}\n"
  const bundleFrom = (implementationId: string, sources: readonly { fileName: string; source: string }[]) =>
    buildWorkerPoolBundle({
      poolId: "reexport-pool",
      target: "typescript-bun",
      sandbox: "remote-http-poc",
      selections: [{
        action: descriptor,
        contract: compileActionImplementationContract({
          action: descriptor,
          implementationId,
          implementationVersion: "1",
          entryFile: "reexport-action.sm",
          exportName: "work",
          implementation: hostCallback,
          sources: [...sources]
        })
      }]
    })

  // A compiler-owned specifier legitimately skips the source closure check, so
  // its lowered re-export edge is the reachable probe of this layer. Before
  // this rule, `assertBundleImports` only inspected import declarations and a
  // re-export rode into a bundle this function certifies as self-contained.
  expect(() => bundleFrom("reexport-runtime", [{
    fileName: "reexport-action.sm",
    source: `export { Context } from "smthrs/context"\n${failedClass}${workBody}`
  }])).toThrow("re-exports the compiler-owned worker bundle runtime")

  // Both directions: ordinary self-contained bundles are unaffected.
  const single = bundleFrom("reexport-single", [{
    fileName: "reexport-action.sm",
    source: `${failedClass}${workBody}`
  }])
  expect(single.javascript).not.toContain("smthrs/context")
  const multi = bundleFrom("reexport-multi", [
    { fileName: "helper.sm", source: "export function bump(value: number): number { return value + 1 }\n" },
    {
      fileName: "reexport-action.sm",
      source: 'import { bump } from "./helper.sm"\n' + failedClass +
        "export function work(input: { value: number }): Result<{ value: number }, Failed> {\n" +
        '  if (input.value < 0) throw new Failed("neg")\n' +
        "  return { value: bump(input.value) }\n" +
        "}\n"
    }
  ])
  expect(multi.javascript).toContain("helper.ts")
  expect(HEX_DIGEST.test(multi.digest)).toBe(true)
})

// ---------------------------------------------------------------------------
// Failure selection is by compiler-issued identity, never by a name string
// ---------------------------------------------------------------------------

/**
 * The exact tail `buildWorkerPoolBundle` emits after the dispatch source.
 *
 * Stripping it is what lets the EXACT digested bytes run in this process
 * instead of a paraphrase of them: everything before the tail is already
 * ordinary script text, so only the two module-level `export` forms have to
 * go. Pinned as one literal and asserted rather than pattern-matched, so a
 * drift in the emitted tail fails this loudly instead of silently testing
 * something else — the same fail-closed idiom `patchRuntimeSource` uses
 * against the runtime it patches.
 */
const BUNDLE_EXPORT_TAIL =
  "\nexport { __smithersInvokeAction };\nexport const __smithersPoolBundle = __smithersBundleMeta;\n"

const invokeBundleDirectly = (javascript: string) => {
  expect(javascript.endsWith(BUNDLE_EXPORT_TAIL)).toBe(true)
  return new Function(
    `${javascript.slice(0, -BUNDLE_EXPORT_TAIL.length)}\nreturn __smithersInvokeAction;\n`
  )() as (invocation: unknown) => Promise<unknown>
}

/**
 * Build a one-Action bundle whose failure row is `Failed | Denied` and whose
 * implementation body is the caller's, then run it in-process against the
 * exact bytes `buildWorkerPoolBundle` digests and signs.
 */
const TWO_FAILURE_CLASSES = `
class Failed extends Error { constructor(readonly code: string) { super(code) } }
class Denied extends Error { constructor(readonly code: string) { super(code) } }
`

const runTwoFailureBundle = (poolId: string, body: string) => {
  const fileName = `${poolId}.sm`
  const compiled = compileActionContract(`
import { Action } from "smithers:flows"
${TWO_FAILURE_CLASSES}
export abstract class Work extends Action<
  (input: { value: number }) => Result<{ value: number }, Failed | Denied>
> {}
`, { fileName, exportName: "Work", id: `test/bundle/${poolId}`, version: 1 })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const descriptor = compiled.descriptor
  const hostCallback = (): never => { throw new Error("host implementation must not run on the bundle path") }
  const contract = compileActionImplementationContract({
    action: descriptor,
    implementationId: `${poolId}-impl`,
    implementationVersion: "1",
    entryFile: fileName,
    exportName: "work",
    implementation: hostCallback,
    sources: [{
      fileName,
      source: `${TWO_FAILURE_CLASSES}
export function work(input: { value: number }): Result<{ value: number }, Failed | Denied> {
${body}
}
`
    }]
  })
  const bundle = buildWorkerPoolBundle({
    poolId,
    target: "typescript-bun",
    sandbox: "remote-http-poc",
    selections: [{ action: descriptor, contract }]
  })
  const invokeAction = invokeBundleDirectly(bundle.javascript)
  return {
    bundle,
    invoke: (value: number) => invokeAction({
      actionId: descriptor.id,
      actionVersion: descriptor.version,
      actionContractDigest: descriptor.contractDigest,
      input: { value }
    })
  }
}

/**
 * THE regression this bundle's failure mapping exists to prevent.
 *
 * `__smithersTypedFailure` used to select the declared variant by
 * `error.constructor.name`. `constructor` is an ordinary property lookup, so an
 * own field shadows the prototype's, and `name` is a string — between them the
 * PAYLOAD names its own failure identity. Every implementation body below is
 * accepted by `compileActionImplementationContract` unchanged; none of them
 * needs `any`, a subclass, or a same-named declaration, so none of the three
 * fences round 9 recorded (bundles carry same-file Actions; a same-name union
 * collides and is refused as `SMITHERS4124`/`SMITHERS4203`; a subclass throw is
 * refused as `SMITHERS1104`) stands between an author and this.
 *
 * Measured against the previous line, on this exact bundle:
 *
 *   - `value === 1` produced `{ identity: "…@Failed@1", payload: { code } }`
 *     for a value that really is a `Denied`. Both classes declare `code`, so
 *     the payload loop succeeded and the forged envelope was WELL-FORMED: it
 *     persists, hash-chains, and decodes on the far side as the wrong failure.
 *   - `value === 2` produced a `BundleFailureMappingDefect`, which `engine.ts`
 *     treats as a defect and AUTO-RETRIES — a typed business failure silently
 *     re-run, which is the outcome round 9's own note called the stake.
 *
 * `runtime.errorIdentity` is the fix: the transport registry keyed by PROTOTYPE
 * identity in a WeakMap, populated by the compiler's own
 * `__vsRegisterError(Class, "smithers:<file>:<Class>")` emissions. Nothing
 * readable from the value reaches it.
 */
test("a bundled failure is selected by compiler-issued Error identity, not by a shadowable constructor name", async () => {
  const { invoke } = await runTwoFailureBundle("identity-select", `
  if (input.value === 1) {
    // A genuine \`Denied\` whose \`constructor\` reads as the sibling variant.
    const denied = new Denied("forged")
    Object.defineProperty(denied, "constructor", { value: Failed })
    throw denied
  }
  if (input.value === 2) {
    // A genuine \`Denied\` whose \`constructor\` reads as nothing at all.
    const denied = new Denied("erased")
    Object.defineProperty(denied, "constructor", { value: undefined })
    throw denied
  }
  if (input.value === 3) {
    // The same shadowing spelled without \`Object.defineProperty\`.
    const denied = new Denied("assigned")
    Object.assign(denied, { constructor: Failed })
    throw denied
  }
  if (input.value < 0) throw new Denied("honest")
  return { value: input.value }
`)
  const deniedIdentity = "smithers:identity-select.sm@Denied@1"

  // Control: an unshadowed failure maps to its own identity.
  expect(await invoke(-1)).toEqual({
    kind: "failure", error: { version: 1, identity: deniedIdentity, payload: { code: "honest" } }
  })

  // A shadowed `constructor` cannot move a failure onto its sibling's identity.
  for (const [value, code] of [[1, "forged"], [3, "assigned"]] as const) {
    expect(await invoke(value)).toEqual({
      kind: "failure", error: { version: 1, identity: deniedIdentity, payload: { code } }
    })
  }

  // Nor can erasing `constructor` demote a typed business failure to a
  // defect, which is the retryable half of the same fail-open.
  expect(await invoke(2)).toEqual({
    kind: "failure", error: { version: 1, identity: deniedIdentity, payload: { code: "erased" } }
  })
})

/**
 * The fence that DOES still hold, pinned so that moving it turns this red.
 *
 * Round 9 rested "unreachable by construction" on three fences and this session
 * moved all three: durable failure identities became injective and respelled
 * (`smithers:<file>@<Class>@1`), the must-consume discharge rule changed, and
 * nominal Error identities gained a compile-wide collision refusal. Only ONE of
 * the three ever bore on the bundle's failure mapping, and it is this: two Error
 * classes cannot reach one Action's declared failure row under one class name,
 * because durable failure identity IS `(logical source file, class name)` and
 * the second claimant is refused.
 *
 * That fence is why the mapping's remaining exposure was the shadowed
 * `constructor` above rather than an honestly ambiguous row — and it is not a
 * fence the bundle owns, so it is pinned here rather than assumed.
 */
test("two Error classes cannot share one declared failure name in an Action's failure row", () => {
  const attempt = (source: string) => compileActionContract(`
import { Action } from "smithers:flows"
${source}
export abstract class Work extends Action<
  (input: { value: number }) => Result<{ value: number }, Failed | Other>
> {}
`, { fileName: "fence.sm", exportName: "Work", id: "test/bundle/Fence", version: 1 })

  // A block-scoped and a namespace-scoped second `Failed` are the two ways a
  // single file can declare the name twice without a duplicate identifier.
  for (const source of [
    `class Failed extends Error { constructor(readonly code: string) { super(code) } }
function scope() { class Failed extends Error { constructor(readonly why: string) { super(why) } } return new Failed("x") }
type Other = ReturnType<typeof scope>`,
    `class Failed extends Error { constructor(readonly code: string) { super(code) } }
namespace Inner { export class Failed extends Error { constructor(readonly why: string) { super(why) } } }
type Other = Inner.Failed`
  ]) {
    const compiled = attempt(source)
    expect(compiled.ok).toBe(false)
    if (compiled.ok) throw new Error("unreachable")
    expect(compiled.diagnostics[0]!.code).toBe("SMITHERS4203")
    expect(compiled.diagnostics[0]!.message).toContain("shares durable failure identity smithers:fence.sm@Failed@1")
  }

  // The control the fence must not refuse: two DIFFERENTLY named classes are
  // two variants, each with its own identity.
  const accepted = attempt(
    `class Failed extends Error { constructor(readonly code: string) { super(code) } }
class Other extends Error { constructor(readonly why: string) { super(why) } }`
  )
  expect(accepted.ok).toBe(true)
  if (!accepted.ok) throw new Error("unreachable")
  const schema = accepted.descriptor.errorSchema
  expect(schema.shape).toBe("structural")
  expect(schema.shape === "structural" && schema.descriptor.kind === "union"
    ? schema.descriptor.variants.map((variant) => variant.kind === "error" ? variant.identity : variant.kind)
    : [])
    .toEqual(["smithers:fence.sm@Failed@1", "smithers:fence.sm@Other@1"])

  // The other fence round 9 recorded, pinned for the same reason. A subclass of
  // a declared failure is the one shape that reaches dispatch carrying a
  // registered ancestor but no registration of its own, so if this ever stopped
  // being refused, `errorIdentity` would answer `undefined` and every such
  // typed failure would become an auto-retried defect. That is fail-CLOSED, and
  // still wrong; the refusal is what keeps it from arising at all.
  const hostCallback = (): never => { throw new Error("host implementation must not run on the bundle path") }
  expect(() => compileActionImplementationContract({
    action: accepted.descriptor,
    implementationId: "fence-subclass",
    implementationVersion: "1",
    entryFile: "fence.sm",
    exportName: "work",
    implementation: hostCallback,
    sources: [{
      fileName: "fence.sm",
      source: `class Failed extends Error { constructor(readonly code: string) { super(code) } }
class Other extends Error { constructor(readonly why: string) { super(why) } }
class Sub extends Failed {}
export function work(input: { value: number }): Result<{ value: number }, Failed | Other> {
  if (input.value < 0) throw new Sub("subclass")
  return { value: input.value }
}
`
    }]
  })).toThrow("row checker")
})

/**
 * The bundle now depends on the compiler having ISSUED a nominal identity for
 * every declared failure, so the absence of one has to be a build refusal
 * rather than a bundle whose every typed failure silently maps to nothing.
 * `emitsNoRuntimeBinding` declarations are the shape that reaches this.
 */
test("a declared failure with no compiler-issued nominal identity refuses to bundle", () => {
  const fileName = "no-identity.sm"
  const compiled = compileActionContract(`
import { Action } from "smithers:flows"
declare class Failed extends Error { readonly code: string }
export abstract class Work extends Action<
  (input: { value: number }) => Result<{ value: number }, Failed>
> {}
`, { fileName, exportName: "Work", id: "test/bundle/NoIdentity", version: 1 })
  // Either the contract compiler refuses the ambient declaration outright, or
  // it admits a variant the lowering emits no registration for — and then the
  // bundle builder must refuse. Both are fail-closed; neither is a bundle that
  // maps failures by name.
  if (!compiled.ok) {
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code).join(",")).toMatch(/SMITHERS42/)
    return
  }
  const hostCallback = (): never => { throw new Error("host implementation must not run on the bundle path") }
  expect(() => {
    const contract = compileActionImplementationContract({
      action: compiled.descriptor,
      implementationId: "no-identity-impl",
      implementationVersion: "1",
      entryFile: fileName,
      exportName: "work",
      implementation: hostCallback,
      sources: [{
        fileName,
        source: `declare class Failed extends Error { readonly code: string }
export function work(input: { value: number }): Result<{ value: number }, Failed> {
  return { value: input.value }
}
`
      }]
    })
    buildWorkerPoolBundle({
      poolId: "no-identity",
      target: "typescript-bun",
      sandbox: "remote-http-poc",
      selections: [{ action: compiled.descriptor, contract }]
    })
  }).toThrow()
})
