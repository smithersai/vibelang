import * as NativeEffect from "effect/Effect"
import * as NativeOption from "effect/Option"
type Effect = { readonly local: true }
interface Option { readonly local: true }
export type LocalEffect = Effect
export type LocalOption = Option
export const succeedKind = typeof NativeEffect.succeed
export const someKind = typeof NativeOption.some
