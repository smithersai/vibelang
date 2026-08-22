import { describe, expect, test } from "bun:test";
import {
  TypedWorker,
  WorkerCallTimeout,
  WorkerCrashed,
  WorkerProtocolError,
  WorkerTerminated,
} from "./worker.ts";
import { ValueCodecError } from "../runtime/wire.ts";
import { __vsErrorCases } from "../runtime/errors.ts";
import {
  __vsInspectResult,
  __vsResultFailure,
  __vsResultSuccess,
} from "../runtime/result.ts";
import { __vsOptionalNone, __vsOptionalSome } from "../runtime/optional.ts";
import { FixtureError } from "../../examples/concurrency/test-worker.ts";

type FixtureWorker = Pick<typeof import("../../examples/concurrency/test-worker.ts"),
  | "echo"
  | "reflectResult"
  | "reflectOptional"
  | "reflectError"
  | "fail"
  | "badOutput"
  | "delay"
  | "bounded"
  | "peakConcurrency"
  | "crash"
>;

const fixtureUrl = new URL("../../examples/concurrency/test-worker.ts", import.meta.url);

async function spawn(
  functions: readonly (keyof FixtureWorker & string)[],
  options: Omit<Parameters<typeof TypedWorker.spawn<FixtureWorker>>[1], "functions"> = {},
) {
  return await TypedWorker.spawn<FixtureWorker>(fixtureUrl, { ...options, functions });
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  return await promise.then(
    () => { throw new Error("expected promise to reject"); },
    (cause) => {
      if (!(cause instanceof Error)) throw new Error("promise rejected with a non-Error value");
      return cause;
    },
  );
}

