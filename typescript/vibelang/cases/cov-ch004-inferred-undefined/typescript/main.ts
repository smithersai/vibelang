import { Effect } from "effect"
export function payload(s:(number|undefined)[]){const it=s[Symbol.iterator]();const first=it.next();const second=it.next();return !first.done&&second.done?first.value:0}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>[String(payload([undefined])),payload([7]),payload([7,8])])}
