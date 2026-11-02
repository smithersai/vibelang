import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { setTimeout } from "node:timers/promises"
import test from "node:test"

const script = new URL("./go-test-shards.sh", import.meta.url).pathname

// A stand-in test binary. -test.list prints NAMES; a run records its arguments under runs/, waits until BARRIER runs
// have started (so passing proves the processes overlap), prints each selected name and fails if TestFails ran.
const binary = `#!/bin/sh
for a in "$@"; do case $a in -test.list) printf '%s\\n' "$@" > "$RUNS/../listed-args"; printf '%s\\n' $NAMES; exit 0 ;; esac; done
me=$$
printf '%s\\n' "$@" > "$RUNS/$me"
run=
for a in "$@"; do case $a in -test.run=*) run=\${a#-test.run=} ;; esac; done
i=0
while [ "$(ls "$RUNS" | wc -l)" -lt "\${BARRIER:-1}" ]; do i=$((i + 1)); [ $i -gt 400 ] && { echo "no overlap"; exit 9; }; sleep 0.05; done
profile=
while [ "$#" -gt 0 ]; do
  case $1 in
    -test.coverprofile|-test.cpuprofile|-test.memprofile|-test.blockprofile|-test.mutexprofile|-test.trace) shift; profile=$1 ;;
    -test.coverprofile=*|-test.cpuprofile=*|-test.memprofile=*|-test.blockprofile=*|-test.mutexprofile=*|-test.trace=*) profile=$(printf '%s' "$1" | cut -d= -f2-) ;;
  esac
  shift
done
selected=
status=0
for n in $NAMES; do
  if [ -z "$run" ] || printf '%s\\n' "$n" | grep -Eq "$run"; then
    selected="$selected$n\\n"
    echo "ran $n"
    [ "$n" = TestFails ] && { echo "--- FAIL: TestFails (0.00s)"; status=1; }
  fi
done
[ -z "$profile" ] || printf '%b' "$selected" > "$profile"
exit $status
`

