import { Effect } from "effect"
function read(x:unknown):unknown{
 if((typeof x==="object" && x!==null || typeof x==="function") && "__proto__" in x) return (x as Record<string,unknown>)["__proto__"]
 return 0
}
function present(x:unknown){return (typeof x==="object" && x!==null || typeof x==="function") && "__proto__" in x && (x as Record<string,unknown>)["__proto__"]===7}
export function main():Effect.Effect<readonly unknown[],never>{
 return Effect.sync(():readonly unknown[] => [
  read({["__proto__"]:7}),read({["__proto__"]:7}),read({["__proto__"]:8}),
  ({__proto__:null,value:9}).value,present({["__proto__"]:7}),present({})
 ])
}
