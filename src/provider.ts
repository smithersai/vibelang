import { NotImplementedError } from "./vibe.js";
import type { Context } from "./context.js";

declare const layerVariance: unique symbol;
declare const actionSignature: unique symbol;

export interface Layer<Provides, Error = never, Requires = never> {
  readonly [layerVariance]: {
    readonly provides: Provides;
    readonly error: Error;
    readonly requires: Requires;
  };
}

export const Layer = {
  succeed<Service extends Context>(
    _service: abstract new (...args: never[]) => Service,
    _implementation: Service,
  ): Layer<Service> {
    throw new NotImplementedError("Layer.succeed");
  },

  merge<Layers extends readonly Layer<unknown, unknown, unknown>[]>(
    ..._layers: Layers
  ): Layer<unknown, unknown, unknown> {
    throw new NotImplementedError("Layer.merge");
  },

  provide<Provides, Error, Requires, Value>(
    _layer: Layer<Provides, Error, Requires>,
    _body: () => Value,
  ): Value {
    throw new NotImplementedError("Layer.provide");
  },
} as const;

export abstract class Action<Signature extends (...args: never[]) => unknown> {
  declare readonly [actionSignature]: Signature;

  static run(..._args: never[]): never {
    throw new NotImplementedError("Action.run");
  }

  static provide(..._args: never[]): never {
    throw new NotImplementedError("Action.provide");
  }
}

export interface Flow<Input, Output> {
  readonly input: (_: Input) => void;
  readonly output: () => Output;
}

export function Flow<Input, Output>(_body: (input: Input) => Output): Flow<Input, Output> {
  throw new NotImplementedError("Flow compilation");
}

export interface Durable<T> {
  readonly encode: (value: T) => Uint8Array;
  readonly decode: (bytes: Uint8Array) => T;
}
