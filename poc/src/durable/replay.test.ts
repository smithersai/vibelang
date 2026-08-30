import { expect, test } from "bun:test";
import {
  Deployment,
  digest,
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  ExecutionMigratedError,
  isJournalKey,
  journalKey,
  PlanArtifact,
  REPLAY_DRIVER_DEFAULT,
  ReplayDivergenceError,
  ReplayDriver,
  type DispatchedEffectRequest,
} from "./index.ts";
import type { AnyRequest, EffectRequest, Resumable } from "../runtime/effect.ts";

/**
 * A deployment with an EMPTY Plan.
 *
 * That is the point of the fixture rather than a convenience: it removes every
 * eagerly inserted node row, so a `durable_nodes` row in these tests can only
 * have come from the lazy path being exercised. `initializeExecution` still
 * pins the execution to a `(plan_digest, manifest_digest)` pair, which is what
 * the fence tests need.
 */
const emptyDeployment = (id: string, flowVersion = 1) => {
  const semantic = {
    formatVersion: 1 as const,
    flowId: `test/Replay/${id}`,
    flowVersion,
    nodes: [],
    output: { kind: "literal" as const, value: null },
    requirements: [],
    actions: [],
  };
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) });
  const flow = PlanArtifact.load<Record<string, never>, unknown>(PlanArtifact.encode(plan));
  return Deployment.build({ id, flow, pools: [] });
};

const started = (id: string, flowVersion = 1) => {
  const deployment = emptyDeployment(id, flowVersion);
  const store = new DurableStore();
  store.initializeExecution(id, deployment.flow.plan, deployment.manifest, {});
  return {
    store,
    deployment,
    pinned: {
      planDigest: deployment.flow.plan.digest,
      manifestDigest: deployment.manifest.digest,
    },
  };
};

const nodeRow = (store: DurableStore, executionId: string, nodeId: string) =>
  store.database
    .query("SELECT node_id,node_kind,status,attempt,fence FROM durable_nodes WHERE execution_id=? AND node_id=?")
    .get(executionId, nodeId) as
    | { node_id: string; node_kind: string; status: string; attempt: number; fence: number }
    | null;

// ---------------------------------------------------------------------------
// The journal key
// ---------------------------------------------------------------------------

test("a journal key is (siteIdentity, occurrenceIndex) and refuses anything else", () => {
  expect(journalKey("src-abc", 0)).toBe("src-abc#0");
  expect(journalKey("src-abc", 12)).toBe("src-abc#12");
  expect(() => journalKey("", 0)).toThrow(TypeError);
  // A site carrying the separator would make the pair ambiguous, which is the
  // one way this scheme could alias two sites onto one durable primary key.
  expect(() => journalKey("src-a#b", 0)).toThrow(TypeError);
  expect(() => journalKey("src-abc", -1)).toThrow(TypeError);
  expect(() => journalKey("src-abc", 1.5)).toThrow(TypeError);
});

test("journal keys are distinguishable from every node id the Plan path writes", () => {
  expect(isJournalKey("src-abc#0")).toBe(true);
  expect(isJournalKey("src-abc#12")).toBe(true);
  // Compiler site ids, fan-out children, loop rounds, and the attached-child
  // execution namespace: none of them can be mistaken for a journal key.
  expect(isJournalKey("src-0123456789abcdef01234567")).toBe(false);
  expect(isJournalKey("fan-0123456789abcdef")).toBe(false);
  expect(isJournalKey("n-fan")).toBe(false);
  expect(isJournalKey("a::child::n")).toBe(false);
  expect(isJournalKey("src-abc#01")).toBe(false);
  expect(isJournalKey("src-abc#")).toBe(false);
});

// ---------------------------------------------------------------------------
// The lazy node row
// ---------------------------------------------------------------------------

