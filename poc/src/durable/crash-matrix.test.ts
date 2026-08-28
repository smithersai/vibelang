import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Action,
  compileDurableSource,
  CoordinatorCrash,
  Deployment,
  digest,
  DurableActionFailure,
  DurableExecutor,
  DurableStore,
  fail,
  Flow,
  PlanArtifact,
  Provider,
  Worker,
  type CachedSuccessCommit,
  type ClaimResult,
  type FinishExecutionResult,
  type ActionDescriptor,
  type PlanNode,
  type QueueNode,
  type SignalNode,
} from "./index.ts";

/**
 * Every `BEGIN IMMEDIATE` transaction site on a `DurableStore` INSTANCE, i.e.
 * every point at which "the process disappears after COMMIT returns" is a state
 * this matrix has to model.
 *
 * This list is DERIVED, not hand-maintained: `storeTransactionSites()` below
 * re-parses `store.ts`, and the gate at the bottom of this file fails when a
 * transaction site appears that is in neither this list nor
 * `CONSTRUCTION_TRANSACTION_SITES`. The previous hand-maintained union named 18
 * points where the store had 28; one of the ten it silently omitted was
 * `materializeFanOut`, and that uncovered crash state was exactly the
 * precondition for a migration defect that permanently poisoned an execution.
 */
const STORE_COMMIT_POINTS = [
  "adoptSuccess",
  "cancelExecution",
  "claimNode",
  "collectBroadcastDeliveries",
  "commitContentSuccess",
  "commitFailure",
  "commitMemoSuccess",
  "commitSuccess",
  "completeExecution",
  "contentCommit",
  "deliverBroadcast",
  "deliverSignal",
  "enqueue",
  "failExecution",
  "initializeExecution",
  "materializeFanOut",
  "materializeFanOutStep",
  "materializeLoopRound",
  "memoCommit",
  "migrateExecution",
  "pollQueue",
  "pollSignal",
  "registerChildExecution",
  "scheduleRetry",
  "scheduleTimer",
  "skipNodes",
  "timeoutNode",
] as const;

/**
 * Transaction sites that run while the store is being constructed. They are not
 * commit points for this matrix because no instance exists yet to proxy; a
 * crash there leaves an unopened database, which the next constructor rebuilds.
 */
const CONSTRUCTION_TRANSACTION_SITES = ["constructor", "initializeSignalTokenSecret"] as const;

type StoreCommitPoint = typeof STORE_COMMIT_POINTS[number];

/**
 * Commit points this file does NOT crash after, each with the reason. Keeping
 * the gap explicit is the point: the previous union expressed the same gap by
 * omitting the names entirely, which is how it went unnoticed.
 */
const UNCOVERED_COMMIT_POINTS: Readonly<Record<string, string>> = {
  collectBroadcastDeliveries: "operator retention sweep, not a coordinator transition (broadcast.test.ts)",
  contentCommit: "cross-execution cache write with no coordinator caller; commitContentSuccess is the engine path",
  deliverSignal: "producer-side write; covered for the broadcast form via deliverBroadcast",
  memoCommit: "cross-execution cache write with no coordinator caller; commitMemoSuccess is the engine path",
  migrateExecution: "exercised in migration.test.ts, which owns the migration fixtures",
  registerChildExecution: "exercised in child-flow.test.ts, which owns the parent/child Plan fixtures",
};

/** Commit points actually crashed after by this file, recorded at run time. */
const exercisedCommitPoints = new Set<StoreCommitPoint>();

/**
 * Models a process disappearing after SQLite has returned from COMMIT but
 * before the coordinator observes the return value. The proxy always invokes
 * methods with the real store as `this`, so it does not alter transaction
 * behavior or reach into the store implementation.
 */
const crashAfterCommit = (
  store: DurableStore,
  point: StoreCommitPoint,
  committed: (result: unknown) => boolean = () => true,
): DurableStore => {
  exercisedCommitPoints.add(point);
  let armed = true;
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args);
        if (armed && property === point && committed(result)) {
          armed = false;
          throw new CoordinatorCrash(point);
        }
        return result;
      };
    },
  });
};

const RESERVED_WORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "throw", "else", "do", "try",
  "function", "const", "let", "var", "new", "await", "typeof", "get", "set",
]);

/**
 * Re-derives the store's transaction sites from its own source: every member of
 * `class DurableStore` whose body contains a `.immediate()` call.
 */
