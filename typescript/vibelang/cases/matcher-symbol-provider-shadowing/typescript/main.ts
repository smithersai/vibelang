import {customMatcher as runtimeKey} from "vibelang-runtime"
const customMatcher=1
const {customMatcher:key}=Symbol
class P{static [runtimeKey](s:unknown):boolean{return typeof s==="number"}}
export function inspect():boolean{return P[runtimeKey](2)&&typeof runtimeKey==="symbol"&&key===runtimeKey}
