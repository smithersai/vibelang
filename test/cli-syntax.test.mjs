import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the shipped CLI preserves every retired-syntax corpus refusal and its complete cascade", () => {
  const corpus = new URL("../conformance/corpus/19-retired-syntax/", import.meta.url);
  let measured = 0;
  for (const name of readdirSync(corpus).sort()) {
    if (!name.endsWith(".expected.json")) continue;
    const expected = JSON.parse(readFileSync(new URL(name, corpus), "utf8"));
    if (expected.expect !== "diagnostics" || !expected.diagnostics.some(d => /^VIBE100[01]$/.test(d.code))) continue;
    const fileName = name.replace(/\.expected\.json$/, ".vibe");
    const result = spawnSync(process.execPath, ["bin/vibe.js", "check", fileURLToPath(new URL(fileName, corpus)), "--format", "json"], { encoding: "utf8" });
    assert.equal(result.status, 1, `${fileName}: ${result.stderr || result.stdout}`);
    const report = JSON.parse(result.stdout);
    const keys = diagnostics => diagnostics.map(d => `${d.code}@${d.line}:${d.column}`).sort();
    assert.deepEqual(keys(report.files.flatMap(f => f.diagnostics)), keys(expected.diagnostics), fileName);
    measured++;
  }
  assert.ok(measured >= 15, `expected substantive grammar coverage, measured ${measured}`);
});
