import { expect, test } from "bun:test";
import { analyzeSource } from "./analyze.ts";
import { annotateDeclarationEffects } from "./declarations.ts";

// The PUBLIC ROW TABLE, and the name two declarations can both claim.
//
// `Analysis.rows` is keyed by a function's public name and is what
// `annotateDeclarationEffects` (`./declarations.ts`) stamps into an emitted
// `.d.mts` as `@smithersEffects`. Both sites that build it did so with
// `rows[fn.publicName] = …` inside a loop — last writer wins over a key that is
// not unique, because `collectFunctions` puts the `#2` disambiguator on `name`
// and leaves `publicName` as the bare base name.
//
// WHY A DIFFERENTIAL TEST COULD NOT HAVE FOUND THIS. There is nothing to
// differ: the Go fork's row analysis has no `publicName` and emits no row table,
// so no cross-backend comparison touches this value at all. The assertion is
// direct — it says what the row must BE.
//
// RED BEFORE THE FIX, measured on the shipped code with zero diagnostics:
//
//     rows == { work: { failures: ["Bang"], requirements: [] } }
//
// and the emitted declaration for the exported `work` — the one that fails with
// `Boom` — carried
// `@smithersEffects {"version":1,"failures":["Bang"],"requirements":[]}`. Not a
// lost row: a WRONG artifact, checked against by a downstream module.

const twoClaimants = (functionFirst: boolean): string => {
  const declaration = `export function work(): Result<number, Boom> { return fail(new Boom()) }`;
  const holder = `export class Holder {\n  work(): Result<number, Bang> { return fail(new Bang()) }\n}`;
  return `
class Boom extends Error { constructor() { super("b") } }
class Bang extends Error { constructor() { super("g") } }
${functionFirst ? `${declaration}\n${holder}` : `${holder}\n${declaration}`}
`;
};

test("a method cannot take the row of the module-scope function it shares a name with", () => {
  for (const functionFirst of [true, false]) {
    const analysis = analyzeSource(twoClaimants(functionFirst), { fileName: "a.sm" });
    expect(analysis.diagnostics).toEqual([]);
    // The winner is chosen by ADDRESSABILITY, not by source order: only the
    // module-scope declaration has a name `./declarations.ts` can look up.
    expect(analysis.rows.work).toEqual({ failures: ["Boom"], requirements: [] });
    // Nothing was ever lost from the function LIST — it is a list.
    expect(analysis.functions.filter((fn) => fn.name === "work")).toHaveLength(2);
  }
});

test("the emitted declaration carries the module-scope function's own row", () => {
  const analysis = analyzeSource(twoClaimants(true), { fileName: "a.sm" });
  const emitted = annotateDeclarationEffects(
    `export declare function work(): Result<number, Boom>;\nexport declare class Holder { work(): Result<number, Bang>; }\n`,
    analysis.rows,
    "a.d.mts",
  );
  expect(emitted).toContain(`@smithersEffects {"version":1,"failures":["Boom"],"requirements":[]}`);
  expect(emitted).not.toContain(`"failures":["Bang"]`);
});

test("a module-scope function-valued const owns its name too", () => {
  const analysis = analyzeSource(
    `
class Boom extends Error { constructor() { super("b") } }
class Bang extends Error { constructor() { super("g") } }
export class Holder {
  work(): Result<number, Bang> { return fail(new Bang()) }
}
export const work = (): Result<number, Boom> => fail(new Boom())
`,
    { fileName: "a.sm" },
  );
  expect(analysis.diagnostics).toEqual([]);
  expect(analysis.rows.work).toEqual({ failures: ["Boom"], requirements: [] });
});

test("a function nested inside another function cannot take a module-scope row", () => {
  const analysis = analyzeSource(
    `
class Boom extends Error { constructor() { super("b") } }
class Bang extends Error { constructor() { super("g") } }
export function work(): Result<number, Boom> { return fail(new Boom()) }
export function outer(): number {
  function work(): Result<number, Bang> { return fail(new Bang()) }
  return 1
}
`,
    { fileName: "a.sm" },
  );
  expect(analysis.diagnostics).toEqual([]);
  expect(analysis.rows.work).toEqual({ failures: ["Boom"], requirements: [] });
});

test("a name no module-scope declaration claims keeps a row rather than none", () => {
  // The residual documented at `collectPublicRows`: two non-module-scope
  // claimants still resolve last-wins, because neither is addressable in the
  // emitted declarations and narrowing further would change the table for every
  // program that has a method in it.
  const analysis = analyzeSource(
    `
class Bang extends Error { constructor() { super("g") } }
export class Holder {
  work(): Result<number, Bang> { return fail(new Bang()) }
}
`,
    { fileName: "a.sm" },
  );
  expect(analysis.diagnostics).toEqual([]);
  expect(analysis.rows.work).toEqual({ failures: ["Bang"], requirements: [] });
});
