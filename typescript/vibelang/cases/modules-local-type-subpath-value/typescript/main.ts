// Value bindings keep emitted types independent of namespace import aliases.
const { KeyFormat: NativeKeyFormat } = await import("effect/crypto")
const { Transferable: NativeTransferable } = await import("effect/workers")
type KeyFormat = { readonly local: true }
export const foreign = NativeKeyFormat.jwk
export type LocalFormat = KeyFormat
interface Transferable { readonly local: true }
export const collect = NativeTransferable.makeCollectorUnsafe
export type LocalTransferable = Transferable
export function nested() {
  type KeyFormat = { readonly nested: true }
  const local: KeyFormat = { nested: true }
  return { local, foreign: NativeKeyFormat.jwk }
}
export function valueShadow() {
  const KeyFormat = { jwk: "local" as const }
  return KeyFormat.jwk
}
