import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "../runtime/layer.ts";
import {
  Action,
  assertJson,
  canonicalJson,
  compileActionImplementationContract,
  ContentIntegrityError,
  decodeCanonicalJson,
  Deployment,
  digest,
  DurableActionDefect,
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  Expr,
  fail,
  Flow,
  LocalWorker,
  PlanArtifact,
  Provider,
  Worker,
  type ActionDescriptor,
} from "./index.ts";

const computeContract = (action: ActionDescriptor, implementationId: string, implementation: Function) => compileActionImplementationContract({
  action,
  implementationId,
  implementationVersion: "1",
  entryFile: "implementation.vibe",
  exportName: implementation.name,
  implementation,
  sources: [{
    fileName: "implementation.vibe",
    source: `
      import { Context } from "vibelang/context"
      abstract class Compute extends Context { abstract run(): void }
      export ${Function.prototype.toString.call(implementation)}
    `,
  }],
});

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

test("a canonical static Plan artifact loads and executes without an author callback", async () => {
  const Work = Action.define<{ value: number }, { doubled: number }>({ id: "test/StaticAction", version: 1 });
  const nodeId = "static-callsite-001";
  const semantic = {
    formatVersion: 1 as const,
    flowId: "test/StaticFlow",
    flowVersion: 1,
    nodes: [{
      kind: "action" as const,
      id: nodeId,
      actionId: Work.descriptor.id,
      actionVersion: Work.descriptor.version,
      actionContractDigest: Work.descriptor.contractDigest,
      input: { kind: "object" as const, fields: {
        value: { kind: "input" as const, path: ["value"] },
      } },
      dependencies: [],
      controlDependencies: [],
      debug: { label: "compiler-emitted-static-call", callSite: "fixture.vibe:4:10" },
    }],
    output: { kind: "node" as const, nodeId, path: [] },
    requirements: [Work.descriptor.id],
    actions: [Work.descriptor],
  };
  const compilerPlan = { ...semantic, digest: digest(semantic) };
  const bytes = PlanArtifact.encode(compilerPlan);
  const Program = PlanArtifact.load<{ value: number }, { doubled: number }>(bytes);
  expect(Program.artifactSource).toBe("static-plan-artifact");
  expect(Program.plan.digest).toBe(compilerPlan.digest);

  const Live = Provider.provide(Work, ({ value }) => ({ doubled: value * 2 }), {
    implementationId: "static-action-implementation",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "static-deployment",
    flow: Program,
    pools: [Worker.pool("static", { target: "typescript-bun", providers: [Live] })],
  });
  expect(deployment.manifest.routes[0].policy.capabilityGrant).toEqual([]);
  const store = new DurableStore();
  expect(await new DurableExecutor(deployment, store).execute({ value: 4 }, { executionId: "static-run" }))
    .toEqual({ doubled: 8 });

  const encoded = new TextDecoder().decode(bytes);
  expect(() => PlanArtifact.load(encoded + " ")).toThrow("canonical durable encoding");
  expect(() => PlanArtifact.load(encoded.replace("test/StaticFlow", "test/TamperFlow"))).toThrow("digest mismatch");
  store.close();
});

