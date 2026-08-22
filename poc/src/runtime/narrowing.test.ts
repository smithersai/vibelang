import { describe, expect, test } from "bun:test";
import {
  MissingOptionalValue,
  type NominalError,
  Panic,
  decodeError,
  encodeError,
  errorIs,
  errorMatches,
  registerErrorCodec,
  registerErrorType,
} from "./index.ts";

/**
 * Static-narrowing proofs for the nominal Error brand.
 *
 * Every class below is *structurally identical* to its sibling on purpose: that
 * is precisely the case TypeScript cannot tell apart on its own, and the case
 * where `errorIs(error, Sibling)` used to leave `never` in the else branch. The
 * `@ts-expect-error` directives are the assertions — `tsc --noEmit` fails if a
 * marked line stops erroring, and fails if an unmarked line starts erroring.
 * The `test()` blocks assert that none of this changed runtime behavior.
 */

function messageCodec<E extends Error>(construct: (message: string) => E) {
  return {
    encode: (error: E) => ({ message: error.message }),
    decode: (payload: import("./index.ts").JsonValue) => {
      if (
        payload === null || Array.isArray(payload) || typeof payload !== "object" ||
        typeof payload.message !== "string"
      ) throw new TypeError("invalid payload");
      return construct(payload.message);
    },
  };
}

// --- unbranded pair: the residual gap, asserted so it cannot regress silently ---
class UnbrandedLeft extends Error {}
class UnbrandedRight extends Error {}

// --- branded pair: identical shape, distinct identity ---
class BrandedLeft extends Error {}
interface BrandedLeft extends NominalError<"test:narrowing/BrandedLeft@1"> {}
registerErrorCodec(BrandedLeft, "test:narrowing/BrandedLeft@1", messageCodec((message) => new BrandedLeft(message)));

class BrandedRight extends Error {}
interface BrandedRight extends NominalError<"test:narrowing/BrandedRight@1"> {}
registerErrorType(BrandedRight, "test:narrowing/BrandedRight@1");

class BrandedThird extends Error {}
interface BrandedThird extends NominalError<"test:narrowing/BrandedThird@1"> {}
registerErrorType(BrandedThird, "test:narrowing/BrandedThird@1");

// --- an abstract base with branded leaves: the shape platform libraries use ---
abstract class Family extends Error {}
class FamilyLeft extends Family {}
interface FamilyLeft extends NominalError<"test:narrowing/FamilyLeft@1"> {}
class FamilyRight extends Family {}
interface FamilyRight extends NominalError<"test:narrowing/FamilyRight@1"> {}

// --- one brand per inheritance chain (documented limitation) ---
class ChainBase extends Error {}
interface ChainBase extends NominalError<"test:narrowing/ChainBase@1"> {}
class ChainSub extends ChainBase {}
// @ts-expect-error a branded class may not sit under a differently branded ancestor
interface ChainSub extends NominalError<"test:narrowing/ChainBase@1" | "test:narrowing/ChainSub@1"> {}

// ---------------------------------------------------------------------------
// Type-level assertions
// ---------------------------------------------------------------------------

function trueBranchNarrowsToTheTestedType(error: BrandedLeft | BrandedRight): BrandedLeft | undefined {
  return errorIs(error, BrandedLeft) ? error : undefined;
}

function elseBranchNarrowsToTheSibling(error: BrandedLeft | BrandedRight): BrandedRight | undefined {
  if (errorIs(error, BrandedLeft)) return undefined;
  return error;
}

function elseBranchIsNotNever(error: BrandedLeft | BrandedRight): void {
  if (errorIs(error, BrandedLeft)) return;
  // @ts-expect-error the else branch is BrandedRight; collapsing to `never` is the bug this brand fixes
  const collapsed: never = error;
  void collapsed;
}

function elseBranchSubtractsTheTestedType(error: BrandedLeft | BrandedRight): void {
  if (errorIs(error, BrandedLeft)) return;
  // @ts-expect-error BrandedLeft was removed from the union by the false branch
  const wrong: BrandedLeft = error;
  void wrong;
}

function brandedSiblingsAreMutuallyUnassignable(): void {
  // @ts-expect-error structurally identical but nominally distinct
  const wrong: BrandedLeft = new BrandedRight("right");
  void wrong;
}

function brandsDoNotBlockOrdinaryErrorUse(): void {
  const asError: Error = new BrandedLeft("left");
  const asUnknown: unknown = asError;
  void asUnknown;
  const leaf: Family = new FamilyLeft("leaf");
  void leaf;
}

function prototypeIsNarrowsBothBranches(error: BrandedLeft | BrandedRight): void {
  if (error.is(BrandedLeft)) {
    const left: BrandedLeft = error;
    void left;
    return;
  }
  const right: BrandedRight = error;
  void right;
}

function matchesNarrowsToTheListedUnion(error: BrandedLeft | BrandedRight | BrandedThird): void {
  if (errorMatches(error, BrandedLeft, BrandedRight)) {
    const listed: BrandedLeft | BrandedRight = error;
    void listed;
    // @ts-expect-error BrandedThird is not in the matched list
    const wrong: BrandedThird = error;
    void wrong;
    return;
  }
  const rest: BrandedThird = error;
  void rest;
}

