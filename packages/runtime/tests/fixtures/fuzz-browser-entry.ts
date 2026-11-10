// Bundled for a realm with no Node globals by experimental-fuzz-vibelang.test.ts.
import { Effect, Schema } from "effect"
import { Fuzz, FuzzSimulation } from "vibelang-runtime/experimental"

;(globalThis as { result?: unknown }).result = Effect.runPromise(
  Fuzz.run(Schema.Literal(1), (n) => n === 1, { executions: 3, execution: FuzzSimulation.execution() })
)