test("canonical codec rejects semantic aliases, accessors, hidden data, and noncanonical bytes", () => {
  expect(() => assertJson(-0)).toThrow("negative zero");
  expect(() => assertJson("\ud800")).toThrow("unpaired high surrogate");
  expect(() => decodeCanonicalJson('{"b":1,"a":2}')).toThrow("canonical durable encoding");
  expect(() => decodeCanonicalJson('{"a":1,"a":1}')).toThrow("canonical durable encoding");

  let getterRan = false;
  const accessor = {} as Record<string, unknown>;
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get() { getterRan = true; return 1; },
  });
  expect(() => assertJson(accessor)).toThrow("accessor or hidden property");
  expect(getterRan).toBe(false);

  const hidden = { visible: true };
  Object.defineProperty(hidden, "secret", { value: true, enumerable: false });
  expect(() => assertJson(hidden)).toThrow("accessor or hidden property");
  const symbolic = { visible: true, [Symbol("secret")]: true };
  expect(() => assertJson(symbolic)).toThrow("symbol property");

  const Work = Action.define<{}, {}>({ id: "test/HostilePlan", version: 1 });
  const Program = Flow.define<{}, {}>({ id: "test/HostilePlanFlow", version: 1 }, () => Work.run({}));
  const hostile = { ...Program.plan };
  let planGetterRan = false;
  Object.defineProperty(hostile, "flowId", {
    enumerable: true,
    get() { planGetterRan = true; return "test/Evil"; },
  });
  expect(() => PlanArtifact.validate(hostile)).toThrow("accessor or hidden property");
  expect(planGetterRan).toBe(false);
});

test("worker codec failures become durable defects and boolean expressions short-circuit", async () => {
  const Bad = Action.define<{}, {}, { code: string }>({ id: "test/BadFailureCodec", version: 1 });
  const BadProgram = Flow.define<{}, {}>(
    { id: "test/BadFailureCodecFlow", version: 1 },
    () => Bad.run({}),
  );
  const BadLive = Provider.provide(Bad, () => fail(undefined as unknown as { code: string }), {
    implementationId: "bad-failure-codec",
    implementationVersion: "1",
  });
  const badDeployment = Deployment.build({
    id: "bad-failure-codec",
    flow: BadProgram,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [BadLive] })],
  });
  const badStore = new DurableStore();
  try {
    await new DurableExecutor(badDeployment, badStore).execute({}, { executionId: "bad-failure" });
    throw new Error("expected codec defect");
  } catch (error) {
    expect(error).toBeInstanceOf(DurableActionDefect);
    expect(JSON.stringify((error as DurableActionDefect).defect)).toContain("FailureCodecDefect");
  }
  badStore.close();

  const ShortCircuit = Flow.define<{ flag: boolean }, boolean>(
    { id: "test/ShortCircuitFlow", version: 1 },
    (input) => Expr.and(input.flag, (input as unknown as { missing: { value: boolean } }).missing.value),
  );
  const deployment = Deployment.build({ id: "short-circuit", flow: ShortCircuit, pools: [] });
  const store = new DurableStore();
  expect(await new DurableExecutor(deployment, store).execute(
    { flag: false },
    { executionId: "short-circuit" },
  )).toBe(false);
  store.close();
});

