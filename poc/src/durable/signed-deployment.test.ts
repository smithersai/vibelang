import { expect, test } from "bun:test"
import { createPrivateKey, sign } from "node:crypto"
import { Action, Flow } from "./authoring.ts"
import {
  createAuthenticatedDurableExecutor,
  trustWorkerTransport,
  type TrustedWorkerTransport
} from "./authenticated-executor.ts"
import { Deployment, LocalWorker, Provider, Worker } from "./provider.ts"
import { DurableStore } from "./store.ts"
import {
  authenticateDeployment,
  decodeSignedDeploymentArtifact,
  deploymentVerificationKey,
  encodeSignedDeploymentArtifact,
  generateDeploymentSigningKeyPair,
  requireAuthenticatedDeployment,
  type AuthenticatedDeployment
} from "./signed-deployment.ts"
import { canonicalJson, digest, encodeCanonicalJson } from "./ir.ts"

const fixture = (
  deploymentId = "signed-deployment",
  sandbox = "in-process-poc"
) => {
  const Work = Action.define<{ value: number }, { doubled: number }>({
    id: "test/SignedDeploymentWork",
    version: 1
  })
  const Program = Flow.define<{ value: number }, { doubled: number }>(
    { id: "test/SignedDeploymentFlow", version: 1 },
    (input) => Work.run({ value: input.value })
  )
  const Live = Provider.provide(Work, ({ value }) => ({ doubled: value * 2 }), {
    implementationId: "signed-deployment-work",
    implementationVersion: "1",
    recovery: { mode: "repeatable", maxAttempts: 2 }
  })
  return Deployment.build({
    id: deploymentId,
    flow: Program,
    pools: [Worker.pool("signed-worker", {
      target: "typescript-node",
      sandbox,
      providers: [Live]
    })]
  })
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/**
 * Every fixture Plan here is recorded by `Flow.define`, so it carries
 * `provenance: "proxy-recorded"` and signing it is a deliberate, acknowledged
 * act. The default refusal is covered by its own test below rather than being
 * silently opted out of everywhere.
 */
const encodeFixtureArtifact = (
  ...args: Parameters<typeof encodeSignedDeploymentArtifact>
): Uint8Array =>
  encodeSignedDeploymentArtifact(args[0], args[1], args[2], { allowUnverifiedPlanProvenance: true })

test("Ed25519 signs and authenticates the exact Plan and deployment manifest", () => {
  const deployment = fixture()
  const keyPair = generateDeploymentSigningKeyPair()
  const verificationKey = deploymentVerificationKey(keyPair)
  const first = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, keyPair)
  const second = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, keyPair)

  // Ed25519 and canonical encoding make identical build evidence byte-identical.
  expect(text(second)).toBe(text(first))
  const authenticated = decodeSignedDeploymentArtifact(first, [verificationKey])
  expect(authenticated.plan.digest).toBe(deployment.flow.plan.digest)
  expect(authenticated.manifest.digest).toBe(deployment.manifest.digest)
  expect(authenticated.signer.keyId).toBe(keyPair.keyId)
  expect(Object.isFrozen(authenticated)).toBe(true)
  expect(Object.isFrozen(authenticated.manifest.routes)).toBe(true)

  const proof = authenticateDeployment(deployment, first, [verificationKey])
  expect(requireAuthenticatedDeployment(proof)).toBe(deployment)
  expect(proof.artifactDigest).toBe(authenticated.digest)
})