test("without the creation option claimNode still refuses an unknown node id", () => {
  const { store, pinned } = started("lazy-default");
  // The shipped behaviour, pinned. Every Plan-path caller omits the option, so
  // this is the branch that must not have moved.
  expect(() => store.claimNode("lazy-default", "src-nope#0", "owner", 1000, Date.now(), pinned))
    .toThrow("Unknown durable node lazy-default/src-nope#0");
  expect(nodeRow(store, "lazy-default", "src-nope#0")).toBeNull();
  store.close();
});

test("the creation option inserts the row inside the claim's own transaction", () => {
  const { store, pinned } = started("lazy-create");
  const key = journalKey("src-one", 0);
  const claim = store.claimNode("lazy-create", key, "owner", 1000, Date.now(), pinned, { nodeKind: "action" });
  expect(claim.kind).toBe("claimed");
  expect(nodeRow(store, "lazy-create", key)).toMatchObject({
    node_kind: "action",
    status: "running",
    attempt: 1,
    fence: 1,
  });
  // One transaction: the row and its `attempt_started` evidence commit together.
  expect(store.journal("lazy-create").filter((event) => event.nodeId === key && event.type === "attempt_started"))
    .toHaveLength(1);
  store.close();
});

test("a repeated lazy claim adopts the existing row instead of resetting it", () => {
  const { store, pinned } = started("lazy-conflict");
  const key = journalKey("src-one", 0);
  const first = store.claimNode("lazy-conflict", key, "a", 1, 1000, pinned, { nodeKind: "action" });
  expect(first).toMatchObject({ kind: "claimed", attempt: 1, fencingToken: 1 });
  // ON CONFLICT DO NOTHING: the second claim steals the expired lease from the
  // committed row rather than creating a fresh one at attempt 0.
  const second = store.claimNode("lazy-conflict", key, "b", 1000, 5000, pinned, { nodeKind: "action" });
  expect(second).toMatchObject({ kind: "claimed", attempt: 2, fencingToken: 2, stolen: true });
  expect(
    store.database.query("SELECT COUNT(*) AS count FROM durable_nodes WHERE execution_id=?").get("lazy-conflict"),
  ).toEqual({ count: 1 });
  store.close();
});

test("a lazily created row is refused for every kind claimNode cannot lease", () => {
  const { store, pinned } = started("lazy-kinds");
  for (const nodeKind of ["signal", "queue", "timer"]) {
    expect(() => store.claimNode("lazy-kinds", `src-k#0`, "owner", 1000, Date.now(), pinned, { nodeKind }))
      .toThrow(`Durable node kind ${nodeKind} cannot be created by a claim`);
  }
  expect(nodeRow(store, "lazy-kinds", "src-k#0")).toBeNull();
  expect(() => store.claimNode("lazy-kinds", "src-k#0", "owner", 1000, Date.now(), pinned, { nodeKind: "  " }))
    .toThrow(TypeError);
  store.close();
});

test("the deployment fence runs BEFORE the lazy insert, in the same transaction", () => {
  const { store } = started("lazy-fence");
  const stale = { planDigest: digest("stale-plan"), manifestDigest: digest("stale-manifest") };
  const key = journalKey("src-fence", 0);
  // R10: with lazy insertion the first claim both creates the row and asserts
  // the pin. A superseded coordinator must not be able to create a row for a
  // version the execution is not pinned to — so the assertion has to be ahead
  // of the insert inside one `BEGIN IMMEDIATE`, not merely present.
  expect(() => store.claimNode("lazy-fence", key, "owner", 1000, Date.now(), stale, { nodeKind: "action" }))
    .toThrow(ExecutionMigratedError);
  expect(nodeRow(store, "lazy-fence", key)).toBeNull();
  expect(store.journal("lazy-fence").filter((event) => event.nodeId === key)).toHaveLength(0);
  store.close();
});

