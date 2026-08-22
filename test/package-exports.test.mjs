import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("vibelang/package.json"));
const packageMetadata = JSON.parse(readFileSync(require.resolve("vibelang/package.json"), "utf8"));

function exportTargets(target, output = []) {
  if (typeof target === "string") {
    output.push(target);
    return output;
  }
  for (const nested of Object.values(target)) exportTargets(nested, output);
  return output;
}

test("every declared package export points at a file the package actually ships", () => {
  for (const [name, target] of Object.entries(packageMetadata.exports)) {
    for (const file of exportTargets(target)) {
      assert.equal(
        file.startsWith("./"),
        true,
        `exports[${JSON.stringify(name)}] must use a relative package target, got ${file}`,
      );
      assert.equal(
        statSync(join(packageRoot, file)).isFile(),
        true,
        `exports[${JSON.stringify(name)}] -> ${file} is not a regular file`,
      );
    }
  }
});

test("the derived-schema runtime resolves under the bare specifier generated code emits", async () => {
  // `comptime(Schema.derive<T>())` lowers to `import { __vsSchema } from
  // "vibelang/schema-runtime"`, so this subpath is part of the compiler's
  // output contract, not a convenience re-export.
  const schemaRuntime = await import("vibelang/schema-runtime");
  assert.equal(typeof schemaRuntime.__vsSchema, "function");
  assert.equal(schemaRuntime.derivedSchema, schemaRuntime.__vsSchema);
  assert.equal(typeof schemaRuntime.ValidationError, "function");

  const descriptor = {
    kind: "object",
    properties: [
      { name: "count", optional: false, value: { kind: "number" } },
      { name: "name", optional: false, value: { kind: "string" } },
      { name: "tags", optional: true, value: { kind: "array", element: { kind: "string" } } },
    ],
  };
  const schema = schemaRuntime.__vsSchema(descriptor);
  assert.equal(schema.descriptor.kind, "object");
  assert.deepEqual(
    schema.parse({ name: "row", count: 2 }).match({ ok: (row) => row, error: () => null }),
    { count: 2, name: "row" },
  );

  const failure = schema.parse({ name: 1, count: 2 }).match({ ok: () => null, error: (error) => error });
  assert.equal(failure instanceof schemaRuntime.ValidationError, true);
  assert.equal(failure.pointer, "$.name");
  assert.deepEqual([...failure.path], ["name"]);

  const nested = schemaRuntime.__vsSchema({
    kind: "object",
    properties: [{ name: "rows", optional: false, value: { kind: "array", element: descriptor } }],
  });
  assert.equal(
    nested.parse({ rows: [{ name: "row", count: 1 }, { name: "row", count: "no" }] })
      .match({ ok: () => null, error: (error) => error.pointer }),
    "$.rows[1].count",
  );
});

test("the platform capability library is reachable from the package subpath", async () => {
  const platform = await import("vibelang/platform");

  // One representative from each area the standard library lists, so a missing
  // re-export in the facade fails here rather than in a consumer's build.
  for (const name of [
    "Clock",
    "Config",
    "Console",
    "Duration",
    "Environment",
    "FileSystem",
    "HttpClient",
    "Instant",
    "Path",
    "Process",
    "Random",
    "Schedule",
    "Socket",
    "Terminal",
    "NodePlatform",
    "TestPlatform",
  ]) {
    assert.notEqual(platform[name], undefined, `vibelang/platform must export ${name}`);
  }

  assert.equal(platform.Duration.seconds(2).toMillis(), 2_000);
  assert.equal(platform.Path.join("release", "smoke"), "release/smoke");
  assert.equal(typeof new platform.TestClock().monotonic(), "number");

  const files = new platform.InMemoryFileSystem();
  assert.equal(
    files.mkdirSync("/release", { recursive: true }).match({ ok: () => "ok", error: (error) => error.message }),
    "ok",
  );
  files.writeTextSync("/release/notes.txt", "shipped");
  assert.equal(
    files.readTextSync("/release/notes.txt").match({ ok: (text) => text, error: (error) => error.message }),
    "shipped",
  );
  // Every recoverable platform failure is a named Error carried in a Result.
  assert.equal(
    files.readTextSync("/release/missing.txt")
      .match({ ok: () => null, error: (error) => error instanceof platform.FileNotFound }),
    true,
  );
  assert.equal(typeof platform.platformLayer, "function");
});

