import { Effect } from "effect"

/** @throws {never} */
export function probe(s:unknown){return typeof s==="number"?s:0}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>probe(7))}
