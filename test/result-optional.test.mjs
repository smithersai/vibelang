import assert from "node:assert/strict";
import test from "node:test";

import {
  Result,
  UnhandledException,
  __resultError,
  __resultSuccess,
  __setErrorIdentity,
} from "vibelang/result";
import {
  MissingOptionalValue,
  Optional,
  __optionalAbsent,
  __optionalPresent,
} from "vibelang/optional";

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
    .andThen((value) => value + 1)
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
    missing.match({
      "domain/NotFound": (error) => error.id,
    }),
    "abc",
  );

  const wrapped = new Error("wrapped", { cause: missing });
  assert.equal(wrapped.rootCause(), missing);
});

test("Result.try and tryPromise turn foreign throws and rejections into errors", async () => {
  const synchronous = Result.try(() => {
    throw "bad";
  });
  assert.equal(synchronous.isError(), true);
  assert.ok(synchronous.error instanceof UnhandledException);

  const asynchronous = await Result.tryPromise(async () => {
    throw new Error("rejected");
  });
  assert.equal(asynchronous.isError(), true);
  assert.ok(asynchronous.error instanceof UnhandledException);
});

test("Optional provides Result-like operations without public some/none constructors", () => {
  assert.equal("some" in Optional, false);
  assert.equal("none" in Optional, false);

  const present = __optionalPresent(2).map((value) => value * 4);
  assert.equal(present.unwrap(), 8);
  assert.equal(present.match({ some: String, none: () => "none" }), "8");

  const absent = __optionalAbsent();
  assert.equal(absent.isNone(), true);
  assert.equal(absent.unwrapOr(5), 5);
  assert.throws(() => absent.unwrap(), MissingOptionalValue);

  const converted = Optional.fromNullable(null).toResult(new NotFound("none"));
  assert.equal(converted.isError(), true);
});
