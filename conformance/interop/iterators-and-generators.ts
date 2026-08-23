// Generators, iteration protocols, and the standard collections.

function* fibonacci(limit: number): Generator<number, string, undefined> {
  let [previous, current] = [0, 1];
  while (previous < limit) {
    yield previous;
    [previous, current] = [current, previous + current];
  }
  return "done";
}

class Range implements Iterable<number> {
  constructor(
    private readonly from: number,
    private readonly to: number,
  ) {}
  *[Symbol.iterator](): Iterator<number> {
    for (let value = this.from; value < this.to; value++) yield value;
  }
}

const numbers = [...fibonacci(20)];
console.log(numbers.join(","));

const iterator = fibonacci(3);
let completion: number | string | undefined;
for (;;) {
  const step = iterator.next();
  if (step.done) {
    completion = step.value;
    break;
  }
}
console.log(String(completion));

console.log([...new Range(1, 5)].join("-"));

const counts = new Map<string, number>([["a", 1]]);
counts.set("b", 2);
console.log([...counts.entries()].map(([key, value]) => `${key}=${value}`).join(","));
console.log(`${new Set([1, 1, 2, 3]).size}`);

// This file is an ES module: the fork emits ESM, and module scope is what a
// real interop file has. Without it these top-level declarations would be
// script globals and could collide with the standard library.
export {};
