import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject
} from "node:crypto"
import {
  validateDeploymentManifest,
  validatePlanTemplate
} from "./artifact.ts"
import {
  assertJson,
  canonicalJson,
  decodeCanonicalJson,
  deepFreeze,
  digest,
  encodeCanonicalJson,
  PLAN_PROVENANCE_PROXY_RECORDED,
  type DeploymentManifest,
  type PlanTemplate
} from "./ir.ts"
import {
  requireLocallyBuiltDeployment,
  type BuiltDeployment
} from "./provider.ts"

const MAX_SIGNED_DEPLOYMENT_BYTES = 4 * 1024 * 1024
const MAX_ENCODED_KEY_BYTES = 512
const MAX_TRUSTED_DEPLOYMENT_KEYS = 256
const HEX_DIGEST = /^[0-9a-f]{64}$/
const BASE64URL = /^[A-Za-z0-9_-]+$/
const KEY_ID_DOMAIN = Buffer.from("smithers.ed25519.public-key.v1\0", "utf8")
const SIGNATURE_DOMAIN = Buffer.from("smithers.deployment-manifest.v1\0", "utf8")

export class DeploymentSignatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DeploymentSignatureError"
  }
}

export interface DeploymentSigningKeyPair {
  readonly algorithm: "Ed25519"
  /** SHA-256 identity of the canonical SPKI public key, not an author alias. */
  readonly keyId: string
  /** Canonical base64url DER/SPKI bytes. */
  readonly publicKey: string
  /** Canonical base64url DER/PKCS#8 bytes. Keep this outside deployment artifacts. */
  readonly privateKey: string
}

export interface TrustedDeploymentKey {
  readonly algorithm: "Ed25519"
  readonly keyId: string
  readonly publicKey: string
}

export interface SignedDeploymentArtifact {
  readonly artifactVersion: 1
  readonly kind: "smithers.deployment"
  readonly plan: PlanTemplate
  readonly manifest: DeploymentManifest
  readonly signer: {
    readonly algorithm: "Ed25519"
    readonly keyId: string
  }
  /** Canonical base64url Ed25519 signature over the domain-separated unsigned envelope. */
  readonly signature: string
  /** Content identity of the complete signed envelope, including its signature. */
  readonly digest: string
}

/**
 * A compile-time nominal marker. The WeakMap below remains the runtime
 * authority boundary; this symbol also prevents an ordinary object literal
 * from accidentally satisfying AuthenticatedDeployment in TypeScript.
 */
const authenticatedDeploymentBrand: unique symbol = Symbol("smithers.authenticated-deployment.v1")

/**
 * Opaque process-local proof that one concrete BuiltDeployment matched a
 * signature authenticated from an out-of-band trust store. Structural lookalikes
 * are rejected by `requireAuthenticatedDeployment`.
 */
export interface AuthenticatedDeployment<Input = unknown, Success = unknown> {
  readonly [authenticatedDeploymentBrand]: true
  readonly deployment: BuiltDeployment<Input, Success>
  readonly artifactDigest: string
  readonly signerKeyId: string
}

const issuedAuthentications = new WeakMap<object, BuiltDeployment<any, any>>()

const fail = (message: string): never => {
  throw new DeploymentSignatureError(message)
}

const exactObject = (
  value: unknown,
  label: string,
  expectedKeys: readonly string[]
): Readonly<Record<string, unknown>> => {
  let normalized: unknown
  try {
    // Return a detached data-only snapshot. This rejects accessors, hidden or
    // symbol properties, exotic prototypes, cycles, and post-check mutation.
    normalized = assertJson(value, label)
  } catch (error) {
    return fail(error instanceof Error ? error.message : `${label} is not canonical data`)
  }
  if (normalized === null || typeof normalized !== "object" || Array.isArray(normalized)) {
    return fail(`${label} must be an object`)
  }
  if (canonicalJson(Object.keys(normalized).sort()) !== canonicalJson([...expectedKeys].sort())) {
    return fail(`${label} has missing or unknown fields`)
  }
  return normalized as Readonly<Record<string, unknown>>
}

