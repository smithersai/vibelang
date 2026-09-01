// SPECIMEN — a TypeScript TEST file. The census must not read it at all.
//
// The reference half of the subtraction has the same exposure as the fork half:
// the published command grepped `poc/src src` wholesale, so every *.test.ts in
// the reference tree fed it too. A code a test asserts on is a code the test
// knows about; whether the implementation still REPORTS it is a separate
// question, and it is the only one this census is asking.

import { expect, test } from "bun:test";

test("an unclassified option is SMITHERS9108 at the option name", () => {
  // A live assertion string, in report-argument shape, in a test.
  expect(found.map((item) => item.code)).toEqual(["SMITHERS9108"]);
  expect(diagnostics).toContainEqual({ code: "SMITHERS9108", line: 1, column: 1 });
});
