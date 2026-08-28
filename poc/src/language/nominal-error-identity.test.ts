import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NominalErrorIdentities, nominalErrorIdentity } from "../durable/site-id.ts";
import { registerErrorType } from "../runtime/index.ts";
import { compileProject } from "./project-compile.ts";

// Nominal Error identity INJECTIVITY, and the shared vectors that keep the two
// backends' copies of the algorithm from drifting apart again.
//
// specification/failures.mdx, "Error Prototype": "Handler selection MUST use
// compiler-stable nominal identity, not a forgeable user `_tag` or
// minifier-sensitive constructor name in compiled artifacts." An identity two
// distinct classes can share is not an identity, and the failure is not quiet:
// `registerErrorType` refuses the second registration, so the compiler ACCEPTS
// the program, emits a plausible artifact, and the artifact throws
// `stable Error identity ... is already registered` while it is still loading.
// A fail-open is strictly worse than a refusal, which is why this file exists.
//
// The tests that matter here are the ones that were RED before the fix. The
// pre-existing nominal-error coverage (`nominal-errors.test.ts`) compiles
// `nominal.sm`, a short already-injective path with distinctly named classes, so
// every one of its assertions stayed green while the compiler was minting one
// identity for two classes. Collision resistance could have been deleted without
// turning the suite red. Each `RED BEFORE THE FIX` case below is a measured
// collision on the previous algorithm, not a hypothetical.

interface IdentityVector {
  readonly why: string;
  readonly file: string;
  readonly className: string;
  readonly viaFork: boolean;
  readonly identity: string;
}

const VECTORS: readonly IdentityVector[] = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../../conformance/identity/nominal-error-identity.json"), "utf8"),
).vectors;

/** Every identity the emitted module registers, in emission order. */
function registeredIdentities(code: string): readonly string[] {
  return [...code.matchAll(/__vsRegisterError\([^,]+, "((?:[^"\\]|\\.)*)"\)/g)]
    .map((match) => JSON.parse(`"${match[1]}"`) as string);
}

function compileFiles(rootDir: string, files: readonly { fileName: string; source: string }[]) {
  return compileProject([...files], {
    rootDir,
    outDir: "/virtual/out",
    outputExtension: ".mjs",
    runtimeImport: "smthrs/runtime",
    sourceMap: false,
  });
}

/**
 * The load the emitted artifact performs, without writing one.
 *
 * `registerErrorType` is exactly what the emitted `__vsRegisterError` calls, so
 * feeding it the identities in emission order reproduces module initialization:
 * a duplicate throws here for the same reason and with the same message it threw
 * out of the real artifact.
 */
function registerAll(identities: readonly string[]): void {
  for (const identity of identities) registerErrorType(class extends Error {}, identity);
}

// ---------------------------------------------------------------------------
// The shared cross-language vectors
// ---------------------------------------------------------------------------

