import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  Context,
  ErrorCodecError,
  Layer,
  Panic,
  Result,
  RuntimeValues,
  __vsErrorCases,
  __vsInspectResult,
  __vsPanicValue,
  __vsRegisterError,
  __vsResultFailure,
  __vsResultSuccess,
  __vsValidateForeignError,
  catchPanic,
  catchPanicPromise,
  decodeError,
  decodeResult,
  encodeError,
  encodeResult,
  errorIdentity,
  isLayer,
  isPanic,
  isResult,
  registerErrorCodec,
  registerErrorType,
  rethrowPanics,
  ValueCodecError,
} from "./index.ts";
import type { NominalError, Result as ResultType } from "./index.ts";
import * as runtimeExports from "./index.ts";

class NotFound extends Error {
  constructor(readonly id: string) {
    super(`missing ${id}`);
    this.name = "NotFound";
  }
}

class Timeout extends Error {
  constructor(readonly milliseconds: number) {
    super(`timed out after ${milliseconds}ms`);
    this.name = "Timeout";
  }
}

registerErrorCodec(NotFound, "test:runtime/NotFound@1", {
  encode: (error) => ({ id: error.id }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 1 || typeof payload.id !== "string"
    ) throw new TypeError("invalid NotFound payload");
    return new NotFound(payload.id);
  },
});
__vsRegisterError(Timeout, "test:runtime/Timeout@1");

/** Stands in for the withdrawn `MissingOptionalValue`: a branded Panic subclass. */
class BoundaryDefect extends Panic {}
interface BoundaryDefect extends NominalError<"test:runtime/BoundaryDefect@1"> {}
registerErrorType(BoundaryDefect, "test:runtime/BoundaryDefect@1");

