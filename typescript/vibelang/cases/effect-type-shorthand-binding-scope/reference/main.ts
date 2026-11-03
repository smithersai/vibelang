import * as Native from "effect/Effect"
import { imported } from "./imported.js"
type Effect<A,E=never,R=never>={value:A;error?:E;requirements?:R}
export const local:Effect<number>={value:1}
export function main(){return Native.gen(function*(){return [local.value,imported.value]})}
