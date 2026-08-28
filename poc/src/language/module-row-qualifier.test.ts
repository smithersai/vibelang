import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSemanticProject, moduleRowQualifier } from "./semantic.ts";

/**
 * Module row qualifier INJECTIVITY on the reference frontend, and the shared
 * vectors that keep this copy of the algorithm and the fork's from drifting.
 *
 * The qualifier exists for one job: when two modules in a project declare an
 * Error or Context class with the same name, the bare name is no longer an
 * identity, so every colliding declaration is renamed `Name@module/path`. A
 * disambiguator that itself re-collides has not done that job, and the shipped
 * one did — measured, not inferred:
 *
 *     a b.sm  and  a_b.sm  ->  Boom@a_b   in BOTH modules, no diagnostic
 *
 * `errorNamesOfType` collects row members into a `Set`, so the two rows merged
 * into one member and `Error.match` exhaustiveness accepted a case for one as
 * covering the other. Nothing on that path reports anything.
 *
 * The second half was worse in a different way: the reference walked UTF-16
 * code units (`.replace` with a non-`u` class) and the fork walked runes, so an
 * astral character in a module path made the two backends mint DIFFERENT row
 * names for the same program. That one is a live disagreement rather than a
 * shared blind spot, and no conformance case could catch it — the corpus has no
 * module path outside `[A-Za-z0-9._/-]` and no class name declared in two
 * modules, so `buildRowNaming` never qualifies anything there, and the runner
 * compares diagnostic codes and positions rather than message text anyway.
 */

interface QualifierVector {
  readonly why: string;
  readonly module: string;
  readonly viaFork: boolean;
  readonly qualifier: string;
}

const CORPUS = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../../../conformance/identity/module-row-qualifier.json"), "utf8"),
) as { readonly vectors: readonly QualifierVector[] };

test("the shared vectors are the reference's own answer", () => {
  expect(CORPUS.vectors.length).toBeGreaterThan(0);
  for (const vector of CORPUS.vectors) {
    expect(`${vector.why}: ${moduleRowQualifier(vector.module)}`).toBe(`${vector.why}: ${vector.qualifier}`);
  }
});

/**
 * The property the vectors are a sample of. A qualifier that two distinct
 * module paths can share is not a qualifier, and the shipped algorithm failed
 * this on the fourth pair below in under a millisecond.
 */
test("distinct module paths never mint one qualifier", () => {
  const modules = [
    "a b.sm",
    "a_b.sm",
    "a-b.sm",
    "a+b.sm",
    "a@b.sm",
    "a%b.sm",
    "a\tb.sm",
    "a b.sm",
    "café.sm",
    "café.sm",
    "x😀.sm",
    "x__.sm",
    "x_.sm",
    "a.sm.sm",
    "a.sm",
    "dir/a b.sm",
    "dir/a_b.sm",
  ];
  const byQualifier = new Map<string, string>();
  for (const module of modules) {
    const qualifier = moduleRowQualifier(module);
    const prior = byQualifier.get(qualifier);
    expect(prior === undefined ? "" : `${prior} and ${module} both mint ${qualifier}`).toBe("");
    byQualifier.set(qualifier, module);
  }
  expect(byQualifier.size).toBe(modules.length);
});

/**
 * The escape is a bijection onto its image, so it can be DECODED. Nothing in
 * the compiler decodes a qualifier; the point is that a decoder can exist,
 * which is the operational form of "no information was destroyed" and the
 * property the predecessor lacked.
 */
test("the escape is reversible", () => {
  const decode = (qualifier: string): string =>
    qualifier.replace(/\+([0-9A-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  for (const module of ["a b.sm", "a+b.sm", "x😀.sm", "@scope/a.sm", "café.sm", "a:b.sm"]) {
    expect(decode(moduleRowQualifier(module))).toBe(module.replace(/\.sm$/, ""));
  }
});

/**
 * End to end, through the analysis that mints the row name. This is the test
 * that would have failed on the shipped code: two modules that used to be
 * handed one `Boom@a_b` between them.
 */
test("two modules the predecessor folded together get two row names", () => {
  const declaration = (name: string) =>
    `export class Boom extends Error {\n  constructor(readonly value: number) { super("bad") }\n}\n` +
    `export function ${name}(value: number): number {\n  if (value < 0) throw new Boom(value)\n  return value\n}\n`;
  const analysis = buildSemanticProject([
    { fileName: "a b.sm", source: declaration("spaced") },
    { fileName: "a_b.sm", source: declaration("scored") },
  ], { rootDir: "/project" });

  const rows = Object.values(analysis.files).flatMap((file) => Object.values(file.rows));
  const failures = [...new Set(rows.flatMap((row) => row.failures))].filter((name) => name.startsWith("Boom"));
  expect(failures.slice().sort()).toEqual(["Boom@a+0020b", "Boom@a_b"]);
});