const encodedBytes = (value: unknown, label: string, maximum: number): Buffer => {
  if (typeof value !== "string" || value.length === 0 || !BASE64URL.test(value)) {
    return fail(`${label} must be canonical base64url`)
  }
  const bytes = Buffer.from(value, "base64url")
  if (bytes.length === 0 || bytes.length > maximum || bytes.toString("base64url") !== value) {
    return fail(`${label} must be canonical base64url within its size limit`)
  }
  return bytes
}

const publicKeyId = (spki: Uint8Array): string =>
  createHash("sha256").update(KEY_ID_DOMAIN).update(spki).digest("hex")

const parsePublicKey = (encoded: unknown, label: string): {
  readonly key: KeyObject
  readonly encoded: string
  readonly keyId: string
} => {
  const bytes = encodedBytes(encoded, label, MAX_ENCODED_KEY_BYTES)
  let key: KeyObject
  try {
    key = createPublicKey({ key: bytes, format: "der", type: "spki" })
  } catch {
    return fail(`${label} is not a DER/SPKI public key`)
  }
  if (key.asymmetricKeyType !== "ed25519") return fail(`${label} is not an Ed25519 key`)
  const normalized = Buffer.from(key.export({ format: "der", type: "spki" }))
  if (!normalized.equals(bytes)) return fail(`${label} is not canonical DER/SPKI`)
  return { key, encoded: bytes.toString("base64url"), keyId: publicKeyId(bytes) }
}

const parsePrivateKey = (encoded: unknown, label: string): KeyObject => {
  const bytes = encodedBytes(encoded, label, MAX_ENCODED_KEY_BYTES)
  let key: KeyObject
  try {
    key = createPrivateKey({ key: bytes, format: "der", type: "pkcs8" })
  } catch {
    return fail(`${label} is not a DER/PKCS#8 private key`)
  }
  if (key.asymmetricKeyType !== "ed25519") return fail(`${label} is not an Ed25519 key`)
  const normalized = Buffer.from(key.export({ format: "der", type: "pkcs8" }))
  if (!normalized.equals(bytes)) return fail(`${label} is not canonical DER/PKCS#8`)
  return key
}

const unsignedEnvelope = (
  plan: PlanTemplate,
  manifest: DeploymentManifest,
  signer: SignedDeploymentArtifact["signer"]
) => ({
  artifactVersion: 1 as const,
  kind: "smithers.deployment" as const,
  plan,
  manifest,
  signer
})

const signingBytes = (unsigned: ReturnType<typeof unsignedEnvelope>): Buffer =>
  Buffer.concat([SIGNATURE_DOMAIN, Buffer.from(canonicalJson(unsigned), "utf8")])

export const generateDeploymentSigningKeyPair = (): DeploymentSigningKeyPair => {
  const generated = generateKeyPairSync("ed25519")
  const publicDer = Buffer.from(generated.publicKey.export({ format: "der", type: "spki" }))
  const privateDer = Buffer.from(generated.privateKey.export({ format: "der", type: "pkcs8" }))
  return deepFreeze({
    algorithm: "Ed25519" as const,
    keyId: publicKeyId(publicDer),
    publicKey: publicDer.toString("base64url"),
    privateKey: privateDer.toString("base64url")
  })
}