function setup(names, weights) {
  const dir = mkdtempSync(join(tmpdir(), "go-test-shards-"))
  mkdirSync(join(dir, "runs"))
  writeFileSync(join(dir, "pkg.test"), binary, { mode: 0o700 })
  // A copy, so a box's scripts/go-test-slice beside the real script slices nothing here (//:release ran these tests
  // in a box running one slice, and every unsliced case failed).
  writeFileSync(join(dir, "go-test-shards.sh"), readFileSync(script, "utf8"), { mode: 0o700 })
  if (weights) {
    mkdirSync(join(dir, "testdata"))
    writeFileSync(join(dir, "testdata", "shard-seconds.txt"), weights)
  }
  return {
    dir,
    run(args = [], env = {}) {
      const result = spawnSync("/bin/sh", [join(dir, "go-test-shards.sh"), join(dir, "pkg.test"), "-test.timeout=40m0s", "-test.short=true", ...args], {
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

test("GO_TEST_SLICE=i/n: n runs run every name exactly once between them, slowest names in different slices", () => {
  const names = ["TestSlowest", "FuzzSlower", "TestSlow", "TestA", "TestB", "TestC", "ExampleD"]
  const t = setup(names, "90 TestSlowest\n60 FuzzSlower\n50 TestSlow\n")
  try {
    const slices = ["1/3", "2/3", "3/3"].map((slice) => {
      const r = t.run([], { GO_TEST_SHARDS: "2", GO_TEST_SLICE: slice })
      assert.equal(r.status, 0, r.stdout + r.stderr)
      rmSync(join(t.dir, "runs"), { recursive: true, force: true })
      mkdirSync(join(t.dir, "runs"))
      return ran(r.stdout)
    })
    assert.deepEqual(slices.flat().sort(), [...names].sort())
    const slow = ["TestSlowest", "FuzzSlower", "TestSlow"]
    assert.ok(slices.every((s) => slow.filter((n) => s.includes(n)).length === 1), JSON.stringify(slices))
  } finally {
    t.done()
  }
})

test("GO_TEST_SLICE with GO_TEST_SHARDS=1 still runs only its slice, in one process", () => {
  const t = setup(["TestA", "TestB"])
  try {
    const r = t.run([], { GO_TEST_SHARDS: "1", GO_TEST_SLICE: "2/2" })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    assert.equal(r.runs.length, 1)
    assert.equal(ran(r.stdout).length, 1)
  } finally {
    t.done()
  }
})

test("a package with no tests runs whole in slice 1 and not at all in the others", () => {
  const t = setup([])
  try {
    const first = t.run([], { GO_TEST_SLICE: "1/2" })
    assert.equal(first.status, 0, first.stdout + first.stderr)
    assert.equal(first.runs.length, 1)
    assert.deepEqual(first.runs[0], ["-test.timeout=40m0s", "-test.short=true"])
    rmSync(join(t.dir, "runs"), { recursive: true, force: true })
    mkdirSync(join(t.dir, "runs"))
    const second = t.run([], { GO_TEST_SLICE: "2/2" })
    assert.equal(second.status, 0, second.stdout + second.stderr)
    assert.equal(second.runs.length, 0)
    assert.match(second.stdout, /^PASS$/m)
  } finally {
    t.done()
  }
})

test("scripts/go-test-slice slices on the host it names and nowhere else; GO_TEST_SLICE wins", () => {
  // smthrs passes a target only its declared environment, so a graph run reads the slice from this file.
  const names = ["TestA", "TestB", "TestC", "TestD"]
  const t = setup(names)
  const dir = mkdtempSync(join(tmpdir(), "go-test-slice-"))
  const copy = join(dir, "go-test-shards.sh")
  writeFileSync(copy, readFileSync(script, "utf8"), { mode: 0o700 })
  const host = spawnSync("uname", ["-n"], { encoding: "utf8" }).stdout.trim()
  const run = (env = {}) => {
    rmSync(join(t.dir, "runs"), { recursive: true, force: true })
    mkdirSync(join(t.dir, "runs"))
    const r = spawnSync("/bin/sh", [copy, join(t.dir, "pkg.test")], {
      cwd: t.dir,
      env: { ...process.env, NAMES: names.join(" "), RUNS: join(t.dir, "runs"), GO_TEST_SHARDS: "2", ...env },
      encoding: "utf8"
    })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    return r
  }
  try {
    writeFileSync(join(dir, "go-test-slice"), "1/2 " + host + "\n")
    const first = ran(run().stdout)
    writeFileSync(join(dir, "go-test-slice"), "2/2 " + host + "\n")
    const second = ran(run().stdout)
    assert.equal(first.length, 2)
    assert.deepEqual([...first, ...second].sort(), names)
    assert.deepEqual(ran(run({ GO_TEST_SLICE: "1/2" }).stdout), first, "GO_TEST_SLICE wins over the file")
    writeFileSync(join(dir, "go-test-slice"), "1/2 some-other-host\n")
    const elsewhere = run()
    assert.deepEqual(ran(elsewhere.stdout), names, "a slice file from another host slices nothing")
    assert.match(elsewhere.stderr, /ignoring .*go-test-slice: it names host some-other-host/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    t.done()
  }
})

test("scripts/go-test-slice is git-ignored, so no commit can carry it", () => {
  const root = new URL("..", import.meta.url).pathname
  const ignore = readFileSync(join(root, ".gitignore"), "utf8").split("\n")
  assert.ok(ignore.includes("/scripts/go-test-slice"), "add /scripts/go-test-slice to .gitignore")
})

for (const slice of ["0/2", "3/2", "a/2", "1/", "/2", "1/2/3", "2"]) {
  test("GO_TEST_SLICE=" + slice + " is refused before any test runs", () => {
    const t = setup(["TestA"])
    try {
      const r = t.run([], { GO_TEST_SLICE: slice })
      assert.equal(r.status, 2, r.stdout + r.stderr)
      assert.equal(r.runs.length, 0)
    } finally {
      t.done()
    }
  })
}

for (const [why, args, env] of [
  ["a run that selects tests", ["-test.run=^TestB$"], {}],
  ["go test -json", ["-test.v=test2json"], {}],
  ["a benchmark selection", ["-test.bench=BenchmarkE", "-test.benchtime=1x"], {}],
  ["a separated benchmark selection", ["-test.bench", "BenchmarkE"], {}],
  ["an empty benchmark selection", ["-test.bench=^$"], {}],
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

for (const args of [
  [],
  ["-suite-mode=fixture with spaces"],
  ["-test.short=false", "-test.parallel=2", "-test.count=3"],
]) {
  test("test discovery retains the complete original flags: " + JSON.stringify(args), () => {
    const t = setup(["TestA", "TestB", "TestC"])
    try {
      const r = t.run(args, { GO_TEST_SHARDS: "3", BARRIER: "3" })
      assert.equal(r.status, 0, r.stdout + r.stderr)
      assert.equal(r.runs.length, 3)
      assert.deepEqual(ran(r.stdout), ["TestA", "TestB", "TestC"])
      const listed = readFileSync(join(t.dir, "listed-args"), "utf8").trim().split("\n")
      assert.deepEqual(listed, ["-test.timeout=40m0s", "-test.short=true", ...args, "-test.list", ".*"])
      for (const argv of r.runs) assert.deepEqual(argv.slice(0, 2 + args.length), ["-test.timeout=40m0s", "-test.short=true", ...args])
    } finally {
      t.done()
    }
  })
}

for (const phase of ["listing", "running"]) for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  test(signal + " while " + phase + " reaps every active test binary before returning", { timeout: 20_000 }, async t => {
    const dir = mkdtempSync(join(tmpdir(), "go-test-shards-cancel-"))
    const fixture = join(dir, "worker.mjs")
    const runs = join(dir, "runs")
    mkdirSync(runs)
    writeFileSync(fixture, `#!/usr/bin/env node
import { writeFileSync } from "node:fs"
if (process.argv.includes("-test.list") && !process.env.BLOCK_LIST) {
  console.log("TestA\\nTestB")
  process.exit(0)
}
const path = process.env.RUNS + "/" + process.pid
process.on("SIGTERM", () => {
  writeFileSync(path + ".stopped", "")
  process.exit(0)
})
writeFileSync(path, "")
setInterval(() => {}, 1000)
`, { mode: 0o700 })
    const child = spawn("/bin/sh", [script, fixture], {
      cwd: dir, detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GO_TEST_SHARDS: "2", RUNS: runs, TMPDIR: dir, BLOCK_LIST: phase === "listing" ? "1" : "" },
      timeout: 15_000, killSignal: "SIGKILL",
    })
    let output = ""
    child.stdout.on("data", chunk => { output += chunk })
    child.stderr.on("data", chunk => { output += chunk })
    const exited = once(child, "exit")
    t.after(() => {
      // On the unfixed script the workers survive their launcher. Always clean
      // this fixture's entire process group, including when an assertion fails.
      try { process.kill(-child.pid, "SIGKILL") } catch (error) {
        if (error.code !== "ESRCH") throw error
      }
      rmSync(dir, { recursive: true, force: true })
    })
    const count = phase === "listing" ? 1 : 2
    const deadline = Date.now() + 10_000
    while (readdirSync(runs).length < count && Date.now() < deadline && child.exitCode === null) {
      await setTimeout(10)
    }
    const pids = readdirSync(runs).filter(name => /^\d+$/.test(name))
    assert.equal(pids.length, count, "test binaries must start: " + output)
    child.kill(signal)
    const [code, killedBy] = await exited
    assert.equal(killedBy, null, output)
    assert.equal(code, 143, output)
    assert.deepEqual(readdirSync(dir).filter(name => name.startsWith("go-test-shards.")), [], "cancellation must remove temporary shard output")
    for (const pid of pids) {
      assert.ok(readdirSync(runs).includes(pid + ".stopped"), "test binary " + pid + " did not receive cancellation")
      assert.throws(() => process.kill(Number(pid), 0), { code: "ESRCH" }, "test binary " + pid + " was not reaped")
    }
  })
}

for (const flag of ["coverprofile", "cpuprofile", "memprofile", "blockprofile", "mutexprofile", "trace"]) {
  for (const split of [false, true]) {
    test(flag + (split ? " split" : " equals") + " keeps all tests in one profile and preserves arguments", () => {
      const t = setup(["TestA", "TestB", "FuzzD"])
      try {
        const profile = join(t.dir, "profile with spaces.out")
        const args = split ? ["-test." + flag, profile] : ["-test." + flag + "=" + profile]
        const r = t.run(args, { GO_TEST_SHARDS: "3" })
        assert.equal(r.status, 0, r.stdout + r.stderr)
        assert.deepEqual(readFileSync(profile, "utf8").trim().split("\n").sort(), ["FuzzD", "TestA", "TestB"], "profile must contain every test")
        assert.equal(r.runs.length, 1, "concurrent profiles overwrite the same output path")
        assert.deepEqual(r.runs[0], ["-test.timeout=40m0s", "-test.short=true", ...args])
      } finally {
        t.done()
      }
    })
  }
}

test("profiling retains failures and their output", () => {
  const t = setup(["TestA", "TestFails", "TestC"])
  try {
    const r = t.run(["-test.trace=" + join(t.dir, "trace.out")], { GO_TEST_SHARDS: "3" })
    assert.equal(r.status, 1)
    assert.match(r.stdout, /--- FAIL: TestFails/)
    assert.equal(r.runs.length, 1)
    assert.deepEqual(ran(r.stdout), ["TestA", "TestC", "TestFails"])
  } finally {
    t.done()
  }
})

for (const flag of ["memprofilerate", "blockprofilerate", "mutexprofilefraction"]) {
  test(flag + " without an output file still shards ordinary tests", () => {
    const t = setup(["TestA", "TestB", "TestC"])
    try {
      const args = ["-test." + flag + "=1"]
      const r = t.run(args, { GO_TEST_SHARDS: "3", BARRIER: "3" })
      assert.equal(r.status, 0, r.stdout + r.stderr)
      assert.equal(r.runs.length, 3)
      for (const argv of r.runs) assert.deepEqual(argv.slice(0, 3), ["-test.timeout=40m0s", "-test.short=true", ...args])
      assert.deepEqual(ran(r.stdout), ["TestA", "TestB", "TestC"])
    } finally {
      t.done()
    }
  })
}
