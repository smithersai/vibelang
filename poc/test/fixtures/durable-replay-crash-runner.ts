/** A real process death after SQLite commits the first authenticated Action. */
import { appendFileSync } from "node:fs"
import { journalKey } from "../../src/durable/replay.ts"
import { GET_QUOTE_ID, openSliceStore, sliceExecutor, sliceSites, SLICE_EXECUTION_ID, SLICE_ORDER } from "./durable-vertical-slice.ts"

const [mode, databaseFile, ledgerFile] = Bun.argv.slice(2)
if ((mode !== "crash-after-quote" && mode !== "resume") || !databaseFile || !ledgerFile) {
  throw new TypeError("usage: durable-replay-crash-runner <crash-after-quote|resume> <database> <ledger>")
}
const store = openSliceStore(databaseFile)
const executor = sliceExecutor(store, (action, nodeId) => {
  // Synchronous append reaches the kernel before the post-commit SIGKILL.
  appendFileSync(ledgerFile, `${mode} perform ${action === GET_QUOTE_ID ? "getQuote" : "capture"} ${nodeId}\n`)
})
const quoteKey = journalKey(sliceSites().quote, 0)
const result = await executor.execute(SLICE_ORDER, { executionId: SLICE_EXECUTION_ID, leaseMs: 250,
  afterNodeAdopted: nodeId => {
    if (mode === "crash-after-quote" && nodeId === quoteKey) {
      process.kill(process.pid, "SIGKILL")
      throw new Error("SIGKILL did not terminate the process")
    }
  },
})
if (mode === "crash-after-quote") throw new Error("crash injection did not reach the quote commit")
const integrity = store.database.query("PRAGMA integrity_check").get() as Record<string, unknown>
const rows = store.database.query("SELECT node_id,status FROM durable_nodes WHERE execution_id=? ORDER BY node_id").all(SLICE_EXECUTION_ID)
const status = store.getExecution(SLICE_EXECUTION_ID).status
store.close()
process.stdout.write(`${JSON.stringify({ result, status, rows, integrity: Object.values(integrity) })}\n`)
