import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript-js";
import { checkEmittedTypeScript } from "../language/validate.ts";
import {
  __vsGet,
  __vsPerform,
  __vsPropagate,
  __vsProvide,
  __vsProvideRoot,
  capabilityHandler,
  handle,
  resultFrame,
  runHandled,
  type AnyRequest,
  type DispatchedRequest,
  type EffectRow,
  type Handler,
  type RequestKind,
  type Resumable,
} from "./effect.ts";
import { __vsRegisterError, decodeError, encodeError } from "./errors.ts";
import { Context, Layer, useCapability } from "./layer.ts";
import { Panic, isPanic, panic } from "./panic.ts";
import { __vsResultFailure, __vsResultSuccess, isResult, type Result } from "./result.ts";

class Clock extends Context {
  now(): number {
    return 1234;
  }
}

class Rates extends Context {
  rate(): number {
    return 2;
  }
}

class QuoteError extends Error {
  constructor(readonly reason: string) {
    super(`quote failed: ${reason}`);
    this.name = "QuoteError";
  }
}

class OtherError extends Error {}

const ROW: EffectRow = { failures: [QuoteError], capabilities: [Clock, Rates] };
const CAPS_ONLY: EffectRow = { failures: [], capabilities: [Clock] };

class Tracked {
  constructor(
    private readonly log: string[],
    private readonly name: string,
  ) {
    log.push(`acquire ${name}`);
  }
  [Symbol.dispose](): void {
    this.log.push(`dispose ${this.name}`);
  }
}

/** A handler that records everything it is offered. */
function recording<B>(
  accepts: (request: DispatchedRequest) => boolean,
  answer: (request: DispatchedRequest, k: Parameters<Handler<B>["answer"]>[1]) => void,
): Handler<B> & { readonly offered: DispatchedRequest[]; readonly answered: DispatchedRequest[] } {
  const offered: DispatchedRequest[] = [];
  const answered: DispatchedRequest[] = [];
  return {
    offered,
    answered,
    accepts(request) {
      offered.push(request);
      return accepts(request);
    },
    answer(request, k) {
      answered.push(request);
      answer(request, k);
    },
  };
}

function expectPanic(body: () => unknown): Panic {
  try {
    body();
  } catch (error) {
    if (isPanic(error)) return error;
    throw error;
  }
  throw new Error("expected a panic, and nothing was thrown");
}

// ---------------------------------------------------------------------------
// PROPERTY 1 — handler nesting: the innermost handler that accepts a key wins.
// specification/effects.mdx §Handlers.
// ---------------------------------------------------------------------------

describe("handler nesting", () => {
  test("the innermost handler answering a key is the one that answers it", () => {
    const answeredBy: string[] = [];
    const outer = recording<never>(
      () => true,
      (_request, k) => {
        answeredBy.push("outer");
        k.resume(new Clock());
      },
    );
    const inner = recording<never>(
      () => true,
      (_request, k) => {
        answeredBy.push("inner");
        k.resume(new Clock());
      },
    );

    function* body(): Resumable<number> {
      const clock = yield* __vsGet(Clock, "src-nest-0");
      return clock.now();
    }

    const value = runHandled(
      () => handle(outer, () => handle(inner, body)),
      { row: CAPS_ONLY },
    );

    expect(value).toBe(1234);
    expect(answeredBy).toEqual(["inner"]);
    // The outer handler was never even consulted: the request never reached it.
    expect(outer.offered).toHaveLength(0);
    expect(inner.answered).toHaveLength(1);
  });

  test("a handler that does not accept a key forwards the request outward unchanged", () => {
    const outer = recording<never>(
      (request) => request.key === Rates,
      (_request, k) => k.resume(new Rates()),
    );
    const inner = recording<never>(
      (request) => request.key === Clock,
      (_request, k) => k.resume(new Clock()),
    );

    function* body(): Resumable<number> {
      const clock = yield* __vsGet(Clock, "src-fwd-0");
      const rates = yield* __vsGet(Rates, "src-fwd-1");
      return clock.now() * rates.rate();
    }

    const value = runHandled(
      () => handle(outer, () => handle(inner, body)),
      { row: { failures: [], capabilities: [Clock, Rates] } },
    );

    expect(value).toBe(2468);
    // The inner handler saw both; it forwarded the one it does not accept.
    expect(inner.offered.map((r) => r.site)).toEqual(["src-fwd-0", "src-fwd-1"]);
    expect(inner.answered.map((r) => r.site)).toEqual(["src-fwd-0"]);
    expect(outer.offered.map((r) => r.site)).toEqual(["src-fwd-1"]);
    // "unchanged" is literal: same object, same dispatch index.
    expect(Object.is(outer.offered[0], inner.offered[1])).toBe(true);
    expect(outer.offered[0]?.occurrence).toBe(1);
  });

  test("the occurrence index is assigned at dispatch, in program order, once", () => {
    const seen: number[] = [];
    const handler = recording<never>(
      () => true,
      (request, k) => {
        seen.push(request.occurrence);
        k.resume(new Clock());
      },
    );

    function* body(): Resumable<number> {
      const a = yield* __vsGet(Clock, "src-occ-0");
      const b = yield* __vsGet(Clock, "src-occ-1");
      const c = yield* __vsGet(Clock, "src-occ-2");
      return a.now() + b.now() + c.now();
    }

    runHandled(() => handle(handler, body), { row: CAPS_ONLY });
    expect(seen).toEqual([0, 1, 2]);
  });

  test("a request no handler accepts panics at the top of the program", () => {
    const handler = recording<never>(
      (request) => request.key === Rates,
      (_request, k) => k.resume(new Rates()),
    );

    function* body(): Resumable<number> {
      const clock = yield* __vsGet(Clock, "src-unhandled-0");
      return clock.now();
    }

    const failure = expectPanic(() => runHandled(() => handle(handler, body), { row: CAPS_ONLY }));
    expect(failure.message).toContain("no handler accepted a get request at src-unhandled-0");
  });

  test("Layer.provide's lowering shape: a capability handler answers its own keys and forwards the rest", () => {
    const clock = new Clock();
    const rates = new Rates();
    const inner = capabilityHandler<never>(new Map([[Clock, clock]]));
    const outer = capabilityHandler<never>(new Map([[Rates, rates]]));

    function* body(): Resumable<number> {
      const c = yield* __vsGet(Clock, "src-layer-0");
      const r = yield* __vsGet(Rates, "src-layer-1");
      return c.now() * r.rate();
    }

    const value = runHandled(
      () => handle(outer, () => handle(inner, body)),
      { row: { failures: [], capabilities: [Clock, Rates] } },
    );
    expect(value).toBe(2468);
  });
});

