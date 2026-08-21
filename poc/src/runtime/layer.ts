import { AsyncLocalStorage } from "node:async_hooks";

export type CapabilityKey<T = unknown> = Function & { prototype?: T };

const environments = new AsyncLocalStorage<ReadonlyMap<CapabilityKey, unknown>>();

/** Runtime carrier for the compile-time Layer<Provides, Error, Requires> row. */
export interface Layer<Provides = unknown, InitError = never, Requires = never> {
  readonly entries: ReadonlyMap<CapabilityKey, unknown>;
  readonly _rows?: {
    readonly provides: Provides;
    readonly error: InitError;
    readonly requires: Requires;
  };
}

function makeLayer(entries: ReadonlyMap<CapabilityKey, unknown>): Layer {
  return Object.freeze({ entries });
}

export const Layer = {
  succeed<C extends CapabilityKey, I>(capability: C, implementation: I): Layer<C> {
    return makeLayer(new Map([[capability, implementation]])) as Layer<C>;
  },

  merge<const L extends readonly Layer[]>(...layers: L): Layer {
    const entries = new Map<CapabilityKey, unknown>();
    for (const layer of layers) {
      for (const [capability, implementation] of layer.entries) {
        entries.set(capability, implementation);
      }
    }
    return makeLayer(entries);
  },

  /**
   * A copied frame makes nested override semantics obvious. AsyncLocalStorage
   * keeps concurrent async scopes isolated, which is the important runtime
   * risk the historical module-global stack could not handle.
   */
  provide<T>(layer: Layer, body: () => T): T {
    const frame = new Map(environments.getStore() ?? []);
    for (const [capability, implementation] of layer.entries) {
      frame.set(capability, implementation);
    }
    return environments.run(frame, body);
  },
};

export function useCapability<T>(capability: CapabilityKey<T>): T {
  const environment = environments.getStore();
  if (environment?.has(capability)) return environment.get(capability) as T;
  const name = capability.name || "<anonymous capability>";
  // Missing provision is a defect, never a branded recoverable failure.
  throw new Error(`VibeLang defect: capability '${name}' was not provided`);
}

export { useCapability as __vsUse };
