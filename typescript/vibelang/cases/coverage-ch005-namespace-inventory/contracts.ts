import type * as Actual from "./main.vibe"
import type * as Native from "./native.js"
type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
type Assert<T extends true>=T
type Roots=Assert<Equal<typeof Actual.roots,typeof Native.roots>>
type Namespaces=Assert<Equal<typeof Actual.namespaces,typeof Native.namespaces>>
type Crypto=Assert<Equal<Actual.CryptoType,Native.CryptoType>>
