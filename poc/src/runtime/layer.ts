import { AsyncLocalStorage } from "node:async_hooks";
import { isPromise } from "node:util/types";
import { panic } from "./panic.ts";

export type CapabilityKey<T = unknown> = abstract new (...args: any[]) => T;
export type CapabilityService<C extends CapabilityKey> = InstanceType<C>;

interface EnvironmentFrame {
  readonly values: ReadonlyMap<CapabilityKey, unknown>;
  active: boolean;
}

const environments = new AsyncLocalStorage<EnvironmentFrame>();

/** Compiler-recognized nominal base for capability classes. */
export abstract class Context {
  static context<C extends CapabilityKey>(this: C): InstanceType<C> {
    return useCapability(this);
  }
}

declare const layerType: unique symbol;

/** Runtime carrier for the compile-time Layer<Provides> environment. */
export interface Layer<Provides> {
  readonly [layerType]: {
    readonly provides: Provides;
  };
}

type ProvidesOf<L> = L extends Layer<infer Provides> ? Provides : never;
type AnyLayer = Layer<any>;

const layerEntries = new WeakMap<object, ReadonlyMap<CapabilityKey, unknown>>();
const localLayers = new WeakSet<object>();

function makeLayer<Provides>(
  entries: ReadonlyMap<CapabilityKey, unknown>,
): Layer<Provides> {
  const layer = Object.freeze(Object.create(null)) as Layer<Provides>;
  layerEntries.set(layer, new Map(entries));
  localLayers.add(layer);
  return layer;
}

function entriesOf(layer: AnyLayer): ReadonlyMap<CapabilityKey, unknown> {
  if (typeof layer !== "object" || layer === null || !localLayers.has(layer)) panic("forged Layer value");
  const entries = layerEntries.get(layer);
  if (!entries) panic("invalid Layer value");
  return entries;
}

function validateCapability(capability: CapabilityKey): void {
  if (typeof capability !== "function" || typeof capability.prototype !== "object" || capability.prototype === null) {
    throw new TypeError("Layer capability key must be a class");
  }
}

export function isLayer(value: unknown): value is AnyLayer {
  return typeof value === "object" && value !== null && localLayers.has(value);
}

export const Layer = Object.freeze({
  succeed<C extends CapabilityKey>(capability: C, implementation: CapabilityService<C>): Layer<C> {
    validateCapability(capability);
    if (implementation === null || implementation === undefined) {
      throw new TypeError(`Layer implementation for ${capability.name || "<anonymous>"} is absent`);
    }
    return makeLayer<C>(new Map([[capability, implementation]]));
  },

  merge<const Layers extends readonly AnyLayer[]>(
    ...layers: Layers
  ): Layer<ProvidesOf<Layers[number]>> {
    const entries = new Map<CapabilityKey, unknown>();
    for (const layer of layers) {
      for (const [capability, implementation] of entriesOf(layer)) {
        // Merge and override precedence are still open. Failing closed avoids
        // silently selecting semantics that the language has not accepted.
        if (entries.has(capability)) {
          throw new TypeError(`Layer.merge has duplicate capability ${capability.name || "<anonymous>"}`);
        }
        entries.set(capability, implementation);
      }
    }
    return makeLayer(entries) as Layer<ProvidesOf<Layers[number]>>;
  },

  /**
   * Establish only a dependency environment. AsyncLocalStorage carries it
   * through the Promise returned by body, but Layer deliberately does not
   * acquire resources, dispose services, retain/supervise child Promises, or
   * own work.
   * Async scope requires the returned Promise to be created during body (an
   * async wrapper is sufficient) so settlement can be observed exactly.
   */
  provide<T>(layer: AnyLayer, body: () => T): T {
    if (typeof body !== "function") throw new TypeError("Layer.provide requires a body function");
    const inherited = environments.getStore();
    const values = new Map(inherited?.active ? inherited.values : []);
    for (const [capability, implementation] of entriesOf(layer)) {
      if (values.has(capability)) {
        throw new TypeError(`nested Layer override for ${capability.name || "<anonymous>"} is not specified`);
      }
      values.set(capability, implementation);
    }
    const frame: EnvironmentFrame = { values, active: true };
    return environments.run(frame, () => {
      let result: T;
      try {
        result = body();
      } catch (error) {
        frame.active = false;
        throw error;
      }

      if (isPromise(result)) {
        // Revoked when the body's Promise settles, through an ordinary
        // reaction. `specification/requirements.mdx` §Scoping WITHDREW the rule
        // that required this to happen before any reaction the body registered
        // first, and replaced it with three prohibitions this satisfies and the
        // apparatus it replaces violated: a runtime "MUST NOT require a host
        // promise-settlement hook, MUST NOT restrict which Promise a provider
        // body returns, and MUST NOT refuse an async provider scope on a host
        // that cannot observe Promise settlement synchronously".
        //
        // `void`, not `return result.finally(...)`: the caller must receive the
        // Promise the body returned, not a derived one.
        void result.then(
          () => { frame.active = false; },
          () => { frame.active = false; },
        );
        return result;
      }

      frame.active = false;
      return result;
    });
  },
});

