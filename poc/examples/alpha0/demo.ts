/**
 * Alpha-0 end-to-end demonstration of the executable-body durable path,
 * driven entirely through the public seams in poc/src/durable/index.ts.
 *
 *   bun poc/examples/alpha0/demo.ts
 *
 * Stages:
 *   1. Compile a .vibe Flow (Action + loop + Layer-provided Context) with compileDurableBody.
 *   2. Build a deployment with a real local provider, sign it, reject two
 *      tampered envelopes, authenticate the good one.
 *   3. Execute via BodyExecutor over a DurableStore persisted to a SQLite file
 *      on disk; reopen the file with a fresh store + executor and get the
 *      persisted answer back without re-invoking the provider.
 *   4. Real crash: a child process SIGKILLs itself after the first journal
 *      commit; a fresh process resumes and the committed step replays without
 *      re-invoking the provider.
 *   5. PASS/FAIL summary.
 *
 * Working files (SQLite journal, ledger, envelope) go to $ALPHA0_WORKDIR if
 * set, else a fresh temp directory; pass --keep to retain them.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  BodyExecutor,
  digest,
  DurableStore,
  deploymentVerificationKey,
  encodeCanonicalJson,
  generateDeploymentSigningKeyPair,
  SignedBodyDeployment,
  validateDurableBodyArtifact
} from "../../src/durable/index.ts"
import { buildDemoDeployment, compileDemoBody, DEMO_INPUT, EXPECTED_OUTPUT, FLOW_SOURCE } from "./shared.ts"

const keep = process.argv.includes("--keep")
const workdir = mkdtempSync(join(process.env.ALPHA0_WORKDIR ?? tmpdir(), "alpha0-demo-"))
const stages: { name: string; ok: boolean; detail: string }[] = []
let failed = false

function stage(name: string, run: () => string | Promise<string>): Promise<void> | void {
  console.log(`\n=== ${name} ===`)
  const record = (ok: boolean, detail: string) => {
    stages.push({ name, ok, detail })
    if (!ok) failed = true
    console.log(`${ok ? "PASS" : "FAIL"}: ${detail}`)
  }
  try {
    const outcome = run()
    if (outcome instanceof Promise) {
      return outcome.then(detail => record(true, detail), error => record(false, String(error?.stack ?? error)))
    }
    record(true, outcome)
  } catch (error) {
    record(false, String((error as Error)?.stack ?? error))
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`expectation failed: ${message}`)
}

function expectThrows(what: string, run: () => unknown): string {
  try {
    run()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`  rejected as expected (${what}): ${message}`)
    return message
  }
  throw new Error(`expected ${what} to be rejected, but it was accepted`)
}

const ledger = join(workdir, "provider-calls.log")
writeFileSync(ledger, "")
const readLedger = () => readFileSync(ledger, "utf8").trim().split("\n").filter(line => line.length > 0)

console.log(`alpha-0 executable-body demo  (workdir: ${workdir})`)
console.log(`Flow source (${FLOW_SOURCE.trim().split("\n").length} lines of .vibe):`)
console.log(FLOW_SOURCE.trim().split("\n").map(line => `  | ${line}`).join("\n"))

// ---------------------------------------------------------------- stage 1
let body!: ReturnType<typeof compileDemoBody>["body"]
stage("1. compile .vibe Flow with compileDurableBody", () => {
  const compiled = compileDemoBody()
  body = compiled.body
  expect(body.manifest.flowId === "alpha0/rates.vibe#Flow", "flow id")
  expect(body.manifest.actions.length === 1, "one Action descriptor")
  expect(body.manifest.requirements.length === 1, "Fetch is a declared requirement")
  expect(body.manifest.sites.some(site => site.kind === "get"), "Layer/Context get site in the Effect Manifest")
  validateDurableBodyArtifact(JSON.parse(JSON.stringify(body))) // artifact survives a serialization round-trip
  console.log(`  flowId=${body.manifest.flowId}`)
  console.log(`  actions=${JSON.stringify(body.manifest.actions.map(action => action.id))}`)
  console.log(`  sites=${JSON.stringify(body.manifest.sites.map(site => `${site.kind}:${"key" in site ? site.key : site.id}`))}`)
  console.log(`  bodyDigest=${body.digest.slice(0, 16)}…  async=${body.async}`)
  return "compiled to a pinned, serializable DurableBodyArtifact (Action + loop + Layer/Context all in the manifest)"
})

// ---------------------------------------------------------------- stage 2
const deployment = buildDemoDeployment(ledger, "parent")
const key = generateDeploymentSigningKeyPair()
const trust = [deploymentVerificationKey(key)]
const envelope = SignedBodyDeployment.encode(deployment.flow.body, deployment.manifest, key)
let proof!: ReturnType<typeof SignedBodyDeployment.authenticate<number, number>>
stage("2. build, sign, tamper-reject, authenticate", () => {
  expect(deployment.manifest.planDigest === body.digest, "manifest pins the body digest")
  expect(deployment.manifest.routes.length === 1, "one signed Action route")

  // Naive tamper: flip one byte of the envelope.
  const flipped = new Uint8Array(envelope)
  flipped[flipped.length - 20]! ^= 0x01
  expectThrows("byte-flipped envelope", () => SignedBodyDeployment.decode(flipped, trust))

  // Diligent forgery: swap the source digest and recompute every content digest.
  const forged = JSON.parse(new TextDecoder().decode(envelope))
  forged.flowSourceDigest = digest({ untrusted: "alpha0 forged body" })
  forged.routingManifest.planDigest = forged.flowSourceDigest
  forged.routingManifest.coordinatorDigest = digest({ planDigest: forged.flowSourceDigest,
    routes: forged.routingManifest.routes.map(({ actionId, poolId, implementationDigest, policyDigest }: never) =>
      ({ actionId, poolId, implementationDigest, policyDigest })) })
  const { digest: _manifest, ...manifestIdentity } = forged.routingManifest
  forged.routingManifest.digest = digest(manifestIdentity)
  const { digest: _artifact, ...artifactIdentity } = forged
  forged.digest = digest(artifactIdentity)
  expectThrows("digest-consistent forgery", () => SignedBodyDeployment.decode(encodeCanonicalJson(forged), trust))

  // Untrusted signer: a valid envelope under a key we do not trust.
  expectThrows("untrusted signing key", () =>
    SignedBodyDeployment.decode(envelope, [deploymentVerificationKey(generateDeploymentSigningKeyPair())]))

  proof = SignedBodyDeployment.authenticate(deployment, envelope, trust)
  expect(SignedBodyDeployment.requireAuthenticated(proof) === deployment, "authentication is nominal to the built deployment")
  expectThrows("structural copy of the proof", () => SignedBodyDeployment.requireAuthenticated({ ...proof }))
  return "envelope signed; three forgeries rejected; genuine envelope authenticated nominally"
})

// ---------------------------------------------------------------- stage 3
const stage3Db = join(workdir, "stage3-journal.sqlite")
await stage("3. execute over an on-disk SQLite DurableStore", async () => {
  const first = new DurableStore(stage3Db)
  let value: number
  try {
    value = await new BodyExecutor(proof, first).execute(DEMO_INPUT, { executionId: "alpha0-disk" })
  } finally { first.close() }
  expect(value === EXPECTED_OUTPUT, `live run returned ${value}, expected ${EXPECTED_OUTPUT}`)
  const liveCalls = readLedger()
  expect(liveCalls.length === DEMO_INPUT, `provider invoked ${liveCalls.length} times, expected ${DEMO_INPUT}`)
  console.log(`  live run: value=${value}, provider calls=${JSON.stringify(liveCalls)}`)

  // Fresh store object + fresh executor over the same SQLite file: the
  // persisted terminal answer comes back without touching the provider.
  const reopened = new DurableStore(stage3Db)
  try {
    const replayed = await new BodyExecutor(proof, reopened).execute(DEMO_INPUT, { executionId: "alpha0-disk" })
    expect(replayed === EXPECTED_OUTPUT, "reopened store returns the persisted output")
    expect(reopened.getExecution("alpha0-disk").status === "completed", "persisted status is completed")
  } finally { reopened.close() }
  expect(readLedger().length === DEMO_INPUT, "no additional provider calls after reopening the journal file")
  return `value=${value} persisted in ${stage3Db.split("/").pop()}; fresh store+executor replayed it with zero new provider calls`
})

// ---------------------------------------------------------------- stage 4
await stage("4. real SIGKILL after first commit, then restart in a new process", async () => {
  writeFileSync(ledger, "") // dedicate the ledger to the crash experiment
  const crashDb = join(workdir, "stage4-journal.sqlite")
  const envelopePath = join(workdir, "deployment.signed.json")
  const trustPath = join(workdir, "trust.json")
  writeFileSync(envelopePath, envelope)
  writeFileSync(trustPath, JSON.stringify(trust))
  const child = (mode: string) => Bun.spawn(
    [process.execPath, join(import.meta.dir, "crash-child.ts"), mode, crashDb, ledger, "alpha0-crash", envelopePath, trustPath],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "" } })

  const crashed = child("crash")
  const [crashCode, crashOut, crashErr] = await Promise.all([
    crashed.exited, new Response(crashed.stdout).text(), new Response(crashed.stderr).text()])
  expect(crashCode !== 0, `crash child must die abnormally (exit=${crashCode})`)
  expect(crashErr === "", `crash child wrote to stderr: ${crashErr}`)
  expect(crashOut === "", "crash child died before printing a result")
  const afterCrash = readLedger()
  expect(afterCrash.length === 1, `exactly one provider call committed before SIGKILL, saw ${JSON.stringify(afterCrash)}`)
  console.log(`  crash child: exit=${crashCode}, committed call=${JSON.stringify(afterCrash)}`)

  const inspect = new DurableStore(crashDb)
  let journalAfterCrash: number
  try {
    expect(inspect.getExecution("alpha0-crash").status === "running", "execution survives the crash as running")
    journalAfterCrash = inspect.journal("alpha0-crash").filter(event => event.type === "node_succeeded").length
    expect(journalAfterCrash === 1, "exactly one node_succeeded journal event is durable")
  } finally { inspect.close() }
  console.log(`  journal on disk after crash: 1 committed node, execution status=running`)

  const resumed = child("resume")
  const [resumeCode, resumeOut, resumeErr] = await Promise.all([
    resumed.exited, new Response(resumed.stdout).text(), new Response(resumed.stderr).text()])
  expect(resumeErr === "", `resume child stderr: ${resumeErr}`)
  expect(resumeCode === 0, `resume child exit=${resumeCode}`)
  const outcome = JSON.parse(resumeOut) as { value: number; status: string }
  expect(outcome.value === EXPECTED_OUTPUT && outcome.status === "completed",
    `resume produced ${JSON.stringify(outcome)}`)

  const calls = readLedger()
  console.log(`  full ledger: ${JSON.stringify(calls)}`)
  expect(calls.length === DEMO_INPUT, `total provider calls across both processes is ${calls.length}, expected ${DEMO_INPUT}`)
  expect(calls.filter(line => line.startsWith("crash:")).length === 1, "one call belongs to the crashed process")
  expect(calls.filter(line => line.startsWith("resume:")).length === DEMO_INPUT - 1, "resume performed only the uncommitted steps")
  const inputs = new Set(calls.map(line => line.split(":").at(-1)))
  expect(inputs.size === DEMO_INPUT, "no input was ever invoked twice — the committed step replayed from the journal")
  return `SIGKILL after commit #1; fresh process resumed to ${outcome.value}; committed step was replayed, not re-invoked`
})

// ---------------------------------------------------------------- stage 5
console.log("\n=== 5. summary ===")
for (const entry of stages) console.log(`  [${entry.ok ? "PASS" : "FAIL"}] ${entry.name}`)
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS — the executable-body durable path works end to end through its public seams")
if (!keep) rmSync(workdir, { recursive: true, force: true })
else console.log(`kept workdir: ${workdir}`)
process.exit(failed ? 1 : 0)
