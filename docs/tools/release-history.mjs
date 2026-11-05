import assert from "node:assert/strict"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repository = fileURLToPath(new URL("../../", import.meta.url))
const snapshotPath = "docs/tools/release-publication-snapshot.json"
const stableVersion = /^\d+\.\d+\.\d+$/

export function assertReleaseHistory(notes, version, lastPublishedVersion) {
  assert.doesNotMatch(notes.split(/^## /m)[0], /^Pending fixes for /m, "pending fixes belong inside the candidate version section")
  const [current, previous] = notes.split(/^## /m).slice(1)
  assert.ok(current && previous, "release notes need current and previous sections")
  const heading = /^(\d+\.\d+\.\d+(?:-[\w.-]+)?)( \(unreleased\))?$/.exec(current.split("\n")[0])
  assert.ok(heading, "top release must name a version, optionally marked (unreleased)")
  const previousVersion = previous.split("\n")[0]
  assert.match(previousVersion, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, "the section below must be a published version")
  if (heading[2]) {
    const baseVersion = heading[1] === version ? previousVersion : version
    if (heading[1] !== version) assert.equal(previousVersion, version, "a next-development section follows the compiler version")
    const next = heading[1].split(/[.-]/).slice(0, 3).map(Number)
    const published = baseVersion.split(/[.-]/).slice(0, 3).map(Number)
    const difference = next.map((part, i) => part - published[i]).find(part => part !== 0)
    assert.ok(difference > 0, "the unreleased version must be newer than the published version")
  } else {
    assert.equal(heading[1], version, "a published top section matches the compiler version")
  }
  assert.ok(current.split("\n").includes("### Bugs fixed since " + previousVersion),
    "top release must have ### Bugs fixed since " + previousVersion)
  if (lastPublishedVersion !== undefined) {
    assert.match(lastPublishedVersion, /^\d+\.\d+\.\d+$/, "npm publication snapshot must be a stable version")
    assert.match(version, /^\d+\.\d+\.\d+$/, "candidate must name a stable version")
    const published = lastPublishedVersion.split(".").map(Number)
    const candidate = version.split(".").map(Number)
    const difference = candidate.map((part, i) => part - published[i]).find(part => part !== 0) ?? 0
    assert.ok(difference > 0, "candidate must be newer than the last npm publication")
    assert.ok([version, version + " (unreleased)"].includes(current.split("\n")[0]), "all release fixes belong to the compiler candidate")
    assert.equal(previousVersion, lastPublishedVersion, "release history starts at the version npm actually published")
    for (const [, baseline] of current.matchAll(/^### Upgrade from (\d+\.\d+\.\d+)$/gm)) {
      assert.equal(baseline, lastPublishedVersion, "candidate upgrades start at the last npm publication")
    }
  }
}

function validateSnapshot(snapshot) {
  assert.equal(snapshot?.package, "vibelang", "publication snapshot names the compiler package")
  assert.equal(typeof snapshot.version, "string", "publication snapshot includes a version")
  assert.match(snapshot.version, stableVersion, "publication snapshot must be a stable npm version")
  return snapshot
}

export function readPublicationSnapshot(root = repository) {
  return validateSnapshot(JSON.parse(readFileSync(resolve(root, snapshotPath), "utf8")))
}

// A committed registry receipt keeps ordinary checks offline. Publication refreshes
// it only after npm and the finalized notes agree on the released version.
export function assertRecordedPublication(notes, version, lastPublishedVersion) {
  validateSnapshot({ package: "vibelang", version: lastPublishedVersion })
  if (version !== lastPublishedVersion) {
    assertReleaseHistory(notes, version, lastPublishedVersion)
    return
  }
  assertReleaseHistory(notes, version)
  const current = notes.split(/^## /m)[1]
  const heading = current.split("\n")[0]
  if (heading.replace(/ \(unreleased\)$/, "") === version) {
    assert.equal(heading, version, "a version already published on npm is not unreleased")
  } else {
    for (const [, baseline] of current.matchAll(/^### Upgrade from (\d+\.\d+\.\d+)$/gm)) {
      assert.equal(baseline, lastPublishedVersion, "development upgrades start at the recorded npm publication")
    }
  }
}

export function checkRecordedPublication(root = repository) {
  const notes = readFileSync(resolve(root, "docs/user/src/setup/release-notes.md"), "utf8")
  const version = JSON.parse(readFileSync(resolve(root, "packages/compiler/package.json"), "utf8")).version
  const snapshot = readPublicationSnapshot(root)
  assertRecordedPublication(notes, version, snapshot.version)
  return snapshot
}

export function recordPublicationSnapshot(root, version) {
  const snapshot = validateSnapshot({ package: "vibelang", version })
  const file = resolve(root, snapshotPath)
  if (existsSync(file)) {
    const previous = readPublicationSnapshot(root).version.split(".").map(Number)
    const next = version.split(".").map(Number)
    const change = next.map((part, i) => part - previous[i]).find(part => part !== 0) ?? 0
    assert.ok(change >= 0, "recording npm publication never moves history backwards")
  }
  const notes = readFileSync(resolve(root, "docs/user/src/setup/release-notes.md"), "utf8")
  const compiler = JSON.parse(readFileSync(resolve(root, "packages/compiler/package.json"), "utf8")).version
  assertRecordedPublication(notes, compiler, version)
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n")
  return snapshot
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    assert.ok(args.length === 0 || (args.length === 1 && ["--check", "--record"].includes(args[0])),
      "usage: node docs/tools/release-history.mjs [--check | --record]")
    if (args[0] === "--record") {
      const version = JSON.parse(execFileSync("npm", ["view", "vibelang", "version", "--json", "--registry", "https://registry.npmjs.org"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))
      recordPublicationSnapshot(repository, version)
      console.log("release history: recorded npm publication " + version)
    } else {
      const snapshot = checkRecordedPublication()
      console.log("release history: notes follow recorded npm publication " + snapshot.version)
    }
  } catch (error) {
    console.error("release history: " + error.message)
    process.exitCode = 1
  }
}
