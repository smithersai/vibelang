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
import { __vsDispatchRequest, __vsExecutionScope, __vsGet, __vsPerform, __vsProvide, __vsResultScope } from "../runtime/effect.ts";
import { __vsResultSuccess } from "../runtime/result.ts";
import { Context, Layer } from "../runtime/layer.ts";
import { assertJson } from "./value.ts";

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

test("compiler-owned nested Result frames share the replay driver's per-site dispatch scheme", async () => {
  const { store, deployment } = started("driver-compiled-frames");
  const submitted: string[] = [];
  const driver = driverFor(store, deployment, "driver-compiled-frames", request => {
    submitted.push(request.journalKey);
    return request.input;
  });
  const body = function* () {
    return yield* __vsResultScope(function* () {
      const first = yield* __vsPerform<number>("action", 2, "src-repeated");
      const second = yield* __vsPerform<number>("action", 3, "src-repeated");
      return __vsResultSuccess(first + second);
    });
  };
  try {
    expect((await driver.run(body)).unwrapOr(-1)).toBe(5);
    expect(submitted).toEqual(["src-repeated#0", "src-repeated#1"]);
    expect((await driver.run(body)).unwrapOr(-1)).toBe(5);
    expect(driver.audit).toMatchObject({ replayed: 2, dispatchedLive: 0 });
    expect(submitted).toHaveLength(2);
  } finally { store.close(); }
});

for (const fallible of [false, true]) test(`inner capability answers do not renumber forwarded ${fallible ? "Result" : "plain"} requests`, async () => {
  class Value extends Context { declare readonly n: number }
  const { store, pinned } = started(`inner-answers-${fallible}`);
  let calls = 0;
  try {
    for (let run = 0; run < 2; run++) {
      const around = __vsExecutionScope();
      const reads: number[] = [];
      const driver = new ReplayDriver({ mode: "on", store, executionId: `inner-answers-${fallible}`, owner: "test", pinned,
        capabilities: new Map([[Value, { n: 20 }]]),
        dispatchRequest: request => {
          const dispatched = around(() => __vsDispatchRequest(request));
          if (dispatched.kind === "get") reads.push(dispatched.occurrence);
          return dispatched;
        },
        perform: request => { calls++; return assertJson(request.input); },
      });
      function* read(): Resumable<number> {
        if (fallible) return (yield* __vsResultScope(function* () {
          return __vsResultSuccess((yield* __vsGet(Value, "shared-get")).n);
        }, around)).unwrapOr(-1);
        return (yield* __vsGet(Value, "shared-get")).n;
      }
      expect(await driver.run(function* () {
        const first = yield* __vsProvide(Layer.succeed(Value, { n: 10 }), read, around);
        const second = yield* read();
        const third = yield* __vsProvide(Layer.succeed(Value, { n: 30 }), read, around);
        const fourth = yield* read();
        return yield* __vsPerform("sum", first + second + third + fourth, "sum");
      })).toBe(80);
      expect(reads).toEqual([1, 3]);
      expect(driver.audit).toMatchObject({ requests: 3, replayed: run, dispatchedLive: 1 - run });
    }
    expect(calls).toBe(1);
  } finally { store.close(); }
});

test("raw requests cannot forge preserved dispatch indices", async () => {
  for (const indices of [[2, 5], [2, 2], [2, 1], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]]) {
    const { store, deployment } = started("dispatch-indices");
    try {
      const driver = driverFor(store, deployment, "dispatch-indices", () => 1);
      const run = driver.run(function* () {
        for (const occurrence of indices) yield { ...request("source", null), occurrence };
        return indices.length;
      });
      await expect(run).rejects.toThrow("without runtime dispatch identity");
      expect(store.journal("dispatch-indices").filter(event => event.type === "node_succeeded")).toEqual([]);
    } finally { store.close(); }
  }
});

test("a genuine request still cannot reuse an observed dispatch occurrence", async () => {
  const { store, deployment } = started("repeated-dispatch");
  const around = __vsExecutionScope();
  const source = __vsPerform("work", null, "source");
  try {
    const step = source.next();
    if (step.done) throw new Error("expected a suspended request");
    const issued = around(() => __vsDispatchRequest(step.value));
    const driver = driverFor(store, deployment, "repeated-dispatch", () => 1);
    await expect(driver.run(function* () { yield issued; yield issued; return 2; }))
      .rejects.toThrow("invalid or repeated occurrence");
    expect(store.journal("repeated-dispatch").filter(event => event.type === "node_succeeded")).toHaveLength(1);
  } finally { source.return(undefined); store.close(); }
});

test("dispatch divergence abandons every live scope without running catches or committing cleanup", async () => {
  const { store, deployment } = started("driver-dispatch-cleanup");
  const driver = driverFor(store, deployment, "driver-dispatch-cleanup", () => 1);
  await driver.run(function* () { return yield request("src-original", null); });
  const events = store.journal("driver-dispatch-cleanup");
  const log: string[] = [];
  const resource = (name: string) => ({ [Symbol.dispose]() { log.push(`dispose:${name}`); } });
  try {
    await expect(driver.run(function* () {
      using outer = resource("outer");
      try {
        using inner = resource("inner");
        try { yield request("src-edited", null); }
        catch { log.push("caught"); }
        finally { log.push("inner:finally"); yield request("src-cleanup", null); }
      } finally { log.push("outer:finally"); }
    })).rejects.toBeInstanceOf(ReplayDivergenceError);
    expect(log).toEqual(["inner:finally", "dispose:inner", "outer:finally", "dispose:outer"]);
    expect(store.journal("driver-dispatch-cleanup")).toEqual(events);
    expect(store.getExecution("driver-dispatch-cleanup").status).toBe("running");
  } finally { store.close(); }
});

