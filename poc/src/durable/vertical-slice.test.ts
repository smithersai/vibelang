/**
 * The vertical slice — `MIGRATION-PLAN.md` §2, and its three assertions.
 *
 * §2's program is two Actions, one capability read, and one runtime branch,
 * "refused twice today" — a premise `MIGRATION-PLAN.md` step 11 retired, since
 * the walls that refused it are withdrawn and the Plan lowerer now DECLINES it
 * without a diagnostic. This file proves the replacement path carries it end to
 * end: the compiler derives a Manifest with a site table for a program its Plan
 * cannot hold, the driver turns those site ids into journal keys, a real
 * `SIGKILL` lands between the two Actions, and the resumed body re-runs from the
 * top without re-invoking what already committed.
 *
 * The program itself lives in `../../test/fixtures/durable-vertical-slice.ts`,
 * shared with the crash runner so the in-process assertions and the
 * cross-process one are about the same program.
 *
 * ## What each assertion would have to look like to pass for nothing
 *
 * Recorded here because two of the three are easy to satisfy vacuously.
 *
 * 1. **"journals two entries keyed by site id."** Vacuous if the site ids were
 *    string literals — then "keyed by site id" is true of any two names. So the
 *    keys are compared against `sliceSites()`, which reads the compiler's site
 *    table, and the test additionally pins their content-addressed `src-<24 hex>`
 *    shape and that they are distinct. Vacuous a second way if the journal were
 *    empty and an `toEqual([])` compared nothing: the row count is asserted to
 *    be exactly two, and both rows are asserted `succeeded`.
 * 2. **"`capture` invoked exactly once across both processes."** Vacuous if the
 *    crashed process never reached the first commit — then process two does
 *    everything and the count is still one. So the ledger is asserted per
 *    process: process one must have invoked `getQuote` and NOT `capture`, and
 *    process two must have invoked `capture` and NOT `getQuote`. Vacuous a
 *    third way if the resumed body took the `"declined"` arm and never reached
 *    `capture`: the returned value is asserted to be the charge reference.
 * 3. **"`crash-matrix.test.ts:818` stays green without an edit."** That test is
 *    self-guarding — it compares `storeTransactionSites()` against a 28-name
 *    union, asserts each name is a callable `DurableStore` method, and compares
 *    the exercised set in both directions — so an empty or broken derivation
 *    fails it rather than passing it. What this file adds is the half that
 *    assertion cannot make about itself: that the slice's own commit path uses
 *    only transaction sites the matrix already classifies, asserted below.
 */

import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DurableExecutor, journalKey } from "./index.ts"
import type { DispatchedEffectRequest, JsonValue } from "./index.ts"
import { compileEffectManifest } from "./source-compiler.ts"
import type { RequestKey } from "../runtime/effect.ts"
import {
  CAPTURE_ID,
  CHARGE_REFERENCE,
  GET_QUOTE_ID,
  openSliceStore,
  QUOTE_CENTS,
  Rates,
  SLICE_EXECUTION_ID,
  SLICE_ORDER,
  SLICE_COMPILE_OPTIONS,
  SLICE_SOURCE,
  SLICE_SOURCE_WITHOUT_BRANCH,
  SLICE_SOURCE_WITHOUT_CAPABILITY,
  planDeclines,
  sliceDeployment,
  sliceManifest,
  slicePlanDiagnostics,
  sliceProgram,
  sliceSites
} from "../../test/fixtures/durable-vertical-slice.ts"

// ---------------------------------------------------------------------------
// The premise: "Refused twice today"
// ---------------------------------------------------------------------------

/**
 * §2 opens with a claim about the program, not about the runtime: it is
 * "**Refused twice today**". **That claim expired at step 11**, and this test is
 * what says so rather than letting the file keep asserting yesterday's premise.
 *
 * What step 9 measured, and why it is history now. §2 predicted `SMITHERS4110`
 * for the capability read; the measured code was `SMITHERS4112` —
 * `Rates.context()` reached `lowerExpression`'s higher-order fallthrough before
 * any capture rule saw it, which is `MIGRATION-PLAN.md` §5's R3 fallthrough
 * observed on a second program. The branch drew `SMITHERS4106`. Step 11
 * withdrew both walls, so neither code exists on this path any more.
 *
 * The premise the slice actually needs is unchanged and is stronger than the
 * diagnostics were: **the Plan still cannot hold this program.** It now says so
 * by declining rather than by refusing, and the two features §2 names are still
 * attributable one at a time — remove the capability read and the branch alone
 * still declines; remove both and the Plan lowers. Without that third row the
 * decline is attributable to anything in the program.
 */
