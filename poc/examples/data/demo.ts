/**
 * Core Data: values with value semantics.
 *
 *   bun examples/data/demo.ts
 *
 * Everything below is an ordinary value. Nothing here is a wrapper that exists
 * to track an effect, nothing needs a Layer, and nothing needs a capability —
 * `Chunk`, `HashMap`, `HashSet`, and `Data` are pure the way `Duration` is.
 * The two rules worth watching for as you read:
 *
 *   1. A lookup that can miss answers with an `Optional`, never `undefined`.
 *   2. Equality and hashing come from one seam, `Equivalence` + `Hash`, and
 *      obey one law: equal values hash equal.
 */

import {
  Chunk,
  Data,
  Equivalence,
  Hash,
  HashMap,
  HashSet,
  Match,
} from "../../src/data/index.ts";
import { RuntimeValues } from "../../src/runtime/values.ts";

function heading(title: string): void {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
}

// ---------------------------------------------------------------------------
heading("Chunk: an immutable indexed sequence");

const readings = Chunk.of(12, 7, 19, 3)
  .append(25)
  .prepend(1)
  .filter((value) => value > 5)
  .map((value) => value * 10);

console.log("readings      ", readings.toArray());
console.log("size          ", readings.size);
console.log("total         ", readings.reduce((total, value) => total + value, 0));
console.log("first two     ", readings.take(2).toArray());

// A hit and a miss, both answered with an Optional.
console.log("get(1)        ", readings.get(1).unwrapOr("absent"));
console.log("get(99)       ", readings.get(99).unwrapOr("absent"));
console.log("head / last   ", readings.head().unwrapOr("absent"), readings.last().unwrapOr("absent"));
console.log("empty.head()  ", Chunk.empty<number>().head().unwrapOr("absent"));

// The receiver is never touched, and the array it hands back is frozen.
const base = Chunk.of("a", "b");
const grown = base.append("c");
console.log("base / grown  ", base.toArray(), grown.toArray());
console.log("frozen result ", Object.isFrozen(base.toArray()));

// ---------------------------------------------------------------------------
heading("Data: structural value semantics");

const shard = Data.struct({ region: "us-east", index: 3, replicas: ["a", "b"] });
const sameShard = Data.struct({ index: 3, region: "us-east", replicas: ["a", "b"] });

console.log("equal         ", Data.equals(shard, sameShard));
console.log("hashes agree  ", Data.hash(shard) === Data.hash(sameShard));
console.log("frozen deeply ", Object.isFrozen(shard), Object.isFrozen(shard.replicas));
console.log("nested is Data", Data.isData(shard.replicas));

// The boundary: a plain object that was never converted compares by reference.
const plain = { region: "us-east", index: 3 };
console.log("plain vs plain", Data.equals(plain, { region: "us-east", index: 3 }));

// ---------------------------------------------------------------------------
heading("HashMap: structural keys, Optional lookups");

const placement = HashMap.of<unknown, string>(
  [shard, "primary"],
  [Chunk.of("eu", "west"), "mirror"],
);

// A structurally equal key finds the same entry, though it is a different object.
console.log("by twin key   ", placement.get(sameShard).unwrapOr("absent"));
console.log("by rebuilt    ", placement.get(Chunk.of("eu").append("west")).unwrapOr("absent"));
console.log("miss          ", placement.get(Data.struct({ region: "ap", index: 0 })).unwrapOr("absent"));

// set/remove return new maps; iteration is insertion order, never hash order.
const counts = HashMap.of<string, number>(["b", 1], ["a", 2], ["c", 3]);
console.log("insertion ord ", [...counts.keys()]);
console.log("after set(b)  ", [...counts.set("b", 9).entries()]);
console.log("original      ", [...counts.entries()]);

// A custom keying: two strings that differ only in case are one key.
const caseInsensitive = Equivalence.make<string>((left, right) => left.toLowerCase() === right.toLowerCase());
const caseInsensitiveHash = Hash.string.contramap((value: string) => value.toLowerCase());
const headers = HashMap.make<string, string>(caseInsensitive, caseInsensitiveHash, [["Content-Type", "text/plain"]]);
console.log("header lookup ", headers.get("CONTENT-TYPE").unwrapOr("absent"));

// ---------------------------------------------------------------------------
heading("HashSet: membership by shape");

const running = HashSet.of("api", "worker", "cron");
const desired = HashSet.of("api", "worker", "scheduler");

