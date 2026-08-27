import { Context } from "../runtime/layer.ts";

/**
 * Process environment variables. An unset name is ordinary absence —
 * `string | undefined` — not a failure: nothing went wrong when a variable is
 * unset.
 */
export abstract class Environment extends Context {
  abstract get(name: string): string | undefined;

  /** Every defined name, sorted, so listings are stable across implementations. */
  abstract names(): readonly string[];
}

/** Node/Bun live implementation reading `process.env` at call time. */
export class ProcessEnvironment extends Environment {
  static make(): ProcessEnvironment {
    return new ProcessEnvironment();
  }

  get(name: string): string | undefined {
    if (name.length === 0) return undefined;
    // `process.env[name]` inherits from `Object.prototype` on every host this
    // POC runs on, so `constructor`, `toString`, `valueOf`, `hasOwnProperty`
    // and their siblings answer with a function, and `__proto__` answers with
    // an object, from a method declared `string | undefined`. `names()` never
    // lists any of them, so the value could only ever be an inherited member
    // rather than a variable. Reading the own descriptor gives this
    // implementation the same policy `MapEnvironment` states below: a variable
    // named `__proto__` or `constructor` behaves like any other name, and one
    // that is unset is ordinary absence.
    const value: unknown = Object.getOwnPropertyDescriptor(process.env, name)?.value;
    return typeof value === "string" ? value : undefined;
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

  get(name: string): string | undefined {
    return this.#values.get(name);
  }

  names(): readonly string[] {
    return [...this.#values.keys()].sort();
  }
}
