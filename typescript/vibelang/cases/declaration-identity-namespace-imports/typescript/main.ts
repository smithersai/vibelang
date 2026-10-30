import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

export interface Shape {
  readonly get: (id: string) => Effect.Effect<Option.Option<string>>
}

type Svc_shape = Shape

const Svc_base: Context.ServiceClass<Svc, "t3/Svc", Svc_shape> = Context.Service<Svc, Svc_shape>()("t3/Svc")
export class Svc extends Svc_base {}
export declare namespace Svc { type Shape = Svc_shape }
