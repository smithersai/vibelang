import { registerErrorCodec, type JsonValue, type NominalError } from "../../src/runtime/errors.ts";
import {
  __vsResultFailure,
  __vsResultSuccess,
  type Result,
} from "../../src/runtime/result.ts";

export class InvalidSample extends Error {
  constructor(readonly index: number) {
    super(`sample ${index} is not finite`);
    this.name = "InvalidSample";
  }
}
export interface InvalidSample extends NominalError<"vibelang:examples/InvalidSample@1"> {}

registerErrorCodec(InvalidSample, "vibelang:examples/InvalidSample@1", {
  encode: (error): JsonValue => ({ index: error.index }),
  decode: (payload) => {
    if (
      payload === null || Array.isArray(payload) || typeof payload !== "object" ||
      Object.keys(payload).length !== 1 || typeof payload.index !== "number" || !Number.isInteger(payload.index)
    ) throw new TypeError("invalid InvalidSample payload");
    return new InvalidSample(payload.index);
  },
});

export interface Summary {
  readonly count: number;
  readonly mean: number;
}

export function summarize(values: readonly number[]): Result<Summary, InvalidSample> {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) return __vsResultFailure(new InvalidSample(index));
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return __vsResultSuccess({ count: values.length, mean: values.length === 0 ? 0 : total / values.length });
}
