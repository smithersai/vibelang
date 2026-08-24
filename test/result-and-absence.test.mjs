import assert from "node:assert/strict";
import test from "node:test";

import {
  Result,
  __resultError,
  __resultSuccess,
  __setErrorIdentity,
  errorCases,
  errorIdentity,
} from "smthrs/result";
import { Panic } from "smthrs/exceptions";

class NotFound extends Error {
  constructor(id) {
    super(`Not found: ${id}`);
    this.id = id;
    this.name = "NotFound";
  }
}

class Timeout extends Error {}

test("Result supports compiler-created variants without public ok/err constructors", () => {
  assert.equal("ok" in Result, false);
  assert.equal("err" in Result, false);

  const success = __resultSuccess(2).map((value) => value * 3);
  assert.equal(success.unwrap(), 6);

  const failure = __resultError(new NotFound("42"));
  assert.equal(failure.isError(), true);
  assert.equal(failure.unwrapOr(7), 7);
  assert.throws(() => failure.unwrap(), NotFound);
});

test("Result composition preserves errors and supports exhaustive-shaped matching", () => {
  const result = __resultSuccess(3)
    .andThen((value) => __resultSuccess(value + 1))
    .andThen(() => __resultError(new Timeout("late")));

  assert.equal(
    result.match({
      ok: () => "ok",
      error: (error) => error.name,
    }),
    "Error",
  );
});

test("Error prototype helpers use nominal identity and causes", () => {
  const missing = new NotFound("abc");
  __setErrorIdentity(missing, "domain/NotFound");

  assert.equal(missing.is(NotFound), true);
  assert.equal(missing.matches(Timeout, NotFound), true);
  assert.equal(
    missing.match(errorCases([NotFound, (error) => error.id])),
    "abc",
  );
  assert.equal(errorIdentity(missing), "domain/NotFound");

  const wrapped = new Error("wrapped", { cause: missing });
  assert.equal(wrapped.rootCause(), missing);
});

test("Result.try and tryPromise preserve unexpected foreign throws as Panic", async () => {
  const synchronous = Result.try(() => {
    throw "bad";
  });
  assert.equal(synchronous.isError(), true);
  assert.equal(
    synchronous.match({ ok: () => false, error: (error) => error instanceof Panic }),
    true,
  );

  const asynchronous = await Result.tryPromise(async () => {
    throw new Error("rejected");
  });
  assert.equal(asynchronous.isError(), true);
  assert.equal(
    asynchronous.match({ ok: () => false, error: (error) => error instanceof Panic }),
    true,
  );
});

test("absence is `T | undefined`, read with narrowing, optional chaining, and `??`", () => {
  const users = new Map([["1", "Ada"]]);
  const find = (id) => users.get(id);

  const hit = find("1");
  assert.equal(hit, "Ada");
  assert.equal(find("2"), undefined);

  // `?.` and `??` keep their ordinary nullish meaning.
  assert.equal(find("1")?.length, 3);
  assert.equal(find("2")?.length, undefined);
  assert.equal(find("1") ?? "Guest", "Ada");
  assert.equal(find("2") ?? "Guest", "Guest");

  // `??` coalesces only null/undefined, so a falsy present value survives.
  const counts = new Map([["zero", 0]]);
  assert.equal(counts.get("zero") ?? -1, 0);
  assert.equal(counts.get("missing") ?? -1, -1);
  assert.equal(counts.get("zero") || -1, -1);

  // `T | null` behaves the same way.
  const nothing = null;
  assert.equal(nothing ?? "Guest", "Guest");
  assert.equal(nothing?.length, undefined);
});

test("absence and typed failure stay on different axes", () => {
  const users = new Map([["1", "Ada"]]);
  // A function that can both fail and find nothing: Result<A | undefined, E>.
  const lookup = (id) =>
    id === "boom" ? __resultError(new NotFound(id)) : __resultSuccess(users.get(id));

  assert.equal(lookup("1").unwrap(), "Ada");
  // An absent success is still a success, not an error.
  assert.equal(lookup("2").isOk(), true);
  assert.equal(lookup("2").unwrap(), undefined);
  assert.equal(lookup("2").unwrap() ?? "Guest", "Guest");
  assert.equal(lookup("boom").isError(), true);
});

test("a user's own value named Optional is ordinary code", () => {
  const Optional = {
    of: (value) => ({ present: true, value }),
    empty: () => ({ present: false }),
  };
  const mine = Optional.of("Ada");
  assert.equal(mine.present, true);
  assert.equal(mine.value, "Ada");
  assert.equal(Optional.empty().value, undefined);
  assert.deepEqual(Object.keys(mine).sort(), ["present", "value"]);
});

test("the withdrawn `smthrs/optional` subpath no longer resolves", async () => {
  await assert.rejects(
    () => import("smthrs/optional"),
    (error) => error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});
