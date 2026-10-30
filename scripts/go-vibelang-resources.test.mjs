import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const source = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
const target = source.split('"go-vibelang": goVibelang(')[1].split('"go-vibelang-race":')[0]
const shell = target.match(/\x60([^\x60]+)\x60/)[1].replace(/\$\{effect\}/g, "EFFECT_NODE_MODULES=unused")
const minutes = text => {
  const match = /^(\d+)m$/.exec(text)
  assert.ok(match, "expected a minute budget, got " + text)
  return Number(match[1])
}

// The complete native corpus took about 15 minutes alone; a busy shared host
// exhausted 25 minutes while runtime cases were still advancing. Keep enough
// time for a threefold slowdown, without extending individual case deadlines.
test("the native Go suite allows shared-host slowdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "go-vibelang-budget-"))
  try {
    const output = join(dir, "args")
    writeFileSync(join(dir, "go"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$GO_ARGS_OUTPUT"\n', { mode: 0o700 })
    const result = spawnSync("/bin/sh", ["-c", shell], {
      env: { ...process.env, PATH: dir + ":" + process.env.PATH, GO_ARGS_OUTPUT: output },
      encoding: "utf8"
    })
    assert.equal(result.status, 0, result.stderr)
    const args = readFileSync(output, "utf8").trim().split("\n")
    assert.equal(args[0], "test")
    const index = args.indexOf("-timeout")
    assert.ok(index >= 0, args.join(" "))
    assert.ok(minutes(args[index + 1]) >= 3 * 15, "native corpus needs at least three times its 15-minute isolated run")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("the outer Go target leaves time for admission and compilation", () => {
  const inner = minutes(shell.match(/-timeout (\d+m)/)[1])
  const explicit = target.match(/"(\d+m)"/)?.[1]
  const fallback = source.match(/timeout = "(\d+m)"/)[1]
  const outer = minutes(explicit || fallback)
  // A race-test run waited over 17 minutes before its nine-second test.
  assert.ok(outer >= inner + 20, "outer target needs 20 minutes beyond Go's own timeout")
})
