import type { ActionProvider } from "./provider.ts"
import { digest, type ActionRouteManifest, type JsonValue } from "./value.ts"

export type ProviderReuseIdentity =
  | { readonly kind: "memo"; readonly key: string; readonly inputDigest: string; readonly scope: string; readonly generation: string }
  | { readonly kind: "content"; readonly key: string; readonly inputDigest: string }

/** One identity scheme for every coordinator representation. Input is a frozen codec snapshot. */
export function providerReuseIdentity(provider: ActionProvider<any, any, any>, route: ActionRouteManifest,
  input: JsonValue): ProviderReuseIdentity | undefined {
  const reuse = provider.reuse
  if (reuse.kind === "execution") return undefined
  const common = { actionId: route.actionId, actionVersion: route.actionVersion,
    actionContractDigest: route.actionContractDigest, implementationDigest: provider.implementationDigest,
    policyDigest: provider.policyDigest, target: route.policy.target }
  const inputDigest = digest(input)
  if (reuse.kind === "memo") {
    const explicitKey = reuse.key(input)
    if (typeof explicitKey !== "string") throw new TypeError(`${route.actionId} memo key must return a string`)
    return { kind: "memo", key: digest({ ...common, explicitKey }), inputDigest,
      scope: reuse.scope, generation: reuse.generation }
  }
  return { kind: "content", key: digest({ ...common, input, dependencyDigests: provider.dependencyDigests,
    invalidationSalt: reuse.invalidationSalt ?? "" }), inputDigest }
}
