import { Effect } from "effect"
export function objectField(s:{x?:number}){return "x" in s?s.x:0}
export function unknownField(s:unknown){return (typeof s==="object"||typeof s==="function")&&s!==null&&"x" in s?s.x:0}
export function indexedField(s:Record<string,number>){return "x" in s?(s["x"] as number):0}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>[objectField({x:7}),unknownField({x:"x"}),indexedField({x:9})])}
