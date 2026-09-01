/**
 * Step 11's first stronger obligation: **the untaken arm's Action does not
 * appear in the journal.**
 *
 * `17-durable/a-statement-branch-holding-an-action-in-each-arm-is-rejected` was
 * the expensive member of the branch class while branches were refused: each
 * arm calls a different Action, so a lowering that folded the condition would
 * have emitted a Plan with one action node where the program has two, and the
 * dropped Action would have been invisible from that point on. That case now
 * accepts, and its compile-time half is observed there — the Manifest names
 * BOTH Actions, because a Manifest is sound about reachability and cannot say
 * which arm runs.
 *
 * The run-time half is the mirror image and is asserted here. A Manifest that
 * names both arms is correct; a JOURNAL that names both arms is corruption. The
 * journal is the replay source, so an entry for an Action the body never
 * requested is an effect that will be *answered* on resumption at a site the
 * body does not reach. The driver cannot name that divergence, because the
 * entry looks exactly like a legitimate one.
 *
 * ## What would make this pass for nothing
 *
 * Three ways, and each is closed by an assertion rather than by inspection:
 *
 * 1. **The untaken arm has no site id at all.** Then "does not appear in the
 *    journal" is true of a program with one arm, and the test measures nothing.
 *    Closed by asserting the Manifest carries a `perform` site for BOTH Action
 *    ids, that the two are distinct, and that both are content-addressed
 *    `src-<24 hex>` rather than strings this file chose.
 * 2. **Nothing ran.** An empty journal contains no untaken arm either. Closed
 *    by asserting exactly one row, that it is `succeeded`, that its key is the
 *    TAKEN arm's `journalKey(site, 0)`, and that the body returned the taken
 *    arm's answer.
 * 3. **Only one arm was ever reachable.** A branch that always takes the same
 *    side would satisfy the whole file with a straight-line program. Closed by
 *    running BOTH arms, in two executions, and asserting each one's journal
 *    holds its own arm and refuses the other's — so the two rows swap when the
 *    condition does.
 */

import { expect, test } from "bun:test"
import { DurableExecutor, journalKey } from "./index.ts"
import type { DispatchedEffectRequest, JsonValue } from "./index.ts"
import {
  BRANCH_COMPILE_OPTIONS,
  BRANCH_FLOW_ID,
  BRANCH_SOURCE,
  branchProgram,
  CACHED_ID,
  CONTENT_ADDRESSED_SITE,
  emptyDeployment,
  FETCH_ID,
  manifestOf,
  openStore,
  siteFor
} from "../../test/fixtures/durable-control-flow.ts"

const branchSites = () => {
  const manifest = manifestOf(BRANCH_SOURCE, BRANCH_COMPILE_OPTIONS)
  return { manifest, fetch: siteFor(manifest, FETCH_ID), cached: siteFor(manifest, CACHED_ID) }
}

test("the Manifest names both arms, and the two sites are compiler-minted and distinct", () => {
  const { manifest, fetch, cached } = branchSites()
  // Anti-vacuity gate 1. Without this the journal assertions below could be
  // satisfied by a program with one arm.
  expect(manifest.actions.map((action) => action.id).sort()).toEqual([CACHED_ID, FETCH_ID].sort())
  expect(fetch).toMatch(CONTENT_ADDRESSED_SITE)
  expect(cached).toMatch(CONTENT_ADDRESSED_SITE)
  expect(fetch).not.toBe(cached)
  // The Manifest is sound about reachability and silent about control flow: it
  // names both arms precisely because it cannot name one.
  expect(manifest.sites).toHaveLength(2)
})

const runBranch = async (live: boolean, executionId: string) => {
  const { fetch, cached } = branchSites()
  const store = openStore(executionId, BRANCH_FLOW_ID, { live, key: "k" })
  const performed: string[] = []
  const driver = new DurableExecutor(emptyDeployment(executionId, BRANCH_FLOW_ID), store, {
    replayDriver: "on"
  }).createReplayDriver({
    executionId,
    leaseMs: 5_000,
    perform: (request: DispatchedEffectRequest): JsonValue => {
      performed.push(String(request.key))
      return { value: request.key === FETCH_ID ? "live" : "cold" }
    }
  })
  const result = await driver.run(() => branchProgram({ live, key: "k" }, { fetch, cached }))
  const rows = store.database
    .query("SELECT node_id,status FROM durable_nodes WHERE execution_id=? ORDER BY node_id")
    .all(executionId) as { node_id: string; status: string }[]
  store.close()
  return { result, rows, performed, fetch, cached }
}

test("the untaken arm's Action does not reach the journal — true arm", async () => {
  const { result, rows, performed, fetch, cached } = await runBranch(true, "branch-live")

  // Anti-vacuity gate 2: the body ran and took the arm the condition selects.
  expect(result).toBe("live")
  expect(performed).toEqual([FETCH_ID])

  expect(rows).toHaveLength(1)
  expect(rows[0]!.status).toBe("succeeded")
  expect(rows[0]!.node_id).toBe(journalKey(fetch, 0))

  // THE OBLIGATION. Stated over the whole journal rather than over the one row,
  // so a future execution that appended a second row for the untaken arm fails
  // here even if the first row is still correct.
  const keys = rows.map((row) => row.node_id)
  expect(keys.some((key) => key.startsWith(cached))).toBe(false)
  expect(performed).not.toContain(CACHED_ID)
})

test("the untaken arm's Action does not reach the journal — false arm", async () => {
  const { result, rows, performed, fetch, cached } = await runBranch(false, "branch-cold")

  expect(result).toBe("cold")
  expect(performed).toEqual([CACHED_ID])

  expect(rows).toHaveLength(1)
  expect(rows[0]!.status).toBe("succeeded")
  expect(rows[0]!.node_id).toBe(journalKey(cached, 0))

  // Anti-vacuity gate 3: the two arms swap. A program that only ever reached
  // `Fetch` would pass the test above and fail this one.
  const keys = rows.map((row) => row.node_id)
  expect(keys.some((key) => key.startsWith(fetch))).toBe(false)
  expect(performed).not.toContain(FETCH_ID)
})
