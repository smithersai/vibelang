import {Effect} from "effect"
import {risky} from "./foreign.js"
export function bridged(s: string) { return Effect.gen(function* () { return yield* Effect.try({try:()=>risky(s),catch:(error)=>error}) }) }
