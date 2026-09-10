/**
 * Crash/restart child for the alpha-0 demo. Spawned by demo.ts — not a test.
 *
 * Usage: bun crash-child.ts <mode> <dbPath> <ledgerPath> <executionId> <envelopePath> <trustPath>
 *
 * mode "crash":  execute the Flow and SIGKILL the process immediately after the
 *                first journal commit (a real process death, via the public
 *                afterNodeAdopted seam).
 * mode "resume": execute the same executionId to completion over the same
 *                on-disk SQLite journal and print { value, status } as JSON.
 *
 * The child rebuilds the deployment locally from shared.ts (implementations are
 * live closures and never serialize) and authenticates the PARENT-signed
 * envelope against it, so signature verification really crosses processes.
 */
import { readFileSync } from "node:fs"
import { buildDemoDeployment, DEMO_INPUT } from "./shared.ts"
import {
  BodyExecutor,
  DurableStore,
  SignedBodyDeployment,
  type TrustedDeploymentKey
} from "../../src/durable/index.ts"

const [mode, dbPath, ledgerPath, executionId, envelopePath, trustPath] = process.argv.slice(2)
if (!mode || !dbPath || !ledgerPath || !executionId || !envelopePath || !trustPath) {
  throw new Error("usage: crash-child.ts <mode> <dbPath> <ledgerPath> <executionId> <envelopePath> <trustPath>")
}

const deployment = buildDemoDeployment(ledgerPath, mode)
const envelope = new Uint8Array(readFileSync(envelopePath))
const trust = JSON.parse(readFileSync(trustPath, "utf8")) as TrustedDeploymentKey[]
const proof = SignedBodyDeployment.authenticate(deployment, envelope, trust)

const store = new DurableStore(dbPath)
try {
  const executor = new BodyExecutor(proof, store)
  const value = await executor.execute(DEMO_INPUT, {
    executionId,
    ...(mode === "crash"
      ? { afterNodeAdopted: () => { process.kill(process.pid, "SIGKILL") } }
      : {})
  })
  process.stdout.write(JSON.stringify({ value, status: store.getExecution(executionId).status }))
} finally {
  store.close()
}
