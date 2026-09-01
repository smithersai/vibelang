/**
 * Step 11's second stronger obligation: **one journal entry per round, under
 * `siteId#n`.**
 *
 * `17-durable/a-do-while-loop-in-durable-source-is-rejected` chose `do`/`while`
 * deliberately: its body runs before its condition is ever read, so a lowering
 * that unrolled a single pass produced a Plan that "looks complete and contains
 * no loop node at all". The run-time analogue of that defect is a loop whose
 * rounds all land on ONE journal key, and it looks just as complete — the
 * execution succeeds, the journal is well-formed, and every round after the
 * first has silently read the first round's answer.
 *
 * That is why the corpus case can only observe half of this. Its Manifest
 * carries exactly one site for the loop, because a site is a POSITION and PR-1
 * forbids execution counts; whether the runtime turns one site into `n`
 * distinct keys is a property of an execution.
 *
 * ## What would make this pass for nothing
 *
 * 1. **The loop ran once.** Then "one entry per round" is "one entry", which
 *    any straight-line program satisfies. Closed by asserting the round count
 *    is greater than one, that the body returned that many rounds, and that the
 *    row count equals it exactly.
 * 2. **The keys were chosen by this file.** Then `siteId#n` is true by
 *    construction. Closed by reading the site out of the compiler's Manifest,
 *    asserting it is content-addressed `src-<24 hex>`, and asserting every
 *    journal key is that ONE site with a distinct occurrence — so the keys are
 *    a function of the program's text and the driver's counter, never of a
 *    literal here.
 * 3. **The rows came from somewhere other than the run.** Closed by pinning the
 *    execution to a deployment whose Plan has no nodes, so no eager insert
 *    could have created a row, and by asserting every row is `succeeded`.
 */

import { expect, test } from "bun:test"
import { DurableExecutor, journalKey } from "./index.ts"
import type { DispatchedEffectRequest, JsonValue } from "./index.ts"
import {
  CONTENT_ADDRESSED_SITE,
  emptyDeployment,
  LOOP_COMPILE_OPTIONS,
  LOOP_FLOW_ID,
  LOOP_SOURCE,
  loopProgram,
  manifestOf,
  openStore,
  POLL_ID,
  siteFor
} from "../../test/fixtures/durable-control-flow.ts"

/** More than one, and more than two: a fencepost is not a count. */
const ROUNDS = 4

const loopSite = () => {
  const manifest = manifestOf(LOOP_SOURCE, LOOP_COMPILE_OPTIONS)
  return { manifest, site: siteFor(manifest, POLL_ID) }
}

test("the Manifest carries one site for the loop, not one per round", () => {
  const { manifest, site } = loopSite()
  expect(site).toMatch(CONTENT_ADDRESSED_SITE)
  // PR-1: "sets and tables only — no control-flow edges, no branch structure,
  // no execution counts." One `Poll.run` in the source is one row here however
  // many times the loop goes round, and there is nothing in the Manifest that
  // could say otherwise.
  expect(manifest.sites).toHaveLength(1)
  expect(manifest.actions.map((action) => action.id)).toEqual([POLL_ID])
  expect(JSON.stringify(manifest)).not.toContain("rounds")
  expect(JSON.stringify(manifest)).not.toContain("maxRounds")
})

