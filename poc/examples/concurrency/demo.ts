import { awaitAll, mapUnordered } from "../../src/concurrency/index.ts";

const joined = await awaitAll(
  (async () => { await Bun.sleep(3); return "profile"; })(),
  (async () => { await Bun.sleep(1); return "activity"; })(),
);

const unordered: number[] = [];
for await (const value of mapUnordered([5, 1, 2], 2, async (delay) => {
  await Bun.sleep(delay);
  return delay;
})) unordered.push(value);

console.log(JSON.stringify({ joined, unordered }, null, 2));