test("a terminated execution cannot grow a node the fencing sweep already passed", () => {
  const { store, pinned } = started("lazy-terminated");
  // `fenceActiveNodes` cancels every node that exists when the execution
  // terminates. That is a complete barrier only while the node set is closed;
  // re-opening it means a claim arriving afterwards could create a fresh
  // `pending` row under a cancelled execution and be handed a lease over it.
  store.cancelExecution("lazy-terminated", { reason: "operator" });
  expect(store.getExecution("lazy-terminated").status).toBe("cancelled");
  const key = journalKey("src-late", 0);
  let refused: unknown;
  try {
    store.claimNode("lazy-terminated", key, "owner", 1000, Date.now(), pinned, { nodeKind: "action" });
  } catch (error) {
    refused = error;
  }
  expect(refused).toBeInstanceOf(DurableExecutionCancelled);
  expect((refused as DurableExecutionCancelled).reason).toMatchObject({
    name: "ExecutionTerminated",
    executionStatus: "cancelled",
  });
  expect(nodeRow(store, "lazy-terminated", key)).toBeNull();
  store.close();
});

test("completeExecution still sees a lazily created node that never reached a terminal state", () => {
  const { store, pinned } = started("lazy-complete");
  const key = journalKey("src-live", 0);
  store.claimNode("lazy-complete", key, "owner", 1000, Date.now(), pinned, { nodeKind: "action" });
  // The eager loop is what made `completeExecution`'s "every node terminal"
  // count meaningful. A lazily created row is inside the same count, so the
  // guard keeps its strength over the rows this path creates.
  expect(() => store.completeExecution("lazy-complete", null, pinned))
    .toThrow("cannot complete with 1 non-successful durable node(s)");
  store.commitSuccess("lazy-complete", key, "owner", 1, { ok: true });
  expect(store.completeExecution("lazy-complete", null, pinned).changed).toBe(true);
  store.close();
});

// ---------------------------------------------------------------------------
// The driver: the option, and its default
// ---------------------------------------------------------------------------

test("the replay driver is off by default", () => {
  expect(REPLAY_DRIVER_DEFAULT).toBe("off");
  const { store, deployment } = started("driver-off");
  expect(() => new DurableExecutor(deployment, store).createReplayDriver({
    executionId: "driver-off",
    perform: () => null,
  })).toThrow("was not built with { replayDriver: \"on\" }");
  // Explicitly off is the same refusal as absent.
  expect(() => new DurableExecutor(deployment, store, { replayDriver: "off" }).createReplayDriver({
    executionId: "driver-off",
    perform: () => null,
  })).toThrow("was not built with { replayDriver: \"on\" }");
  expect(() => new ReplayDriver({
    mode: "off",
    store,
    executionId: "driver-off",
    owner: "o",
    perform: () => null,
  })).toThrow("The replay driver is off");
  store.close();
});

// ---------------------------------------------------------------------------
// The driver: a hand-written generator flow
// ---------------------------------------------------------------------------

const request = (site: string, input: unknown): EffectRequest<unknown> =>
  ({ kind: "perform", key: site, input, site });

/** Two Actions in sequence, exactly §2's slice minus the capability and branch. */
function* twoActions(log: string[]): Resumable<string> {
  const quote = (yield request("src-quote", { sku: "A" })) as { cents: number };
  log.push(`quote:${quote.cents}`);
  const charge = (yield request("src-capture", { cents: quote.cents })) as { reference: string };
  return charge.reference;
}

const driverFor = (
  store: DurableStore,
  deployment: ReturnType<typeof emptyDeployment>,
  executionId: string,
  perform: (request: DispatchedEffectRequest) => unknown,
  leaseMs = 5_000,
) =>
  new DurableExecutor(deployment, store, { replayDriver: "on" }).createReplayDriver({
    executionId,
    leaseMs,
    perform: perform as never,
  });

