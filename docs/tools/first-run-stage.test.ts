import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { STAGE_MS, stage } from "./first-run-stage"

test("a stage that outruns its deadline is killed and names the signal and deadline", async () => {
  const started = Date.now()
  const result = await stage(["sleep", "5"], { cwd: import.meta.dir, timeout: 200 })
  expect(Date.now() - started).toBeLessThan(5_000)
  expect(result.exitCode).toBeNull()
  expect(result.signalCode).toBe("SIGKILL")
  expect(result.failure).toContain("killed by SIGKILL after 200 ms")
})

test("a stage that exits on its own reports its output and no failure", async () => {
  const ok = await stage(["sh", "-c", "echo out; echo err >&2"], { cwd: import.meta.dir })
  expect({ exitCode: ok.exitCode, signalCode: ok.signalCode, failure: ok.failure, stdout: ok.stdout, stderr: ok.stderr })
    .toEqual({ exitCode: 0, signalCode: null, failure: "", stdout: "out\n", stderr: "err\n" })
  const failed = await stage(["sh", "-c", "echo why >&2; exit 3"], { cwd: import.meta.dir })
  expect({ exitCode: failed.exitCode, signalCode: failed.signalCode, failure: failed.failure }).toEqual({ exitCode: 3, signalCode: null, failure: "why\n" })
})

test("the first-run check's deadline covers every stage it runs", () => {
  const source = readFileSync(resolve(import.meta.dir, "first-run.test.ts"), "utf8")
  const declared = Number(/const STAGES = (\d+)/.exec(source)?.[1])
  const calls = source.match(/await command\(/g)?.length
  expect(calls).toBe(declared)
  expect(source).toContain("}, STAGES * STAGE_MS)")
  expect(STAGE_MS).toBeGreaterThanOrEqual(30_000)
})

for (const exits of [false, true]) {
  test.skipIf(process.platform === "win32")("a deadline kills a pipe-holding descendant after its parent " + (exits ? "exits" : "waits"), async () => {
    const result = await stage(["sh", "-c", "sh -c 'sleep 1; echo escaped' & echo $!; " + (exits ? "exit 0" : "wait")], { cwd: import.meta.dir, timeout: 200 })
    expect(result.stdout).not.toContain("escaped")
    expect(result.failure).toContain("after 200 ms")
    const pid = Number(result.stdout.trim().split("\n")[0])
    expect(pid).toBeGreaterThan(1)
    let alive = true
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(pid, 0)
        if (process.platform === "linux" && readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1][0] === "Z") alive = false
      } catch { alive = false }
      if (!alive) break
      await Bun.sleep(10)
    }
    expect(alive).toBe(false)
  })
}
