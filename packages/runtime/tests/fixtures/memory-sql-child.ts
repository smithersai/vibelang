// One process of the memory restart tests: it opens a SQLite file through
// Experimental.Memory.layerSql, runs one operation and exits, so the next
// process starts with nothing but the file.
import { Effect, Layer } from "effect"
import { Memory } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./bun-sqlite-client.ts"

const [database, operation, ...args] = process.argv.slice(2)
const bank = "agent-reviewer"
const program: Effect.Effect<unknown, Memory.MemoryError, Memory.Memory> =
  operation === "remember" ? Memory.remember({ bank, key: args[0]!, text: args.slice(1).join(" ") })
  : operation === "note" ? Memory.note(bank, args.slice(2).join(" "), { id: args[0]!, supersedes: args[1] ? [args[1]] : [] })
  : operation === "append" ? Memory.thread(args[0]!).append({ id: args[1]!, role: args[2]!, text: args.slice(3).join(" ") })
  : operation === "history" ? Memory.thread(args[0]!).history({ limit: Number(args[1]) })
  : Memory.recall({ banks: [bank], query: args.join(" ") })
const rows = await Effect.runPromise(Effect.provide(program, Memory.layerSql().pipe(Layer.provide(sqlite(database!)))))
console.log(JSON.stringify({ pid: process.pid, rows }))