test("runtime deployment authentication is exact and its proof is not structurally forgeable", () => {
  const deployment = fixture()
  const otherDeployment = fixture("different-runtime-deployment")
  const keyPair = generateDeploymentSigningKeyPair()
  const verificationKey = deploymentVerificationKey(keyPair)
  const artifact = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, keyPair)

  expect(() => authenticateDeployment(otherDeployment, artifact, [verificationKey])).toThrow(
    "runtime deployment manifest does not match"
  )
  expect(() => authenticateDeployment({
    ...deployment,
    pools: new Map(deployment.pools)
  }, artifact, [verificationKey])).toThrow("was not issued by Deployment.build")
  expect(() => requireAuthenticatedDeployment({
    deployment,
    artifactDigest: "0".repeat(64),
    signerKeyId: keyPair.keyId
  } as unknown as AuthenticatedDeployment)).toThrow("was not issued")

  // Regression: comparing WeakMap.get(fake) to fake.deployment allowed two
  // undefined values to compare equal. Issuance must be checked independently.
  expect(() => requireAuthenticatedDeployment({
    deployment: undefined,
    artifactDigest: "0".repeat(64),
    signerKeyId: keyPair.keyId
  } as unknown as AuthenticatedDeployment)).toThrow("was not issued")
  expect(() => requireAuthenticatedDeployment(
    new Proxy(authenticateDeployment(deployment, artifact, [verificationKey]), {})
  )).toThrow("was not issued")
})

test("the authenticated coordinator gate runs before any worker factory", async () => {
  const deployment = fixture()
  const keyPair = generateDeploymentSigningKeyPair()
  const verificationKey = deploymentVerificationKey(keyPair)
  const artifact = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, keyPair)
  const authentication = authenticateDeployment(deployment, artifact, [verificationKey])
  const store = new DurableStore()

  const executor = createAuthenticatedDurableExecutor(authentication, store)
  expect(await executor.execute({ value: 6 }, { executionId: "signed-runtime" })).toEqual({ doubled: 12 })
  store.close()

  const rejectedStore = new DurableStore()
  expect(() => createAuthenticatedDurableExecutor({
    deployment: undefined,
    artifactDigest: "0".repeat(64),
    signerKeyId: keyPair.keyId
  } as unknown as AuthenticatedDeployment, rejectedStore)).toThrow("was not issued")
  rejectedStore.close()
})

test("authenticated coordinator routing fails closed on signed sandbox mismatch", async () => {
  const deployment = fixture("signed-nonlocal", "deno-no-authority")
  const keyPair = generateDeploymentSigningKeyPair()
  const verificationKey = deploymentVerificationKey(keyPair)
  const artifact = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, keyPair)
  const authentication = authenticateDeployment(deployment, artifact, [verificationKey])
  let factoryCalls = 0
  const wrongTransport = trustWorkerTransport("process", (pool, manifest, providers) => {
    factoryCalls += 1
    return new LocalWorker(pool, manifest, providers)
  })

  const missingStore = new DurableStore()
  expect(() => createAuthenticatedDurableExecutor(authentication, missingStore)).toThrow(
    "signed sandbox deno-no-authority has no exact trusted worker transport"
  )
  expect(factoryCalls).toBe(0)
  missingStore.close()

  const mismatchStore = new DurableStore()
  expect(() => createAuthenticatedDurableExecutor(authentication, mismatchStore, {
    transports: [wrongTransport]
  })).toThrow("signed sandbox deno-no-authority has no exact trusted worker transport")
  expect(factoryCalls).toBe(0)
  mismatchStore.close()

  const rawFactoryStore = new DurableStore()
  expect(() => createAuthenticatedDurableExecutor(authentication, rawFactoryStore, {
    workerFactory: (pool: any, manifest: any, providers: any) => {
      factoryCalls += 1
      return new LocalWorker(pool, manifest, providers)
    }
  } as any)).toThrow("unknown fields")
  expect(factoryCalls).toBe(0)
  rawFactoryStore.close()

  const forgedStore = new DurableStore()
  expect(() => createAuthenticatedDurableExecutor(authentication, forgedStore, {
    transports: [{ sandbox: "deno-no-authority" } as unknown as TrustedWorkerTransport]
  })).toThrow("was not issued by this host")
  expect(factoryCalls).toBe(0)
  forgedStore.close()

  const exactTransport = trustWorkerTransport("deno-no-authority", (pool, manifest, providers) => {
    factoryCalls += 1
    return new LocalWorker(pool, manifest, providers)
  })
  const acceptedStore = new DurableStore()
  const executor = createAuthenticatedDurableExecutor(authentication, acceptedStore, {
    transports: [exactTransport]
  })
  expect(factoryCalls).toBe(1)
  expect(await executor.execute({ value: 7 }, { executionId: "signed-nonlocal-runtime" })).toEqual({ doubled: 14 })
  acceptedStore.close()
})

