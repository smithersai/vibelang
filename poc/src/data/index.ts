/**
 * The Core Data standard-library slice: `Chunk`, `HashMap`, `HashSet`, `Data`,
 * and the `Equivalence`/`Hash` seam they are all built on
 * (docs/src/pages/reference/standard-library.mdx, "Core Data" and
 * "Schema and Encoding").
 *
 * Everything here is an ordinary VibeLang value. Nothing in this package is a
 * wrapper that exists to track an effect, nothing needs a runtime to run, and
 * nothing needs a capability: these are pure values with value semantics, the
 * way `Duration` is. Operations that can miss answer with an `Optional`, never
 * `undefined`; operations that can fail would answer with a `Result`, and none
 * of these can fail.
 *
 * `Equivalence` and `Hash` are the seam. Today an author builds instances by
 * hand or reaches for the structural defaults (`Equivalence.any`, `Hash.any`,
 * and `Data.struct`); tomorrow the compiler derives them from a declared type
 * at comptime and registers them through the same
 * `registerStructuralEquivalence`/`registerStructuralHash` functions, with no
 * change to any of the collection APIs.
 *
 * Each module registers its own structural rule when it loads, and a value of a
 * branded type cannot exist without its module having loaded, so importing any
 * subset of this package leaves the seam complete for the values you can hold.
 *
 * **This API is provisional.** It is a programmatic POC of the "Core Data"
 * slice, not a released contract: names, signatures, and the internal
 * representations behind them may all move. What is meant to survive is the
 * shape of the thing — pure branded values, `Optional` for a miss, an explicit
 * `Equivalence`/`Hash` pair as the keying seam — because that is what the
 * compiler-derived instances will plug into.
 */

export {
  Equivalence,
  EquivalenceValue,
  registerStructuralEquivalence,
  sameValueZero,
} from "./equivalence.ts";
export type { StructuralEquivalenceRule } from "./equivalence.ts";

export { Hash, HashValue, registerStructuralHash } from "./hash.ts";
export type { StructuralHashRule } from "./hash.ts";

// `Chunk`, `HashMap`, `HashSet`, and `Data` each export a type and a namespace
// of the same name, the way the runtime's `Result` and `Optional` do, so one
// re-export carries both meanings.
export { Chunk, ChunkValue, isChunk } from "./chunk.ts";

export { HashMap, HashMapValue, isHashMap } from "./hash-map.ts";

export { HashSet, HashSetValue, isHashSet } from "./hash-set.ts";

export { Data, isData } from "./data.ts";

// `Match` is the value-level pattern-matching surface. It is deliberately a
// library and not syntax: docs/DECISIONS.md keeps expression-form
// pattern-matching grammar open so VibeLang can converge with TC39 later, so
// what exists today is a fluent builder of ordinary method calls whose
// exhaustiveness is proved by the type system rather than checked at runtime.
export { Match, MatcherValue, isMatcher } from "./match.ts";
export type {
  FailureCase,
  LiteralPattern,
  Matcher,
  NeedsFallback,
  NoneCase,
  NonExhaustive,
  OkCase,
  Scrutinee,
  ShapePattern,
  SomeCase,
} from "./match.ts";
