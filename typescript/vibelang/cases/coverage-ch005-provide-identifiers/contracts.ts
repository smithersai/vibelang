import type * as V from "./main.vibe"
import type * as N from "./native.js"
type Eq<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
type Assert<T extends true> = T
type Contract = Assert<Eq<typeof V, typeof N>>
