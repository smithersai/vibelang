/**
 * Harness self-tests: assertions about the *harness*, not about the language.
 *
 *   node --test conformance/runner/selftest.mjs
 *
 * The corpus is a differential oracle over authored programs. It is therefore
 * structurally blind to any defect that lives in how the harness *asks* a
 * backend a question, rather than in the answer. Every case travels through one
 * `CompileRequest` shape, so a field that request always sets the same way is a
 * field no case can ever vary — and a field the request omits is a code path no
 * case can ever reach.
 *
 * This file holds the assertions of that shape. Today there is one:
 * `lowering`.
 *
 * ## The defect
 *
 * `compiler.LoweringIdentity` used to be the empty string — the zero value of
 * `LoweringMode` — and `cmd/smithersc-go` built its positional-argument request
 * with no `Lowering` field at all. A zero value that is also a legal value is
 * not a default; it is a fail-open. Every positional CLI invocation therefore
 * selected identity lowering, which runs the stock TypeScript checker over the
 * TypeScript-shaped subset of Smithers and applies no Smithers rule whatsoever.
 * `smithersc-go main.sm` reported a clean compile on programs the language
 * requires it to refuse.
 *
 * It is fixed at both ends: `LoweringIdentity` is now the explicit string
 * `"identity"` (`compiler/api.go:54`) and an omitted mode is refused rather
 * than defaulted (`compiler/lowered.go:19`, "lowering mode is required").
 *
 * ## Why this is not a corpus case
 *
 * `conformance/runner/backend-go.mjs` sends `lowering` explicitly on every
 * request it builds — the forkpatch probe, every corpus case, and every interop
 * file. So no `.sm` program, however written, can reach the omitted-mode path.
 * A corpus case asserting this would be asserting something about the runner
 * while pretending to assert something about the language, and it would pass
 * for a reason unrelated to its own text.
 *
 * The regression risk is in the harness's request construction, so the
 * assertion belongs next to it. Both halves are covered here:
 *
 *   1. a source-level invariant — the harness has exactly one lowering mode and
 *      it is a named, non-empty constant, so a future edit cannot reintroduce an
 *      implicit one without this test noticing;
 *   2. a live protocol assertion — the real bridge, sent the real request
 *      shapes, must refuse an omitted mode, and the modes must be measurably
 *      not interchangeable.
 *
 * (2) is what makes this more than a spelling check. It demonstrates the
 * consequence of the original defect against the current tree, without
 * reverting anyone's fix: the same two-file program that `"internal"` refuses
 * with two Smithers diagnostics compiles clean, exit 0, under `"identity"`.
 *
 * The Go half of the fix has its own unit coverage at
 * `compiler/lowered_test.go:159-162`. This file is the conformance-side
 * counterpart and is deliberately independent of it: it goes over the wire.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildBridgeBinary, locateForkCheckout } from "../../scripts/fork-e2e.mjs";
import { loweringMode, loweringModes, repositoryRoot } from "./corpus.mjs";
import { run } from "./process.mjs";

const backendGoPath = fileURLToPath(new URL("./backend-go.mjs", import.meta.url));

test("the harness never sends an implicit lowering mode", () => {
  // The exact shape of the original defect: a zero value that is also a legal
  // value. Assert the constant is real, not empty, and one the protocol names.
  assert.equal(typeof loweringMode, "string");
  assert.notEqual(loweringMode, "");
  assert.ok(loweringModes.includes(loweringMode), `${loweringMode} is not a declared lowering mode`);
  assert.equal(loweringMode, "internal", "the corpus measures the migration target, not the reference or the stock checker");

  // Every request the Go backend builds must take the mode from that constant.
  // A literal would be a second source of truth, and the one that went stale
  // last time was the one nothing read.
  // Comments are stripped first: this file's own prose quotes `lowering:
  // "internal"` while explaining why no code may, and a check that counted
  // documentation as a violation would be a check nobody could satisfy.
  const source = readFileSync(backendGoPath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const requests = source.match(/\brootNames:/g) ?? [];
  const declarations = source.match(/\blowering:\s*loweringMode\b/g) ?? [];
  assert.ok(requests.length >= 3, "expected the probe, case and interop requests");
  assert.equal(
    declarations.length,
    requests.length,
    "every CompileRequest backend-go.mjs builds must declare `lowering: loweringMode`",
  );
  const literals = source.match(/\blowering:\s*"/g) ?? [];
  assert.equal(literals.length, 0, "backend-go.mjs must not spell a lowering mode as a string literal");

  // And the protocol's own documentation must still agree that omitting it is
  // invalid, so this test fails loudly if the contract is relaxed upstream
  // rather than silently continuing to assert a rule that no longer exists.
  const api = readFileSync(join(repositoryRoot, "compiler", "api.go"), "utf8");
  assert.match(api, /LoweringIdentity LoweringMode = "identity"/);
  assert.match(api, /The zero value is invalid\./);
});

test("the bridge refuses a request that omits the lowering mode", { concurrency: 1 }, async (t) => {
  const checkout = await locateForkCheckout();
  if (!checkout) {
    t.skip("the pinned smithersai/TypeScript checkout is absent; set SMITHERS_TYPESCRIPT_FORK");
    return;
  }

  const workspace = await mkdtemp(join(tmpdir(), "smithers-conformance-selftest-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const binary = buildBridgeBinary(join(workspace, "bin"), {});
  const cache = join(workspace, "fork-cache");

  /**
   * A two-file program that is *valid TypeScript* and *invalid Smithers*.
   *
   * `untrusted.ts` carries no leading `@module` / `@throws {never}`
   * initialization trust claim, so a `.sm` module may not statically import it
   * (SMITHERS1510), and the unconsumed checked result of the untrusted call is
   * SMITHERS1301. Nothing about either file is a syntax question, which is the
   * point: identity lowering parses it happily and simply never asks.
   */
  const files = [
    {
      path: "main.sm",
      kind: "smithers",
      text: 'import { shout } from "./untrusted.ts"\n\nexport function main(): string[] {\n  return [shout("hi")]\n}\n',
    },
    {
      path: "untrusted.ts",
      kind: "typescript",
      text: "export function shout(text: string): string {\n  return `${text.toUpperCase()}!`;\n}\n",
    },
  ];

  const send = async (lowering) => {
    const directory = await mkdtemp(join(tmpdir(), "smithers-conformance-selftest-request-"));
    try {
      const request = { rootNames: ["main.sm"], files, options: {} };
      if (lowering !== undefined) request.lowering = lowering;
      const requestPath = join(directory, "request.json");
      await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
      const invoked = await run(
        binary,
        ["--fork-checkout", checkout, "--fork-cache", cache, "--timeout", "5m", "--request", requestPath],
        { cwd: dirname(binary), timeout: 300_000 },
      );
      let result = null;
      try {
        result = JSON.parse(invoked.stdout);
      } catch {
        /* a bridge that printed nothing parseable is reported through `status` */
      }
      const errors = (result?.diagnostics ?? []).filter((item) => item.category === "error");
      return { status: invoked.status, stderr: invoked.stderr, codes: errors.map((item) => item.code).sort() };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  await t.test("an omitted mode is refused, not defaulted", async () => {
    const omitted = await send(undefined);
    assert.notEqual(omitted.status, 0, "a request with no lowering mode must not compile");
    assert.match(
      omitted.stderr,
      /lowering mode is required/,
      "the refusal must name the missing mode rather than fail for an incidental reason",
    );
    assert.deepEqual(omitted.codes, ["SMITHERS0004", "SMITHERS_GO_BACKEND"]);
  });

  await t.test("an unknown mode is refused too", async () => {
    const bogus = await send("nonsense");
    assert.notEqual(bogus.status, 0);
    assert.match(bogus.stderr, /unsupported lowering mode "nonsense"/);
  });

  await t.test("the mode the harness sends really does apply Smithers rules", async () => {
    const internal = await send(loweringMode);
    assert.deepEqual(
      internal.codes,
      ["SMITHERS1301", "SMITHERS1510"],
      "internal lowering must refuse an untrusted static foreign module edge",
    );
  });

  await t.test("identity lowering applies none of them, which is what a silent default cost", async () => {
    // This is the consequence of the original defect, measured rather than
    // argued: the identical request under the mode the empty string used to
    // select compiles clean. Had `lowering` stayed omittable, every positional
    // `smithersc-go` invocation would have reported this program as valid.
    const identity = await send("identity");
    assert.equal(identity.status, 0, "identity lowering compiles the TypeScript-shaped subset");
    assert.deepEqual(identity.codes, [], "identity lowering applies no Smithers rule");
  });
});
