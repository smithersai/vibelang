import { Effect } from "effect"
abstract class Plain { abstract value():number }
class Impl extends Plain { value() { return 7 } }
declare class Native { value:number }
declare const count:number
export const main = () => Effect.gen(function* () { return [new Impl().value(), "key" in Plain, typeof Native, typeof count] })