const storeTransactionSites = (): readonly string[] => {
  const lines = readFileSync(new URL("./store.ts", import.meta.url), "utf8").split("\n");
  const start = lines.findIndex((line) => /^export class DurableStore\b/.test(line));
  if (start < 0) throw new Error("DurableStore class declaration not found in store.ts");
  const sites = new Set<string>();
  let member = "<class body>";
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (line === "}") break; // the class body closes at column 0
    const declaration = /^ {2}(?:private |protected |static |readonly )*([A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\(/.exec(line);
    if (declaration !== null && !RESERVED_WORDS.has(declaration[1]!)) member = declaration[1]!;
    if (line.includes(".immediate()")) sites.add(member);
  }
  return [...sites].sort();
};

const temporaryDatabase = async (body: (filename: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-durable-crash-"));
  const filename = join(directory, "state.sqlite");
  try {
    await body(filename);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const isClaim = (value: unknown): value is Extract<ClaimResult, { kind: "claimed" }> =>
  value !== null && typeof value === "object" && (value as { kind?: unknown }).kind === "claimed";

const isChangedFinish = (value: unknown): value is FinishExecutionResult =>
  value !== null && typeof value === "object" && (value as { changed?: unknown }).changed === true;

const isCommittedCache = (value: unknown): value is Extract<CachedSuccessCommit, { kind: "committed" }> =>
  value !== null && typeof value === "object" && (value as { kind?: unknown }).kind === "committed";

const successFixture = (suffix: string, calls: { value: number }, reuse: Parameters<typeof Provider.provide>[2]["reuse"] = { kind: "execution" }) => {
  const Work = Action.define<{ value: number }, { doubled: number }>({
    id: `test/CrashMatrix/${suffix}`,
    version: 1,
  });
  const Program = Flow.define<{ value: number }, { doubled: number }>(
    { id: `test/CrashMatrixFlow/${suffix}`, version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  const Live = Provider.provide(Work, ({ value }) => {
    calls.value += 1;
    return { doubled: value * 2 };
  }, {
    implementationId: `crash-matrix-${suffix}`,
    implementationVersion: "1",
    recovery: { mode: "repeatable", maxAttempts: 3 },
    reuse,
  });
  return {
    Work,
    Program,
    deployment: Deployment.build({
      id: `crash-matrix-${suffix}`,
      flow: Program,
      pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
    }),
  };
};

for (const point of ["initializeExecution", "claimNode", "commitSuccess", "completeExecution"] as const) {
  test(`restart converges after a crash following ${point}`, async () => {
    await temporaryDatabase(async (filename) => {
      const calls = { value: 0 };
      const { deployment } = successFixture(point, calls);
      const firstStore = new DurableStore(filename);
      const crashingStore = crashAfterCommit(
        firstStore,
        point,
        point === "claimNode"
          ? isClaim
          : point === "commitSuccess"
            ? (value) => value === true
            : point === "completeExecution"
              ? isChangedFinish
              : () => true,
      );
      await expect(new DurableExecutor(deployment, crashingStore).execute(
        { value: 4 },
        { executionId: `run-${point}`, leaseMs: 10 },
      )).rejects.toBeInstanceOf(CoordinatorCrash);
      firstStore.close();

      // A claim crash leaves a live lease. A real restart must wait for it,
      // then fence the vanished owner before retrying.
      if (point === "claimNode") await Bun.sleep(15);
      const resumedStore = new DurableStore(filename);
      const result = await new DurableExecutor(deployment, resumedStore).execute(
        { value: 4 },
        { executionId: `run-${point}`, leaseMs: 10 },
      );
      expect(result).toEqual({ doubled: 8 });
      expect(calls.value).toBe(1);
      expect(resumedStore.getExecution(`run-${point}`).status).toBe("completed");
      resumedStore.close();
    });
  });
}

test("a committed retry schedule survives coordinator death", async () => {
  await temporaryDatabase(async (filename) => {
    const Work = Action.define<{ value: number }, { value: number }>({ id: "test/CrashRetry", version: 1 });
    const Program = Flow.define<{ value: number }, { value: number }>(
      { id: "test/CrashRetryFlow", version: 1 },
      (input) => Work.run({ value: input.value }),
    );
    let calls = 0;
    const Live = Provider.provide(Work, ({ value }) => {
      calls += 1;
      if (calls === 1) throw new Error("retry me");
      return { value };
    }, {
      implementationId: "crash-retry",
      implementationVersion: "1",
      recovery: { mode: "repeatable", maxAttempts: 2, delayMs: 1 },
    });
    const deployment = Deployment.build({
      id: "crash-retry",
      flow: Program,
      pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
    });
    const firstStore = new DurableStore(filename);
    await expect(new DurableExecutor(
      deployment,
      crashAfterCommit(firstStore, "scheduleRetry", (value) => value === true),
    ).execute({ value: 9 }, { executionId: "retry", leaseMs: 10 })).rejects.toBeInstanceOf(CoordinatorCrash);
    firstStore.close();

    await Bun.sleep(3);
    const resumedStore = new DurableStore(filename);
    expect(await new DurableExecutor(deployment, resumedStore).execute(
      { value: 9 },
      { executionId: "retry", leaseMs: 10 },
    )).toEqual({ value: 9 });
    expect(calls).toBe(2);
    expect(resumedStore.journal("retry").filter((event) => event.type === "attempt_retry_scheduled")).toHaveLength(1);
    resumedStore.close();
  });
});

test("a committed typed failure survives coordinator death without reinvocation", async () => {
  await temporaryDatabase(async (filename) => {
    const Work = Action.define<{}, {}, { code: string }>({ id: "test/CrashFailure", version: 1 });
    const Program = Flow.define<{}, {}>(
      { id: "test/CrashFailureFlow", version: 1 },
      () => Work.run({}),
    );
    let calls = 0;
    const Live = Provider.provide(Work, () => {
      calls += 1;
      return fail({ code: "expected" });
    }, {
      implementationId: "crash-failure",
      implementationVersion: "1",
    });
    const deployment = Deployment.build({
      id: "crash-failure",
      flow: Program,
      pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
    });
    const firstStore = new DurableStore(filename);
    await expect(new DurableExecutor(
      deployment,
      crashAfterCommit(firstStore, "commitFailure", (value) => value === true),
    ).execute({}, { executionId: "failure" })).rejects.toBeInstanceOf(CoordinatorCrash);
    firstStore.close();

    const resumedStore = new DurableStore(filename);
    await expect(new DurableExecutor(deployment, resumedStore).execute(
      {},
      { executionId: "failure" },
    )).rejects.toBeInstanceOf(DurableActionFailure);
    expect(calls).toBe(1);
    expect(resumedStore.getExecution("failure").status).toBe("failed");
    resumedStore.close();
  });
});

for (const reuse of [
  { point: "commitMemoSuccess" as const, policy: { kind: "memo" as const, scope: "crash", generation: "v1", keyVersion: "v1", key: () => "one" } },
  { point: "commitContentSuccess" as const, policy: { kind: "content" as const, invalidationSalt: "v1" } },
]) {
  test(`${reuse.point} publishes cache and run-local state atomically across a crash`, async () => {
    await temporaryDatabase(async (filename) => {
      const calls = { value: 0 };
      const { deployment } = successFixture(reuse.point, calls, reuse.policy);
      const firstStore = new DurableStore(filename);
      await expect(new DurableExecutor(
        deployment,
        crashAfterCommit(firstStore, reuse.point, isCommittedCache),
      ).execute({ value: 6 }, { executionId: `first-${reuse.point}` })).rejects.toBeInstanceOf(CoordinatorCrash);
      firstStore.close();

      const resumedStore = new DurableStore(filename);
      expect(await new DurableExecutor(deployment, resumedStore).execute(
        { value: 6 },
        { executionId: `first-${reuse.point}` },
      )).toEqual({ doubled: 12 });
      expect(await new DurableExecutor(deployment, resumedStore).execute(
        { value: 6 },
        { executionId: `second-${reuse.point}` },
      )).toEqual({ doubled: 12 });
      expect(calls.value).toBe(1);
      resumedStore.close();
    });
  });
}

test("cache-hit adoption is restart-safe when the coordinator dies after its local commit", async () => {
  await temporaryDatabase(async (filename) => {
    const calls = { value: 0 };
    const { deployment } = successFixture("adopt", calls, {
      kind: "memo",
      scope: "adopt",
      generation: "v1",
      keyVersion: "v1",
      key: () => "same",
    });
    const seedStore = new DurableStore(filename);
    expect(await new DurableExecutor(deployment, seedStore).execute(
      { value: 3 },
      { executionId: "seed" },
    )).toEqual({ doubled: 6 });
    seedStore.close();

    const crashingStore = new DurableStore(filename);
    await expect(new DurableExecutor(
      deployment,
      crashAfterCommit(crashingStore, "adoptSuccess", (value) => value === true),
    ).execute({ value: 3 }, { executionId: "adopt" })).rejects.toBeInstanceOf(CoordinatorCrash);
    crashingStore.close();

    const resumedStore = new DurableStore(filename);
    expect(await new DurableExecutor(deployment, resumedStore).execute(
      { value: 3 },
      { executionId: "adopt" },
    )).toEqual({ doubled: 6 });
    expect(calls.value).toBe(1);
    resumedStore.close();
  });
});

test("branch skip, deadline fencing, cancellation, and execution failure commits are restart-visible", async () => {
  await temporaryDatabase(async (filename) => {
    const Left = Action.define<{}, { side: string }>({ id: "test/CrashBranchLeft", version: 1 });
    const Right = Action.define<{}, { side: string }>({ id: "test/CrashBranchRight", version: 1 });
    const Program = Flow.define<{ left: boolean }, { side: string }>(
      { id: "test/CrashBranchFlow", version: 1 },
      (input) => Flow.branch(input.left, () => Left.run({}), () => Right.run({})),
    );
    const LeftLive = Provider.provide(Left, () => ({ side: "left" }), {
      implementationId: "crash-branch-left",
      implementationVersion: "1",
    });
    const RightLive = Provider.provide(Right, () => ({ side: "right" }), {
      implementationId: "crash-branch-right",
      implementationVersion: "1",
    });
    const deployment = Deployment.build({
      id: "crash-branch",
      flow: Program,
      pools: [Worker.pool("local", { target: "typescript-bun", providers: [LeftLive, RightLive] })],
    });
    const firstStore = new DurableStore(filename);
    await expect(new DurableExecutor(
      deployment,
      crashAfterCommit(firstStore, "skipNodes"),
    ).execute({ left: true }, { executionId: "branch", leaseMs: 10 })).rejects.toBeInstanceOf(CoordinatorCrash);
    firstStore.close();
    await Bun.sleep(15);

    const resumedStore = new DurableStore(filename);
    expect(await new DurableExecutor(deployment, resumedStore).execute(
      { left: true },
      { executionId: "branch", leaseMs: 10 },
    )).toEqual({ side: "left" });

    const direct = new DurableStore(filename);
    direct.initializeExecution("terminal", Program.plan, deployment.manifest, { left: true });
    const firstNode = Program.plan.nodes[0]!;
    const claim = direct.claimNode("terminal", firstNode.id, "vanished", 1, 0);
    expect(claim.kind).toBe("claimed");
    expect(() => crashAfterCommit(direct, "timeoutNode").timeoutNode(
      "terminal",
      firstNode.id,
      "deadline won",
    )).toThrow(CoordinatorCrash);
    expect(direct.getNode("terminal", firstNode.id).status).toBe("defect");
    direct.close();

    const cancellationStore = new DurableStore(filename);
    cancellationStore.initializeExecution("cancel", Program.plan, deployment.manifest, { left: true });
    expect(() => crashAfterCommit(cancellationStore, "cancelExecution", isChangedFinish).cancelExecution(
      "cancel",
      { reason: "operator" },
    )).toThrow(CoordinatorCrash);
    expect(cancellationStore.getExecution("cancel").status).toBe("cancelled");
    cancellationStore.close();

    const failureStore = new DurableStore(filename);
    failureStore.initializeExecution("fail", Program.plan, deployment.manifest, { left: true });
    expect(() => crashAfterCommit(failureStore, "failExecution", isChangedFinish).failExecution(
      "fail",
      "defect",
      { name: "Injected" },
    )).toThrow(CoordinatorCrash);
    expect(failureStore.getExecution("fail").status).toBe("failed");
    failureStore.close();
    resumedStore.close();
  });
});

/**
 * The durable-queue and broadcast transitions added to the matrix. Each is one
 * `BEGIN IMMEDIATE` transaction that co-commits state and journal evidence, so
 * a process that dies immediately after COMMIT must find exactly that state on
 * restart — never a second enqueue, a second consume, or a second delivery.
 */
test("durable queue and broadcast commits are restart-visible exactly once", async () => {
  await temporaryDatabase(async (filename) => {
    const queueFlow = compileDurableSource(`
      import { durable, dequeue } from "smithers:flows"
      export const Q = durable(function Q(input: { worker: string }) {
        return dequeue<{ jobId: string }>("crash.jobs")
      })
    `, { fileName: "flows/crash-queue.sm.ts", flowId: "test/crash/Queue", actions: [] });
    if (!queueFlow.ok) throw new Error(JSON.stringify(queueFlow.diagnostics));
    const queueDeployment = Deployment.build({ id: "crash-queue", flow: queueFlow.flow, pools: [] });
    const queueNode = queueFlow.plan.nodes[0] as QueueNode;
    const queueExpectation = {
      planDigest: queueFlow.plan.digest,
      manifestDigest: queueDeployment.manifest.digest,
      queueId: queueNode.queueId,
      queueContractDigest: queueNode.queueContractDigest,
    };
    const enqueueRequest = { queueId: "crash.jobs", idempotencyKey: "k-1", item: { jobId: "J1" } };
    const enqueueExpectation = {
      queueId: queueNode.queueId,
      queueContractDigest: queueNode.queueContractDigest,
    };

    // enqueue: the item and its identity commit together.
    const enqueueStore = new DurableStore(filename);
    enqueueStore.initializeExecution("q-run", queueFlow.plan, queueDeployment.manifest, { worker: "w" });
    expect(() => crashAfterCommit(enqueueStore, "enqueue").enqueue(
      enqueueRequest,
      enqueueExpectation,
      { unsafeLocalDelivery: true },
    )).toThrow(CoordinatorCrash);
    enqueueStore.close();

    const afterEnqueue = new DurableStore(filename);
    expect(afterEnqueue.database.query("SELECT COUNT(*) AS count FROM durable_queue_items").get())
      .toEqual({ count: 1 });
    // The producer's retry adopts the committed item instead of adding one.
    expect(afterEnqueue.enqueue(enqueueRequest, enqueueExpectation, { unsafeLocalDelivery: true }).duplicate)
      .toBe(true);
    expect(afterEnqueue.database.query("SELECT COUNT(*) AS count FROM durable_queue_items").get())
      .toEqual({ count: 1 });

    // pollQueue: item state, node success, and journal evidence are one commit.
    expect(() => crashAfterCommit(afterEnqueue, "pollQueue", (value) =>
      (value as { kind?: unknown }).kind === "terminal").pollQueue("q-run", queueNode.id, queueExpectation))
      .toThrow(CoordinatorCrash);
    afterEnqueue.close();

    const afterConsume = new DurableStore(filename);
    expect(afterConsume.getNode("q-run", queueNode.id).exit).toEqual({
      kind: "success",
      value: { jobId: "J1" },
      adoptedFrom: null,
    });
    const replayed = afterConsume.pollQueue("q-run", queueNode.id, queueExpectation);
    expect(replayed).toMatchObject({ kind: "terminal", newlyConsumed: false });
    expect(afterConsume.journal("q-run").filter((event) => event.type === "queue_item_consumed"))
      .toHaveLength(1);
    afterConsume.close();

    const broadcastFlow = compileDurableSource(`
      import { durable, waitBroadcast } from "smithers:flows"
      export const B = durable(function B(input: { id: string }) {
        return waitBroadcast<{ version: string }>("crash.rolled")
      })
    `, { fileName: "flows/crash-broadcast.sm.ts", flowId: "test/crash/Broadcast", actions: [] });
    if (!broadcastFlow.ok) throw new Error(JSON.stringify(broadcastFlow.diagnostics));
    const broadcastDeployment = Deployment.build({
      id: "crash-broadcast",
      flow: broadcastFlow.flow,
      pools: [],
    });
    const signalNode = broadcastFlow.plan.nodes[0] as SignalNode;
    const signalExpectation = {
      planDigest: broadcastFlow.plan.digest,
      manifestDigest: broadcastDeployment.manifest.digest,
      signalId: signalNode.signalId,
      signalContractDigest: signalNode.signalContractDigest,
    };

    // The subscription watermark is itself a committed boundary.
    const subscribeStore = new DurableStore(filename);
    subscribeStore.initializeExecution("b-run", broadcastFlow.plan, broadcastDeployment.manifest, { id: "a" });
    expect(() => crashAfterCommit(subscribeStore, "pollSignal", (value) =>
      (value as { newlyWaiting?: unknown }).newlyWaiting === true)
      .pollSignal("b-run", signalNode.id, signalExpectation)).toThrow(CoordinatorCrash);
    subscribeStore.close();

    const afterSubscribe = new DurableStore(filename);
    expect(afterSubscribe.database.query(
      "SELECT watermark FROM durable_broadcast_subscriptions WHERE execution_id='b-run'",
    ).get()).toEqual({ watermark: 0 });
    // Re-polling does not re-subscribe at a new watermark.
    expect(afterSubscribe.pollSignal("b-run", signalNode.id, signalExpectation))
      .toEqual({ kind: "waiting", newlyWaiting: false });

    const broadcastRequest = {
      signalId: "crash.rolled",
      idempotencyKey: "d-1",
      payload: { version: "1.0" },
    };
    const broadcastExpectation = {
      signalId: signalNode.signalId,
      signalContractDigest: signalNode.signalContractDigest,
    };
    expect(() => crashAfterCommit(afterSubscribe, "deliverBroadcast").deliverBroadcast(
      broadcastRequest,
      broadcastExpectation,
      { unsafeLocalDelivery: true },
    )).toThrow(CoordinatorCrash);
    afterSubscribe.close();

    const afterDeliver = new DurableStore(filename);
    expect(afterDeliver.database.query("SELECT COUNT(*) AS count FROM durable_broadcast_deliveries").get())
      .toEqual({ count: 1 });
    expect(afterDeliver.deliverBroadcast(broadcastRequest, broadcastExpectation, { unsafeLocalDelivery: true })
      .duplicate).toBe(true);

    // The per-waiter consumption record and the node success are one commit.
    expect(() => crashAfterCommit(afterDeliver, "pollSignal", (value) =>
      (value as { newlyConsumed?: unknown }).newlyConsumed === true)
      .pollSignal("b-run", signalNode.id, signalExpectation)).toThrow(CoordinatorCrash);
    afterDeliver.close();

    const afterAdopt = new DurableStore(filename);
    expect(afterAdopt.getNode("b-run", signalNode.id).exit).toEqual({
      kind: "success",
      value: { version: "1.0" },
      adoptedFrom: null,
    });
    expect(afterAdopt.pollSignal("b-run", signalNode.id, signalExpectation))
      .toMatchObject({ kind: "terminal", newlyConsumed: false });
    expect(afterAdopt.database.query("SELECT COUNT(*) AS count FROM durable_broadcast_consumptions").get())
      .toEqual({ count: 1 });
    expect(afterAdopt.journal("b-run").filter((event) => event.type === "broadcast_consumed"))
      .toHaveLength(1);
    afterAdopt.close();
  });
});

/**
 * Builds a deployment straight from Plan IR. The templating commit points below
 * need fan-out, multi-step fan-out, loop, and timer nodes, and authoring them
 * through the source compiler would cost more fixture than the crash they are
 * here to model.
 */
const rawDeployment = (options: {
  readonly id: string;
  readonly formatVersion: 1 | 2;
  readonly nodes: readonly PlanNode[];
  readonly outputNodeId: string;
  readonly actions?: readonly ActionDescriptor[];
  readonly providers?: readonly Parameters<typeof Worker.pool>[1]["providers"][number][];
}) => {
  const semantic = {
    formatVersion: options.formatVersion,
    flowId: `test/CrashMatrix/${options.id}`,
    flowVersion: 1,
    nodes: options.nodes,
    output: { kind: "node" as const, nodeId: options.outputNodeId, path: [] as readonly string[] },
    requirements: (options.actions ?? []).map((descriptor) => descriptor.id),
    actions: options.actions ?? [],
  };
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) });
  const flow = PlanArtifact.load<Record<string, never>, unknown>(PlanArtifact.encode(plan));
  return Deployment.build({
    id: options.id,
    flow,
    pools: (options.providers ?? []).length === 0
      ? []
      : [Worker.pool("local", { target: "typescript-bun", providers: options.providers! })],
  });
};

const Fan = Action.define<{ id: string; step: number }, { id: string; step: number }>({
  id: "test/CrashMatrix/Fan",
  version: 1,
});
const Countdown = Action.define<{ remaining: number }, { remaining: number }>({
  id: "test/CrashMatrix/Countdown",
  version: 1,
});

/**
 * The templating commit points: each writes the complete dynamic child identity
 * set (or one round/step of it) in one transaction BEFORE any child can run, so
 * a process that dies immediately after COMMIT must resume onto exactly those
 * children — never a second, differently-keyed set.
 */
test("fan-out, fan-out step, loop round, and timer commits are restart-visible exactly once", async () => {
  const fanCalls: string[] = [];
  const FanLive = Provider.provide(Fan, ({ id, step }) => {
    fanCalls.push(`${id}:${step}`);
    return { id, step };
  }, { implementationId: "crash-fan", implementationVersion: "1" });

  // 1. materializeFanOut — the whole key -> child identity set is one commit.
  await temporaryDatabase(async (filename) => {
    const deployment = rawDeployment({
      id: "crash-fanout",
      formatVersion: 1,
      outputNodeId: "n-fan",
      actions: [Fan.descriptor],
      providers: [FanLive],
      nodes: [{
        kind: "fanout",
        id: "n-fan",
        items: { kind: "literal", value: [{ id: "a" }, { id: "b" }] },
        keyPath: ["id"],
        actionId: Fan.descriptor.id,
        actionVersion: Fan.descriptor.version,
        actionContractDigest: Fan.descriptor.contractDigest,
        input: { kind: "object", fields: { id: { kind: "item", path: ["id"] }, step: { kind: "literal", value: 0 } } },
        dependencies: [],
        controlDependencies: [],
      }],
    });
    const firstStore = new DurableStore(filename);
    await expect(new DurableExecutor(deployment, crashAfterCommit(firstStore, "materializeFanOut")).execute(
      {},
      { executionId: "fan", leaseMs: 100 },
    )).rejects.toBeInstanceOf(CoordinatorCrash);
    firstStore.close();

    const resumed = new DurableStore(filename);
    expect(await new DurableExecutor(deployment, resumed).execute({}, { executionId: "fan", leaseMs: 100 }))
      .toEqual([{ id: "a", step: 0 }, { id: "b", step: 0 }]);
    expect(resumed.journal("fan").filter((event) => event.type === "fanout_materialized")).toHaveLength(1);
    expect(fanCalls.sort()).toEqual(["a:0", "b:0"]);
    resumed.close();
  });

  // 2. materializeFanOutStep — one later step of one committed key.
  fanCalls.length = 0;
  await temporaryDatabase(async (filename) => {
    const step = (ordinal: number) => ({
      actionId: Fan.descriptor.id,
      actionVersion: Fan.descriptor.version,
      actionContractDigest: Fan.descriptor.contractDigest,
      input: {
        kind: "object",
        fields: {
          id: ordinal === 0 ? { kind: "item", path: ["id"] } : { kind: "step", step: ordinal - 1, path: ["id"] },
          step: { kind: "literal", value: ordinal },
        },
      },
    });
    const deployment = rawDeployment({
      id: "crash-fanout-step",
      formatVersion: 2,
      outputNodeId: "n-fan",
      actions: [Fan.descriptor],
      providers: [FanLive],
      nodes: [{
        kind: "fanout",
        id: "n-fan",
        items: { kind: "literal", value: [{ id: "a" }] },
        keyPath: ["id"],
        steps: [step(0), step(1)],
        dependencies: [],
        controlDependencies: [],
      } as unknown as PlanNode],
    });
    const firstStore = new DurableStore(filename);
    await expect(new DurableExecutor(deployment, crashAfterCommit(firstStore, "materializeFanOutStep")).execute(
      {},
      { executionId: "step", leaseMs: 100 },
    )).rejects.toBeInstanceOf(CoordinatorCrash);
    firstStore.close();

    const resumed = new DurableStore(filename);
    expect(await new DurableExecutor(deployment, resumed).execute({}, { executionId: "step", leaseMs: 100 }))
      .toEqual([{ id: "a", step: 1 }]);
    expect(resumed.journal("step").filter((event) => event.type === "fanout_step_materialized")).toHaveLength(1);
    expect(fanCalls).toEqual(["a:0", "a:1"]);
    resumed.close();
  });

  // 3. materializeLoopRound — one round's child identity and handoff state.
  const loopCalls: number[] = [];
  await temporaryDatabase(async (filename) => {
    const deployment = rawDeployment({
      id: "crash-loop",
      formatVersion: 2,
      outputNodeId: "n-loop",
      actions: [Countdown.descriptor],
      providers: [Provider.provide(Countdown, ({ remaining }) => {
        loopCalls.push(remaining);
        return { remaining: remaining - 1 };
      }, { implementationId: "crash-loop", implementationVersion: "1" })],
      nodes: [{
        kind: "loop",
        id: "n-loop",
        initial: { kind: "literal", value: { remaining: 3 } },
        condition: {
          kind: "binary",
          operator: "gt",
          left: { kind: "state", path: ["remaining"] },
          right: { kind: "literal", value: 0 },
        },
        actionId: Countdown.descriptor.id,
        actionVersion: Countdown.descriptor.version,
        actionContractDigest: Countdown.descriptor.contractDigest,
        body: { kind: "object", fields: { remaining: { kind: "state", path: ["remaining"] } } },
        maxRounds: 5,
        dependencies: [],
        controlDependencies: [],
      } as unknown as PlanNode],
    });
    const firstStore = new DurableStore(filename);
    await expect(new DurableExecutor(deployment, crashAfterCommit(firstStore, "materializeLoopRound")).execute(
      {},
      { executionId: "loop", leaseMs: 100 },
    )).rejects.toBeInstanceOf(CoordinatorCrash);
    firstStore.close();

    const resumed = new DurableStore(filename);
    expect(await new DurableExecutor(deployment, resumed).execute({}, { executionId: "loop", leaseMs: 100 }))
      .toEqual({ remaining: 0 });
    expect(resumed.journal("loop").filter((event) => event.type === "loop_round_materialized")).toHaveLength(3);
    expect(loopCalls).toEqual([3, 2, 1]);
    resumed.close();
  });

  // 4. scheduleTimer — the absolute wake deadline is committed exactly once,
  //    and a restart adopts it instead of computing a fresh one.
  await temporaryDatabase(async (filename) => {
    const deployment = rawDeployment({
      id: "crash-timer",
      formatVersion: 1,
      outputNodeId: "n-timer",
      nodes: [{
        kind: "timer",
        id: "n-timer",
        durationMs: { kind: "literal", value: 5 },
        dependencies: [],
        controlDependencies: [],
      }],
    });
    const firstStore = new DurableStore(filename);
    await expect(new DurableExecutor(
      deployment,
      crashAfterCommit(firstStore, "scheduleTimer", (result) =>
        (result as { newlyScheduled?: unknown }).newlyScheduled === true),
    ).execute({}, { executionId: "timer", leaseMs: 100 })).rejects.toBeInstanceOf(CoordinatorCrash);
    const committedWakeAt = firstStore.getNode("timer", "n-timer").wakeAt;
    expect(committedWakeAt).toBeGreaterThan(0);
    firstStore.close();

    const resumed = new DurableStore(filename);
    expect(await new DurableExecutor(deployment, resumed).execute({}, { executionId: "timer", leaseMs: 100 }))
      .toBeNull();
    expect(resumed.journal("timer").filter((event) => event.type === "timer_scheduled")).toHaveLength(1);
    expect(resumed.journal("timer").find((event) => event.type === "timer_scheduled")?.payload)
      .toMatchObject({ wakeAt: committedWakeAt });
    resumed.close();
  });
});

/**
 * The gate that makes this matrix's coverage legible. It is declared last so
 * every `crashAfterCommit` above has already registered.
 */
test("the crash matrix's commit-point union is derived from the store's transaction sites", () => {
  // 1. No transaction site can exist that this file has never classified.
  expect(storeTransactionSites()).toEqual(
    [...STORE_COMMIT_POINTS, ...CONSTRUCTION_TRANSACTION_SITES].sort(),
  );
  // 2. Every classified commit point is a real, callable store method, so a
  //    rename cannot leave a dead name behind.
  const store = new DurableStore();
  for (const point of STORE_COMMIT_POINTS) {
    expect(typeof (store as unknown as Record<string, unknown>)[point], point).toBe("function");
  }
  store.close();
  // 3. The coverage claim is checked against what actually ran, in both
  //    directions: an uncovered point may not silently appear, and a point
  //    listed as uncovered may not silently be covered.
  expect([...exercisedCommitPoints].sort()).toEqual(
    STORE_COMMIT_POINTS.filter((point) => !(point in UNCOVERED_COMMIT_POINTS)).slice().sort(),
  );
  for (const point of Object.keys(UNCOVERED_COMMIT_POINTS)) {
    expect(STORE_COMMIT_POINTS, `${point} is not a store commit point`)
      .toContain(point as StoreCommitPoint);
  }
});
