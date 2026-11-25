import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { missingRootAlternatives, checkSidecarRoots, checkSidecarRootText } from "./spec-sidecar-roots.mjs";

test("the config-relative-only contract omits TypeScript root selection", () => {
  assert.equal(missingRootAlternatives("sidecarDir holds every sidecar at its source's path under the config's directory").length, 3);
  assert.deepEqual(missingRootAlternatives("explicit rootDir; composite config directory; otherwise common source directory"), []);
});
test("VIP and option table state the same root alternatives and qualify the example", () => {
  assert.deepEqual(checkSidecarRoots(fileURLToPath(new URL("../design/", import.meta.url))), []);
});
test("fast-check: moving layout out of the table retains every source-root requirement", () => {
  const vip = readFileSync(new URL("../design/vips/0027-declaration-output.md", import.meta.url), "utf8");
  const tooling = readFileSync(new URL("../design/src/007-tooling.md", import.meta.url), "utf8");
  const paragraph = tooling.split("\n\n").find(p => p.startsWith("Sidecar placement follows TypeScript"));
  fc.assert(fc.property(
    fc.constantFrom("rootDir", "composite", "common source directory"),
    fc.stringMatching(/^[A-Za-z ]{0,60}$/),
    (term, prose) => {
      assert.deepEqual(checkSidecarRootText(vip, prose + "\n\n" + tooling), []);
      const changed = tooling.replace(paragraph, paragraph.replaceAll(term, "removed root alternative"));
      assert.ok(checkSidecarRootText(vip, changed).some(f => f.includes("chapter 7 layout") && f.includes(term)));
    }
  ), { seed: 27183, numRuns: 150 });
});
