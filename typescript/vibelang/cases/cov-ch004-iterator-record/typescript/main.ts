import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const log:string[]=[];let count=0
const it={ [Symbol.iterator](){return this}, get next(){log.push("get next");return function(){count++;log.push("next "+count);return count===1?{done:false,value:1}:{done:true,value:undefined}}},return(){log.push("close");return {done:true,value:undefined}}}
const iterator=it[Symbol.iterator]();const next=iterator.next
const first=next.call(iterator);const second=next.call(iterator)
return [first.value===1&&second.done?1:-1,log]
}) }
