import { Effect } from "effect"
let reads=0
const value={get field(){reads++;return 7}}
function take(x:unknown,key:string):unknown{
 if((typeof x==="object"&&x!==null||typeof x==="function")&&key in x){const value:unknown=Reflect.get(x,key);return value}
 return 0
}
export function main():Effect.Effect<readonly unknown[],never>{return Effect.sync(():readonly unknown[] => [take(value,"field"),take({},"field"),take({field:undefined},"field")===undefined,take(Object.create({field:"old"}),"field"),take(1,"field"),reads])}
