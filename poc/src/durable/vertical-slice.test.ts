import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getNativeCompiler } from "../compiler/native.ts"
import { journalKey } from "./replay.ts"
import { compileDurableFlow } from "./source-compiler.ts"
import { CAPTURE_ID, CHARGE_REFERENCE, compileSlice, GET_QUOTE_ID, openSliceStore, sliceBody,
  sliceDeployment, sliceExecutor, sliceManifest, sliceSites, SLICE_COMPILE_OPTIONS,
  SLICE_EXECUTION_ID, SLICE_ORDER, SLICE_SOURCE } from "../../test/fixtures/durable-vertical-slice.ts"

test("the vertical slice publishes an executable async Flow and checked Layer sites without a Plan", () => {
  const compiled = compileDurableFlow(SLICE_SOURCE, SLICE_COMPILE_OPTIONS)
  expect(compiled.ok).toBe(true)
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan).toBeUndefined()
  expect(compiled.flow.body).toEqual(sliceBody())
  expect(sliceBody().async).toBe(true)
  expect(sliceBody().javascript).toContain("async function*")
  const manifest = sliceManifest()
  expect(manifest.actions.map(action => action.id)).toEqual([CAPTURE_ID, GET_QUOTE_ID])
  expect(manifest.requirements).toEqual([CAPTURE_ID, GET_QUOTE_ID])
  expect(manifest.sites).toHaveLength(3)
  expect(manifest.sites.filter(site => site.kind === "get")).toHaveLength(1)
  expect(manifest.sites.filter(site => site.kind === "perform")).toHaveLength(2)
  expect(JSON.stringify(manifest)).not.toContain("whenTrue")
  expect(JSON.stringify(manifest)).not.toContain("condition")
  expect("plan" in sliceDeployment().flow).toBe(false)
})

test("the slice journal sites are derived from authored source positions", () => {
  const authored = sliceSites()
  const shifted = sliceSites(compileSlice(SLICE_SOURCE.replace("export const ChargeOrder", "\nexport const ChargeOrder")).manifest)
  for (const kind of ["quote", "capture"] as const) {
    expect(authored[kind]).toMatch(/^src-[0-9a-f]{24}$/)
    expect(shifted[kind]).toMatch(/^src-[0-9a-f]{24}$/)
    expect(shifted[kind]).not.toBe(authored[kind])
  }
})

test("the signed source-to-worker slice journals exactly the Actions it executes", async () => {
  const store = openSliceStore()
  const calls: string[] = []
  try {
    const executor = sliceExecutor(store, (_action, nodeId) => calls.push(nodeId))
    expect(await executor.execute(SLICE_ORDER, { executionId: SLICE_EXECUTION_ID })).toBe(CHARGE_REFERENCE)
    const sites = sliceSites()
    const expected = [journalKey(sites.quote, 0), journalKey(sites.capture, 0)]
    expect(calls).toEqual(expected)
    const rows = store.database.query("SELECT node_id,status FROM durable_nodes WHERE execution_id=? ORDER BY node_id").all(SLICE_EXECUTION_ID)
    expect(rows).toEqual([...expected].sort().map(node_id => ({ node_id, status: "succeeded" })))
    expect(store.getExecution(SLICE_EXECUTION_ID).status).toBe("completed")
    expect(await executor.execute(SLICE_ORDER, { executionId: SLICE_EXECUTION_ID })).toBe(CHARGE_REFERENCE)
    expect(calls).toEqual(expected)
    const schema = store.database.query("SELECT sql FROM sqlite_master WHERE type='table' AND name='durable_nodes'").get() as { sql: string }
    expect(schema.sql.replace(/\s+/g, " ")).toContain("PRIMARY KEY (execution_id, node_id)")
  } finally { store.close() }
})