describe("provisional typed workers", () => {
  test("round-trips plain data with null-prototype records and no prototype pollution", async () => {
    const worker = await spawn(["echo"]);
    try {
      const input = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(input, "__proto__", { value: { polluted: true }, enumerable: true });
      input.nested = { values: [1, true, "three", undefined] };
      const output = (await worker.echo(input)).unwrap() as Record<string, unknown>;

      expect(Object.getPrototypeOf(output)).toBeNull();
      expect(Object.getPrototypeOf(output.nested as object)).toBeNull();
      expect(output["__proto__"]).toEqual({ polluted: true });
      expect((Object.prototype as { polluted?: unknown }).polluted).toBeUndefined();
      expect(output.nested).toEqual({ values: [1, true, "three", undefined] });
    } finally {
      await worker.terminate();
    }
  });

  test("round-trips nested Result, Optional, and nominal Error values", async () => {
    const worker = await spawn(["reflectResult", "reflectOptional", "reflectError", "fail"]);
    try {
      const nested = (await worker.reflectResult(__vsResultFailure(new FixtureError("nested")))).unwrap();
      const nestedState = __vsInspectResult(nested);
      expect(nestedState.ok).toBe(false);
      if (nestedState.ok) throw new Error("expected nested failure");
      expect(nestedState.error.is(FixtureError)).toBe(true);

      const some = (await worker.reflectOptional(__vsOptionalSome("present"))).unwrap();
      const none = (await worker.reflectOptional(__vsOptionalNone())).unwrap();
      expect(some.unwrap()).toBe("present");
      expect(none.isNone()).toBe(true);

      const errorValue = (await worker.reflectError(new FixtureError("value"))).unwrap();
      expect(errorValue).toBeInstanceOf(FixtureError);
      expect(errorValue.match(__vsErrorCases(
        [FixtureError, (error) => error.code] as const,
      ))).toBe("value");

      const failure = __vsInspectResult(await worker.fail("channel"));
      expect(failure.ok).toBe(false);
      if (failure.ok) throw new Error("expected worker failure");
      expect(failure.error.is(FixtureError)).toBe(true);
      expect(failure.error.code).toBe("channel");
    } finally {
      await worker.terminate();
    }
  });

  test("rejects non-codec values in both directions and leaves the worker usable", async () => {
    const worker = await spawn(["echo", "badOutput"]);
    try {
      const inputFailure = await rejection(worker.echo(() => 1));
      expect(inputFailure).toBeInstanceOf(ValueCodecError);

      const outputFailure = await rejection(worker.badOutput(null));
      expect(outputFailure).toBeInstanceOf(ValueCodecError);

      expect((await worker.echo("still alive")).unwrap()).toBe("still alive");
    } finally {
      await worker.terminate();
    }
  });

  test("bounds worker calls and queues excess work", async () => {
    const worker = await spawn(["bounded", "peakConcurrency"], { maxConcurrency: 2 });
    try {
      const calls = Array.from({ length: 6 }, () => worker.bounded(20));
      const results = await Promise.all(calls);
      expect(results.every((result) => result.isOk())).toBe(true);
      expect((await worker.peakConcurrency(null)).unwrap()).toBe(2);
    } finally {
      await worker.terminate();
    }
  });

  test("applies wall-clock timeouts to active and queued calls", async () => {
    const worker = await spawn(["delay", "echo"], { maxConcurrency: 1, timeoutMs: 200 });
    try {
      const active = worker.delay({ milliseconds: 50, value: "first" });
      const queuedFailure = await rejection(worker.echo("queued", { timeoutMs: 5 }));
      expect(queuedFailure).toBeInstanceOf(WorkerCallTimeout);
      expect(queuedFailure.is(WorkerCallTimeout)).toBe(true);
      expect((await active).unwrap()).toBe("first");

      const activeFailure = await rejection(
        worker.delay({ milliseconds: 30, value: "late" }, { timeoutMs: 5 }),
      );
      expect(activeFailure).toBeInstanceOf(WorkerCallTimeout);
      await Bun.sleep(35);
      expect((await worker.echo("recovered")).unwrap()).toBe("recovered");
    } finally {
      await worker.terminate();
    }
  });

  test("rejects every outstanding call before explicit termination resolves", async () => {
    const worker = await spawn(["delay"], { maxConcurrency: 1 });
    const active = worker.delay({ milliseconds: 200, value: "active" });
    const queued = worker.delay({ milliseconds: 200, value: "queued" });
    await Bun.sleep(5);

    let activeSettled = false;
    let queuedSettled = false;
    void active.catch(() => { activeSettled = true; });
    void queued.catch(() => { queuedSettled = true; });
    await worker.terminate();

    expect(activeSettled).toBe(true);
    expect(queuedSettled).toBe(true);
    expect(await rejection(active)).toBeInstanceOf(WorkerTerminated);
    expect(await rejection(queued)).toBeInstanceOf(WorkerTerminated);
    const after = await rejection(worker.delay({ milliseconds: 1, value: "after" }));
    expect(after).toBeInstanceOf(WorkerTerminated);
    expect(after.is(WorkerTerminated)).toBe(true);
  });

  test("surfaces abnormal exit context as a nominal WorkerCrashed error", async () => {
    const worker = await spawn(["crash"]);
    const crash = await rejection(worker.crash(23));
    expect(crash).toBeInstanceOf(WorkerCrashed);
    expect(crash.is(WorkerCrashed)).toBe(true);
    if (!(crash instanceof WorkerCrashed)) throw new Error("expected WorkerCrashed");
    expect(crash.context.event).toBe("close");
    expect(crash.context.exitCode).toBe(23);
    expect(crash.context.moduleUrl).toBe(fixtureUrl.href);

    const after = await rejection(worker.crash(23));
    expect(after).toBe(crash);
    await worker.terminate();
  });

  test("enforces the configurable message-size bound before posting", async () => {
    const worker = await spawn(["echo"], { maxMessageBytes: 512 });
    try {
      const failure = await rejection(worker.echo("x".repeat(1_000)));
      expect(failure).toBeInstanceOf(WorkerProtocolError);
      expect((await worker.echo("small")).unwrap()).toBe("small");
    } finally {
      await worker.terminate();
    }
  });

  test("contains malformed, forged, flood, and prototype traffic from a hostile module", async () => {
    interface HostileContract { echo(input: string): string }
    const worker = await TypedWorker.spawn<HostileContract>(
      new URL("../../examples/concurrency/hostile-worker.ts", import.meta.url),
      { functions: ["echo"], maxMessageBytes: 2_048 },
    );
    try {
      expect((await worker.echo("private channel survived")).unwrap()).toBe("private channel survived");
      expect((Object.prototype as { workerRealmOnly?: unknown }).workerRealmOnly).toBeUndefined();
    } finally {
      await worker.terminate();
    }
  });

  test("fails closed when the requested export is absent", async () => {
    interface MissingContract { absent(input: null): string }
    const failure = await rejection(TypedWorker.spawn<MissingContract>(fixtureUrl, { functions: ["absent"] }));
    expect(failure).toBeInstanceOf(WorkerCrashed);
    expect(failure.message).toContain("does not export function absent");
  });

  test("round-trips successful Result input explicitly", async () => {
    const worker = await spawn(["reflectResult"]);
    try {
      const nested = (await worker.reflectResult(__vsResultSuccess({ ok: true }))).unwrap();
      expect(nested.unwrap()).toEqual({ ok: true });
    } finally {
      await worker.terminate();
    }
  });
});