describe("hardened Result runtime", () => {
  test("Result exposes value operations but no author constructors", () => {
    expect("ok" in Result).toBe(false);
    expect("err" in Result).toBe(false);
    expect(Object.isFrozen(Result)).toBe(true);
    expect(Object.keys(Result).sort()).toEqual(["all", "try", "tryPromise"]);
    const success: ResultType<number, never> = __vsResultSuccess(2);
    const failure = __vsResultFailure(new NotFound("a"));
    for (const method of [
      "isOk", "isError", "match", "map", "mapError", "andThen", "flatten", "recover",
      "tap", "tapError", "tapBoth", "unwrap", "unwrapOr", "expect",
    ] as const) {
      expect(typeof success[method]).toBe("function");
    }
    expect(isResult(success)).toBe(true);
    expect(Object.isFrozen(success)).toBe(true);
    expect(success.map((value) => value * 3).unwrap()).toBe(6);
    expect(failure.map((value: never) => value).unwrapOr(() => 9)).toBe(9);
    expect(failure.mapError(() => new Timeout(5)).match({ ok: () => "bad", error: (error) => error.milliseconds })).toBe(5);
    expect(success.andThen((value) => __vsResultSuccess(String(value))).unwrap()).toBe("2");
    expect(failure.recover((error) => error.message).unwrap()).toBe("missing a");
    expect(__vsInspectResult(success)).toEqual({ ok: true, value: 2 });
    expect(__vsInspectResult(failure)).toEqual({ ok: false, error: new NotFound("a") });
    expect(() => failure.unwrap()).toThrow("missing a");
  });

  test("Result methods route only the active variant and validate chained Results", () => {
    const success = __vsResultSuccess(4);
    const domainError = new NotFound("branch");
    const failure = __vsResultFailure(domainError);
    const inactive = (): never => Reflect.panic("inactive Result branch ran");

    expect(success.isOk()).toBe(true);
    expect(success.isError()).toBe(false);
    expect(failure.isOk()).toBe(false);
    expect(failure.isError()).toBe(true);
    expect(success.match({ ok: (value) => value + 1, error: inactive })).toBe(5);
    expect(failure.match({ ok: inactive, error: (error) => error.id })).toBe("branch");
    expect(isPanic(catchPanic(
      () => success.match({ ok: (value: number) => value, error: undefined } as never),
      (error) => error,
    ))).toBe(true);

    expect(failure.map(inactive)).toBe(failure);
    expect(success.mapError(inactive)).toBe(success);
    expect(failure.andThen(inactive)).toBe(failure);
    expect(success.recover(inactive)).toBe(success);
    expect(isPanic(catchPanic(
      () => success.andThen(() => Object.freeze({}) as never),
      (error) => error,
    ))).toBe(true);
    expect(isPanic(catchPanic(
      () => failure.mapError(() => runInNewContext("new Error('foreign')") as Error),
      (error) => error,
    ))).toBe(true);

    let successObservations = 0;
    let errorObservations = 0;
    expect(success.tap(() => { successObservations++; })).toBe(success);
    expect(success.tapError(() => { errorObservations++; })).toBe(success);
    expect(failure.tap(() => { successObservations++; })).toBe(failure);
    expect(failure.tapError((error) => {
      expect(error).toBe(domainError);
      errorObservations++;
    })).toBe(failure);
    expect(successObservations).toBe(1);
    expect(errorObservations).toBe(1);

    expect(success.unwrapOr(inactive)).toBe(4);
    expect(success.expect("unused invariant message")).toBe(4);
    const expectationPanic = catchPanic(
      () => failure.expect("required branch"),
      (error) => error,
    );
    expect(isPanic(expectationPanic)).toBe(true);
    if (isPanic(expectationPanic)) expect(expectationPanic.rootCause()).toBe(domainError);
  });

  test("flatten collapses exactly one level and refuses an unbranded payload", () => {
    const inner = __vsResultSuccess(7);
    const nested = __vsResultSuccess(inner);
    expect(nested.flatten()).toBe(inner);
    expect(nested.flatten().unwrap()).toBe(7);

    // The OUTER failure short-circuits without touching the missing inner value.
    const outerFailure = __vsResultFailure(new NotFound("outer"));
    expect(outerFailure.flatten()).toBe(outerFailure);

    // An INNER failure is what flatten is for: it becomes the flat failure.
    const innerFailure = __vsResultFailure(new Timeout(3));
    const nestedFailure = __vsResultSuccess(innerFailure);
    expect(nestedFailure.flatten()).toBe(innerFailure);
    expect(nestedFailure.flatten().match({ ok: () => -1, error: (error) => error.milliseconds })).toBe(3);

    // Only one level: flattening a doubly nested Result yields a Result.
    expect(isResult(__vsResultSuccess(nested).flatten().unwrap())).toBe(true);

    // A success carrying a non-Result cannot be laundered into the channel.
    const unbranded = __vsResultSuccess(Object.freeze({ ok: true, value: 1 }));
    expect(isPanic(catchPanic(
      () => (unbranded as unknown as { flatten(): unknown }).flatten(),
      (error) => error,
    ))).toBe(true);
  });

  test("tapBoth observes the active variant only, returns the receiver, and demands both handlers", () => {
    const success = __vsResultSuccess(4);
    const domainError = new NotFound("both");
    const failure = __vsResultFailure(domainError);
    const inactive = (): never => Reflect.panic("inactive tapBoth branch ran");

    let okSeen = 0;
    let errorSeen = 0;
    expect(success.tapBoth({ ok: (value) => { expect(value).toBe(4); okSeen++; }, error: inactive })).toBe(success);
    expect(failure.tapBoth({ ok: inactive, error: (error) => { expect(error).toBe(domainError); errorSeen++; } })).toBe(failure);
    expect(okSeen).toBe(1);
    expect(errorSeen).toBe(1);

    // A half-filled handler object is a panic, exactly as it is for `match`.
    expect(isPanic(catchPanic(
      () => success.tapBoth({ ok: (value: number) => value, error: undefined } as never),
      (error) => error,
    ))).toBe(true);
    expect(isPanic(catchPanic(
      () => success.tapBoth(undefined as never),
      (error) => error,
    ))).toBe(true);
  });

  test("Result.recover handles domain errors but passes Panic through unchanged", () => {
    const domain = __vsResultFailure(new NotFound("recoverable"));
    const recoveredValue: ResultType<string, never> = domain.recover((error) => error.id);
    expect(recoveredValue.unwrap()).toBe("recoverable");

    const replacement = domain.recover(() => __vsResultFailure(new Timeout(12)));
    expect(replacement.match({ ok: () => -1, error: (error) => error.milliseconds })).toBe(12);

    const panic = new Panic("preserve me");
    const panicResult = __vsResultFailure(panic);
    let recoveryCalls = 0;
    const preserved: ResultType<number, Panic> = panicResult.recover(() => {
      recoveryCalls++;
      return 1;
    });
    expect(preserved).toBe(panicResult);
    expect(Object.isFrozen(preserved)).toBe(true);
    expect(recoveryCalls).toBe(0);
    expect(preserved.match({ ok: () => false, error: isPanic })).toBe(true);
  });

  test("Result.all short-circuits at the first error and adapters cover success paths", async () => {
    const firstError = new NotFound("first");
    let advancedPastError = false;
    function* results() {
      yield __vsResultSuccess(1) as ResultType<number, NotFound>;
      yield __vsResultFailure(firstError) as ResultType<number, NotFound>;
      advancedPastError = true;
      yield __vsResultSuccess(3) as ResultType<number, NotFound>;
    }

    const collected = Result.all(results());
    expect(collected.match({ ok: () => "bad", error: (error) => error })).toBe(firstError);
    expect(advancedPastError).toBe(false);
    expect(Result.all([]).unwrap()).toEqual([]);
    expect(Result.try(() => 7).unwrap()).toBe(7);
    expect((await Result.tryPromise(async () => 8)).unwrap()).toBe(8);
  });

  test("Result values and errors cannot be forged across the runtime boundary", () => {
    const forged = Object.create(Object.getPrototypeOf(__vsResultSuccess(1)));
    expect(isResult(forged)).toBe(false);
    expect(isPanic(catchPanic(() => Result.all([forged]), (error) => error))).toBe(true);
    const foreignError = runInNewContext("new Error('foreign realm')") as Error;
    expect(isPanic(catchPanic(
      () => __vsResultFailure(foreignError),
      (error) => error,
    ))).toBe(true);
  });

  test("foreign boundaries produce checked Panic unless a trusted mapper validates the Error", async () => {
    const unchecked = Result.try(() => { throw new RangeError("foreign"); });
    const uncheckedState = __vsInspectResult(unchecked);
    expect(uncheckedState.ok).toBe(false);
    if (!uncheckedState.ok) {
      expect(uncheckedState.error).toBeInstanceOf(Panic);
      expect(isPanic(uncheckedState.error)).toBe(true);
      expect(uncheckedState.error.rootCause()).toBeInstanceOf(RangeError);
    }

    const adapted = Result.try(
      () => { throw new NotFound("mapped"); },
      (cause) => __vsValidateForeignError(cause, NotFound),
    );
    expect(adapted.match({
      ok: () => "bad",
      error: (error) => error.is(NotFound) ? error.id : "unexpected panic",
    })).toBe("mapped");
    const violatedCause = new RangeError("wrong contract");
    const violated = Result.try(
      () => { throw violatedCause; },
      (cause) => __vsValidateForeignError(cause, NotFound),
    );
    expect(violated.match({
      ok: () => false,
      error: (error) => isPanic(error) && error.cause === violatedCause && error.rootCause() === violatedCause,
    })).toBe(true);

    const rejected = await Result.tryPromise(async () => { throw "not an Error"; });
    expect(rejected.match({ ok: () => false, error: isPanic })).toBe(true);
    const preexisting = Result.try(() => Reflect.panic("invariant"), () => new NotFound("must not map"));
    expect(preexisting.match({ ok: () => false, error: isPanic })).toBe(true);

    class ImportedDeclaredError extends Error {}
    const imported = new ImportedDeclaredError("declared");
    expect(__vsValidateForeignError(imported, ImportedDeclaredError)).toBe(imported);
    expect(imported.is(ImportedDeclaredError)).toBe(true);
    expect(() => encodeError(imported)).toThrow("no registered transport codec");
  });

  test("panic recovery never swallows ordinary exceptions", async () => {
    expect(isPanic(__vsPanicValue("value form"))).toBe(true);
    expect(catchPanic(() => Reflect.panic("expected"), (error) => error.message)).toBe("expected");
    expect(() => catchPanic(() => { throw new RangeError("ordinary"); }, () => "bad")).toThrow("ordinary");
    expect(await catchPanicPromise(async () => Reflect.panic("async"), (error) => error.message)).toBe("async");
    await expect(catchPanicPromise(async () => { throw new RangeError("reject"); }, () => "bad")).rejects.toThrow("reject");
  });

  test("absence is an ordinary `T | undefined` union, not a runtime container", () => {
    // Nothing named Optional survives the runtime's export surface, and no
    // lowering hook constructs a present/absent variant any more.
    for (const withdrawn of [
      "Optional", "OptionalValue", "MissingOptionalValue", "isOptional",
      "__vsOptionalSome", "__vsOptionalNone", "__vsInspectOptional",
      "encodeOptional", "decodeOptional",
    ]) {
      expect(withdrawn in runtimeExports).toBe(false);
    }

    // A lookup that can miss answers with the value or `undefined`, and
    // ordinary narrowing is what reads it.
    const users = new Map<string, string>([["1", "Ada"]]);
    const find = (id: string): string | undefined => users.get(id);

    const hit = find("1");
    if (hit === undefined) throw new Error("expected a hit");
    expect(hit.toUpperCase()).toBe("ADA");
    expect(find("2")).toBeUndefined();

    // `?.` and `??` keep their ordinary nullish meaning. They are the absence
    // axis; `!`/Result propagation is the failure axis (DECISIONS.md).
    expect(find("1")?.length).toBe(3);
    expect(find("2")?.length).toBeUndefined();
    expect(find("1") ?? "Guest").toBe("Ada");
    expect(find("2") ?? "Guest").toBe("Guest");

    // `??` coalesces only null/undefined, so a falsy *present* value survives.
    const counts = new Map<string, number>([["zero", 0]]);
    expect(counts.get("zero") ?? -1).toBe(0);
    expect(counts.get("missing") ?? -1).toBe(-1);
    expect(counts.get("zero")?.toFixed(1)).toBe("0.0");
    expect(counts.get("zero") || -1).toBe(-1); // `||` still differs from `??`

    // `T | null` reads the same way, and both nullish values short-circuit.
    const findOrNull = (id: string): string | null => users.get(id) ?? null;
    expect(findOrNull("2") ?? "Guest").toBe("Guest");
    expect(findOrNull("2")?.length).toBeUndefined();
    expect(findOrNull("1")?.length).toBe(3);

    // Absence and failure stay separate. A function that can do both returns
    // `Result<A | undefined, E>`; an absent success is still a success.
    const lookup = (id: string): ResultType<string | undefined, NotFound> =>
      id === "boom" ? __vsResultFailure(new NotFound(id)) : __vsResultSuccess(users.get(id));
    expect(lookup("1").unwrap()).toBe("Ada");
    expect(lookup("2").unwrap()).toBeUndefined();
    expect(lookup("2").isOk()).toBe(true);
    expect(lookup("boom").match({ ok: () => "bad", error: (error) => error.id })).toBe("boom");
    expect(isResult(lookup("2"))).toBe(true);
    expect(isResult(undefined)).toBe(false);
  });

  test("a user's own type and value named Optional is ordinary code", () => {
    type Optional<T> = { readonly present: boolean; readonly value?: T };
    const Optional = {
      of: <T>(value: T): Optional<T> => ({ present: true, value }),
      empty: <T>(): Optional<T> => ({ present: false }),
    };

    const mine: Optional<string> = Optional.of("Ada");
    expect(mine.present).toBe(true);
    expect(mine.value).toBe("Ada");
    expect(Optional.empty<string>().value).toBeUndefined();
    // Ordinary object, no runtime brand and no compiler recognition.
    expect(Object.keys(mine).sort()).toEqual(["present", "value"]);
    expect(Object.getPrototypeOf(mine)).toBe(Object.prototype);
    expect(mine.value?.length).toBe(3);
    expect(Optional.empty<string>().value ?? "Guest").toBe("Guest");
  });
});

