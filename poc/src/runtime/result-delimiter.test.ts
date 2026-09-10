import { expect, test } from "bun:test";
import { __vsExecutionScope, __vsGet, __vsPerform, __vsPropagate, __vsResultScope, __vsResultScopeAsync, __vsRunResult, __vsRunResultAsync, type Resumable } from "./effect.ts";
import { Context, Layer } from "./layer.ts";
import { __vsInspectResult, __vsResultFailure as failure, __vsResultSuccess as success, type Result } from "./result.ts";
import { Panic } from "./panic.ts";

class Missing extends Error {}
abstract class Clock extends Context { abstract now(): number }

for (const asynchronous of [false, true]) test(`${asynchronous ? "async" : "sync"} cleanup forwarding delivers a raised answer inward before remaining cleanup`, async () => {
  const events: string[] = [];
  const primary = new Missing("body");
  const raised = new Error("cleanup answer");
  const around = __vsExecutionScope();
  const source = function* (): Resumable<Result<never, Missing>> {
    try { return success(yield* __vsPropagate(failure(primary), "body-failure")); }
    finally {
      try { yield* __vsPerform("cleanup", null, "cleanup-one"); }
      catch (error) { expect(error).toBe(raised); events.push("observed cleanup answer"); }
      yield* __vsPerform("cleanup", null, "cleanup-two");
      events.push("finished cleanup");
    }
  };
  const body = asynchronous
    ? __vsResultScopeAsync(async function* () { return yield* source(); }, around)
    : __vsResultScope(source, around);
  expect(await around(() => body.next())).toMatchObject({ done: false, value: { site: "cleanup-one" } });
  expect(await around(() => body.throw(raised))).toMatchObject({ done: false, value: { site: "cleanup-two" } });
  const completed = await around(() => body.next(undefined));
  expect(completed.done).toBe(true);
  if (!completed.done) throw new Error("cleanup did not complete");
  expect(__vsInspectResult(completed.value)).toEqual({ ok: false, error: primary });
  expect(events).toEqual(["observed cleanup answer", "finished cleanup"]);
});

for (const asynchronous of [false, true]) test(`${asynchronous ? "async" : "sync"} abandonment during cleanup drains remaining outer finalizers`, async () => {
  const events: string[] = [];
  const around = __vsExecutionScope();
  const source = function* () {
    try {
      try { return success(yield* __vsPropagate(failure(new Missing()), "fail")); }
      finally { yield* __vsPerform("cleanup", null, "cleanup"); events.push("after cleanup"); }
    } finally { events.push("outer finally"); }
  };
  const body = asynchronous
    ? __vsResultScopeAsync(async function* () { return yield* source(); }, around)
    : __vsResultScope(source, around);
  const first = await around(() => body.next());
  expect(first.done).toBe(false);
  expect(first.value).toMatchObject({ kind: "perform", site: "cleanup", occurrence: 0 });
  expect((await around(() => body.return(undefined as never))).done).toBe(true);
  expect(events).toEqual(["outer finally"]);
});

test("a Result delimiter completes only its own function, after finally", () => {
  const seen: string[] = [];
  const result = __vsRunResult(function* () {
    const inner = __vsRunResult(function* () {
      try { return success(yield* __vsPropagate(failure(new Missing()), "inner")); }
      finally { seen.push("inner finally"); }
    });
    seen.push(inner.isError() ? "handled" : "wrong");
    return success(42);
  });
  expect(result.unwrapOr(0)).toBe(42);
  expect(seen).toEqual(["inner finally", "handled"]);
});

test("async Result failure awaits async disposal and skips catch clauses", async () => {
  const seen: string[] = [];
  const result = await __vsRunResultAsync(async function* () {
    await using resource = {
      async [Symbol.asyncDispose]() { await Promise.resolve(); seen.push("disposed"); },
    };
    try {
      return success(yield* __vsPropagate(failure(new Missing("absent")), "async"));
    } catch {
      seen.push("caught");
      return success(0);
    } finally {
      await Promise.resolve();
      seen.push("finally");
    }
  });
  seen.push("returned");
  expect(result.isError()).toBe(true);
  expect(seen).toEqual(["finally", "disposed", "returned"]);
});

test("async Result bodies inherit independent provision scopes across await", async () => {
  const run = (value: number) => Layer.provide(Layer.succeed(Clock, { now: () => value }), async () => {
    return await __vsRunResultAsync(async function* () {
      await Promise.resolve();
      const clock = yield* __vsGet(Clock, "clock");
      return success(clock.now());
    });
  });
  const values = await Promise.all([run(1), run(2)]);
  expect(values.map(result => result.unwrapOr(0))).toEqual([1, 2]);
});

test("an async unhandled request disposes before rejecting", async () => {
  const seen: string[] = [];
  const run = __vsRunResultAsync(async function* () {
    await using resource = {
      async [Symbol.asyncDispose]() { await Promise.resolve(); seen.push("disposed"); },
    };
    return success((yield* __vsGet(Clock, "missing-clock")).now());
  });
  await expect(run).rejects.toBeInstanceOf(Panic);
  expect(seen).toEqual(["disposed"]);
});

test("async Result completion adopts a returned Promise on every host", async () => {
  const expected = success(42);
  const result = await __vsRunResultAsync(async function* () {
    return Promise.resolve(expected);
  });
  expect(result).toBe(expected);
});
