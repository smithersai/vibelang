import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Effect } from "effect";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { effectfulForeignClause, effectfulForeignGuidanceProblems, plainForeignClauses, plainForeignContractProblems, directPreludeInitializers, checkForeignExamples } from "./spec-foreign-call-contract.mjs";

const fence = code => "```vibe es\n// compiler-gap: pending VIP-14\n" + code + "\n```";
test("accepted VIP-40 keeps plain unknown calls ordinary and effect calls wrapped", () => {
  const text = readFileSync(new URL("../design/vips/0040-module-declarations.md", import.meta.url), "utf8");
  assert.deepEqual(plainForeignContractProblems(text), []);
  assert.ok(plainForeignContractProblems("Unannotated unknown calls are rejected in all code.").length > 0);
});
test("fast-check: every foreign-call tier and catch exemption remains required", () => {
  const text = readFileSync(new URL("../design/vips/0040-module-declarations.md", import.meta.url), "utf8");
  fc.assert(fc.property(fc.constantFrom(...plainForeignClauses), fc.nat(20), (clause, padding) => {
    const changed = "Unrelated prose.\\n".repeat(padding) + text.replace(clause, "[removed]");
    assert.equal(plainForeignContractProblems(changed).length, 1);
  }), { seed: 1104106, numRuns: 200 });
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

test("user guides and compiler skill exempt effectful returns from foreign throw tags", () => {
  for (const path of [
    "../user/src/setup/existing-project.md",
    "../user/src/vibelang-features/114-vibelang-for-effect-users.md",
    "../../packages/compiler/skills/vibelang/SKILL.md",
  ]) {
    const text = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.deepEqual(effectfulForeignGuidanceProblems(text), [], path);
  }
});
test("fast-check: whitespace preserves the exception and code fences cannot supply it", () => {
  fc.assert(fc.property(fc.constantFrom(" ", "  ", "\n", "\n  "), fc.nat(20), fc.constantFrom("```", "~~~"), (space, padding, delimiter) => {
    const text = effectfulForeignClause.replaceAll(" ", space);
    assert.deepEqual(effectfulForeignGuidanceProblems("Other prose.\n".repeat(padding) + text), []);
    assert.equal(effectfulForeignGuidanceProblems(delimiter + "text\n" + text + "\n" + delimiter).length, 1);
    assert.equal(effectfulForeignGuidanceProblems(text.replace("effectful:", "ordinary:")).length, 1);
    assert.deepEqual(effectfulForeignGuidanceProblems("> " + effectfulForeignClause), []);
    assert.deepEqual(effectfulForeignGuidanceProblems("- " + effectfulForeignClause), []);
  }), { seed: 371071, numRuns: 200 });
});
test("fast-check: bridging an Effect factory returns the cold program instead of its success", () => {
  fc.assert(fc.property(fc.jsonValue(), value => {
    let runs = 0;
    const factory = () => Effect.sync(() => { runs++; return value; });
    const direct = Effect.runSync(Effect.gen(function* () { return yield* factory(); }));
    assert.deepEqual(direct, value);
    assert.equal(runs, 1);
    const bridged = Effect.runSync(Effect.try(() => factory()));
    assert.equal(Effect.isEffect(bridged), true);
    assert.equal(runs, 1);
    assert.deepEqual(Effect.runSync(bridged), value);
    assert.equal(runs, 2);
  }), { seed: 371072, numRuns: 200 });
});
