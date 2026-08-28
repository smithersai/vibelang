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
import { auditBaseline, classify, corpusAnswer, VERDICTS } from "../../scripts/oracle-differential.mjs";
import { loadCorpus, loweringMode, loweringModes, repositoryRoot } from "./corpus.mjs";
import { harnessText } from "./harness.mjs";
import { auditVerdict, compareObservations, judge } from "./judge.mjs";
import { jsBackend, runJsCase } from "./backend-js.mjs";
import { goBackend } from "./backend-go.mjs";
import { run } from "./process.mjs";

const backendGoPath = fileURLToPath(new URL("./backend-go.mjs", import.meta.url));
const backendJsPath = fileURLToPath(new URL("./backend-js.mjs", import.meta.url));

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
    // This file asserts how the harness ASKS its question; what the language
    // ANSWERS belongs to a corpus case. Until 2026-08-25 this assertion was
    // `deepEqual(codes, ["SMITHERS1301", "SMITHERS1510"])`, which quietly made
    // it both — and when the fork stopped reporting the SMITHERS1301 for the
    // Result the untrusted call discards, this request-shape test went red for
    // a language disagreement it does not own. That disagreement is now pinned
    // where it belongs, by `09-foreign-calls/foreign-module-without-a-trust-marker`
    // and its `xfail` (go), which states the whole argument and would report
    // XPASS the moment the fork agrees again. What THIS test needs is only that
    // the mode the harness sends applies Smithers rules at all — the module
    // trust refusal on a program that is valid TypeScript — against the subtest
    // below, where identity lowering applies none of them.
    assert.ok(
      internal.codes.includes("SMITHERS1510"),
      `internal lowering must refuse an untrusted static foreign module edge; got [${internal.codes.join(", ")}]`,
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

/**
 * A failure line must observe the compiler-stable Error identity, and each
 * backend must supply its own accessor for it.
 *
 * This is the same shape as the `lowering` assertion above: something the
 * harness sets the same way for every case, and therefore something no case can
 * vary. Until 2026-08-25 `describeError` printed `error.constructor.name`, which
 * `specification/failures.mdx` ("Error Prototype") names as precisely the wrong
 * key — "compiler-stable nominal identity, not a forgeable user `_tag` or
 * minifier-sensitive constructor name". The cost was measured, not theoretical:
 * three of the four obligations in "Error Classes" were missing from the Go fork
 * and **no corpus case could see it in either direction**, because
 * `constructor.name` reads `Boom` on a backend that mints an identity and `Boom`
 * on a backend that mints none.
 *
 * A corpus case cannot hold this. The corpus can pin one identity *string* — and
 * `01-result-lifting/throw-lifts-into-failure` now does — but it cannot see the
 * harness silently stop asking for one, because a backend that fell back to the
 * constructor name would leave every case that does not declare an identity
 * green. So the invariant lives here, in three parts: the accessor is required,
 * each backend passes its own, and the fallback is reachable but cannot be
 * mistaken for an identity.
 */
test("a failure line is observed by identity, and each backend supplies its own accessor", async (t) => {
  await t.test("the accessor is required rather than defaulted", () => {
    assert.throws(() => harnessText("./main.js"), /identity accessor/);
    assert.throws(() => harnessText("./main.js", { module: "", name: "errorIdentity" }), /identity accessor/);
    assert.throws(() => harnessText("./main.js", { module: "./p.js", name: "" }), /identity accessor/);
    assert.throws(() => harnessText("./main.js", "errorIdentity"), /identity accessor/);
  });

  await t.test("both backends pass one, and they are not the same one", () => {
    // Comments are stripped first, for the same reason the lowering check
    // strips them: this file and both backends explain the mechanism in prose.
    const strip = (path) =>
      readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const [label, path] of [["js", backendJsPath], ["go", backendGoPath]]) {
      const source = strip(path);
      assert.match(
        source,
        /harnessText\([^)]*,\s*identityAccessor\)/,
        `backend-${label}.mjs must hand the shared harness its identity accessor`,
      );
      assert.equal(
        (source.match(/const identityAccessor = \{/g) ?? []).length,
        1,
        `backend-${label}.mjs must declare exactly one identity accessor`,
      );
      assert.equal(
        (source.match(/harnessText\(/g) ?? []).length,
        1,
        `backend-${label}.mjs must build the harness in exactly one place`,
      );
    }
    // The two backends read *different* modules under *different* names. A
    // single hard-coded specifier would resolve on one backend and not the
    // other, and the whole reason this is a parameter is that the two
    // implementations spell one concept differently — the same reason the
    // Result representation is normalized rather than assumed.
    assert.match(strip(backendJsPath), /name: "errorIdentity"/);
    assert.match(strip(backendGoPath), /name: "smithersErrorIdentity"/);
    assert.match(strip(backendGoPath), /module: "\.\/__smithers_prelude\.js"/);
  });

  await t.test("the identity is preferred, and the fallback cannot be mistaken for one", async () => {
    // Executed rather than pattern-matched: the harness is a program, and what
    // matters is the line it prints. Two runs of the real `harnessText` output,
    // differing only in what the accessor returns.
    const directory = await mkdtemp(join(tmpdir(), "smithers-conformance-selftest-harness-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
    await writeFile(
      join(directory, "program.js"),
      [
        "class Boom extends Error {}",
        "export function main() {",
        '  return { ok: false, error: new Boom("bad value -2") };',
        "}",
        "",
      ].join("\n"),
    );

    const observe = async (accessorBody) => {
      await writeFile(join(directory, "identity.js"), `export function identityOf(error) {\n${accessorBody}\n}\n`);
      await writeFile(
        join(directory, "harness.mjs"),
        harnessText("./program.js", { module: "./identity.js", name: "identityOf" }),
      );
      const executed = await run(process.execPath, [join(directory, "harness.mjs")], { cwd: directory });
      assert.equal(executed.status, 0, executed.stderr);
      return executed.stdout.trim();
    };

    assert.equal(
      await observe('  return "smithers:program.sm:Boom";'),
      "error smithers:program.sm:Boom: bad value -2",
      "a registered Error must be observed by its compiler-stable identity",
    );
    assert.equal(
      await observe("  return undefined;"),
      "error Boom: bad value -2",
      "an Error the compiler never registered falls back to the constructor name",
    );
    // The fallback is reachable, so it has to be unmistakable. Every identity
    // the two compilers mint contains a ":" and no JavaScript constructor name
    // can, so a case declaring an identity can never be satisfied by the
    // fallback and vice versa.
    assert.ok(!"Boom".includes(":"));
  });
});

/**
 * A run that measured nothing must not report itself as green.
 *
 * This is the harness's instance of the failure mode the Node and Go gates
 * each grew a census to refuse: with no case selected, every bucket is
 * legitimately zero, `verifyCounts` is satisfied by arithmetic over no rows,
 * and the table reads `0/0 pass`. Exit 0 there is a claim about a corpus that
 * was never consulted. Like the lowering assertion above, it cannot be a
 * corpus case: it is a property of the runner's own reporting, and the corpus
 * is precisely what is absent.
 *
 * Both directions, because the useful gate is the one that still measures: a
 * filter that selects a real case must still succeed.
 */
test("a run that measured nothing is refused rather than reported as green", { concurrency: 1 }, async (t) => {
  const runner = join(repositoryRoot, "conformance", "runner", "run.mjs");
  const measure = (filter) =>
    run(process.execPath, [runner, "--backend", "js", "--filter", filter, "--quiet"], {
      cwd: repositoryRoot,
      timeout: 300_000,
    });

  await t.test("a filter that matches no case is exit 2, not exit 0", async () => {
    const empty = await measure("zzz-no-corpus-case-has-this-in-its-id");
    assert.equal(empty.status, 2, `expected the empty run to be refused: ${empty.stderr || empty.stdout}`);
    assert.match(empty.stderr, /no case was measured/);
    assert.match(empty.stderr, /matched nothing/);
  });

  await t.test("a filter that selects a real case still passes", async () => {
    const measured = await measure("01-result-lifting/return-lifts-into-success");
    assert.equal(measured.status, 0, measured.stderr || measured.stdout);
    assert.match(measured.stdout, /JS reference: {2}1\/1 pass/);
  });
});

/**
 * The `SMITHERS19xx` range means two different things in the two
 * implementations, and the judge translates it for exactly one of them.
 *
 * The Go comptime port numbers its rules `SMITHERS19xx` where the reference
 * frontend uses `VCT10xx`, last two digits one-for-one, so the judge
 * canonicalizes the fork's spelling at the contract boundary. The reference
 * ALSO spells `SMITHERS1900`/`1901`/`1902` — and there they are the formatter's
 * mask-budget, overlapping-mask and overlapping-edit rules
 * (`poc/src/language/format.ts:646`, `:667`, `:700`), unrelated to comptime.
 *
 * While that translation was unconditional it applied to the reference too, so
 * a reference formatter failure was rewritten onto a live comptime code and a
 * case declaring `VCT1001` could be satisfied by `SMITHERS1901` — the judge
 * scoring an agreement it had never checked. Measured before the fix: `judge`
 * returned `pass` for exactly that pair.
 *
 * No corpus case can reach it today (the formatter is only reachable through
 * the `smithers format` subcommand, never through `compileProject`, and no case
 * declares a `SMITHERS19xx` code), which is precisely why it needs an assertion
 * rather than a corpus case: it is a property of the harness, invisible to a
 * differential oracle over authored programs, and it would go live silently.
 */
test("the comptime code alias is scoped to the fork", async (t) => {
  const diagnostics = (code) => ({
    kind: "diagnostics",
    stage: "compile",
    stages: ["compile"],
    diagnostics: [{ code, line: 1, column: 1, message: "probe" }],
  });
  const declaring = (code) => ({
    id: "probe",
    expectation: { expect: "diagnostics", diagnostics: [{ code, line: 1, column: 1 }] },
  });

  await t.test("the fork's comptime spelling is still translated", () => {
    assert.equal(judge(declaring("VCT1004"), diagnostics("SMITHERS1904"), "go").status, "pass");
  });

  await t.test("a reference formatter code does not satisfy a comptime case", () => {
    assert.equal(judge(declaring("VCT1001"), diagnostics("SMITHERS1901"), "js").status, "fail");
  });

  await t.test("the same literal code on both backends is not agreement", () => {
    // Two different rules that happen to share a number must not compare equal.
    assert.equal(compareObservations(diagnostics("SMITHERS1901"), diagnostics("SMITHERS1901")).agree, false);
  });

  await t.test("a reference SMITHERS19xx is a harness-integrity failure", () => {
    const violations = auditVerdict(
      declaring("VCT1001"),
      diagnostics("SMITHERS1901"),
      { status: "pass" },
      { name: "js", requiredStages: {} },
    );
    assert.ok(
      violations.some((text) => text.includes("collides")),
      `expected a code-space collision violation, saw: ${JSON.stringify(violations)}`,
    );
  });

  // The over-correction guard: scoping the alias must not disturb any code
  // outside the contested range, on either backend.
  await t.test("ordinary codes are untouched on both backends", () => {
    for (const backend of ["js", "go"]) {
      assert.equal(judge(declaring("SMITHERS4112"), diagnostics("SMITHERS4112"), backend).status, "pass");
    }
    assert.deepEqual(
      auditVerdict(
        declaring("SMITHERS4112"),
        diagnostics("SMITHERS4112"),
        { status: "pass" },
        { name: "js", requiredStages: {} },
      ).filter((text) => text.includes("collides")),
      [],
    );
  });
});

/**
 * The recorded product-vs-oracle divergence must stay a live record.
 *
 * `conformance/runner/run.mjs` measures two BACKENDS. Neither of them is
 * `bin/smithers.js`: the JS reference reaches the frontend through
 * `conformance/runner/js-lower.mjs`, which turns the source-asset stage on only
 * for a case that ships assets, skips comptime for a case with no
 * compiler-owned edge, and runs a durable source pass of its own; the shipped
 * CLI runs an asset preflight and a runtime-graph resolver over every `.sm`
 * before the semantic stage and has no durable stage in `check` at all. So
 * "424 cases, 0 divergent" is a statement about `compileProject` plus
 * `js-lower.mjs`, and `conformance/product-divergence.json` is the written
 * record of everything that statement does not cover.
 *
 * `scripts/oracle-differential.mjs` gates that record by re-measuring it, and it
 * spawns one process per case, so it is not something every test run pays for.
 * These assertions are the part that costs nothing and still stops the record
 * from rotting: a row naming a case somebody deleted, a row regenerated by
 * `--update` and never given a verdict, or a duplicate would all leave the file
 * looking authoritative while describing a corpus that no longer exists.
 *
 * The differential's own equality relation is asserted here too. It has to be
 * the corpus's relation — code plus authored line and column, and `expect:
 * "output"` meaning the product must accept — or the gate would be measuring the
 * product against a contract of its own invention.
 */
test("the recorded product-vs-oracle divergence is a live record", async (t) => {
  const baselinePath = join(repositoryRoot, "conformance", "product-divergence.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const cases = loadCorpus({});

  await t.test("every row names a case that still exists, once, with a reviewed verdict", () => {
    assert.deepEqual(auditBaseline(baseline, cases), []);
  });

  await t.test("a row for a deleted case is refused", () => {
    const violations = auditBaseline(
      { divergences: [{ id: "17-durable/no-such-case", direction: "both-refuse", corpus: "a", product: "b", verdict: "product-wrong", cause: "c" }] },
      cases,
    );
    assert.ok(violations.some((text) => text.includes("no such corpus case")), JSON.stringify(violations));
  });

  await t.test("a regenerated row that was never reviewed is refused", () => {
    // `--update` writes `unreviewed` for any row it cannot carry a judgement
    // onto. That value exists precisely so a re-measured baseline cannot pass
    // unread, which is the failure mode a baseline file invites.
    const row = { ...baseline.divergences[0], verdict: "unreviewed", cause: "unreviewed" };
    const violations = auditBaseline({ divergences: [row] }, cases);
    assert.ok(violations.some((text) => text.includes("never reviewed")), JSON.stringify(violations));
    assert.ok(VERDICTS.includes("unreviewed"));
  });

  await t.test("the differential judges by the corpus's own relation, not one of its own", () => {
    // Code AND authored position, exactly as `judge.mjs` compares them, and in
    // the same sorted spelling — a differential that compared codes only would
    // score `SMITHERS1510@1:23` and `SMITHERS1510@4:1` as agreement.
    assert.equal(
      corpusAnswer({ expect: "diagnostics", diagnostics: [{ code: "SMITHERS1510", line: 1, column: 23 }] }),
      "SMITHERS1510@1:23",
    );
    assert.equal(
      corpusAnswer({
        expect: "diagnostics",
        diagnostics: [
          { code: "SMITHERS1510", line: 1, column: 23 },
          { code: "SMITHERS1301", line: 4, column: 11 },
        ],
      }),
      "SMITHERS1301@4:11, SMITHERS1510@1:23",
    );
    // An `output` case is required to be ACCEPTED. `smithers run` executes an
    // emitted module directly and never calls the `main()` the conformance
    // harness calls, so the gate does not claim to compare printed output; the
    // harness still owns that half.
    assert.equal(corpusAnswer({ expect: "output", stdout: ["x"] }), "ACCEPTED");
  });

  await t.test("the dangerous direction is the one the corpus cannot see", () => {
    // A product that ACCEPTS what the corpus refuses is the case where a green
    // scoreboard row certifies a rule the shipped compiler does not enforce.
    assert.equal(classify({ expect: "diagnostics", diagnostics: [] }, "ACCEPTED"), "product-accepts");
    assert.equal(classify({ expect: "diagnostics", diagnostics: [] }, "SMITHERS1510@1:1"), "both-refuse");
    assert.equal(classify({ expect: "output", stdout: [] }, "SMITHERS1207@1:1"), "product-refuses");
    assert.equal(classify({ expect: "output", stdout: [] }, "ACCEPTED"), undefined);
  });

  await t.test("no recorded row claims the product accepts a program the corpus refuses", () => {
    // If this ever fires, the divergence stopped being a reporting difference
    // and became a hole in what the language enforces. It is asserted rather
    // than merely printed because the whole point of the record is that this
    // bucket stays empty.
    assert.deepEqual(
      baseline.divergences.filter((row) => row.direction === "product-accepts").map((row) => row.id),
      [],
    );
  });
});

/**
 * A durable diagnostic must not discard an output-expecting run.
 *
 * ## The defect
 *
 * `js-lower.mjs` ran the compiler-owned durable source pass, and if ANY module
 * came back refused it wrote `{ ok: true, files: {}, diagnostics: [<durable>] }`
 * and returned. The rest of the frontend — Smithers lowering, the language and
 * portability rules, the stock check of the emitted set, execution — never ran,
 * for any module in the run, including the ones that lowered cleanly.
 *
 * For a case that declares `expect: "diagnostics"` that is correct and stays
 * correct: the refusal IS the observable behavior and there is nothing else to
 * measure.
 *
 * For a case that declares `expect: "output"` it throws the measurement away.
 * The report can say "the durable stage refused" and nothing else — not whether
 * the rest of the program is well formed, not what the emitted set checks as.
 * A module that is half-migrated therefore reads as a harness that produced
 * nothing rather than as a program that answered wrongly, and every further
 * defect in it is discovered one re-run at a time.
 *
 * ## Why this is not a corpus case
 *
 * A corpus case cannot express it. The corpus is a differential over authored
 * programs, and this is a property of what the *runner* does with an expectation
 * — `expect: "output"` is a field of the case, not of the program — so any
 * corpus case written for it would pass or fail for reasons unrelated to its own
 * text. Both directions are asserted here, against the real driver, because the
 * over-correction (dropping the short-circuit outright, or letting a refused
 * flow reach execution and be scored on its stdout) is a fail-open.
 */
test("a durable diagnostic does not discard an output-expecting run", { concurrency: 1 }, async (t) => {
  // Two INDEPENDENT defects in one module, which is the whole point: the first
  // is refused by the durable pass, the second only by the language stage that
  // used to be skipped.
  //
  //   1. `$Failed` and `_Failed` normalize to one durable failure identity, so
  //      the Action's declared failure channel is refused. Matched by shape
  //      (`SMITHERS41xx`) rather than by number, because which rule in that
  //      family answers a collision is a live question — see MIGRATION-PLAN R3.
  //   2. `Date.now()` is an ambient wall-clock read, which `20-host-globals`
  //      pins as SMITHERS1602. The durable pass knows nothing about it.
  const halfMigrated = [
    'import { durable, Action } from "smithers:flows"',
    "",
    "class $Failed extends Error {",
    "  constructor(readonly code: string) { super(`x: ${code}`) }",
    "}",
    "",
    "class _Failed extends Error {",
    "  constructor(readonly reason: string) { super(`x: ${reason}`) }",
    "}",
    "",
    "class Pick extends Action<(input: { key: string }) => Result<{ value: string }, $Failed | _Failed>> {}",
    "",
    "export const Flow = durable((input: { key: string }) => {",
    "  return Pick.run({ key: input.key })",
    "})",
    "",
    "export function main(): string[] {",
    "  return [String(Flow.plan.actions.length), `${Date.now()}`]",
    "}",
    "",
  ].join("\n");

  const caseFor = (expectation) => ({
    id: `selftest/half-migrated-durable-${expectation.expect}`,
    entry: "main.sm",
    files: [{ path: "main.sm", kind: "smithers", text: halfMigrated }],
    expectation,
  });

  // Only `expect` reaches the driver — `backend-js.mjs` sends it as one boolean
  // and sends nothing else from the expectation. The declared diagnostics and
  // stdout below are the minimum `judge.mjs` needs to score the observation;
  // neither can influence what the frontend does, which is the property the
  // request shape is deliberately narrow to guarantee.
  const refusalCase = caseFor({
    expect: "diagnostics",
    diagnostics: [{ code: "SMITHERS4124", line: 14, column: 20 }],
  });
  const outputCase = caseFor({ expect: "output", stdout: ["1", "0"] });

  const refused = await runJsCase(refusalCase);
  const kept = await runJsCase(outputCase);

  const codes = (observation) => (observation.diagnostics ?? []).map((item) => item.code).sort();

  await t.test("a diagnostics run still short-circuits on the durable refusal", () => {
    assert.equal(refused.kind, "diagnostics", JSON.stringify(refused));
    // Exactly one: the short-circuit is what keeps a declared, exact diagnostic
    // set from collecting whatever else the un-lowered source says.
    assert.equal(codes(refused).length, 1, JSON.stringify(codes(refused)));
    assert.match(codes(refused)[0], /^SMITHERS41\d\d$/);
    assert.deepEqual(refused.stages, ["lower"]);
  });

  await t.test("an output run keeps going and reports the defect the durable stage cannot see", () => {
    assert.equal(kept.kind, "diagnostics", JSON.stringify(kept));
    const observed = codes(kept);
    assert.ok(
      observed.some((code) => /^SMITHERS41\d\d$/.test(code)),
      `the durable refusal must survive the guard: ${JSON.stringify(observed)}`,
    );
    assert.ok(
      observed.includes("SMITHERS1602"),
      `the language-stage defect must now be reported too: ${JSON.stringify(observed)}`,
    );
    // The behaviour change, stated as a comparison rather than as a constant:
    // the same program, same driver, reports strictly more under an `output`
    // expectation than under a `diagnostics` one.
    assert.ok(observed.length > codes(refused).length);
  });

  await t.test("and the run stays fail-closed: a refused flow is never scored on its stdout", () => {
    // The over-correction this guard must not become. Measured: skipping the
    // short-circuit without carrying the durable diagnostics forward makes the
    // refusal disappear, flips `emitChecked` to true, and reports the run as
    // stock `TS2307, TS2339` about the `smithers:flows` import that successful
    // lowering erases — the acceptance stage running on a program the durable
    // stage refused.
    assert.notEqual(kept.kind, "output");
    assert.ok(
      !(kept.stages ?? []).includes("emit-check"),
      `the emitted-TypeScript acceptance stage must not run on a refused program: ${JSON.stringify(kept.stages)}`,
    );
    assert.equal(judge(outputCase, kept, "js").status, "fail");
    assert.deepEqual(auditVerdict(outputCase, kept, judge(outputCase, kept, "js"), { name: "js", requiredStages: {} }), []);
  });

  await t.test("the driver is told the expectation by the backend, not by a default", () => {
    // A future edit that drops the field from the request makes the guard inert
    // and every assertion above still passes on the `diagnostics` half, so the
    // wiring is asserted at the source as well.
    const source = readFileSync(backendJsPath, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.match(source, /expectsOutput:\s*testCase\.expectation\.expect === "output"/);
  });
});

/**
 * A backend the caller ASKED FOR and the harness could not prepare is a failure
 * to measure, in every `--backend` mode.
 *
 * ## The defect
 *
 * The availability arm of the exit code was written twice, once per backend, and
 * the two copies did not say the same thing: the reference was enforced under
 * `js` and `both`, the fork only under `go`. So `--backend both` on a machine
 * that cannot prepare the fork printed `go: unavailable — <reason>` in the table
 * and **exited 0**. That is the shape this repository keeps finding — green
 * without doing the work — and it is worse here than in most places, because
 * `both` is the DEFAULT mode: the bare `node conformance/runner/run.mjs` that
 * every gate and every README line quotes.
 *
 * The asymmetry was also backwards on its own terms. A Go *verdict* failure
 * already gated under `both` (fixed 2026-08-26). So "we looked at the fork and
 * found a divergence" exited 1 while "we never looked at the fork at all"
 * exited 0.
 *
 * ## Why this is not a corpus case
 *
 * No `.sm` program can express it: the input is the CLI's own `--backend` value
 * against a backend that never ran a case. The whole matrix is asserted — three
 * modes against each backend being unpreparable, including the four cells that
 * were already right — because the defect was an inconsistency BETWEEN cells,
 * and a test that checked only the broken one would not have seen it either.
 */
test("a requested backend that could not be prepared refuses the run, in every mode", { concurrency: 1 }, async (t) => {
  const runner = join(repositoryRoot, "conformance", "runner", "run.mjs");
  // One cheap, green case. A mode that is expected to exit 0 must exit 0 having
  // MEASURED something — an empty run is its own exit 2, asserted above, and
  // would satisfy an exit-code assertion here for entirely the wrong reason.
  const green = "01-result-lifting/return-lifts-into-success";
  const invoke = (args, environment) =>
    run(process.execPath, [runner, "--filter", green, "--quiet", ...args], {
      cwd: repositoryRoot,
      timeout: 900_000,
      env: environment,
    });

  // Two ways to make a backend unpreparable, neither of which touches the tree.
  // `--fork-checkout` at a path that does not exist takes out the Go backend
  // alone. A PATH with no `bun` on it takes out the JS backend's probe — and
  // `go` with it, which is why every assertion below names the backend the run
  // reported rather than trusting the exit code by itself.
  const noFork = ["--fork-checkout", join(tmpdir(), "smithers-conformance-no-such-fork-checkout")];
  const noTools = { PATH: join(tmpdir(), "smithers-conformance-empty-path") };
  const unprepared = (name) => new RegExp(`the ${name} backend was requested and could not be prepared`);

  await t.test("--backend both refuses a run whose fork could not be prepared", async () => {
    // The defect, executed. Before the fix this exited 0 with the reference
    // green and the fork never built.
    const both = await invoke(["--backend", "both", ...noFork]);
    assert.equal(both.status, 2, `expected exit 2, got ${both.status}\n${both.stdout}\n${both.stderr}`);
    assert.match(both.stderr, unprepared("go"));
  });

  await t.test("--backend go refuses it too", async () => {
    const go = await invoke(["--backend", "go", ...noFork]);
    assert.equal(go.status, 2, `expected exit 2, got ${go.status}\n${go.stdout}\n${go.stderr}`);
    assert.match(go.stderr, unprepared("go"));
  });

  await t.test("--backend js does not, because it never asked for the fork", async () => {
    // The over-correction guard. Enforcing availability for a backend the caller
    // did not request would make the reference gate unrunnable on any machine
    // without a fork checkout, which is precisely the escape hatch that makes
    // gating `both` affordable.
    const js = await invoke(["--backend", "js", ...noFork]);
    assert.equal(js.status, 0, `expected exit 0, got ${js.status}\n${js.stdout}\n${js.stderr}`);
    assert.match(js.stdout, /JS reference: {2}1\/1 pass/);
  });

  await t.test("an unpreparable reference refuses every mode that asks for it", async () => {
    for (const mode of ["js", "both"]) {
      const measured = await invoke(["--backend", mode], noTools);
      assert.equal(
        measured.status,
        2,
        `--backend ${mode} expected exit 2, got ${measured.status}\n${measured.stdout}\n${measured.stderr}`,
      );
      assert.match(measured.stderr, unprepared("js"));
    }
  });

  await t.test("the reason reaches stderr, not only the rendered table", async () => {
    // `--json` prints no table at all, so a reason carried only by `renderTable`
    // is a reason a machine-readable run does not get. The exit code says the
    // run is not a measurement; this says which backend and why.
    const jsonRun = await invoke(["--backend", "both", "--json", ...noFork]);
    assert.equal(jsonRun.status, 2, jsonRun.stderr);
    assert.match(jsonRun.stderr, unprepared("go"));
    assert.match(jsonRun.stderr, /pinned smithersai\/TypeScript checkout is absent/);
    const report = JSON.parse(jsonRun.stdout);
    assert.equal(report.backends.go.available, false);
    assert.equal(report.backends.js.available, true);
  });
});

/**
 * A diagnostic's FILE is part of the answer, and a position the harness could
 * not map is not an authored position.
 *
 * ## The defect
 *
 * `backend-js.mjs` deliberately records both — an emit-check diagnostic it could
 * not anchor keeps its generated position and says so with `mapped: false`, and
 * every observation carries the file the diagnostic landed in. `judge.mjs` then
 * threw both away: the canonicalizer kept `code`, `line`, `column`, `message`
 * and `messageContains` and dropped the rest, and both of its consumers compared
 * only code, line and column.
 *
 * Two executed consequences, neither of which any corpus case can see:
 *
 *   1. a diagnostic reported in the WRONG FILE satisfies an expectation whose
 *      coordinates it happens to share — a generated coordinate that merely
 *      coincides with an authored one certifies the rule;
 *   2. two backends diagnosing DIFFERENT FILES print as agreeing, because
 *      `compareObservations` rendered both sides through the same lossy
 *      canonicalizer.
 *
 * And a `mapped: false` position is a coordinate in emitted TypeScript that the
 * harness is comparing against a coordinate in authored Smithers. Satisfying an
 * expectation with one is the same class of defect as satisfying an `output`
 * case without running the emit check: the verdict rests on work that did not
 * happen, so it belongs to `auditVerdict` and exit 3 rather than to `fail` —
 * scoring it a divergence would blame a backend for the harness's own gap.
 *
 * ## Why this is not a corpus case
 *
 * The corpus is a differential over authored programs, and both halves are
 * properties of how the harness COMPARES two answers rather than of either
 * answer. Measured on 2026-08-28: across all 510 cases the reference produces
 * 470 diagnostics, of which exactly one is `mapped: false` (on an `xfail` row,
 * so no satisfied verdict rests on it today) and none lands outside its entry
 * file. Both defects are therefore latent, and a corpus that is entirely green
 * is exactly the state in which they stay invisible.
 */
test("a diagnostic's file and its mapping are part of the answer", async (t) => {
  const diagnostic = (overrides = {}) => ({
    code: "SMITHERS1802",
    line: 3,
    column: 38,
    message: "probe",
    file: "main.sm",
    mapped: true,
    ...overrides,
  });
  // JS-shaped: `lower` is the stage `jsBackend.requiredStages` demands behind a
  // satisfied `diagnostics` verdict, so these observations are audited for the
  // thing under test rather than tripping the stage audit first.
  const observed = (overrides = {}) => ({
    kind: "diagnostics",
    stage: "language",
    stages: ["lower"],
    diagnostics: [diagnostic(overrides)],
  });
  const declaring = (overrides = {}) => ({
    id: "probe",
    entry: "main.sm",
    expectation: {
      expect: "diagnostics",
      diagnostics: [{ code: "SMITHERS1802", line: 3, column: 38, ...overrides }],
    },
  });

  await t.test("a diagnostic in the entry still satisfies an expectation that names no file", () => {
    // The default, and the reason 510 cases keep their verdicts: an expectation
    // with no `file` means the entry, which is where every declared diagnostic
    // in the corpus lands today.
    assert.equal(judge(declaring(), observed(), "js").status, "pass");
  });

  await t.test("a diagnostic in the WRONG file does not", () => {
    const verdict = judge(declaring(), observed({ file: "wrong-module.mod.sm" }), "js");
    assert.equal(verdict.status, "fail", JSON.stringify(verdict));
    assert.match(verdict.detail, /wrong-module\.mod\.sm/);
    assert.match(verdict.detail, /main\.sm/);
  });

  await t.test("an expectation may name an auxiliary module, and then the entry does not satisfy it", () => {
    const inModule = declaring({ file: "companion.mod.sm" });
    assert.equal(judge(inModule, observed({ file: "companion.mod.sm" }), "js").status, "pass");
    assert.equal(judge(inModule, observed({ file: "main.sm" }), "js").status, "fail");
  });

  await t.test("two backends diagnosing different files do not agree", () => {
    assert.equal(compareObservations(observed(), observed({ file: "main.sm" })).agree, true);
    const divergent = compareObservations(observed(), observed({ file: "wrong-module.mod.sm", mapped: undefined }));
    assert.equal(divergent.agree, false, JSON.stringify(divergent));
    assert.match(divergent.detail, /wrong-module\.mod\.sm/);
  });

  await t.test("`mapped` is not compared across backends, because only one backend has it", () => {
    // The fork reports no mapping at all — it checks the authored `.sm`
    // directly, so it has nothing to map. Comparing the field would report a
    // divergence on every diagnostics case in the corpus. The FILE is the
    // substantive difference; the mapping is a claim about this harness.
    assert.equal(compareObservations(observed({ mapped: true }), observed({ mapped: undefined })).agree, true);
  });

  await t.test("a satisfied verdict resting on an unmapped position is a harness-integrity failure", () => {
    const unmapped = observed({ mapped: false });
    const verdict = judge(declaring(), unmapped, "js");
    assert.equal(verdict.status, "pass", "the coordinates still line up; that is exactly the danger");
    const violations = auditVerdict(declaring(), unmapped, verdict, jsBackend);
    assert.ok(
      violations.some((text) => text.includes("could not resolve")),
      `expected an unmapped-position violation, saw: ${JSON.stringify(violations)}`,
    );
  });

  await t.test("a mapped position, and an unsatisfied verdict, are not", () => {
    // Both over-correction guards. A `fail` is a statement about a backend and
    // is allowed to rest on whatever the backend said, and the ordinary mapped
    // case must stay silent or the audit fires on all 470 diagnostics.
    assert.deepEqual(auditVerdict(declaring(), observed(), judge(declaring(), observed(), "js"), jsBackend), []);
    const wrongFile = observed({ file: "wrong-module.mod.sm", mapped: false });
    assert.deepEqual(auditVerdict(declaring(), wrongFile, judge(declaring(), wrongFile, "js"), jsBackend), []);
  });

  await t.test("only a backend that reports mapping is audited for it", () => {
    // The fork's diagnostics carry no `mapped` field. Auditing `!== true` on
    // every backend would make every Go diagnostics pass a harness-integrity
    // failure, so the check is driven by a capability each backend declares —
    // and declaring it is what keeps the audit from going quiet if the JS
    // backend ever stops recording the field.
    assert.equal(jsBackend.reportsMapping, true);
    assert.notEqual(goBackend.reportsMapping, true);
    const fromTheFork = { ...observed({ mapped: undefined }), stage: "compile", stages: ["compile"] };
    assert.deepEqual(auditVerdict(declaring(), fromTheFork, { status: "pass" }, goBackend), []);
  });

  await t.test("a file the harness could not relate to the staged project is an integrity failure", () => {
    // The macOS staging-root defect, reproduced as an observation rather than
    // as an environment: `os.tmpdir()` yields `/var/folders/...` while the
    // compiler reports the realpath `/private/var/folders/...`, the two do not
    // relativize against each other, and every asset-stage diagnostic kept its
    // absolute path. Measured on the tree that had it: **12 divergent,
    // agreement 479/510**, all in `23-asset-imports` and none of them a
    // disagreement between the two compilers.
    //
    // The root is canonicalized now, but that is a property of one line. This
    // asserts the property that has to hold: a path the harness could not
    // relate is never SCORED. Exit 3 with the path in hand, not a divergence
    // somebody has to go and diagnose in a backend that is behaving correctly.
    const absolute = observed({ file: "/private/var/folders/qy/T/smithers-conformance-js-Ol9d79/main.sm" });
    const violations = auditVerdict(declaring(), absolute, judge(declaring(), absolute, "js"), jsBackend);
    assert.ok(
      violations.some((text) => text.includes("could not relate")),
      `expected an unrelatable-path violation, saw: ${JSON.stringify(violations)}`,
    );
    // And it fires whatever the verdict was, because an absolute path corrupts
    // the comparison in both directions — it manufactured twelve FAILs, and it
    // would equally have hidden a real one.
    assert.ok(
      auditVerdict(declaring(), absolute, { status: "fail" }, jsBackend).some((text) =>
        text.includes("could not relate"),
      ),
    );
  });

  await t.test("no corpus case produces one", () => {
    // The live measurement behind the paragraph above, kept as an assertion so
    // the staging root cannot quietly stop being canonical. Cheap: it reads the
    // corpus, not the backends.
    for (const testCase of loadCorpus({})) {
      for (const file of testCase.files) {
        assert.ok(
          !file.path.startsWith("/"),
          `${testCase.id} stages ${file.path}, which is not a project-relative path`,
        );
      }
    }
  });

  await t.test("every observation the JS backend produces carries a project-relative file", () => {
    // Measured, not assumed: the asset stage reported its diagnostics at the
    // ABSOLUTE path of a per-case `mkdtemp` staging directory, so 14 of the
    // corpus's 470 diagnostics carried a machine-specific path with a random
    // suffix. Nothing compared the field, so nothing noticed — and the moment it
    // is compared, an absolute path can never equal a declared one.
    const source = readFileSync(backendJsPath, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.match(source, /function stagedFile\(/);
    assert.match(source, /reportsMapping: true/);
  });

  await t.test("the corpus accepts a declared file and refuses one nothing stages", () => {
    const cases = loadCorpus({});
    // Every declared diagnostic that names a file must name a file the case
    // actually stages, or the expectation is unsatisfiable by construction and
    // would read as a backend divergence forever.
    for (const testCase of cases) {
      for (const item of testCase.expectation.diagnostics ?? []) {
        if (item.file === undefined) continue;
        assert.ok(
          testCase.files.some((file) => file.path === item.file),
          `${testCase.id}: declares ${item.code} in ${item.file}, which the case does not stage`,
        );
      }
    }
  });
});
