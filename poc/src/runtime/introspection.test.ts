import { describe, expect, test } from "bun:test";
import {
  __vsRegisterError,
  decodeError,
  encodeError,
  errorIs,
  errorIdentity,
  registerErrorCodec,
  registerErrorType,
} from "./errors.ts";
import { assertNoPanic, isPanic, isResult } from "./introspection.ts";
import * as introspection from "./introspection.ts";
import { Panic, catchPanic, makePanic } from "./panic.ts";
import { ResultValue, __vsResultFailure, __vsResultSuccess } from "./result.ts";

/**
 * The brand-introspection seam and the compiler-derived transport codec.
 *
 * Both exist so a `.sm` standard-library module can do something it previously
 * could not, and both are only worth having if the guarantee they re-expose is
 * the *same* guarantee the runtime enforces internally. That is what this file
 * measures: not that the seam answers, but that it answers `false` to every
 * look-alike a shape test would have accepted.
 */

class Sample extends Error {}

describe("isResult re-exposes the runtime brand, not a shape", () => {
  test("a runtime-constructed Result is recognized in both variants", () => {
    expect(isResult(__vsResultSuccess("value"))).toBe(true);
    expect(isResult(__vsResultFailure(new Sample("failed")))).toBe(true);
  });

  test("every forgery a shape test would accept is refused", () => {
    // The exact substitute poc/src/data/match.ts's docstring forbids: a brand
    // check must "never be a shape test — so a look-alike is never routed".
    const shape = { isOk: () => true, isError: () => false, match: () => 1, unwrapOr: (value: unknown) => value };
    expect("isOk" in shape).toBe(true);
    expect(isResult(shape)).toBe(false);

    expect(isResult(Object.create(ResultValue.prototype))).toBe(false);
    class Impostor extends (ResultValue as unknown as new () => object) {
      isOk(): boolean { return true; }
    }
    expect(isResult(new Impostor())).toBe(false);
    // A Proxy forwards every property read to a real Result and is still not
    // the object the runtime put in its WeakSet.
    expect(isResult(new Proxy(__vsResultSuccess("value") as object, {}))).toBe(false);
  });

  test("non-objects and ordinary values are refused without throwing", () => {
    for (const value of [undefined, null, 0, -0, NaN, "", "ok", true, Symbol("s"), 1n, [], {}, () => {}]) {
      expect(isResult(value)).toBe(false);
    }
  });

  test("the predicate narrows, which is what makes it usable as a guard", () => {
    const value: unknown = __vsResultSuccess("narrowed");
    expect(isResult(value) ? value.isOk() : "not a result").toBe(true);
  });
});

describe("isPanic re-exposes the distinguished-channel brand", () => {
  test("a runtime-constructed Panic is recognized and a look-alike is not", () => {
    expect(isPanic(makePanic("boom"))).toBe(true);
    expect(isPanic(Object.create(Panic.prototype))).toBe(false);
    expect(isPanic(new Error("ordinary"))).toBe(false);
    expect(isPanic(undefined)).toBe(false);
  });
});

