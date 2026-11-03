import { Effect } from "effect"
export function mapValue(s:Map<string,number>){return s}
export function setValue(s:Set<number>){return s}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>[mapValue(new Map([["x",7]])).get("x"),setValue(new Set([8])).has(8)])}