test("the slice's program is one the Plan cannot hold, feature by feature, and it is no longer refused", () => {
  // Not a diagnostic. A `SMITHERS41xx` here in any spelling is a wall rebuilt.
  expect(slicePlanDiagnostics(SLICE_SOURCE)).toEqual([])
  expect(planDeclines(SLICE_SOURCE)).toBe(true)

  // The branch alone is enough, with the capability read removed.
  expect(slicePlanDiagnostics(SLICE_SOURCE_WITHOUT_CAPABILITY)).toEqual([])
  expect(planDeclines(SLICE_SOURCE_WITHOUT_CAPABILITY)).toBe(true)

  // Remove both and the Plan lowerer accepts it. Without this row the two
  // declines above are attributable to anything in the program; with it they
  // are attributable to exactly the two features §2 names.
  expect(planDeclines(SLICE_SOURCE_WITHOUT_BRANCH)).toBe(false)
  expect(slicePlanDiagnostics(SLICE_SOURCE_WITHOUT_BRANCH)).toEqual([])
})

/**
 * The Manifest, unlike the Plan, holds the whole program. This is the artifact
 * the journal keys come from, so "the compiler can describe a program it cannot
 * lower" is the precondition for everything below — and since step 11 it is
 * also what the compiler PUBLISHES for such a program, rather than a refusal.
 */
test("the Effect Manifest holds the program the Plan lowerer cannot", () => {
  const manifest = sliceManifest()
  expect(manifest.actions.map((action) => action.id)).toEqual([CAPTURE_ID, GET_QUOTE_ID])
  expect(manifest.sites).toHaveLength(2)
  expect(manifest.sites.every((site) => site.kind === "perform")).toBe(true)
  // No control flow: the branch §2 adds is invisible to the Manifest, which is
  // exactly why the Manifest survives a program the Plan cannot hold.
  expect(JSON.stringify(manifest)).not.toContain("whenTrue")
  expect(JSON.stringify(manifest)).not.toContain("condition")
})

// ---------------------------------------------------------------------------
// Assertion 1 — two journal entries, keyed by site id
// ---------------------------------------------------------------------------

const CONTENT_ADDRESSED_SITE = /^src-[0-9a-f]{24}$/

/**
 * The anti-vacuity gate for assertion 1, made permanent.
 *
 * "Journals two entries keyed by site id" is worth nothing if the site ids are
 * strings the test chose: any two names would satisfy it. Moving the program one
 * line down has to move both keys, because a site identity is
 * `digest({file, functionName, kind, anchor, key, occurrence})` and `anchor` is
 * the request's `line:character`. If this ever stops holding, the ids have
 * stopped being derived from the program and assertion 1 is decoration.
 */
test("the slice's journal keys are content-addressed from the program text, not chosen", () => {
  const authored = sliceSites()
  const shifted = compileEffectManifest(
    SLICE_SOURCE.replace("export const ChargeOrder", "\nexport const ChargeOrder"),
    SLICE_COMPILE_OPTIONS
  )
  expect(shifted.ok).toBe(true)
  if (!shifted.ok) return
  const moved = sliceSites(shifted.manifest)
  expect(moved.quote).toMatch(CONTENT_ADDRESSED_SITE)
  expect(moved.capture).toMatch(CONTENT_ADDRESSED_SITE)
  expect(moved.quote).not.toBe(authored.quote)
  expect(moved.capture).not.toBe(authored.capture)
})

