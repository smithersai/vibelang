// Smithers' Bind.vibe declared "./Contribution.js" where its published .d.ts says "./Contribution.ts".
import { refuse } from "./Contribution.ts"
import type { Refusal } from './Contribution.ts'
import type { Helper } from "./helper.ts"

export * from "./Contribution.ts"
export * as C from './Contribution.ts'
export const bind = (x: Helper): Refusal => refuse(String(x.n))
export type Later = typeof import("./Contribution.ts")
