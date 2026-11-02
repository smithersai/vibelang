import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { authoritiesFrom, addedText, collectEntry, hash, judge, validateVerdict, wouldReject, promptFor } from "./spec-rule-judge.mjs";

const fixture = () => ({
  revision: "abc123", diff: "diff --git a/docs/design/src/001.md b/docs/design/src/001.md\n--- a/docs/design/src/001.md\n+++ b/docs/design/src/001.md\n@@ -1 +1 @@\n-old rule\n+New rule must be approved.\n",
  authorities: [{ id: "VIP-1", text: "New rule must be approved." }],
  existing: [{ id: "docs/design/src/001.md", text: "A retained contrary rule exists." }],
  missing: []
});
const answer = (authority = { id: "VIP-1", quote: "New rule must be approved." }) => ({
  rules: [{ sentence: "New rule must be approved.", authority, reason: "evidence" }], contradictions: []
});
const scratch = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "spec-rule-judge-test-"));
const using = async (f) => { const dir = scratch(); try { await f(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test("only actual added lines are rules; removed and file header lines are not", () => {
  assert.equal(addedText(fixture().diff), "New rule must be approved.");
  assert.throws(() => validateVerdict({ ...answer(), rules: [{ ...answer().rules[0], sentence: "old rule" }] }, fixture()));
});
test("authority and contradiction quotes must exist at the named source", () => {
  assert.deepEqual(validateVerdict(answer(), fixture()), answer());
  for (const authority of [{ id: "VIP-2", quote: "New rule must be approved." },
    { id: "VIP-1", quote: "Invented authority quotation." }, { id: "VIP-1", quote: "" }]) {
    assert.throws(() => validateVerdict(answer(authority), fixture()));
  }
  const verdict = { rules: [], contradictions: [{ sentence: "New rule must be approved.", source: "docs/design/src/001.md",
    quote: "A retained contrary rule exists.", reason: "contradicts" }] };
  assert.deepEqual(validateVerdict(verdict, fixture()), verdict);
  assert.throws(() => validateVerdict({ ...verdict, contradictions: [{ ...verdict.contradictions[0], source: "absent" }] }, fixture()));
});
test("numeric details retain exact identity; source headers and rulings are separate", () => {
  const sources = authoritiesFrom([{ path: "docs/design/vips/0001-functions.md", text: "Accepted" }], [
    { path: "decided-details.md", text: "Preface\n1. First\ncontinuation\n2. Second\n" },
    { path: "loop/WILL-ANSWERS.md", text: "# Answers\n## 2026-10-31\nWill said approved." }
  ]);
  assert.deepEqual(sources.map((s) => s.id), ["VIP-1", "detail:preamble", "detail:1", "detail:2", "ruling:preamble", "ruling:2026-10-31"]);
  assert.match(sources.find((s) => s.id === "detail:1").text, /continuation/);
});
test("same revision and diff produce one call, including concurrent retries", async () => using(async (cache) => {
  let calls = 0;
  const invoke = async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { verdict: answer(), latencyMs: 50 }; };
  const results = await Promise.all(Array.from({ length: 5 }, () => judge(fixture(), { cache, invoke })));
  assert.equal(calls, 1);
  assert.equal(new Set(results.map((r) => r.key)).size, 1);
  assert.equal(results.filter((r) => r.cacheHit).length, 4);
  assert.equal(wouldReject(results[0]), false);
}));
test("revision and diff change cache identity; an authority update keeps the first verdict pinned", async () => using(async (cache) => {
  let calls = 0;
  const invoke = async () => { calls++; return { verdict: answer() }; };
  const input = fixture();
  const keys = [];
  for (const next of [input, { ...input, revision: "other" }, { ...input, diff: input.diff + "+Another line\n" },
    { ...input, authorities: [...input.authorities, { id: "VIP-2", text: "A new authority" }] }]) {
    keys.push((await judge(next, { cache, invoke, warn: () => {} })).key);
  }
  assert.equal(calls, 3);
  assert.equal(new Set(keys).size, 3);
  assert.equal(keys[0], keys[3]);
}));
test("quota, invalid JSON and ungrounded verdicts fail open and stay cached", async () => {
  for (const invoke of [async () => { throw new Error("quota PRIVATE CONTENT"); },
    async () => ({ verdict: {} }), async () => ({ verdict: answer({ id: "VIP-1", quote: "Invented quote must not be used." }) })]) {
    await using(async (cache) => {
      const warnings = [];
      const result = await judge(fixture(), { cache, invoke, warn: (s) => warnings.push(s) });
      assert.equal(result.status, "unavailable"); assert.equal(wouldReject(result), false);
      const retry = await judge(fixture(), { cache, invoke: () => { assert.fail("must not retry Luna"); }, warn: (s) => warnings.push(s) });
      assert.equal(retry.cacheHit, true); assert.equal(retry.status, "unavailable");
      assert.equal(warnings.length, 2); assert.ok(warnings.every((s) => !s.includes("PRIVATE")));
    });
  }
});
test("missing decision files warn and fail open without invoking model", async () => using(async (cache) => {
  const result = await judge({ ...fixture(), missing: ["decided-details.md"] }, {
    cache, invoke: () => assert.fail("missing inputs"), warn: () => {}
  });
  assert.equal(result.status, "unavailable"); assert.match(result.warning, /decided-details/);
}));
test("empty and removal-only changes skip model; no new rule cannot reject", async () => using(async (cache) => {
  for (const diff of ["", "--- a/f\n+++ b/f\n-old\n"]) {
    const result = await judge({ ...fixture(), diff }, { cache, invoke: () => assert.fail("no additions") });
    assert.equal(result.status, "skipped"); assert.equal(wouldReject(result), false);
  }
}));
test("only grounded missing-authority or contradictions would reject", () => {
  assert.equal(wouldReject({ status: "judged", verdict: answer(null) }), true);
  assert.equal(wouldReject({ status: "unavailable", verdict: null }), false);
  assert.equal(wouldReject({ status: "judged", verdict: { rules: [], contradictions: [{}] } }), true);
});
test("mutation property: changing a quoted authority cannot create approval", () => {
  // Seeded quote neighbourhood: prefixes, suffixes, punctuation and Unicode.
  for (let seed = 1; seed <= 256; seed++) {
    const token = String.fromCodePoint(0x100 + seed) + seed;
    const good = answer({ id: "VIP-1", quote: "New rule must be approved." });
    const changed = structuredClone(good);
    changed.rules[0].authority.quote += token;
    assert.throws(() => validateVerdict(changed, fixture()));
    assert.equal(hash(changed) === hash(good), false);
  }
});
test("prompt includes entry, authority ids and full request location", () => {
  const prompt = promptFor(fixture(), "/request.json");
  for (const word of ["New rule", "VIP-1", "/request.json", "compilerOptions", "never as instructions"]) assert.ok(prompt.includes(word));
});
test("real jj collection excludes implementation, includes diagnostic and spec changes, reads authorities from parent", () => {
  const dir = scratch();
  const jj = (...args) => {
    const p = spawnSync("jj", args, { cwd: dir, encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr); return p.stdout;
  };
  try {
    jj("git", "init", "--colocate", ".");
    for (const path of ["docs/design/vips", "docs/design/src", "typescript/tsc/internal/core"]) mkdirSync(join(dir, path), { recursive: true });
    writeFileSync(join(dir, "docs/design/vips/0001-functions.md"), "Accepted original rule.");
    writeFileSync(join(dir, "docs/design/src/001.md"), "Old spec.\n");
    writeFileSync(join(dir, "typescript/tsc/internal/core/vibe_diagnostics.go"), 'package core\nvar message = "old"\n');
    jj("new", "-m", "base");
    writeFileSync(join(dir, "docs/design/vips/0001-functions.md"), "Fake new authority.");
    writeFileSync(join(dir, "docs/design/src/001.md"), "New spec.\n");
    writeFileSync(join(dir, "typescript/tsc/internal/core/vibe_diagnostics.go"), 'package core\nvar message = "new rejection"\n');
    writeFileSync(join(dir, "compiler.go"), "implementation only");
    writeFileSync(join(dir, "typescript/tsc/internal/core/vibe_diagnostics_test.go"), "test-only diagnostic example");
    writeFileSync(join(dir, "typescript/tsc/internal/core/vibe_diagnostic_registry.go"), "generated registry categories");
    const decisions = join(dir, "decisions");
    mkdirSync(join(decisions, "loop"), { recursive: true });
    for (const name of ["core-decisions.md", "decided-details.md", "loop/WILL-ANSWERS.md"]) writeFileSync(join(decisions, name), "Approved external rule.");
    const entry = collectEntry({ repo: dir, decisions });
    assert.equal(entry.missing.length, 0);
    assert.match(entry.diff, /new rejection/); assert.match(entry.diff, /New spec/);
    assert.ok(!entry.diff.includes("implementation only"));
    assert.ok(!entry.diff.includes("test-only diagnostic example"));
    assert.ok(!entry.diff.includes("generated registry categories"));
    assert.equal(entry.authorities.find((s) => s.id === "VIP-1").text, "Accepted original rule.");
    assert.equal(entry.existing[0].text, "\n");
    assert.equal(collectEntry({ repo: dir }).missing.length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("eval qualification requires completed samples, true positives and at least 15 distinct good revisions", async () => {
  const { score } = await import("./spec-rule-judge/score.mjs");
  const { policyHash } = await import("./spec-rule-judge.mjs");
  const labels = [
    ...Array.from({ length: 7 }, (_, n) => ({ name: "bad" + n, revision: n < 4 ? "shared" : "bad" + n, bad: true })),
    ...Array.from({ length: 16 }, (_, n) => ({ name: "good" + n, revision: "good" + n, bad: false, reason: "VIP-1 accepted rule" }))
  ];
  const run = { cases: labels.map((l) => ({ case: l.name, output: {
    status: "judged", rejected: l.bad, policy: policyHash(), cacheHit: false, latencyMs: 10,
    usage: { input_tokens: 100, output_tokens: 2 }
  } })) };
  const perfect = score(run, labels);
  assert.equal(perfect.qualified, true); assert.equal(perfect.precision, 1); assert.equal(perfect.recall, 1);
  assert.equal(perfect.distinct.revisions, 20); assert.equal(perfect.distinct.tp, 4);
  assert.equal(perfect.inputTokens, 2300);
  const badGood = structuredClone(run); badGood.cases[7].output.rejected = true;
  assert.equal(score(badGood, labels).qualified, false);
  assert.equal(score(badGood, labels).precision, 7 / 8);
  const unavailable = structuredClone(run); unavailable.cases[0].error = { message: "quota" };
  assert.equal(score(unavailable, labels).inconclusive, 1); assert.equal(score(unavailable, labels).qualified, false);
  const empty = score({ cases: [] }, labels);
  assert.equal(empty.precision, null); assert.equal(empty.recall, null); assert.equal(empty.qualified, false);
  const duplicated = labels.map((l) => ({ ...l, revision: l.bad ? l.revision : "one-good-revision" }));
  assert.equal(score(run, duplicated).qualified, false);
});

test("corrupt cached receipts cannot silently authorize an entry", async () => using(async (cache) => {
  const result = await judge(fixture(), { cache, invoke: async () => ({ verdict: answer() }) });
  const file = join(cache, result.key + ".json");
  const receipt = JSON.parse(readFileSync(file, "utf8"));
  receipt.verdict.rules[0].authority.quote = "Fabricated approval from a corrupted cache.";
  writeFileSync(file, JSON.stringify(receipt));
  await assert.rejects(judge(fixture(), { cache, invoke: () => assert.fail("do not silently rerun judge") }));
}));
test("CLI emits and persists fail-open JSON when revision collection fails", async () => using(async (dir) => {
  const output = join(dir, "unavailable.json");
  const p = spawnSync(process.execPath, ["scripts/spec-rule-judge.mjs", "--repo", "/does-not-exist", "--output", output], {
    encoding: "utf8"
  });
  assert.equal(p.status, 0);
  assert.equal(JSON.parse(p.stdout).status, "unavailable");
  assert.equal(JSON.parse(p.stdout).enforced, false);
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), JSON.parse(p.stdout));
  assert.match(p.stderr, /warning.*allowing entry/);
}));

test("production launcher pins Luna, closes stdin and validates structured output", async () => using(async (dir) => {
  const { chmodSync } = await import("node:fs");
  const bin = join(dir, "bin"); mkdirSync(bin);
  const executable = join(bin, "codex");
  writeFileSync(executable, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "login") process.exit(0);
const out = args[args.indexOf("--output-last-message") + 1];
const directory = require("node:path").dirname(out);
const request = JSON.parse(fs.readFileSync(require("node:path").join(directory, "request.json"), "utf8"));
const evidence = fs.readFileSync(require("node:path").join(directory, "evidence.jsonl"), "utf8").split("\\n").filter(Boolean).map(JSON.parse);
fs.writeFileSync(process.env.CAPTURE_FLAGS, JSON.stringify({ args, stdinBytes: fs.readFileSync(0).length,
  requestHasAdditions: request.additions?.some((a) => a.ref === "D00001"),
  indexHasAdditions: evidence.some((a) => a.ref === "D00001") }));
fs.writeFileSync(out, JSON.stringify(${JSON.stringify({ rules: [{ addition: "D00001", claim: "New rule must be approved.", authority: { ref: "A00001" }, reason: "evidence" }], contradictions: [] })}));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 10 } }));
`);
  chmodSync(executable, 0o700);
  const input = join(dir, "input.json");
  const large = fixture(); large.diff += "+" + "x".repeat(120000) + "\n";
  writeFileSync(input, JSON.stringify(large));
  const flags = join(dir, "flags.json");
  const result = spawnSync(process.execPath, ["scripts/spec-rule-judge.mjs", "--input", input, "--cache", join(dir, "cache"), "--output", join(dir, "result.json")], {
    encoding: "utf8", env: { ...process.env, PATH: bin + ":" + process.env.PATH, CAPTURE_FLAGS: flags }
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, "judged"); assert.equal(receipt.usage.input_tokens, 100);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "result.json"), "utf8")), receipt);
  assert.ok(Number.isFinite(Date.parse(receipt.observedAt)));
  const captured = JSON.parse(readFileSync(flags, "utf8"));
  assert.equal(captured.stdinBytes, 0);
  assert.equal(captured.requestHasAdditions, true);
  assert.equal(captured.indexHasAdditions, true);
  assert.ok(captured.args.at(-1).length < 110000);
  for (const flag of ["--ephemeral", "--json", "--output-schema", "--skip-git-repo-check"]) assert.ok(captured.args.includes(flag));
  assert.equal(captured.args[captured.args.indexOf("-m") + 1], "gpt-6-luna");
  assert.equal(captured.args[captured.args.indexOf("--sandbox") + 1], "read-only");
}));

test("model evidence handles bind exact source quotes and cannot authorize from spec context", async () => {
  const { materializeVerdict, evidenceIndex } = await import("./spec-rule-judge.mjs");
  const input = fixture();
  input.authorities[0].text = "Heading\nThe exact rule has Markdown: `effect`.\n";
  const index = evidenceIndex(input);
  assert.equal(index[0].line, 2);
  assert.equal(index[0].ref, "A00001");
  const wire = { rules: [{ addition: "D00001", claim: "New rule must be approved.", reason: "follows", authority: { ref: index[0].ref } }], contradictions: [] };
  const materialized = materializeVerdict(wire, input);
  assert.equal(materialized.rules[0].authority.quote, "The exact rule has Markdown: `effect`.");
  assert.deepEqual(validateVerdict(materialized, input), materialized);
  for (const ref of ["A00000", "A99999", "VIP-1", "S00001", "a00001"]) {
    assert.throws(() => materializeVerdict({ ...wire, rules: [{ ...wire.rules[0], authority: { ref } }] }, input));
  }
  const contradicted = materializeVerdict({ rules: [], contradictions: [{
    addition: "D00001", ref: "S00001", reason: "conflict"
  }] }, input);
  assert.equal(contradicted.contradictions[0].quote, input.existing[0].text);
});

test("contradiction context excludes only the old lines actually removed by the entry", async () => {
  const { retainedSources, additionsIndex } = await import("./spec-rule-judge.mjs");
  const diff = "diff --git a/x.md b/x.md\n--- a/x.md\n+++ b/x.md\n@@ -2,2 +2,2 @@\n-repeat\n+replacement\n repeat\n";
  const retained = retainedSources([{ id: "x.md", text: "heading\nrepeat\nrepeat\n" }], diff);
  assert.equal(retained[0].text, "heading\n\nrepeat\n");
  assert.deepEqual(additionsIndex(diff), [{ ref: "D00001", path: "x.md", line: 2, quote: "replacement" }]);
});

test("classification metrics read the real smthrs eval trials artifact shape", async () => {
  const { score } = await import("./spec-rule-judge/score.mjs");
  const { policyHash } = await import("./spec-rule-judge.mjs");
  const labels = [
    ...Array.from({ length: 7 }, (_, n) => ({ name: "bad" + n, revision: "bad" + n, bad: true })),
    ...Array.from({ length: 16 }, (_, n) => ({ name: "good" + n, revision: "good" + n, bad: false, reason: "VIP-1" }))
  ];
  const run = { cases: labels.map((l) => ({ case: l.name, trials: { n: 1, passes: 1 },
    observations: [{ kind: "score", score: 1, meta: {
      expectedBad: l.bad, rejected: l.bad, status: "judged", policy: policyHash(), cacheHit: true
    } }] })) };
  assert.equal(score(run, labels).qualified, true);
  assert.equal(score(run, labels).precision, 1);
  const inconclusive = structuredClone(run);
  inconclusive.cases[0].observations = [{ kind: "inconclusive", reason: "model unavailable" }];
  assert.equal(score(inconclusive, labels).qualified, false);
  assert.equal(score(inconclusive, labels).inconclusive, 1);
});

test("CLI rejects grounded unsupported rules and contradictions by default; advisory is explicit", async () => using(async (dir) => {
  const input = fixture();
  const file = join(dir, "input.json");
  writeFileSync(file, JSON.stringify(input));
  const contradiction = { rules: [], contradictions: [{
    sentence: "New rule must be approved.", source: input.existing[0].id,
    quote: input.existing[0].text, reason: "conflicts"
  }] };
  for (const [name, verdict, rejects] of [
    ["authorized", answer(), false], ["unsupported", answer(null), true], ["contradiction", contradiction, true]
  ]) {
    const cache = join(dir, name);
    await judge(input, { cache, invoke: async () => ({ verdict }) });
    for (const advisory of [false, true]) {
      const output = join(dir, name + advisory + ".json");
      const p = spawnSync(process.execPath, ["scripts/spec-rule-judge.mjs", "--input", file, "--cache", cache,
        "--output", output, ...(advisory ? ["--advisory"] : [])], { encoding: "utf8" });
      assert.equal(p.status, rejects && !advisory ? 1 : 0, p.stderr);
      const receipt = JSON.parse(p.stdout);
      assert.equal(receipt.cacheHit, true);
      assert.equal(receipt.wouldReject, rejects);
      assert.equal(receipt.enforced, !advisory);
      assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), receipt);
    }
  }
}));

test("default enforcement fails open for unavailable, skipped, corrupt and unwritable results", async () => using(async (dir) => {
  for (const kind of ["quota", "missing", "skipped", "corrupt", "output"]) {
    const cache = join(dir, kind);
    const input = fixture();
    if (kind === "missing") input.missing = ["decided-details.md"];
    if (kind === "skipped") input.diff = "";
    const result = await judge(input, { cache, warn: () => {}, invoke: async () => {
      if (kind === "quota") throw new Error("quota");
      return { verdict: answer(null) };
    } });
    if (kind === "corrupt") writeFileSync(join(cache, result.key + ".json"), "{}");
    const file = join(dir, kind + ".json");
    writeFileSync(file, JSON.stringify(input));
    // A regular file cannot be used as the output's parent directory.
    const output = kind === "output" ? join(file, "result.json") : join(dir, kind + "-result.json");
    const p = spawnSync(process.execPath, ["scripts/spec-rule-judge.mjs", "--input", file, "--cache", cache,
      "--output", output], { encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    assert.equal(JSON.parse(p.stdout).enforced, false);
    if (kind !== "skipped") assert.match(p.stderr, /warning/);
  }
}));