test("persisted cancellation fences work, aborts the worker, and wins terminal races", async () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/Cancel", version: 1 });
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: "test/CancelFlow", version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  let started = (): void => {};
  const startedGate = new Promise<void>((resolve) => { started = resolve; });
  let aborted = false;
  const Live = Provider.provide(Work, (_input, { signal }) => new Promise<{ value: number }>(() => {
    signal.addEventListener("abort", () => { aborted = true; }, { once: true });
    started();
  }), {
    implementationId: "cancel-provider",
    implementationVersion: "1",
    recovery: { mode: "repeatable", maxAttempts: 3 },
  });
  const deployment = Deployment.build({
    id: "cancel-deployment",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  const executor = new DurableExecutor(deployment, store);
  const running = executor.execute({ value: 1 }, { executionId: "cancel-run", leaseMs: 20 });
  await startedGate;
  executor.cancel("cancel-run", { name: "UserCancelled", requestId: "req-1" });
  try {
    await running;
    throw new Error("expected cancellation");
  } catch (error) {
    expect(error).toBeInstanceOf(DurableExecutionCancelled);
    expect((error as DurableExecutionCancelled).reason).toEqual({ name: "UserCancelled", requestId: "req-1" });
  }
  expect(aborted).toBe(true);
  expect(store.getExecution("cancel-run").status).toBe("cancelled");
  expect(store.journal("cancel-run").some((event) => event.type === "execution_cancelled")).toBe(true);
  const node = Program.plan.nodes[0];
  expect(store.getNode("cancel-run", node.id).status).toBe("cancelled");
  store.close();
});

test("two coordinators sharing SQLite expose one committed winner", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-two-coordinator-"));
  try {
    const Work = Action.define<{ value: number }, { value: number }>({ id: "test/TwoCoordinator", version: 1 });
    const Program = Flow.define<{ value: number }, { value: number }>(
      { id: "test/TwoCoordinatorFlow", version: 1 },
      (input) => Work.run({ value: input.value }),
    );
    let release = (): void => {};
    let entered = (): void => {};
    const releaseGate = new Promise<void>((resolve) => { release = resolve; });
    const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
    let calls = 0;
    const Live = Provider.provide(Work, async ({ value }) => {
      calls += 1;
      entered();
      await releaseGate;
      return { value };
    }, {
      implementationId: "two-coordinator",
      implementationVersion: "1",
      recovery: { mode: "repeatable", maxAttempts: 2 },
    });
    const deployment = Deployment.build({
      id: "two-coordinator",
      flow: Program,
      pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
    });
    const filename = join(directory, "state.sqlite");
    const firstStore = new DurableStore(filename);
    const secondStore = new DurableStore(filename);
    const first = new DurableExecutor(deployment, firstStore).execute({ value: 5 }, {
      executionId: "shared-run", leaseMs: 100,
    });
    await enteredGate;
    const second = new DurableExecutor(deployment, secondStore).execute({ value: 5 }, {
      executionId: "shared-run", leaseMs: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    release();
    expect(await first).toEqual({ value: 5 });
    expect(await second).toEqual({ value: 5 });
    expect(calls).toBe(1);
    const events = secondStore.journal("shared-run");
    expect(events.filter((event) => event.type === "node_succeeded")).toHaveLength(1);
    expect(events.filter((event) => event.type === "execution_completed")).toHaveLength(1);
    firstStore.close();
    secondStore.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persisted node, execution, and journal corruption is detected before replay", async () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/Corruption", version: 1 });
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: "test/CorruptionFlow", version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  const Live = Provider.provide(Work, ({ value }) => ({ value }), {
    implementationId: "corruption-provider",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "corruption-deployment",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  await new DurableExecutor(deployment, store).execute({ value: 3 }, { executionId: "corrupt-run" });
  const node = Program.plan.nodes[0];
  store.database.query("UPDATE durable_nodes SET result_json=? WHERE execution_id=? AND node_id=?")
    .run('{"value":4}', "corrupt-run", node.id);
  expect(() => store.getNode("corrupt-run", node.id)).toThrow(ContentIntegrityError);

  store.database.query("UPDATE durable_executions SET output_json=? WHERE id=?")
    .run('{"value":4}', "corrupt-run");
  expect(() => store.getExecution("corrupt-run")).toThrow(ContentIntegrityError);

  store.database.query("UPDATE durable_journal SET payload_json=? WHERE execution_id=? AND sequence=(SELECT MIN(sequence) FROM durable_journal WHERE execution_id=?)")
    .run('{}', "corrupt-run", "corrupt-run");
  expect(() => store.journal("corrupt-run")).toThrow(ContentIntegrityError);

  await new DurableExecutor(deployment, store).execute({ value: 5 }, { executionId: "corrupt-event-metadata" });
  store.database.query(
    "UPDATE durable_journal SET type='forged_event' WHERE execution_id=? AND sequence=(SELECT MIN(sequence) FROM durable_journal WHERE execution_id=?)",
  ).run("corrupt-event-metadata", "corrupt-event-metadata");
  expect(() => store.journal("corrupt-event-metadata")).toThrow("event digest verification");
  store.close();
});

test("an execution failure fences unrelated active nodes before they can publish shared cache", async () => {
  const Slow = Action.define<{ value: number }, { value: number }>({ id: "test/FailureFenceSlow", version: 1 });
  const Stop = Action.define<{}, {}, { code: string }>({ id: "test/FailureFenceStop", version: 1 });
  const Program = Flow.define<{ value: number }, readonly [{ value: number }, {}]>(
    { id: "test/FailureFenceFlow", version: 1 },
    (input) => Flow.parallel(
      () => Slow.run({ value: input.value }),
      () => Stop.run({}),
    ),
  );
  let slowStarted = (): void => {};
  const slowStartedGate = new Promise<void>((resolve) => { slowStarted = resolve; });
  let slowAborted = false;
  const SlowLive = Provider.provide(Slow, (_input, { signal }) => new Promise<{ value: number }>(() => {
    signal.addEventListener("abort", () => { slowAborted = true; }, { once: true });
    slowStarted();
  }), {
    implementationId: "failure-fence-slow",
    implementationVersion: "1",
    recovery: { mode: "repeatable", maxAttempts: 2 },
    reuse: { kind: "content" },
  });
  const StopLive = Provider.provide(Stop, async () => {
    await slowStartedGate;
    return fail({ code: "stop" });
  }, {
    implementationId: "failure-fence-stop",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "failure-fence",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [SlowLive, StopLive] })],
  });
  const store = new DurableStore();
  await expect(new DurableExecutor(deployment, store).execute(
    { value: 1 },
    { executionId: "failure-fence", leaseMs: 20 },
  )).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 25));
  expect(slowAborted).toBe(true);
  const slowNode = Program.plan.nodes.find((node) => node.kind === "action" && node.actionId === Slow.descriptor.id)!;
  expect(store.getNode("failure-fence", slowNode.id).status).toBe("cancelled");
  const cacheCount = store.database.query("SELECT COUNT(*) AS count FROM durable_content_cache").get() as { count: number };
  expect(cacheCount.count).toBe(0);
  store.close();
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

