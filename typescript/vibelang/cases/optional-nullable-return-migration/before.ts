import { Effect } from "effect"
import { maybe, absent, argument } from "./lib.js"
export const valueResult = () => Effect.gen(function* () { return maybe?.("value") })
export const emptyResult = () => Effect.gen(function* () { return maybe?.("empty") })
export const thrownResult = () => Effect.gen(function* () { return maybe?.("throw") })
export const absentResult = () => Effect.gen(function* () { return absent?.(argument()) })
