import { Config, Data, Effect, Exit } from "effect"
export const events: string[] = []
export class Missing extends Data.TaggedError("Missing")<{ readonly id: string }> {}
// Each return type is assignable to Effect.Effect<any, any, any> in Effect 4,
// so each function is effectful: its written @throws does not apply.
/** @throws {RangeError} */
export function exit(n: number): Exit.Exit<number> { events.push("exit"); return Exit.succeed(n) }
/** @throws {RangeError} */
export function config(value: string): Config.Config<string> { events.push("config"); return Config.succeed(value) }
/** @throws {RangeError} */
export function missing(id: string): Missing { events.push("missing"); return new Missing({ id }) }
/** @throws {RangeError} */
export function later(n: number): Effect.Effect<number> { events.push("later"); return Effect.succeed(n) }
/** @throws {RangeError} */
export function broken(): Exit.Exit<number> { events.push("broken"); throw new RangeError("broken") }
