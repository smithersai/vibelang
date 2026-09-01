import { expect, test } from "bun:test";
import { NominalErrorIdentities } from "../durable/site-id.ts";
import { compileSemanticModel } from "./compile.ts";
import { buildSemanticModel } from "./semantic.ts";

// SMITHERS1151 — the compile-wide nominal Error identity collision refusal.
//
// WHY THIS FILE EXISTS. SMITHERS1151 is enforced by both implementations and,
// until this file, was pinned by NOTHING that a deletion of the rule would turn
// red. It is one of eight codes COVERAGE.md's second subtraction counts as "in
// both implementations and in no case", and it is one of the two in that set the
// conformance corpus is structurally unable to reach.
//
// The reason it is unreachable is stated by both backends in their own words.
// `poc/src/language/compile.ts:80`: "This is a defensive invariant and on today's
// algorithm it never fires: nominalErrorIdentity is injective". And the fork,
// `compiler/fork_error_identity_test.go:278`: "stableErrorIdentity is injective,
// so SMITHERS1151 cannot fire on today's algorithm and no program can be written
// that trips it." A rule no authored program can reach cannot have a corpus case:
// the corpus observes the compiler through authored `.sm`, so there is nothing to
// author. That is an argument for a different pin, NOT for no pin — the rule
// guards a fail-OPEN (a clean compile whose artifact throws
// `stable Error identity ... is already registered` while it is still loading),
// and the algorithm it guards has already been weakened into exactly that state
// TWICE.
//
// WHAT WAS ALREADY THERE AND WHY IT IS NOT ENOUGH. Two tests already name this
// code. `nominal-error-identity.test.ts` asserts that a clean project reports NO
// SMITHERS1151 — an acceptance, which stays green if the rule is deleted — and
// that `NominalErrorIdentities.claim` returns `collidesWith` under the shipped
// algorithm, which exercises the assigner in isolation and never reaches the
// diagnostic. Deleting `nominalIdentityCollisions` from `compile.ts`, or its call
// in `compileSemanticModel`, leaves both of them green. The fork's pin
// (`TestForkNominalIdentityGuardIsWiredIntoTheCompileWideEmitPath`) is a
// source-TEXT assertion over `lowering.go.txt`, which does turn red on a
// deletion but cannot see what the rule reports.
//
// WHAT THIS FILE DOES INSTEAD. It reaches the rule the only way anything can:
// through the injection point the compiler already has for exactly this purpose.
// `compileSemanticModel` accepts the compilation-wide assigner as a binding, so a
// test can hand it an assigner whose minting function is NOT injective, compile a
// real program through the real diagnostic path, and require the refusal. That is
// a behavioural pin: it is red if the rule is deleted, red if it stops being
// wired into the emit path, and red if it stops naming the classes.
//
// The weakened algorithm is not a caricature. It is `shippedAlgorithm` from
// `nominal-error-identity.test.ts`, the identity function as it actually shipped,
// so what this file measures is the guard catching the defect that really
// happened rather than one invented to be catchable.

/**
 * The identity algorithm as it shipped, verbatim. Its two defects are blind
 * truncation at 256 characters and normalizing every character outside
 * `[A-Za-z0-9._/@:+-]` to `_`, either of which folds two distinct declarations
 * onto one identity.
 */
function shippedAlgorithm(sourceName: string, name: string): string {
  const normalized = sourceName.replace(/[^A-Za-z0-9._/@:+-]/g, "_").replace(/^([^A-Za-z0-9])/, "source_$1");
  const id = `smithers:${normalized}:${name}`.slice(0, 256);
  return /[\uD800-\uDBFF]$/.test(id) ? id.slice(0, -1) : id;
}

function compileWith(sourceName: string, source: string, identities: NominalErrorIdentities) {
  const options = { fileName: `/virtual/${sourceName}`, sourceName, sourceMap: false } as const;
  return compileSemanticModel(source, options, buildSemanticModel(source, options), {
    nominalIdentities: identities,
  });
}

test("a nominal Error identity collision across one compilation is refused with SMITHERS1151", () => {
  // Two modules, one compilation, one assigner — the shape the rule exists for.
  // Under the shipped algorithm `a b.sm` and `a_b.sm` normalize onto the same
  // string, so the second `Boom` cannot receive an identity of its own.
  const identities = new NominalErrorIdentities(shippedAlgorithm);
  // The blank first line is load-bearing: it makes the declared position carry
  // information. A diagnostic anchored at the top of the file would read 1:1
  // here and satisfy a position assertion by accident.
  const source = "\nexport class Boom extends Error {}\n";

  const first = compileWith("a b.sm", source, identities);
  expect(first.analysis.diagnostics.filter((d) => d.code === "SMITHERS1151")).toEqual([]);

  const second = compileWith("a_b.sm", source, identities);
  const collisions = second.analysis.diagnostics.filter((d) => d.code === "SMITHERS1151");
  expect(collisions.length).toBe(1);

  // The payload IS the promise. A code alone is satisfied by a refusal that
  // names nothing, and the author's only route out of this is knowing WHICH two
  // declarations collided and WHAT identity they folded onto.
  expect(collisions[0]!.severity).toBe("error");
  expect(collisions[0]!.message).toContain("Error class 'Boom' in 'a_b.sm'");
  expect(collisions[0]!.message).toContain("cannot receive a stable nominal identity");
  expect(collisions[0]!.message).toContain("smithers:a_b.sm:Boom");
  expect(collisions[0]!.message).toContain("'a b.sm:Boom' already holds");

  // And it points at the declaration, not at the top of the file.
  expect([collisions[0]!.line, collisions[0]!.column]).toEqual([2, 1]);
});

test("the guard is compile-WIDE: one assigner spans modules, a fresh one does not", () => {
  // The failure mode this half pins is a refactor that gives each module its own
  // assigner. Every single-file compile would stay green and the artifact would
  // still fail to load, which is the original defect exactly.
  const source = "export class Boom extends Error {}\n";

  const shared = new NominalErrorIdentities(shippedAlgorithm);
  compileWith("a b.sm", source, shared);
  expect(compileWith("a_b.sm", source, shared).analysis.diagnostics.some((d) => d.code === "SMITHERS1151"))
    .toBe(true);

  const perFile = compileWith("a_b.sm", source, new NominalErrorIdentities(shippedAlgorithm));
  expect(perFile.analysis.diagnostics.some((d) => d.code === "SMITHERS1151")).toBe(false);
});

test("one declaration reaching the assigner twice is idempotent, not a collision", () => {
  // The rule must not fire on a re-entrant compile of the same module, or the
  // guard becomes a refusal of correct programs and someone deletes it.
  const identities = new NominalErrorIdentities(shippedAlgorithm);
  const source = "export class Boom extends Error {}\n";
  compileWith("a b.sm", source, identities);
  expect(compileWith("a b.sm", source, identities).analysis.diagnostics.some((d) => d.code === "SMITHERS1151"))
    .toBe(false);
});

test("today's algorithm keeps these apart, so the guard stays silent in production", () => {
  // The counterpart to the three above: with the SHIPPING assigner the same two
  // modules compile clean. Without this, the tests above would also pass against
  // a compiler that refused every second Error class it ever saw.
  const identities = new NominalErrorIdentities();
  const source = "export class Boom extends Error {}\n";
  compileWith("a b.sm", source, identities);
  expect(compileWith("a_b.sm", source, identities).analysis.diagnostics.some((d) => d.code === "SMITHERS1151"))
    .toBe(false);
});
