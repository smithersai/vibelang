import { CaseExecutor, Suite } from "@smthrs/evals";
import { Binding, Scorer } from "@smthrs/scorers";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectEntry, judge, wouldReject, hash, policyHash } from "../../scripts/spec-rule-judge.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const fixtures = join(here, "spec-rule-judge");
type Label = { name: string; revision: string; bad: boolean; focus: string | null; diffHash: string };
type Output = { rejected: boolean; status: string };
const cases: Array<Label> = JSON.parse(readFileSync(join(fixtures, "cases.json"), "utf8"));
const target = { name: "spec-rule-judge" };
const scorer = Scorer.make({
  id: "spec-rule-judge/classification", version: "1", name: "classification",
  score: ({ input, output }) => {
    const expected = input as Label;
    const actual = output as Output;
    return Effect.succeed({
      score: actual.rejected === expected.bad ? 1 : 0,
      meta: { expectedBad: expected.bad, ...(output as Record<string, unknown>) }
    });
  }
});
export const suite = Suite.make({
  name: "spec-rule-judge",
  // Each bad witness uses the complete original introducing diff. The three
  // option witnesses deliberately share OPUS-3's entry, with focus assertions.
  cases: cases.map((input) => ({ name: input.name, input })),
  bindings: [Binding.make({ scorer, appliesTo: target })],
  concurrency: 1
});
export const executor = CaseExecutor.make((c) => Effect.tryPromise(async () => {
  const started = Date.now();
  const label = c.input as Label;
  const input = collectEntry({
    repo, revision: label.revision,
    decisions: process.env.SPEC_RULE_JUDGE_DECISIONS
  });
  // Store the original diff, not a paraphrase of a review. Verify collection
  // against that fixture so changed jj rendering cannot silently change a case.
  const original = readFileSync(join(fixtures, c.name + ".diff"), "utf8");
  if (input.diff !== original) throw new Error("historical entry diff changed");
  if (hash(original) !== label.diffHash) throw new Error("fixture hash mismatch");
  const result = await judge(input, { cache: process.env.SPEC_RULE_JUDGE_CACHE ?? join(repo, ".cache/spec-rule-judge/eval") });
  // Fail-open is operationally successful but is NEVER a passing eval sample.
  if (result.status !== "judged") throw new Error("Luna verdict unavailable: eval is inconclusive");
  const rejected = wouldReject(result);
  const focus = label.focus;
  const detected = !focus || [...result.verdict.rules.filter((r) => r.authority === null),
    ...result.verdict.contradictions].some((r) => ((r.claim ?? "") + r.reason).includes(focus));
  const output = {
    rejected: rejected && detected, entryRejected: rejected, focusDetected: detected, status: result.status, key: result.key,
    policy: policyHash(), diffHash: result.diffHash, contextHash: result.contextHash,
    cacheHit: result.cacheHit, latencyMs: result.latencyMs, usage: result.usage,
    ruleCount: result.verdict.rules.length, contradictionCount: result.verdict.contradictions.length
  };
  console.error("rule-judge eval " + c.name + ": " + JSON.stringify(output));
  return { output, stepKey: hash({ policy: policyHash(), input, focus }), latencyMs: Date.now() - started, target };
}));
