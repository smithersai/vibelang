import { describe, expect, test } from "bun:test";
import { Layer, __vsInspectResult, decodeError, encodeError } from "../runtime/index.ts";
import {
  Cancellation,
  CancellationRegistration,
  CancellationSource,
  Cancelled,
  alreadyCancelled,
  isCancellationRegistration,
  mapUnordered,
  neverCancelled,
} from "./index.ts";

describe("Cancellation capability", () => {
  test("is a Context capability with coherent Result and AbortSignal views", () => {
    const source = new CancellationSource();
    const supplied = Layer.provide(Layer.succeed(Cancellation, source), () => Cancellation.context());
    expect(supplied).toBe(source);
    expect(source).toBeInstanceOf(Cancellation);
    expect(source.isCancelled()).toBe(false);
    expect(source.signal).toBeInstanceOf(AbortSignal);
    expect(source.signal()).toBeInstanceOf(AbortSignal);

    expect(source.cancel("stop now")).toBe(true);
    expect(source.cancel("again")).toBe(false);
    expect(source.isCancelled()).toBe(true);
    const checkpoint = __vsInspectResult(source.checkpoint());
    expect(checkpoint.ok).toBe(false);
    if (!checkpoint.ok) expect(checkpoint.error).toBeInstanceOf(Cancelled);
  });

  test("onCancel runs once and its frozen disposal handle is idempotent and branded", () => {
    const source = new CancellationSource();
    const observed: string[] = [];
    const registration = source.onCancel((error) => observed.push(error.message));
    expect(Object.isFrozen(registration)).toBe(true);
    expect(isCancellationRegistration(registration)).toBe(true);
    expect(registration.active).toBe(true);

    source.cancel("observed");
    registration.dispose();
    registration.dispose();
    expect(registration.active).toBe(false);
    expect(observed).toEqual(["observed"]);

    const forged = Object.create(CancellationRegistration.prototype) as CancellationRegistration;
    expect(() => forged.dispose()).toThrow("forged CancellationRegistration");
  });

  test("a disposed handler is removed and listener failures are contained", () => {
    const source = new CancellationSource();
    let calls = 0;
    source.onCancel(() => { throw new Error("observer failure"); });
    const removed = source.onCancel(() => { calls += 1; });
    removed.dispose();
    expect(source.cancel()).toBe(true);
    expect(calls).toBe(0);
  });

  test("links AbortSignal cancellation and can unlink before it arrives", () => {
    const parent = new AbortController();
    const linked = new CancellationSource(parent.signal);
    parent.abort("host stop");
    expect(linked.isCancelled()).toBe(true);
    expect(() => linked.check()).toThrow("host stop");

    const other = new AbortController();
    const unlinked = new CancellationSource(other.signal);
    unlinked.unlink();
    other.abort("too late");
    expect(unlinked.isCancelled()).toBe(false);
  });

  test("already- and never-cancelled helpers are deterministic", () => {
    const stopped = alreadyCancelled("fixture stop");
    expect(stopped.isCancelled()).toBe(true);
    expect(() => stopped.check()).toThrow("fixture stop");

    const live = neverCancelled();
    expect(live.cancel("ignored")).toBe(false);
    expect(live.isCancelled()).toBe(false);
  });

  test("Cancelled keeps the join transport identity and strict wire codec", () => {
    const original = new Cancelled("wire stop");
    const decoded = decodeError(encodeError(original));
    expect(decoded).toBeInstanceOf(Cancelled);
    expect(decoded.message).toBe("wire stop");
  });

  test("CancellationSource flows through join.ts cancellation and instanceof checks", async () => {
    const source = new CancellationSource();
    const iteration = mapUnordered([1], async (_value, child) => {
      throw await child.whenCancelled();
    }, { concurrency: 1, cancellation: source });
    const next = iteration.next();
    source.cancel("joined stop");
    await expect(next).rejects.toBeInstanceOf(Cancelled);
  });
});