test("recomputing every unkeyed digest cannot forge a trusted deployment", () => {
  const deployment = fixture()
  const keyPair = generateDeploymentSigningKeyPair()
  const verificationKey = deploymentVerificationKey(keyPair)
  const encoded = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, keyPair)
  const forged = JSON.parse(text(encoded)) as Record<string, any>

  forged.manifest.deploymentId = "attacker-controlled"
  const { digest: _manifestDigest, ...manifestSemantic } = forged.manifest
  forged.manifest.digest = digest(manifestSemantic)
  const { digest: _artifactDigest, ...artifactSemantic } = forged
  forged.digest = digest(artifactSemantic)

  expect(() => decodeSignedDeploymentArtifact(
    encodeCanonicalJson(forged),
    [verificationKey]
  )).toThrow("signature verification failed")
})

test("an artifact cannot introduce its own signing authority", () => {
  const deployment = fixture()
  const trusted = generateDeploymentSigningKeyPair()
  const attacker = generateDeploymentSigningKeyPair()
  const attackerArtifact = encodeFixtureArtifact(
    deployment.flow.plan,
    deployment.manifest,
    attacker
  )

  expect(() => decodeSignedDeploymentArtifact(
    attackerArtifact,
    [deploymentVerificationKey(trusted)]
  )).toThrow("is not trusted")
  expect(() => decodeSignedDeploymentArtifact(attackerArtifact, [])).toThrow(
    "at least one trusted key"
  )
})

test("trust roots, signing key pairs, signatures, and canonical envelopes fail closed", () => {
  const deployment = fixture()
  const keyPair = generateDeploymentSigningKeyPair()
  const verificationKey = deploymentVerificationKey(keyPair)
  const encoded = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, keyPair)

  const mismatchedTrustRoot = {
    ...verificationKey,
    keyId: "0".repeat(64)
  }
  expect(() => decodeSignedDeploymentArtifact(encoded, [mismatchedTrustRoot])).toThrow(
    "key id does not match"
  )

  const another = generateDeploymentSigningKeyPair()
  expect(() => encodeFixtureArtifact(
    deployment.flow.plan,
    deployment.manifest,
    { ...keyPair, privateKey: another.privateKey }
  )).toThrow("do not match")

  const changedSignature = JSON.parse(text(encoded)) as Record<string, any>
  changedSignature.signature = `${changedSignature.signature.startsWith("A") ? "B" : "A"}${
    changedSignature.signature.slice(1)
  }`
  const { digest: _digest, ...changedSemantic } = changedSignature
  changedSignature.digest = digest(changedSemantic)
  expect(() => decodeSignedDeploymentArtifact(
    encodeCanonicalJson(changedSignature),
    [verificationKey]
  )).toThrow("signature verification failed")

  expect(() => decodeSignedDeploymentArtifact(
    `${text(encoded)}\n`,
    [verificationKey]
  )).toThrow("not in the canonical durable encoding")

  const extraField = JSON.parse(text(encoded)) as Record<string, any>
  extraField.untrusted = true
  expect(() => decodeSignedDeploymentArtifact(
    encodeCanonicalJson(extraField),
    [verificationKey]
  )).toThrow("missing or unknown fields")

  let getterReads = 0
  const accessorTrustRoot = { ...verificationKey } as Record<string, unknown>
  Object.defineProperty(accessorTrustRoot, "publicKey", {
    enumerable: true,
    get: () => {
      getterReads += 1
      throw new Error("trust-root getter executed")
    }
  })
  expect(() => decodeSignedDeploymentArtifact(
    encoded,
    [accessorTrustRoot as unknown as typeof verificationKey]
  )).toThrow("accessor")
  expect(getterReads).toBe(0)

  const hiddenTrustRoot = { ...verificationKey }
  Object.defineProperty(hiddenTrustRoot, "hiddenAuthority", {
    enumerable: false,
    value: true
  })
  expect(() => decodeSignedDeploymentArtifact(encoded, [hiddenTrustRoot])).toThrow("hidden property")
})

