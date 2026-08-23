/**
 * `Config`: a typed reader over the `Environment` capability.
 *
 * The split the standard library asks for (docs/src/pages/reference/standard-library.mdx,
 * "Configuration and Time") runs right through this module: *describing* what a
 * program needs is pure, and only *reading* it touches a capability.
 * `Config.string("PORT")` builds a frozen, non-forgeable spec anywhere;
 * `Config.read(spec)` resolves `Environment.context()` and therefore adds
 * `Environment` to its caller's inferred requirements.
 *
 * Failure model:
 * - An unset variable with no default is `MissingConfig`.
 * - A present but unparsable value is `InvalidConfig`, whose `reason` names the
 *   expected shape and **never echoes the raw value** — a malformed secret must
 *   not leak into a log line.
 * - A default (`.withDefault(v)`) covers absence only. A present-but-malformed
 *   value is still `InvalidConfig`: the operator wrote something and meant it,
 *   and silently falling back would hide a typo in production.
 *
 * `Config.readAll` follows the `Result.all` precedent exactly: it short-circuits
 * on the **first** failure in declaration order and does not read the remaining
 * variables. Collecting every error would need a plural error type the language
 * has not specified, so the combinator stays consistent with the runtime instead
 * of inventing one.
 */

import { type JsonValue, type NominalError, registerErrorCodec, registerErrorType } from "../runtime/errors.ts";
import { panic } from "../runtime/panic.ts";
import type { Result } from "../runtime/result.ts";
import { RuntimeValues } from "../runtime/values.ts";
import { Duration } from "./duration.ts";
import { Environment } from "./environment.ts";
import { Instant } from "./instant.ts";

const { failure, success } = RuntimeValues;

/**
 * Base of the configuration failure channel. The variable is carried as
 * `variable` rather than `name` because `name` is already `Error`'s own.
 */
export abstract class ConfigError extends Error {
  constructor(
    readonly variable: string,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "ConfigError";
  }
}

registerErrorType(ConfigError, "smithers:ConfigError@1");

/** The variable is unset and the spec declared no default. */
export class MissingConfig extends ConfigError {
  constructor(variable: string, message = `Missing configuration value: ${variable}`, options?: { readonly cause?: unknown }) {
    super(variable, message, options);
    this.name = "MissingConfig";
  }
}
export interface MissingConfig extends NominalError<"smithers:MissingConfig@1"> {}

/** The variable is set to something this spec cannot read. `reason` never quotes the value. */
export class InvalidConfig extends ConfigError {
  constructor(
    variable: string,
    readonly reason: string,
    message = `Invalid configuration value for ${variable}: ${reason}`,
    options?: { readonly cause?: unknown },
  ) {
    super(variable, message, options);
    this.name = "InvalidConfig";
  }
}
export interface InvalidConfig extends NominalError<"smithers:InvalidConfig@1"> {}

registerErrorCodec(MissingConfig, "smithers:MissingConfig@1", {
  encode: (error): JsonValue => ({ variable: error.variable, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 2 ||
      typeof payload.variable !== "string" || typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid MissingConfig payload");
    }
    return new MissingConfig(payload.variable, payload.message);
  },
});

registerErrorCodec(InvalidConfig, "smithers:InvalidConfig@1", {
  encode: (error): JsonValue => ({ variable: error.variable, reason: error.reason, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 3 ||
      typeof payload.variable !== "string" || typeof payload.reason !== "string" ||
      typeof payload.message !== "string"
    ) {
      throw new TypeError("invalid InvalidConfig payload");
    }
    return new InvalidConfig(payload.variable, payload.reason, payload.message);
  },
});

/** What a per-kind reader returns: a value, or the reason it could not read one. */
type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

function parsed<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

function unparsable<T>(reason: string): Parsed<T> {
  return { ok: false, reason };
}

interface SpecState<T> {
  readonly variable: string;
  readonly kind: string;
  readonly read: (raw: string) => Parsed<T>;
  /** Guards `withDefault` against a value of the wrong kind from untyped callers. */
  readonly accepts: (value: unknown) => boolean;
  readonly fallback: { readonly value: T } | undefined;
}

const stateBySpec = new WeakMap<object, SpecState<unknown>>();
const localSpecs = new WeakSet<object>();

function stateOf<T>(spec: ConfigSpec<T>): SpecState<T> {
  const state = stateBySpec.get(spec as object);
  if (!state || !localSpecs.has(spec as object)) panic("forged ConfigSpec value");
  return state as SpecState<T>;
}

/**
 * A frozen, non-forgeable description of one configuration value. Branded with
 * a module-private `WeakSet`, the same way the runtime brands `Result` and
 * `Optional`, so `Config.read` cannot be handed a structural look-alike.
 */
export abstract class ConfigSpecValue<T> {
  /** The environment variable this spec reads. */
  get variable(): string {
    return stateOf(this).variable;
  }

  /** The kind of value it parses: `"string"`, `"number"`, `"boolean"`, `"duration"`, `"instant"`. */
  get kind(): string {
    return stateOf(this).kind;
  }

  hasDefault(): boolean {
    return stateOf(this).fallback !== undefined;
  }

  /** A new spec; specs are immutable, so this never mutates the receiver. */
  withDefault(value: T): ConfigSpec<T> {
    const state = stateOf(this);
    if (value === null || value === undefined) panic(`ConfigSpec.withDefault for ${state.variable} requires a value`);
    if (!state.accepts(value)) panic(`ConfigSpec.withDefault for ${state.variable} requires a ${state.kind} value`);
    return makeSpec({ ...state, fallback: { value } });
  }

  get [Symbol.toStringTag](): string {
    return "ConfigSpec";
  }
}

export type ConfigSpec<T> = ConfigSpecValue<T>;

