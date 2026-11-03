import { Effect } from "effect"

// t3code apps/server DatabaseMaintenance.inspect: a stage reads the argument.
export const inspect = Effect.fn("DatabaseMaintenance.inspect")(
  function* (databasePath: string) {
    return yield* Effect.succeed(databasePath.length)
  },
  (effect, databasePath) => effect.pipe(Effect.map((size) => `${databasePath}:${size}`)),
)

// t3code apps/desktop DesktopLegacyLocalStorage.newestFileMtime: a stage that reads no argument.
export const newestFileMtime = Effect.fn("DesktopLegacyLocalStorage.newestFileMtime")(
  function* (directory: string) {
    if (directory === "") return yield* Effect.fail("empty")
    return directory.length
  },
  (effect) => effect.pipe(Effect.option),
)

// t3code apps/server cli/project: a stage that takes both arguments.
export const snapshot = Effect.fn("project.fetchLiveOrchestrationSnapshot")(
  function* (origin: string, bearerToken: string) {
    return yield* Effect.succeed(`${origin}#${bearerToken.length}`)
  },
  (effect, origin, bearerToken) =>
    effect.pipe(Effect.map((text) => (origin.startsWith("http") ? text.toUpperCase() : text))),
)

// t3code apps/server CodexAdapterV2.startNativeTurn: a stage reads the first of two arguments.
export const startTurn = Effect.fn("CodexAdapterV2.startNativeTurn")(
  function* (turnInput: string, codexInput: number) {
    return yield* Effect.succeed(turnInput.length + codexInput)
  },
  (effect, turnInput) => effect.pipe(Effect.map((n) => `${turnInput}=${n}`)),
)

// t3code apps/server ClaudeProvider: a comment between the parameters.
export const verify = Effect.fn("ClaudeProvider.verify")(function* (
  proof: string | undefined,
  // Requests that cannot carry a proof send the header.
  header: string,
) {
  return yield* Effect.succeed(proof ?? header)
})

// t3code apps/server SourceControlRepositoryService: a comment before a stage.
export const lookup = Effect.fn("SourceControlRepositoryService.lookupRepository")(
  function* (name: string) {
    if (name === "") return yield* Effect.fail("missing")
    return name.length
  },
  // Someone is waiting, so a missing repository reads as none.
  Effect.orElseSucceed(() => 0),
)
