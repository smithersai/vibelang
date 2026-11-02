import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = fileURLToPath(new URL("./go-test-shards.sh", import.meta.url))
const realAwk = spawnSync("sh", ["-c", "command -v awk"], { encoding: "utf8" }).stdout.trim()
const realSort = spawnSync("sh", ["-c", "command -v sort"], { encoding: "utf8" }).stdout.trim()
const peer = `#!${process.execPath}
import { appendFileSync } from "node:fs"
if (process.argv.includes("-test.list")) { console.log("TestA\\nTestB\\nTestC"); process.exit(0) }
appendFileSync(process.env.PARTITION_RUNS, JSON.stringify(process.argv.slice(2)) + "\\n")
const run = process.argv.find(arg => arg.startsWith("-test.run="))?.slice("-test.run=".length)
for (const name of ["TestA", "TestB", "TestC"]) if (!run || new RegExp(run).test(name)) console.log("EXEC " + name)
`
const awk = `#!/bin/sh
phase=weights
dir=
for arg in "$@"; do
 case $arg in i=*) phase=slice ;; k=*) phase=partition ;; dir=*) dir=\${arg#dir=} ;; esac
done
if [ "$PARTITION_FAULT" = "$phase" ]; then
 if [ "$PARTITION_PARTIAL" = yes ]; then
   if [ "$phase" = weights ] || [ "$phase" = slice ]; then echo '1 TestA'; else echo TestA > "$dir/names0"; fi
 fi
 echo "fixture $phase write failed" >&2
 exit "$PARTITION_CODE"
fi
exec "$PARTITION_AWK" "$@"
`
const sort = `#!/bin/sh
if [ "$PARTITION_FAULT" = sort ]; then
 [ "$PARTITION_PARTIAL" != yes ] || echo '1 TestA'
 echo 'fixture sort write failed' >&2
 exit "$PARTITION_CODE"
fi
exec "$PARTITION_SORT" "$@"
`

const faults = [{ phase: "none", partial: false, code: 0 },
  ...["weights", "sort", "slice", "partition"].flatMap(phase =>
    [false, true].flatMap(partial => [1, 7, 137].map(code => ({ phase, partial, code }))))]
for (const { phase, partial, code } of faults) {
  test("Go shard partitioning preserves completeness: " + JSON.stringify({ phase, partial, code }), t => {
    const root = mkdtempSync(join(tmpdir(), "go shard partition-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    for (const dir of ["bin", "tmp"]) mkdirSync(join(root, dir))
    writeFileSync(join(root, "bin/awk"), awk, { mode: 0o700 })
    writeFileSync(join(root, "bin/sort"), sort, { mode: 0o700 })
    const binary = join(root, "peer.mjs"), runs = join(root, "runs.jsonl")
    writeFileSync(binary, peer, { mode: 0o700 })
    const copy = join(root, "go-test-shards.sh")
    writeFileSync(copy, readFileSync(script), { mode: 0o700 })
    const result = spawnSync("sh", [copy, binary, "-test.v"], {
      cwd: root, encoding: "utf8", timeout: 15_000,
      env: {
        ...process.env, PATH: join(root, "bin") + delimiter + process.env.PATH,
        TMPDIR: join(root, "tmp"), GO_TEST_SLICE: "", GO_TEST_SHARDS: "3", PARTITION_FAULT: phase,
        PARTITION_AWK: realAwk, PARTITION_SORT: realSort, PARTITION_RUNS: runs,
        PARTITION_PARTIAL: partial ? "yes" : "no", PARTITION_CODE: String(code)
      }
    })
    assert.equal(result.error, undefined, result.stderr)
    assert.deepEqual(readdirSync(join(root, "tmp")), [], "temporary partition files are removed")
    if (phase === "none") {
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("EXEC ")).sort(),
        ["EXEC TestA", "EXEC TestB", "EXEC TestC"])
      assert.equal(readFileSync(runs, "utf8").trim().split("\n").length, 3)
    } else {
      assert.notEqual(result.status, 0, "a partial partition must not become a green subset of the suite: " + result.stdout)
      assert.match(result.stderr, new RegExp("fixture " + phase + " write failed"))
      assert.doesNotMatch(result.stdout, /EXEC /, "no test runs from an incomplete partition")
      const stages = { weights: "weighting", sort: "sorting", slice: "slicing", partition: "partitioning" }
      assert.match(result.stderr, new RegExp("go-test-shards: " + stages[phase] + " tests failed"))
    }
  })
}
