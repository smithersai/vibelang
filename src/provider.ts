import { Layer as RuntimeLayer } from "../poc/dist/runtime/layer.js";
import type { Context } from "./context.js";
import type { Result } from "./result.js";

declare const layerVariance: unique symbol;
declare const actionSignature: unique symbol;

/** An already-acquired dependency environment; it owns no resources or work. */
export interface Layer<Provides> {
  readonly [layerVariance]: {
    readonly provides: Provides;
  };
}

type ProvidesOf<Environment> = Environment extends Layer<infer Provides> ? Provides : never;

export const Layer = {
  succeed<Service extends Context>(
    service: abstract new (...args: never[]) => Service,
    implementation: Service,
  ): Layer<Service> {
    const succeed = RuntimeLayer.succeed as unknown as (
      capability: abstract new (...args: never[]) => unknown,
      value: unknown,
    ) => unknown;
    return succeed(service, implementation) as Layer<Service>;
  },

  merge<const Layers extends readonly Layer<unknown>[]>(
    ...layers: Layers
  ): Layer<ProvidesOf<Layers[number]>> {
    return RuntimeLayer.merge(
      ...layers as unknown as Parameters<typeof RuntimeLayer.merge>,
    ) as unknown as Layer<ProvidesOf<Layers[number]>>;
  },

  provide<Provides, Value>(
    layer: Layer<Provides>,
    body: () => Value,
  ): Value {
    return RuntimeLayer.provide(
      layer as unknown as Parameters<typeof RuntimeLayer.provide>[0],
      body,
    );
  },
} as const;

type ActionReturn =
  | Result<unknown, globalThis.Error>
  | Promise<Result<unknown, globalThis.Error>>;

export abstract class Action<Signature extends (...args: never[]) => ActionReturn> {
  declare readonly [actionSignature]: Signature;

  static run(..._args: never[]): never {
    throw new Error("Action.run is only valid while the durable Flow compiler is planning a flow");
  }

  static provide(..._args: never[]): never {
    throw new Error("Action.provide is not part of the prototype runtime; use smthrs/durable/bun");
  }
}

export interface Flow<Input, Output> {
  readonly input: (_: Input) => void;
  readonly output: () => Output;
}

export function Flow<Input, Output>(_body: (input: Input) => Output): Flow<Input, Output> {
  throw new Error("class-style Flow is not implemented; use Flow.define from smthrs/durable/authoring");
}

export interface Durable<T> {
  readonly encode: (value: T) => Uint8Array;
  readonly decode: (bytes: Uint8Array) => T;
}
