/**
 * `Layer.provide`'s async extent, against the packaged runtime, under NODE.
 *
 * This file is the only place the promise-tracking behaviour was ever really
 * exercised. The `poc/` suite and every conformance case run on Bun, where
 * `promiseHooks.createHook` throws — so the apparatus this file used to pin was
 * inert everywhere else, and these four tests were the whole of its coverage.
 *
 * **They pinned two obligations that `specification/requirements.mdx` §Scoping
 * has since WITHDRAWN**, and its Amendment Record names both: "Promise
 * revocation MUST occur at settlement before queued Promise reactions run", and
 * "A runtime MAY require the Promise to be created by the provider body, and
 * MUST reject an unverifiable pre-existing Promise". What replaced them is three
 * prohibitions in the opposite direction:
 *
 *   A runtime MUST NOT require a host promise-settlement hook, MUST NOT restrict
 *   which Promise a provider body returns, and MUST NOT refuse an async provider
 *   scope on a host that cannot observe Promise settlement synchronously.
 *
 * The V8 settlement hook that satisfied the old rules violated all three, so it
 * was deleted with migration step 13 and these tests are rewritten to the rule
 * that stands. The property that survives — and it is the one that matters — is
 * that **the extent ends**: an environment provided to a body is not readable
 * once the body's returned Promise has settled and the caller can observe it.
 *
 * What is deliberately NOT claimed any more is the exact microtask at which it
 * ends. Test 1 asserts the cost of that directly rather than leaving it implied.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Context } from "smthrs/context";
import { catchPanic, isPanic } from "smthrs/exceptions";
import { Layer } from "smthrs/provider";

class Label extends Context {}

const layer = Layer.succeed(Label, { value: "scoped" });
const readLabel = () => catchPanic(() => Label.context().value, (error) => error);

/** Let every pending reaction run, so "has the extent ended" is a fair question. */
const drain = async () => {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
};

test("a reaction registered ahead of the observer still sees the environment", async () => {
  // THE WITHDRAWN GUARANTEE, asserted as the cost it is rather than left to be
  // discovered. The V8 settlement hook ran at the state transition, ahead of
  // every reaction, so this read used to panic. An ordinary `.then` observer is
  // registered after the body's own reactions, so this one now reads the value.
  //
  // That is the price of the three MUST NOTs above, and it is bounded: the
  // reaction runs inside the extent the author opened, on a Promise the author's
  // own body created, in the same turn the scope was still live.
  let resolve;
  let olderReaction;
  const returned = Layer.provide(layer, () => {
    const promise = new Promise((release) => { resolve = release; });
    promise.then(() => { olderReaction = readLabel(); });
    return promise;
  });

  resolve();
  await returned;
  await drain();
  assert.equal(olderReaction, "scoped");

  // And the extent still ENDS, which is the half that must not regress.
  assert.equal(isPanic(readLabel()), true);
});

test("a provider body may return a Promise it did not create", async () => {
  // The author-visible wart the apparatus imposed: it tracked Promise
  // provenance and refused any Promise the body had not itself created, telling
  // the author to write `async () => await promise` instead. §Scoping now says a
  // runtime "MUST NOT restrict which Promise a provider body returns".
  let resolve;
  const external = new Promise((release) => { resolve = release; });

  const returned = Layer.provide(layer, () => external);
  resolve("handed in");
  assert.equal(await returned, "handed in");
  await drain();
  assert.equal(isPanic(readLabel()), true);

  // The spelling the old rule forced on authors keeps working unchanged.
  let releaseAdapted;
  const adaptedExternal = new Promise((release) => { releaseAdapted = release; });
  const adapted = Layer.provide(layer, async () => {
    await adaptedExternal;
    return Label.context().value;
  });
  releaseAdapted();
  assert.equal(await adapted, "scoped");
});

test("an async provider scope is never refused for want of a settlement hook", async () => {
  // §Scoping: a runtime "MUST NOT refuse an async provider scope on a host that
  // cannot observe Promise settlement synchronously". This ran on Node before
  // and threw on Bun — the Bun cliff — which meant the async path was untested
  // on the host every other suite in this repository uses.
  assert.equal(await Layer.provide(layer, async () => Label.context().value), "scoped");
  await drain();
  assert.equal(isPanic(readLabel()), true);
});

test("already-settled and rejected scopes end too", async () => {
  const fulfilled = Layer.provide(layer, () => Promise.resolve("done"));
  assert.equal(await fulfilled, "done");
  await drain();
  assert.equal(isPanic(readLabel()), true);

  // The REJECTED arm is the one a permissive rewrite gets wrong for free: a
  // revocation hung only on the success path leaks the environment forever on
  // the failure path, and nothing else in this file would notice.
  let reject;
  const rejected = Layer.provide(layer, () => new Promise((_resolve, fail) => { reject = fail; }));
  reject(new Error("expected"));
  await assert.rejects(rejected, /expected/);
  await drain();
  assert.equal(isPanic(readLabel()), true);
});

test("nested Layer scopes both end with the returned Promise", async () => {
  class Inner extends Context {}
  const inner = Layer.succeed(Inner, { value: "inner" });
  let resolve;

  const returned = Layer.provide(layer, () => Layer.provide(inner, () => {
    const promise = new Promise((release) => { resolve = release; });
    return promise;
  }));

  const registeredAfterReturn = returned.then(() => [
    readLabel(),
    catchPanic(() => Inner.context().value, (error) => error),
  ]);
  resolve();
  await returned;
  const [outer, innerRead] = await registeredAfterReturn;
  assert.equal(isPanic(outer), true);
  assert.equal(isPanic(innerRead), true);
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