test("a driven body journals one entry per request, keyed by site id and occurrence", async () => {
  const { store, deployment } = started("driver-run");
  const invoked: string[] = [];
  const log: string[] = [];
  const driver = driverFor(store, deployment, "driver-run", (request) => {
    invoked.push(request.journalKey);
    return request.site === "src-quote" ? { cents: 40 } : { reference: "R-1" };
  });
  expect(await driver.run(() => twoActions(log))).toBe("R-1");
  expect(invoked).toEqual(["src-quote#0", "src-capture#0"]);
  expect(driver.audit).toEqual({ requests: 2, replayed: 0, dispatchedLive: 2, recorded: 0 });
  expect(
    store.database
      .query("SELECT node_id,status FROM durable_nodes WHERE execution_id=? ORDER BY node_id")
      .all("driver-run"),
  ).toEqual([
    { node_id: "src-capture#0", status: "succeeded" },
    { node_id: "src-quote#0", status: "succeeded" },
  ]);
  store.close();
});

test("the same site at two occurrences takes two journal keys", async () => {
  const { store, deployment } = started("driver-occurrence");
  const seen: string[] = [];
  const driver = driverFor(store, deployment, "driver-occurrence", (request) => {
    seen.push(request.journalKey);
    return { n: request.occurrence };
  });
  const body = function* (): Resumable<number> {
    const first = (yield request("src-loop", {})) as { n: number };
    const second = (yield request("src-loop", {})) as { n: number };
    return first.n + second.n;
  };
  expect(await driver.run(body)).toBe(1);
  expect(seen).toEqual(["src-loop#0", "src-loop#1"]);
  store.close();
});

test("a resumed body re-runs from the top and re-invokes nothing already committed", async () => {
  const { store, deployment } = started("driver-resume");
  const invoked: string[] = [];
  const perform = (request: DispatchedEffectRequest) => {
    invoked.push(request.site);
    if (request.site === "src-capture" && invoked.filter((site) => site === "src-capture").length === 1) {
      // A coordinator that dies after the first Action committed and before the
      // second one did.
      throw new Error("coordinator vanished");
    }
    return request.site === "src-quote" ? { cents: 40 } : { reference: "R-1" };
  };
  const log: string[] = [];
  // A short lease, as `crash-matrix.test.ts` uses: a claim that dies mid-attempt
  // leaves a live lease, and a real restart waits for it before fencing the
  // vanished owner.
  await expect(driverFor(store, deployment, "driver-resume", perform, 10).run(() => twoActions(log)))
    .rejects.toThrow("coordinator vanished");
  expect(invoked).toEqual(["src-quote", "src-capture"]);
  expect(nodeRow(store, "driver-resume", "src-quote#0")).toMatchObject({ status: "succeeded" });
  expect(nodeRow(store, "driver-resume", "src-capture#0")).toMatchObject({ status: "running" });
  await Bun.sleep(15);

  // The resume. The body runs from the top again; the first request is answered
  // from its committed node and never reaches `perform`.
  const resumed = driverFor(store, deployment, "driver-resume", perform, 10);
  expect(await resumed.run(() => twoActions(log))).toBe("R-1");
  expect(invoked.filter((site) => site === "src-quote")).toHaveLength(1);
  expect(invoked.filter((site) => site === "src-capture")).toHaveLength(2);
  expect(log).toEqual(["quote:40", "quote:40"]);
  expect(resumed.audit).toMatchObject({ requests: 2, replayed: 1, dispatchedLive: 1, recorded: 2 });
  store.close();
});

test("a replayed answer is re-verified against its committed digest", async () => {
  const { store, deployment } = started("driver-integrity");
  const driver = driverFor(store, deployment, "driver-integrity", () => ({ cents: 40 }));
  const body = function* (): Resumable<unknown> {
    return yield request("src-quote", {});
  };
  await driver.run(body);
  // Content-integrity re-verification is correctness under replay, not hygiene:
  // every replayed value is checked against the digest committed with it.
  store.database
    .query("UPDATE durable_nodes SET result_json=? WHERE execution_id=? AND node_id=?")
    .run(JSON.stringify({ cents: 99 }), "driver-integrity", "src-quote#0");
  await expect(driverFor(store, deployment, "driver-integrity", () => ({ cents: 40 })).run(body))
    .rejects.toThrow(/digest/i);
  store.close();
});

