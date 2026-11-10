// One process of the memory restart test: it opens a SQLite file through
// Experimental.Memory.layerSql, runs one operation and exits, so the next
// process starts with nothing but the file.
import { Effect, Layer } from "effect"
import { Memory } from "vibelang-runtime/experimental"
import { layer as sqlite } from "./bun-sqlite-client.ts"

const [database, operation, ...words] = process.argv.slice(2)
const program = operation === "remember"
  ? Memory.remember({ bank: "agent-reviewer", key: words[0]!, text: words.slice(1).join(" ") })
  : Memory.recall({ banks: ["agent-reviewer"], query: words.join(" ") })
const rows = await Effect.runPromise(Effect.provide(program, Memory.layerSql().pipe(Layer.provide(sqlite(database!)))))
console.log(JSON.stringify({ pid: process.pid, rows }))
