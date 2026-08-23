import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = async (mode: string, database: string): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> => {
  const child = Bun.spawn([
    process.execPath,
    join(import.meta.dir, "../../test/fixtures/durable-process-crash-runner.ts"),
    mode,
    database,
  ], {
    cwd: join(import.meta.dir, "../.."),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { PATH: process.env.PATH ?? "" },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
};

test("an abrupt coordinator process death after COMMIT replays without invoking the provider", async () => {
  if (process.platform === "win32") return;
  const directory = mkdtempSync(join(tmpdir(), "smithers-real-process-crash-"));
  try {
    const database = join(directory, "state.sqlite");
    const crashed = await run("crash-after-success", database);
    expect(crashed.exitCode).not.toBe(0);
    expect(crashed.stdout).toBe("");

    const resumed = await run("resume-with-poison-provider", database);
    expect(resumed.exitCode).toBe(0);
    expect(resumed.stderr).toBe("");
    expect(JSON.parse(resumed.stdout)).toEqual({
      result: { doubled: 8 },
      integrity: ["ok"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
