import { describe, expect, test } from "bun:test";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import { Environment, MapEnvironment, ProcessEnvironment } from "./environment.ts";

/** Contract every Environment implementation must satisfy, exercised through the abstract type. */
function assertEnvironmentContract(environment: Environment, presentName: string, presentValue: string): void {
  const present = environment.get(presentName);
  expect(present).not.toBeUndefined();
  expect(present ?? "<absent>").toBe(presentValue);
  if (present === undefined) throw new Error("expected a value");
  expect(typeof present.length).toBe("number"); // narrowed to string

  // An unset variable is absence — `undefined` — not a failure.
  const absent = environment.get("SMITHERS_DEFINITELY_UNSET_9f3a");
  expect(absent).toBeUndefined();
  expect(absent ?? "<absent>").toBe("<absent>");
  expect(absent?.length).toBeUndefined();

  const names = environment.names();
  expect(names).toContain(presentName);
  expect([...names].sort()).toEqual([...names]);
}

describe("Environment", () => {
  test("ProcessEnvironment reads the live process environment", () => {
    const name = "SMITHERS_PLATFORM_TEST_VAR";
    process.env[name] = "live";
    try {
      const environment: Environment = ProcessEnvironment.make();
      assertEnvironmentContract(environment, name, "live");
      // The read happens per call, so a later mutation is visible.
      process.env[name] = "changed";
      expect(environment.get(name) ?? "").toBe("changed");
    } finally {
      delete process.env[name];
    }
    expect(ProcessEnvironment.make().get(name)).toBeUndefined();
  });

  test("MapEnvironment satisfies the contract from an in-memory map", () => {
    const environment = MapEnvironment.of({ DATABASE_URL: "postgres://local", REGION: "us-east-1" });
    assertEnvironmentContract(environment, "DATABASE_URL", "postgres://local");
    expect(environment.names()).toEqual(["DATABASE_URL", "REGION"]);

    environment.set("REGION", "eu-west-1").set("EXTRA", "yes");
    expect(environment.get("REGION") ?? "").toBe("eu-west-1");
    environment.unset("EXTRA");
    expect(environment.get("EXTRA")).toBeUndefined();
  });

  test("an empty value is present, and a prototype-shaped name is an ordinary name", () => {
    // A computed key makes `__proto__` an ordinary own property rather than a
    // prototype assignment, which is exactly the case a plain-object store breaks on.
    const environment = MapEnvironment.of({ EMPTY: "", ["__proto__"]: "not-a-prototype" });
    expect(environment.get("EMPTY")).not.toBeUndefined();
    // An empty string is present: `??` coalesces only nullish values.
    expect(environment.get("EMPTY") ?? "<absent>").toBe("");
    expect(environment.get("EMPTY") || "<absent>").toBe("<absent>");
    expect(environment.get("__proto__") ?? "<absent>").toBe("not-a-prototype");
    expect(environment.names()).toEqual(["EMPTY", "__proto__"]);
    expect(environment.get("constructor")).toBeUndefined();
    expect(MapEnvironment.empty().names()).toEqual([]);
  });

  test("ProcessEnvironment answers a prototype-shaped name like any other name", () => {
    // `process.env` inherits from `Object.prototype` on the hosts this POC
    // runs on, so `process.env[name]` answers `constructor`, `toString` and
    // their siblings with a function and `__proto__` with an object — from a
    // method declared `string | undefined`. `names()` lists none of them, so
    // an inherited member is never a variable.
    const environment: Environment = ProcessEnvironment.make();
    for (const inherited of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
      expect([inherited, environment.get(inherited)]).toEqual([inherited, undefined]);
      expect([inherited, environment.names().includes(inherited)]).toEqual([inherited, false]);
    }

    // ... and a real variable under one of those names is an ordinary variable.
    // The cast is only to write a name `ProcessEnv` types as `Function`.
    const variables = process.env as unknown as Record<string, string | undefined>;
    variables["constructor"] = "real-value";
    try {
      expect(environment.get("constructor") ?? "<absent>").toBe("real-value");
      expect(environment.names()).toContain("constructor");
    } finally {
      delete variables["constructor"];
    }
    expect(environment.get("constructor")).toBeUndefined();
  });

  test("Environment resolves through a Layer under its nominal key", () => {
    const environment = MapEnvironment.of({ REGION: "us-east-1" });
    const region = (): string => Environment.context().get("REGION") ?? "unknown";
    expect(Layer.provide(Layer.succeed(Environment, environment), region)).toBe("us-east-1");
    expect(isPanic(catchPanic(region, (error) => error))).toBe(true);
  });
});
