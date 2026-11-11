import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
test("Node name discovery includes computed names and aliases without executing bodies or hooks", t => {
  const dir = mkdtempSync(join(tmpdir(), "node-name-discovery-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, "computed.test.mjs")
  writeFileSync(file, 'import nodeTest, {test as check,before} from "node:test";\n' +
    'before(()=>{throw Error("HOOK_EXECUTED")});\n' +
    'for(const mode of ["native","stock","explicit"]) check(mode+" case",()=>{throw Error("BODY_EXECUTED")});\n' +
    'nodeTest.skip("skipped name",()=>{throw Error("SKIP_EXECUTED")});')
  const env = {...process.env}; delete env.NODE_TEST_CONTEXT
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("./testing/node-test-names.mjs", import.meta.url)), file],
    {env,encoding:"utf8",timeout:20_000})
  assert.equal(run.status,0,run.stdout+run.stderr)
  const line = run.stdout.split("\n").find(line=>line.startsWith("NODE_TEST_NAMES "))
  assert.deepEqual(JSON.parse(line.slice(16)),["native case","stock case","explicit case","skipped name"])
})
