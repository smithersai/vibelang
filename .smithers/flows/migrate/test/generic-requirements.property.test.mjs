import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkProperty } from "../../../../scripts/testing/property.mjs";
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs";
import { compareDeclarations, loadTypeScript } from "../lib/declarations.mjs";

const root = new URL("../../../../", import.meta.url);
const require = createRequire(new URL("packages/runtime/package.json", root));
const fc = require("fast-check");
const ts = loadTypeScript([new URL("packages/runtime/", root).pathname, new URL(".smithers/", root).pathname]);
const rule = "Explicit editor refactors preserve evaluation order, coldness, types, comments and declaration output.";
// The gate itself: the checker compares the two declaration trees.
function identical(before, after) {
  const root = mkdtempSync(join(tmpdir(), "migrate-generic-requirements-"));
  try {
    for (const [dir, text] of [["ts", before], ["vibe", after]]) {
      mkdirSync(join(root, dir));
      writeFileSync(join(root, dir, "subscribeBeforeSnapshot.d.ts"), text);
    }
    return compareDeclarations(ts, join(root, "ts"), join(root, "vibe")).identical;
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("declaration gate quotes the public-contract rule", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(rule));
});

function declarations(input) {
  // These are owned nominal interfaces: the assertion needs no SDK-specific
  // service behavior, only the original generic public requirement contract.
  const header = 'declare const scopeBrand: unique symbol; declare const spanBrand: unique symbol; interface Scope { readonly [scopeBrand]: true } interface ParentSpan { readonly [spanBrand]: true } interface Program<A,E,R> { readonly value: A; readonly error: E; readonly requirements: (_: R) => R }\n';
  const names = ["subscribeBeforeSnapshot", "subscribeBeforeSnapshotWithoutMutex"].slice(0, input.exports);
  const signatures = requirement => names.map(name => "export declare function " + name + input.suffix + "<A,E,R>(snapshot: Program<A,E,R>): Program<A,E," + requirement + ">;").join("\n");
  const base = header + signatures("R | Scope");
  const drift = header + signatures("Exclude<R, ParentSpan> | Scope");
  const equivalent = header + signatures("(Scope | R)").replaceAll(",", ", ").replaceAll(";", ";\n");
  return { base, drift, equivalent };
}
function check(input) {
  const {base,drift,equivalent} = declarations(input);
  assert.equal(identical(base, equivalent), true, "formatting and union order are spelling");
  assert.equal(identical(base, drift), false, "generic R must not lose ParentSpan from the public contract");
}
test("property: T3code generic span requirements survive the declaration gate", async () => {
  await checkProperty(fc, {name:"MigrationGenericRequirements",rule,
    command:"node --test .smithers/flows/migrate/test/generic-requirements.property.test.mjs",
    regressions:new URL("./corpus/",import.meta.url),numRuns:6,
    arbitrary:fc.record({suffix:fc.integer({min:0,max:1000}).map(String),exports:fc.integer({min:1,max:2})}),check});
});
test("T3code generic-drift mutant is rejected even when formatting matches", () => {
  const {base,drift} = declarations({suffix:"",exports:2});
  assert.equal(identical(base, drift), false);
  // Erasing Exclude admits the reported mutation, so the refusal above is the
  // gate reading the requirement, not the two texts differing.
  const erase = text => text.replaceAll("Exclude<R, ParentSpan>", "R");
  assert.equal(identical(erase(base), erase(drift)), true);
});
