import "./helpers/jj-config.mjs"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { measureTests } from "../lib/measurement.mjs"
import { must, quote } from "../lib/util.mjs"

const put = (root, file, value) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), value) }
const workspaces = async target => (await must("jj workspace list -T " + quote('name ++ "\\n"'), { cwd: target })).stdout.split("\n").filter(Boolean)

async function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "migrate-measure-leftovers-"))
  try {
    const target = join(root, "repo"), run = join(root, "run")
    put(target, "package.json", JSON.stringify(JSON.parse(readFileSync(new URL("./corpus/smithers-driver-rules.json", import.meta.url))).measurementManifest))
    put(target, "a.test.mjs", 'import {test} from "node:test";test("contract",()=>{})')
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj commit -m main && jj bookmark set main -r @-", { cwd: target })
    const config = { target, packages: [{ dir: "." }], install: "true", test: { command: "node --test --test-reporter=spec a.test.mjs", cwd: "." }, main: "main" }
    await body({ root, target, run, config })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// Issue 530: a killed run leaves its workspaces; the next measurement of the batch clears them.
test("a measurement proceeds past the workspaces and directories a killed run left", () => fixture(async ({ target, run, config }) => {
  const out = join(run, "measure", "01")
  mkdirSync(out, { recursive: true })
  await must("jj workspace add " + quote(join(out, "main")) + " --name migrate-tests-1-1-main -r main", { cwd: target })
  put(out, "previous/stray", "left by a killed run")
  await must("jj workspace add " + quote(join(dirname(run), "elsewhere")) + " --name migrate-tests-2-2-main -r main", { cwd: target })
  const result = await measureTests(config, { run, batch: "01" })
  assert.equal(result.ok, true)
  assert.equal(existsSync(join(out, "main")), false)
  assert.equal(existsSync(join(out, "previous")), false)
  assert.deepEqual((await workspaces(target)).sort(), ["default", "migrate-tests-2-2-main"])
}))

test("a failed cleanup step neither hides the measurement's error nor stops the other cleanups", () => fixture(async ({ target, run, config }) => {
  // The job hides the repository, so every forget in cleanup fails after the job itself fails.
  const measureCommand = "mv .jj .jj-hidden && echo measured-failure >&2 && exit 3"
  await assert.rejects(measureTests({ ...config, measureCommand }, { run, batch: "01" }), error => error.message.includes("measured-failure"))
  assert.equal(existsSync(join(run, "measure", "01", "main")), false)
  assert.equal(existsSync(join(run, "measure", "01", "previous")), false)
}))

