import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileActionContract } from "./schema.ts";
import { DurableFailureIdentities, durableFailureIdentity } from "./site-id.ts";

// Durable failure identity INJECTIVITY, and the shared vectors that keep the two
// backends' copies of the algorithm from drifting apart again.
//
// specification/durable-execution.mdx: "Every value crossing an Action or Flow
// persistence boundary MUST satisfy the compiler-checked durable codec
// contract"; specification/failures.mdx, "Error Prototype": "Handler selection
// MUST use compiler-stable nominal identity, not a forgeable user `_tag` or
// minifier-sensitive constructor name in compiled artifacts." Read on the
// persistence boundary, the identity is the key a decoder on the far side
// selects a handler by, so stability without INJECTIVITY is worth nothing: two
// Error classes arriving under one identity is a forgeable key.
//
// The failure this file exists for is a fail-OPEN. The compiler accepted the
// program, emitted a plausible artifact, and `registerErrorType` threw
// `stable Error identity ... is already registered` while the module was still
// loading.
//
// WHY A DIFFERENTIAL TEST COULD NOT HAVE FOUND THIS. Both backends spelled the
// identity the same wrong way, so every cross-backend comparison in the tree
// AGREED, byte for byte, on the colliding answer. `conformance/runner/run.mjs`
// reported `0 divergent` on the corpus case that exercises this very channel.
// The assertion therefore has to be DIRECT — the shared vector rows below, plus
// the reproductions, which say what the answer must BE rather than that two
// backends say the same thing.
//
// Each `RED BEFORE THE FIX` case is a measured collision on the shipped
// algorithm, not a hypothetical.

interface DurableIdentityVector {
  readonly why: string;
  readonly file: string;
  readonly className: string;
  readonly viaFork: boolean;
  readonly identity: string;
}

const VECTORS: readonly DurableIdentityVector[] = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../../conformance/identity/durable-failure-identity.json"), "utf8"),
).vectors;

/**
 * The durable failure ENVELOPE validator, copied from `schema.ts`'s
 * `decodeWorkerExit` guard.
 *
 * It is restated rather than imported because it is not exported, and because
 * the point of the check is that the compiler's alphabet and the wire's are two
 * separately maintained rules: when the compiler's widened past the wire's, the
 * result was a clean compile whose failures could not be decoded at all.
 */
const ENVELOPE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,255}$/;

