import { Context, Effect } from "effect"
class Outside extends Context.Service<Outside, { value: number }>()("coverage/Outside") {}
export function main() { return Effect.gen(function* () { return Outside.key }) }