describe("RuntimeValues library construction surface", () => {
  test("is a frozen namespace over the compiler's own constructors and names nothing author-facing", () => {
    expect(Object.isFrozen(RuntimeValues)).toBe(true);
    expect(Object.keys(RuntimeValues).sort()).toEqual(["failure", "success"]);
    for (const banned of ["ok", "err", "some", "none", "of", "from", "present", "absent"]) {
      expect(banned in RuntimeValues).toBe(false);
    }
    // The authoring namespace stays free of variant constructors (DECISIONS.md),
    // and absence needs no constructor at all — it is `undefined`.
    expect(Object.keys(Result).sort()).toEqual(["all", "try", "tryPromise"]);
    expect(RuntimeValues.success).toBe(__vsResultSuccess);
    expect(RuntimeValues.failure).toBe(__vsResultFailure);
  });

  test("produces the same frozen, branded, unforgeable variants as the lowering hooks", () => {
    const success = RuntimeValues.success(2);
    const failure = RuntimeValues.failure(new NotFound("library"));

    expect(isResult(success)).toBe(true);
    expect(isResult(failure)).toBe(true);
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.getPrototypeOf(success)).toBe(Object.getPrototypeOf(__vsResultSuccess(1)));
    expect(success.unwrap()).toBe(2);
    expect(failure.match({ ok: () => "bad", error: (error) => error.id })).toBe("library");
    expect(encodeResult(success, { encode: (value) => value, decode: (payload) => payload as number }))
      .toBe('{"version":1,"kind":"success","value":2}');

    // One -0 policy, matching `durable/value.ts`, `schema/json.ts`, and the
    // comptime intrinsic: the wire codec used to accept negative zero and print
    // it as `0`, changing the value's identity with no diagnostic.
    const identity = { encode: (value: number) => value, decode: (payload: unknown) => payload as number };
    expect(() => encodeResult(RuntimeValues.success(-0), identity)).toThrow("negative zero");
    expect(encodeResult(RuntimeValues.success(0), identity))
      .toBe('{"version":1,"kind":"success","value":0}');

    // An absent success carries `undefined` itself; there is nothing to unwrap.
    const absent = RuntimeValues.success<string | undefined>(undefined);
    expect(isResult(absent)).toBe(true);
    expect(absent.isOk()).toBe(true);
    expect(absent.unwrap()).toBeUndefined();
    expect(absent.unwrap() ?? "Guest").toBe("Guest");
  });

  test("keeps every construction invariant of the lowering hooks", () => {
    const foreignError = runInNewContext("new Error('foreign realm')") as Error;
    expect(isPanic(catchPanic(() => RuntimeValues.failure(foreignError), (error) => error))).toBe(true);
    expect(isResult(Object.create(Object.getPrototypeOf(RuntimeValues.success(1))))).toBe(false);
  });
});