/** The single durable failure identity an Action's error schema carries. */
function compiledIdentity(fileName: string, className: string): string {
  const compiled = compileActionContract(
    `
import { Action } from "smithers:flows"
class ${className} extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Work extends Action<
  (input: { message: string }) => Result<{ done: string }, ${className}>
> {}
`,
    { fileName, exportName: "Work", id: "test/Work", version: 1 },
  );
  if (!compiled.ok) throw new Error(compiled.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return (compiled.descriptor.errorSchema.descriptor as { identity: string }).identity;
}

// ---------------------------------------------------------------------------
// The shared cross-language vectors
// ---------------------------------------------------------------------------

test("the reference mints exactly the shared cross-language durable identity vectors", () => {
  expect(VECTORS.length).toBeGreaterThan(0);
  for (const vector of VECTORS) {
    expect({ why: vector.why, identity: durableFailureIdentity(vector.file, vector.className) })
      .toEqual({ why: vector.why, identity: vector.identity });
  }
});

test("the shared vectors are pairwise distinct, which is the property they exist to pin", () => {
  const byIdentity = new Map<string, string>();
  for (const vector of VECTORS) {
    const owner = `${JSON.stringify(vector.file)}:${vector.className}`;
    expect([vector.identity, byIdentity.get(vector.identity) ?? owner]).toEqual([vector.identity, owner]);
    byIdentity.set(vector.identity, owner);
  }
  expect(byIdentity.size).toBe(VECTORS.length);
});

test("every minted durable identity is one the failure envelope validator accepts", () => {
  // The compiler's alphabet and the wire's `ENVELOPE_IDENTITY` are two separately
  // maintained rules, and this identity is written verbatim into persisted
  // `error_json`. An identity the envelope rejects is a typed failure that
  // cannot be recorded, so the two are checked against each other rather than
  // assumed to agree. This is also what forbids carrying a class name verbatim:
  // `$Failed` and `Café` are legal TypeScript identifiers and neither is legal
  // here, which is exactly why the predecessor folded them onto `_`.
  for (const vector of VECTORS) {
    expect([vector.identity, ENVELOPE_IDENTITY.test(vector.identity)]).toEqual([vector.identity, true]);
    expect(vector.identity.length).toBeLessThanOrEqual(256);
  }
});

test("a spelled identity holds exactly two at-signs, which is what makes the parse unambiguous", () => {
  // The separator is withheld from the escape alphabet. If a later edit put `@`
  // back into `isDurableIdentityUnit`, a file name containing one would add a
  // third and the spelling would stop being injective; this is the cheapest
  // assertion that notices. The digest fallback has no separator to protect --
  // it holds only the trailing version marker -- so the two forms are counted
  // apart rather than lumped together, and the `smithers.digest:` prefix is what
  // tells them apart (the ninth unit is `.` in one and `:` in the other).
  for (const vector of VECTORS) {
    const digested = vector.identity.startsWith("smithers.digest:");
    expect([vector.file, [...vector.identity].filter((unit) => unit === "@").length])
      .toEqual([vector.file, digested ? 1 : 2]);
  }
  // Both forms are present, or this test is only measuring one of them.
  expect(VECTORS.some((vector) => vector.identity.startsWith("smithers.digest:"))).toBe(true);
  expect(VECTORS.some((vector) => vector.identity.startsWith("smithers:"))).toBe(true);
});

// ---------------------------------------------------------------------------
// RED BEFORE THE FIX -- charset collapse (the measured defect)
// ---------------------------------------------------------------------------

test("two module names that used to normalize together receive distinct durable identities", () => {
  // RED BEFORE THE FIX. Every unit outside `[A-Za-z0-9._/@:+-]` was rewritten to
  // `_`, so `a b.sm` and `a_b.sm` each declaring `Boom` both minted
  // `smithers:a_b.sm_Boom@1` with zero diagnostics -- measured on both backends,
  // and reproduced independently here by compiling two contracts and reading the
  // error schema back out.
  expect(compiledIdentity("a b.sm", "Boom")).toBe("smithers:a+0020b.sm@Boom@1");
  expect(compiledIdentity("a_b.sm", "Boom")).toBe("smithers:a_b.sm@Boom@1");
  expect(compiledIdentity("a b.sm", "Boom")).not.toBe(compiledIdentity("a_b.sm", "Boom"));
});

test("the whole family that folded onto one identity now mints one each", () => {
  // The collapse was not a two-name accident: EVERY unit outside the alphabet
  // mapped to the same `_`, so an entire family converged on
  // `smithers:a_b.sm_Boom@1`. Five spellings, five identities.
  const names = ["a b.sm", "a_b.sm", "a#b.sm", "a%b.sm", "a!b.sm"];
  const identities = names.map((name) => compiledIdentity(name, "Boom"));
  expect(new Set(identities).size).toBe(names.length);
});

// ---------------------------------------------------------------------------
// RED BEFORE THE FIX -- separator destruction (found by this lane's own sweep)
// ---------------------------------------------------------------------------

test("a file name may not reach across the file/class separator", () => {
  // RED BEFORE THE FIX, and found by this lane's own sweep rather than handed to
  // it. `#` -- the file/class separator the raw spelling used -- was itself
  // outside the accepted character set, so the normalizer destroyed the
  // SEPARATOR before it destroyed anything else. All three of these minted
  // `smithers:a.sm_B_C@1`, and TWO of them contain no character outside the old
  // alphabet at all, which is why a reversible escape alone would not have been
  // a fix: the separator also had to become one neither component can spell.
  const pairs = [["a.sm", "B_C"], ["a.sm_B", "C"], ["a.sm#B", "C"]] as const;
  const identities = pairs.map(([file, className]) => compiledIdentity(file, className));
  expect(identities).toEqual([
    "smithers:a.sm@B_C@1",
    "smithers:a.sm_B@C@1",
    "smithers:a.sm+0023B@C@1",
  ]);
  expect(new Set(identities).size).toBe(pairs.length);
});

// ---------------------------------------------------------------------------
// RED BEFORE THE FIX -- class-name collapse
// ---------------------------------------------------------------------------

test("two class names that used to normalize together receive distinct durable identities", () => {
  // RED BEFORE THE FIX. `$` is outside the accepted set, so `$Failed` and
  // `_Failed` in one module both minted `smithers:<file>__Failed@1`. This is the
  // pair the SMITHERS4203/SMITHERS4124 refusal was built around; with the
  // algorithm injective it is an ordinary, legal program, and the refusal
  // survives as a defensive invariant rather than as a filter.
  expect(compiledIdentity("main.sm", "$Failed")).toBe("smithers:main.sm@+0024Failed@1");
  expect(compiledIdentity("main.sm", "_Failed")).toBe("smithers:main.sm@_Failed@1");
});

test("two Error classes that used to collide now compile into one channel with two variants", () => {
  // The end the defect was supposed to reach: a channel naming BOTH of them.
  // Before the fix this was refused as SMITHERS4203 -- correctly, given the
  // algorithm -- and the refusal is what the corpus case
  // `17-durable/two-error-classes-whose-durable-identities-collide-are-rejected`
  // pinned. There is nothing wrong with the program; there was something wrong
  // with the identity.
  const compiled = compileActionContract(
    `
import { Action } from "smithers:flows"
class $Failed extends Error { constructor(readonly code: string) { super(code) } }
class _Failed extends Error { constructor(readonly reason: string) { super(reason) } }
export abstract class Work extends Action<
  (input: { message: string }) => Result<{ done: string }, $Failed | _Failed>
> {}
`,
    { fileName: "main.sm", exportName: "Work", id: "test/Work", version: 1 },
  );
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  const variants = (compiled.descriptor.errorSchema.descriptor as { variants: { identity: string }[] }).variants;
  expect(variants.map((variant) => variant.identity)).toEqual([
    "smithers:main.sm@+0024Failed@1",
    "smithers:main.sm@_Failed@1",
  ]);
});

// ---------------------------------------------------------------------------
// RED BEFORE THE FIX -- the length bound
// ---------------------------------------------------------------------------

test("the class name survives the length bound instead of being cut off by it", () => {
  // The bound is honoured by digesting the exact spelling, so the discriminator
  // is never the part that is dropped, and the fallback carries the full 256-bit
  // digest rather than the 48-hex-digit (192-bit) prefix of a digest of the pair
  // that the predecessor kept.
  const fileName = `${"z".repeat(260)}.sm`;
  const left = compiledIdentity(fileName, "Left");
  const right = compiledIdentity(fileName, "Right");
  expect(left.startsWith("smithers.digest:")).toBe(true);
  expect(left.endsWith("@1")).toBe(true);
  expect(left).not.toBe(right);
  expect(ENVELOPE_IDENTITY.test(left)).toBe(true);
});

// ---------------------------------------------------------------------------
// The defensive invariant
// ---------------------------------------------------------------------------

/**
 * The algorithm as it shipped, verbatim, so the guard can be measured against
 * the exact code that produced the defect rather than against a caricature of it.
 */
function shippedAlgorithm(fileName: string, name: string): string {
  return `smithers:${fileName}#${name}@1`.replace(/[^A-Za-z0-9._/@:+-]/g, "_");
}

test("the compile-wide assigner passes every declaration under today's algorithm", () => {
  const identities = new DurableFailureIdentities();
  expect(identities.claim("a.sm", "Boom")).toEqual({ identity: "smithers:a.sm@Boom@1" });
  // One declaration reaching the assigner twice is idempotent, not a collision.
  expect(identities.claim("a.sm", "Boom")).toEqual({ identity: "smithers:a.sm@Boom@1" });
  expect(identities.claim("b.sm", "Boom")).toEqual({ identity: "smithers:b.sm@Boom@1" });
  expect(identities.claim("a.sm", "Bang")).toEqual({ identity: "smithers:a.sm@Bang@1" });
});

test("the compile-wide assigner would have refused every collision the shipped algorithm minted", () => {
  // The guard exists so that weakening the algorithm again is a refusal rather
  // than an artifact that cannot load. Today's algorithm is injective and
  // therefore cannot trip it, so the guard is measured against the algorithm that
  // actually shipped -- which is the only way to show it would have caught this.
  //
  // Scope is the whole point. The refusal that WAS here,
  // `DescriptorBuilder.claimedErrorIdentities`, is a per-instance field, so it
  // sees one `compileActionContract` call; every pair below is two Actions, which
  // is two calls, and therefore invisible to it.
  for (
    const [why, left, right] of [
      ["charset collapse", ["a b.sm", "Boom"], ["a_b.sm", "Boom"]],
      ["separator destruction", ["a.sm_B", "C"], ["a.sm", "B_C"]],
      ["class-name collapse", ["main.sm", "$Failed"], ["main.sm", "_Failed"]],
    ] as const
  ) {
    // The shipped algorithm really did fold these two onto one string.
    expect([why, shippedAlgorithm(...left)]).toEqual([why, shippedAlgorithm(...right)]);

    const identities = new DurableFailureIdentities(shippedAlgorithm);
    expect([why, identities.claim(...left).collidesWith]).toEqual([why, undefined]);
    expect([why, identities.claim(...right).collidesWith]).toEqual([why, `${left[0]}:${left[1]}`]);
  }
});

test("the compile-wide assigner accepts the same pairs under today's algorithm", () => {
  // The other direction: the guard must not be refusing programs the algorithm
  // already tells apart, or it would be a filter rather than an invariant.
  const identities = new DurableFailureIdentities();
  for (
    const [file, className] of [
      ["a b.sm", "Boom"],
      ["a_b.sm", "Boom"],
      ["a.sm_B", "C"],
      ["a.sm", "B_C"],
      ["main.sm", "$Failed"],
      ["main.sm", "_Failed"],
    ] as const
  ) {
    expect([file, className, identities.claim(file, className).collidesWith]).toEqual([file, className, undefined]);
  }
});

test("the assigner still refuses the collision no escaping can remove", () => {
  // The identity is a function of (logical file, class name), so two DIFFERENT
  // declarations sharing both -- sibling namespaces, a namespaced class beside a
  // top-level one of the same name -- collide under any injective encoding
  // whatsoever. That family is why the refusal is not dead code: it is the
  // residual the algorithm cannot fix, and `schema.test.ts` exercises it through
  // real namespaced sources at SMITHERS4203.
  const identities = new DurableFailureIdentities();
  expect(identities.claim("collide.sm", "Failed").collidesWith).toBeUndefined();
  // A second declaration of the same name in the same file reaches the assigner
  // as a distinct owner only when the caller says so; `claim` is keyed on the
  // pair, which is exactly why `schema.ts` keys its own map on the DECLARATION.
  expect(durableFailureIdentity("collide.sm", "Failed")).toBe(durableFailureIdentity("collide.sm", "Failed"));
});
