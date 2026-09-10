import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defineFunction } from "../poc/dist/agent/bindings.js";
import { DenoSubprocessSandbox } from "../poc/dist/agent/sandbox.js";

function sandbox(t, write) {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-runner-output-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const runnerPath = join(directory, "runner.js");
  // Exercise the actual pinned runner with a trusted host-side I/O fixture.
  // The generated module cannot replace the writer captured by the runner.
  writeFileSync(runnerPath, `
    const fixtureWrite = Deno.stdout.write.bind(Deno.stdout);
    let fixtureIndex = 0;
    Deno.stdout.write = async bytes => { ${write} };
  ` + readFileSync(new URL("../poc/dist/agent/deno-runner.js", import.meta.url), "utf8"));
  return new DenoSubprocessSandbox({ runnerPath, timeoutMs: 3000 });
}

const partial = "return fixtureWrite(bytes.subarray(0, [1, 2, 3, 5, 17][fixtureIndex++ % 5]));";

for (const [name, write] of [["full writes", "return fixtureWrite(bytes);"], ["partial writes", partial]]) {
  test(`sandbox ${name} preserve UTF-8, queued logs, RPC and the terminal result`, async (t) => {
    const runtime = sandbox(t, write);
    let calls = 0;
    const double = defineFunction("(input: number) => Promise<number>", (value) => {
      calls++;
      assert.equal(value, 21);
      return value * 2;
    }, "transport fixture", { implementationId: "transport/double", implementationVersion: "1" });
    const result = await runtime.execute(`export default async functions => {
      console.log("🐱", 1); console.warn("🦀", 2);
      return { text: "🐱🦀".repeat(512), answer: await functions.double(21) };
    }`, { double }, { sourceDigest: "runner-output-fixture", turnId: name });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.result, Object.assign(Object.create(null), { text: "🐱🦀".repeat(512), answer: 42 }));
    assert.deepEqual(result.logs, [{ level: "log", values: ["🐱", 1] }, { level: "warn", values: ["🦀", 2] }]);
    assert.equal(calls, 1);
  });
}

test("sandbox partial writes preserve a terminal failure instead of truncating it", async (t) => {
  const result = await sandbox(t, partial).execute('export default () => { throw new Error("failed 🦀") }', {},
    { sourceDigest: "runner-output-fixture", turnId: "failure" });
  assert.equal(result.ok, false);
  assert.equal(result.error?.name, "Error");
  assert.equal(result.error?.message, "failed 🦀");
});

for (const count of ["0", "-1", "0.5", "NaN", "Infinity", "bytes.length + 1"]) {
  test(`sandbox stdout refuses invalid write progress ${count} without spinning`, async (t) => {
    const result = await sandbox(t, `return ${count};`).execute("export default () => 42", {},
      { sourceDigest: "runner-output-fixture", turnId: count });
    assert.equal(result.ok, false);
    assert.equal(result.error?.name, "SandboxProtocolError");
    assert.match(result.stderr, /Invalid sandbox stdout write progress/);
  });
}
