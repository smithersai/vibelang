import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import fc from "fast-check"

const vip = (name) => readFileSync(new URL("../design/vips/" + name, import.meta.url), "utf8")

const effectBaseline = (decision) => {
  const version = /tested baseline `(\d+\.\d+\.\d+)`(?![\d.])/.exec(decision)?.[1]
    ?? /the pin is (?:effect|`effect`) (\d+\.\d+\.\d+)(?![\d.])/.exec(decision)?.[1]
  assert.ok(version, "VIP-32 names no Effect baseline")
  return version
}

const effectRange = (decision) => {
  const range = /Effect `(\^\d+\.\d+\.\d+)` semver range/.exec(decision)?.[1]
  assert.ok(range, "VIP-32 names no Effect semver range")
  return range
}

test("VIP-32: the published peers, runtime guard, and compiler enforce the accepted ^4.1.0 range and tested baseline", () => {
  const decision = vip("0032-effect-version.md")
  const baseline = effectBaseline(decision)
  const range = effectRange(decision)
  const repo = (file) => readFileSync(new URL("../../" + file, import.meta.url), "utf8")
  const peer = (dir) => JSON.parse(repo("packages/" + dir + "/package.json")).peerDependencies.effect
  const dev = JSON.parse(repo("packages/runtime/package.json")).devDependencies.effect
  assert.deepEqual({
    compilerPeer: peer("compiler"),
    runtimePeer: peer("runtime"),
    tsMapperPeer: peer("ts-mapper"),
    guardRange: /^const SUPPORTED_EFFECT_RANGE = "([^"]*)"$/m.exec(repo("packages/runtime/src/version-guard.cts"))?.[1],
    checkerRange: /^const supportedEffectRange = "([^"]*)"$/m.exec(repo("typescript/tsc/internal/vibelang/effectavailable.go"))?.[1],
  }, {
    compilerPeer: range,
    runtimePeer: range,
    tsMapperPeer: range,
    guardRange: range,
    checkerRange: range,
  })
  assert.deepEqual({
    runtimeDev: dev,
    guardBaseline: /^const PINNED_EFFECT_VERSION = "([^"]*)"$/m.exec(repo("packages/runtime/src/version-guard.cts"))?.[1],
    checkerBaseline: /^const supportedEffectVersion = "([^"]*)"$/m.exec(repo("typescript/tsc/internal/vibelang/effectavailable.go"))?.[1],
  }, {
    runtimeDev: baseline,
    guardBaseline: baseline,
    checkerBaseline: baseline,
  })
  const [major, minor] = baseline.split(".").map(Number)
  assert.ok(major > 4 || (major === 4 && minor >= 1), "the baseline " + baseline + " is below the 4.1 minimum")
})

const versionParts = fc.tuple(
  fc.integer({ min: 0, max: 99 }),
  fc.integer({ min: 0, max: 999 }),
  fc.integer({ min: 0, max: 999 }),
)

test("fast-check: code formatting preserves an explicit Effect baseline", () => {
  fc.assert(fc.property(versionParts, fc.boolean(), (parts, code) => {
    const version = parts.join(".")
    const spelling = code ? "`effect`" : "effect"
    const decision = "- **Amended 2026-11-03: the pin is " + spelling + " " + version
      + ", and 4.1 is the earliest supported version**"
    assert.equal(effectBaseline(decision), version)
  }), {
    seed: 32021,
    numRuns: 512,
    examples: [[[4, 1, 6], true], [[4, 1, 6], false], [[10, 20, 30], true]],
  })
})

test("fast-check: absent or malformed baselines report the missing decision", () => {
  fc.assert(fc.property(versionParts, fc.constantFrom(
    "missing", "partial", "range", "extra", "open", "close",
  ), (parts, kind) => {
    const version = parts.join(".")
    const text = {
      missing: "No pin is named here.",
      partial: "the pin is `effect` " + parts.slice(0, 2).join("."),
      range: "the pin is effect ^" + version,
      extra: "the pin is effect " + version + ".0",
      open: "the pin is `effect " + version,
      close: "the pin is effect` " + version,
    }[kind]
    assert.throws(() => effectBaseline(text), {
      name: "AssertionError",
      message: "VIP-32 names no Effect baseline",
    })
  }), { seed: 32022, numRuns: 384 })
})
