import {Effect} from "effect"
export function main() {return Effect.gen(function*(){
 const topic=(()=>{return class {static observed=this.name}})()
 const piped=[topic.name,topic.observed]
 const matched=(()=>{if(true)return class {static observed=this.name};return class {static observed=this.name}})()
 const completed=(()=>{if(true){return class {static observed=this.name}}else{return class {static observed=this.name}}})()
 return {piped,matched:[matched.name,matched.observed],completed:[completed.name,completed.observed]}
})}