test("canonical artifact ordering is locale-independent across Actions, routes, and pools", () => {
  const Lower = Action.define<{}, {}>({ id: "a/action", version: 1 });
  const Upper = Action.define<{}, {}>({ id: "B/action", version: 1 });
  const Program = Flow.define<{}, readonly [{}, {}]>(
    { id: "test/CanonicalOrder", version: 1 },
    () => [Lower.run({}), Upper.run({})],
  );
  expect(Program.plan.actions.map((action) => action.id)).toEqual(["B/action", "a/action"]);
  expect(PlanArtifact.validate(Program.plan).digest).toBe(Program.plan.digest);

  const LowerLive = Provider.provide(Lower, () => ({}), {
    implementationId: "lower-order",
    implementationVersion: "1",
  });
  const UpperLive = Provider.provide(Upper, () => ({}), {
    implementationId: "upper-order",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "canonical-order",
    flow: Program,
    pools: [
      Worker.pool("z-pool", { target: "typescript-bun", providers: [LowerLive] }),
      Worker.pool("A-pool", { target: "typescript-bun", providers: [UpperLive] }),
    ],
  });
  expect(deployment.manifest.pools.map((pool) => pool.id)).toEqual(["A-pool", "z-pool"]);
  expect(deployment.manifest.routes.map((route) => route.actionId)).toEqual(["B/action", "a/action"]);
});

test("artifact validation consumes a detached canonical snapshot instead of caller getters", () => {
  const Program = Flow.define<{}, {}>({ id: "test/Snapshot", version: 1 }, () => ({}));
  const mutable = JSON.parse(canonicalJson(Program.plan)) as Record<string, unknown>;
  let getRan = false;
  const hostile = new Proxy(mutable, {
    get(target, property, receiver) {
      getRan = true;
      return Reflect.get(target, property, receiver);
    },
  });
  const validated = PlanArtifact.validate(hostile);
  expect(getRan).toBe(false);
  mutable.flowId = "test/MutatedAfterValidation";
  expect(validated.flowId).toBe("test/Snapshot");
  expect(Object.isFrozen(validated)).toBe(true);
});