const signingKey = (raw: DeploymentSigningKeyPair): {
  readonly privateKey: KeyObject
  readonly signer: SignedDeploymentArtifact["signer"]
} => {
  const record = exactObject(raw, "deployment signing key", [
    "algorithm", "keyId", "privateKey", "publicKey"
  ])
  if (record.algorithm !== "Ed25519") return fail("deployment signing key uses an unsupported algorithm")
  if (typeof record.keyId !== "string" || !HEX_DIGEST.test(record.keyId)) {
    return fail("deployment signing key has an invalid key id")
  }
  const parsedPublic = parsePublicKey(record.publicKey, "deployment signing public key")
  const privateKey = parsePrivateKey(record.privateKey, "deployment signing private key")
  const derivedPublic = Buffer.from(createPublicKey(privateKey).export({ format: "der", type: "spki" }))
  if (
    parsedPublic.keyId !== record.keyId ||
    !derivedPublic.equals(Buffer.from(parsedPublic.encoded, "base64url"))
  ) {
    return fail("deployment signing key id, public key, and private key do not match")
  }
  return {
    privateKey,
    signer: deepFreeze({ algorithm: "Ed25519" as const, keyId: parsedPublic.keyId })
  }
}

export interface SignDeploymentOptions {
  /**
   * Sign a Plan that declares `provenance: "proxy-recorded"` — one recorded by
   * running an authoring callback rather than compiled from source.
   *
   * A signature is a claim that the artifact is what the author wrote.
   * `Flow.define` refuses every unrepresentable operation it can account for,
   * but `handle || fallback` and `handle ?? fallback` consume the handle
   * legitimately while dropping the fallback, and JavaScript exposes no trap
   * that could see it. Such a Plan may be a faithful record — nothing here can
   * establish that it is. Passing `true` moves that assertion to the caller and
   * keeps the marker in the signed bytes so a verifier still sees it.
   */
  readonly allowUnverifiedPlanProvenance?: boolean
}

/**
 * Produces one canonical, self-contained deployment artifact. The public trust
 * root is deliberately absent: verifiers must receive it out of band.
 *
 * Refuses by default to sign a Plan whose construction could not be verified.
 * An honest refusal is worth more than a signature over a Plan that may have
 * silently lost a branch; see `SignDeploymentOptions` for the explicit opt-in.
 */
export const encodeSignedDeploymentArtifact = (
  planValue: PlanTemplate,
  manifestValue: DeploymentManifest,
  keyPair: DeploymentSigningKeyPair,
  options: SignDeploymentOptions = {}
): Uint8Array => {
  const plan = validatePlanTemplate(planValue)
  if (plan.provenance === PLAN_PROVENANCE_PROXY_RECORDED && options.allowUnverifiedPlanProvenance !== true) {
    return fail(
      `Plan ${plan.flowId} declares provenance "${PLAN_PROVENANCE_PROXY_RECORDED}": it was recorded by running an ` +
        "authoring callback behind a Proxy, and JavaScript offers no trap for `||`/`??` fallbacks over a symbolic " +
        "value, so its construction cannot be verified here. Compile the Flow from source for a verified Plan, or " +
        "pass { allowUnverifiedPlanProvenance: true } to assert it deliberately. Refusing to sign an unverified Plan."
    )
  }
  const manifest = validateDeploymentManifest(manifestValue, plan)
  const key = signingKey(keyPair)
  const unsigned = unsignedEnvelope(plan, manifest, key.signer)
  const signature = sign(null, signingBytes(unsigned), key.privateKey).toString("base64url")
  const signed = { ...unsigned, signature }
  const artifact: SignedDeploymentArtifact = deepFreeze({ ...signed, digest: digest(signed) })
  const bytes = encodeCanonicalJson(artifact)
  if (bytes.byteLength > MAX_SIGNED_DEPLOYMENT_BYTES) {
    return fail(`signed deployment artifact exceeds ${MAX_SIGNED_DEPLOYMENT_BYTES} bytes`)
  }
  return bytes
}

