import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cases, appendCases } from "../compiler/testdata/keyed-plan-cases.mjs";

const oracle = JSON.parse(readFileSync(new URL("../compiler/testdata/keyed-plan-oracle.json", import.meta.url), "utf8"));
const json = (value) => JSON.parse(JSON.stringify(value));

test("keyed Plan fixture identity and case inventory remain pinned", () => {
  assert.equal(oracle.revision, "6bcbaa2d03a10afe8fe59934dabe262f55f012e7");
  assert.equal(oracle.effectVersion, "4.0.0-rc.112");
  assert.equal(oracle.records.length, 141);
  assert.deepEqual(oracle.records.map((item) => item.name), [...cases.map((item) => item.name), ...appendCases.map((item) => `append-${item.name}`)]);
  assert.equal(new Set(oracle.records.map((item) => item.name)).size, 141);
});

test("keyed Plan measurement inputs cannot drift from checked-in expectations", () => {
  for (const [index, fixture] of cases.entries()) {
    const recorded = oracle.records[index];
    assert.equal(recorded.operation, fixture.operation, fixture.name);
    assert.deepEqual(recorded.input, json(fixture.input), fixture.name);
  }
  for (const [index, fixture] of appendCases.entries()) {
    const recorded = oracle.records[cases.length + index];
    assert.equal(recorded.operation, "append");
    assert.deepEqual(recorded.input.nodes, json(fixture.nodes), fixture.name);
    assert.equal(recorded.input.plan.planId, fixture.base.planId);
    assert.equal(recorded.input.plan.flow, fixture.base.flow);
    assert.equal(recorded.input.plan.generation, 0);
    assert.equal(recorded.input.plan.nodes.length, fixture.base.nodes.length);
  }
});
