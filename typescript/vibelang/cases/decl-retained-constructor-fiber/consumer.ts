import * as Plain from "./out/plain.js"
import * as Matched from "./out/matched.js"
import * as Shadow from "./out/shadow.js"
import * as Written from "./out/written.js"
import {AsyncFiberError} from "effect/Cause"
type Exact<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
type Assert<T extends true>=T
type A=Assert<Exact<typeof Plain.ctor,typeof AsyncFiberError>>
type B=Assert<Exact<typeof Matched.ctor,typeof Plain.ctor>>
type C=Assert<Exact<typeof Shadow.ctor,typeof Plain.ctor>>
type D=Assert<Exact<typeof Written.ctor,typeof Plain.ctor>>
