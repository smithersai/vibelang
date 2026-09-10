import corpus from "../../../compiler/callable-completion-vectors.json";
import { expect, test } from "bun:test";
import { analyzeSource } from "./analyze.ts";

for (const vector of corpus.cases) {
  test(`callable completion: ${vector.name}`, () => {
    const diagnostics = analyzeSource(corpus.head + vector.body).diagnostics;
    if (vector.code) expect(diagnostics.map(value => value.code)).toContain(vector.code);
    else expect(diagnostics).toEqual([]);
  });
}
