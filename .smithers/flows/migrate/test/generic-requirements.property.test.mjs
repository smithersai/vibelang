import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkProperty } from "../../../../scripts/testing/property.mjs";
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs";
import { canonicalize, loadTypeScript } from "../lib/declarations.mjs";

const root = new URL("../../../../", import.meta.url);
const require = createRequire(new URL("packages/runtime/package.json", root));
const fc = require("fast-check");
const ts = loadTypeScript([new URL("packages/runtime/", root).pathname, new URL(".smithers/", root).pathname]);
const rule = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix.";
const canonical = text => canonicalize(ts, text, "subscribeBeforeSnapshot.d.ts");
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
  const expected = canonical(base);
  assert.equal(expected, canonical(equivalent), "formatting and union order are spelling");
  assert.notEqual(expected, canonical(drift), "generic R must not lose ParentSpan from the public contract");
  assert.equal(canonical(drift), canonical(canonical(drift)), "normalization must be idempotent");
}
test("property: T3code generic span requirements survive canonical declaration comparison", async () => {
  await checkProperty(fc, {name:"MigrationGenericRequirements",rule,
    command:"node --test packages/compiler/test/migrate-generic-requirements.property.test.mjs",
    regressions:new URL("./corpus/",import.meta.url),numRuns:160,
    arbitrary:fc.record({suffix:fc.integer({min:0,max:1000}).map(String),exports:fc.integer({min:1,max:2})}),check});
});
test("T3code generic-drift mutant is rejected even when formatting matches", () => {
  const {base,drift} = declarations({suffix:"",exports:2});
  assert.notEqual(canonical(base), canonical(drift));
  // A deliberately broken comparator which erases Exclude would admit the
  // reported mutation. This guards the oracle without weakening the gate.
  const erase = text => canonical(text.replaceAll("Exclude<R, ParentSpan>", "R"));
  assert.equal(erase(base),erase(drift));
});
