import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"

export interface Shape {
  readonly get: (id: string) => Effect.Effect<Option.Option<string>>
}

export class Svc extends Context.Service<Svc, Shape>()("t3/Svc") {}
