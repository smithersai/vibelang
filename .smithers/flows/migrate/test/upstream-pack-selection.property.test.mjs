import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { packRepository, comparePacks } from "../lib/pack-policy.mjs"
import { must } from "../lib/util.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const fc = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("fast-check")
const rule = "Compare only packages that packed on the original tree; every original success must still pack and retain its file list."
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-versionless-private-upstream-pack.json", import.meta.url)))
const write = (root, file, value) => {
  mkdirSync(join(root, file, ".."), { recursive: true })
  writeFileSync(join(root, file), typeof value === "string" ? value : JSON.stringify(value))
}
const fixture = async body => {
  const root = mkdtempSync(join(process.env.TMPDIR || "/tmp", "upstream-selection-"))
  try { await body(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
async function workspace(root, { versioned = false, field = "dependencies", protocol = "workspace:*", privateValue = true } = {}) {
  write(root, "package.json", { name: "workspace", private: true })
  write(root, "pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n  - '!packages/excluded'\n")
  write(root, "packages/provider/package.json", { name: "@t3tools/provider-acp", private: privateValue, ...(versioned ? { version: "1.0.0" } : {}) })
  write(root, "packages/server/package.json", { name: "t3", version: "0.1.3", files: ["index.js"], [field]: { "@t3tools/provider-acp": protocol } })
  write(root, "packages/server/index.js", "export const server = 1\n")
  write(root, "packages/launcher/package.json", { name: "t3-launcher", version: "1.0.0", files: ["index.js"] })
  write(root, "packages/launcher/index.js", "export const launcher = 1\n")
  write(root, "packages/excluded/package.json", { name: "excluded", version: "1.0.0", scripts: { prepack: "exit 42" } })
  await must("pnpm install --offline --ignore-scripts --lockfile=false", { cwd: root })
  return { target: root, packer: "pnpm", packages: [{ dir: "packages/server" }, { dir: "packages/launcher" }] }
}

test("t3code: upstream pack failure is recorded and skipped; a working launcher stays compared", () => fixture(async root => {
  const config = await workspace(root, corpus.input)
  const before = await packRepository(config, join(root, "logs-before"), { upstream: true })
  assert.deepEqual(Object.keys(before.packages), ["packages/launcher"])
  assert.equal(before.skipped["packages/server"].reason, "upstream-pack-failed")
  assert.equal(before.skipped["packages/server"].code, 1)
  assert.match(readFileSync(join(root, "logs-before", before.skipped["packages/server"].log), "utf8"), /ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL/)
  assert.equal(before.skipped["packages/provider"].reason, "private")
  assert.equal(before.skipped["packages/excluded"].reason, "not-workspace-member")
  const after = await packRepository(config, join(root, "logs-after"), { baseline: before })
  assert.deepEqual(after.packages, before.packages)
  assert.equal(after.skipped["packages/server"].reason, "upstream-pack-failed")
  assert.deepEqual(comparePacks(before, after).skipped, before.skipped)
  assert.equal(comparePacks(before, after).ok, true)
  // Repairing an upstream exclusion must not silently enlarge the comparison.
  write(root, "packages/provider/package.json", { name: "@t3tools/provider-acp", version: "1.0.0", private: true })
  const repaired = await packRepository(config, join(root, "logs-repaired"), { baseline: before })
  assert.deepEqual(repaired.packages, before.packages)
}))

test("negative control: a migration breaking a pack that worked must fail, not become an exclusion", () => fixture(async root => {
  const config = await workspace(root, { versioned: true })
  const before = await packRepository(config, join(root, "logs-before"), { upstream: true })
  assert.ok(before.packages["packages/server"])
  write(root, "packages/provider/package.json", { name: "@t3tools/provider-acp", private: true })
  await assert.rejects(packRepository(config, join(root, "logs-after"), { baseline: before }), /pack/)
  const omitted = { packages: { "packages/launcher": before.packages["packages/launcher"] }, skipped: { ...before.skipped, "packages/server": { reason: "upstream-pack-failed" } } }
  assert.equal(comparePacks(before, omitted).ok, false)
}))

test("property: publication eligibility and original failures remain stable across workspace dependency variants", async () => {
  await checkProperty(fc, { name: "upstream-pack-selection", rule,
    command: "node --test .smithers/flows/migrate/test/upstream-pack-selection.property.test.mjs",
    arbitrary: fc.record({ versioned: fc.boolean(), field: fc.constantFrom("dependencies", "optionalDependencies", "peerDependencies", "devDependencies"),
      protocol: fc.constantFrom("workspace:*", "workspace:^", "workspace:~"), privateValue: fc.boolean() }),
    check: input => fixture(async root => {
      const config = await workspace(root, input)
      const before = await packRepository(config, join(root, "logs-before"), { upstream: true })
      const after = await packRepository(config, join(root, "logs-after"), { baseline: JSON.parse(JSON.stringify(before)) })
      assert.ok(before.packages["packages/launcher"])
      assert.equal(comparePacks(before, after).ok, true)
      assert.equal(before.skipped["packages/excluded"].reason, "not-workspace-member")
      if (input.privateValue) assert.equal(before.skipped["packages/provider"].reason, "private")
      else if (!input.versioned) assert.equal(before.skipped["packages/provider"].reason, "missing-version")
      const broken = structuredClone(after)
      broken.packages["packages/launcher"].files.push("new-private-cache.json")
      assert.equal(comparePacks(before, broken).ok, false)
      const lost = structuredClone(after)
      delete lost.packages["packages/launcher"]
      assert.equal(comparePacks(before, lost).ok, false)
    }), numRuns: 32, regressions: new URL("./corpus/", import.meta.url) })
})

test("pnpm publishConfig.directory supplies the actual publication even when source dependencies cannot pack", () => fixture(async root => {
  const config = await workspace(root)
  const manifest = JSON.parse(readFileSync(join(root, "packages/server/package.json")))
  manifest.publishConfig = { directory: "release" }
  write(root, "packages/server/package.json", manifest)
  write(root, "packages/server/release/package.json", { name: "t3", version: "0.1.3", files: ["index.js"] })
  write(root, "packages/server/release/index.js", "export const launcher = 1\n")
  const before = await packRepository(config, join(root, "logs-before"), { upstream: true })
  assert.ok(before.packages["packages/server"], "the manager, rather than a workspace-dependency heuristic, chooses the publication")
  assert.deepEqual(before.packages["packages/server"].files, ["index.js", "package.json"])
  assert.equal(before.skipped["packages/server/release"].reason, "not-workspace-member")
  const after = await packRepository(config, join(root, "logs-after"), { baseline: before })
  assert.equal(comparePacks(before, after).ok, true)
}))

for (const stage of ["pack", "prepack"]) test(stage + " lifecycle failures are upstream exclusions, never candidate exclusions", () => fixture(async root => {
  write(root, "package.json", { name: "lifecycle", version: "1.0.0", scripts: { [stage]: "exit 7" } })
  const config = { target: root, packer: "npm" }
  const before = await packRepository(config, join(root, "logs-before"), { upstream: true })
  assert.equal(before.skipped["."].reason, "upstream-pack-failed")
  assert.equal(before.skipped["."].stage, stage === "pack" ? "pack-script" : "pack")
  assert.equal(before.skipped["."].code, 7)
  assert.deepEqual(JSON.parse(readFileSync(join(root, "logs-before/selection.json"))), before)
  await assert.rejects(packRepository(config, join(root, "logs-strict")), /pack.*failed/)
  write(root, "package.json", { name: "lifecycle", version: "1.0.0" })
  const working = await packRepository(config, join(root, "logs-working"), { upstream: true })
  write(root, "package.json", { name: "lifecycle", version: "1.0.0", scripts: { [stage]: "exit 7" } })
  await assert.rejects(packRepository(config, join(root, "logs-broken"), { baseline: working }), /pack.*failed/)
}))

test("property: exclusions cannot hide original successes, lost files or added sidecars, including old receipts", async () => {
  await checkProperty(fc, { name: "upstream-pack-comparison", rule,
    command: "node --test .smithers/flows/migrate/test/upstream-pack-selection.property.test.mjs",
    arbitrary: fc.record({ dir: fc.constantFrom(".", "packages/a", "apps/server"), legacy: fc.boolean(),
      reason: fc.constantFrom("private", "missing-version", "upstream-pack-failed"), defect: fc.constantFrom("missing", "extra", "sidecar", "dropped") }),
    check: ({ dir, legacy, reason, defect }) => {
      const before = { packages: { [dir]: { files: ["package.json", "index.js"] } }, ...legacy ? {} : { skipped: { ignored: { reason } } } }
      const after = structuredClone(before)
      after.skipped = { ...after.skipped, [dir]: { reason } }
      if (defect === "dropped") delete after.packages[dir]
      else if (defect === "missing") after.packages[dir].files.pop()
      else after.packages[dir].files.push(defect === "sidecar" ? "index.d.vibe.ts" : "extra.js")
      assert.equal(comparePacks(before, after).ok, false)
      const repairedExclusion = { ...structuredClone(before), packages: { ...before.packages, ignored: { files: ["package.json"] } } }
      assert.equal(comparePacks(before, repairedExclusion).ok, !legacy && reason === "upstream-pack-failed")
      assert.equal(comparePacks(undefined, after).ok, false)
    }, numRuns: 250, regressions: new URL("./corpus/", import.meta.url) })
})

test("one-pass measurement reuses the original selection for all sides and still rejects new pack failures", () => fixture(async root => {
  const { runMeasurementJob } = await import("../lib/measurement.mjs")
  const config = await workspace(root)
  write(root, "smoke.test.mjs", 'import { test } from "node:test"; test("unchanged", () => {})\n')
  const packBaseline = await packRepository(config, join(root, "logs-original"), { upstream: true })
  const manifest = { job: "pack-selection", out: join(root, "measurement"),
    test: { command: "node --test --test-reporter=spec smoke.test.mjs" },
    sides: ["main", "previous", "candidate"].map(name => ({ name, target: root })),
    build: { packages: config.packages, packer: config.packer, toolchain: { kind: "registry" } }, packBaseline }
  await runMeasurementJob(manifest)
  const result = JSON.parse(readFileSync(join(manifest.out, "receipts.json")))
  for (const side of manifest.sides) {
    assert.deepEqual(result.packs[side.name].packages, packBaseline.packages)
    assert.equal(result.packs[side.name].skipped["packages/server"].reason, "upstream-pack-failed")
    assert.equal(result.receipts[side.name].code, 0)
  }
  write(root, "packages/launcher/package.json", { name: "t3-launcher", version: "1.0.0", scripts: { prepack: "exit 9" } })
  await assert.rejects(runMeasurementJob({ ...manifest, out: join(root, "broken"), sides: [{ name: "candidate", target: root }] }), /pack.*failed/)
}))

test("making a formerly private package public is still a public-package-set change", () => fixture(async root => {
  const config = await workspace(root, { versioned: true })
  const before = await packRepository(config, join(root, "logs-before"), { upstream: true })
  write(root, "packages/provider/package.json", { name: "@t3tools/provider-acp", private: false, version: "1.0.0", publishConfig: { access: "restricted" } })
  const after = await packRepository(config, join(root, "logs-after"), { baseline: before })
  assert.ok(after.packages["packages/provider"], "restricted packages remain publications")
  assert.equal(comparePacks(before, after).ok, false)
}))
