import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

const script = new URL("./go-test-shards.sh", import.meta.url).pathname

// A stand-in test binary. -test.list prints NAMES; a run records its arguments under runs/, waits until BARRIER runs
// have started (so passing proves the processes overlap), prints each selected name and fails if TestFails ran.
const binary = `#!/bin/sh
for a in "$@"; do case $a in -test.list) printf '%s\\n' $NAMES; exit 0 ;; esac; done
me=$$
printf '%s\\n' "$@" > "$RUNS/$me"
run=
for a in "$@"; do case $a in -test.run=*) run=\${a#-test.run=} ;; esac; done
i=0
while [ "$(ls "$RUNS" | wc -l)" -lt "\${BARRIER:-1}" ]; do i=$((i + 1)); [ $i -gt 400 ] && { echo "no overlap"; exit 9; }; sleep 0.05; done
status=0
for n in $NAMES; do
  if [ -z "$run" ] || printf '%s\\n' "$n" | grep -Eq "$run"; then
    echo "ran $n"
    [ "$n" = TestFails ] && { echo "--- FAIL: TestFails (0.00s)"; status=1; }
  fi
done
exit $status
`

function setup(names, weights) {
  const dir = mkdtempSync(join(tmpdir(), "go-test-shards-"))
  mkdirSync(join(dir, "runs"))
  writeFileSync(join(dir, "pkg.test"), binary, { mode: 0o700 })
  if (weights) {
    mkdirSync(join(dir, "testdata"))
    writeFileSync(join(dir, "testdata", "shard-seconds.txt"), weights)
  }
  return {
    dir,
    run(args = [], env = {}) {
      const result = spawnSync("/bin/sh", [script, join(dir, "pkg.test"), "-test.timeout=40m0s", "-test.short=true", ...args], {
        cwd: dir,
        env: { ...process.env, NAMES: names.join(" "), RUNS: join(dir, "runs"), ...env },
        encoding: "utf8"
      })
      const runs = readdirSync(join(dir, "runs")).map((f) => readFileSync(join(dir, "runs", f), "utf8").trim().split("\n"))
      return { ...result, runs }
    },
    done: () => rmSync(dir, { recursive: true, force: true })
  }
}

const ran = (stdout) => stdout.split("\n").filter((l) => l.startsWith("ran ")).map((l) => l.slice(4)).sort()

test("every test, fuzz target and example runs once, across processes that run at once", () => {
  const names = ["TestA", "TestB", "TestC", "FuzzD", "FuzzE", "ExampleF", "BenchmarkG"]
  const t = setup(names)
  try {
    const r = t.run([], { GO_TEST_SHARDS: "3", BARRIER: "3" })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.deepEqual(ran(r.stdout), ["ExampleF", "FuzzD", "FuzzE", "TestA", "TestB", "TestC"])
    assert.equal(r.runs.length, 3)
    for (const args of r.runs) {
      assert.deepEqual(args.slice(0, 2), ["-test.timeout=40m0s", "-test.short=true"], "the go command's flags pass through")
      assert.match(args[2], /^-test\.run=\^\(.+\)\$$/)
    }
  } finally {
    t.done()
  }
})

test("the slowest names, by testdata/shard-seconds.txt, go to different processes", () => {
  const names = ["TestSlow", "FuzzSlower", "TestSlowest", "TestQuick1", "TestQuick2", "TestQuick3"]
  const t = setup(names, "# seconds name\n90 TestSlowest\n60 FuzzSlower\n50 TestSlow\n")
  try {
    const r = t.run([], { GO_TEST_SHARDS: "3", BARRIER: "3" })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const lists = r.runs.map((args) => args[2].slice("-test.run=^(".length, -")$".length).split("|"))
    const slow = ["TestSlowest", "FuzzSlower", "TestSlow"]
    assert.ok(lists.every((l) => slow.filter((s) => l.includes(s)).length === 1), JSON.stringify(lists))
  } finally {
    t.done()
  }
})

test("a failing process fails the run and every process's output is kept", () => {
  const t = setup(["TestA", "TestFails", "TestC", "TestD"])
  try {
    const r = t.run([], { GO_TEST_SHARDS: "2", BARRIER: "2" })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /--- FAIL: TestFails/)
    assert.deepEqual(ran(r.stdout), ["TestA", "TestC", "TestD", "TestFails"])
    assert.equal((r.stdout.match(/^go-test-shards: process \d+: \d+ tests, exit \d+, \d+s$/gm) || []).length, 2)
  } finally {
    t.done()
  }
})

for (const [why, args, env] of [
  ["a run that selects tests", ["-test.run=^TestB$"], {}],
  ["go test -json", ["-test.v=test2json"], {}],
  ["active fuzzing", ["-test.fuzz=FuzzD"], {}],
  ["GO_TEST_SHARDS=1", [], { GO_TEST_SHARDS: "1" }]
]) {
  test(why + " runs the binary unchanged, once", () => {
    const t = setup(["TestA", "TestB", "FuzzD"])
    try {
      const r = t.run(args, env)
      assert.equal(r.status, 0, r.stdout + r.stderr)
      assert.equal(r.runs.length, 1)
      assert.deepEqual(r.runs[0], ["-test.timeout=40m0s", "-test.short=true", ...args])
    } finally {
      t.done()
    }
  })
}

for (const [name, end] of [["go-vibelangfuzz", "\"spec-tests\":"], ["go-vibelang", "\"go-vibelang-race\":"]]) {
  test("//:" + name + " runs its binary through this script, and the script is a declared input", () => {
    const source = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
    const target = source.split("\"" + name + "\": goVibelang(")[1].split(end)[0]
    assert.match(target, /go test [^`"]*-exec "\$PWD\/\.\.\/\.\.\/scripts\/go-test-shards\.sh"/)
    assert.match(target, /S\.file\("\/\/scripts\/go-test-shards\.sh"\)/)
  })
}
