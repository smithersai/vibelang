// expect-result: {"count":2,"explicit":1,"path":"root","callback":3}
import { Effect, Schema } from "effect"
import { Path, canonical, cleanup, explicit, optional } from "./lib.js"

export function main() {
  return Effect.gen(function* () {
    const callback = yield* optional(() => 3)
    return {
      count: yield* cleanup(["a", "b"]),
      explicit: yield* explicit(["a"]),
      path: yield* canonical(Schema.decodeUnknownSync(Path)("root")),
      callback: callback?.() ?? 0
    }
  })
}
