import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Action,
  assertJson,
  canonicalJson,
  Deployment,
  DurableActionDefect,
  DurableExecutor,
  DurableStore,
  Flow,
  Provider,
  Worker,
} from "./index.ts";

test("durable crash/replay/cache/fencing demonstration stays green", async () => {
  const process = Bun.spawn(["bun", join(import.meta.dir, "../../examples/durable/demo.ts")], {
    cwd: join(import.meta.dir, "../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  const report = JSON.parse(stdout) as { ok: boolean; planNodes: number; calls: { compile: number } };
  expect(report.ok).toBe(true);
  expect(report.planNodes).toBeGreaterThan(5);
  expect(report.calls.compile).toBe(2);
});

test("expired attempts respect manual recovery and persisted budgets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-durable-policy-"));
  try {
    const Work = Action.define<{ value: number }, { value: number }>({ id: "test/Manual", version: 1 });
    const Program = Flow.define<{ value: number }, { value: number }>(
      { id: "test/ManualFlow", version: 1 },
      (input) => Work.run({ value: input.value }),
    );
    let calls = 0;
    const Live = Provider.provide(Work, ({ value }) => { calls++; return { value }; }, {
      implementationId: "manual-test",
      implementationVersion: "1",
      recovery: { mode: "manual", maxAttempts: 1 },
    });
    const deployment = Deployment.build({
      id: "manual-policy-test",
      flow: Program,
      pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
    });
    const store = new DurableStore(join(directory, "state.sqlite"));
    const deadline = Date.now() + 30_000;
    store.initializeExecution("manual-run", Program.plan, deployment.manifest, { value: 1 }, deadline);
    const actionNode = Program.plan.nodes.find((node) => node.kind === "action")!;
    const expired = store.claimNode("manual-run", actionNode.id, "dead-worker", 1, Date.now() - 100);
    expect(expired.kind).toBe("claimed");

    const executor = new DurableExecutor(deployment, store);
    try {
      await executor.execute({ value: 1 }, { executionId: "manual-run", deadline: deadline + 99_000 });
      throw new Error("expected ambiguous completion defect");
    } catch (error) {
      expect(error).toBeInstanceOf(DurableActionDefect);
      expect(JSON.stringify((error as DurableActionDefect).defect)).toContain("AmbiguousCompletion");
    }
    expect(calls).toBe(0);
    const events = store.journal("manual-run");
    expect(events.some((event) => event.type === "attempt_lease_stolen")).toBe(true);
    // Restart options cannot extend the deadline pinned when the execution began.
    expect(store.initializeExecution("manual-run", Program.plan, deployment.manifest, { value: 1 }, deadline + 1).deadline)
      .toBe(deadline);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retry backoff survives coordinator restart in node state", () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/Retry", version: 1 });
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: "test/RetryFlow", version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  const Live = Provider.provide(Work, ({ value }) => ({ value }), {
    implementationId: "retry-test",
    implementationVersion: "1",
    recovery: { mode: "repeatable", maxAttempts: 2, delayMs: 100 },
  });
  const deployment = Deployment.build({
    id: "retry-policy-test",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  store.initializeExecution("retry-run", Program.plan, deployment.manifest, { value: 1 });
  const actionNode = Program.plan.nodes.find((node) => node.kind === "action")!;
  const now = Date.now();
  const claim = store.claimNode("retry-run", actionNode.id, "worker", 1_000, now);
  if (claim.kind !== "claimed") throw new Error("expected claim");
  expect(store.scheduleRetry(
    "retry-run",
    actionNode.id,
    "worker",
    claim.fencingToken,
    { kind: "defect", defect: { name: "lost", message: "lost" } },
    now + 100,
  )).toBe(true);
  expect(store.claimNode("retry-run", actionNode.id, "new-worker", 1_000, now + 50).kind).toBe("busy");
  expect(store.claimNode("retry-run", actionNode.id, "new-worker", 1_000, now + 101).kind).toBe("claimed");
  store.close();
});

test("canonical durable JSON rejects holes and preserves __proto__ data", () => {
  const sparse = new Array(1);
  expect(() => assertJson(sparse)).toThrow("sparse array hole");
  const value = JSON.parse('{"__proto__":{"safe":true}}') as unknown;
  expect(canonicalJson(value)).toBe('{"__proto__":{"safe":true}}');
});

test("same id/version cannot alias distinct Action contracts", () => {
  const First = Action.define<{ text: string }, { length: number }>({ id: "test/Collision", version: 1 });
  const Other = Action.define<{ count: number }, { doubled: number }>({ id: "test/Collision", version: 1 });
  expect(() => Flow.define<{ text: string; count: number }, unknown>(
    { id: "test/CollisionFlow", version: 1 },
    (input) => [First.run({ text: input.text }), Other.run({ count: input.count })],
  )).toThrow("distinct nominal definitions");

  const OnlyFirst = Flow.define<{ text: string }, { length: number }>(
    { id: "test/OnlyFirst", version: 1 },
    (input) => First.run({ text: input.text }),
  );
  const wrongProvider = Provider.provide(Other, ({ count }) => ({ doubled: count * 2 }), {
    implementationId: "wrong-contract",
    implementationVersion: "1",
  });
  expect(() => Deployment.build({
    id: "wrong-contract",
    flow: OnlyFirst,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [wrongProvider] })],
  })).toThrow("different nominal descriptor");

  const Newer = Action.define<{ text: string }, { length: number }>({ id: "test/Collision", version: 2 });
  const newerProvider = Provider.provide(Newer, ({ text }) => ({ length: text.length }), {
    implementationId: "wrong-version",
    implementationVersion: "2",
  });
  expect(() => Deployment.build({
    id: "wrong-version",
    flow: OnlyFirst,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [newerProvider] })],
  })).toThrow("version/schema contract mismatch");
});

