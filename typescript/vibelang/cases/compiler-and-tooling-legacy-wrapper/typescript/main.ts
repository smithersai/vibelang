import {Effect} from "effect"
export function make(){ return Effect.succeed(7) }
export function main(){ return Effect.gen(function*(){ return make() }) }
