import { describe, expect, test } from "bun:test";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { type Result, __vsInspectResult } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { Clock, SystemClock, TestClock } from "./clock.ts";
import { Console, RecordingConsole, SystemConsole } from "./console.ts";
import { Environment, MapEnvironment, ProcessEnvironment } from "./environment.ts";
import type { FileError } from "./file-errors.ts";
import { FileSystem, InMemoryFileSystem, NodeFileSystem } from "./filesystem.ts";
import { FetchHttpClient, type HttpError, HttpClient, StubHttpClient } from "./http.ts";
import {
  NodePlatform,
  type PlatformLayer,
  TestPlatform,
  nodePlatform,
  platformLayer,
} from "./layers.ts";
import { Random, SeededRandom, SystemRandom } from "./random.ts";

const { failure } = RuntimeValues;

/**
 * Bun cannot observe Promise settlement synchronously, so `Layer.provide` fails
 * closed on an async body there. The scope therefore stays synchronous: the body
 * starts the work (resolving every capability before its first `await`) and the
 * Promise is settled outside the scope.
 */
function provideStarted<T>(layer: PlatformLayer, body: () => Promise<T>): Promise<T> {
  return Layer.provide(layer, () => ({ pending: body() })).pending;
}

interface AuditEntry {
  readonly at: string;
  readonly region: string;
  readonly requestId: string;
}

