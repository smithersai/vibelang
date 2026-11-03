import type * as Actual from "./main.vibe"
import type * as Native from "./native.js"
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
type Assert<T extends true>=T
type C0=Assert<Equal<typeof Actual.namespace,typeof Native.namespace>>
type C1=Assert<Equal<typeof Actual.fn,typeof Native.fn>>
type C2=Assert<Equal<typeof Actual.locals,typeof Native.locals>>
