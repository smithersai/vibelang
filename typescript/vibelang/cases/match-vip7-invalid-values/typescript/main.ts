import { Effect } from "effect"
interface User {id:string}
const isUser=(u:unknown):u is User=>typeof u==="object"&&u!==null&&"id" in u
class Point {}
function pair(s:unknown,hint:{matchType:string}):false|readonly [number,string]{return typeof s==="number"?[s,hint.matchType]:false}
export function valid(s:unknown):unknown{if(isUser(s))return s.id;if(Array.isArray(s))return s.length;if(s instanceof Point)return 0;return -1}
export function extract(s:unknown):unknown{const result=pair(s,{matchType:"extractor"});if(result!==false){const [n,hint]=result;return [n,hint]}return []}
export function main():Effect.Effect<readonly unknown[]>{return Effect.sync(()=>[valid({id:"x"}),valid([1,2]),valid(new Point()),valid(null),extract(7),extract("x")])}
