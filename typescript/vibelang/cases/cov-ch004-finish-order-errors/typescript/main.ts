import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const log:string[]=[]
function iterator(name:string,value:unknown){return {[Symbol.iterator](){return this},next(){return {done:false as const,value}},return(){log.push(name);throw name+"-close"}}}
const inner=iterator("inner",1),outer=iterator("outer",inner)
outer.next();inner.next()
const errors:unknown[]=["body"]
for(const it of [outer,inner])try{it.return()}catch(e){errors.push(e)}
return [new AggregateError(errors).errors,log]
}) }
