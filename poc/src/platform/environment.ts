import { Context } from "../runtime/layer.ts";
import { Optional } from "../runtime/optional.ts";

/**
 * Process environment variables. An absent name is an ordinary `Optional`
 * absence, not a failure: nothing went wrong when a variable is unset.
 */
export abstract class Environment extends Context {
  abstract get(name: string): Optional<string>;

  /** Every defined name, sorted, so listings are stable across implementations. */
  abstract names(): readonly string[];
}

/** Node/Bun live implementation reading `process.env` at call time. */
export class ProcessEnvironment extends Environment {
  static make(): ProcessEnvironment {
    return new ProcessEnvironment();
  }

  get(name: string): Optional<string> {
    if (name.length === 0) return Optional.fromNullable<string>(undefined);
    return Optional.fromNullable(process.env[name]);
  }

  names(): readonly string[] {
    return Object.keys(process.env).sort();
  }
}

/**
 * In-memory implementation. A `Map` is used rather than a plain object so that
 * a variable named `__proto__` or `constructor` behaves like any other name.
 */
export class MapEnvironment extends Environment {
  readonly #values = new Map<string, string>();

  private constructor(entries: Readonly<Record<string, string>>) {
    super();
    for (const [name, value] of Object.entries(entries)) this.#values.set(name, value);
  }

  static empty(): MapEnvironment {
    return new MapEnvironment({});
  }

  static of(entries: Readonly<Record<string, string>>): MapEnvironment {
    return new MapEnvironment(entries);
  }

  set(name: string, value: string): this {
    this.#values.set(name, value);
    return this;
  }

  unset(name: string): this {
    this.#values.delete(name);
    return this;
  }

  get(name: string): Optional<string> {
    return Optional.fromNullable(this.#values.get(name));
  }

  names(): readonly string[] {
    return [...this.#values.keys()].sort();
  }
}