/** An ordinary function whose requirements are inferred from its `context()` calls. */
function auditEntry(): AuditEntry {
  const clock = Clock.context();
  const environment = Environment.context();
  const random = Random.context();
  const console = Console.context();
  const entry: AuditEntry = {
    at: new Date(clock.now()).toISOString(),
    region: environment.get("REGION").unwrapOr("unknown"),
    requestId: [...random.bytes(4)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
  console.info(`audit ${entry.requestId} in ${entry.region}`);
  return entry;
}

/** Capabilities are resolved up front so the async tail needs no live scope. */
function mirror(url: string, destination: string): Promise<Result<number, HttpError | FileError>> {
  const http = HttpClient.context();
  const files = FileSystem.context();
  const console = Console.context();
  return (async () => {
    // The shape the compiler lowers `.unwrap()` to: inspect, propagate, continue.
    const fetched = __vsInspectResult(await http.get(url));
    if (!fetched.ok) return failure(fetched.error);
    const body = fetched.value.text();
    console.info(`mirrored ${url}`);
    return (await files.writeText(destination, body)).map(() => body.length);
  })();
}

describe("platform layers", () => {
  test("TestPlatform provides every service under its nominal key", () => {
    const platform = TestPlatform.make({
      now: "2026-08-20T12:00:00Z",
      seed: 7,
      environment: { REGION: "eu-west-1" },
    });
    const resolved = Layer.provide(platform.layer, () => ({
      clock: Clock.context(),
      random: Random.context(),
      console: Console.context(),
      environment: Environment.context(),
      fileSystem: FileSystem.context(),
      http: HttpClient.context(),
    }));
    expect(resolved.clock).toBe(platform.clock);
    expect(resolved.random).toBe(platform.random);
    expect(resolved.console).toBe(platform.console);
    expect(resolved.environment).toBe(platform.environment);
    expect(resolved.fileSystem).toBe(platform.fileSystem);
    expect(resolved.http).toBe(platform.http);
  });

  test("a multi-capability function is fully deterministic under TestPlatform", () => {
    const options = { now: "2026-08-20T12:00:00Z", seed: 7, environment: { REGION: "eu-west-1" } };
    const first = TestPlatform.make(options);
    const second = TestPlatform.make(options);

    const entry = Layer.provide(first.layer, auditEntry);
    expect(entry.at).toBe("2026-08-20T12:00:00.000Z");
    expect(entry.region).toBe("eu-west-1");
    expect(entry.requestId).toMatch(/^[0-9a-f]{8}$/);
    expect(first.console.messages("info")).toEqual([`audit ${entry.requestId} in eu-west-1`]);

    // A second bundle with the same options replays exactly.
    expect(Layer.provide(second.layer, auditEntry)).toEqual(entry);

    // The doubles are independent: nothing leaks between bundles.
    expect(second.console.messages()).toHaveLength(1);
    first.clock.advance(60_000);
    expect(Layer.provide(first.layer, auditEntry).at).toBe("2026-08-20T12:01:00.000Z");
    expect(Layer.provide(second.layer, auditEntry).at).toBe("2026-08-20T12:00:00.000Z");
  });

  test("TestPlatform composes HttpClient and FileSystem through one scope", async () => {
    const platform = TestPlatform.make({ files: { "/out/.keep": "" } });
    platform.http.route("GET", "https://api.example.test/doc", { status: 200, body: "mirrored body" });

    const written = await provideStarted(platform.layer, () =>
      mirror("https://api.example.test/doc", "/out/doc.txt"));
    expect(written.unwrapOr(-1)).toBe("mirrored body".length);
    expect(platform.fileSystem.readTextSync("/out/doc.txt").unwrapOr("")).toBe("mirrored body");
    expect(platform.http.requests).toHaveLength(1);
    expect(platform.console.messages("info")).toEqual(["mirrored https://api.example.test/doc"]);
  });

  test("a failing dependency propagates through the composed Result channel", async () => {
    const platform = TestPlatform.make();
    // No route is programmed, so the request fails before the write happens.
    const written = await provideStarted(platform.layer, () =>
      mirror("https://api.example.test/doc", "/out/doc.txt"));
    expect(written.isError()).toBe(true);
    expect(platform.fileSystem.paths()).toEqual(["/"]);
  });

  test("NodePlatform provides the live implementations", () => {
    const resolved = Layer.provide(NodePlatform, () => ({
      clock: Clock.context(),
      random: Random.context(),
      console: Console.context(),
      environment: Environment.context(),
      fileSystem: FileSystem.context(),
      http: HttpClient.context(),
    }));
    expect(resolved.clock).toBeInstanceOf(SystemClock);
    expect(resolved.random).toBeInstanceOf(SystemRandom);
    expect(resolved.console).toBeInstanceOf(SystemConsole);
    expect(resolved.environment).toBeInstanceOf(ProcessEnvironment);
    expect(resolved.fileSystem).toBeInstanceOf(NodeFileSystem);
    expect(resolved.http).toBeInstanceOf(FetchHttpClient);
  });

  test("nodePlatform swaps individual services while keeping the rest live", () => {
    const stub = StubHttpClient.make();
    const recording = RecordingConsole.make();
    const layer = nodePlatform({ http: stub, console: recording });
    const resolved = Layer.provide(layer, () => ({
      http: HttpClient.context(),
      console: Console.context(),
      fileSystem: FileSystem.context(),
    }));
    expect(resolved.http).toBe(stub);
    expect(resolved.console).toBe(recording);
    expect(resolved.fileSystem).toBeInstanceOf(NodeFileSystem);
  });

  test("an unprovided capability panics instead of defaulting", () => {
    expect(isPanic(catchPanic(auditEntry, (error) => error))).toBe(true);
    // A partial layer leaves the remaining requirement unsatisfied at runtime.
    const partial = Layer.succeed(Clock, TestClock.at("2026-08-20T12:00:00Z"));
    expect(isPanic(catchPanic(() => Layer.provide(partial, auditEntry), (error) => error))).toBe(true);
  });

  test("the environment is revoked when the scope ends, including for late lookups", async () => {
    const platform = TestPlatform.make();
    Layer.provide(platform.layer, () => Clock.context());
    expect(isPanic(catchPanic(() => Clock.context(), (error) => error))).toBe(true);

    // A capability reached only after the first await is outside the scope: the
    // Layer keeps no environment alive past the synchronous body in this POC.
    const late = await provideStarted(platform.layer, async () => {
      await Promise.resolve();
      return catchPanic(() => Clock.context(), (error) => error);
    });
    expect(isPanic(late)).toBe(true);
  });

  test("merge and nested override still fail closed for platform bundles", () => {
    const platform = TestPlatform.make();
    expect(() => Layer.merge(platform.layer, Layer.succeed(Clock, SystemClock.make())))
      .toThrow("duplicate capability");
    expect(() => Layer.provide(platform.layer, () => Layer.provide(platform.layer, () => 1)))
      .toThrow("not specified");
  });

  test("platformLayer packages already constructed services", () => {
    const services = {
      clock: TestClock.at("2026-08-20T12:00:00Z"),
      random: SeededRandom.withSeed(1),
      console: RecordingConsole.make(),
      environment: MapEnvironment.empty(),
      fileSystem: InMemoryFileSystem.make(),
      http: StubHttpClient.make(),
    };
    const layer = platformLayer(services);
    expect(Layer.provide(layer, () => Clock.context())).toBe(services.clock);
    // The same instances can be packaged again; a Layer owns no lifetime.
    expect(Layer.provide(platformLayer(services), () => Clock.context())).toBe(services.clock);
  });
});
