import { Effect } from "effect"
export function probe(s:number[]){return s.length===1?s[0]:0}
export function bytes(s:Uint8Array){return s.length===1?s[0]:0}
export function big(s:BigInt64Array){return s.length===1?s[0]:0n}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>[probe([7]),bytes(new Uint8Array([8])),String(big(new BigInt64Array([9n])))])}