/* ------------------------------------------------------------------------- *
 * The lowering seam.
 *
 * A lowered `.sm` module does not call `Layer.provide` at all: the emitter
 * lowers it into a handler install (`runtime/effect.ts`'s `__vsProvide`), and
 * the three functions below are the only part of THIS module that install
 * still runs. They exist rather than a second `Layer.provide` overload because
 * a handler-delimited computation answers "when is a Layer's extent over?"
 * STRUCTURALLY — the extent is the `handle` frame — where `Layer.provide` has
 * to answer it for a Promise it did not create.
 *
 * That difference is why the promise-hook apparatus that used to live at the
 * top of this file is gone. It answered the same question for an async body by
 * installing a V8 settlement hook, and it cost three things the specification
 * has since prohibited: it required a host settlement hook, it restricted which
 * Promise a provider body could return (the author-visible
 * `async () => await promise` wart), and it REFUSED an async provider scope
 * outright on a host without `promiseHooks` — which is Bun, the host every test
 * and every conformance case in this repository runs on. Its deletion was
 * licensed by measurement, not by argument: the conformance epilogue in
 * `conformance/runner/backend-js.mjs` asserted the apparatus was never engaged
 * across all 515 corpus programs before it was removed.
 *
 * The AsyncLocalStorage frame is still established, and that is not an
 * oversight. A `.sm` capability read that the emitter did not lower — inside a
 * property accessor, inside a host callback like `Array.prototype.map`'s, or in
 * any `.ts` module that was never compiled by this frontend — still reaches
 * `useCapability`, and there is no generator frame under it to carry a request.
 * The ALS store is the compatibility shim for those callers and outlives the
 * lowering by design.
 * ------------------------------------------------------------------------- */

/** An open dependency environment. Opaque; only the three functions below read it. */
export interface EnvironmentScope {
  readonly frame: EnvironmentFrame;
}

/**
 * The entries a Layer registers, with the same forgery refusal `Layer.provide`
 * applies. Typed `unknown` because the emitter hands over whatever the author
 * wrote — `x satisfies Layer<typeof Db>`, `<any>x`, a `const` binding — and the
 * runtime identity check, not the static type, is what decides.
 */
export function __vsLayerEntries(layer: unknown): ReadonlyMap<CapabilityKey, unknown> {
  return entriesOf(layer as AnyLayer);
}

/**
 * Layer `entries` over the ambient environment, exactly as `Layer.provide`
 * does — including its refusal of a nested override, which is unspecified in
 * both lowerings and must stay unspecified in both.
 */
export function __vsOpenScope(entries: ReadonlyMap<CapabilityKey, unknown>): EnvironmentScope {
  const inherited = environments.getStore();
  const values = new Map(inherited?.active ? inherited.values : []);
  for (const [capability, implementation] of entries) {
    if (values.has(capability)) {
      throw new TypeError(`nested Layer override for ${capability.name || "<anonymous>"} is not specified`);
    }
    values.set(capability, implementation);
  }
  return { frame: { values, active: true } };
}

/**
 * Run one step of the delimited computation inside `scope`.
 *
 * Per STEP, not once around the whole run: a generator that suspends leaves
 * this frame and re-enters it, and a request forwarded to an OUTER handler must
 * be answered in the outer environment, not this one. Wrapping the drive once
 * would keep this frame active across a suspension and make an un-lowered read
 * in an outer computation see an inner layer.
 */
export function __vsInScope<T>(scope: EnvironmentScope, body: () => T): T {
  return environments.run(scope.frame, body);
}

/** End the extent. Idempotent, and every exit path takes it. */
export function __vsCloseScope(scope: EnvironmentScope): void {
  scope.frame.active = false;
}

export function useCapability<C extends CapabilityKey>(capability: C): InstanceType<C>;
export function useCapability<T>(capability: CapabilityKey<T>): T;
export function useCapability<T>(capability: CapabilityKey<T>): T {
  validateCapability(capability);
  const environment = environments.getStore();
  if (environment?.active && environment.values.has(capability)) return environment.values.get(capability) as T;
  panic(`capability '${capability.name || "<anonymous capability>"}' was not provided`);
}

export { useCapability as __vsUse };
