import { Data, Effect } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Empty = Data.TaggedEnum<{}>
const Empty = Data.taggedEnum<Empty>()
export const exact: Equal<Empty, never> = true
export function main() { return Effect.succeed(Object.keys(Empty)) }