const trustStore = (rawKeys: readonly TrustedDeploymentKey[]): ReadonlyMap<string, KeyObject> => {
  let keys: unknown
  try {
    keys = assertJson(rawKeys, "trusted deployment keys")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "trusted deployment keys are not canonical data")
  }
  if (!Array.isArray(keys) || keys.length === 0) {
    return fail("deployment verification requires at least one trusted key")
  }
  if (keys.length > MAX_TRUSTED_DEPLOYMENT_KEYS) {
    return fail(`deployment verification accepts at most ${MAX_TRUSTED_DEPLOYMENT_KEYS} trusted keys`)
  }
  const trusted = new Map<string, KeyObject>()
  for (const [index, raw] of keys.entries()) {
    const record = exactObject(raw, `trusted deployment key[${index}]`, [
      "algorithm", "keyId", "publicKey"
    ])
    if (record.algorithm !== "Ed25519") return fail(`trusted deployment key[${index}] uses an unsupported algorithm`)
    if (typeof record.keyId !== "string" || !HEX_DIGEST.test(record.keyId)) {
      return fail(`trusted deployment key[${index}] has an invalid key id`)
    }
    const parsed = parsePublicKey(record.publicKey, `trusted deployment key[${index}].publicKey`)
    if (parsed.keyId !== record.keyId) return fail(`trusted deployment key[${index}] key id does not match its public key`)
    if (trusted.has(parsed.keyId)) return fail(`trusted deployment key ${parsed.keyId} is duplicated`)
    trusted.set(parsed.keyId, parsed.key)
  }
  return trusted
}

/**
 * Authenticates before returning any Plan or manifest to the coordinator. An
 * ordinary semantic digest detects corruption; only this signature establishes
 * that the artifact came from an out-of-band trusted build key.
 */
export const decodeSignedDeploymentArtifact = (
  bytes: Uint8Array | string,
  trustedKeys: readonly TrustedDeploymentKey[]
): SignedDeploymentArtifact => {
  let snapshot: Uint8Array | string
  if (typeof bytes === "string") {
    snapshot = bytes
  } else {
    if (!(bytes instanceof Uint8Array)) return fail("signed deployment artifact must be UTF-8 bytes or text")
    let sourceByteLength: number
    try {
      const byteLengthGetter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(Uint8Array.prototype),
        "byteLength"
      )?.get
      if (byteLengthGetter === undefined) throw new TypeError("missing typed-array byteLength intrinsic")
      sourceByteLength = Reflect.apply(byteLengthGetter, bytes, []) as number
    } catch {
      return fail("signed deployment artifact bytes could not be inspected")
    }
    if (sourceByteLength > MAX_SIGNED_DEPLOYMENT_BYTES) {
      return fail(`signed deployment artifact exceeds ${MAX_SIGNED_DEPLOYMENT_BYTES} bytes`)
    }
    // Detach verification from a caller-owned or SharedArrayBuffer-backed view.
    // All length, canonicalization, digest, and signature checks see one image.
    try {
      const detached = new Uint8Array(sourceByteLength)
      Reflect.apply(Uint8Array.prototype.set, detached, [bytes])
      snapshot = detached
    } catch {
      return fail("signed deployment artifact bytes could not be snapshotted")
    }
  }
  const byteLength = typeof snapshot === "string"
    ? Buffer.byteLength(snapshot, "utf8")
    : snapshot.byteLength
  if (byteLength > MAX_SIGNED_DEPLOYMENT_BYTES) {
    return fail(`signed deployment artifact exceeds ${MAX_SIGNED_DEPLOYMENT_BYTES} bytes`)
  }
  const trusted = trustStore(trustedKeys)
  let decoded: unknown
  try {
    decoded = decodeCanonicalJson(snapshot, "signed deployment artifact")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "signed deployment artifact is invalid")
  }
  const record = exactObject(decoded, "signed deployment artifact", [
    "artifactVersion", "digest", "kind", "manifest", "plan", "signature", "signer"
  ])
  if (record.artifactVersion !== 1 || record.kind !== "smithers.deployment") {
    return fail("signed deployment artifact has an unsupported kind or version")
  }
  const signerRecord = exactObject(record.signer, "signed deployment signer", ["algorithm", "keyId"])
  if (signerRecord.algorithm !== "Ed25519") return fail("signed deployment signer uses an unsupported algorithm")
  if (typeof signerRecord.keyId !== "string" || !HEX_DIGEST.test(signerRecord.keyId)) {
    return fail("signed deployment signer has an invalid key id")
  }
  if (typeof record.digest !== "string" || !HEX_DIGEST.test(record.digest)) {
    return fail("signed deployment artifact has an invalid digest")
  }
  const signatureBytes = encodedBytes(record.signature, "signed deployment signature", 64)
  if (signatureBytes.byteLength !== 64) return fail("signed deployment signature must contain 64 bytes")

  let plan: PlanTemplate
  let manifest: DeploymentManifest
  try {
    plan = validatePlanTemplate(record.plan)
    manifest = validateDeploymentManifest(record.manifest, plan)
  } catch (error) {
    return fail(error instanceof Error ? error.message : "signed deployment payload is invalid")
  }
  const signer = deepFreeze({
    algorithm: "Ed25519" as const,
    keyId: signerRecord.keyId
  })
  const unsigned = unsignedEnvelope(plan, manifest, signer)
  const signed = { ...unsigned, signature: record.signature as string }
  if (digest(signed) !== record.digest) return fail("signed deployment artifact digest mismatch")
  const trustedKey = trusted.get(signer.keyId)
  if (trustedKey === undefined) return fail(`deployment signer ${signer.keyId} is not trusted`)
  if (!verify(null, signingBytes(unsigned), trustedKey, signatureBytes)) {
    return fail("signed deployment signature verification failed")
  }
  return deepFreeze({ ...signed, digest: record.digest })
}

