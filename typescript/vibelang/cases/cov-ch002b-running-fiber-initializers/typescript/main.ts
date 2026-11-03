import {Effect} from "effect"
const seen:number[]=[]
function join(n:number){return n+1}
function fork(n:number){return n+2}
class Plain{static{seen.push(join(1),fork(1))}}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){
 class C{value=join(1)}
 enum E{A=join(1)}
 const names={join:3,fork:4}
 return [new C().value,E.A,seen,names.join+names.fork]
})}
