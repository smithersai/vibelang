import type { E, S } from "../main.d.vibe.ts"
type EMatcher=(typeof E)[typeof Symbol.customMatcher]
type SMatcher=(typeof S)[typeof Symbol.customMatcher]
type N=E["n"]
type ID=S["id"]
declare const n:N
declare const id:ID
const numberValue:number=n
const stringValue:string=id
