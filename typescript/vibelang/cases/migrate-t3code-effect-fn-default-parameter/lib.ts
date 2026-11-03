import { Effect } from "effect"

export interface Options {
  readonly label?: string
}

// t3code packages/effect-codex-app-server make: a defaulted written alias.
export const make = Effect.fn("make")(function* (options: Options = {}) {
  return options.label ?? "none"
})

// t3code packages/ssh auth: a defaulted object type.
export const resolve = Effect.fn(function* (input: { readonly host?: string } = {}) {
  return input.host ?? "local"
})

// t3code packages/client-runtime session: a default after a required parameter.
export const open = Effect.fn("open")(function* (name: string, retries: number = 2) {
  return name.length + retries
})

// A default whose type already holds undefined keeps its written union.
export const pick = Effect.fnUntraced(function* (value: number | undefined = 1) {
  return value
})