describe("rethrowPanics escalates the panic channel out of a typed failure", () => {
  test("returns successes and recoverable failures unchanged", () => {
    const success: ResultType<number, NotFound | Panic> = __vsResultSuccess(3);
    expect(Object.is(rethrowPanics(success), success)).toBe(true);
    const domain: ResultType<number, NotFound | Panic> = __vsResultFailure(new NotFound("kept"));
    const narrowed: ResultType<number, NotFound> = rethrowPanics(domain);
    expect(Object.is(narrowed, domain)).toBe(true);
    expect(narrowed.match({ ok: () => "bad", error: (error) => error.id })).toBe("kept");
  });

  test("rethrows the exact Panic instance, and catchPanic still sees it", () => {
    const raised = new Panic("escalate");
    const escaped = catchPanic(() => rethrowPanics(__vsResultFailure(raised)), (error) => error);
    expect(escaped).toBe(raised);

    const subclass = new BoundaryDefect("a defect crossed a boundary");
    expect(catchPanic(() => rethrowPanics(__vsResultFailure(subclass)), (error) => error)).toBe(subclass);

    const decoded = decodeError(encodeError(new Panic("round-tripped")));
    expect(isPanic(decoded)).toBe(true);
    expect(Object.is(
      catchPanic(() => rethrowPanics(__vsResultFailure(decoded)), (error) => error),
      decoded,
    )).toBe(true);
  });

  test("reads only the failure itself, never a nested cause", () => {
    const buried = new Panic("buried");
    const wrapper = new Error("ordinary wrapper", { cause: buried });
    const wrapped = __vsResultFailure(wrapper);
    expect(rethrowPanics(wrapped)).toBe(wrapped);
    expect(wrapper.rootCause()).toBe(buried);

    const outer = new Panic("outer", { cause: new Panic("inner") });
    const escaped = catchPanic(() => rethrowPanics(__vsResultFailure(outer)), (error) => error);
    expect(escaped).toBe(outer);
    expect((escaped as Panic).rootCause()).toBe(outer.cause);
  });

  test("identity is local construction, not prototype or name, and forgeries panic", () => {
    class CostumedPanic extends Error {}
    const costume = new CostumedPanic("not really a panic");
    costume.name = "Panic";
    Object.setPrototypeOf(costume, Panic.prototype);
    expect(costume instanceof Panic).toBe(true);
    expect(isPanic(costume)).toBe(false);
    const costumed = __vsResultFailure(costume);
    expect(rethrowPanics(costumed)).toBe(costumed);

    const forged = Object.create(Object.getPrototypeOf(__vsResultSuccess(1))) as ResultType<number, Panic>;
    expect(isPanic(catchPanic(() => rethrowPanics(forged), (error) => error))).toBe(true);
    const proxied = new Proxy(__vsResultFailure(new Panic("proxied")), {}) as ResultType<never, Panic>;
    expect(isPanic(catchPanic(() => rethrowPanics(proxied), (error) => error))).toBe(true);
    expect(isPanic(catchPanic(
      () => rethrowPanics({ ok: false, error: new Panic("plain object") } as unknown as ResultType<number, Panic>),
      (error) => error,
    ))).toBe(true);
  });
});

