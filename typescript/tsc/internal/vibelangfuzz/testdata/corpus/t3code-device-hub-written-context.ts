import { Effect } from "effect"
export interface Access { readonly query: Readonly<Record<string, string>> }
const resolve = Effect.fn("proof")(function* (flag: boolean): Effect.fn.Return<Access> {
  if (flag) return { query: {} }
  return { query: { ticket: "t" } }
})
export const main = () => Effect.all([resolve(true), resolve(false)])
