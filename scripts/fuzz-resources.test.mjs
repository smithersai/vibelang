import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

for (const cpus of [2, 48]) test("the fuzz shell caps seed concurrency on " + cpus + " CPUs", () => {
  const source = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
  const target = source.split("\"go-vibelangfuzz\": goVibelang(")[1].split("\"spec-tests\":")[0]
  const prefix = target.match(/`([^`]+)`\s*\+/)[1].replace(/\$\{effect\}/g, "EFFECT_NODE_MODULES=unused")
  const dir = mkdtempSync(join(tmpdir(), "fuzz-resources-"))
  try {
    const output = join(dir, "env")
    writeFileSync(join(dir, "getconf"), "#!/bin/sh\necho " + cpus + "\n", { mode: 0o700 })
    writeFileSync(join(dir, "go"), "#!/bin/sh\nprintf \"%s\\n\" \"${GOMAXPROCS-}\" \"${GOFLAGS-}\" > \"$FUZZ_ENV_OUTPUT\"\n", { mode: 0o700 })
    const result = spawnSync("/bin/sh", ["-c", prefix + "go"], {
      env: { ...process.env, PATH: dir + ":" + process.env.PATH, GOMAXPROCS: "1", GOFLAGS: "-p=1", FUZZ_ENV_OUTPUT: output },
      encoding: "utf8"
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(readFileSync(output, "utf8").trim().split("\n"), [String(Math.min(cpus, 24)), "-p=6"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
