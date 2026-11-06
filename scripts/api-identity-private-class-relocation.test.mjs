import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { compareApiIdentity } from "./api-identity.mjs";
const require = createRequire(
  new URL("../packages/runtime/package.json", import.meta.url),
);
const ts = require("typescript"),
  fc = require("fast-check");
const options = { compilerOptions: { lib: ["lib.es5.d.ts"], types: [] } };
const corpus = JSON.parse(
  readFileSync(
    new URL(
      "./api-identity-corpus/opencode-private-class-reexport.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-class-relocation-"));
  try {
    for (const [side, files] of [
      ["before", before],
      ["after", after],
    ]) {
      const dir = join(root, side);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "package.json"), '{"types":"index.d.ts"}');
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), text);
      }
    }
    return compareApiIdentity(
      ts,
      join(root, "before"),
      join(root, "after"),
      options,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function verify({
  path = "index.vibe.throwing",
  visibility = "private",
  generic = false,
} = {}) {
  const body = generic
    ? "export declare class Value<T extends string> { " +
      visibility +
      " brand: unknown; value: T; }\n"
    : "export declare class Value { " +
      visibility +
      " brand: unknown; value: string; }\n";
  const before = { "index.d.ts": body },
    after = {
      "index.d.ts": 'export { Value } from "./' + path + '.js";\n',
      [path + ".d.ts"]: body,
    };
  const same = compare(before, after);
  assert.equal(same.comparisonComplete, true, JSON.stringify(same));
  assert.equal(same.identical, true, JSON.stringify(same));
  for (const changed of [
    body.replace("brand:", "differentBrand:"),
    body.replace(
      visibility,
      visibility === "private" ? "protected" : "private",
    ),
    body.replace("value:", "readonly value:"),
    body
      .replace("value: string", "value: number")
      .replace("value: T", "value: number"),
  ]) {
    const result = compare(before, { ...after, [path + ".d.ts"]: changed });
    assert.equal(result.comparisonComplete, true, JSON.stringify(result));
    assert.equal(result.identical, false, JSON.stringify(result));
    assert.ok(result.typeDifferences.length, JSON.stringify(result));
  }
}
test("a public private class retains identity through a generated re-export", () =>
  verify());
test("a relocated protected generic class keeps its public contract", () =>
  verify({ visibility: "protected", generic: true }));
test("private-class aliases still expose a split or merged nominal identity", () => {
  const one = {
    "index.d.ts":
      "declare class Value { private brand; } export { Value as A, Value as B }",
  };
  const two = {
    "index.d.ts": 'export { A, B } from "./internal.js";',
    "internal.d.ts":
      "export declare class A { private brand; } export declare class B { private brand; }",
  };
  for (const [a, b] of [
    [one, two],
    [two, one],
  ]) {
    const result = compare(a, b);
    assert.equal(result.comparisonComplete, true, JSON.stringify(result));
    assert.equal(result.identical, false, JSON.stringify(result));
    assert.ok(result.typeDifferences.length);
  }
});
test("an enum retains identity through a private re-export and still checks its values", () => {
  const before = { "index.d.ts": "export declare enum Value { A = 1, B = 2 }" };
  const after = {
    "index.d.ts": 'export { Value } from "./internal.js";',
    "internal.d.ts": before["index.d.ts"],
  };
  const same = compare(before, after);
  assert.equal(same.comparisonComplete, true, JSON.stringify(same));
  assert.equal(same.identical, true, JSON.stringify(same));
  const changed = compare(before, {
    ...after,
    "internal.d.ts": after["internal.d.ts"].replace("B = 2", "B = 3"),
  });
  assert.equal(changed.comparisonComplete, true, JSON.stringify(changed));
  assert.equal(changed.identical, false, JSON.stringify(changed));
});
test("property: nominal relocation retains member and visibility mutation checks", () => {
  assert.ok(
    readFileSync(
      new URL("../.smithers/flows/migrate/README.md", import.meta.url),
      "utf8",
    ).includes(corpus.rule),
  );
  fc.assert(
    fc.property(
      fc.constantFrom(
        "index.vibe.throwing",
        "internal/value",
        "nested/generated",
      ),
      fc.constantFrom("private", "protected"),
      fc.boolean(),
      (path, visibility, generic) => verify({ path, visibility, generic }),
    ),
    { numRuns: 16, seed: 119027 },
  );
});