// ---------------------------------------------------------------------------
// PROPERTY 2 — one-shot: a second resumption is refused, not silently reused.
// specification/effects.mdx §One-Shot Delimited Continuations.
// ---------------------------------------------------------------------------

describe("one-shot continuations", () => {
  function* twoStep(log: string[]): Resumable<number> {
    const clock = yield* __vsGet(Clock, "src-oneshot-0");
    log.push(`resumed with ${clock.now()}`);
    return clock.now();
  }

  test("a second resumption inside the handler is an invariant failure", () => {
    const log: string[] = [];
    const handler: Handler<never> = {
      accepts: () => true,
      answer: (_request, k) => {
        k.resume(new Clock());
        k.resume(new Clock());
      },
    };

    const failure = expectPanic(() =>
      runHandled(() => handle(handler, () => twoStep(log)), { row: CAPS_ONLY }),
    );
    expect(failure.message).toContain("resumed more than once");
    // The refusal happened before the body ran again, not after.
    expect(log).toEqual([]);
  });

  test("a continuation stashed and resumed after its frame moved on is refused", () => {
    let stashed: { resume(answer: unknown): void } | undefined;
    const log: string[] = [];
    const handler: Handler<never> = {
      accepts: () => true,
      answer: (_request, k) => {
        stashed = k;
        k.resume(new Clock());
      },
    };

    const value = runHandled(() => handle(handler, () => twoStep(log)), { row: CAPS_ONLY });
    expect(value).toBe(1234);
    expect(log).toEqual(["resumed with 1234"]);

    const failure = expectPanic(() => stashed?.resume(new Clock()));
    expect(failure.message).toContain("no longer live");
    // Nothing ran a second time.
    expect(log).toEqual(["resumed with 1234"]);
  });

  test("a continuation the handler declined is not resumable afterwards", () => {
    // A `perform`, because §Effect Requests lets only that kind be declined.
    function* performing(): Resumable<number> {
      return yield* __vsPerform<number>("effect", undefined, "src-oneshot-1");
    }
    let stashed: { resume(answer: unknown): void } | undefined;
    const handler: Handler<string> = {
      accepts: () => true,
      answer: (_request, k) => {
        stashed = k;
        k.abandon("declined");
      },
    };

    const value = runHandled(() => handle(handler, performing), { row: CAPS_ONLY });
    expect(value).toBe("declined" as unknown as number);
    const failure = expectPanic(() => stashed?.resume(new Clock()));
    expect(failure.message).toContain("no longer live");
  });

  test("a handler that neither answers nor declines is an invariant failure", () => {
    const handler: Handler<never> = {
      accepts: () => true,
      answer: () => {},
    };
    const failure = expectPanic(() =>
      runHandled(() => handle(handler, () => twoStep([])), { row: CAPS_ONLY }),
    );
    expect(failure.message).toContain("neither answered nor declined");
  });

  test("THE FAIL-OPEN THIS REFUSES: a bare generator silently absorbs a second resumption", () => {
    // Without the one-shot guard the second resumption is not an error at all:
    // a completed generator answers `next()` with `{ done: true, value:
    // undefined }`. Nothing throws, and a handler that resumed twice would
    // simply get `undefined` back. This is what the guard is preventing.
    function* plain(): Generator<number, string, unknown> {
      const x = yield 1;
      return String(x);
    }
    const gen = plain();
    gen.next();
    expect(gen.next("first")).toEqual({ done: true, value: "first" });
    const second: IteratorResult<number, string | undefined> = gen.next("second");
    expect(second.done).toBe(true);
    expect(second.value).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PROPERTY 3 — `using` disposal on an abandoned continuation.
// specification/effects.mdx §Abandonment.
// ---------------------------------------------------------------------------

describe("abandonment disposes an abandoned continuation", () => {
  function* guarded(log: string[]): Resumable<number> {
    using _outer = new Tracked(log, "outer");
    try {
      using _inner = new Tracked(log, "inner");
      const value = yield* __vsPerform<number>("effect", undefined, "src-abandon-0");
      log.push("after the request");
      return value;
    } catch {
      log.push("catch ran");
      return -1;
    } finally {
      log.push("finally ran");
    }
  }

  test("every live using scope is disposed in reverse acquisition order, finally runs, catch does not", () => {
    const log: string[] = [];
    const handler: Handler<string> = {
      accepts: () => true,
      answer: (_request, k) => {
        k.abandon("handler result");
        log.push("handler produced its result");
      },
    };

    const value = runHandled(
      () => handle(handler, () => guarded(log)),
      { row: { failures: [], capabilities: [Clock] } },
    );

    expect(value).toBe("handler result" as unknown as number);
    expect(log).toEqual([
      "acquire outer",
      "acquire inner",
      "dispose inner",
      "finally ran",
      "dispose outer",
      // §Abandonment: the unwind happens BEFORE the handler's own result.
      "handler produced its result",
    ]);
    expect(log).not.toContain("catch ran");
    expect(log).not.toContain("after the request");
  });

  test("abandonment reaches through an intervening handler frame", () => {
    const log: string[] = [];
    // The inner handler forwards; the outer one declines. The inner frame is
    // itself suspended at a `yield`, and must still unwind the body it delimits.
    const inner: Handler<never> = { accepts: () => false, answer: () => panic("unreachable") };
    const outer: Handler<string> = {
      accepts: () => true,
      answer: (_request, k) => k.abandon("outer declined"),
    };

    const value = runHandled(
      () => handle(outer, () => handle(inner, () => guarded(log))),
      { row: { failures: [], capabilities: [Clock] } },
    );

    expect(value).toBe("outer declined" as unknown as number);
    expect(log).toEqual(["acquire outer", "acquire inner", "dispose inner", "finally ran", "dispose outer"]);
  });

  test("a request issued while the computation is being abandoned is refused, not dropped", () => {
    // `gen.return()` does not complete a generator whose `finally` yields: it
    // honours the yield and leaves the computation suspended. Dropping that
    // request would leave an abandoned computation live and holding resources.
    const log: string[] = [];
    function* yieldingFinally(): Resumable<number> {
      try {
        return yield* __vsPerform<number>("effect", undefined, "src-unwind-0");
      } finally {
        log.push("finally entered");
        yield* __vsPerform<number>("cleanup", undefined, "src-unwind-1");
        log.push("finally completed");
      }
    }
    const handler: Handler<string> = {
      accepts: () => true,
      answer: (_request, k) => k.abandon("declined"),
    };
    const failure = expectPanic(() =>
      runHandled(() => handle(handler, yieldingFinally), {
        row: { failures: [], capabilities: [Clock] },
      }),
    );
    expect(failure.message).toContain("issued while its computation was being abandoned");
    expect(log).toEqual(["finally entered"]);
  });

  test("an abandoned computation that acquired nothing still runs its finally", () => {
    const log: string[] = [];
    function* bare(): Resumable<number> {
      try {
        return yield* __vsPerform<number>("effect", undefined, "src-abandon-1");
      } finally {
        log.push("finally ran");
      }
    }
    const handler: Handler<string> = {
      accepts: () => true,
      answer: (_request, k) => k.abandon("declined"),
    };
    runHandled(() => handle(handler, bare), { row: { failures: [], capabilities: [Clock] } });
    expect(log).toEqual(["finally ran"]);
  });
});

// ---------------------------------------------------------------------------
// PROPERTY 4 — the next / throw / return resumption ABI.
// ---------------------------------------------------------------------------

describe("the resumption ABI", () => {
  function* observer(log: string[]): Resumable<string> {
    using _resource = new Tracked(log, "resource");
    try {
      const value = yield* __vsPerform<string>("effect", undefined, "src-abi-0");
      log.push(`resumed with ${value}`);
      return value;
    } catch (error) {
      log.push(`catch saw ${(error as Error).message}`);
      return "recovered";
    } finally {
      log.push("finally ran");
    }
  }

  const run = (answer: (k: Parameters<Handler<string>["answer"]>[1]) => void, log: string[]): string =>
    runHandled(
      () =>
        handle<string, string>(
          { accepts: () => true, answer: (_request, k) => answer(k) },
          () => observer(log),
        ),
      { row: { failures: [], capabilities: [Clock] } },
    );

  test("resume(a) is gen.next(a): the request's answer, no catch", () => {
    const log: string[] = [];
    expect(run((k) => k.resume("answered"), log)).toBe("answered");
    expect(log).toEqual([
      "acquire resource",
      "resumed with answered",
      "finally ran",
      "dispose resource",
    ]);
  });

  test("raise(e) is gen.throw(e): the body's catch clause RUNS", () => {
    const log: string[] = [];
    expect(run((k) => k.raise(new Error("host blew up")), log)).toBe("recovered");
    expect(log).toEqual([
      "acquire resource",
      "catch saw host blew up",
      "finally ran",
      "dispose resource",
    ]);
  });

  test("abandon(r) is gen.return(): catch is SKIPPED, finally and using still run", () => {
    const log: string[] = [];
    expect(run((k) => k.abandon("declined"), log)).toBe("declined");
    expect(log).toEqual(["acquire resource", "finally ran", "dispose resource"]);
    expect(log.join("|")).not.toContain("catch saw");
  });

  test("raise refuses to deliver a panic into a suspended computation", () => {
    const log: string[] = [];
    const failure = expectPanic(() => run((k) => k.raise(new Panic("smuggled")), log));
    expect(failure.message).toContain("a panic cannot be delivered into a suspended computation");
    // The body's catch never saw it.
    expect(log.join("|")).not.toContain("catch saw");
    // ...and the suspended body was still unwound.
    expect(log).toEqual(["acquire resource", "finally ran", "dispose resource"]);
  });

  test("a get request MUST be resumed: declining one is an invariant failure", () => {
    function* body(): Resumable<number> {
      const clock = yield* __vsGet(Clock, "src-abi-1");
      return clock.now();
    }
    const failure = expectPanic(() =>
      runHandled(
        () => handle<number, number>({ accepts: () => true, answer: (_r, k) => k.abandon(0) }, body),
        { row: CAPS_ONLY },
      ),
    );
    expect(failure.message).toContain("a capability read was not answered");
  });

  test("raise is delivered through a frame that forwarded the request", () => {
    // The `catch` column of the ABI table is a promise at every nesting depth,
    // and it was true only at depth 1: a forwarding frame re-threw the outer
    // handler's `raise` instead of delivering it inward, so the body's `catch`
    // was skipped and the error escaped `runHandled` as a host exception. That
    // made recovery depend on handler nesting depth. Abandonment is already
    // pinned through a frame above; this is the same pin for `raise`.
    const log: string[] = [];
    const passthrough: Handler<never> = { accepts: () => false, answer: () => {} };
    const value = runHandled(
      () =>
        handle<string, string>(
          { accepts: () => true, answer: (_r, k) => k.raise(new Error("host blew up")) },
          () => handle(passthrough, () => observer(log)),
        ),
      { row: { failures: [], capabilities: [Clock] } },
    );
    expect(value).toBe("recovered");
    expect(log).toEqual([
      "acquire resource",
      "catch saw host blew up",
      "finally ran",
      "dispose resource",
    ]);
  });

  test("a forwarding frame still lets a panic unwind past rather than delivering it", () => {
    // The catch arm that fixes forwarding must not become a way to hand a
    // suspended body a panic to swallow — §Panic Is Not a Request.
    const log: string[] = [];
    const passthrough: Handler<never> = { accepts: () => false, answer: () => {} };
    const failure = expectPanic(() =>
      runHandled(
        () =>
          handle<string, string>(
            { accepts: () => true, answer: () => panic("outer handler gave up") },
            () => handle(passthrough, () => observer(log)),
          ),
        { row: { failures: [], capabilities: [Clock] } },
      ),
    );
    expect(failure.message).toContain("outer handler gave up");
    expect(log.join("|")).not.toContain("catch saw");
    expect(log).toEqual(["acquire resource", "finally ran", "dispose resource"]);
  });

  test("an abort request MUST NOT be resumed: resuming one is an invariant failure", () => {
    function* body(): Resumable<Result<number, QuoteError>> {
      const value = yield* __vsPropagate(
        __vsResultFailure(new QuoteError("nope")) as Result<number, QuoteError>,
        "src-abi-2",
      );
      return __vsResultSuccess(value);
    }
    const failure = expectPanic(() =>
      runHandled(
        () =>
          handle<Result<number, QuoteError>, never>(
            { accepts: (r) => r.kind === "abort", answer: (_r, k) => k.resume(1) },
            body,
          ),
        { row: ROW },
      ),
    );
    expect(failure.message).toContain("a failure propagation was resumed");
  });
});

// ---------------------------------------------------------------------------
// PROPERTY 4b — the decision x kind matrix, every one of the nine cells.
//
// §Effect Requests' kind table constrains the resumption, not the request, so
// the obligation is a relation between a request's kind and the arm of the ABI
// a handler chose. Two `if`s used to cover four cells and silently admit the
// five they did not name; the `raise` x `abort` hole let a handler re-enter an
// aborted computation through its catch clause and complete it successfully,
// swallowing a declared failure that §Effect Requests says MUST NOT be resumed.
// Every cell is asserted here, permitted ones included, so a table that loses a
// row goes red instead of going quiet.
// ---------------------------------------------------------------------------

describe("the decision x kind matrix", () => {
  type Arm = "resume" | "raise" | "abandon";

  /** Issues exactly one request of `kind`, and would recover in its own catch. */
  function bodyFor(kind: RequestKind, log: string[]): () => Resumable<Result<string, QuoteError>> {
    return function* body(): Resumable<Result<string, QuoteError>> {
      try {
        if (kind === "get") {
          const clock = yield* __vsGet(Clock, "src-matrix-0");
          log.push(`resumed ${clock.now()}`);
        } else if (kind === "perform") {
          log.push(`resumed ${yield* __vsPerform<string>("effect", undefined, "src-matrix-1")}`);
        } else {
          yield* __vsPropagate(
            __vsResultFailure(new QuoteError("declared")) as Result<string, QuoteError>,
            "src-matrix-2",
          );
          log.push("resumed an abort");
        }
      } catch {
        log.push("catch ran");
        return __vsResultSuccess("swallowed the declared failure");
      }
      return __vsResultSuccess("completed");
    };
  }

  function cell(kind: RequestKind, arm: Arm): { readonly refusal: string | undefined; readonly log: string[] } {
    const log: string[] = [];
    const handler: Handler<Result<string, QuoteError>> = {
      accepts: (request) => request.kind === kind,
      answer: (_request, k) => {
        if (arm === "resume") k.resume(kind === "get" ? new Clock() : "answered");
        else if (arm === "raise") k.raise(new Error("injected"));
        else k.abandon(__vsResultFailure(new QuoteError("declined")) as Result<string, QuoteError>);
      },
    };
    try {
      runHandled(() => handle(handler, bodyFor(kind, log)), { row: ROW });
      return { refusal: undefined, log };
    } catch (error) {
      if (!isPanic(error)) throw error;
      return { refusal: error.message, log };
    }
  }

  const CAPABILITY_READ = "a capability read was not answered";
  const FAILURE_RESUMED = "a failure propagation was resumed";

  const CELLS: readonly (readonly [RequestKind, Arm, string | undefined])[] = [
    // "the handler MUST resume with the capability instance".
    ["get", "resume", undefined],
    ["get", "raise", CAPABILITY_READ],
    ["get", "abandon", CAPABILITY_READ],
    // "the handler MUST resume with the answer, or MUST NOT resume". `raise` is
    // neither, and is admitted as the host exception channel — question Q-E,
    // recorded rather than settled. It cannot swallow a declared failure:
    // a declared failure only ever travels as an `abort`.
    ["perform", "resume", undefined],
    ["perform", "raise", undefined],
    ["perform", "abandon", undefined],
    // "the handler MUST NOT resume". `raise` IS a resumption.
    ["abort", "resume", FAILURE_RESUMED],
    ["abort", "raise", FAILURE_RESUMED],
    ["abort", "abandon", undefined],
  ];

  for (const [kind, arm, refusal] of CELLS) {
    const verdict = refusal === undefined ? "is permitted" : `is refused: ${refusal}`;
    test(`${arm} on a ${kind} request ${verdict}`, () => {
      const outcome = cell(kind, arm);
      expect(outcome.refusal).toBe(refusal);
    });
  }

  test("raise on an abort cannot swallow the declared failure it was answering", () => {
    // The failure this pins: before 2026-08-28 this cell was permitted, the
    // aborted computation resumed through its catch clause, and `runHandled`
    // returned an OK Result carrying "swallowed the declared failure".
    const outcome = cell("abort", "raise");
    expect(outcome.refusal).toBe(FAILURE_RESUMED);
    expect(outcome.log).not.toContain("catch ran");
    expect(outcome.log).not.toContain("resumed an abort");
  });

  test("THE MATRIX IS NOT VACUOUS: the permitted cells really do run the body", () => {
    expect(cell("get", "resume").log).toEqual(["resumed 1234"]);
    expect(cell("perform", "resume").log).toEqual(["resumed answered"]);
    expect(cell("perform", "raise").log).toEqual(["catch ran"]);
    expect(cell("perform", "abandon").log).toEqual([]);
    expect(cell("abort", "abandon").log).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PROPERTY 5 — a panic unwinds PAST every handler.
// specification/effects.mdx §Panic Is Not a Request.
// ---------------------------------------------------------------------------

describe("panic is not a request", () => {
  /** A handler that claims every key and would answer anything it is offered. */
  const greedy = (): Handler<string> & { readonly offered: DispatchedRequest[] } =>
    recording<string>(
      () => true,
      (_request, k) => k.resume("intercepted"),
    );

  test("a panic in the body escapes every enclosing handler", () => {
    const log: string[] = [];
    const outer = greedy();
    const inner = greedy();

    function* body(): Resumable<number> {
      using _resource = new Tracked(log, "resource");
      panic("body invariant failed");
    }

    const failure = expectPanic(() =>
      runHandled(() => handle(outer, () => handle(inner, body)), {
        row: { failures: [], capabilities: [Clock] },
      }),
    );
    expect(failure.message).toContain("body invariant failed");
    // Neither handler was offered the panic — or anything else.
    expect(inner.offered).toHaveLength(0);
    expect(outer.offered).toHaveLength(0);
    // The body's disposal still ran on the way out.
    expect(log).toEqual(["acquire resource", "dispose resource"]);
  });

  test("a panic raised after a request has been answered still escapes both handlers", () => {
    const outer = greedy();
    const inner = greedy();

    function* body(): Resumable<number> {
      const value = yield* __vsPerform<string>("effect", undefined, "src-panic-0");
      panic(`after ${value}`);
    }

    const failure = expectPanic(() =>
      runHandled(() => handle(outer, () => handle(inner, body)), {
        row: { failures: [], capabilities: [Clock] },
      }),
    );
    expect(failure.message).toContain("after intercepted");
    // The inner handler answered the request, and was never offered the panic.
    expect(inner.offered).toHaveLength(1);
    expect(inner.offered[0]?.kind).toBe("perform");
    expect(outer.offered).toHaveLength(0);
  });

  test("a panic raised inside a handler unwinds the computation it suspended", () => {
    const log: string[] = [];
    function* body(): Resumable<number> {
      using _resource = new Tracked(log, "resource");
      return yield* __vsPerform<number>("effect", undefined, "src-panic-1");
    }
    const handler: Handler<never> = {
      accepts: () => true,
      answer: () => panic("handler invariant failed"),
    };
    const failure = expectPanic(() =>
      runHandled(() => handle(handler, body), { row: { failures: [], capabilities: [Clock] } }),
    );
    expect(failure.message).toContain("handler invariant failed");
    expect(log).toEqual(["acquire resource", "dispose resource"]);
  });

  test("QUESTION Q-F, MEASURED: a yielding finally hides a panic from the runtime", () => {
    // The one place the runtime cannot keep its side of §Panic Is Not a
    // Request. A `yield` inside a `finally` suspends the in-flight throw: the
    // driver sees an ordinary request with the panic held by the engine, and a
    // handler that declines discards it. Pinned as measured behaviour, not
    // papered over — closing it needs a static rule about what a `finally` may
    // contain, and specification/effects.mdx states none.
    const handler = recording<string>(
      () => true,
      (_request, k) => k.abandon("the panic was swallowed here"),
    );
    function* body(): Resumable<number> {
      try {
        panic("this panic must reach the top, and does not");
      } finally {
        yield* __vsPerform<number>("cleanup", undefined, "src-qf-0");
      }
    }
    const value = runHandled(() => handle(handler, body), {
      row: { failures: [], capabilities: [Clock] },
    });
    expect(value).toBe("the panic was swallowed here" as unknown as number);
    expect(handler.answered).toHaveLength(1);
    expect(handler.answered[0]?.site).toBe("src-qf-0");

    // And the companion fact that bounds the hole: a handler that *resumes*
    // cannot swallow it. The panic resumes propagating the moment the finally
    // completes, so only a declining handler loses it.
    const resuming = recording<string>(
      () => true,
      (_request, k) => k.resume(0),
    );
    const failure = expectPanic(() =>
      runHandled(() => handle(resuming, body), { row: { failures: [], capabilities: [Clock] } }),
    );
    expect(failure.message).toContain("this panic must reach the top");
  });

  test("a panic is not converted into a Result by the compiler-installed frame handler", () => {
    function* body(): Resumable<Result<number, QuoteError>> {
      panic("not a failure");
    }
    const failure = expectPanic(() => runHandled(body, { row: ROW }));
    expect(failure.message).toContain("not a failure");
  });
});

// ---------------------------------------------------------------------------
// runHandled's completed-value assertion, and the effect row.
// specification/effects.mdx §Effect Rows, §Propagation Is an Abort Request.
// ---------------------------------------------------------------------------

describe("runHandled and the effect row", () => {
  test("a completed generator's value must be a Result when the failure row is non-empty", () => {
    function* body(): Resumable<number> {
      return 41;
    }
    const failure = expectPanic(() => runHandled(body, { row: ROW }));
    expect(failure.message).toContain("completed without a Result");
  });

  test("a Result-returning body with a non-empty failure row is accepted", () => {
    function* body(): Resumable<Result<number, QuoteError>> {
      return __vsResultSuccess(41);
    }
    const value = runHandled(body, { row: ROW });
    expect(isResult(value)).toBe(true);
    expect(value.unwrapOr(0)).toBe(41);
  });

  test("THE ASSERTION IS NOT VACUOUS: the same body is accepted when the failure row is empty", () => {
    // A non-empty R with an empty E is a resumable function that returns a
    // plain value. The assertion keys on E alone and correctly does not fire —
    // which is why the case above is the one that proves it can.
    function* body(): Resumable<number> {
      const clock = yield* __vsGet(Clock, "src-row-0");
      return clock.now();
    }
    const value = runHandled(
      () => handle(capabilityHandler<never>(new Map([[Clock, new Clock()]])), body),
      { row: CAPS_ONLY },
    );
    expect(value).toBe(1234);
  });

  test("a function whose whole row is empty must not run in the resumable convention", () => {
    function* body(): Resumable<number> {
      return 1;
    }
    const failure = expectPanic(() => runHandled(body, { row: { failures: [], capabilities: [] } }));
    expect(failure.message).toContain("empty effect row");
  });

  test("the row is mandatory and has no default", () => {
    function* body(): Resumable<number> {
      return 1;
    }
    const failure = expectPanic(() =>
      runHandled(body, { row: undefined as unknown as EffectRow }),
    );
    expect(failure.message).toContain("without a declared effect row");
  });

  test("propagation completes the frame with the error variant, unwinding the body", () => {
    const log: string[] = [];
    const error = new QuoteError("rejected");
    function* body(): Resumable<Result<number, QuoteError>> {
      using _resource = new Tracked(log, "resource");
      const value = yield* __vsPropagate(
        __vsResultFailure(error) as Result<number, QuoteError>,
        "src-row-1",
      );
      log.push("unreachable");
      return __vsResultSuccess(value);
    }

    const value = runHandled(body, { row: ROW });
    expect(isResult(value)).toBe(true);
    expect(value.match({ ok: () => "ok", error: (e) => e })).toBe(error);
    expect(log).toEqual(["acquire resource", "dispose resource"]);
  });

  test("propagation of a success value never issues a request", () => {
    const handler = recording<never>(
      () => true,
      (_r, k) => k.resume(undefined),
    );
    function* body(): Resumable<Result<number, QuoteError>> {
      const value = yield* __vsPropagate(
        __vsResultSuccess(7) as Result<number, QuoteError>,
        "src-row-2",
      );
      return __vsResultSuccess(value + 1);
    }
    const value = runHandled(() => handle(handler, body), { row: ROW });
    expect(value.unwrapOr(0)).toBe(8);
    expect(handler.offered).toHaveLength(0);
  });

  test("a failure outside the declared row fails closed", () => {
    function* body(): Resumable<Result<number, QuoteError>> {
      const value = yield* __vsPropagate(
        __vsResultFailure(new OtherError("stranger")) as unknown as Result<number, QuoteError>,
        "src-row-3",
      );
      return __vsResultSuccess(value);
    }
    const failure = expectPanic(() => runHandled(body, { row: ROW }));
    expect(failure.message).toContain("declared failures do not include it");
  });

  test("the frame handler is installable at a nested function boundary", () => {
    // A fallible callee's own frame turns its abort into a Result; the caller's
    // `!` on that Result aborts again at the caller's frame.
    const inner = new QuoteError("inner");
    function* callee(): Resumable<Result<number, QuoteError>> {
      const value = yield* __vsPropagate(
        __vsResultFailure(inner) as Result<number, QuoteError>,
        "src-nested-0",
      );
      return __vsResultSuccess(value);
    }
    function* caller(): Resumable<Result<string, QuoteError>> {
      const settled = yield* handle(resultFrame<Result<number, QuoteError>>(ROW), callee);
      const value = yield* __vsPropagate(settled, "src-nested-1");
      return __vsResultSuccess(`ok ${value}`);
    }
    const value = runHandled(caller, { row: ROW });
    expect(value.match({ ok: () => "ok", error: (e) => e })).toBe(inner);
  });
});

// ---------------------------------------------------------------------------
// PROPERTY 6 — a declared failure row is keyed on compiler-issued identity, and
// never on a field the payload controls.
//
// `errors.ts`'s compiler-derived codec reconstructs every own enumerable data
// property of a transported Error, `constructor` included. When `__vsPropagate`
// and `resultFrame` each read `error.constructor` to answer "which declared
// failure is this?", that made the row a test of a *payload-supplied string*: a
// value that really was a `QuoteError` was refused by a row naming `QuoteError`
// and admitted by a row naming whatever the payload said. These tests pin the
// inversion in both directions, so deleting the rule turns them red rather than
// leaving the substrate quietly forgeable.
// ---------------------------------------------------------------------------

class RegisteredError extends Error {
  constructor(readonly reason: string) {
    super(`registered failure: ${reason}`);
    this.name = "RegisteredError";
  }
}
__vsRegisterError(RegisteredError, "smithers:effect.test.sm:RegisteredError@1");

/** Shadow the prototype's `constructor` with payload data, then transport it. */
function forgeKey<E extends Error>(error: E, key: unknown): E {
  Object.defineProperty(error, "constructor", {
    value: key,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return decodeError(encodeError(error)) as E;
}

function propagateUnder<E extends Error>(row: EffectRow, error: E): Result<string, E> {
  function* body(): Resumable<Result<string, E>> {
    const label: string = yield* __vsPropagate(__vsResultFailure(error) as Result<string, E>, "src-forge-0");
    return __vsResultSuccess(label);
  }
  return runHandled(body, { row });
}

describe("a declared failure row is keyed on nominal identity, not on payload data", () => {
  test("a forged `constructor` field does not let the payload name its own row", () => {
    const forged = forgeKey(new RegisteredError("nope"), "forged-key");
    // The transported field really did survive: this is the channel, not a
    // hypothetical one.
    expect((forged as unknown as { constructor: unknown }).constructor).toBe("forged-key");
    const failure = expectPanic(() =>
      propagateUnder({ failures: ["forged-key"], capabilities: [Clock] }, forged),
    );
    expect(failure.message).toContain("declared failures do not include it");
  });

  test("the row naming the value's real class accepts it despite the forged field", () => {
    const forged = forgeKey(new RegisteredError("nope"), "forged-key");
    expect(forged).toBeInstanceOf(RegisteredError);
    const settled = propagateUnder({ failures: [RegisteredError], capabilities: [Clock] }, forged);
    expect(settled.match({ ok: () => "ok", error: (e) => e.name })).toBe("RegisteredError");
  });

  test("the abort request carries the nominal key, not the payload's field", () => {
    const forged = forgeKey(new RegisteredError("nope"), "forged-key");
    const handler = recording<Result<string, RegisteredError>>(
      (request) => request.kind === "abort",
      (_request, k) => k.abandon(__vsResultFailure(forged) as Result<string, RegisteredError>),
    );
    function* body(): Resumable<Result<string, RegisteredError>> {
      const label: string = yield* __vsPropagate(
        __vsResultFailure(forged) as Result<string, RegisteredError>,
        "src-forge-1",
      );
      return __vsResultSuccess(label);
    }
    runHandled(() => handle(handler, body), { row: { failures: [], capabilities: [Clock] } });
    expect(handler.answered).toHaveLength(1);
    expect(handler.answered[0]!.key).toBe(RegisteredError);
  });

  // ---- negative controls: the rule must not have become an over-refusal ----

  test("NEGATIVE CONTROL: a registered error still matches its own row after transport", () => {
    const honest = decodeError(encodeError(new RegisteredError("honest"))) as RegisteredError;
    const settled = propagateUnder({ failures: [RegisteredError], capabilities: [Clock] }, honest);
    expect(settled.match({ ok: () => "ok", error: (e) => e.reason })).toBe("honest");
  });

  test("NEGATIVE CONTROL: an unregistered class still matches its own row", () => {
    // `QuoteError` has no transport identity, which is the ordinary case for an
    // imported TypeScript `@throws` class. The prototype chain is the key.
    const settled = propagateUnder(ROW, new QuoteError("plain"));
    expect(settled.match({ ok: () => "ok", error: (e) => e.reason })).toBe("plain");
  });

  test("NEGATIVE CONTROL: a subclass of a declared failure is inside the row", () => {
    class StaleQuote extends QuoteError {}
    const settled = propagateUnder(ROW, new StaleQuote("stale"));
    expect(settled.match({ ok: () => "ok", error: (e) => e.name })).toBe("QuoteError");
  });

  test("a genuine error is still refused by a row that does not name its class", () => {
    const failure = expectPanic(() =>
      propagateUnder({ failures: [OtherError], capabilities: [Clock] }, new RegisteredError("nope")),
    );
    expect(failure.message).toContain("declared failures do not include it");
  });

  test("a row entry that is not an Error constructor matches nothing", () => {
    // Fail-closed: a string or symbol row entry is exactly the shape a forged
    // payload could name, so it can never admit a failure.
    const failure = expectPanic(() =>
      propagateUnder({ failures: ["RegisteredError", Symbol("RegisteredError")], capabilities: [Clock] },
        new RegisteredError("nope")),
    );
    expect(failure.message).toContain("declared failures do not include it");
  });
});

// ---------------------------------------------------------------------------
// The gate the emitted code will actually face: stock tsc under `strict`.
// This is question Q9 — emitted `.ts` is checked by stock tsc, never by the
// `.sm` frontend, so the request union must be a type stock TypeScript can
// infer through `yield*` delegation chains.
// ---------------------------------------------------------------------------

const FIXTURE_PATH = fileURLToPath(new URL("./__emitted-fixture.ts", import.meta.url));

function diagnose(code: string): readonly ts.Diagnostic[] {
  return checkEmittedTypeScript(code, FIXTURE_PATH);
}

function messages(diagnostics: readonly ts.Diagnostic[]): string[] {
  return diagnostics.map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}

const EMITTED_PRELUDE = `
import { __vsGet, __vsPerform, __vsPropagate, handle, runHandled } from "./effect.ts";
import type { AnyRequest, EffectRow, Resumable } from "./effect.ts";
import { Context } from "./layer.ts";
import { __vsResultSuccess, type Result } from "./result.ts";

class Clock extends Context { now(): number { return 0; } }
class Rates extends Context { rate(): number { return 1; } }
class QuoteError extends Error { declare readonly reason: string }

const ROW: EffectRow = { failures: [QuoteError], capabilities: [Clock, Rates] };
`;

const EMITTED_BODY = `
function* leaf(): Generator<AnyRequest, number, unknown> {
  const clock = yield* __vsGet(Clock, "src-leaf-0");
  const rates = yield* __vsGet(Rates, "src-leaf-1");
  const cents = yield* __vsPerform<number>("quote", { at: clock.now() }, "src-leaf-2");
  return cents * rates.rate();
}

function* middle(r: Result<string, QuoteError>): Generator<AnyRequest, string, unknown> {
  const cents: number = yield* leaf();
  const label: string = yield* __vsPropagate(r, "src-middle-0");
  return label + String(cents);
}

function* top(r: Result<string, QuoteError>): Resumable<Result<string, QuoteError>> {
  const label: string = yield* middle(r);
  return __vsResultSuccess(label);
}

export function entry(r: Result<string, QuoteError>): Result<string, QuoteError> {
  return runHandled(() => handle({
    accepts: (request) => request.kind === "get",
    answer: (request, k) => { k.resume(request.key === Clock ? new Clock() : new Rates()); },
  }, () => top(r)), { row: ROW });
}
`;

describe("checkEmittedTypeScript: the request union under stock tsc", () => {
  test("a three-deep yield* delegation chain over heterogeneous answers checks clean", () => {
    expect(messages(diagnose(EMITTED_PRELUDE + EMITTED_BODY))).toEqual([]);
  });

  test("the fixture is not passing because the types collapsed to any", () => {
    // The paired negative. If `./effect.ts` resolved to `any` — a broken import,
    // a lost type parameter — the fixture above would also report zero, which
    // would be a fail-open. These three misuses must each be caught.
    const wrongCapability = EMITTED_PRELUDE + `
      function* body(): Generator<AnyRequest, number, unknown> {
        const clock: Rates = yield* __vsGet(Clock, "src-neg-0");
        return clock.rate();
      }
      export const _ = body;
    `;
    const wrongPerform = EMITTED_PRELUDE + `
      function* body(): Generator<AnyRequest, number, unknown> {
        const cents: string = yield* __vsPerform<number>("quote", undefined, "src-neg-1");
        return cents.length;
      }
      export const _ = body;
    `;
    const missingRow = EMITTED_PRELUDE + `
      export const _ = runHandled<number>(function* () { return 1; }, {});
    `;
    expect(messages(diagnose(wrongCapability))).toEqual([
      "TS2741 Property 'rate' is missing in type 'Clock' but required in type 'Rates'.",
    ]);
    expect(messages(diagnose(wrongPerform))).toEqual([
      "TS2322 Type 'number' is not assignable to type 'string'.",
    ]);
    expect(messages(diagnose(missingRow)).join("\n")).toContain("row");
  });

  test("stock tsc infers the union through an UNannotated delegation chain too", () => {
    const inferred = EMITTED_PRELUDE + `
      function* leaf() {
        const clock = yield* __vsGet(Clock, "src-inf-0");
        const cents = yield* __vsPerform<number>("quote", undefined, "src-inf-1");
        return cents + clock.now();
      }
      function* middle() { return (yield* leaf()) + 1; }
      export function* top(): Generator<AnyRequest, number, unknown> { return yield* middle(); }
    `;
    expect(messages(diagnose(inferred))).toEqual([]);
  });

  test("WHAT THE GATE FORCED: an answer type in a contravariant position does not check", () => {
    // The obvious request shape carries its own resumption callback. Measured
    // here rather than argued: with `A` contravariant, two requests with
    // different answer types cannot share one yield type, so no delegation
    // chain that mixes them can be given a union.
    const contravariant = `
      type Request<A> = { readonly kind: string; readonly resume: (answer: A) => void };
      declare function badGet<A>(a: A): Generator<Request<A>, A, unknown>;
      export function* leaf(): Generator<Request<unknown>, number, unknown> {
        const n: number = yield* badGet(1);
        const s: string = yield* badGet("x");
        return n + s.length;
      }
    `;
    expect(messages(diagnose(contravariant))).toEqual([
      "TS2322 Type 'Request<number>' is not assignable to type 'Request<unknown>'.   Type 'unknown' is not assignable to type 'number'.",
      "TS2322 Type 'Request<string>' is not assignable to type 'Request<unknown>'.   Type 'unknown' is not assignable to type 'string'.",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Layer provision installs a handler (the resumable-lowering hooks).
// ---------------------------------------------------------------------------

/**
 * `__vsProvide` / `__vsProvideRoot`, driven by hand rather than by the emitter.
 *
 * The emitted path is measured across 61 conformance cases; what those cases
 * cannot isolate is the part of this seam that was reasoned about rather than
 * observed — that the AsyncLocalStorage frame is entered per STEP and not once
 * around the whole drive. A generator that suspends leaves the frame and
 * re-enters it, and a request forwarded to an outer handler must be answered in
 * the OUTER environment. Wrapping the drive once passes every corpus case and
 * fails the second test below.
 */
describe("Layer provision installs a handler", () => {
  abstract class Directory extends Context {
    abstract lookup(key: string): string;
  }
  abstract class Clock extends Context {
    abstract now(): number;
  }
  const directory: Directory = { lookup: (key) => (key === "ada" ? "Ada" : "none") };
  const clock: Clock = { now: () => 7 };

  test("a get is answered from the layer and the computation resumes", () => {
    const value = __vsProvideRoot(Layer.succeed(Directory, directory), function* () {
      const service = yield* __vsGet(Directory, "src-test-0");
      return service.lookup("ada");
    });
    expect(value).toBe("Ada");
  });

  /**
   * The inner scope provides Clock and NOT Directory, so the inner `get` for
   * Directory must forward outward. `handle`'s forwarding is what makes that
   * work, and the environment frame must not follow the request out with it.
   */
  test("an unprovided key forwards outward to the scope that provides it", () => {
    const lines = __vsProvideRoot(Layer.succeed(Directory, directory), function* () {
      const outer = (yield* __vsGet(Directory, "src-test-1")).lookup("ada");
      const inner = yield* __vsProvide(Layer.succeed(Clock, clock), function* () {
        const at = (yield* __vsGet(Clock, "src-test-2")).now();
        return `${(yield* __vsGet(Directory, "src-test-3")).lookup("ada")}@${at}`;
      });
      return [outer, inner];
    });
    expect(lines).toEqual(["Ada", "Ada@7"]);
  });

  /**
   * The compatibility shim, which is the half of this seam that has no
   * generator under it. `useCapability` is what an un-lowered read compiles to,
   * and it must find the layer while the delimited computation is running and
   * must NOT find it afterwards.
   */
  test("an un-lowered read reaches the same layer through the environment shim", () => {
    let outside: unknown = "not read";
    const inside = __vsProvideRoot(Layer.succeed(Directory, directory), function* () {
      // No `yield` before this line: the shim has to be live from the first
      // step, not from the first request.
      return useCapability(Directory).lookup("ada");
    });
    expect(inside).toBe("Ada");
    try {
      outside = useCapability(Directory).lookup("ada");
    } catch (error) {
      outside = error;
    }
    expect(isPanic(outside)).toBe(true);
  });

  /**
   * The message is `useCapability`'s, verbatim. The default lowering reaches
   * that function for this mistake, so a different sentence here would be a
   * divergence between the two lowerings on the failing path.
   */
  test("a get no scope provides panics in the words the other lowering uses", () => {
    expect(() =>
      __vsProvideRoot(Layer.succeed(Directory, directory), function* () {
        return (yield* __vsGet(Clock, "src-test-4")).now();
      })
    ).toThrow("capability 'Clock' was not provided");
  });

  /**
   * What the retired promise-hook assertion was protecting, asserted directly.
   *
   * That test read a counter to prove `Layer.provide`'s promise-tracking block
   * was never engaged under this lowering — a proxy for the real claim, which
   * is that this seam answers "when is the extent over?" STRUCTURALLY and needs
   * no settlement hook to do it. The apparatus is now deleted, so the counter is
   * gone and the claim is made against the behaviour instead: the extent ends
   * when the delimited computation ends, and it ends even when the computation
   * throws.
   *
   * The `throw` arm is the one a hook-based revocation got wrong for free and a
   * structural one has to get right on purpose.
   */
  test("the extent ends with the computation, including when it throws", () => {
    const reads: unknown[] = [];
    expect(() =>
      __vsProvideRoot(Layer.succeed(Directory, directory), function* () {
        reads.push(useCapability(Directory).lookup("ada"));
        yield* __vsGet(Directory, "src-test-5");
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(reads).toEqual(["Ada"]);
    let outside: unknown = "not read";
    try {
      outside = useCapability(Directory).lookup("ada");
    } catch (error) {
      outside = error;
    }
    expect(isPanic(outside)).toBe(true);
  });

  /** A forged layer is refused here exactly as `Layer.provide` refuses one. */
  test("a forged layer is refused", () => {
    expect(() => __vsProvideRoot({}, function* () { return 1; })).toThrow("forged Layer value");
  });
});

// ---------------------------------------------------------------------------
// Inertness: only the emitter's own hooks may leave this module.
// ---------------------------------------------------------------------------

/**
 * This test used to assert that `index.ts` did not mention `effect.ts` at all,
 * and until the resumable-lowering emitter existed that was the cheapest
 * possible guarantee of §One-Shot Delimited Continuations' "MUST NOT be reified
 * as a value visible to authored `.sm`". It is no longer available: emitted
 * modules import their helpers from `runtime/index.ts`, so a lowering hook has
 * to be re-exported from there to be reachable at all.
 *
 * The obligation is unchanged, so what replaces it is the obligation itself
 * rather than its old proxy: an ALLOWLIST. Every name the barrel takes from
 * this module is enumerated here, and each one is checked to answer with a
 * value that is not a request, a continuation, or a handler. `handle`,
 * `capabilityHandler`, `resultFrame` and `runHandled` — the four that DO traffic
 * in those — must stay unreachable, and the `__vs` prefix on the three that are
 * exported is the frontend's reserved namespace, so no authored program can
 * bind them either.
 */
test("only the emitter's lowering hooks are re-exported, and none of them reifies a continuation", () => {
  const index = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
  const exported = [...index.matchAll(/export (?:type )?\{([^}]*)\} from "\.\/effect\.ts";/gu)]
    .flatMap((match) => match[1]!.split(",").map((name) => name.trim()))
    .filter((name) => name.length > 0)
    .sort();
  expect(exported).toEqual(["AnyRequest", "Resumable", "__vsGet", "__vsProvide", "__vsProvideRoot"]);
  for (const name of ["handle", "capabilityHandler", "resultFrame", "runHandled", "Continuation", "Handler"]) {
    expect(exported).not.toContain(name);
  }
});