describe("nominal Error identity and transport", () => {
  test("matching uses registered constructors, not tags, symbols, names, or custom hasInstance", () => {
    const error = new NotFound("one");
    expect(error.is(NotFound)).toBe(true);
    expect(error.matches(Timeout, NotFound)).toBe(true);
    const cases = __vsErrorCases(
      [NotFound, (failure: NotFound) => failure.id] as const,
      [Timeout, (failure: Timeout) => String(failure.milliseconds)] as const,
    );
    expect(error.match(cases)).toBe("one");
    expect(error.matchPartial(__vsErrorCases([Timeout, () => "timeout"] as const), () => "fallback")).toBe("fallback");

    const fake = Object.assign(new Error("fake"), {
      _tag: "NotFound",
      [Symbol.for("smithers.failure")]: true,
    });
    expect(fake.is(NotFound)).toBe(false);
    const crossRealm = runInNewContext(`new (class NotFound extends Error { constructor() { super("same name") } })()` ) as Error;
    expect(errorIdentity(crossRealm)).toBeUndefined();
    expect(error.is({ [Symbol.hasInstance]: () => true, prototype: NotFound.prototype } as unknown as typeof NotFound)).toBe(false);
  });

  test("rootCause reads only own data properties and terminates on cycles", () => {
    const root = new Error("root");
    const outer = new Error("outer", { cause: root });
    expect(outer.rootCause()).toBe(root);
    let getterRan = false;
    const hostile = new Error("hostile");
    Object.defineProperty(hostile, "cause", { get() { getterRan = true; return root; } });
    expect(hostile.rootCause()).toBe(hostile);
    expect(getterRan).toBe(false);
    const cycle = new Error("cycle");
    Object.defineProperty(cycle, "cause", { value: cycle });
    expect(cycle.rootCause()).toBe(cycle);
  });

  test("Error wire decoding is explicit, strict, and reconstructs local nominal identity", () => {
    const wire = encodeError(new NotFound("transported"));
    const decoded = decodeError(wire);
    expect(decoded).toBeInstanceOf(NotFound);
    expect(decoded.is(NotFound)).toBe(true);
    expect((decoded as NotFound).id).toBe("transported");

    const extra = JSON.parse(wire) as Record<string, unknown>;
    extra.extra = true;
    expect(() => decodeError(JSON.stringify(extra))).toThrow(ErrorCodecError);
    const badPayload = JSON.parse(wire) as { payload: unknown };
    badPayload.payload = { id: 1 };
    expect(() => decodeError(JSON.stringify(badPayload))).toThrow(ErrorCodecError);
    expect(() => decodeError('{"version":1,"identity":"unknown:Error@1","payload":{}}')).toThrow("unknown Error identity");
    expect(() => decodeError(` {${wire.slice(1)}`)).toThrow("not canonical JSON");
    const foreignError = runInNewContext("new Error('foreign')") as Error;
    expect(() => encodeError(foreignError)).toThrow("only local Error");
  });

  test("a stable identity spans the TypeScript identifier alphabet and still refuses ill-formed keys", () => {
    // failures.mdx, "Error Classes": ANY named class extending `Error` MUST be
    // usable as a nominal recoverable error, and TypeScript identifiers admit
    // the full Unicode ID_Start/ID_Continue set. An ASCII-only alphabet here
    // made the compiler accept `class Café extends Error {}` and then throw
    // while the emitted module was still loading.
    class Café extends Error {}
    expect(__vsRegisterError(Café, "smithers:runtime/identity.sm:Café")).toBe(Café);
    const refused = new Café("no table");
    expect(errorIdentity(refused)).toBe("smithers:runtime/identity.sm:Café");
    expect(refused.is(Café)).toBe(true);
    class Χρόνος extends Error {}
    expect(__vsRegisterError(Χρόνος, "smithers:runtime/identity.sm:Χρόνος")).toBe(Χρόνος);

    // Widening the letters must not widen the shape: an identity is still a
    // single wire key with no whitespace, quoting, control characters, or
    // unbounded length.
    class Ordinary extends Error {}
    for (const invalid of [
      "",
      "smithers:runtime identity.sm:Ordinary",
      'smithers:"quoted"',
      "smithers:new\nline",
      "smithers:{brace}",
      "-leading-dash",
      `smithers:${"x".repeat(256)}`,
    ]) {
      expect(() => __vsRegisterError(Ordinary, invalid)).toThrow("invalid stable Error identity");
    }
  });

  test("codec registration rejects collisions and non-JSON output", () => {
    class Collision extends Error {}
    expect(() => __vsRegisterError(Collision, "test:runtime/NotFound@1")).toThrow("already registered");
    class NonJson extends Error {}
    registerErrorCodec(NonJson, "test:runtime/NonJson@1", {
      encode: () => new Date() as never,
      decode: () => new NonJson(),
    });
    expect(() => encodeError(new NonJson())).toThrow("plain JSON object");

    let getterRan = false;
    class AccessorJson extends Error {}
    registerErrorCodec(AccessorJson, "test:runtime/AccessorJson@1", {
      encode: () => {
        const array: unknown[] = [];
        Object.defineProperty(array, 0, { enumerable: true, get() { getterRan = true; return "bad"; } });
        array.length = 1;
        return array as never;
      },
      decode: () => new AccessorJson(),
    });
    expect(() => encodeError(new AccessorJson())).toThrow("data property");
    expect(getterRan).toBe(false);

    class CodecBase extends Error {}
    class CodecSubclass extends CodecBase {}
    registerErrorCodec(CodecBase, "test:runtime/CodecBase@1", {
      encode: () => null,
      decode: () => new CodecSubclass(),
    });
    expect(() => decodeError(encodeError(new CodecBase()))).toThrow("wrong Error type");

    class SnapshotCodec extends Error {}
    const mutableCodec = {
      encode: () => ({ stable: true }),
      decode: () => new SnapshotCodec(),
    };
    registerErrorCodec(SnapshotCodec, "test:runtime/SnapshotCodec@1", mutableCodec);
    mutableCodec.encode = () => ({ stable: false });
    expect(encodeError(new SnapshotCodec())).toContain('"stable":true');
  });

  test("one -0 policy: the Error wire codec refuses negative zero instead of silently coercing it", () => {
    // matches durable/value.ts, schema/json.ts, runtime/wire.ts, and
    // concurrency/worker.ts: stringifyJson renders -0 as "0", so accepting it
    // in assertJson would change the value's identity in transit with no
    // diagnostic. The same literal must not have two fates depending on phase.
    class NegZeroPayload extends Error {}
    registerErrorCodec(NegZeroPayload, "test:runtime/NegZeroPayload@1", {
      encode: () => ({ value: -0 }),
      decode: () => new NegZeroPayload(),
    });
    expect(() => encodeError(new NegZeroPayload())).toThrow("negative zero");

    class NegZeroArrayPayload extends Error {}
    registerErrorCodec(NegZeroArrayPayload, "test:runtime/NegZeroArrayPayload@1", {
      encode: () => [1, -0] as never,
      decode: () => new NegZeroArrayPayload(),
    });
    expect(() => encodeError(new NegZeroArrayPayload())).toThrow("negative zero");

    class ZeroPayload extends Error {}
    registerErrorCodec(ZeroPayload, "test:runtime/ZeroPayload@1", {
      encode: () => ({ value: 0 }),
      decode: () => new ZeroPayload(),
    });
    expect(encodeError(new ZeroPayload())).toContain('"value":0');
  });
});