test("the reference mints exactly the shared cross-language identity vectors", () => {
  expect(VECTORS.length).toBeGreaterThan(0);
  for (const vector of VECTORS) {
    expect({ why: vector.why, identity: nominalErrorIdentity(vector.file, vector.className) })
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

test("every minted identity is one the runtime validator accepts", () => {
  // The compiler's alphabet and the runtime's `STABLE_ERROR_IDENTITY` are two
  // separately maintained rules. When the compiler's widened past the runtime's
  // the result was a clean compile that threw `invalid stable Error identity`
  // during module initialization, so the two are checked against each other
  // rather than assumed to agree.
  //
  // The registry is process-wide and `registerErrorType` validates before it
  // deduplicates, so one class per identity keeps this test measuring the
  // validator rather than measuring its own second pass.
  const classes = new Map<string, ErrorConstructor>();
  for (const vector of VECTORS) {
    const type = classes.get(vector.identity) ?? class extends Error {};
    classes.set(vector.identity, type);
    expect(() => registerErrorType(type, vector.identity)).not.toThrow();
    expect(vector.identity.length).toBeLessThanOrEqual(256);
  }
});

// ---------------------------------------------------------------------------
// RED BEFORE THE FIX -- blind truncation
// ---------------------------------------------------------------------------

test("two Error classes in a long-named module receive distinct identities", () => {
  // RED BEFORE THE FIX. The identity was `.slice(0, 256)`-ed AFTER the class
  // name was appended, so the discriminator was what the bound cut off. Measured
  // on the previous algorithm: both classes minted one 256-unit identity, the
  // compiler reported zero diagnostics, and importing the emitted module threw
  // `TypeError: stable Error identity smithers:aaaa... is already registered`.
  const fileName = `${"c".repeat(250)}.sm`;
  const result = compileFiles("/virtual/truncation", [{
    fileName,
    source: "export class Left extends Error {}\nexport class Right extends Error {}\n",
  }]);
  expect(result.diagnostics).toEqual([]);

  const identities = registeredIdentities(result.files[fileName]!.code);
  expect(identities.length).toBe(2);
  expect(identities[0]).not.toBe(identities[1]);
  // The artifact the compiler said was fine must actually load.
  expect(() => registerAll(identities)).not.toThrow();
});

test("the class name survives the length bound instead of being cut off by it", () => {
  // The bound is honoured by digesting the exact spelling, so the discriminator
  // is never the part that is dropped. Same file, four classes, four identities.
  const fileName = `${"b".repeat(250)}.sm`;
  const result = compileFiles("/virtual/truncation-four", [{
    fileName,
    source: ["Alpha", "Beta", "Gamma", "Delta"]
      .map((name) => `export class ${name} extends Error {}`).join("\n"),
  }]);
  expect(result.diagnostics).toEqual([]);

  const identities = registeredIdentities(result.files[fileName]!.code);
  expect(identities.length).toBe(4);
  expect(new Set(identities).size).toBe(4);
  expect(() => registerAll(identities)).not.toThrow();
});

// ---------------------------------------------------------------------------
// RED BEFORE THE FIX -- lossy normalization
// ---------------------------------------------------------------------------

test("two module names that used to normalize together receive distinct identities", () => {
  // RED BEFORE THE FIX. Every unit outside `[A-Za-z0-9._/@:+-]` was rewritten to
  // `_`, so `a b.sm` and `a_b.sm` both minted `smithers:a_b.sm:Boom` with zero
  // diagnostics -- measured on both backends.
  const files = [
    { fileName: "p q.sm", source: "export class Boom extends Error {}\n" },
    { fileName: "p_q.sm", source: "export class Boom extends Error {}\n" },
  ];
  const result = compileFiles("/virtual/normalization", files);
  expect(result.diagnostics).toEqual([]);

  const identities = files.flatMap((file) => registeredIdentities(result.files[file.fileName]!.code));
  expect(identities).toEqual(["smithers:p+0020q.sm:Boom", "smithers:p_q.sm:Boom"]);
  expect(() => registerAll(identities)).not.toThrow();
});

test("a module name that used to collide with its own source_ disambiguation is distinct", () => {
  // RED BEFORE THE FIX, and found by this lane's own sweep rather than handed to
  // it. The disambiguating prefix was itself many-to-one: a name that did not
  // start alphanumerically was prefixed `source_`, so `.a.sm` minted
  // `smithers:source_.a.sm:Boom` -- which is exactly what a file literally named
  // `source_.a.sm` minted, since that one starts alphanumerically and was left
  // alone. Zero diagnostics on both backends.
  const files = [
    { fileName: ".q.sm", source: "export class Boom extends Error {}\n" },
    { fileName: "source_.q.sm", source: "export class Boom extends Error {}\n" },
  ];
  const result = compileFiles("/virtual/prefix", files);
  expect(result.diagnostics).toEqual([]);

  const identities = files.flatMap((file) => registeredIdentities(result.files[file.fileName]!.code));
  expect(identities).toEqual(["smithers:+002Eq.sm:Boom", "smithers:source_.q.sm:Boom"]);
  expect(() => registerAll(identities)).not.toThrow();
});

test("a family of module names that all folded onto one identity now mints one each", () => {
  // The charset collapse was not a two-name accident: EVERY unit outside the
  // alphabet mapped to the same `_`, so an entire family converged. Five spellings
  // of one shape, five identities.
  const names = ["x y.sm", "x_y.sm", "x#y.sm", "x%y.sm", "x!y.sm"];
  const files = names.map((fileName) => ({ fileName, source: "export class Boom extends Error {}\n" }));
  const result = compileFiles("/virtual/family", files);
  expect(result.diagnostics).toEqual([]);

  const identities = files.flatMap((file) => registeredIdentities(result.files[file.fileName]!.code));
  expect(identities.length).toBe(names.length);
  expect(new Set(identities).size).toBe(names.length);
  expect(() => registerAll(identities)).not.toThrow();
});

// ---------------------------------------------------------------------------
// Agreement between the emitted identity and the algorithm
// ---------------------------------------------------------------------------

test("the emitted registration and the type-only brand carry the algorithm's answer", () => {
  const fileName = "app/checkout .sm";
  const result = compileFiles("/virtual/agreement", [{
    fileName,
    source: "export class Declined extends Error {}\n",
  }]);
  expect(result.diagnostics).toEqual([]);

  const expected = nominalErrorIdentity("app/checkout .sm", "Declined");
  expect(expected).toBe("smithers:app/checkout+0020.sm:Declined");
  const code = result.files[fileName]!.code;
  expect(registeredIdentities(code)).toEqual([expected]);
  // The brand is the identity as a type-level literal; a divergence between the
  // two would make the checker and the runtime disagree about the same class.
  expect(code).toContain(`export interface Declined extends NominalError<"${expected}"> {`);
});

// ---------------------------------------------------------------------------
// The defensive invariant
// ---------------------------------------------------------------------------

/**
 * The algorithm as it shipped, verbatim, so the guard can be measured against
 * the exact code that produced the defect rather than against a caricature of it.
 */
function shippedAlgorithm(sourceName: string, name: string): string {
  const normalized = sourceName.replace(/[^A-Za-z0-9._/@:+-]/g, "_").replace(/^([^A-Za-z0-9])/, "source_$1");
  const id = `smithers:${normalized}:${name}`.slice(0, 256);
  return /[\uD800-\uDBFF]$/.test(id) ? id.slice(0, -1) : id;
}

test("the compile-wide assigner passes every declaration under today's algorithm", () => {
  const identities = new NominalErrorIdentities();
  expect(identities.claim("a.sm", "Boom")).toEqual({ identity: "smithers:a.sm:Boom" });
  // One declaration reaching the assigner twice is idempotent, not a collision.
  expect(identities.claim("a.sm", "Boom")).toEqual({ identity: "smithers:a.sm:Boom" });
  expect(identities.claim("b.sm", "Boom")).toEqual({ identity: "smithers:b.sm:Boom" });
  expect(identities.claim("a.sm", "Bang")).toEqual({ identity: "smithers:a.sm:Bang" });
});

test("the compile-wide assigner would have refused every collision the shipped algorithm minted", () => {
  // The guard exists so that a THIRD weakening of the algorithm is a refusal
  // rather than an artifact that cannot load. Today's algorithm is injective and
  // therefore cannot trip it, so the guard is measured against the algorithm that
  // actually shipped -- which is the only way to show it would have caught this.
  for (const [why, left, right] of [
    ["blind truncation", [`${"a".repeat(250)}.sm`, "Left"], [`${"a".repeat(250)}.sm`, "Right"]],
    ["separator normalization", ["a b.sm", "Boom"], ["a_b.sm", "Boom"]],
    ["the source_ disambiguation prefix", [".a.sm", "Boom"], ["source_.a.sm", "Boom"]],
  ] as const) {
    // The shipped algorithm really did fold these two onto one string.
    expect([why, shippedAlgorithm(...left)]).toEqual([why, shippedAlgorithm(...right)]);

    const shipped = new NominalErrorIdentities(shippedAlgorithm);
    expect([why, shipped.claim(...left).collidesWith]).toEqual([why, undefined]);
    expect([why, shipped.claim(...right).collidesWith]).toEqual([why, `${left[0]}:${left[1]}`]);

    // And today's algorithm keeps them apart, so the guard stays silent.
    const current = new NominalErrorIdentities();
    expect([why, current.claim(...left).collidesWith]).toEqual([why, undefined]);
    expect([why, current.claim(...right).collidesWith]).toEqual([why, undefined]);
  }
});

test("a clean project reports no identity diagnostic", () => {
  const result = compileFiles("/virtual/clean", [
    { fileName: "one.sm", source: "export class Boom extends Error {}\n" },
    { fileName: "two.sm", source: "export class Boom extends Error {}\n" },
  ]);
  expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1151")).toEqual([]);
});
