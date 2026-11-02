#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { policyHash } from "../spec-rule-judge.mjs";

export function score(run, labels, expectedPolicy = policyHash()) {
  const byName = new Map(run.cases.map((c) => [c.case, c]));
  let tp = 0, fp = 0, tn = 0, fn = 0, inconclusive = 0, inputTokens = 0, outputTokens = 0, latencyMs = 0, paidCalls = 0;
  const distinct = new Map();
  const good = new Set();
  const citedGood = new Set();
  for (const label of labels) {
    const entry = byName.get(label.name);
    // CLI trial aggregation persists observations, not executor outputs.
    const observation = entry?.observations?.find((o) => o.kind === "score");
    const out = entry?.output ?? observation?.meta;
    if (!entry || entry.error || out?.status !== "judged" || out.policy !== expectedPolicy) { inconclusive++; continue; }
    const key = label.revision;
    const state = { bad: label.bad, rejected: out.rejected };
    if (!distinct.has(key)) distinct.set(key, state);
    if (!label.bad) {
      good.add(key);
      if (/VIP-\d+/.test(label.reason ?? "")) citedGood.add(key);
    }
    if (label.bad) out.rejected ? tp++ : fn++;
    else out.rejected ? fp++ : tn++;
    if (!out.cacheHit) {
      paidCalls++;
      inputTokens += out.usage?.input_tokens ?? 0; outputTokens += out.usage?.output_tokens ?? 0;
      latencyMs += out.latencyMs ?? 0;
    }
  }
  const unique = [...distinct.values()];
  const dTP = unique.filter((s) => s.bad && s.rejected).length;
  const dFP = unique.filter((s) => !s.bad && s.rejected).length;
  const dFN = unique.filter((s) => s.bad && !s.rejected).length;
  return {
    cases: labels.length, completed: tp + fp + tn + fn, inconclusive, tp, fp, tn, fn,
    precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null,
    goodAcceptance: tn + fp ? tn / (tn + fp) : null,
    distinct: { revisions: unique.length, goodRevisions: good.size, citedGoodRevisions: citedGood.size, tp: dTP, fp: dFP, fn: dFN,
      precision: dTP + dFP ? dTP / (dTP + dFP) : null, recall: dTP + dFN ? dTP / (dTP + dFN) : null },
    paidCalls, inputTokens, outputTokens, latencyMs,
    qualified: expectedPolicy === policyHash() && labels.length >= 22 && inconclusive === 0 && good.size >= 15 && citedGood.size >= 15 && fp === 0 && tp > 0
  };
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const run = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const cases = JSON.parse(readFileSync(new URL("../../.smithers/evals/spec-rule-judge/cases.json", import.meta.url), "utf8"));
  const result = score(run, cases);
  console.log(JSON.stringify({ runId: run.runId, policy: policyHash(), ...result }, null, 2));
  if (!result.qualified) process.exitCode = 1;
}