describe("Result transport", () => {
  const recordCodec = {
    encode: (value: { readonly id: string }) => ({ id: value.id }),
    decode: (payload: import("./index.ts").JsonValue) => {
      if (
        payload === null || Array.isArray(payload) || typeof payload !== "object" ||
        Object.keys(payload).length !== 1 || typeof payload.id !== "string"
      ) throw new TypeError("invalid record payload");
      return { id: payload.id };
    },
  };

  test("round-trips successful and failed envelopes", () => {
    const successWire = encodeResult(__vsResultSuccess({ id: "ok" }), recordCodec);
    expect(successWire).toBe('{"version":1,"kind":"success","value":{"id":"ok"}}');
    expect(decodeResult(successWire, recordCodec).unwrap()).toEqual({ id: "ok" });

    const failureWire = encodeResult(__vsResultFailure(new NotFound("wire")), recordCodec);
    const failure = decodeResult(failureWire, recordCodec, [NotFound]);
    expect(failure.match({ ok: () => "bad", error: (error) => error.id })).toBe("wire");
    expect(() => decodeResult(failureWire, recordCodec, [RangeError])).toThrow(
      "outside its declared channel",
    );

    // Absence travels inside the success payload as `T | undefined`, encoded by
    // the caller's own codec. There is no separate some/none envelope kind.
    const absenceCodec = {
      encode: (value: { readonly id: string } | undefined) => (value === undefined ? null : { id: value.id }),
      decode: (payload: import("./index.ts").JsonValue) =>
        payload === null ? undefined : recordCodec.decode(payload),
    };
    const absentWire = encodeResult(__vsResultSuccess(undefined), absenceCodec);
    expect(absentWire).toBe('{"version":1,"kind":"success","value":null}');
    expect(decodeResult(absentWire, absenceCodec).unwrap()).toBeUndefined();
    const presentWire = encodeResult(__vsResultSuccess({ id: "here" }), absenceCodec);
    expect(decodeResult(presentWire, absenceCodec).unwrap()).toEqual({ id: "here" });
  });

  test("rejects noncanonical, hostile, oversized, and invalid codec data", () => {
    expect(() => decodeResult(
      '{"kind":"success","version":1,"value":{"id":"ok"}}',
      recordCodec,
    )).toThrow("not canonical JSON");
    expect(() => decodeResult('{"version":1,"kind":"success","value":{"id":"ok"},"extra":true}', recordCodec)).toThrow(
      "unexpected fields",
    );
    expect(() => decodeResult(`{"version":1,"kind":"success","value":{"id":"${"x".repeat(1_048_576)}"}}`, recordCodec)).toThrow(
      "wire limit",
    );

    let getterRan = false;
    const hostileCodec = {
      encode: () => {
        const payload = {} as { id?: string };
        Object.defineProperty(payload, "id", {
          enumerable: true,
          get() { getterRan = true; return "unsafe"; },
        });
        return payload as never;
      },
      decode: () => ({ id: "unused" }),
    };
    expect(() => encodeResult(__vsResultSuccess({ id: "unsafe" }), hostileCodec)).toThrow(ValueCodecError);
    expect(getterRan).toBe(false);

    expect(() => decodeResult(
      '{"version":1,"kind":"success","value":{"id":1}}',
      recordCodec,
    )).toThrow(ValueCodecError);
  });
});

