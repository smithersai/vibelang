// Modern JavaScript surface that the emitter must leave semantically intact.

type Options = { readonly retries?: number; readonly label?: string };

function configure({ retries = 3, label = "default" }: Options = {}): string {
  return `${label}:${retries}`;
}

function total(first: number, ...rest: readonly number[]): number {
  return rest.reduce((sum, value) => sum + value, first);
}

const base = { a: 1, b: 2 };
const extended = { ...base, c: 3 };
const [head, ...tail] = [10, 20, 30];
const { a, ...others } = extended;

console.log(configure());
console.log(configure({ retries: 5 }));
console.log(`${total(1, 2, 3, 4)}`);
console.log(`${head} ${tail.join("-")}`);
console.log(`${a} ${JSON.stringify(others)}`);
console.log(`${Object.keys(extended).join("")}`);

// This file is an ES module: the fork emits ESM, and module scope is what a
// real interop file has. Without it these top-level declarations would be
// script globals and could collide with the standard library.
export {};
