import "./helpers/jj-config.mjs"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { dependentConsumerPackages } from "../lib/workspace-dependencies.mjs"
import { baselineConsumerTests, makeConfig, verifyConsumerTests } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"

const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

test("#396: dependentConsumerPackages finds transitive importing workspace packages with test scripts", () => {
  const root = mkdtempSync(join(tmpdir(), "rdep-consumers-"))
  try {
    const manifests = [
      { path: "package.json", dir: ".", manifest: { name: "monorepo", private: true, workspaces: ["packages/*", "apps/*"] } },
      { path: "packages/core/package.json", dir: "packages/core", manifest: { name: "@ws/core", version: "1.0.0", scripts: { test: "node test.mjs" } } },
      { path: "packages/mid/package.json", dir: "packages/mid", manifest: { name: "@ws/mid", version: "1.0.0", dependencies: { "@ws/core": "workspace:*" }, scripts: { test: "node test.mjs" } } },
      { path: "apps/web/package.json", dir: "apps/web", manifest: { name: "@ws/web", private: true, dependencies: { "@ws/mid": "workspace:*" }, scripts: { test: "node test.mjs" } } },
      { path: "apps/docs/package.json", dir: "apps/docs", manifest: { name: "@ws/docs", private: true, dependencies: { "@ws/core": "workspace:*" } } },
      { path: "packages/unrelated/package.json", dir: "packages/unrelated", manifest: { name: "@ws/unrelated", version: "1.0.0", scripts: { test: "node test.mjs" } } }
    ]
    for (const m of manifests) put(root, m.path, JSON.stringify(m.manifest))

    const consumers = dependentConsumerPackages(root, manifests, ["packages/core"])
    assert.deepEqual(consumers.map(c => c.dir), ["apps/web", "packages/mid"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#396: verifyConsumerTests runs importing app consumer tests against the matched original baseline and catches regressions", async () => {
  const root = mkdtempSync(join(tmpdir(), "consumer-tests-gate-"))
  try {
    const target = join(root, "repo")
    const logs = join(root, "logs")
    const baselinePath = join(root, "baseline", "consumer-tests.json")
    put(target, "package.json", JSON.stringify({ name: "root", private: true, workspaces: ["packages/*", "apps/*"] }))
    put(target, "packages/core/package.json", JSON.stringify({
      name: "@ws/core",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./index.js" },
      scripts: { test: "node -e 'process.exit(0)'" }
    }))
    put(target, "packages/core/index.js", "export const greeting = () => 'hello';\n")
    put(target, "apps/consumer/package.json", JSON.stringify({
      name: "@ws/consumer",
      private: true,
      type: "module",
      dependencies: { "@ws/core": "workspace:*" },
      scripts: { test: "node test.mjs" }
    }))
    put(target, "apps/consumer/test.mjs", `import { greeting } from "../../packages/core/index.js"
if (greeting() === "hello") {
  console.log("PASS consumer-greeting")
  process.exit(0)
}
console.log("FAIL consumer-greeting")
process.exit(1)
`)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "original")

    const config = makeConfig({
      target,
      packages: ["packages/core"],
      test: "node -e 'process.exit(0)'",
      vibelangVersion: "0.0.14",
      consumerTests: true,
      testReport: "^(?<status>PASS|FAIL) (?<name>.+)$"
    })
    assert.equal(config.consumerTests, true)

    // Original baseline: consumer passes.
    const base = await baselineConsumerTests({ config, baselinePath, logs })
    assert.equal(base.state, "complete")
    assert.equal(base.consumers["apps/consumer"].code, 0)
    assert.equal(base.consumers["apps/consumer"].tests["consumer-greeting"], "passed")

    // Candidate 1: unchanged core -> consumer passes against original baseline.
    const okResult = await verifyConsumerTests({
      config,
      baselinePath,
      logs: join(root, "logs-ok"),
      touchedDirs: ["packages/core"]
    })
    assert.equal(okResult.ok, true, JSON.stringify(okResult))
    assert.deepEqual(okResult.failures, [])

    // Candidate 2: core's own tests still exit 0, but conversion breaks consumer's expectation!
    put(target, "packages/core/index.js", "export const greeting = () => 'broken';\n")
    const badResult = await verifyConsumerTests({
      config,
      baselinePath,
      logs: join(root, "logs-bad"),
      touchedDirs: ["packages/core"]
    })
    assert.equal(badResult.ok, false, JSON.stringify(badResult))
    assert.equal(badResult.failures.length, 1)
    assert.equal(badResult.failures[0].consumer, "apps/consumer")
    assert.deepEqual(badResult.failures[0].newFailures, ["consumer-greeting"])

    // Candidate 3: untouched package does not re-run unrelated consumers.
    const skipped = await verifyConsumerTests({
      config,
      baselinePath,
      logs: join(root, "logs-none"),
      touchedDirs: ["packages/other"]
    })
    assert.equal(skipped.ok, true)
    assert.equal(skipped.state, "not-run")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
