import { Effect } from "effect"
function witness():readonly unknown[]{const n=99;let turn=0;const reads:(()=>unknown)[]=[]
 while(++turn<3){
  if(turn!==2){let n=turn;reads.push(()=>n);n+=10;continue}
  reads.push(()=>{try{
   // Intentional runtime witness: the unreachable declaration remains in TDZ.
   // @ts-ignore TS2448 TS2454
   return n
  }catch(e){return e instanceof ReferenceError?"tdz":"other"}})
  continue
  let n:number=0
 }
 return [reads.map(read=>read()),n]
}
export function main():Effect.Effect<readonly unknown[]>{return Effect.sync(witness)}
