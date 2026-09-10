import { expect, test } from "bun:test";
import { analyzeSource } from "./analyze.ts";
import vectors from "../../../compiler/ownership-flow-vectors.json";

for (const vector of vectors.cases) {
  const { name, body, code } = vector;
  test(`ownership flow: ${name}`, () => {
    const diagnostics = analyzeSource(vectors.head + body).diagnostics;
    if ("codes" in vector) expect(diagnostics.map(diagnostic => diagnostic.code).sort()).toEqual([...vector.codes!].sort());
    else if (code) expect(diagnostics.map(diagnostic => diagnostic.code)).toContain(code);
    else expect(diagnostics).toEqual([]);
  });
}