test("a journal key pins the submitted Action and input before dispatch, including on replay", async () => {
  const { store, pinned } = started("driver-request-identity");
  let calls = 0;
  const driver = new ReplayDriver({ mode: "on", store, executionId: "driver-request-identity", owner: "owner", pinned,
    requestDigest: request => digest({ kind: request.kind, key: request.key, input: request.input }),
    perform: request => { calls++; return assertJson(request.input); },
  });
  const body = (key: string, input: number) => function* () { return yield* __vsPerform(key, input, "src-pinned"); };
  try {
    expect(await driver.run(body("Action", 4))).toBe(4);
    const before = store.journal("driver-request-identity");
    await expect(driver.run(body("Action", 5))).rejects.toBeInstanceOf(ReplayDivergenceError);
    await expect(driver.run(body("OtherAction", 4))).rejects.toBeInstanceOf(ReplayDivergenceError);
    expect(store.journal("driver-request-identity")).toEqual(before);
    expect(store.getExecution("driver-request-identity").status).toBe("running");
    expect(await driver.run(body("Action", 4))).toBe(4);
    expect(calls).toBe(1);
  } finally { store.close(); }
});

test("a replay driver rejects overlapping attempts before mutating the active audit", async () => {
  const { store, deployment } = started("driver-overlap");
  let finish!: (value: number) => void;
  const pending = new Promise<number>(resolve => { finish = resolve; });
  const driver = driverFor(store, deployment, "driver-overlap", () => pending);
  const body = function* (): Resumable<unknown> { return yield request("src-one", null); };
  const running = driver.run(body);
  try {
    await expect(driver.run(body)).rejects.toThrow("overlapping attempts");
    finish(7);
    expect(await running).toBe(7);
    expect(driver.audit).toMatchObject({ requests: 1, dispatchedLive: 1 });
    expect(await driver.run(body)).toBe(7);
    expect(driver.audit).toMatchObject({ requests: 1, replayed: 1, dispatchedLive: 0 });
  } finally { finish(7); await running; store.close(); }
});

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

for (const phase of ["claim", "dispatch", "busy"] as const) test(`cancellation at ${phase} does not dispatch or commit a worker`, async () => {
  const id = `cancel-at-${phase}`;
  const { store } = started(id);
  const controller = new AbortController();
  const cancelled = new DurableExecutionCancelled("test cancellation");
  const claim = store.claimNode.bind(store);
  let invoked = 0;
  let claimed = 0;
  store.claimNode = (...args) => {
    claimed++;
    if (phase === "busy") {
      controller.abort(cancelled);
      return { kind: "busy", leaseExpiresAt: Date.now() + 1 };
    }
    const result = claim(...args);
    if (phase === "claim") controller.abort(cancelled);
    else queueMicrotask(() => controller.abort(cancelled));
    return result;
  };
  const driver = new ReplayDriver({ mode: "on", store, executionId: id, owner: "cancel-test",
    signal: controller.signal, deadline: Date.now() + 100, perform: () => { invoked++; return 1; } });
  try {
    await expect(driver.run(function* (): Resumable<unknown> { return yield request("src-one", null); })).rejects.toBe(cancelled);
    expect(invoked).toBe(0);
    expect(claimed).toBe(1);
    expect(store.journal(id).some(event => event.type === "node_succeeded")).toBe(false);
  } finally { store.close(); }
});

test("a worker that cancels its attempt cannot commit its returned answer", async () => {
  const id = "cancel-at-answer";
  const { store } = started(id);
  const controller = new AbortController();
  const cancelled = new DurableExecutionCancelled("cancel before commit");
  const driver = new ReplayDriver({ mode: "on", store, executionId: id, owner: "cancel-test", signal: controller.signal,
    perform: () => { controller.abort(cancelled); return 1; } });
  try {
    await expect(driver.run(function* (): Resumable<unknown> { return yield request("src-one", null); })).rejects.toBe(cancelled);
    expect(store.journal(id).some(event => event.type === "node_succeeded")).toBe(false);
  } finally { store.close(); }
});

for (const completion of ["fail", "retry"] as const) test(`an abandoned worker cannot ${completion} under its old fence`, async () => {
  const id = `late-${completion}`;
  const { store } = started(id);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let finished!: () => void;
  const settled = new Promise<void>(resolve => { finished = resolve; });
  const unavailable = new Error("lease store unavailable");
  store.heartbeat = () => { throw unavailable; };
  const driver = new ReplayDriver({ mode: "on", store, executionId: id, owner: "late-worker", leaseMs: 15,
    perform: async (_request, attempt) => {
      try {
        await pending;
        const defect = { name: "LateWorker", message: "already abandoned" };
        return completion === "fail" ? attempt.fail(defect) : attempt.retry({ kind: "defect", defect }, Date.now());
      } finally { finished(); }
    } });
  try {
    await expect(driver.run(function* (): Resumable<unknown> { return yield request("src-one", null); })).rejects
      .toMatchObject({ name: "CoordinatorUnavailable", cause: unavailable });
    release();
    await settled;
    expect(store.getNode(id, "src-one#0").status).toBe("running");
    expect(store.getNode(id, "src-one#0").exit).toBeUndefined();
    expect(store.journal(id).some(event => event.type === "attempt_retry_scheduled")).toBe(false);
  } finally { release(); store.close(); }
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
    // Inner runtime handlers preserve authentic per-site indices. An arbitrary
    // object must not claim that identity just by supplying a number field.
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
