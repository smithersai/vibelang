import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { command } from "./check-snippets"
import { checkProperty } from "../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")

function running(pid: number) {
  try {
    process.kill(pid, 0)
    // A reparented child can await init's reap after it has stopped executing.
    return process.platform !== "linux" || readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1][0] !== "Z"
  } catch (error) {
    if (["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code!)) return false
    throw error
  }
}

test("snippet commands retain output, exit status, cwd and literal arguments", async () => {
  const result = await command(["bun", "-e", "console.log(process.cwd()); console.log(process.argv[1]); console.error('雪😀'); process.exit(7)", "a b;$HOME"], import.meta.dir, 10_000)
  expect(result).toEqual({ stdout: import.meta.dir + "\na b;$HOME\n", stderr: "雪😀\n", exitCode: 7, timedOut: false })
  expect(await command(["sh", "-c", "echo ok"], import.meta.dir, 10_000))
    .toEqual({ stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false })
})

test("a direct snippet process is killed at its deadline with its partial output retained", async () => {
  const result = await command(["sh", "-c", "echo started; echo err >&2; exec sleep 5"], import.meta.dir, 200)
  expect(result.timedOut).toBe(true)
  expect(result.exitCode).not.toBe(0)
  expect(result.stdout).toBe("started\n")
  expect(result.stderr).toBe("err\n")
})

test("one snippet timeout leaves another concurrent command running", async () => {
  const [killed, retained] = await Promise.all([
    command(["sh", "-c", "exec sleep 5"], import.meta.dir, 100),
    command(["sh", "-c", "sleep 0.4; echo independent"], import.meta.dir, 10_000)
  ])
  expect(killed.timedOut).toBe(true)
  expect(retained).toEqual({ stdout: "independent\n", stderr: "", exitCode: 0, timedOut: false })
})

async function descendant({ exits, stream, depth, noise }: { exits: boolean; stream: "stdout" | "stderr" | "both"; depth: number; noise: number }) {
  // Every witness terminates on its own on the old implementation, too: the
  // delayed marker proves escape without relying on a CI-speed assertion.
  let script = "sleep 1; echo ESCAPED >&" + (stream === "stderr" ? 2 : 1)
  for (let i = 0; i < depth; i++) script = "sh -c " + quote(script) + " & wait"
  script = "trap '' TERM; " + script
  const redirects = stream === "stdout" ? "2>/dev/null" : stream === "stderr" ? ">/dev/null" : ""
  const result = await command(["sh", "-c", "sh -c " + quote(script) + " " + redirects + " & echo $!; printf '%s' " + quote("雪😀".repeat(noise)) + " >&2; " + (exits ? "exit 0" : "wait")], import.meta.dir, 200)
  const pid = Number(result.stdout.split("\n")[0])
  try {
    expect(pid).toBeGreaterThan(1)
    expect(result.timedOut).toBe(true)
    expect(result.stdout + result.stderr).not.toContain("ESCAPED")
    expect(result.stderr).toBe("雪😀".repeat(noise))
    if (exits) expect(result.exitCode).toBe(0)
    else expect(result.exitCode).not.toBe(0)
    for (let attempt = 0; attempt < 100 && running(pid); attempt++) await Bun.sleep(10)
    expect(running(pid)).toBe(false)
  } finally {
    if (Number.isSafeInteger(pid) && pid > 1 && running(pid)) {
      try { process.kill(pid, "SIGKILL") }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
    }
  }
}

function quote(text: string) { return "'" + text.replaceAll("'", "'\\''") + "'" }

for (const exits of [false, true]) for (const stream of ["stdout", "stderr", "both"] as const) {
  test.skipIf(process.platform === "win32")("snippet deadline stops pipe holders: parent " + (exits ? "exits" : "waits") + ", " + stream, () => descendant({ exits, stream, depth: 1, noise: 10 }))
}

test.skipIf(process.platform === "win32")("snippet deadlines bound nested process trees across pipe ownership and output pressure", async () => {
  await checkProperty(fc, {
    name: "snippet-command-descendants",
    rule: "Runner invariant: a command deadline covers process exit and output draining; descendant-held stdout/stderr cannot outlive the owned POSIX process group at timeout.",
    command: "bun test docs/tools/snippet-command.test.ts",
    arbitrary: fc.record({ exits: fc.boolean(), stream: fc.constantFrom("stdout", "stderr", "both"), depth: fc.integer({ min: 0, max: 3 }), noise: fc.integer({ min: 0, max: 2048 }) }),
    numRuns: 24,
    regressions: new URL("./property-regressions/", import.meta.url),
    check: descendant
  })
}, 30_000)
