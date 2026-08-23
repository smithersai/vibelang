import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Action,
  compileDurableSource,
  CoordinatorCrash,
  Deployment,
  DurableActionFailure,
  DurableExecutor,
  DurableStore,
  fail,
  Flow,
  Provider,
  Worker,
  type CachedSuccessCommit,
  type ClaimResult,
  type FinishExecutionResult,
  type QueueNode,
  type SignalNode,
} from "./index.ts";

type StoreCommitPoint =
  | "initializeExecution"
  | "claimNode"
  | "scheduleRetry"
  | "commitSuccess"
  | "commitMemoSuccess"
  | "commitContentSuccess"
  | "adoptSuccess"
  | "commitFailure"
  | "skipNodes"
  | "completeExecution"
  | "failExecution"
  | "cancelExecution"
  | "timeoutNode"
  | "enqueue"
  | "pollQueue"
  | "deliverBroadcast"
  | "pollSignal"
  | "migrateExecution";

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
