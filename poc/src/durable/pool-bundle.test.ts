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
import { Action } from "vibelang:flows"
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
import { durable } from "vibelang:flows"
import { Work } from "test:pool-bundle-actions"
export const Program = durable(function Program(input: { value: number }) {
  return Work.run({ value: input.value })
})
`, {
    fileName: "flows/pool-bundle.vibe",
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
  const first = compileImplementation("test/bundle/Det", "det-action.vibe", "det-impl", "abc")
  const second = compileImplementation("test/bundle/Det", "det-action.vibe", "det-impl", "abc")
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
  const used = compileImplementation("test/bundle/Used", "used-action.vibe", "used-impl", "usedmarker")
  const unused = compileImplementation("test/bundle/Unused", "unused-action.vibe", "unused-impl", "unusedmarker")
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
  const first = compileImplementation("test/bundle/Art", "art-action.vibe", "art-impl", "one")
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
  const checked = compileImplementation("test/bundle/Closed", "closed-action.vibe", "closed-impl", "closed")
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
  const capabilityDescriptor = compileWorkAction("test/bundle/Cap", "cap-action.vibe")
  const capabilityCallback = (input: { value: number }) => ({ value: input.value })
  const capabilityContract = compileActionImplementationContract({
    action: capabilityDescriptor,
    implementationId: "cap-impl",
    implementationVersion: "1",
    entryFile: "cap-action.vibe",
    exportName: "work",
    implementation: capabilityCallback,
    sources: [{
      fileName: "cap-action.vibe",
      source: `
import { Context } from "vibelang/context"
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
  const checked = compileImplementation("test/bundle/Tamper", "tamper-action.vibe", "tamper-impl", "tamper")
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
