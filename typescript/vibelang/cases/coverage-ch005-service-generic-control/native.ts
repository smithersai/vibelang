import { Context } from "effect"
export class Fixed extends Context.Service<Fixed, { identity<T>(value:T):T }>()("coverage/Fixed") {}

