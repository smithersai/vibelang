import {
  authenticateDeployment,
  compileDurableSource,
  decodeSignedDeploymentArtifact,
  deploymentVerificationKey,
  encodeSignedDeploymentArtifact,
  generateDeploymentSigningKeyPair,
  PlanArtifact,
  type AuthenticatedDeployment,
  type DeploymentSigningKeyPair,
  type DurableSourceCompileOptions,
  type PlanTemplate,
  type SignedDeploymentArtifact,
  type TrustedDeploymentKey,
} from "vibelang/durable";
import { compileDurableSource as compileDirectly } from "vibelang/durable/source-compiler";

const options: DurableSourceCompileOptions = { actions: [] };
const compiled = compileDurableSource(`
import { durable } from "vibelang:flows"
export const Identity = durable(function Identity(input: unknown) {
  return input
})
`, options);

if (compiled.ok) {
  const plan: PlanTemplate = PlanArtifact.validate(compiled.plan);
  void plan;
}

const sameCompiler: typeof compileDurableSource = compileDirectly;
void sameCompiler;

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
// @ts-expect-error key generation takes no arguments
generateDeploymentSigningKeyPair(keyPair);
// @ts-expect-error verification keys derive from a signing key pair
deploymentVerificationKey(42);
// @ts-expect-error trusted keys must be a readonly array
decodeSignedDeploymentArtifact(new Uint8Array(), trustedKey);
void looseOptions;
void unnarrowedPlan;
