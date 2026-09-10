/** Serializable Effect Manifest surface. Source derivation belongs to the Go compiler. */
import type { DurableSchema } from "./value.ts"
export { failureIdentities } from "./schema-runtime.ts"

export interface EffectManifestChildFlow {
  readonly flowId: string
  readonly flowVersion: number
  readonly digest: string
}
export interface EffectManifestAction {
  readonly id: string
  readonly version: number
  readonly contractDigest: string
  readonly inputSchema: DurableSchema
  readonly successSchema: DurableSchema
  readonly errorSchema: DurableSchema
}
export interface EffectManifestContract {
  readonly kind: "signal" | "broadcast" | "queue" | "childFlow"
  readonly identity: string
  readonly contractDigest: string
}
export interface EffectManifestSite {
  readonly id: string
  readonly kind: "get" | "perform" | "sleep" | "signal" | "broadcast" | "queue" | "childFlow"
  readonly anchor: string
  readonly key?: string
}
export interface EffectManifest {
  readonly manifestVersion: 1
  readonly flowId: string
  readonly flowVersion: number
  readonly actions: readonly EffectManifestAction[]
  readonly requirements: readonly string[]
  readonly contracts: readonly EffectManifestContract[]
  readonly failures: readonly string[]
  readonly sites: readonly EffectManifestSite[]
  readonly digest: string
}

/** Data-only set projection for artifact cross-checks. */
export const effectManifestSets = (manifest: EffectManifest): {
  readonly actions: readonly string[]
  readonly capabilities: readonly string[]
  readonly contracts: readonly string[]
  readonly failures: readonly string[]
} => ({
  failures: [...manifest.failures].sort(),
  actions: manifest.actions.map(action => `${action.id}@${action.version}#${action.contractDigest}`).sort(),
  capabilities: [...manifest.requirements].sort(),
  contracts: manifest.contracts.map(contract => `${contract.kind}:${contract.identity}#${contract.contractDigest}`).sort(),
})