test("execution completion rejects failed node state instead of laundering it as success", () => {
  const Work = Action.define<{}, {}>({ id: "test/IllegalCompletion", version: 1 });
  const Program = Flow.define<{}, {}>(
    { id: "test/IllegalCompletionFlow", version: 1 },
    () => Work.run({}),
  );
  const Live = Provider.provide(Work, () => ({}), {
    implementationId: "illegal-completion",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "illegal-completion",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  store.initializeExecution("illegal-completion", Program.plan, deployment.manifest, {});
  const node = Program.plan.nodes[0];
  const claim = store.claimNode("illegal-completion", node.id, "worker", 1_000);
  if (claim.kind !== "claimed") throw new Error("expected claim");
  expect(store.commitFailure(
    "illegal-completion",
    node.id,
    "worker",
    claim.fencingToken,
    { kind: "defect", defect: { name: "Broken", message: "broken" } },
  )).toBe(true);
  expect(() => store.completeExecution("illegal-completion", {})).toThrow("non-successful durable node");
  expect(store.getExecution("illegal-completion").status).toBe("running");
  store.close();
});

test("the worker rejects expired leases and caller-widened capability grants before code runs", async () => {
  const Work = Action.define<{}, {}>({ id: "test/WorkerAuthority", version: 1 });
  const Program = Flow.define<{}, {}>({ id: "test/WorkerAuthorityFlow", version: 1 }, () => Work.run({}));
  let calls = 0;
  abstract class Compute extends Context { abstract run(): void }
  function workerAuthorityImplementation() { Compute.context().run(); return {}; }
  const Live = Provider.provideChecked(Work, workerAuthorityImplementation, {
    implementationId: "worker-authority",
    implementationVersion: "1",
    implementationContract: computeContract(Work.descriptor, "worker-authority", workerAuthorityImplementation),
    capabilities: ["Compute"],
  });
  const pool = Worker.pool("local", { target: "typescript-bun", providers: [Live] });
  const deployment = Deployment.build({ id: "worker-authority", flow: Program, pools: [pool] });
  const route = deployment.manifest.routes[0];
  const node = Program.plan.nodes[0];
  const worker = new LocalWorker(pool, deployment.manifest, deployment.providers);
  const invocation = {
    schemaVersion: 1 as const,
    executionId: "worker-authority",
    nodeId: node.id,
    attempt: 1,
    actionId: route.actionId,
    actionVersion: route.actionVersion,
    actionContractDigest: route.actionContractDigest,
    implementationDigest: route.implementationDigest,
    input: {},
    deadline: Date.now() + 10_000,
    downstreamIdempotencyKey: digest({ executionId: "worker-authority", nodeId: node.id }),
    capabilityGrant: ["Compute"],
    lease: { owner: "coordinator", expiresAt: Date.now() - 1 },
    fencingToken: 1,
    traceContext: {},
  };
  const expired = await worker.invoke(invocation);
  expect(expired.kind).toBe("defect");
  if (expired.kind === "defect") expect(expired.defect.name).toBe("LeaseExpired");
  expect(calls).toBe(0);

  const widened = await worker.invoke({
    ...invocation,
    capabilityGrant: ["Compute", "Network"],
    lease: { ...invocation.lease, expiresAt: Date.now() + 10_000 },
  });
  expect(widened.kind).toBe("defect");
  if (widened.kind === "defect") expect(widened.defect.name).toBe("ManifestVerificationDefect");
  expect(calls).toBe(0);
});

test("far-future persisted deadlines do not overflow the host timer", async () => {
  const Work = Action.define<{}, { ok: boolean }>({ id: "test/FarDeadline", version: 1 });
  const Program = Flow.define<{}, { ok: boolean }>(
    { id: "test/FarDeadlineFlow", version: 1 },
    () => Work.run({}),
  );
  const Live = Provider.provide(Work, async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return { ok: true };
  }, {
    implementationId: "far-deadline",
    implementationVersion: "1",
  });
  const deployment = Deployment.build({
    id: "far-deadline",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  const deadline = Date.now() + 2_147_483_647 + 60_000;
  expect(await new DurableExecutor(deployment, store).execute({}, {
    executionId: "far-deadline",
    deadline,
    leaseMs: 100,
  })).toEqual({ ok: true });
  store.close();
});

test("artifact encoding enforces the same size ceiling as artifact decoding", () => {
  const Program = Flow.define<{}, string>(
    { id: "test/OversizedArtifact", version: 1 },
    () => "x".repeat(2 * 1024 * 1024),
  );
  expect(() => PlanArtifact.encode(Program.plan)).toThrow("size limit exceeded");
});

test("a persisted deadline also bounds cache-free and Action-free execution", async () => {
  const Program = Flow.define<{}, { ok: boolean }>(
    { id: "test/ActionFreeDeadline", version: 1 },
    () => ({ ok: true }),
  );
  const deployment = Deployment.build({ id: "action-free-deadline", flow: Program, pools: [] });
  const store = new DurableStore();
  await expect(new DurableExecutor(deployment, store).execute({}, {
    executionId: "action-free-deadline",
    deadline: Date.now() - 1,
  })).rejects.toThrow("terminated with a defect");
  expect(store.getExecution("action-free-deadline").status).toBe("failed");
  store.close();
});

test("invalid trace metadata is rejected before it leaves a ghost execution", async () => {
  const Program = Flow.define<{}, {}>({ id: "test/TraceValidation", version: 1 }, () => ({}));
  const deployment = Deployment.build({ id: "trace-validation", flow: Program, pools: [] });
  const store = new DurableStore();
  await expect(new DurableExecutor(deployment, store).execute({}, {
    executionId: "invalid-trace",
    traceContext: { traceId: 42 } as unknown as Readonly<Record<string, string>>,
  })).rejects.toThrow("object of strings");
  expect(() => store.getExecution("invalid-trace")).toThrow("Unknown durable execution");
  store.close();
});

test("memo key callbacks cannot mutate input after its digest snapshot", async () => {
  const Work = Action.define<{ value: number }, { value: number }>({ id: "test/MemoInputSnapshot", version: 1 });
  const Program = Flow.define<{ value: number }, { value: number }>(
    { id: "test/MemoInputSnapshotFlow", version: 1 },
    (input) => Work.run({ value: input.value }),
  );
  let mutationRejected = false;
  const Live = Provider.provide(Work, ({ value }) => ({ value }), {
    implementationId: "memo-input-snapshot",
    implementationVersion: "1",
    reuse: {
      kind: "memo",
      scope: "test",
      generation: "v1",
      keyVersion: "v1",
      key(input) {
        try {
          (input as { value: number }).value = 999;
        } catch {
          mutationRejected = true;
        }
        return String(input.value);
      },
    },
  });
  const deployment = Deployment.build({
    id: "memo-input-snapshot",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  expect(await new DurableExecutor(deployment, store).execute(
    { value: 1 },
    { executionId: "memo-input-snapshot" },
  )).toEqual({ value: 1 });
  expect(mutationRejected).toBe(true);
  store.close();
});

test("authoring and deployment identities are snapshotted before callbacks or repeated reads", () => {
  const actionOptions = { id: "test/SnapshottedAction", version: 1 };
  const Work = Action.define<{}, {}>(actionOptions);
  actionOptions.id = "test/MutatedAction";
  const flowOptions = { id: "test/SnapshottedFlow", version: 1 };
  const Program = Flow.define<{}, {}>(flowOptions, () => {
    flowOptions.id = "test/MutatedFlow";
    return Work.run({});
  });
  expect(Program.plan.flowId).toBe("test/SnapshottedFlow");
  expect(Program.plan.requirements).toEqual(["test/SnapshottedAction"]);
  expect(PlanArtifact.validate(Program.plan).digest).toBe(Program.plan.digest);

  const Live = Provider.provide(Work, () => ({}), {
    implementationId: "snapshot-provider",
    implementationVersion: "1",
  });
  const pool = Worker.pool("local", { target: "typescript-bun", providers: [Live] });
  let poolReads = 0;
  const deploymentOptions = {
    id: "snapshot-deployment",
    flow: Program,
    get pools() {
      poolReads += 1;
      if (poolReads > 1) throw new Error("deployment pools were read more than once");
      return [pool];
    },
  };
  const deployment = Deployment.build(deploymentOptions);
  expect(poolReads).toBe(1);
  expect(deployment.manifest.deploymentId).toBe("snapshot-deployment");
});

test("authoring capture rejects hidden behavior and preserves __proto__ as durable data", async () => {
  let getterRan = false;
  const accessor = {} as Record<string, unknown>;
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get() { getterRan = true; return 1; },
  });
  expect(() => Flow.define<{}, unknown>(
    { id: "test/CapturedAccessor", version: 1 },
    () => accessor,
  )).toThrow("accessor or hidden property");
  expect(getterRan).toBe(false);

  const hidden = { visible: true };
  Object.defineProperty(hidden, "secret", { value: true, enumerable: false });
  expect(() => Flow.define<{}, unknown>(
    { id: "test/CapturedHidden", version: 1 },
    () => hidden,
  )).toThrow("accessor or hidden property");

  const protoData = JSON.parse('{"__proto__":{"safe":true}}') as { readonly __proto__: { readonly safe: boolean } };
  const Program = Flow.define<{}, typeof protoData>(
    { id: "test/CapturedProtoData", version: 1 },
    () => protoData,
  );
  const deployment = Deployment.build({ id: "captured-proto-data", flow: Program, pools: [] });
  const store = new DurableStore();
  const output = await new DurableExecutor(deployment, store).execute({}, { executionId: "captured-proto-data" });
  expect(Object.hasOwn(output, "__proto__")).toBe(true);
  expect(canonicalJson(output)).toBe('{"__proto__":{"safe":true}}');
  store.close();
});

test("cancelling one execution cannot prefix-match and abort another execution id", async () => {
  const Work = Action.define<{}, { executionId: string }>({ id: "test/CancelIdentity", version: 1 });
  const Program = Flow.define<{}, { executionId: string }>(
    { id: "test/CancelIdentityFlow", version: 1 },
    () => Work.run({}),
  );
  let startedCount = 0;
  let bothStarted = (): void => {};
  const bothStartedGate = new Promise<void>((resolve) => { bothStarted = resolve; });
  let releaseSecond = (): void => {};
  let secondAborted = false;
  const Live = Provider.provide(Work, (_input, { invocation, signal }) => new Promise((resolve) => {
    startedCount += 1;
    if (startedCount === 2) bothStarted();
    if (invocation.executionId === "a\0b") {
      releaseSecond = () => resolve({ executionId: invocation.executionId });
      signal.addEventListener("abort", () => { secondAborted = true; }, { once: true });
    }
  }), {
    implementationId: "cancel-identity",
    implementationVersion: "1",
    recovery: { mode: "repeatable", maxAttempts: 2 },
  });
  const deployment = Deployment.build({
    id: "cancel-identity",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })],
  });
  const store = new DurableStore();
  const executor = new DurableExecutor(deployment, store);
  const first = executor.execute({}, { executionId: "a", leaseMs: 20 });
  const second = executor.execute({}, { executionId: "a\0b", leaseMs: 20 });
  await bothStartedGate;
  executor.cancel("a");
  await expect(first).rejects.toBeInstanceOf(DurableExecutionCancelled);
  expect(secondAborted).toBe(false);
  releaseSecond();
  expect(await second).toEqual({ executionId: "a\0b" });
  store.close();
});
