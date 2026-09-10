import { describe, expect, test } from "bun:test";
import { __vsResultFailure as failure, __vsResultSuccess as success, Result, type Result as ResultType } from "./result.ts";
import { Panic } from "./panic.ts";
import { __vsRegisterError } from "./errors.ts";

class Missing extends Error {}
class Unavailable extends Error {}
__vsRegisterError(Missing, "result-operations:Missing@1");
__vsRegisterError(Unavailable, "result-operations:Unavailable@1");

describe("Result sequencing and recovery", () => {
  test("async sequencing forwards results and does not invoke a callback after failure", async () => {
    const failed = failure(new Missing("missing"));
    let called = false;
    expect(await failed.andThenAsync(async () => { called = true; return success(1); })).toBe(failed);
    expect(called).toBe(false);
    expect((await success(2).andThenAsync(async n => success(n * 3))).unwrapOr(0)).toBe(6);
    expect(await success(1).andThenAsync(async () => failed)).toBe(failed);
    await expect(success(1).andThenAsync(async () => ({} as ResultType<number, Missing>))).rejects.toBeInstanceOf(Panic);
  });

  test("fallible recovery replaces the failure row and forwards a returned Result", async () => {
    const original = failure(new Missing());
    const next = failure(new Unavailable());
    expect(original.tryRecover(() => next)).toBe(next);
    expect(original.recover(() => next)).toBe(next);
    expect(await original.tryRecoverAsync(async () => next)).toBe(next);
    expect((await original.tryRecoverAsync(async () => success(9))).unwrapOr(0)).toBe(9);
    expect(() => original.tryRecover(() => ({} as ResultType<number, Error>))).toThrow(Panic);
    await expect(original.tryRecoverAsync(async () => ({} as ResultType<number, Error>))).rejects.toBeInstanceOf(Panic);
  });

  test("ordinary recovery never invokes its callback on a panic", async () => {
    const original = failure(new Panic("defect"));
    let called = false;
    const recover = () => { called = true; return success(0); };
    expect(original.tryRecover(recover)).toBe(original);
    expect(await original.tryRecoverAsync(recover)).toBe(original);
    expect(called).toBe(false);
  });
});

test("async observers await the selected branch and preserve Result identity", async () => {
  const seen: string[] = [];
  const ok = success(4);
  const error = failure(new Missing("missing"));
  expect(await ok.tapAsync(async n => { await Promise.resolve(); seen.push(`ok:${n}`); })).toBe(ok);
  expect(await error.tapAsync(async () => { seen.push("wrong"); })).toBe(error);
  expect(await error.tapErrorAsync(async e => { await Promise.resolve(); seen.push(e.message); })).toBe(error);
  expect(await ok.tapErrorAsync(async () => { seen.push("wrong"); })).toBe(ok);
  const handlers = {
    ok: async (n: number) => { await Promise.resolve(); seen.push(`both:${n}`); },
    error: async (e: Error) => { await Promise.resolve(); seen.push(`both:${e.message}`); },
  };
  expect(await ok.tapBothAsync(handlers)).toBe(ok);
  expect(await error.tapBothAsync(handlers)).toBe(error);
  expect(seen).toEqual(["ok:4", "missing", "both:4", "both:missing"]);
  await expect(ok.tapBothAsync({ ok() {} } as never)).rejects.toBeInstanceOf(Panic);
});

describe("Result collections", () => {
  test("allAsync joins siblings and chooses the first error by input order", async () => {
    const first = new Missing("first");
    const second = new Unavailable("second");
    let finish!: (value: ResultType<number, Missing>) => void;
    const pending = new Promise<ResultType<number, Missing>>(resolve => { finish = resolve; });
    let completed = false;
    const joined = Result.allAsync([pending, failure(second)]).then(value => { completed = true; return value; });
    await Promise.resolve();
    expect(completed).toBe(false);
    finish(failure(first));
    expect((await joined).match({ ok: () => undefined, error: e => e })).toBe(first);
    expect((await Result.allAsync([success(1), Promise.resolve(success("two"))])).unwrapOr([])).toEqual([1, "two"]);
  });

  test("partition keeps order and never turns a panic into a domain error array", async () => {
    const missing = new Missing("missing");
    expect(Result.partition([success(1), failure(missing), success(2)])).toEqual([[1, 2], [missing]]);
    expect(await Result.partitionAsync([Promise.resolve(success(1)), failure(missing), success(2)])).toEqual([[1, 2], [missing]]);
    const defect = new Panic("defect");
    expect(() => Result.partition([failure(defect)])).toThrow(defect);
    await expect(Result.partitionAsync([failure(defect)])).rejects.toBe(defect);
    await expect(Result.allAsync([Promise.reject(new Error("foreign"))])).rejects.toBeInstanceOf(Panic);
    await expect(Result.partitionAsync([{} as ResultType<number, Error>])).rejects.toBeInstanceOf(Panic);
  });

  test("async collections join the submitted prefix when an input iterator throws", async () => {
    for (const collect of [
      (values: Iterable<Promise<ResultType<number, Error>>>) => Result.allAsync(values),
      (values: Iterable<Promise<ResultType<number, Error>>>) => Result.partitionAsync(values),
    ]) {
      let finish!: (result: ResultType<number, Error>) => void;
      const pending = new Promise<ResultType<number, Error>>(resolve => { finish = resolve; });
      const defect = new Panic("iterator failed");
      function* inputs() {
        yield pending;
        throw defect;
      }
      let completed = false;
      const joined = collect(inputs()).then(
        () => { completed = true; return undefined; },
        error => { completed = true; return error; },
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(completed).toBe(false);
      finish(success(1));
      expect(await joined).toBe(defect);
    }
  });
});

test("Result.codec uses the canonical wire and snapshots the permitted nominal error row", () => {
  const allowed = [Missing];
  const codec = Result.codec({
    encode: (n: number) => n,
    decode: value => { if (typeof value !== "number") throw new TypeError("expected number"); return value; },
  }, allowed);
  allowed.push(Unavailable);
  expect(codec.decode(codec.encode(success(42))).unwrapOr(0)).toBe(42);
  expect(codec.decode(codec.encode(failure(new Missing("missing")))).isError()).toBe(true);
  expect(() => codec.decode(codec.encode(failure(new Unavailable())))).toThrow("outside its declared channel");
  expect(Object.isFrozen(codec)).toBe(true);
});