test("assertion 1: the first run journals two entries keyed by compiler-minted site ids", async () => {
  const sites = sliceSites()
  // Not literals: these came out of the Manifest's site table, and they are the
  // shared content-addressed scheme both backends already agree on.
  expect(sites.quote).toMatch(CONTENT_ADDRESSED_SITE)
  expect(sites.capture).toMatch(CONTENT_ADDRESSED_SITE)
  expect(sites.quote).not.toBe(sites.capture)

  const store = openSliceStore()
  const invoked: string[] = []
  const driver = new DurableExecutor(sliceDeployment(), store, { replayDriver: "on" }).createReplayDriver({
    executionId: SLICE_EXECUTION_ID,
    leaseMs: 5_000,
    capabilities: new Map<RequestKey, unknown>([[Rates, { multiplier: 1 }]]),
    perform: (request: DispatchedEffectRequest): JsonValue => {
      invoked.push(request.journalKey)
      return request.key === GET_QUOTE_ID ? { cents: QUOTE_CENTS } : { reference: CHARGE_REFERENCE }
    }
  })

  expect(await driver.run(() => sliceProgram(SLICE_ORDER, sites))).toBe(CHARGE_REFERENCE)
  expect(invoked).toEqual([journalKey(sites.quote, 0), journalKey(sites.capture, 0)])

  const rows = store.database
    .query("SELECT node_id,node_kind,status FROM durable_nodes WHERE execution_id=? ORDER BY node_id")
    .all(SLICE_EXECUTION_ID) as { node_id: string; node_kind: string; status: string }[]
  // Exactly two, both terminal. The deployment's Plan is empty, so neither row
  // can have come from an eager insert.
  expect(rows).toHaveLength(2)
  expect(rows.map((row) => row.status)).toEqual(["succeeded", "succeeded"])
  expect(rows.map((row) => row.node_id).sort()).toEqual(
    [journalKey(sites.quote, 0), journalKey(sites.capture, 0)].sort()
  )
  // The capability read is answered from the deployment's own layer and takes
  // no journal position: three requests, two entries.
  expect(driver.audit).toEqual({ requests: 3, replayed: 0, dispatchedLive: 2, recorded: 0 })

  // §2: "`durable_nodes PRIMARY KEY (execution_id, node_id)` (`store.ts:507`)
  // unchanged." Read off the live schema rather than the source, so a migration
  // that rebuilt the table under a different key would fail here.
  const schema = store.database
    .query("SELECT sql FROM sqlite_master WHERE type='table' AND name='durable_nodes'")
    .get() as { sql: string }
  expect(schema.sql.replace(/\s+/g, " ")).toContain("PRIMARY KEY (execution_id, node_id)")
  store.close()
})

// ---------------------------------------------------------------------------
// Assertion 2 — real SIGKILL between the two Actions
// ---------------------------------------------------------------------------

const runSliceProcess = async (mode: string, database: string, ledger: string) => {
  const child = Bun.spawn([
    process.execPath,
    join(import.meta.dir, "../../test/fixtures/durable-replay-crash-runner.ts"),
    mode,
    database,
    ledger
  ], {
    cwd: join(import.meta.dir, "../.."),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "" }
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])
  return { exitCode, stdout, stderr }
}

