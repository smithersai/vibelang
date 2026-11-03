import {Effect} from "effect"
import {poison} from "./poison.js"
export function probe(kind:number,mutate:boolean):unknown {
 const events:string[]=[]
 const obj={n:5,get m(){events.push("get");return poison(function(this:any,x:number):unknown{events.push("call");return this===undefined?"detached":this.n+x},events)}}
 let result:unknown
 switch(kind){
 case 0:result=obj.m!((()=>{events.push("argument");if(mutate)obj.n=10;return 2})());break
 case 1:result=(obj.m as (x:number)=>unknown)((()=>{events.push("argument");if(mutate)obj.n=10;return 2})());break
 case 2:result=(obj.m satisfies (x:number)=>unknown)((()=>{events.push("argument");if(mutate)obj.n=10;return 2})());break
 case 3:result=(<(x:number)=>unknown>obj.m)((()=>{events.push("argument");if(mutate)obj.n=10;return 2})());break
 default:result=(events.push("detach"),obj.m)((()=>{events.push("argument");if(mutate)obj.n=10;return 2})())
 }
 return [result,events]
}
export function main():Effect.Effect<unknown> { return Effect.gen(function*(){
 const results:unknown[]=[]
 for(const mutate of [false,true])for(const kind of [0,1,2,3,4])results.push(probe(kind,mutate))
 return results
}) }
