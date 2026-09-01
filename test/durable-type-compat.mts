import {
  authenticateDeployment,
  canonicalJson,
  compileDurableSource,
  compileEffectManifest,
  decodeSignedDeploymentArtifact,
  deploymentVerificationKey,
  digest,
  encodeSignedDeploymentArtifact,
  generateDeploymentSigningKeyPair,
  PlanArtifact,
  type AuthenticatedDeployment,
  type DeploymentSigningKeyPair,
  type DurableSourceCompileOptions,
  type EffectManifest,
  type EffectManifestAction,
  type PlanTemplate,
  type SignedDeploymentArtifact,
  type TrustedDeploymentKey,
} from "smthrs/durable";
import { compileDurableSource as compileDirectly } from "smthrs/durable/source-compiler";
import { compileEffectManifest as deriveDirectly } from "smthrs/durable/source-compiler";

const SOURCE = `
import { durable } from "smithers:flows"
export const Identity = durable(function Identity(input: unknown) {
  return input
})
`;

const options: DurableSourceCompileOptions = { actions: [] };
const compiled = compileDurableSource(SOURCE, options);

if (compiled.ok) {
  const plan: PlanTemplate = PlanArtifact.validate(compiled.plan);
  void plan;
}

/**
 * `MIGRATION-PLAN.md` §5 R1. This file is the second command in `npm test`
 * (`tsc -p tsconfig.compat.json`) and it used to reach the durable subsystem
 * through the Plan alone, so the entry point the pivot RETIRES was the only one
 * whose published types this gate checked. The Manifest path is checked here
 * too, from the same two specifiers, so retiring `compileDurableSource` becomes
 * a deletion rather than a hole.
 */
const derived = compileEffectManifest(SOURCE, options);
if (derived.ok) {
  const manifest: EffectManifest = derived.manifest;
  const actions: readonly EffectManifestAction[] = manifest.actions;
  void actions;
  // The published identity is re-derivable from the published bytes. That is
  // the property `smithers plan --outFile` now depends on, so it is typed here.
  const { digest: _declared, ...semantic } = manifest;
  const recomputed: string = digest(semantic);
  const canonical: string = canonicalJson(manifest);
  void recomputed;
  void canonical;
}

const sameCompiler: typeof compileDurableSource = compileDirectly;
const sameManifestCompiler: typeof compileEffectManifest = deriveDirectly;
void sameCompiler;
void sameManifestCompiler;

const keyPair: DeploymentSigningKeyPair = generateDeploymentSigningKeyPair();
const trustedKey: TrustedDeploymentKey = deploymentVerificationKey(keyPair);
void trustedKey;
void encodeSignedDeploymentArtifact;
void decodeSignedDeploymentArtifact;
void authenticateDeployment;
type PublicAuthentication = AuthenticatedDeployment<unknown, unknown>;
type PublicSignedArtifact = SignedDeploymentArtifact;
void (null as unknown as PublicAuthentication);
void (null as unknown as PublicSignedArtifact);

// Negative space: each line below is an error only while the public durable
// types stay strong. If a surface loosens to `any`, the suppression becomes
// unused and the compat gate fails with TS2578.
// @ts-expect-error durable source must be a string
compileDurableSource(42, options);
// @ts-expect-error action bindings must be an array
const looseOptions: DurableSourceCompileOptions = { actions: "none" };
// @ts-expect-error the failure branch exposes no plan without narrowing
const unnarrowedPlan: PlanTemplate = compiled.plan;
// @ts-expect-error the failure branch exposes no manifest without narrowing
const unnarrowedManifest: EffectManifest = derived.manifest;
void unnarrowedManifest;
// @ts-expect-error key generation takes no arguments
generateDeploymentSigningKeyPair(keyPair);
// @ts-expect-error verification keys derive from a signing key pair
deploymentVerificationKey(42);
// @ts-expect-error trusted keys must be a readonly array
decodeSignedDeploymentArtifact(new Uint8Array(), trustedKey);
void looseOptions;
void unnarrowedPlan;
