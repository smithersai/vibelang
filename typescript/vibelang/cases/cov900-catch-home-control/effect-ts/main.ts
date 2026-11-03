// Chapter 900: cov900-catch-home-control — independent Effect reference.
import {Effect} from "effect"
import {work} from "./helpers.js"
function local(){
 try {work()}catch({code=(()=>{let captured=1;const ok=true;return [ok,captured]})()}:any){return code}
 return []
}
export function main(){return Effect.gen(function*(){return local()})}