test("the Core Data slice is reachable from the package subpath", async () => {
  const data = await import("vibelang/data");

  const chunk = data.Chunk.of(1, 2, 3);
  assert.equal(data.isChunk(chunk), true);
  assert.equal(chunk.size, 3);
  assert.deepEqual([...chunk], [1, 2, 3]);

  const map = data.HashMap.of(["answer", 42]);
  assert.equal(data.isHashMap(map), true);
  assert.equal(map.get("answer").match({ some: (value) => value, none: () => null }), 42);
  assert.equal(map.get("missing").match({ some: () => "found", none: () => "none" }), "none");

  const set = data.HashSet.of("release");
  assert.equal(data.isHashSet(set), true);
  assert.equal(set.has("release"), true);

  assert.equal(data.Data.equals(data.Data.struct({ id: 1 }), data.Data.struct({ id: 1 })), true);
  assert.equal(data.Data.equals(data.Data.struct({ id: 1 }), data.Data.struct({ id: 2 })), false);

  const matched = data.Match.value({ kind: "release" })
    .whenTag("release", () => "released")
    .orElse(() => "pending")
    .run();
  assert.equal(matched, "released");

  assert.equal(typeof data.registerStructuralEquivalence, "function");
  assert.equal(typeof data.registerStructuralHash, "function");
  assert.equal(data.Equivalence.any.equals(chunk, data.Chunk.of(1, 2, 3)), true);
  assert.equal(typeof data.Hash.any.hash(chunk), "number");
});

test("vibelang/concurrency carries the platform-neutral primitives and leaves the worker host on Bun", async () => {
  const concurrency = await import("vibelang/concurrency");

  for (const name of [
    "Queue",
    "Semaphore",
    "Channel",
    "Stream",
    "Governor",
    "CancellationSource",
    "Cancellation",
  ]) {
    assert.equal(typeof concurrency[name], "function", `vibelang/concurrency must export ${name}`);
  }
  for (const name of ["awaitAll", "mapUnordered", "allKeyed", "allSettledKeyed", "bufferedUnordered"]) {
    assert.equal(typeof concurrency[name], "function", `vibelang/concurrency must export ${name}`);
  }

  assert.deepEqual(await concurrency.awaitAll(Promise.resolve(1), Promise.resolve("two")), [1, "two"]);

  const queue = concurrency.Queue.bounded(2);
  await queue.offer("first");
  assert.equal(
    (await queue.take()).match({ ok: (value) => value, error: (error) => String(error) }),
    "first",
  );

  const semaphore = concurrency.Semaphore.withPermits(1);
  assert.equal(await semaphore.withPermit(async () => "held"), "held");

  const governor = concurrency.Governor.withLimit(2);
  assert.equal(governor.limit, 2);
  assert.equal(await governor.run(() => 7), 7);

  const collected = [];
  for await (const value of concurrency.of(1, 2, 3)) collected.push(value);
  assert.deepEqual(collected, [1, 2, 3]);

  // The typed worker host installs a Bun bootstrap listener at module scope, so
  // it is a separate subpath the way the Bun durable executor is.
  assert.equal("TypedWorker" in concurrency, false);
});

test("vibelang/concurrency/bun is the Bun-only worker host and fails closed on Node", async () => {
  assert.deepEqual(packageMetadata.exports["./concurrency/bun"], {
    types: "./poc/dist/concurrency/index.d.ts",
    default: "./poc/dist/concurrency/index.js",
  });

  if (typeof globalThis.Bun === "object") {
    const workers = await import("vibelang/concurrency/bun");
    assert.equal(typeof workers.TypedWorker, "function");
    return;
  }
  let rejected;
  try {
    await import("vibelang/concurrency/bun");
  } catch (error) {
    rejected = error;
  }
  assert.equal(rejected instanceof ReferenceError, true, "Node must refuse the Bun-only worker host");
  assert.match(String(rejected), /\bBun\b/);
});