console.log("running       ", running.toArray());
console.log("union         ", running.union(desired).toArray());
console.log("both          ", running.intersection(desired).toArray());
console.log("to stop       ", running.difference(desired).toArray());
console.log("to start      ", desired.difference(running).toArray());
console.log("subset        ", running.intersection(desired).isSubsetOf(running));

// Sets of structural values work with no ceremony at all.
const seen = HashSet.of<unknown>(Data.struct({ id: 1 }), Data.struct({ id: 2 }));
console.log("seen id 1     ", seen.has(Data.struct({ id: 1 })));
console.log("adding a twin ", seen.add(Data.struct({ id: 1 })).size);

// ---------------------------------------------------------------------------
heading("The law: equal values hash equal");

// `Hash.checkLaws` answers with an absence when a pairing is lawful, and with a
// description of the first violation when it is not.
const samples = ["Alpha", "alpha", "beta", "BETA"];
console.log("lawful pair   ", Hash.checkLaws(caseInsensitive, caseInsensitiveHash, samples).unwrapOr("lawful"));
console.log("broken pair   ", Hash.checkLaws(caseInsensitive, Hash.string, samples).unwrapOr("lawful"));

// That is not a formality. A map keyed by the broken pair cannot find its key.
const broken = HashMap.make<string, string>(caseInsensitive, Hash.string, [["Alpha", "one"]]);
console.log("broken lookup ", broken.get("alpha").unwrapOr("unreachable"));

// The structural defaults are lawful over everything in this file.
const everything: unknown[] = [1, -0, 0, Number.NaN, "a", true, shard, sameShard, readings, counts, running];
console.log("defaults      ", Hash.checkLaws(Equivalence.any, Hash.any, everything).unwrapOr("lawful"));

// ---------------------------------------------------------------------------
heading("Match: pattern matching without new syntax");

type Shape =
  | { readonly kind: "circle"; readonly radius: number }
  | { readonly kind: "square"; readonly side: number }
  | { readonly kind: "rect"; readonly width: number; readonly height: number };

// Every arm narrows, and `.exhaustive()` is only *callable* once the arms have
// consumed the whole union — delete one and this file stops compiling.
const area = (shape: Shape): number =>
  Match.value(shape)
    .whenTag("circle", (found) => Math.PI * found.radius ** 2)
    .whenTag("square", (found) => found.side ** 2)
    .whenTag("rect", (found) => found.width * found.height)
    .exhaustive();

console.log("areas         ", [
  area({ kind: "circle", radius: 1 }).toFixed(2),
  area({ kind: "square", side: 3 }).toFixed(2),
  area({ kind: "rect", width: 2, height: 5 }).toFixed(2),
]);

// Three kinds of pattern, told apart by what the pattern *is*: a function is a
// predicate, a plain object is a structural template, anything else is a value.
const classify = (input: unknown): string =>
  Match.value(input)
    .when({ kind: "circle", radius: 0 }, () => "a degenerate circle")
    .when({ at: { x: Match.number, y: Match.number } }, () => "something with a point")
    .when(Chunk.of(1, 2, 3), () => "exactly that chunk")
    .when(Number.NaN, () => "not a number")
    .when(Match.string, (found) => `the string ${JSON.stringify(found)}`)
    .orElse(() => "something else")
    .run();

console.log("degenerate    ", classify({ kind: "circle", radius: 0 }));
console.log("has a point   ", classify({ id: 9, at: { x: 1, y: 2 } }));
console.log("by value      ", classify(Chunk.of(1).append(2).append(3)));
console.log("NaN           ", classify(Number.NaN));
console.log("a string      ", classify("hello"));
console.log("fallback      ", classify(42));

// Templates match subsets, so one template reads a widening record; a `Data`
// value is a value, so it has to be equal in whole.
console.log("subset        ", classify({ kind: "circle", radius: 0, extra: "ignored" }));
console.log("Data is exact ", Match.value<unknown>(Data.struct({ x: 1, y: 2 }))
  .when(Data.struct({ x: 1 }), () => "matched")
  .orElse(() => "not equal in whole")
  .run());

// An Optional or Result scrutinee gets variant arms instead, and the same
// exhaustiveness proof applies to them.
const { present, absent } = RuntimeValues;
const describeOptional = (value: ReturnType<typeof present<number>>): string =>
  Match.value(value)
    .whenSome((found) => `present: ${found}`)
    .whenNone(() => "absent")
    .exhaustive();

console.log("optional      ", describeOptional(present(7)), "/", describeOptional(absent()));

console.log();
