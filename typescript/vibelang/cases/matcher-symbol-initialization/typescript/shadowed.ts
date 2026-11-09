import type {customMatcher as Protocol} from "vibelang-runtime"
export type Key=typeof Protocol
const Symbol={customMatcher:"local"}
export function inspect():boolean{return Symbol.customMatcher==="local"&&!Reflect.has(globalThis.Symbol,"customMatcher")}