describe("assertNoPanic is the rethrowPanics seam, and it is narrow on purpose", () => {
  test("an ordinary Result passes through and the caller keeps the very same value", () => {
    const success = __vsResultSuccess(7) as unknown as ResultValue<number, Sample | Panic>;
    assertNoPanic(success);
    expect(success.isOk()).toBe(true);
    // The seam returns nothing, so the caller's own reference is what survives
    // — still the runtime's own branded object, not a copy. That is the whole
    // reason SMITHERS1508 has nothing to fire on afterwards.
    expect(isResult(success)).toBe(true);

    const failure = __vsResultFailure(new Sample("recoverable")) as unknown as ResultValue<number, Sample | Panic>;
    assertNoPanic(failure);
    expect(failure.isError()).toBe(true);
  });

  test("a materialized panic RESUMES unwinding rather than being swallowed", () => {
    // specification/failures.mdx, Foreign Exceptions: "Ordinary Result recovery
    // MUST NOT swallow panic implicitly." Reporting it as an ordinary failure
    // would be the same defect wearing a different hat, so the test asserts the
    // identity of the escaping value, not merely that something was raised.
    const raised = makePanic("invariant broken");
    const materialized = __vsResultFailure(raised) as unknown as ResultValue<number, Sample | Panic>;
    const escaped = catchPanic(() => { assertNoPanic(materialized); return "swallowed"; }, (failure) => failure);
    expect(escaped).toBe(raised);
    expect(isPanic(escaped)).toBe(true);
  });

  test("a FORGED Result cannot assert itself panic-free", () => {
    // The forgery guarantee is inherited from the runtime's private-WeakSet
    // brand, not re-implemented here: a shape test would have accepted every
    // one of these.
    const forgeries: unknown[] = [
      { isOk: () => true, isError: () => false },
      Object.create(ResultValue.prototype),
      new Proxy(__vsResultSuccess(1) as object, {}),
      { ok: false, error: makePanic("forged") },
    ];
    for (const forged of forgeries) {
      const escaped = catchPanic(
        () => { assertNoPanic(forged as ResultValue<number, Sample | Panic>); return "accepted"; },
        (failure) => failure.message,
      );
      expect(escaped).toBe("forged Result value");
    }
  });

  test("the seam exposes nothing that can CONSTRUCT a Result, a Panic, or an Error", () => {
    // Trusting result.ts wholesale would put __vsResultSuccess/__vsResultFailure
    // one import away from authored .sm and let a hand-forged Result compile
    // with zero errors. This module is the narrow alternative, and the claim is
    // only worth making if the export list is pinned.
    expect(Object.keys(introspection).sort()).toEqual(["assertNoPanic", "isPanic", "isResult"]);
    for (const name of ["__vsResultSuccess", "__vsResultFailure", "__vsInspectResult", "ResultValue", "Panic", "panic"]) {
      expect(name in introspection).toBe(false);
    }
  });

  test("it returns undefined, so nothing crosses back that could carry provenance", () => {
    const ok = __vsResultSuccess(1) as unknown as ResultValue<number, Sample | Panic>;
    expect((assertNoPanic as (value: unknown) => unknown)(ok)).toBeUndefined();
  });
});

