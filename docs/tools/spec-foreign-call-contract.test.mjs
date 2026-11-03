import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { fileURLToPath } from "node:url";
import { unknownCallExemptions, directPreludeInitializers, checkForeignExamples } from "./spec-foreign-call-contract.mjs";

const fence = code => "```vibe es\n// compiler-gap: pending VIP-14\n" + code + "\n```";
test("r18 VIP-40 stale unknown-call exception fails the VIP-4 contract", () => {
  assert.equal(unknownCallExemptions("A call of `readText`, whose throwing is unknown, stays an ordinary call, as the ruling says.").length, 1);
  assert.deepEqual(unknownCallExemptions("A call whose unannotated signature throws `unknown` is rejected too."), []);
});
test("r18 prelude example needs bridges for its three npm value calls", () => {
  const code = "const two = pipe(1, n => n + 1)\nconst first = Effect.Array.head([1, 2])\nconst o = Option.some(1)";
  assert.equal(directPreludeInitializers(fence(code)).length, 3);
  assert.deepEqual(directPreludeInitializers(fence("const o = try Effect.try(() => Option.some(1))")), []);
});
test("written reference TypeScript and unrelated binding examples are outside this check", () => {
  assert.deepEqual(directPreludeInitializers("```ts effect\nconst o = Option.some(1)\n```"), []);
  assert.deepEqual(directPreludeInitializers("```vibe\nconst pipe = n => n; const two = pipe(1)\n```"), []);
  assert.deepEqual(directPreludeInitializers(fence("const program = Effect.succeed(1)\nconst Port = Schema.Number")), []);
});
test("published foreign-call examples and VIP agree", () => {
  assert.deepEqual(checkForeignExamples(fileURLToPath(new URL("../design/", import.meta.url))), []);
});
test("fast-check whitespace, variable and call mutations retain the explicit bridge", () => {
  fc.assert(fc.property(fc.constantFrom("pipe", "Effect.Array.head", "Option.some"),
    fc.constantFrom("const", "let"), fc.constantFrom("value", "$result", "_first"),
    fc.constantFrom(" ", "  ", "\n"), (callee, kind, name, space) => {
      const prefix = [kind, name, "=", ""].join(space);
      assert.equal(directPreludeInitializers(fence(prefix + callee + space + "(1)")).length, 1);
      assert.deepEqual(directPreludeInitializers(fence(prefix + "try Effect.try(() => " + callee + "(1))")), []);
    }), { seed: 182, numRuns: 200 });
});
