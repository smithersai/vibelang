// Private fields, accessors, static blocks, optional chaining, and nullish
// coalescing: the emitter must not change any of their observable behavior.

class Counter {
  #count = 0;
  static #instances = 0;
  static registry: string[] = [];

  static {
    Counter.registry.push("initialized");
  }

  constructor(private readonly label: string) {
    Counter.#instances++;
  }

  get value(): number {
    return this.#count;
  }

  set value(next: number) {
    this.#count = Math.max(0, next);
  }

  bump(by = 1): this {
    this.#count += by;
    return this;
  }

  static get instances(): number {
    return Counter.#instances;
  }

  toString(): string {
    return `${this.label}=${this.#count}`;
  }
}

const counter = new Counter("hits").bump().bump(4);
console.log(counter.toString());
counter.value = -10;
console.log(`${counter.value}`);
console.log(`${Counter.instances} ${Counter.registry.join("")}`);

const maybe: { nested?: { value?: number } } = {};
console.log(`${maybe.nested?.value ?? -1}`);
console.log(`${(null as string | null)?.length ?? "absent"}`);

const tag = (parts: TemplateStringsArray, ...values: readonly unknown[]) =>
  parts.raw.join("|") + values.join(",");
console.log(tag`a${1}b${2}c`);

// This file is an ES module: the fork emits ESM, and module scope is what a
// real interop file has. Without it these top-level declarations would be
// script globals and could collide with the standard library.
export {};
