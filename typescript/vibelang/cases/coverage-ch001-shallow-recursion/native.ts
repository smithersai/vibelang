import { Effect } from "effect"
function down2(n:number):number { return n === 0 ? 0 : down2(n-1) }
export const main = () => Effect.gen(function* () { return down2(3) })