test("each round takes its own journal entry, keyed siteId#n from one site", async () => {
  const { site } = loopSite()
  const executionId = "do-while-rounds"
  const store = openStore(executionId, LOOP_FLOW_ID, { rounds: ROUNDS })
  const dispatched: string[] = []
  const driver = new DurableExecutor(emptyDeployment(executionId, LOOP_FLOW_ID), store, {
    replayDriver: "on"
  }).createReplayDriver({
    executionId,
    leaseMs: 5_000,
    perform: (request: DispatchedEffectRequest): JsonValue => {
      dispatched.push(request.journalKey)
      return { done: false }
    }
  })

  // Anti-vacuity gate 1: the loop really went round more than once.
  expect(ROUNDS).toBeGreaterThan(1)
  expect(await driver.run(() => loopProgram({ rounds: ROUNDS }, site))).toBe(ROUNDS)

  const expected = Array.from({ length: ROUNDS }, (_, round) => journalKey(site, round))
  // THE OBLIGATION, dispatch side: `ROUNDS` requests, each at the SAME site and
  // a DIFFERENT occurrence. A driver that reused an occurrence would answer
  // rounds 2..n from round 1's entry and this list would collapse.
  expect(dispatched).toEqual(expected)
  expect(new Set(dispatched).size).toBe(ROUNDS)

  const rows = store.database
    .query("SELECT node_id,status FROM durable_nodes WHERE execution_id=? ORDER BY node_id")
    .all(executionId) as { node_id: string; status: string }[]
  // THE OBLIGATION, journal side. `durable_nodes PRIMARY KEY (execution_id,
  // node_id)` means a collapsed round is not an extra row but a MISSING one, so
  // the count is the assertion that matters.
  expect(rows).toHaveLength(ROUNDS)
  expect(rows.map((row) => row.status)).toEqual(Array.from({ length: ROUNDS }, () => "succeeded"))
  expect(rows.map((row) => row.node_id).sort()).toEqual([...expected].sort())

  // Anti-vacuity gate 2: every key is that one compiler-minted site with a
  // distinct occurrence suffix, so none of them could be a literal.
  for (const [round, key] of expected.entries()) {
    expect(key).toBe(`${site}#${round}`)
  }
  expect(driver.audit).toEqual({ requests: ROUNDS, replayed: 0, dispatchedLive: ROUNDS, recorded: 0 })
  store.close()
})

test("a resumed loop replays the rounds it already committed and dispatches only the rest", async () => {
  const { site } = loopSite()
  const executionId = "do-while-resume"
  const store = openStore(executionId, LOOP_FLOW_ID, { rounds: ROUNDS })
  const deployment = emptyDeployment(executionId, LOOP_FLOW_ID)

  const first: string[] = []
  const half = Math.floor(ROUNDS / 2)
  const firstDriver = new DurableExecutor(deployment, store, { replayDriver: "on" }).createReplayDriver({
    executionId,
    leaseMs: 5_000,
    perform: (request: DispatchedEffectRequest): JsonValue => {
      first.push(request.journalKey)
      return { done: false }
    }
  })
  // A shorter loop commits `half` rounds and stops. This is the same journal a
  // crash after round `half` would have left behind.
  expect(await firstDriver.run(() => loopProgram({ rounds: half }, site))).toBe(half)
  expect(first).toHaveLength(half)

  const second: string[] = []
  const secondDriver = new DurableExecutor(deployment, store, { replayDriver: "on" }).createReplayDriver({
    executionId,
    leaseMs: 5_000,
    perform: (request: DispatchedEffectRequest): JsonValue => {
      second.push(request.journalKey)
      return { done: false }
    }
  })
  expect(await secondDriver.run(() => loopProgram({ rounds: ROUNDS }, site))).toBe(ROUNDS)

  // The first `half` rounds came from the journal and were NOT re-dispatched;
  // only the remainder reached the handler. This is the assertion a collapsed
  // key set cannot satisfy: with one key per loop, resumption would answer
  // every round from one entry and `second` would be empty.
  expect(second).toEqual(
    Array.from({ length: ROUNDS - half }, (_, index) => journalKey(site, half + index))
  )
  expect(secondDriver.audit).toEqual({
    requests: ROUNDS,
    replayed: half,
    dispatchedLive: ROUNDS - half,
    recorded: half
  })

  const rows = store.database
    .query("SELECT node_id FROM durable_nodes WHERE execution_id=?")
    .all(executionId) as { node_id: string }[]
  expect(rows).toHaveLength(ROUNDS)
  store.close()
})
