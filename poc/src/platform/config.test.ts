import { describe, expect, test } from "bun:test";
import { decodeError, encodeError, errorIs } from "../runtime/errors.ts";
import { Layer } from "../runtime/layer.ts";
import { catchPanic, isPanic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import { Config, ConfigError, ConfigSpecValue, InvalidConfig, MissingConfig } from "./config.ts";
import { Duration } from "./duration.ts";
import { Environment, MapEnvironment } from "./environment.ts";
import { Instant } from "./instant.ts";

function panics(body: () => unknown): boolean {
  return isPanic(catchPanic(body, (error) => error));
}

/** Runs a read inside a scope that provides exactly the Environment capability. */
function withEnvironment<T>(environment: Environment, body: () => T): T {
  return Layer.provide(Layer.succeed(Environment, environment), body);
}

function failureOf<T>(result: Result<T, ConfigError>): ConfigError {
  return result.match({
    ok: () => {
      throw new Error("expected a configuration failure");
    },
    error: (error) => error,
  });
}

/** Records the order and count of environment lookups, to prove short-circuiting. */
class CountingEnvironment extends Environment {
  readonly reads: string[] = [];

  constructor(private readonly inner: Environment) {
    super();
  }

  get(name: string): string | undefined {
    this.reads.push(name);
    return this.inner.get(name);
  }

  names(): readonly string[] {
    return this.inner.names();
  }
}

const SETTINGS = MapEnvironment.of({
  REGION: "eu-west-1",
  PORT: "8080",
  RATIO: "0.25",
  NEGATIVE: "-3",
  DEBUG: "yes",
  VERBOSE: "FALSE",
  TIMEOUT: "1h30m",
  RETRY_DELAY: "1500",
  DEPLOYED_AT: "2026-08-20T14:00:00+02:00",
  EMPTY: "",
  SPACED: "  8080  ",
});

describe("Config", () => {
  test("typed readers convert a present value", () => {
    const values = withEnvironment(SETTINGS, () => ({
      region: Config.read(Config.string("REGION")).unwrapOr("<none>"),
      port: Config.read(Config.number("PORT")).unwrapOr(-1),
      ratio: Config.read(Config.number("RATIO")).unwrapOr(-1),
      negative: Config.read(Config.number("NEGATIVE")).unwrapOr(-1),
      spaced: Config.read(Config.number("SPACED")).unwrapOr(-1),
      debug: Config.read(Config.boolean("DEBUG")).unwrapOr(false),
      verbose: Config.read(Config.boolean("VERBOSE")).unwrapOr(true),
      timeout: Config.read(Config.duration("TIMEOUT")).unwrapOr(Duration.zero).toString(),
      retryDelay: Config.read(Config.duration("RETRY_DELAY")).unwrapOr(Duration.zero).toMillis(),
      deployedAt: Instant.format(Config.read(Config.instant("DEPLOYED_AT")).unwrapOr(0)),
      empty: Config.read(Config.string("EMPTY")).unwrapOr("<none>"),
    }));

    expect(values).toEqual({
      region: "eu-west-1",
      port: 8_080,
      ratio: 0.25,
      negative: -3,
      spaced: 8_080,
      debug: true,
      verbose: false,
      timeout: "1h30m",
      retryDelay: 1_500,
      deployedAt: "2026-08-20T12:00:00.000Z",
      // A set-but-empty variable is present; only the typed readers reject it.
      empty: "",
    });
  });

  test("every boolean and number spelling is explicit", () => {
    const environment = MapEnvironment.empty();
    for (const raw of ["true", "TRUE", "yes", "on", "1", " true "]) {
      environment.set("FLAG", raw);
      expect(withEnvironment(environment, () => Config.read(Config.boolean("FLAG"))).unwrapOr(false)).toBe(true);
    }
    for (const raw of ["false", "FALSE", "no", "off", "0"]) {
      environment.set("FLAG", raw);
      expect(withEnvironment(environment, () => Config.read(Config.boolean("FLAG"))).unwrapOr(true)).toBe(false);
    }
    for (const raw of ["", " ", "maybe", "2", "y"]) {
      environment.set("FLAG", raw);
      expect(withEnvironment(environment, () => Config.read(Config.boolean("FLAG"))).isError()).toBe(true);
    }

    for (const [raw, value] of [["12", 12], ["-4.5", -4.5], ["1e3", 1_000], [".5", 0.5], ["+7", 7]] as const) {
      environment.set("COUNT", raw);
      expect(withEnvironment(environment, () => Config.read(Config.number("COUNT"))).unwrapOr(-1)).toBe(value);
    }
    // `Number("")`, `Number(" ")`, and `Number("0x10")` would all succeed; a
    // configuration value must not mean something surprising.
    for (const raw of ["", " ", "0x10", "abc", "12abc", "Infinity", "NaN", "1,5", "1 2"]) {
      environment.set("COUNT", raw);
      expect(withEnvironment(environment, () => Config.read(Config.number("COUNT"))).isError()).toBe(true);
    }
  });

  test("an unset variable is MissingConfig, naming the variable", () => {
    const failure = failureOf(withEnvironment(SETTINGS, () => Config.read(Config.string("ABSENT"))));
    expect(errorIs(failure, MissingConfig)).toBe(true);
    expect(errorIs(failure, InvalidConfig)).toBe(false);
    expect(failure.variable).toBe("ABSENT");
    expect(failure.name).toBe("MissingConfig");
    expect(failure.message).toBe("Missing configuration value: ABSENT");
  });

  test("a malformed value is InvalidConfig, and the reason never echoes the value", () => {
    const environment = MapEnvironment.of({ DATABASE_PORT: "hunter2-secret", WINDOW: "soon", AT: "2026-08-20T12:00:00" });

    const port = failureOf(withEnvironment(environment, () => Config.read(Config.number("DATABASE_PORT"))));
    expect(errorIs(port, InvalidConfig)).toBe(true);
    expect(port.variable).toBe("DATABASE_PORT");
    expect((port as InvalidConfig).reason).toBe("expected a decimal number");
    // A malformed secret must not leak into a log line through the message.
    expect(port.message).not.toContain("hunter2-secret");
    expect(port.message).toBe("Invalid configuration value for DATABASE_PORT: expected a decimal number");

    const window = failureOf(withEnvironment(environment, () => Config.read(Config.duration("WINDOW"))));
    expect((window as InvalidConfig).reason).toContain("expected a duration");
    expect(window.message).not.toContain("soon");

    const at = failureOf(withEnvironment(environment, () => Config.read(Config.instant("AT"))));
    // The Instant parser's reason is forwarded without the offending text.
    expect((at as InvalidConfig).reason).toBe("expected an ISO-8601 instant (missing UTC offset)");
    expect(at.message).not.toContain("2026-08-20T12:00:00");
  });

  test("a default covers absence only, and specs stay immutable", () => {
    const base = Config.number("MAX_RETRIES");
    const withFallback = base.withDefault(3);

    expect(base.hasDefault()).toBe(false);
    expect(withFallback.hasDefault()).toBe(true);
    expect(withFallback).not.toBe(base);
    expect(withFallback.variable).toBe("MAX_RETRIES");
    expect(withFallback.kind).toBe("number");
    expect(Object.isFrozen(withFallback)).toBe(true);

    const empty = MapEnvironment.empty();
    expect(withEnvironment(empty, () => Config.read(withFallback)).unwrapOr(-1)).toBe(3);
    // The original spec is untouched by `withDefault`.
    expect(withEnvironment(empty, () => Config.read(base)).isError()).toBe(true);

    // A present-but-malformed value is still a failure; a default must not hide
    // a typo the operator actually wrote.
    const malformed = MapEnvironment.of({ MAX_RETRIES: "three" });
    const failure = failureOf(withEnvironment(malformed, () => Config.read(withFallback)));
    expect(errorIs(failure, InvalidConfig)).toBe(true);

    // Defaults are checked against the spec's kind, so an untyped caller cannot
    // smuggle in a value the reader would never produce.
    expect(withEnvironment(empty, () => Config.read(Config.duration("WINDOW").withDefault(Duration.seconds(30))))
      .unwrapOr(Duration.zero).toMillis()).toBe(30_000);
    expect(panics(() => Config.number("N").withDefault("3" as unknown as number))).toBe(true);
    expect(panics(() => Config.number("N").withDefault(Number.NaN))).toBe(true);
    expect(panics(() => Config.duration("W").withDefault(30_000 as unknown as Duration))).toBe(true);
    expect(panics(() => Config.string("S").withDefault(undefined as unknown as string))).toBe(true);
    expect(panics(() => Config.instant("I").withDefault(1.5 as unknown as Instant))).toBe(true);
  });

  test("readAll collects a record of values", () => {
    const values = withEnvironment(SETTINGS, () =>
      Config.readAll({
        region: Config.string("REGION"),
        port: Config.number("PORT"),
        debug: Config.boolean("DEBUG"),
        timeout: Config.duration("TIMEOUT"),
        retries: Config.number("MAX_RETRIES").withDefault(3),
      }));

    const record = values.match({
      ok: (value) => value,
      error: (error) => {
        throw error;
      },
    });
    expect(record.region).toBe("eu-west-1");
    expect(record.port).toBe(8_080);
    expect(record.debug).toBe(true);
    expect(record.timeout.equals(Duration.minutes(90))).toBe(true);
    expect(record.retries).toBe(3);
    expect(Object.keys(record)).toEqual(["region", "port", "debug", "timeout", "retries"]);
    expect(withEnvironment(SETTINGS, () => Config.readAll({})).unwrapOr(undefined)).toEqual({});
  });

  test("readAll short-circuits on the first failure, like Result.all", () => {
    const counting = new CountingEnvironment(SETTINGS);
    const result = withEnvironment(counting, () =>
      Config.readAll({
        region: Config.string("REGION"),
        port: Config.number("PORT"),
        missing: Config.string("ABSENT"),
        malformed: Config.number("REGION"),
        rest: Config.string("REGION"),
      }));

    const failure = failureOf(result);
    // Declaration order decides which failure wins: the missing one comes first.
    expect(errorIs(failure, MissingConfig)).toBe(true);
    expect(failure.variable).toBe("ABSENT");
    // And the variables after it are never read.
    expect(counting.reads).toEqual(["REGION", "PORT", "ABSENT"]);
  });

  test("building a spec is pure; reading one requires the Environment capability", () => {
    // No Layer scope here: construction, inspection, and defaults are all pure.
    const spec = Config.duration("REQUEST_TIMEOUT").withDefault(Duration.seconds(30));
    expect(spec.variable).toBe("REQUEST_TIMEOUT");
    expect(spec.kind).toBe("duration");
    expect(Config.isConfigSpec(spec)).toBe(true);

    // Reading is the part that needs the capability.
    expect(panics(() => Config.read(spec))).toBe(true);
    expect(panics(() => Config.readAll({ spec }))).toBe(true);
    expect(withEnvironment(MapEnvironment.empty(), () => Config.read(spec)).unwrapOr(Duration.zero).toSeconds()).toBe(30);

    expect(panics(() => Config.string("" as string))).toBe(true);
    expect(panics(() => Config.string(7 as unknown as string))).toBe(true);
  });

  test("structural fakes are rejected by the spec brand", () => {
    const fake = Object.create(ConfigSpecValue.prototype) as ReturnType<typeof Config.string>;
    const structural = { variable: "REGION", kind: "string" } as unknown as ReturnType<typeof Config.string>;

    expect(Config.isConfigSpec(fake)).toBe(false);
    expect(Config.isConfigSpec(structural)).toBe(false);
    expect(Config.isConfigSpec(null)).toBe(false);
    expect(panics(() => fake.variable)).toBe(true);
    expect(panics(() => fake.withDefault("x"))).toBe(true);
    expect(panics(() => withEnvironment(SETTINGS, () => Config.read(fake)))).toBe(true);
    expect(panics(() => withEnvironment(SETTINGS, () => Config.read(structural)))).toBe(true);
    expect(panics(() => withEnvironment(SETTINGS, () => Config.readAll({ region: structural })))).toBe(true);
    expect(panics(() => withEnvironment(SETTINGS, () => Config.readAll([] as unknown as Record<string, never>)))).toBe(true);
  });

  test("configuration errors survive the wire codec and stay nominal", () => {
    for (const error of [new MissingConfig("DATABASE_URL"), new InvalidConfig("PORT", "expected a decimal number")]) {
      const decoded = decodeError(encodeError(error));
      expect(decoded.constructor).toBe(error.constructor);
      expect((decoded as ConfigError).variable).toBe(error.variable);
      expect(decoded.message).toBe(error.message);
      // The shared base still narrows, and the siblings stay distinct.
      expect(errorIs(decoded, ConfigError)).toBe(true);
      expect(errorIs(decoded, MissingConfig) !== errorIs(decoded, InvalidConfig)).toBe(true);
    }
    const invalid = decodeError(encodeError(new InvalidConfig("PORT", "expected a decimal number")));
    expect((invalid as InvalidConfig).reason).toBe("expected a decimal number");
  });
});
