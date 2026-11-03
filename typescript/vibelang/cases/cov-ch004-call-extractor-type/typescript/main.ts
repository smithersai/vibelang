import { Effect } from "effect"
function isNumber(s:unknown):s is number{return typeof s==="number"}
function extract(s:unknown):false|[number]{return typeof s==="number"?[s]:false}
export function bare(s:unknown){return isNumber(s)?s:0}
export function probe(s:unknown){const list=extract(s);return list===false?0:list[0]}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>[bare(7),bare("x"),probe(8),probe("x")])}
