import corpus from "../../../compiler/callable-row-vectors.json";
import { expect, test } from "bun:test";
import { analyzeSource } from "./analyze.ts";

const head = corpus.head;

const erased = corpus.cases.filter(vector => vector.accepted === false).map(vector => [vector.name, vector.body] as const);

for (const [name, body] of erased) {
  test(`callable requirements cannot disappear through ${name}`, () => {
    const result = analyzeSource(head + body);
    const mismatches = result.diagnostics.filter(diagnostic => diagnostic.code === "VIBE1808");
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches.some(diagnostic => /C|D/.test(diagnostic.message))).toBe(true);
  });
}

const preserved = corpus.cases.filter(vector => vector.accepted === true).map(vector => [vector.name, vector.body] as const);

for (const [name, body] of preserved) {
  test(`callable requirements preserve ${name}`, () => {
    expect(analyzeSource(head + body).diagnostics).toEqual([]);
  });
}

test("the requirement row of a typed callable reaches its caller", () => {
  const result = analyzeSource(head + `
    function take(f: typeof read): number { return f() }
    function choose(flag: boolean): number { const f = flag ? read : other; return f() }
  `);
  expect(result.diagnostics).toEqual([]);
  expect(result.rows.take?.requirements).toEqual(["C"]);
  expect(result.rows.choose?.requirements).toEqual(["C", "D"]);
});
