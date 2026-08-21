import { NotImplementedError } from "./vibe.js";

declare const contextRequirements: unique symbol;

type CapabilityClass<Service extends Context = Context> =
  & (abstract new (...args: never[]) => Service)
  & { readonly name: string };

/**
 * Base class for nominal VibeLang capabilities.
 *
 * The compiler recognizes `Capability.context()` and records the capability in
 * the enclosing function's inferred context channel. The runtime lowering is
 * not implemented yet.
 */
export abstract class Context {
  static context<Service extends Context>(this: CapabilityClass<Service>): Service {
    throw new NotImplementedError(`${this.name}.context`);
  }
}

export namespace Context {
  /** Static representation used by declarations to retain an inferred context row. */
  export type Function<Fn extends (...args: never[]) => unknown, Requirements> = Fn & {
    readonly [contextRequirements]: (_: Requirements) => Requirements;
  };
}