class LocalConfigSpec<T> extends ConfigSpecValue<T> {
  constructor(state: SpecState<T>) {
    super();
    stateBySpec.set(this, Object.freeze(state) as SpecState<unknown>);
    localSpecs.add(this);
    Object.freeze(this);
  }
}

function makeSpec<T>(state: SpecState<T>): ConfigSpec<T> {
  return new LocalConfigSpec(state);
}

function isConfigSpec(value: unknown): value is ConfigSpec<unknown> {
  return typeof value === "object" && value !== null && localSpecs.has(value);
}

function requireVariableName(variable: string, caller: string): string {
  if (typeof variable !== "string") panic(`${caller} requires a variable name`);
  if (variable.length === 0) panic(`${caller} requires a non-empty variable name`);
  return variable;
}

const DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const TRUE_WORDS: ReadonlySet<string> = new Set(["true", "yes", "on", "1"]);
const FALSE_WORDS: ReadonlySet<string> = new Set(["false", "no", "off", "0"]);

/** A set variable is present even when empty; only the typed readers below reject it. */
function readString(raw: string): Parsed<string> {
  return parsed(raw);
}

function readNumber(raw: string): Parsed<number> {
  const text = raw.trim();
  // `Number("")`, `Number(" ")`, and `Number("0x10")` all succeed; the regex is
  // what keeps a configuration value from meaning something surprising.
  if (!DECIMAL.test(text)) return unparsable("expected a decimal number");
  const value = Number(text);
  if (!Number.isFinite(value)) return unparsable("expected a finite decimal number");
  return parsed(value === 0 ? 0 : value);
}

function readBoolean(raw: string): Parsed<boolean> {
  const text = raw.trim().toLowerCase();
  if (TRUE_WORDS.has(text)) return parsed(true);
  if (FALSE_WORDS.has(text)) return parsed(false);
  return unparsable("expected one of true/false, yes/no, on/off, 1/0");
}

function readDuration(raw: string): Parsed<Duration> {
  return Duration.parse(raw).match({
    some: (duration) => parsed(duration),
    none: () => unparsable<Duration>("expected a duration such as 30s, 1h30m, 1500ms, or a whole number of milliseconds"),
  });
}

function readInstant(raw: string): Parsed<Instant> {
  return Instant.parse(raw.trim()).match({
    ok: (instant) => parsed(instant),
    error: (error) => unparsable<Instant>(`expected an ISO-8601 instant (${error.reason})`),
  });
}

function typedSpec<T>(
  variable: string,
  kind: string,
  read: (raw: string) => Parsed<T>,
  accepts: (value: unknown) => boolean,
  caller: string,
): ConfigSpec<T> {
  return makeSpec<T>({
    variable: requireVariableName(variable, caller),
    kind,
    read,
    accepts,
    fallback: undefined,
  });
}

function readValue<T>(environment: Environment, state: SpecState<T>): Result<T, ConfigError> {
  return environment.get(state.variable).match({
    some: (raw): Result<T, ConfigError> => {
      const outcome = state.read(raw);
      return outcome.ok ? success(outcome.value) : failure(new InvalidConfig(state.variable, outcome.reason));
    },
    none: (): Result<T, ConfigError> =>
      state.fallback !== undefined ? success(state.fallback.value) : failure(new MissingConfig(state.variable)),
  });
}

/** Reads one spec. Requires the `Environment` capability. */
function read<T>(spec: ConfigSpec<T>): Result<T, ConfigError> {
  const state = stateOf(spec);
  return readValue(Environment.context(), state);
}

type SpecValue<S> = S extends ConfigSpec<infer T> ? T : never;

/**
 * Reads a record of specs into a record of values. Short-circuits on the first
 * failure in declaration order, exactly like `Result.all`; the variables after
 * it are never read. Requires the `Environment` capability.
 */
function readAll<const Specs extends Readonly<Record<string, ConfigSpec<any>>>>(
  specs: Specs,
): Result<{ -readonly [Key in keyof Specs]: SpecValue<Specs[Key]> }, ConfigError> {
  if (typeof specs !== "object" || specs === null || Array.isArray(specs)) {
    panic("Config.readAll requires a record of ConfigSpec values");
  }
  const environment = Environment.context();
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(specs)) {
    const entry = specs[key];
    if (!isConfigSpec(entry)) panic(`Config.readAll received a forged ConfigSpec for ${key}`);
    const outcome = readValue(environment, stateOf(entry));
    const inspected = outcome.match({
      ok: (value: unknown) => ({ ok: true as const, value }),
      error: (error: ConfigError) => ({ ok: false as const, error }),
    });
    if (!inspected.ok) return failure(inspected.error);
    values[key] = inspected.value;
  }
  return success(values as { -readonly [Key in keyof Specs]: SpecValue<Specs[Key]> });
}

export const Config = Object.freeze({
  string: (variable: string): ConfigSpec<string> =>
    typedSpec(variable, "string", readString, (value) => typeof value === "string", "Config.string"),
  number: (variable: string): ConfigSpec<number> =>
    typedSpec(variable, "number", readNumber, (value) => typeof value === "number" && Number.isFinite(value), "Config.number"),
  boolean: (variable: string): ConfigSpec<boolean> =>
    typedSpec(variable, "boolean", readBoolean, (value) => typeof value === "boolean", "Config.boolean"),
  duration: (variable: string): ConfigSpec<Duration> =>
    typedSpec(variable, "duration", readDuration, (value) => Duration.isDuration(value), "Config.duration"),
  instant: (variable: string): ConfigSpec<Instant> =>
    typedSpec(variable, "instant", readInstant, (value) => Instant.isInstant(value), "Config.instant"),
  read,
  readAll,
  isConfigSpec,
});
