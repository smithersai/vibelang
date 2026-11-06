import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { join } from "node:path"
import test from "node:test"
import progress from "./testing/migrate-progress.mjs"
import { checkProperty } from "./testing/property.mjs"

const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const parse = text => text.split("\n").filter(line => line.startsWith("[migrate-test] "))
  .map(line => JSON.parse(line.slice(15)))

test("migration progress preserves late failures and aggregate counts across large file sets", async () => {
  await checkProperty(fc, {
    name: "migration-progress-large-file-sets",
    rule: "Successful file progress must not hide failures; counts cover completed summaries and unfinished files stay explicit.",
    command: "node --test scripts/migrate-progress.property.test.mjs",
    numRuns: 40,
    arbitrary: fc.record({
      files: fc.integer({ min: 201, max: 700 }),
      passed: fc.integer({ min: 0, max: 30 }),
      skipped: fc.integer({ min: 0, max: 5 }),
      todo: fc.integer({ min: 0, max: 5 }),
      output: fc.boolean(),
      witness: fc.string({ minLength: 1, maxLength: 20 }),
    }),
    async check(input) {
      const witness = "FAILURE_NEIGHBOUR_" + JSON.stringify(input.witness)
      async function* events() {
        for (let i = 0; i < input.files; i++) {
          const file = join(process.cwd(), "fixture", `control-${i}.test.mjs`)
          yield { type: "test:pass", data: { file, name: "control" } }
          if (input.output) yield { type: "test:stdout", data: { file, message: "successful property metadata\n" } }
          yield { type: "test:summary", data: { file, success: true, counts: {
            tests: input.passed + input.skipped + input.todo,
            passed: input.passed, skipped: input.skipped, todo: input.todo,
          } } }
        }
        const file = join(process.cwd(), "fixture", "failure.test.mjs")
        yield { type: "test:stderr", data: { file, message: "LOAD_FAILURE_NEIGHBOUR" } }
        yield { type: "test:fail", data: { file, name: "late failure", details: { error: new Error(witness) } } }
        yield { type: "test:summary", data: { file, success: false, counts: { tests: 1, failed: 1 } } }
      }
      let output = ""
      for await (const line of progress(events())) output += line
      const visible = parse(output.split("\n").slice(0, 200).join("\n"))
      assert.ok(visible.some(record => record.event === "test-failed" && record.error.includes(witness)))
      assert.ok(visible.some(record => record.event === "failure-output" && record.output.includes("LOAD_FAILURE_NEIGHBOUR")))
      assert.ok(!output.includes("successful property metadata"))
      const final = parse(output).at(-1)
      assert.equal(final.filesCompleted, input.files + 1)
      assert.deepEqual(final.counts, {
        tests: input.files * (input.passed + input.skipped + input.todo) + 1,
        passed: input.files * input.passed, failed: 1, cancelled: 0,
        skipped: input.files * input.skipped, todo: input.files * input.todo,
      })
      assert.equal(final.success, false)
    },
  })
})

test("actual migration progress keeps todo and skip semantics over generated mixed checks", async t => {
  const dir = mkdtempSync(join(tmpdir(), "migrate-progress-flags-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const reporter = fileURLToPath(new URL("./testing/migrate-progress.mjs", import.meta.url))
  await checkProperty(fc, {
    name: "migration-progress-failure-flags",
    rule: "Real Node failure records retain their todo reason and skip state; skipped or todo checks never change the command's successful exit into a failure.",
    command: "node --test scripts/migrate-progress.property.test.mjs",
    numRuns: 24,
    arbitrary: fc.array(fc.record({
      suffix: fc.constantFrom('quoted "name"', "newline\nname", "Unicode ☃", "backslash\\name"),
      todo: fc.constantFrom(false, true, 'future "reason"\n☃'),
      skip: fc.constantFrom(false, true, "skip control"),
      fails: fc.boolean()
    }), { minLength: 1, maxLength: 12 }),
    async check(items) {
      const file = join(dir, "flags.test.mjs")
      const cases = items.map((item, i) => ({ ...item, name: i + " " + item.suffix }))
      writeFileSync(file, 'import { test } from "node:test"\nimport assert from "node:assert/strict"\n' +
        cases.map(item => 'test(' + JSON.stringify(item.name) + ', ' + JSON.stringify({ todo: item.todo, skip: item.skip }) +
          ', () => ' + (item.fails ? 'assert.fail("GENERATED_FAILURE")' : '{}') + ')').join("\n"))
      const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
      const result = spawnSync(process.execPath, ["--test", "--test-reporter=" + reporter, file], { env, encoding: "utf8", timeout: 10000 })
      assert.ifError(result.error)
      assert.equal(result.signal, null)
      const failed = parse(result.stdout).filter(record => record.event === "test-failed")
      const want = cases.filter(item => item.fails && !item.skip)
      assert.deepEqual(failed.map(record => record.name), want.map(item => item.name))
      for (let i = 0; i < want.length; i++) {
        assert.equal(!!failed[i].todo, !!want[i].todo)
        if (want[i].todo) assert.equal(failed[i].todo, want[i].todo)
        assert.equal(!!failed[i].skip, false)
        assert.ok(failed[i].error.includes("GENERATED_FAILURE"))
      }
      const ordinaryFailures = want.filter(item => !item.todo).length
      const final = parse(result.stdout).at(-1)
      assert.equal(final.counts.failed, ordinaryFailures)
      assert.equal(final.success, ordinaryFailures === 0)
      assert.equal(result.status, ordinaryFailures > 0 ? 1 : 0)
    }
  })
})
