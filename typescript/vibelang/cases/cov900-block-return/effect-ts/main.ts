// Chapter 900: cov900-block-return — independent Effect reference.
import {Effect} from "effect"
const p=Effect.gen(function*(){while(true){break};return (()=>{let n=1;return n})()})
export function main(){return Effect.gen(function*(){return [yield* p]})}
