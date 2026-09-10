import { validateDeploymentManifestForContract } from "./artifact.ts"
import { validateDurableBodyArtifact, type DurableBodyArtifact } from "./body-artifact.ts"
import { buildDeploymentAssets, type DeploymentAssets, type WorkerPool } from "./provider.ts"
import type { DeploymentManifest } from "./value.ts"

export interface ExecutableFlow<Input = unknown, Success = unknown> {
  readonly id: string
  readonly version: number
  readonly body: DurableBodyArtifact
  /** Type-only boundary information; never authority or serializable state. */
  readonly __types?: (input: Input) => Success
}

export interface BuiltBodyDeployment<Input = unknown, Success = unknown> extends DeploymentAssets {
  readonly flow: ExecutableFlow<Input, Success>
}

const issued = new WeakSet<object>()

/** @internal Select an issued executable deployment without reading user fields. */
export function isLocallyBuiltBodyDeployment(value: unknown): value is BuiltBodyDeployment<any, any> {
  return value !== null && typeof value === "object" && issued.has(value)
}

const contract = (body: DurableBodyArtifact) => ({ digest: body.digest, actions: body.manifest.actions,
  requirements: body.manifest.actions.map(action => action.id).sort() })

export function validateBodyDeploymentManifest(value: unknown, bodyValue: unknown): DeploymentManifest {
  return validateDeploymentManifestForContract(value, contract(validateDurableBodyArtifact(bodyValue)))
}

export function buildBodyDeployment<Input, Success>(options: {
  readonly id: string
  readonly flow: ExecutableFlow<Input, Success>
  readonly pools: readonly WorkerPool[]
}): BuiltBodyDeployment<Input, Success> {
  const body = validateDurableBodyArtifact(options.flow.body)
  if (options.flow.id !== body.manifest.flowId || options.flow.version !== body.manifest.flowVersion) {
    throw new TypeError("Flow identity does not match its executable body")
  }
  const actionIds = new Set(body.manifest.actions.map(action => action.id))
  const unsupplied = body.manifest.requirements.filter(requirement => !actionIds.has(requirement))
  if (unsupplied.length) throw new TypeError(`executable deployment is missing capability providers: ${unsupplied.join(", ")}`)
  const flow: ExecutableFlow<Input, Success> = Object.freeze({ id: body.manifest.flowId,
    version: body.manifest.flowVersion, body })
  const assets = buildDeploymentAssets(options.id, contract(body), Object.freeze([...options.pools]))
  const deployment = Object.freeze({ flow, ...assets })
  issued.add(deployment)
  return deployment
}

export function requireLocallyBuiltBodyDeployment<Input, Success>(
  deployment: BuiltBodyDeployment<Input, Success>
): BuiltBodyDeployment<Input, Success> {
  if (!deployment || typeof deployment !== "object" || !issued.has(deployment)) {
    throw new TypeError("executable deployment was not issued by the deployment builder")
  }
  return deployment
}

export const BodyDeployment = Object.freeze({ build: buildBodyDeployment })
