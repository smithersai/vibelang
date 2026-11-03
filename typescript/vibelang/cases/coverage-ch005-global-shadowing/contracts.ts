import type * as Actual from "./main.vibe"
import type * as Native from "./native.js"
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
type Assert<T extends true>=T
type Values=Assert<Equal<typeof Actual.values,typeof Native.values>>
