import { Effect } from "effect"
import { numbers } from "./native.js"
function first(log:string[]):number {for(const a of numbers(log))return a;return -1}
function breakOut(log:string[]):void {outer:for(let i=0;i<2;i++){for(const a of numbers(log))break outer;log.push("after")}}
function continueOut(log:string[]):void {outer:for(let i=0;i<2;i++){log.push("loop");for(const a of numbers(log))continue outer;log.push("after")}}
function closeReplacesReturn(log:string[]):number {for(const a of numbers(log,true))return a;return -1}
function witness():unknown {const a:string[]=[],b:string[]=[],c:string[]=[],d:string[]=[];const value=first(a);breakOut(b);continueOut(c);let closed:unknown;try{closed=closeReplacesReturn(d)}catch(e){closed=(e as Error).message}return [value,a,b,c,closed,d]}
export function main():Effect.Effect<unknown>{return Effect.sync(witness)}
