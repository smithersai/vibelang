import {Effect} from "effect"
/** @throws {never} */
export function h(component:()=>Effect.Effect<number>): Effect.Effect<number> { return component() }