test("assertion 2: a real SIGKILL between the two Actions invokes capture exactly once", async () => {
  if (process.platform === "win32") return
  const directory = mkdtempSync(join(tmpdir(), "smithers-vertical-slice-"))
  try {
    const database = join(directory, "state.sqlite")
    const ledger = join(directory, "invocations.log")
    writeFileSync(ledger, "")
    const sites = sliceSites()

    const crashed = await runSliceProcess("crash-after-quote", database, ledger)
    expect(crashed.exitCode).not.toBe(0)
    expect(crashed.stdout).toBe("")

    const afterCrash = readFileSync(ledger, "utf8").trim().split("\n")
    // The kill landed BETWEEN the two Actions, not before the first: without
    // this the resumed process could do all the work and still report "capture
    // once", proving nothing about resumption.
    expect(afterCrash).toEqual([`crash-after-quote perform getQuote ${journalKey(sites.quote, 0)}`])

    const resumed = await runSliceProcess("resume", database, ledger)
    expect(resumed.stderr).toBe("")
    expect(resumed.exitCode).toBe(0)
    const report = JSON.parse(resumed.stdout) as {
      result: string
      audit: { requests: number; replayed: number; dispatchedLive: number; recorded: number }
      rows: { node_id: string; status: string }[]
      integrity: string[]
    }

    // The body re-ran from the top and took the SAME arm — not `"declined"`,
    // which would reach `capture` zero times and satisfy "exactly once" only by
    // never getting there.
    expect(report.result).toBe(CHARGE_REFERENCE)
    // The first request short-circuited from the journal; only the second was
    // dispatched live.
    expect(report.audit).toEqual({ requests: 3, replayed: 1, dispatchedLive: 1, recorded: 1 })
    expect(report.integrity).toEqual(["ok"])
    expect(report.rows).toEqual([
      { node_id: journalKey(sites.quote, 0), status: "succeeded" },
      { node_id: journalKey(sites.capture, 0), status: "succeeded" }
    ].sort((left, right) => left.node_id < right.node_id ? -1 : 1))

    const ledgerLines = readFileSync(ledger, "utf8").trim().split("\n")
    expect(ledgerLines).toEqual([
      `crash-after-quote perform getQuote ${journalKey(sites.quote, 0)}`,
      `resume perform capture ${journalKey(sites.capture, 0)}`
    ])
    // Stated as the counts §2 asks for, across BOTH processes' lines.
    expect(ledgerLines.filter((line) => line.includes("perform capture"))).toHaveLength(1)
    expect(ledgerLines.filter((line) => line.includes("perform getQuote"))).toHaveLength(1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 60_000)

// ---------------------------------------------------------------------------
// Assertion 3 — the slice adds no commit point
// ---------------------------------------------------------------------------

/**
 * `crash-matrix.test.ts:818` derives the commit-point set from `store.ts` and so
 * refuses a transaction site nobody classified. It cannot, however, say whether
 * a NEW execution path reaches only classified ones — it only knows what the
 * matrix itself exercised. This is that half: every store method the slice's
 * commit path calls is named in the matrix's own union, read out of
 * `crash-matrix.test.ts` rather than copied, so the two cannot drift.
 *
 * §2: "Treat any required diff to `crash-matrix.test.ts` as a stop signal, not a
 * task." Nothing here edits it; this reads it.
 */
test("assertion 3: the slice's commit path adds no transaction site the crash matrix has not classified", async () => {
  const matrixSource = readFileSync(new URL("./crash-matrix.test.ts", import.meta.url), "utf8")
  const union = /const STORE_COMMIT_POINTS = \[([^\]]*)\]/.exec(matrixSource)
  expect(union).not.toBeNull()
  const classified = new Set([...union![1]!.matchAll(/"([A-Za-z_$][\w$]*)"/g)].map((match) => match[1]!))
  // A regex that stopped matching would classify nothing and let anything pass.
  expect(classified.size).toBeGreaterThanOrEqual(26)
  expect(classified.has("claimNode")).toBe(true)
  expect(classified.has("commitSuccess")).toBe(true)

  const store = openSliceStore()
  const called = new Set<string>()
  const observed = new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== "function") return value
      return (...args: unknown[]) => {
        called.add(String(property))
        return Reflect.apply(value, target, args)
      }
    }
  })
  const sites = sliceSites()
  const driver = new DurableExecutor(sliceDeployment(), observed, { replayDriver: "on" }).createReplayDriver({
    executionId: SLICE_EXECUTION_ID,
    leaseMs: 5_000,
    capabilities: new Map<RequestKey, unknown>([[Rates, { multiplier: 1 }]]),
    perform: (request: DispatchedEffectRequest): JsonValue =>
      request.key === GET_QUOTE_ID ? { cents: QUOTE_CENTS } : { reference: CHARGE_REFERENCE }
  })
  expect(await driver.run(() => sliceProgram(SLICE_ORDER, sites))).toBe(CHARGE_REFERENCE)

  // The slice reached a commit path at all — otherwise the subset test below is
  // a subset of nothing.
  const commitPoints = [...called].filter((name) => classified.has(name)).sort()
  expect(commitPoints).toEqual(["claimNode", "commitSuccess"])
  // And no store method it called is an unclassified transaction site. The
  // matrix's own gate owns the "is it a transaction site" question; this one
  // owns "did the slice invent a path to one".
  for (const name of called) {
    if (!classified.has(name)) {
      expect(
        /\.immediate\(\)/.test(methodBody(name)),
        `${name} is a transaction site the crash matrix has not classified`
      ).toBe(false)
    }
  }
  store.close()
})

/** The source text of one `DurableStore` member, for the transaction-site check above. */
const methodBody = (member: string): string => {
  const source = readFileSync(new URL("./store.ts", import.meta.url), "utf8")
  const lines = source.split("\n")
  const start = lines.findIndex((line) => new RegExp(`^ {2}(?:private |protected |static |readonly )*${member}\\s*(?:<[^(]*>)?\\(`).test(line))
  if (start < 0) return ""
  const end = lines.findIndex((line, index) => index > start && /^ {2}\}/.test(line))
  return lines.slice(start, end < 0 ? lines.length : end).join("\n")
}
