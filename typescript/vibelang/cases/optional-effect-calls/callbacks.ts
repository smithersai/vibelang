import { Effect } from "effect"
export type Decode = (input: string) => Effect.Effect<string>
export interface Flow { readonly decode?: Decode }
export interface RequiredFlow { readonly decode: Decode }
let runs = 0
let calls = 0
export const decoder: Decode = (s) => { calls++; return Effect.sync(() => { runs++; return s.toUpperCase() }) }
export const counts = () => [calls, runs]
/** @throws {never} */
export const plain = (s: string): string => s.toUpperCase()
