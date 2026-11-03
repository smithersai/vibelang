import type * as Actual from "./main.vibe"
import type * as Native from "./native.js"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
type Chained = Assert<Equal<ReturnType<typeof Actual.chained>, ReturnType<typeof Native.chained>>>
type Retained = Assert<Equal<ReturnType<typeof Actual.retained>, ReturnType<typeof Native.retained>>>
type RetainedCheckName = Assert<Equal<ReturnType<typeof Actual.retainedCheckName>, ReturnType<typeof Native.retainedCheckName>>>
type Collected = Assert<Equal<ReturnType<typeof Actual.collect>, ReturnType<typeof Native.collect>>>