test("the Ed25519 signature is domain separated and key encodings are exact", () => {
  const deployment = fixture()
  const keyPair = generateDeploymentSigningKeyPair()
  const verificationKey = deploymentVerificationKey(keyPair)
  const encoded = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, keyPair)
  const wrongDomain = JSON.parse(text(encoded)) as Record<string, any>
  const { digest: _oldDigest, signature: _oldSignature, ...unsigned } = wrongDomain
  const privateKey = createPrivateKey({
    key: Buffer.from(keyPair.privateKey, "base64url"),
    format: "der",
    type: "pkcs8"
  })
  wrongDomain.signature = sign(
    null,
    Buffer.from(canonicalJson(unsigned), "utf8"),
    privateKey
  ).toString("base64url")
  wrongDomain.digest = digest({ ...unsigned, signature: wrongDomain.signature })
  expect(() => decodeSignedDeploymentArtifact(
    encodeCanonicalJson(wrongDomain),
    [verificationKey]
  )).toThrow("signature verification failed")

  expect(() => decodeSignedDeploymentArtifact(encoded, [{
    ...verificationKey,
    publicKey: `${verificationKey.publicKey}=`
  }])).toThrow("canonical base64url")
  expect(() => decodeSignedDeploymentArtifact(encoded, [{
    ...verificationKey,
    publicKey: Buffer.concat([
      Buffer.from(verificationKey.publicKey, "base64url"),
      Buffer.from([0])
    ]).toString("base64url")
  }])).toThrow("canonical DER/SPKI")

  const nonCanonicalSignature = JSON.parse(text(encoded)) as Record<string, any>
  nonCanonicalSignature.signature = `${nonCanonicalSignature.signature}=`
  expect(() => decodeSignedDeploymentArtifact(
    encodeCanonicalJson(nonCanonicalSignature),
    [verificationKey]
  )).toThrow("canonical base64url")
  expect(() => decodeSignedDeploymentArtifact(
    new Uint8Array(4 * 1024 * 1024 + 1),
    [verificationKey]
  )).toThrow("exceeds 4194304 bytes")
  expect(() => decodeSignedDeploymentArtifact(
    { byteLength: 0 } as unknown as Uint8Array,
    [verificationKey]
  )).toThrow("must be UTF-8 bytes or text")
})

test("trust-set rotation is explicit and does not pretend to revoke issued process-local proofs", () => {
  const deployment = fixture()
  const oldKey = generateDeploymentSigningKeyPair()
  const nextKey = generateDeploymentSigningKeyPair()
  const oldTrust = deploymentVerificationKey(oldKey)
  const nextTrust = deploymentVerificationKey(nextKey)
  const oldArtifact = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, oldKey)
  const nextArtifact = encodeFixtureArtifact(deployment.flow.plan, deployment.manifest, nextKey)

  expect(decodeSignedDeploymentArtifact(oldArtifact, [oldTrust, nextTrust]).signer.keyId).toBe(oldKey.keyId)
  expect(decodeSignedDeploymentArtifact(nextArtifact, [oldTrust, nextTrust]).signer.keyId).toBe(nextKey.keyId)
  expect(() => decodeSignedDeploymentArtifact(oldArtifact, [nextTrust])).toThrow("is not trusted")
  expect(() => decodeSignedDeploymentArtifact(nextArtifact, [oldTrust])).toThrow("is not trusted")
  expect(() => decodeSignedDeploymentArtifact(oldArtifact, [oldTrust, oldTrust])).toThrow("is duplicated")
  expect(() => decodeSignedDeploymentArtifact(
    oldArtifact,
    Array.from({ length: 257 }, () => oldTrust)
  )).toThrow("at most 256 trusted keys")

  const alreadyIssued = authenticateDeployment(deployment, oldArtifact, [oldTrust])
  // This POC has no online revocation service: removing oldTrust affects future
  // verification, while an already-issued in-process proof remains valid.
  expect(requireAuthenticatedDeployment(alreadyIssued)).toBe(deployment)
})
