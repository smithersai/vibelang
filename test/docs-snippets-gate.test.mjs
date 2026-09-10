import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Every code block the documentation labels as a complete file (```ts [name.vibe])
// must compile with the shipped compiler. See scripts/docs-snippets-gate.mjs for
// the convention. Keyed examples must reach `vibe plan`; a legacy body check
// cannot certify the new model. The complete gate gets a generous budget.
test("every documented complete .vibe program compiles as written", { timeout: 240_000 }, () => {
  const result = spawnSync(process.execPath, ["scripts/docs-snippets-gate.mjs", "--verbose"], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /docs-snippets-gate: ok \((\d+) documented programs compile as written\)/u);
  const count = Number(/ok \((\d+) documented/u.exec(result.stdout)[1]);
  assert.ok(count >= 2, `expected the docs to carry at least two checked programs, found ${count}`);
  const profiles = JSON.parse(/docs-snippets profiles: (.*)/u.exec(result.stdout)[1]);
  assert.ok(profiles.keyed >= 3, "current Plan success/fan-out/refusal examples must stay measured");
  assert.ok(profiles["legacy-body"] >= 1, "archiving the body example must not delete its compatibility coverage");
  assert.equal(Object.values(profiles).reduce((sum, value) => sum + value, 0), count);
});
