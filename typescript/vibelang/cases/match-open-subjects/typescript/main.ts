import { Effect } from "effect"
export type OpenTag = { readonly _tag: "A" } | { readonly _tag: string }
export type OpenCallable = (() => void) | { readonly _tag: "A" }
export function numberCase(value: number): Effect.Effect<string, never> {
 return Effect.gen(function* () { if (value === 1) return "one"; throw new TypeError() })
}
export function tagCase(value: OpenTag): Effect.Effect<string, never> {
 return Effect.gen(function* () { if (value._tag === "A") return "a"; throw new TypeError() })
}
export function voidCase(value: void): Effect.Effect<number, never> {
 return Effect.gen(function* () { const item = value; if (false) return 0; throw new TypeError() })
}
export function genericCase<T>(value: T): Effect.Effect<string, never> {
 return Effect.gen(function* () { if (value === null) return "null"; throw new TypeError() })
}
export function callableCase(value: OpenCallable): Effect.Effect<string, never> {
 return Effect.gen(function* () {
  if ((typeof value === "object" || typeof value === "function") && value !== null && "_tag" in value && value._tag === "A") return "a"
  throw new TypeError()
 })
}
