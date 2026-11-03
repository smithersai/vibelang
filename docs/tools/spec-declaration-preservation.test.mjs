import fc from "fast-check";
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDeclarationPreservation, checkTree } from "./spec-declaration-preservation.mjs";
import { fileURLToPath } from "node:url";

// Frozen witness: r18 main 0dce9379c561, 007-tooling.md:431.
const defect = "In every scope, `--fix` keeps an import from Effect when removing it changes the declaration. The declaration stays the same bytes: an import goes only where the module's declaration is the same bytes without it.";
test("r18 import cleanup contradicts VIP-27 API identity", () => {
  assert.equal(checkDeclarationPreservation(defect).length, 1);
});
test("all design prose follows the API identity contract", () => {
  assert.deepEqual(checkTree(fileURLToPath(new URL("../design/", import.meta.url))), []);
});
test("positive fixture comparisons, protected input bytes and explicit negations remain valid", () => {
  for (const text of [
    "Exact-byte tests remain useful where equality is expected.",
    "Import cleanup preserves API identity, not emitted bytes.",
    "The declaration is not byte-identical after this import cleanup, but its API is unchanged.",
    "The migration never overwrites an input file; TS5055 protects its bytes.",
    "```ts\n// import cleanup requires byte-identical declarations\n```",
    "This fixture compares the declaration bytes before and after the import cleanup."
  ]) assert.deepEqual(checkDeclarationPreservation(text), [], text);
});
test("generated wording and whitespace mutations reject the defect neighbourhood", () => {
  // Exhaust the small prose grammar: 4 repair names x 6 predicates x 3 layouts.
  // Oracle: VIP-27 says formatting, quotes, extension spelling and harmless order do not count.
  for (const repair of ["--fix", "codemod", "migration", "import cleanup"])
    for (const predicate of ["stays the same bytes", "is the same bytes", "must remain byte-identical", "must be byte identical", "remains byte-identical", "is byte-identical"])
      for (const space of [" ", "\n", "  "]) {
        const text = `${repair}: the declaration ${predicate}.`.replaceAll(" ", space);
        assert.equal(checkDeclarationPreservation(text).length, 1, text);
        assert.deepEqual(checkDeclarationPreservation(text.replace(/declaration[\s\S]*$/, "declaration preserves API identity.")), []);
      }
});

test("fast-check mutations preserve the normative-vs-fixture distinction", () => {
  fc.assert(fc.property(
    fc.constantFrom("--fix", "codemod", "migration", "import cleanup"),
    fc.constantFrom("stays the same bytes", "is the same bytes", "must remain byte-identical", "must be byte identical"),
    fc.constantFrom(" ", "  ", "\n"),
    (repair, predicate, space) => {
      const bad = `${repair}: the declaration ${predicate}.`.replaceAll(" ", space);
      assert.equal(checkDeclarationPreservation(bad).length, 1);
      assert.deepEqual(checkDeclarationPreservation(`${repair}: declarations preserve API identity.`), []);
    }
  ), { seed: 181, numRuns: 200 });
});
