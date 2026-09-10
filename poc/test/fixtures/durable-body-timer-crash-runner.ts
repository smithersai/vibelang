import { readFileSync } from "node:fs"
import { BodyDeployment } from "../../src/durable/body-deployment.ts"
import { BodyExecutor } from "../../src/durable/body-executor.ts"
import { SignedBodyDeployment } from "../../src/durable/signed-deployment.ts"
import { DurableStore } from "../../src/durable/store.ts"

const [mode, database, artifactFile, signatureFile, trustFile] = process.argv.slice(2)
if ((mode !== "kill-after-schedule" && mode !== "resume") || !database || !artifactFile || !signatureFile || !trustFile) {
  throw new Error("Missing timer crash-runner arguments")
}
const body = JSON.parse(readFileSync(artifactFile, "utf8"))
const deployment = BodyDeployment.build({ id: "body-timer", flow: {
  id: body.manifest.flowId, version: body.manifest.flowVersion, body,
}, pools: [] })
// No private signing key or live function arrives in the new process.
const authentication = SignedBodyDeployment.authenticate(deployment,
  readFileSync(signatureFile), JSON.parse(readFileSync(trustFile, "utf8")))
const store = new DurableStore(database)
try {
  const executor = new BodyExecutor(authentication, store)
  const handle = mode === "resume" ? executor.resume("process-timer") : executor.start(10, {
    executionId: "process-timer",
    afterTimerScheduled: () => { process.kill(process.pid, "SIGKILL") },
  })
  const value = await handle.result()
  process.stdout.write(JSON.stringify({ value, status: handle.status(), audit: handle.audit(),
    timers: store.journal("process-timer").filter(event => event.type === "timer_scheduled").map(event => event.payload),
    integrity: store.database.query("PRAGMA integrity_check").all().map(row => (row as { integrity_check: string }).integrity_check),
  }))
} finally { store.close() }
