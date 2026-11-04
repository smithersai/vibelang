import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"

export const provider = ConfigProvider.layer(ConfigProvider.fromUnknown({ NAME: "configured" }))
export const expected = Effect.provide(Config.String("NAME"), provider)