test("the emitted branch declines an expensive quote without submitting capture", async () => {
  const store = openSliceStore()
  const calls: string[] = []
  try {
    const executor = sliceExecutor(store, action => calls.push(action))
    expect(await executor.execute({ ...SLICE_ORDER, limit: 1 }, { executionId: "declined" })).toBe("declined")
    expect(calls).toEqual([GET_QUOTE_ID])
    expect(store.journal("declined").filter(event => event.type === "attempt_started")).toHaveLength(1)
  } finally { store.close() }
})

async function runProcess(mode: string, database: string, ledger: string) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../test/fixtures/durable-replay-crash-runner.ts"), mode, database, ledger], {
    // This fixture recompiles its source in both processes. Hand it the exact
    // authenticated native toolchain, without inheriting unrelated host state
    // or requiring another source checkout/Go preparation in the child.
    stdin: "ignore", stdout: "pipe", stderr: "pipe", env: {
      PATH: process.env.PATH ?? "", VIBELANG_NATIVE_COMPILER: getNativeCompiler().executable,
    },
  })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stdout, stderr }
}

test("a real SIGKILL after quote COMMIT resumes the signed body and invokes capture exactly once", async () => {
  if (process.platform === "win32") return
  const directory = mkdtempSync(join(tmpdir(), "vibelang-vertical-slice-"))
  try {
    const database = join(directory, "state.sqlite")
    const ledger = join(directory, "invocations.log")
    const sites = sliceSites()
    const crashed = await runProcess("crash-after-quote", database, ledger)
    expect(crashed.code).not.toBe(0)
    expect(crashed.stdout).toBe("")
    expect(crashed.stderr).toBe("")
    const first = `crash-after-quote perform getQuote ${journalKey(sites.quote, 0)}`
    expect(readFileSync(ledger, "utf8").trim().split("\n")).toEqual([first])
    const interrupted = openSliceStore(database)
    try {
      expect(interrupted.getExecution(SLICE_EXECUTION_ID).status).toBe("running")
      expect(interrupted.journal(SLICE_EXECUTION_ID).filter(event => event.type === "node_succeeded")).toHaveLength(1)
    } finally { interrupted.close() }
    const resumed = await runProcess("resume", database, ledger)
    expect(resumed.code).toBe(0)
    expect(resumed.stderr).toBe("")
    expect(JSON.parse(resumed.stdout)).toEqual({ result: CHARGE_REFERENCE, status: "completed", integrity: ["ok"],
      rows: [journalKey(sites.quote, 0), journalKey(sites.capture, 0)].sort().map(node_id => ({ node_id, status: "succeeded" })),
    })
    expect(readFileSync(ledger, "utf8").trim().split("\n")).toEqual([first, `resume perform capture ${journalKey(sites.capture, 0)}`])
  } finally { rmSync(directory, { recursive: true, force: true }) }
}, 60_000)

test("the executable slice reuses commit points already classified by the crash matrix", async () => {
  const source = readFileSync(new URL("./crash-matrix.test.ts", import.meta.url), "utf8")
  const union = /const STORE_COMMIT_POINTS = \[([^\]]*)\]/.exec(source)
  expect(union).not.toBeNull()
  const classified = new Set([...union![1]!.matchAll(/"([A-Za-z_$][\w$]*)"/g)].map(match => match[1]!))
  expect(classified.size).toBeGreaterThanOrEqual(26)
  const store = openSliceStore()
  const called = new Set<string>()
  const observed = new Proxy(store, { get(target, property) {
    const value = Reflect.get(target, property, target)
    return typeof value !== "function" ? value : (...args: unknown[]) => { called.add(String(property)); return Reflect.apply(value, target, args) }
  } })
  try {
    expect(await sliceExecutor(observed).execute(SLICE_ORDER, { executionId: SLICE_EXECUTION_ID })).toBe(CHARGE_REFERENCE)
    expect([...called].filter(name => classified.has(name)).sort()).toEqual(["claimNode", "commitSuccess", "completeExecution"])
    expect(called.has("initializeBodyExecution")).toBe(true)
    expect(classified.has("initializePinnedExecution")).toBe(true)
  } finally { store.close() }
})
