import { Config, Effect, Exit } from "effect"
let argumentsRead = 0, receiversRead = 0, methodsRead = 0, runs = 0
export const argument = () => { argumentsRead++; return "x" }
const object = { prefix: "ok:", get decode() { methodsRead++; return function(this: { prefix: string }, s: string): Effect.Effect<string> { return Effect.sync(() => { runs++; return this.prefix + s }) } } }
export const receiver = (present: boolean): typeof object | undefined => { receiversRead++; return present ? object : undefined }
export const counts = () => [argumentsRead, receiversRead, methodsRead, runs]
/** @throws {never} */
export const config = (): Config.Config<string> => Config.succeed("data")
/** @throws {never} */
export const exit = (): Exit.Exit<string> => Exit.succeed("data")
export const blank = (): Effect.Effect<string> => Effect.succeed("")
export const fallback = (): Effect.Effect<string> => Effect.succeed("fallback")
