import { appendFileSync, readFileSync } from "node:fs"
import { loadDurableBody } from "../../src/durable/body-artifact.ts"
import { ReplayDriver } from "../../src/durable/replay.ts"
import { DurableStore } from "../../src/durable/store.ts"
import { digest } from "../../src/durable/value.ts"
import { __vsInspectResult } from "../../src/runtime/result.ts"

const [mode, database, artifactFile, ledger] = process.argv.slice(2)
if (!mode || !database || !artifactFile || !ledger) throw new Error("Missing crash runner argument")
const body = loadDurableBody(JSON.parse(readFileSync(artifactFile, "utf8")))
const store = new DurableStore(database)
const deploymentDigest = digest({ body: body.artifact.digest, implementation: "compiled-crash-v1" })
const pinned = { planDigest: body.artifact.digest, manifestDigest: deploymentDigest }
store.initializeBodyExecution("crash", body.artifact, deploymentDigest, 4)
if (mode === "kill-after-commit") {
  const commit = store.commitSuccess.bind(store)
  store.commitSuccess = (...args) => {
    const committed = commit(...args)
    if (committed) process.kill(process.pid, "SIGKILL")
    return committed
  }
}
try {
  const attempt = body.create(4)
  const driver = new ReplayDriver({ mode: "on", store, executionId: "crash", owner: mode, pinned,
    dispatchRequest: attempt.dispatchRequest, validateRequest: attempt.validateRequest, decodeAnswer: attempt.decodeAnswer,
    perform: request => {
      appendFileSync(ledger, `${mode}:${request.journalKey}:${request.input}\n`)
      return { kind: "success", value: request.input as number }
    },
  })
  const result = await driver.run(() => attempt.computation)
  const inspected = __vsInspectResult(result as never)
  if (!inspected.ok) throw inspected.error
  store.completeExecution("crash", inspected.value, pinned)
  process.stdout.write(JSON.stringify({ value: inspected.value, audit: driver.audit,
    status: store.getExecution("crash").status,
    integrity: store.database.query("PRAGMA integrity_check").all().map(row => (row as { integrity_check: string }).integrity_check) }))
} finally { store.close() }
