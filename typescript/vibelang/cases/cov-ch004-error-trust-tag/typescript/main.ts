import { Effect } from "effect"
interface Missing {readonly _tag:"Missing";readonly id:string;readonly label:string}
function isMissing(s:unknown):s is Missing{return (typeof s==="object"||typeof s==="function")&&s!==null&&"_tag" in s&&s._tag==="Missing"}
export function probe(s:unknown):readonly[boolean,boolean]{return [isMissing(s),isMissing(s)]}
export function label(s:unknown):string{return isMissing(s)?s.label:"other"}
export function templateProbe(s:unknown):boolean{return s==="ready"}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>{const foreign={_tag:"Missing"};const coerced={toString(){return "ready"}};const poison={[Symbol.toPrimitive](){throw new Error("coerced")}};return [probe(foreign),String(label(foreign)),templateProbe(coerced),templateProbe(poison)]})}
