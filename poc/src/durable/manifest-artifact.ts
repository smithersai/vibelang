import type { EffectManifest } from "./effect-manifest.ts"
import { validateActionContractDescriptor } from "./schema-runtime.ts"
import { assertJson, canonicalJson, deepFreeze, digest } from "./value.ts"

const exact = (value: object, fields: readonly string[]): void => {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...fields].sort())) throw new TypeError("Effect Manifest has unexpected fields")
}
const strings = (value: unknown): readonly string[] => {
  if (!Array.isArray(value) || value.length > 100_000 || value.some(item => typeof item !== "string" || !item || item.length > 4096 || item.includes("\0")) ||
    canonicalJson(value) !== canonicalJson([...new Set(value)].sort())) throw new TypeError("Effect Manifest table must be sorted, bounded and unique")
  return value
}

/** Validate data only. Inspection and authentication never load executable code. */
export function validateEffectManifest(value: unknown): EffectManifest {
  const normalized = assertJson(value, "Effect Manifest")
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw new TypeError("Expected an Effect Manifest")
  const manifest = normalized as unknown as EffectManifest
  exact(manifest, ["manifestVersion", "flowId", "flowVersion", "actions", "requirements", "contracts", "failures", "sites", "digest"])
  if (manifest.manifestVersion !== 1 || typeof manifest.flowId !== "string" || !manifest.flowId.trim() || manifest.flowId.includes("\0") ||
    !Number.isSafeInteger(manifest.flowVersion) || manifest.flowVersion < 1) throw new TypeError("Invalid Effect Manifest identity")
  const { digest: claimed, ...identity } = manifest
  if (!/^[0-9a-f]{64}$/.test(claimed) || digest(identity) !== claimed) throw new TypeError("Effect Manifest digest mismatch")
  strings(manifest.requirements)
  strings(manifest.failures)
  if (!Array.isArray(manifest.actions) || !Array.isArray(manifest.sites) || !Array.isArray(manifest.contracts)) throw new TypeError("Invalid Effect Manifest tables")
  const actions = new Set(strings(manifest.actions.map(action => validateActionContractDescriptor(action).id)))
  strings(manifest.sites.map(site => site.id))
  strings(manifest.contracts.map(contract => `${contract.kind}#${contract.identity}#${contract.contractDigest}`))
  for (const contract of manifest.contracts) {
    exact(contract, ["kind", "identity", "contractDigest"])
    if (!["signal", "broadcast", "queue", "childFlow"].includes(contract.kind) ||
      typeof contract.identity !== "string" || !contract.identity || !/^[0-9a-f]{64}$/.test(contract.contractDigest)) throw new TypeError("Invalid external-input contract")
  }
  for (const site of manifest.sites) {
    exact(site, ["id", "kind", "anchor", ...(site.key === undefined ? [] : ["key"])])
    if (!/^src-[0-9a-f]{24}$/.test(site.id) || !/^\d+:\d+$/.test(site.anchor) ||
      !["get", "perform", "sleep", "signal", "broadcast", "queue", "childFlow"].includes(site.kind) ||
      (site.key !== undefined && (typeof site.key !== "string" || !site.key)) ||
      (site.kind === "perform" && (!site.key || !actions.has(site.key))) ||
      (site.kind === "get" && !site.key) ||
      (site.kind !== "get" && site.kind !== "perform" && site.kind !== "sleep" &&
        !manifest.contracts.some(contract => contract.kind === site.kind && contract.identity === site.key))) {
      throw new TypeError("Invalid Effect Manifest site")
    }
  }
  return deepFreeze(manifest)
}