describe("Context and lean Layer environments", () => {
  abstract class Label extends Context { abstract readonly value: string }

  test("Context.context is nominal and isolated across overlapping async scopes", async () => {
    const first = Layer.succeed(Label, { value: "first" });
    const second = Layer.succeed(Label, { value: "second" });
    expect(isLayer(first)).toBe(true);
    expect(Layer.provide(first, () => Label.context().value)).toBe("first");
    // This test used to stop here on Bun, because `Layer.provide` REFUSED an
    // async body on any host without V8 promise hooks and Bun is such a host —
    // so the overlapping-scope claim below, which is the whole point of the
    // test, was never measured on the runtime every test in this repository
    // executes on. Deleting the promise-hook apparatus retired that refusal
    // (`specification/requirements.mdx` §Scoping: a runtime "MUST NOT refuse an
    // async provider scope on a host that cannot observe Promise settlement
    // synchronously"), so the rest of this test now runs everywhere.
    const readLater = async (delay: number) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return Label.context().value;
    };
    expect(await Promise.all([
      Layer.provide(first, () => readLater(8)),
      Layer.provide(second, () => readLater(1)),
    ])).toEqual(["first", "second"]);
    expect(isPanic(catchPanic(() => Label.context(), (error) => error))).toBe(true);
  });

  test("Layer is opaque and fails closed on unresolved merge and override precedence", () => {
    const layer = Layer.succeed(Label, { value: "value" });
    expect(Object.isFrozen(layer)).toBe(true);
    expect(Object.keys(layer)).toEqual([]);
    expect(isLayer({})).toBe(false);
    expect(isPanic(catchPanic(() => Layer.provide({} as never, () => 1), (error) => error))).toBe(true);
    expect(() => Layer.merge(layer, layer)).toThrow("duplicate capability");
    expect(() => Layer.provide(layer, () => Layer.provide(layer, () => 1))).toThrow("not specified");
  });

  test("Layer owns neither resources nor hidden child work", async () => {
    const layer = Layer.succeed(Label, { value: "lean" });
    let release!: () => void;
    let childFinished = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const returned = Layer.provide(layer, () => {
      void (async () => {
        await gate;
        childFinished = true;
      })();
      return "body settled";
    });
    expect(returned).toBe("body settled");
    expect(childFinished).toBe(false);
    release();
    await gate;
    await Promise.resolve();
    expect(childFinished).toBe(true);
  });

  test("Layer capability scope expires when the returned body value settles", async () => {
    const layer = Layer.succeed(Label, { value: "scoped" });
    let releaseDetached!: () => void;
    const detachedGate = new Promise<void>((resolve) => { releaseDetached = resolve; });
    let detached!: Promise<unknown>;

    const returned = Layer.provide(layer, () => {
      detached = (async () => {
        await detachedGate;
        return catchPanic(() => Label.context().value, (error) => error);
      })();
      return "body settled";
    });

    expect(returned).toBe("body settled");
    releaseDetached();
    expect(isPanic(await detached)).toBe(true);

    const asynchronous = Layer.provide(layer, async () => {
      await Promise.resolve();
      return Label.context().value;
    });
    expect(await asynchronous).toBe("scoped");
  });

  /**
   * The author-visible wart the promise-hook apparatus imposed, asserted gone.
   *
   * That apparatus tracked Promise PROVENANCE — it refused any Promise the
   * provider body had not itself created, because a pre-existing one may carry
   * reactions registered before the observer — and told the author to write
   * `async () => await promise` instead. `specification/requirements.mdx`
   * §Scoping now prohibits exactly that: a runtime "MUST NOT restrict which
   * Promise a provider body returns".
   *
   * The scope still ends when that Promise settles, which is the half a
   * permissive rewrite could get wrong by simply never revoking.
   */
  test("a provider body may return a Promise it did not create", async () => {
    const layer = Layer.succeed(Label, { value: "handed-in" });
    const existing = Promise.resolve("pre-existing");
    expect(await Layer.provide(layer, () => existing)).toBe("pre-existing");
    expect(isPanic(catchPanic(() => Label.context(), (error) => error))).toBe(true);
  });
});
