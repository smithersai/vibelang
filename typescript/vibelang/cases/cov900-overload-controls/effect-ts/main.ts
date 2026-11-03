// Chapter 900: cov900-overload-controls — independent Effect reference.
import {Effect} from "effect"
function double(x:number):number
function double(x:string):string
function double(x:number|string){return typeof x==="number"?x*2:x+x}
function load(x:number):Effect.Effect<number>
function load(x:string):Effect.Effect<string>
function load(x:number|string){return Effect.gen(function*(){return x})}
export function main(){return Effect.gen(function*(){return [double(2),double("a"),yield* load(3),yield* load("b")]})}