describe("the compiler hook derives transport metadata", () => {
  class InvalidPath extends Error {
    constructor(readonly path: string, readonly reason: string) {
      super(`invalid path ${path}: ${reason}`);
      this.name = "InvalidPath";
    }
  }
  __vsRegisterError(InvalidPath, "test:introspection/InvalidPath");

  class Fieldless extends Error {}
  __vsRegisterError(Fieldless, "test:introspection/Fieldless");

  class Deleted extends InvalidPath {}
  __vsRegisterError(Deleted, "test:introspection/Deleted");

  test("a declared error round-trips with its fields, message, and name", () => {
    const original = new InvalidPath("/etc", "not a directory");
    const decoded = decodeError(encodeError(original)) as InvalidPath;
    expect(decoded.path).toBe("/etc");
    expect(decoded.reason).toBe("not a directory");
    expect(decoded.message).toBe("invalid path /etc: not a directory");
    expect(decoded.name).toBe("InvalidPath");
  });

  test("ordinary Error behavior survives the round trip", () => {
    const decoded = decodeError(encodeError(new InvalidPath("/tmp", "gone")));
    expect(decoded instanceof Error).toBe(true);
    expect(decoded instanceof InvalidPath).toBe(true);
    expect(typeof decoded.stack).toBe("string");
    expect(Object.getPrototypeOf(decoded)).toBe(InvalidPath.prototype);
  });

  test("nominal identity survives and does not widen to a sibling", () => {
    const decoded = decodeError(encodeError(new InvalidPath("/a", "b")));
    expect(errorIs(decoded, InvalidPath)).toBe(true);
    expect(errorIs(decoded, Fieldless)).toBe(false);
    expect(errorIdentity(decoded)).toBe("test:introspection/InvalidPath");
  });

  test("a subclass keeps its own identity and its ancestor's narrowing", () => {
    const decoded = decodeError(encodeError(new Deleted("/x", "y"))) as Deleted;
    expect(errorIdentity(decoded)).toBe("test:introspection/Deleted");
    expect(errorIs(decoded, Deleted)).toBe(true);
    expect(errorIs(decoded, InvalidPath)).toBe(true);
    expect(decoded.path).toBe("/x");
  });

  test("a fieldless error carries only its message", () => {
    expect(encodeError(new Fieldless("plain")))
      .toBe('{"version":1,"identity":"test:introspection/Fieldless","payload":{"message":"plain"}}');
  });

  test("a declared field named __proto__ crosses the wire as ordinary data", () => {
    // The `.sm` front end accepts `__proto__` as a declared Error payload field
    // name. Building the payload as `{}` and writing `payload[key] = value`
    // would route that name through the accessor `Object.prototype` defines for
    // it: a primitive would vanish from the wire with no diagnostic, and an
    // object would become the payload's prototype and make `assertJson` refuse
    // the whole error. Both contradict this codec's own promise that an
    // undurable field is a diagnostic rather than a silently dropped one.
    class Prototypical extends Error {
      readonly __proto__: string = "declared-value";
      readonly constructor_: number = 1;
      constructor() {
        super("prototypical");
        this.name = "Prototypical";
      }
    }
    __vsRegisterError(Prototypical, "test:introspection/Prototypical");

    const wire = encodeError(new Prototypical());
    expect(wire).toBe(
      '{"version":1,"identity":"test:introspection/Prototypical",' +
      '"payload":{"__proto__":"declared-value","constructor_":1,"message":"prototypical","name":"Prototypical"}}',
    );
    const decoded = decodeError(wire) as Prototypical;
    expect(Object.prototype.hasOwnProperty.call(decoded, "__proto__")).toBe(true);
    expect(decoded["__proto__"]).toBe("declared-value");
    expect(Object.getPrototypeOf(decoded)).toBe(Prototypical.prototype);
    expect(decoded.message).toBe("prototypical");

    // An object-valued one used to make `assertJson` refuse the whole error.
    class NestedPrototypical extends Error {
      readonly __proto__: { tag: string } = { tag: "A" };
      constructor() {
        super("nested");
        this.name = "NestedPrototypical";
      }
    }
    __vsRegisterError(NestedPrototypical, "test:introspection/NestedPrototypical");
    const nested = decodeError(encodeError(new NestedPrototypical())) as NestedPrototypical;
    expect(nested["__proto__"]).toEqual({ tag: "A" });
    expect(Object.getPrototypeOf(nested)).toBe(NestedPrototypical.prototype);
  });

  test("nested plain data derives; an ephemeral field is refused by path", () => {
    class Structured extends Error {
      constructor(readonly detail: { code: number; tags: string[] }) { super("structured"); }
    }
    __vsRegisterError(Structured, "test:introspection/Structured");
    const decoded = decodeError(encodeError(new Structured({ code: 7, tags: ["a", "b"] }))) as Structured;
    expect(decoded.detail).toEqual({ code: 7, tags: ["a", "b"] });

    class WithHandle extends Error {
      constructor(readonly close: () => void) { super("handle"); }
    }
    __vsRegisterError(WithHandle, "test:introspection/WithHandle");
    expect(() => encodeError(new WithHandle(() => {}))).toThrow("$.payload.close is not JSON data");
  });

  test("an explicit codec replaces the derived one; two explicit codecs still collide", () => {
    class Custom extends Error {
      constructor(readonly n: number) { super("custom"); }
    }
    __vsRegisterError(Custom, "test:introspection/Custom");
    registerErrorCodec(Custom, "test:introspection/Custom", {
      encode: (error) => ({ n: error.n }),
      decode: (payload) => new Custom((payload as { n: number }).n),
    });
    expect(encodeError(new Custom(3)))
      .toBe('{"version":1,"identity":"test:introspection/Custom","payload":{"n":3}}');

    class Twice extends Error {}
    registerErrorCodec(Twice, "test:introspection/Twice", { encode: () => ({}), decode: () => new Twice() });
    expect(() => registerErrorCodec(Twice, "test:introspection/Twice", {
      encode: () => ({ x: 1 }), decode: () => new Twice(),
    })).toThrow("is already registered");
  });

  test("registerErrorType stays identity-only: the MUST is on the compiler", () => {
    class HandWritten extends Error {}
    registerErrorType(HandWritten, "test:introspection/HandWritten");
    expect(errorIdentity(new HandWritten("x"))).toBe("test:introspection/HandWritten");
    expect(() => encodeError(new HandWritten("x"))).toThrow("no registered transport codec");
  });

  test("an unregistered wire identity is still refused", () => {
    expect(() => decodeError('{"version":1,"identity":"test:introspection/Absent","payload":{"message":"x"}}'))
      .toThrow("unknown Error identity");
  });
});
