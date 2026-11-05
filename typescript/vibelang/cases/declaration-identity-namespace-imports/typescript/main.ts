import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

export interface Shape {
  readonly get: (id: string) => Effect.Effect<Option.Option<string>>
}

const Svc_base: Context.ServiceClass<Svc, "t3/Svc", Shape> = Context.Service<Svc, Shape>()("t3/Svc")
export class Svc extends Svc_base {}
