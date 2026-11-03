import { Effect } from "effect"
declare const setWindow: () => true | Promise<void>
export const f = Effect.try({ try: () => setWindow(), catch: () => "e" as const }).pipe(
  Effect.flatMap((r) => r === true ? Effect.void : Effect.tryPromise({ try: () => r, catch: () => "e" as const }))
)
