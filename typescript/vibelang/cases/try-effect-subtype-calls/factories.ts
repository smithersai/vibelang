import { Config, Effect } from "effect"

// Calls whose results are Effects with structure of their own, as a .ts
// library returns them: Effect's sql Statement<A> is an interface extending
// Effect<ReadonlyArray<A>, SqlError>. Each says it throws nothing, as
// Effect's own package is trusted to.
export interface Sub extends Effect.Effect<number> {
  readonly tag: "Sub"
}

export interface Statement<A> extends Effect.Effect<ReadonlyArray<A>, string> {
  readonly sql: string
}

/** @throws {never} */
export const name = (): Config.Config<string> => Config.withDefault(Config.String("VIBELANG_CASE_TRY_SUBTYPE_UNSET"), "fallback")
/** @throws {never} */
export const tagged = (): Effect.Effect<number> & { readonly brand: "Service" } => Object.assign(Effect.succeed(2), { brand: "Service" as const })
/** @throws {never} */
export const sub = (): Sub => Object.assign(Effect.succeed(3), { tag: "Sub" as const })
/** @throws {never} */
export const make = (): Statement<{ readonly value: number }> => Object.assign(Effect.succeed([{ value: 1 }]), { sql: "select 1 as value" })
/** @throws {never} */
export const failing = (): Statement<{ readonly value: number }> => Object.assign(Effect.fail("no table"), { sql: "select * from missing" })