function prototypeMatchesNarrowsToTheListedUnion(error: BrandedLeft | BrandedRight | BrandedThird): void {
  if (error.matches(BrandedLeft, BrandedThird)) {
    const listed: BrandedLeft | BrandedThird = error;
    void listed;
    return;
  }
  const rest: BrandedRight = error;
  void rest;
}

function anUnbrandedBaseStillMatchesEveryBrandedLeaf(error: FamilyLeft | FamilyRight): Family {
  if (errorIs(error, Family)) {
    const leaves: FamilyLeft | FamilyRight = error;
    return leaves;
  }
  // exhaustive: every leaf of the union is a Family, so this branch really is `never`
  const impossible: never = error;
  return impossible;
}

function runtimeErrorClassesAreBranded(error: Panic | MissingOptionalValue): void {
  if (errorIs(error, MissingOptionalValue)) {
    const missing: MissingOptionalValue = error;
    void missing;
    return;
  }
  // a bare Panic survives the else branch instead of collapsing to `never`
  const bare: Panic = error;
  void bare;
  // @ts-expect-error a bare Panic is not a MissingOptionalValue
  const wrong: MissingOptionalValue = new Panic("bare");
  void wrong;
}

/**
 * Residual gap: an unbranded pair is still structurally identical, so the else
 * branch still collapses. This assertion documents the exact remaining cost of
 * *not* branding a class; it starts failing the day the gap closes.
 */
function unbrandedSiblingsStillCollapse(error: UnbrandedLeft | UnbrandedRight): void {
  if (errorIs(error, UnbrandedLeft)) return;
  const collapsed: never = error;
  void collapsed;
}

// ---------------------------------------------------------------------------
// Runtime behavior is unchanged
// ---------------------------------------------------------------------------

describe("nominal Error brands are type-only", () => {
  test("static narrowing helpers behave exactly as before at runtime", () => {
    const left = new BrandedLeft("left");
    const right = new BrandedRight("right");

    expect(trueBranchNarrowsToTheTestedType(left)).toBe(left);
    expect(trueBranchNarrowsToTheTestedType(right)).toBeUndefined();
    expect(elseBranchNarrowsToTheSibling(right)).toBe(right);
    expect(elseBranchNarrowsToTheSibling(left)).toBeUndefined();
    expect(errorIs(left, BrandedLeft)).toBe(true);
    expect(errorIs(left, BrandedRight)).toBe(false);
    expect(errorIs(left, Error)).toBe(true);
    expect(errorIs(new FamilyLeft("leaf"), Family)).toBe(true);
    expect(errorMatches(left, BrandedRight, BrandedThird)).toBe(false);
    expect(errorMatches(left, BrandedRight, BrandedLeft)).toBe(true);
    expect(errorMatches(left)).toBe(false);
    expect(left.matches(BrandedLeft, BrandedThird)).toBe(true);
    expect(left.is(BrandedLeft)).toBe(true);
    expect(new MissingOptionalValue().is(MissingOptionalValue)).toBe(true);
    expect(new Panic("bare").is(MissingOptionalValue)).toBe(false);
    expect(new MissingOptionalValue().is(Panic)).toBe(true);

    // The brand is a phantom: a branded instance carries no extra own state.
    expect(Object.getOwnPropertySymbols(left)).toEqual([]);
    expect(Object.getOwnPropertyNames(left).sort()).toEqual(Object.getOwnPropertyNames(new UnbrandedLeft("left")).sort());
    expect(JSON.stringify({ ...left })).toBe(JSON.stringify({ ...new UnbrandedLeft("left") }));
  });

  test("wire codecs are byte-identical for a branded class", () => {
    const wire = encodeError(new BrandedLeft("transported"));
    expect(wire).toBe('{"version":1,"identity":"test:narrowing/BrandedLeft@1","payload":{"message":"transported"}}');
    const decoded = decodeError(wire);
    expect(decoded).toBeInstanceOf(BrandedLeft);
    expect(decoded.is(BrandedLeft)).toBe(true);
    expect(decoded.is(BrandedRight)).toBe(false);
    expect(Object.getOwnPropertySymbols(decoded)).toEqual([]);
  });

  test("runtime identity ignores the brand and stays constructor-based", () => {
    // ChainSub is rejected at the type level, but nothing about it changed at runtime.
    const sub = new ChainSub("sub");
    expect(errorIs(sub, ChainBase)).toBe(true);
    expect(errorIs(new ChainBase("base"), ChainSub)).toBe(false);

    // A structurally identical unbranded instance is still not a BrandedLeft.
    expect(errorIs(new UnbrandedLeft("costume"), BrandedLeft)).toBe(false);
    expect(errorIs(Object.assign(new Error("tagged"), { _tag: "BrandedLeft" }), BrandedLeft)).toBe(false);
  });
});

void elseBranchIsNotNever;
void elseBranchSubtractsTheTestedType;
void brandedSiblingsAreMutuallyUnassignable;
void brandsDoNotBlockOrdinaryErrorUse;
void prototypeIsNarrowsBothBranches;
void matchesNarrowsToTheListedUnion;
void prototypeMatchesNarrowsToTheListedUnion;
void anUnbrandedBaseStillMatchesEveryBrandedLeaf;
void runtimeErrorClassesAreBranded;
void unbrandedSiblingsStillCollapse;
