import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  Context,
  ErrorCodecError,
  Layer,
  MissingOptionalValue,
  Optional,
  Panic,
  Result,
  RuntimeValues,
  __vsErrorCases,
  __vsInspectOptional,
  __vsInspectResult,
  __vsOptionalNone,
  __vsOptionalSome,
  __vsPanicValue,
  __vsRegisterError,
  __vsResultFailure,
  __vsResultSuccess,
  __vsValidateForeignError,
  catchPanic,
  catchPanicPromise,
  decodeError,
  decodeOptional,
  decodeResult,
  encodeError,
  encodeOptional,
  encodeResult,
  errorIdentity,
  isLayer,
  isOptional,
  isPanic,
  isResult,
  registerErrorCodec,
  rethrowPanics,
  ValueCodecError,
} from "./index.ts";
import type { Optional as OptionalType, Result as ResultType } from "./index.ts";

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

describe("hardened Result and Optional runtime", () => {
  test("Result exposes value operations but no author constructors", () => {
    expect("ok" in Result).toBe(false);
    expect("err" in Result).toBe(false);
    expect(Object.isFrozen(Result)).toBe(true);
    expect(Object.keys(Result).sort()).toEqual(["all", "try", "tryPromise"]);
    const success: ResultType<number, never> = __vsResultSuccess(2);
    const failure = __vsResultFailure(new NotFound("a"));
    for (const method of [
      "isOk", "isError", "match", "map", "mapError", "andThen", "recover",
      "tap", "tapError", "unwrap", "unwrapOr", "expect",
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
    expect(isPanic(catchPanic(
      () => Result.try(() => { throw new RangeError("wrong contract"); }, (cause) => __vsValidateForeignError(cause, NotFound)),
      (error) => error,
    ))).toBe(true);

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

  test("Optional is unforgeable, null-safe, and distinct from Result failure", () => {
    expect("some" in Optional).toBe(false);
    expect("none" in Optional).toBe(false);
    expect(Object.isFrozen(Optional)).toBe(true);
    expect(Object.keys(Optional).sort()).toEqual(["all", "fromNullable"]);
    const some: OptionalType<string> = __vsOptionalSome("value");
    const none = __vsOptionalNone();
    for (const method of [
      "isSome", "isNone", "match", "map", "andThen", "filter", "tap", "unwrap",
      "unwrapOr", "toResult", "toNullable",
    ] as const) {
      expect(typeof some[method]).toBe("function");
    }
    expect(isOptional(some)).toBe(true);
    expect(Object.isFrozen(none)).toBe(true);
    expect(Optional.fromNullable(undefined).isNone()).toBe(true);
    expect(some.map((value) => value.length).unwrap()).toBe(5);
    expect(some.map(() => null).isNone()).toBe(true);
    expect(none.unwrapOr(() => "fallback")).toBe("fallback");
    expect(__vsInspectOptional(some)).toEqual({ some: true, value: "value" });
    expect(__vsInspectOptional(none)).toEqual({ some: false });
    expect(Optional.all([some, __vsOptionalSome("other")]).unwrap()).toEqual(["value", "other"]);
    expect(none.toResult(() => new NotFound("none")).match({ ok: () => "bad", error: (error) => error.id })).toBe("none");
    try {
      none.unwrap();
      throw new Error("expected unwrap to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(MissingOptionalValue);
      expect(isPanic(error)).toBe(true);
    }
    const forged = Object.create(Object.getPrototypeOf(some));
    expect(isOptional(forged)).toBe(false);
    expect(isPanic(catchPanic(() => Optional.all([forged]), (error) => error))).toBe(true);
  });

  test("Optional methods are branch-lazy and reject invalid chained values", () => {
    const some = __vsOptionalSome(5);
    const none = __vsOptionalNone();
    const inactive = (): never => Reflect.panic("inactive Optional branch ran");

    expect(some.isSome()).toBe(true);
    expect(some.isNone()).toBe(false);
    expect(none.isSome()).toBe(false);
    expect(none.isNone()).toBe(true);
    expect(some.match({ some: (value) => value * 2, none: inactive })).toBe(10);
    expect(none.match({ some: inactive, none: () => "none" })).toBe("none");
    expect(isPanic(catchPanic(
      () => some.match({ some: (value: number) => value, none: undefined } as never),
      (error) => error,
    ))).toBe(true);

    expect(none.map(inactive)).toBe(none);
    expect(none.andThen(inactive)).toBe(none);
    expect(some.andThen((value) => __vsOptionalSome(value + 1)).unwrap()).toBe(6);
    expect(isPanic(catchPanic(
      () => some.andThen(() => Object.freeze({}) as never),
      (error) => error,
    ))).toBe(true);
    expect(some.filter((value) => value === 5)).toBe(some);
    expect(some.filter(() => false)).toBe(none);
    expect(none.filter(inactive)).toBe(none);

    let observations = 0;
    expect(some.tap(() => { observations++; })).toBe(some);
    expect(none.tap(() => { observations++; })).toBe(none);
    expect(observations).toBe(1);
    expect(some.unwrapOr(inactive)).toBe(5);

    let errorThunkCalls = 0;
    expect(some.toResult(() => {
      errorThunkCalls++;
      return new NotFound("unused");
    }).unwrap()).toBe(5);
    expect(errorThunkCalls).toBe(0);
    const directError = new NotFound("direct");
    expect(none.toResult(directError).match({ ok: inactive, error: (error) => error })).toBe(directError);
    expect(some.toNullable()).toBe(5);
    expect(none.toNullable()).toBeNull();
    expect(Optional.fromNullable(0).unwrap()).toBe(0);
    expect(Optional.fromNullable(null).isNone()).toBe(true);

    let advancedPastNone = false;
    function* optionals() {
      yield some;
      yield none as OptionalType<number>;
      advancedPastNone = true;
      yield __vsOptionalSome(7);
    }
    expect(Optional.all(optionals())).toBe(none);
    expect(advancedPastNone).toBe(false);

    const foreignError = runInNewContext("new Error('foreign')") as Error;
    expect(isPanic(catchPanic(
      () => none.toResult(foreignError),
      (error) => error,
    ))).toBe(true);
  });
});

describe("RuntimeValues library construction surface", () => {
  test("is a frozen namespace over the compiler's own constructors and names nothing author-facing", () => {
    expect(Object.isFrozen(RuntimeValues)).toBe(true);
    expect(Object.keys(RuntimeValues).sort()).toEqual(["absent", "failure", "present", "success"]);
    for (const banned of ["ok", "err", "some", "none", "of", "from"]) {
      expect(banned in RuntimeValues).toBe(false);
    }
    // The authoring namespaces stay free of variant constructors (DECISIONS.md).
    expect(Object.keys(Result).sort()).toEqual(["all", "try", "tryPromise"]);
    expect(Object.keys(Optional).sort()).toEqual(["all", "fromNullable"]);
    expect(RuntimeValues.success).toBe(__vsResultSuccess);
    expect(RuntimeValues.failure).toBe(__vsResultFailure);
    expect(RuntimeValues.present).toBe(__vsOptionalSome);
    expect(RuntimeValues.absent).toBe(__vsOptionalNone);
  });

  test("produces the same frozen, branded, unforgeable variants as the lowering hooks", () => {
    const success = RuntimeValues.success(2);
    const failure = RuntimeValues.failure(new NotFound("library"));
    const present = RuntimeValues.present("here");
    const absent = RuntimeValues.absent();

    expect(isResult(success)).toBe(true);
    expect(isResult(failure)).toBe(true);
    expect(isOptional(present)).toBe(true);
    expect(isOptional(absent)).toBe(true);
    expect(Object.isFrozen(success)).toBe(true);
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(present)).toBe(true);
    expect(absent).toBe(__vsOptionalNone());
    expect(Object.getPrototypeOf(success)).toBe(Object.getPrototypeOf(__vsResultSuccess(1)));
    expect(Object.getPrototypeOf(present)).toBe(Object.getPrototypeOf(__vsOptionalSome(1)));
    expect(success.unwrap()).toBe(2);
    expect(failure.match({ ok: () => "bad", error: (error) => error.id })).toBe("library");
    expect(present.unwrap()).toBe("here");
    expect(absent.isNone()).toBe(true);
    expect(encodeResult(success, { encode: (value) => value, decode: (payload) => payload as number }))
      .toBe('{"version":1,"kind":"success","value":2}');
  });

  test("keeps every construction invariant of the lowering hooks", () => {
    const foreignError = runInNewContext("new Error('foreign realm')") as Error;
    expect(isPanic(catchPanic(() => RuntimeValues.failure(foreignError), (error) => error))).toBe(true);
    expect(isPanic(catchPanic(() => RuntimeValues.present(null), (error) => error))).toBe(true);
    expect(isPanic(catchPanic(() => RuntimeValues.present(undefined), (error) => error))).toBe(true);
    expect(isResult(Object.create(Object.getPrototypeOf(RuntimeValues.success(1))))).toBe(false);
    expect(isOptional(Object.create(Object.getPrototypeOf(RuntimeValues.present(1))))).toBe(false);
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

    const subclass = new MissingOptionalValue("absent value crossed a boundary");
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
      [Symbol.for("vibelang.failure")]: true,
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
});

describe("Result and Optional transport", () => {
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

  test("round-trips successful, failed, present, and absent envelopes", () => {
    const successWire = encodeResult(__vsResultSuccess({ id: "ok" }), recordCodec);
    expect(successWire).toBe('{"version":1,"kind":"success","value":{"id":"ok"}}');
    expect(decodeResult(successWire, recordCodec).unwrap()).toEqual({ id: "ok" });

    const failureWire = encodeResult(__vsResultFailure(new NotFound("wire")), recordCodec);
    const failure = decodeResult(failureWire, recordCodec, [NotFound]);
    expect(failure.match({ ok: () => "bad", error: (error) => error.id })).toBe("wire");
    expect(() => decodeResult(failureWire, recordCodec, [RangeError])).toThrow(
      "outside its declared channel",
    );

    const someWire = encodeOptional(__vsOptionalSome({ id: "some" }), recordCodec);
    expect(decodeOptional(someWire, recordCodec).unwrap()).toEqual({ id: "some" });
    const noneWire = encodeOptional(__vsOptionalNone(), recordCodec);
    expect(noneWire).toBe('{"version":1,"kind":"none"}');
    expect(decodeOptional(noneWire, recordCodec).isNone()).toBe(true);
  });

  test("rejects noncanonical, hostile, oversized, and invalid codec data", () => {
    expect(() => decodeResult(
      '{"kind":"success","version":1,"value":{"id":"ok"}}',
      recordCodec,
    )).toThrow("not canonical JSON");
    expect(() => decodeOptional('{"version":1,"kind":"none","extra":true}', recordCodec)).toThrow(
      "unexpected fields",
    );
    expect(() => decodeOptional(`{"version":1,"kind":"some","value":{"id":"${"x".repeat(1_048_576)}"}}`, recordCodec)).toThrow(
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

    expect(() => decodeOptional(
      '{"version":1,"kind":"some","value":{"id":1}}',
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
    if (process.versions.bun) {
      expect(Layer.provide(first, () => Label.context().value)).toBe("first");
      expect(() => Layer.provide(first, async () => "unsupported")).toThrow(
        "exact Promise settlement hooks are unavailable",
      );
      return;
    }
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

    if (process.versions.bun) {
      expect(() => Layer.provide(layer, async () => "unsupported")).toThrow(
        "exact Promise settlement hooks are unavailable",
      );
      return;
    }
    const asynchronous = Layer.provide(layer, async () => {
      await Promise.resolve();
      return Label.context().value;
    });
    expect(await asynchronous).toBe("scoped");
  });
});
