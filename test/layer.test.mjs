import assert from "node:assert/strict";
import { test } from "node:test";
import { Context } from "smthrs/context";
import { catchPanic, isPanic } from "smthrs/exceptions";
import { Layer } from "smthrs/provider";

class Label extends Context {}

const layer = Layer.succeed(Label, { value: "scoped" });
const readLabel = () => catchPanic(() => Label.context().value, (error) => error);

test("Layer revokes before reactions queued ahead of its settlement observer", async () => {
  let resolve;
  let olderReaction;
  const returned = Layer.provide(layer, () => {
    const promise = new Promise((release) => { resolve = release; });
    promise.then(() => { olderReaction = readLabel(); });
    return promise;
  });

  resolve();
  await returned;
  await Promise.resolve();
  assert.equal(isPanic(olderReaction), true);
});

test("Layer rejects an external Promise and revokes callbacks it already captured", async () => {
  let resolve;
  let olderReaction;
  const external = new Promise((release) => { resolve = release; });

  assert.throws(
    () => Layer.provide(layer, () => {
      external.then(() => { olderReaction = readLabel(); });
      return external;
    }),
    /Promise created by that body/,
  );

  resolve();
  await external;
  await Promise.resolve();
  assert.equal(isPanic(olderReaction), true);

  let releaseAdapted;
  const adaptedExternal = new Promise((release) => { releaseAdapted = release; });
  const adapted = Layer.provide(layer, async () => {
    await adaptedExternal;
    return Label.context().value;
  });
  releaseAdapted();
  assert.equal(await adapted, "scoped");
});

test("Layer revokes already-settled and rejected Promise scopes synchronously", async () => {
  let queuedAfterFulfillment;
  const fulfilled = Layer.provide(layer, () => {
    const promise = Promise.resolve("done");
    queueMicrotask(() => { queuedAfterFulfillment = readLabel(); });
    return promise;
  });
  await fulfilled;
  await Promise.resolve();
  assert.equal(isPanic(queuedAfterFulfillment), true);

  let reject;
  let olderRejection;
  const rejected = Layer.provide(layer, () => {
    const promise = new Promise((_resolve, fail) => { reject = fail; });
    promise.then(undefined, () => { olderRejection = readLabel(); });
    return promise;
  });
  reject(new Error("expected"));
  await assert.rejects(rejected, /expected/);
  await Promise.resolve();
  assert.equal(isPanic(olderRejection), true);
});

test("nested Layer scopes share only the returned Promise lifetime", async () => {
  class Inner extends Context {}
  const inner = Layer.succeed(Inner, { value: "inner" });
  let resolve;
  let olderReaction;

  const returned = Layer.provide(layer, () => Layer.provide(inner, () => {
    const promise = new Promise((release) => { resolve = release; });
    promise.then(() => {
      olderReaction = [readLabel(), catchPanic(() => Inner.context().value, (error) => error)];
    });
    return promise;
  }));

  const registeredAfterReturn = returned.then(() => readLabel());
  resolve();
  await returned;
  assert.equal(isPanic(olderReaction[0]), true);
  assert.equal(isPanic(olderReaction[1]), true);
  assert.equal(isPanic(await registeredAfterReturn), true);
});

test("overlapping async Layer scopes keep independent environments", async () => {
  const other = Layer.succeed(Label, { value: "other" });
  const readLater = async (delay) => {
    await new Promise((resolve) => setTimeout(resolve, delay));
    return Label.context().value;
  };

  assert.deepEqual(await Promise.all([
    Layer.provide(layer, async () => await readLater(6)),
    Layer.provide(other, async () => await readLater(1)),
  ]), ["scoped", "other"]);
});
