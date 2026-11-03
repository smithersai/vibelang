import { Effect } from "effect"
export function classify(s:"a"|"b"){return s==="a"?(1 as const):("b" as const)}
function fail():never{throw "bad"}
export function thrown(s:boolean){return s?(1 as const):fail()}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>[classify("a"),classify("b"),thrown(true)])}
