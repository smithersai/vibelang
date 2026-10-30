import { Effect } from "effect"
interface effect { value: number }
const effect = class { value = 7 }
export class Direct extends effect {
  read() { return Effect.gen({ self: this }, function* () { return yield* Effect.succeed(this.value + 1) }) }
}
export const Expression = class extends effect {
  read() { return Effect.gen({ self: this }, function* () { return yield* Effect.succeed(this.value + 2) }) }
}
export class TypeOnly implements effect { value = 11 }
export class Nested extends (class { program = Effect.gen(function* () { return 12 }) }) {}
