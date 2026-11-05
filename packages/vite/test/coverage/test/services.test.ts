import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as V from "../src/services.vibe"
import * as T from "../src/services.effect.ts"

describe("vibe", () => {
  it.effect("finds a user", () => Effect.gen(function* () {
    expect(yield* V.nameOf("42")).toBe("Ada")
    expect(yield* V.greet("42")).toBe("hi Ada")
  }).pipe(Effect.provide(V.UsersLive)))
  it.effect("retains the service failure and the fallback", () => Effect.gen(function* () {
    const failure = yield* Effect.flip(V.greet("404"))
    expect(failure._tag).toBe("Bad")
    expect(failure.code).toBe("404")
    expect(yield* V.nameOf("404")).toBe("missing")
  }).pipe(Effect.provide(V.UsersLive)))
})
describe("ts", () => {
  it.effect("finds a user", () => Effect.gen(function* () {
    expect(yield* T.nameOf("42")).toBe("Ada")
    expect(yield* T.greet("42")).toBe("hi Ada")
  }).pipe(Effect.provide(T.UsersLive)))
  it.effect("retains the service failure and the fallback", () => Effect.gen(function* () {
    const failure = yield* Effect.flip(T.greet("404"))
    expect(failure._tag).toBe("Bad")
    expect(failure.code).toBe("404")
    expect(yield* T.nameOf("404")).toBe("missing")
  }).pipe(Effect.provide(T.UsersLive)))
})
