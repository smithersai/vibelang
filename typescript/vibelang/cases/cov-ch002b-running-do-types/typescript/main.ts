import {Effect} from "effect"
function pick(n:1):Effect.Effect<number>
function pick(n:number):Promise<number>
function pick(n:number):Effect.Effect<number>|Promise<number>{return Effect.succeed(n)}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){
 const exact=1;const checked:1=exact
 let wide=1;wide=2
 const inherited:7=7
 const voided:undefined=undefined
 const program:Effect.Effect<number>=pick(1)
 return [checked,wide,inherited,voided===undefined,yield* program]
})}
