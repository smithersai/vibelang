/**
 * Pure address predicates missing from Effect's NetAddress module.
 * No platform access, service key or layer.
 *
 * @experimental
 * @since 0.0.11
 */
import * as EffectNetAddress from "effect/net/NetAddress"
import * as Result from "effect/Result"

/**
 * Whether a string is an IPv6 literal, with Node-compatible optional zones.
 * Effect parses the bare address. Zones are nonempty ASCII letters, digits,
 * dash, dot or colon, with no numeric bounds or normalization.
 * This function neither resolves interface names nor performs platform I/O.
 *
 * @category predicates
 * @since 0.0.11
 */
export const isIPv6 = (input: string): boolean => {
  const separator = input.indexOf("%")
  if (separator === -1) return Result.isSuccess(EffectNetAddress.ipv6FromString(input))
  if (!/^[0-9A-Za-z.:-]+$/.test(input.slice(separator + 1))) return false
  return Result.isSuccess(EffectNetAddress.ipv6FromString(input.slice(0, separator)))
}
