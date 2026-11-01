import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

function prefix() {
  const source = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
  const target = source.split('"go-vibelangfuzz": goVibelang(')[1].split('"spec-tests":')[0]
  return target.match(/`([^`]+)`\s*\+/)[1].replace(/\$\{effect\}/g, "EFFECT_NODE_MODULES=unused")
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "fuzz-resources-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const output = join(dir, "env")
  writeFileSync(join(dir, "go"), "#!/bin/sh\nprintf \"%s\\n\" \"${GOMAXPROCS-}\" \"${GOFLAGS-}\" > \"$FUZZ_ENV_OUTPUT\"\n", { mode: 0o700 })
  return {
    dir,
    run(command = ["/bin/sh", ["-c", prefix() + "go"]]) {
      const result = spawnSync(command[0], command[1], {
        env: { ...process.env, PATH: dir + ":" + process.env.PATH, GOMAXPROCS: "1", GOFLAGS: "-p=1", FUZZ_ENV_OUTPUT: output },
        encoding: "utf8", timeout: 10_000,
      })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return readFileSync(output, "utf8").trim().split("\n")
    },
  }
}

for (const cpus of [1, 2, 8, 24, 48, 128]) test("the fuzz shell caps seed concurrency on " + cpus + " CPUs", t => {
  const f = fixture(t)
  // Both probes agree without an affinity restriction. Pin the boundary
  // behaviour independently of the real-affinity regression below.
  for (const probe of ["getconf", "node"]) {
    writeFileSync(join(f.dir, probe), "#!/bin/sh\necho " + cpus + "\n", { mode: 0o700 })
  }
  assert.deepEqual(f.run(), [String(Math.min(cpus, 24)), "-p=6"])
})

test("the real fuzz CPU probe respects the process affinity", {
  skip: process.platform !== "linux" ? "taskset affinity regression requires Linux" : false,
}, async t => {
  const available = spawnSync("taskset", ["--version"], { encoding: "utf8" })
  assert.equal(available.status, 0, "install taskset to run the affinity regression")
  const list = readFileSync("/proc/self/status", "utf8").match(/^Cpus_allowed_list:\s*(.+)$/m)[1]
  const cpus = list.split(",").flatMap(range => {
    const [first, last = first] = range.split("-").map(Number)
    return Array.from({ length: last - first + 1 }, (_, i) => first + i)
  })
  for (const width of [...new Set([1, Math.min(4, cpus.length), Math.min(8, cpus.length)])]) {
    await t.test("a real " + width + "-CPU mask", t => {
      const f = fixture(t)
      const mask = cpus.slice(0, width).join(",")
      assert.deepEqual(f.run(["taskset", ["-c", mask, "/bin/sh", "-c", prefix() + "go"]]), [String(width), "-p=6"])
    })
  }
})
