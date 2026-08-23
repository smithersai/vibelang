import { registerErrorCodec, type JsonValue, type NominalError } from "../../src/runtime/errors.ts";
import type { Optional } from "../../src/runtime/optional.ts";
import {
  __vsResultFailure,
  __vsResultSuccess,
  type Result,
} from "../../src/runtime/result.ts";

export class FixtureError extends Error {
  constructor(
    readonly code: string,
    message = `fixture failed: ${code}`,
  ) {
    super(message);
    this.name = "FixtureError";
  }
}
export interface FixtureError extends NominalError<"smithers:test/FixtureError@1"> {}

registerErrorCodec(FixtureError, "smithers:test/FixtureError@1", {
  encode: (error): JsonValue => ({ code: error.code, message: error.message }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 2 || typeof payload.code !== "string" || typeof payload.message !== "string"
    ) throw new TypeError("invalid FixtureError payload");
    return new FixtureError(payload.code, payload.message);
  },
});

export function echo(input: unknown): unknown {
  return input;
}

export function reflectResult(
  input: Result<unknown, Error>,
): Result<Result<unknown, Error>, never> {
  return __vsResultSuccess(input);
}

export function reflectOptional(input: Optional<string>): Result<Optional<string>, never> {
  return __vsResultSuccess(input);
}

export function reflectError(input: FixtureError): Result<FixtureError, never> {
  return __vsResultSuccess(input);
}

export function fail(code: string): Result<never, FixtureError> {
  return __vsResultFailure(new FixtureError(code));
}

export function badOutput(_input: null): Date {
  return new Date(0);
}

export async function delay(input: { readonly milliseconds: number; readonly value: string }): Promise<string> {
  await Bun.sleep(input.milliseconds);
  return input.value;
}

let active = 0;
let peak = 0;

export async function bounded(milliseconds: number): Promise<number> {
  active++;
  peak = Math.max(peak, active);
  try {
    await Bun.sleep(milliseconds);
    return active;
  } finally {
    active--;
  }
}

export function peakConcurrency(_input: null): number {
  return peak;
}

export function crash(exitCode: number): never {
  process.exit(exitCode);
}
