/**
 * The vertical slice's real-`SIGKILL` half (`MIGRATION-PLAN.md` §2, assertion 2).
 *
 * "Real `SIGKILL` between them ... then resume: the body re-runs from the top,
 * the first request short-circuits from the journal, and **`capture` is invoked
 * exactly once across both processes**."
 *
 * Two processes, one database, one **append-only ledger file**. Every `perform`
 * appends a line to the ledger before it does anything else, so an invocation
 * that happened in the process that then vanished is still on disk — which is
 * the only way "exactly once across both processes" can be measured at all. An
 * in-process counter would be destroyed by the very `SIGKILL` whose effect it is
 * supposed to record.
 *
 * Modelled on `durable-process-crash-runner.ts`, which does the same for the
 * Plan path: the store is proxied, the process kills itself the instant SQLite
 * returns from the first Action's `COMMIT`, and nothing is flushed or closed.
 */

import {
  CAPTURE_ID,
  CHARGE_REFERENCE,
  GET_QUOTE_ID,
  openSliceStore,
  QUOTE_CENTS,
  Rates,
  SLICE_EXECUTION_ID,
  SLICE_ORDER,
  sliceDeployment,
  sliceProgram,
  sliceSites
} from "./durable-vertical-slice.ts"
import { appendFileSync } from "node:fs"
import { DurableExecutor, journalKey } from "../../src/durable/index.ts"
import type { DispatchedEffectRequest, JsonValue } from "../../src/durable/index.ts"
import type { RequestKey } from "../../src/runtime/effect.ts"

const [mode, databaseFile, ledgerFile] = Bun.argv.slice(2)
if ((mode !== "crash-after-quote" && mode !== "resume") || !databaseFile || !ledgerFile) {
  throw new TypeError("usage: durable-replay-crash-runner <crash-after-quote|resume> <database> <ledger>")
}

/**
 * Append-only. `appendFileSync` returns after `write(2)`, so the line is in the
 * kernel before the caller continues and `SIGKILL` — which destroys the process,
 * not the page cache — cannot lose it.
 */
const record = (line: string): void => {
  appendFileSync(ledgerFile, `${mode} ${line}\n`)
}

const sites = sliceSites()
const store = openSliceStore(databaseFile)

const quoteKey = journalKey(sites.quote, 0)

const executorStore = mode === "crash-after-quote"
  ? new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== "function") return value
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args)
        // The instant the FIRST Action's row is committed — and only that one,
        // so the kill lands strictly between the two Actions.
        if (property === "commitSuccess" && result === true && args[1] === quoteKey) {
          process.kill(process.pid, "SIGKILL")
          throw new Error("SIGKILL did not terminate the process")
        }
        return result
      }
    }
  })
  : store

const perform = (request: DispatchedEffectRequest): JsonValue => {
  record(`perform ${request.key === GET_QUOTE_ID ? "getQuote" : "capture"} ${request.journalKey}`)
  if (request.key === GET_QUOTE_ID) return { cents: QUOTE_CENTS }
  if (request.key === CAPTURE_ID) return { reference: CHARGE_REFERENCE }
  throw new Error(`unexpected perform key ${String(request.key)}`)
}

const driver = new DurableExecutor(sliceDeployment(), executorStore, { replayDriver: "on" })
  .createReplayDriver({
    executionId: SLICE_EXECUTION_ID,
    leaseMs: 250,
    capabilities: new Map<RequestKey, unknown>([[Rates, { multiplier: 1 }]]),
    perform
  })

const result = await driver.run(() => sliceProgram(SLICE_ORDER, sites))
if (mode === "crash-after-quote") throw new Error("crash injection did not reach commitSuccess")

const integrity = store.database.query("PRAGMA integrity_check").get() as Record<string, unknown>
const rows = store.database
  .query("SELECT node_id,status FROM durable_nodes WHERE execution_id=? ORDER BY node_id")
  .all(SLICE_EXECUTION_ID)
store.close()
process.stdout.write(`${JSON.stringify({ result, audit: driver.audit, rows, integrity: Object.values(integrity) })}\n`)
