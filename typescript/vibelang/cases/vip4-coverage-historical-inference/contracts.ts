import type * as Actual from "./out/main.js"
import type * as Reference from "./reference/out/main.js"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
export const publicApi: Equal<typeof Actual, typeof Reference> = true
