import {Effect} from "effect"
import {makePattern} from "./native-pattern.js"
function nativeMatches(Ctor:any,s:unknown){
 const key=(Symbol as any).customMatcher ?? Symbol.for("Symbol.customMatcher")
 if(Object.hasOwn(Ctor,key)){
  const m=Reflect.get(Ctor,key)
  if(typeof m==="function")return Boolean(Reflect.apply(m,Ctor,[s,{matchType:"boolean"}]))
 }
 return s instanceof Ctor
}
function witness():unknown[]{
const out:unknown[]=[]
for(const kind of ["throw","function","undefined"]){
 for(const own of [false,true]){
  const rows:unknown[]=[]
  for(let mode=0;mode<4;mode++){
   const trace:string[]=[]
   const Ctor=makePattern(kind,own,trace)
   const holder={pattern:Ctor}
   function choose(s:unknown,mode:number){
    switch(mode){
     case 0:return nativeMatches(Ctor,s)
     case 1:return nativeMatches(Ctor,s)
     case 2:return nativeMatches(Ctor,s)
     default:return nativeMatches(Ctor,s)
    }
   }
   try{rows.push([choose(new Ctor(),mode),choose({},mode),trace])}
   catch(error){rows.push(["threw",trace])}
  }
  out.push(rows)
 }
}
return out
}
export function main(){return Effect.succeed(witness())}
