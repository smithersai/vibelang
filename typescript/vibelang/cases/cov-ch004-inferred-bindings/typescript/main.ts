import { Effect } from "effect"
export function arrayValue<T>(s:readonly T[],fallback:T){const it=s[Symbol.iterator]();const first=it.next();const second=it.next();return !first.done&&second.done?first.value:fallback}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>[arrayValue([8],0),arrayValue([],9)])}
