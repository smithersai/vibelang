import { Effect } from "effect"
export function regex(s:string):readonly [string,string]|undefined {const m=/(\d+)/.exec(s);if(m){const typed:RegExpExecArray=m;const group:string=m[1];return [typed[0],group] as const}return undefined}
export function relational(s:-1|1):-1|1 {if(s<0){const a:typeof s=-1;const b:typeof s=1;return s}const a:typeof s=-1;const b:typeof s=1;return s}
export function main():Effect.Effect<readonly unknown[]> {return Effect.sync(()=>[regex("a12"),regex("none"),relational(-1),relational(1)])}
