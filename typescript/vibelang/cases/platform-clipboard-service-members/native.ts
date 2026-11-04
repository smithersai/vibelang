import { Clipboard } from "@effect/platform-browser"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"

export const fixed = Clipboard.make({
  read: Effect.succeed([]),
  readString: Effect.succeed("copied"),
  write: (_items) => Effect.void,
  writeString: (_text) => Effect.void
})
export const provider = Layer.succeed(Clipboard.Clipboard, fixed)
export const expected = Effect.provide(Effect.gen(function* () {
  return yield* (yield* Clipboard.Clipboard).readString
}), provider)