export const authenticateDeployment = <Input, Success>(
  deploymentValue: BuiltDeployment<Input, Success>,
  bytes: Uint8Array | string,
  trustedKeys: readonly TrustedDeploymentKey[]
): AuthenticatedDeployment<Input, Success> => {
  // The signed artifact authenticates serializable evidence; the runtime side
  // must independently be a deployment assembled through the checked builder.
  // This prevents a lookalike with extra pools from reaching workerFactory.
  const deployment = requireLocallyBuiltDeployment(deploymentValue)
  const artifact = decodeSignedDeploymentArtifact(bytes, trustedKeys)
  if (canonicalJson(artifact.plan) !== canonicalJson(deployment.flow.plan)) {
    return fail("runtime deployment Plan does not match the signed artifact")
  }
  if (canonicalJson(artifact.manifest) !== canonicalJson(deployment.manifest)) {
    return fail("runtime deployment manifest does not match the signed artifact")
  }
  const authentication = Object.freeze({
    [authenticatedDeploymentBrand]: true as const,
    deployment,
    artifactDigest: artifact.digest,
    signerKeyId: artifact.signer.keyId
  })
  issuedAuthentications.set(authentication, deployment)
  return authentication
}

export const requireAuthenticatedDeployment = <Input, Success>(
  authentication: AuthenticatedDeployment<Input, Success>
): BuiltDeployment<Input, Success> => {
  if (authentication === null || typeof authentication !== "object") {
    return fail("deployment authentication proof was not issued by the signature verifier")
  }
  // Do not compare two possibly-undefined values: an unissued object with an
  // undefined `deployment` used to satisfy that comparison. Resolve issuance
  // first, then return the verifier's value rather than reading attacker data.
  const issued = issuedAuthentications.get(authentication)
  if (issued === undefined) {
    return fail("deployment authentication proof was not issued by the signature verifier")
  }
  return issued as BuiltDeployment<Input, Success>
}

export const deploymentVerificationKey = (
  keyPair: DeploymentSigningKeyPair
): TrustedDeploymentKey => {
  const key = signingKey(keyPair)
  return deepFreeze({
    algorithm: key.signer.algorithm,
    keyId: key.signer.keyId,
    publicKey: keyPair.publicKey
  })
}

export const SignedDeployment = Object.freeze({
  authenticate: authenticateDeployment,
  decode: decodeSignedDeploymentArtifact,
  encode: encodeSignedDeploymentArtifact,
  generateKeyPair: generateDeploymentSigningKeyPair,
  requireAuthenticated: requireAuthenticatedDeployment,
  verificationKey: deploymentVerificationKey
})
