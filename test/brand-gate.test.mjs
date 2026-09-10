import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function gate(args) {
  return spawnSync(process.execPath, ["scripts/brand-gate.mjs", ...args], { encoding: "utf8" });
}

test("the repository carries only the VibeLang identity", () => {
  const result = gate([]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /brand-gate: ok/u);
});

test("the brand gate catches an old spelling, an old extension, and honours the allow marker", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-brand-gate-"));
  try {
    mkdirSync(join(root, "src"));
    // brand-gate: allow — this test writes the retired spellings on purpose.
    writeFileSync(join(root, "src", "a.vibe"), 'import { Context } from "smthrs/context"\n'); // brand-gate: allow
    writeFileSync(join(root, "src", "b.sm"), "export const x = 1\n"); // brand-gate: allow
    writeFileSync(join(root, "src", "c.vibe"), "// mentions the old name Smithers on purpose — brand-gate: allow\n"); // brand-gate: allow
    writeFileSync(join(root, "src", "d.md"), "The org is smithersai/vibelang, which is fine.\n");

    const result = gate(["--root", root]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/a\.vibe:1: smthrs/u); // brand-gate: allow
    assert.match(result.stderr, /src\/b\.sm: file uses the retired source extension \.sm/u); // brand-gate: allow
    assert.doesNotMatch(result.stderr, /src\/c\.vibe/u);
    assert.doesNotMatch(result.stderr, /src\/d\.md/u);
    assert.match(result.stderr, /Remedy: node scripts\/rename-to-vibelang\.mjs/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