// ---------------------------------------------------------------------------
// The driver: divergence
// ---------------------------------------------------------------------------

test("a body issuing a different site at a recorded position is a divergence", async () => {
  const { store, deployment } = started("driver-diverge-site");
  const log: string[] = [];
  await driverFor(store, deployment, "driver-diverge-site", (request) =>
    request.site === "src-quote" ? { cents: 40 } : { reference: "R-1" }).run(() => twoActions(log));

  const edited = function* (): Resumable<string> {
    yield request("src-quote", { sku: "A" });
    // The second site changed. §Divergence: the runtime MUST report a
    // divergence naming the offending source site.
    yield request("src-refund", {});
    return "x";
  };
  const driver = driverFor(store, deployment, "driver-diverge-site", () => null);
  await expect(driver.run(edited)).rejects.toThrow(ReplayDivergenceError);
  // A second attempt on the same driver re-mints the same keys, so the same
  // divergence is reported at the same position and names the same site.
  await expect(driver.run(edited)).rejects.toThrow(/records src-capture#0 and the body issued src-refund#0/);
  store.close();
});

test("a body completing with journal entries unconsumed is a divergence", async () => {
  const { store, deployment } = started("driver-diverge-short");
  const log: string[] = [];
  await driverFor(store, deployment, "driver-diverge-short", (request) =>
    request.site === "src-quote" ? { cents: 40 } : { reference: "R-1" }).run(() => twoActions(log));

  const shortened = function* (): Resumable<string> {
    yield request("src-quote", { sku: "A" });
    return "early";
  };
  await expect(driverFor(store, deployment, "driver-diverge-short", () => null).run(shortened))
    .rejects.toThrow(/1 journal entry unconsumed, starting at src-capture#0/);
  store.close();
});

test("a divergence commits nothing", async () => {
  const { store, deployment } = started("driver-diverge-nocommit");
  const log: string[] = [];
  await driverFor(store, deployment, "driver-diverge-nocommit", (request) =>
    request.site === "src-quote" ? { cents: 40 } : { reference: "R-1" }).run(() => twoActions(log));
  const before = store.database
    .query("SELECT COUNT(*) AS count FROM durable_nodes WHERE execution_id=?")
    .get("driver-diverge-nocommit");

  const edited = function* (): Resumable<string> {
    yield request("src-quote", { sku: "A" });
    yield request("src-refund", {});
    return "x";
  };
  await expect(driverFor(store, deployment, "driver-diverge-nocommit", () => null).run(edited))
    .rejects.toThrow(ReplayDivergenceError);
  expect(
    store.database.query("SELECT COUNT(*) AS count FROM durable_nodes WHERE execution_id=?")
      .get("driver-diverge-nocommit"),
  ).toEqual(before);
  expect(store.getExecution("driver-diverge-nocommit").status).toBe("running");
  store.close();
});

// ---------------------------------------------------------------------------
// The driver: the request union
// ---------------------------------------------------------------------------

test("a get is answered from the provided capabilities and is not journaled", async () => {
  const { store, deployment } = started("driver-get");
  const Rates = { id: "Rates" };
  const driver = new DurableExecutor(deployment, store, { replayDriver: "on" }).createReplayDriver({
    executionId: "driver-get",
    capabilities: new Map<object | string | symbol, unknown>([[Rates, { pct: 3 }]]),
    perform: () => null,
  });
  const body = function* (): Resumable<unknown> {
    return yield { kind: "get", key: Rates, input: undefined, site: "src-rates" } as AnyRequest;
  };
  expect(await driver.run(body)).toEqual({ pct: 3 });
  expect(store.database.query("SELECT COUNT(*) AS count FROM durable_nodes WHERE execution_id=?")
    .get("driver-get")).toEqual({ count: 0 });
  store.close();
});

test("a capability read does not occupy a journal position", async () => {
  const { store, deployment } = started("driver-mixed");
  const Rates = { id: "Rates" };
  const capabilities = new Map<object | string | symbol, unknown>([[Rates, { pct: 3 }]]);
  const perform = (request: DispatchedEffectRequest) =>
    request.site === "src-quote" ? { cents: 40 } : { reference: "R-1" };
  // §2's slice shape: a capability read between two Actions. A `get` writes no
  // row, so counting it as a journal position would shift `src-capture` to
  // position 2 on the resume and report a divergence for a body that has none.
  const body = function* (): Resumable<string> {
    yield { kind: "get", key: Rates, input: undefined, site: "src-rates" } as AnyRequest;
    const quote = (yield request("src-quote", {})) as { cents: number };
    yield { kind: "get", key: Rates, input: undefined, site: "src-rates" } as AnyRequest;
    const charge = (yield request("src-capture", { cents: quote.cents })) as { reference: string };
    return charge.reference;
  };
  const driver = new DurableExecutor(deployment, store, { replayDriver: "on" }).createReplayDriver({
    executionId: "driver-mixed",
    capabilities,
    perform: perform as never,
  });
  expect(await driver.run(body)).toBe("R-1");

  const resumed = new DurableExecutor(deployment, store, { replayDriver: "on" }).createReplayDriver({
    executionId: "driver-mixed",
    capabilities,
    perform: () => {
      throw new Error("must not be invoked");
    },
  });
  expect(await resumed.run(body)).toBe("R-1");
  expect(resumed.audit).toEqual({ requests: 4, replayed: 2, dispatchedLive: 0, recorded: 2 });
  store.close();
});

test("an unprovided capability and a stray abort both fail closed", async () => {
  const { store, deployment } = started("driver-refusals");
  const driver = driverFor(store, deployment, "driver-refusals", () => null);
  await expect(driver.run(function* (): Resumable<unknown> {
    return yield { kind: "get", key: "Missing", input: undefined, site: "src-missing" } as AnyRequest;
  })).rejects.toThrow("No capability was provided for a get request at src-missing");

  const second = driverFor(store, deployment, "driver-refusals", () => null);
  await expect(second.run(function* (): Resumable<unknown> {
    return yield { kind: "abort", key: "E", input: new Error("boom"), site: "src-bang" } as AnyRequest;
  })).rejects.toThrow("reached the replay driver with no enclosing frame handler");
  store.close();
});

test("a request that was already dispatched elsewhere is refused, never re-keyed", async () => {
  const { store, deployment } = started("driver-predispatched");
  const driver = driverFor(store, deployment, "driver-predispatched", () => null);
  await expect(driver.run(function* (): Resumable<unknown> {
    // `runtime/effect.ts` assigns a per-EXECUTION dispatch ordinal; a journal
    // key is built from a per-SITE occurrence index. Honouring a foreign index
    // would key one site under two schemes across two runs.
    return yield { kind: "perform", key: "K", input: null, site: "src-x", occurrence: 7 } as AnyRequest;
  })).rejects.toThrow("arrived already dispatched at occurrence 7");
  store.close();
});

test("a committed typed failure is raised back into the body at its own site", async () => {
  const { store, pinned, deployment } = started("driver-failure");
  const key = journalKey("src-fallible", 0);
  store.claimNode("driver-failure", key, "seed", 1000, Date.now(), pinned, { nodeKind: "action" });
  store.commitFailure("driver-failure", key, "seed", 1, { kind: "failure", error: { code: "declined" } });

  const driver = driverFor(store, deployment, "driver-failure", () => {
    throw new Error("must not be invoked");
  });
  const caught: unknown[] = [];
  expect(await driver.run(function* (): Resumable<string> {
    try {
      yield request("src-fallible", {});
      return "resumed";
    } catch (error) {
      caught.push(error);
      return "caught";
    }
  })).toBe("caught");
  expect(caught).toEqual([{ code: "declined" }]);
  store.close();
});
