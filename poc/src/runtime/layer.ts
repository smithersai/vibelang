import { AsyncLocalStorage } from "node:async_hooks";
import { isPromise } from "node:util/types";
import { promiseHooks } from "node:v8";
import { panic } from "./panic.ts";

export type CapabilityKey<T = unknown> = abstract new (...args: any[]) => T;
export type CapabilityService<C extends CapabilityKey> = InstanceType<C>;

interface EnvironmentFrame {
  readonly values: ReadonlyMap<CapabilityKey, unknown>;
  active: boolean;
}

const environments = new AsyncLocalStorage<EnvironmentFrame>();

interface PromiseTrackingLease {
  readonly token: object;
  readonly release: () => void;
}

interface PromiseRegistration {
  readonly frame: EnvironmentFrame;
  readonly release: () => void;
}

// Promise reactions run after settlement and in registration order. Merely
// appending `.then(() => frame.active = false)` therefore revokes too late when
// body registered an earlier reaction. V8's settlement hook runs at the state
// transition, before any reaction, which is the boundary Layer promises.
//
// The hook is installed lazily and retained only while a provide invocation or
// one of its returned Promises is live. Promise provenance lets us reject a
// pre-existing Promise: it may have reactions registered before our observer,
// and hosts without a synchronous settlement hook cannot make that safe.
const promiseOrigins = new WeakMap<Promise<unknown>, object>();
const settledPromises = new WeakSet<Promise<unknown>>();
const trackedPromises = new WeakSet<Promise<unknown>>();
const promiseRegistrations = new WeakMap<Promise<unknown>, Set<PromiseRegistration>>();
let currentPromiseOrigin: object | undefined;
let stopPromiseHook: (() => void) | undefined;
let promiseHookLeases = 0;
let promiseHooksUnavailable = false;

const promiseHookCallbacks = {
  init(promise: Promise<unknown>): void {
    if (currentPromiseOrigin) promiseOrigins.set(promise, currentPromiseOrigin);
  },
  settled(promise: Promise<unknown>): void {
    settledPromises.add(promise);
    const registrations = promiseRegistrations.get(promise);
    if (!registrations) return;
    promiseRegistrations.delete(promise);
    for (const registration of registrations) {
      registration.frame.active = false;
      registration.release();
    }
  },
};

function acquirePromiseTracking(): PromiseTrackingLease | undefined {
  if (promiseHooksUnavailable) return undefined;
  if (!stopPromiseHook) {
    try {
      const stop = promiseHooks.createHook(promiseHookCallbacks);
      stopPromiseHook = () => { stop(); };
    } catch {
      // Bun 1.x exposes node:v8's shape but not promise hooks. Synchronous
      // Layer scopes remain valid there; async scopes fail closed below.
      promiseHooksUnavailable = true;
      return undefined;
    }
  }
  promiseHookLeases += 1;
  const token = Object.create(null) as object;
  let released = false;
  return {
    token,
    release(): void {
      if (released) return;
      released = true;
      promiseHookLeases -= 1;
      if (promiseHookLeases === 0) {
        const stop = stopPromiseHook;
        stopPromiseHook = undefined;
        stop?.();
      }
    },
  };
}

function registerPromiseScope(
  promise: Promise<unknown>,
  frame: EnvironmentFrame,
  lease: PromiseTrackingLease | undefined,
): void {
  if (!lease) {
    frame.active = false;
    throw new TypeError(
      "Layer.provide cannot keep an async environment on this host: exact Promise settlement hooks are unavailable",
    );
  }
  if (promiseOrigins.get(promise) !== lease.token && !trackedPromises.has(promise)) {
    frame.active = false;
    lease.release();
    throw new TypeError(
      "Layer.provide async body must return a Promise created by that body; wrap an existing Promise with `async () => await promise`",
    );
  }
  trackedPromises.add(promise);
  if (settledPromises.has(promise)) {
    frame.active = false;
    lease.release();
    return;
  }
  const registration: PromiseRegistration = { frame, release: lease.release };
  const registrations = promiseRegistrations.get(promise);
  if (registrations) registrations.add(registration);
  else promiseRegistrations.set(promise, new Set([registration]));
}

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
    const tracking = acquirePromiseTracking();
    return environments.run(frame, () => {
      const previousPromiseOrigin = currentPromiseOrigin;
      currentPromiseOrigin = tracking?.token;
      let result: T;
      try {
        result = body();
      } catch (error) {
        frame.active = false;
        tracking?.release();
        throw error;
      } finally {
        currentPromiseOrigin = previousPromiseOrigin;
      }

      if (isPromise(result)) {
        registerPromiseScope(result, frame, tracking);
        return result;
      }

      frame.active = false;
      tracking?.release();
      return result;
    });
  },
});

export function useCapability<C extends CapabilityKey>(capability: C): InstanceType<C>;
export function useCapability<T>(capability: CapabilityKey<T>): T;
export function useCapability<T>(capability: CapabilityKey<T>): T {
  validateCapability(capability);
  const environment = environments.getStore();
  if (environment?.active && environment.values.has(capability)) return environment.values.get(capability) as T;
  panic(`capability '${capability.name || "<anonymous capability>"}' was not provided`);
}

export { useCapability as __vsUse };