test("branch-local Planned values cannot leak into a sibling arm", () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/BranchWork", version: 1 });
  let trueArmValue: ReturnType<typeof Work.run> | undefined;
  expect(() => Flow.define<{ choose: boolean; value: number }, { value: number }>(
    { id: "test/BranchLeak", version: 1 },
    (input) => Flow.branch(
      input.choose,
      () => {
        trueArmValue = Work.run({ value: input.value });
        return trueArmValue;
      },
      () => trueArmValue!,
    ),
  )).toThrow("escaped a branch arm");
});

test("Plan, provider policy, and deployment manifest stay immutable under their digests", () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/Frozen", version: 1 });
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: "test/FrozenFlow", version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  const recovery = { mode: "repeatable" as const, maxAttempts: 2 };
  const Live = Provider.provide(Work, ({ value }) => ({ value }), {
    implementationId: "frozen-provider",
    implementationVersion: "1",
    recovery,
  });
  recovery.maxAttempts = 99;
  expect(Live.recovery.maxAttempts).toBe(2);
  expect(Object.isFrozen(Program.plan.nodes)).toBe(true);
  expect(Object.isFrozen(Program.plan.nodes[0])).toBe(true);
  expect(() => (Program.plan.nodes as unknown as unknown[]).push({})).toThrow();

  const deployment = Deployment.build({
    id: "frozen-deployment",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  expect(deployment.manifest.routes[0].actionContractDigest).toBe(Work.descriptor.contractDigest);
  expect(Object.isFrozen(deployment.manifest.routes[0].policy.recovery)).toBe(true);
  expect(() => {
    (deployment.manifest.routes[0].policy.recovery as { maxAttempts: number }).maxAttempts = 77;
  }).toThrow();
});

test("stale fenced attempts cannot publish memo or content entries", () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/AtomicReuse", version: 1 });
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: "test/AtomicReuseFlow", version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  const Live = Provider.provide(Work, ({ value }) => ({ value }), {
    implementationId: "atomic-reuse",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "atomic-reuse",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  const node = Program.plan.nodes[0];
  const now = Date.now();

  store.initializeExecution("stale-memo", Program.plan, deployment.manifest, { value: 1 });
  const memoOld = store.claimNode("stale-memo", node.id, "old", 1, now);
  const memoNew = store.claimNode("stale-memo", node.id, "new", 1_000, now + 2);
  if (memoOld.kind !== "claimed" || memoNew.kind !== "claimed") throw new Error("expected claims");
  expect(store.commitMemoSuccess(
    "stale-memo", node.id, "old", memoOld.fencingToken, "scope", "v1", "key", { value: 1 },
  ).kind).toBe("lost");
  expect(store.memoGet("scope", "v1", "key")).toBeUndefined();
  expect(store.commitMemoSuccess(
    "stale-memo", node.id, "new", memoNew.fencingToken, "scope", "v1", "key", { value: 2 },
  )).toEqual({ kind: "committed", value: { value: 2 } });

  store.initializeExecution("stale-content", Program.plan, deployment.manifest, { value: 1 });
  const contentOld = store.claimNode("stale-content", node.id, "old", 1, now);
  const contentNew = store.claimNode("stale-content", node.id, "new", 1_000, now + 2);
  if (contentOld.kind !== "claimed" || contentNew.kind !== "claimed") throw new Error("expected claims");
  expect(store.commitContentSuccess(
    "stale-content", node.id, "old", contentOld.fencingToken, "content-key", "input", { value: 1 },
  ).kind).toBe("lost");
  expect(store.contentGet("content-key", "input")).toBeUndefined();
  expect(store.commitContentSuccess(
    "stale-content", node.id, "new", contentNew.fencingToken, "content-key", "input", { value: 2 },
  ).kind).toBe("committed");
  store.close();
});

test("persisted deadlines bound hung providers and abort their cooperative signal", async () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/Hung", version: 1 });
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: "test/HungFlow", version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  let aborted = false;
  const Live = Provider.provide(Work, (_input, { signal }) => new Promise<{ value: number }>(() => {
    signal.addEventListener("abort", () => { aborted = true; }, { once: true });
  }), {
    implementationId: "hung-provider",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "hung-deployment",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  const start = Date.now();
  try {
    await new DurableExecutor(deployment, store).execute(
      { value: 1 },
      { executionId: "hung", deadline: start + 40, leaseMs: 10 },
    );
    throw new Error("expected deadline defect");
  } catch (error) {
    expect(error).toBeInstanceOf(DurableActionDefect);
    expect(JSON.stringify((error as DurableActionDefect).defect)).toContain("DeadlineExceeded");
  }
  expect(Date.now() - start).toBeLessThan(500);
  expect(aborted).toBe(true);
  store.close();
});

test("persisted deadlines fence a busy lease instead of waiting for it", async () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/BusyDeadline", version: 1 });
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: "test/BusyDeadlineFlow", version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  const Live = Provider.provide(Work, ({ value }) => ({ value }), {
    implementationId: "busy-deadline",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "busy-deadline",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  const deadline = Date.now() + 35;
  store.initializeExecution("busy", Program.plan, deployment.manifest, { value: 1 }, deadline);
  const node = Program.plan.nodes[0];
  const oldClaim = store.claimNode("busy", node.id, "old-worker", 60_000);
  if (oldClaim.kind !== "claimed") throw new Error("expected old claim");
  const start = Date.now();
  try {
    await new DurableExecutor(deployment, store).execute(
      { value: 1 },
      { executionId: "busy", deadline: deadline + 60_000 },
    );
    throw new Error("expected deadline defect");
  } catch (error) {
    expect(error).toBeInstanceOf(DurableActionDefect);
  }
  expect(Date.now() - start).toBeLessThan(500);
  expect(store.commitSuccess("busy", node.id, "old-worker", oldClaim.fencingToken, { value: 9 })).toBe(false);
  store.close();
});

test("a losing execution failure CAS returns the persisted successful winner", async () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/TerminalCas", version: 1 });
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: "test/TerminalCasFlow", version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  const Live = Provider.provide(Work, ({ value }) => ({ value }), {
    implementationId: "terminal-cas",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "terminal-cas",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  let release = (): void => {};
  let adopted = (): void => {};
  const releaseGate = new Promise<void>((resolve) => { release = resolve; });
  const adoptedGate = new Promise<void>((resolve) => { adopted = resolve; });
  const loser = new DurableExecutor(deployment, store).execute({ value: 7 }, {
    executionId: "terminal-cas",
    afterNodeAdopted: async () => {
      adopted();
      await releaseGate;
      throw new Error("local coordinator lost after node adoption");
    },
  });
  await adoptedGate;
  const winner = await new DurableExecutor(deployment, store).execute({ value: 7 }, { executionId: "terminal-cas" });
  release();
  expect(winner).toEqual({ value: 7 });
  expect(await loser).toEqual({ value: 7 });
  store.close();
});
