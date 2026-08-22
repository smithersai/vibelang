import {
  Channel,
  CancellationSource,
  Governor,
  Queue,
  Semaphore,
  Stream,
  TypedWorker,
  allKeyed,
  allSettledKeyed,
  awaitAll,
  bufferedUnordered,
  filterUnordered,
  mapUnordered,
} from "../../src/concurrency/index.ts";
import { Result } from "../../src/runtime/index.ts";
import { InvalidSample } from "./worker-demo.ts";

const joined = await awaitAll(
  (async () => { await Bun.sleep(3); return "profile"; })(),
  (async () => { await Bun.sleep(1); return "activity"; })(),
);

const keyed = await allKeyed({
  profile: Bun.sleep(3).then(() => "profile"),
  activity: Bun.sleep(1).then(() => "activity"),
});
const rawSettlements = await allSettledKeyed({
  ready: Promise.resolve(1),
  unavailable: Promise.reject(new Error("offline")),
});
const settlements = Object.fromEntries(Object.entries(rawSettlements).map(([key, settlement]) => [
  key,
  settlement.status === "fulfilled" ? settlement.status : `${settlement.status}: ${settlement.reason.message}`,
]));

const governor = Governor.withLimit(2);
const unordered: number[] = [];
for await (const value of mapUnordered([5, 1, 2], governor, async (delay) => {
  await Bun.sleep(delay);
  return delay;
})) unordered.push(value);

const filtered: number[] = [];
for await (const value of filterUnordered([1, 2, 3, 4], async (candidate) => {
  await Bun.sleep(5 - candidate);
  return candidate % 2 === 0;
}, governor)) filtered.push(value);

async function* records() {
  yield "one";
  yield "two";
  yield "three";
}
const buffered: string[] = [];
for await (const value of bufferedUnordered(records(), 2)) buffered.push(value);

const semaphore = new Semaphore(2);
let semaphoreActive = 0;
let semaphorePeak = 0;
await Promise.all([3, 1, 2].map((delay) => semaphore.withPermit(async () => {
  semaphoreActive += 1;
  semaphorePeak = Math.max(semaphorePeak, semaphoreActive);
  await Bun.sleep(delay);
  semaphoreActive -= 1;
})));

const queue = new Queue<string>(2);
await queue.offer("queued-one");
await queue.offer("queued-two");
queue.shutdown("demo complete");
const queueValues = [(await queue.take()).unwrap(), (await queue.take()).unwrap()];

const channel = new Channel<number>(2);
await channel.send(7);
await channel.send(8);
channel.close();
const channelValues: number[] = [];
for await (const value of channel) channelValues.push(value);

const streamCancellation = new CancellationSource();
const streamValues = (await Stream.of(1, 2, 3, 4)
  .filter((value) => value % 2 === 0)
  .mapConcurrent(async (value) => value * 10, { concurrency: 2, cancellation: streamCancellation })
  .buffer(1)
  .runCollect()).unwrap();

type AnalyticsWorker = Pick<typeof import("./worker-demo.ts"), "summarize">;
const analytics = await TypedWorker.spawn<AnalyticsWorker>(
  new URL("./worker-demo.ts", import.meta.url),
  { functions: ["summarize"], maxConcurrency: 2 },
);

let workerSummary: unknown;
try {
  const summaries = Result.all(Object.values(await allKeyed({
    first: analytics.summarize([2, 4, 6]),
    second: analytics.summarize([1, 3, 5]),
  })));
  workerSummary = summaries.match({
    ok: (values) => values,
    error: (error) => ({ invalidSample: error.is(InvalidSample) ? error.index : -1 }),
  });
} finally {
  await analytics.terminate();
}

console.log(JSON.stringify({
  buffered,
  channelValues,
  filtered,
  joined,
  keyed,
  queueValues,
  semaphorePeak,
  settlements,
  streamValues,
  unordered,
  workerSummary,
}, null, 2));
