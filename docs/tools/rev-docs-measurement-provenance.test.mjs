// A guide that reports measurements from a past release names the Effect
// version that release pinned. The Effect bump's literal step moves every
// written copy of the current pin, so a record that names the current pin
// would be rewritten by the next bump and stop describing its measurement.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import fc from "fast-check"
import { rewrite } from "../../.smithers/flows/effect-bump/lib/literals.mjs"

const read = path => readFileSync(new URL(path, import.meta.url), "utf8")

// The Effect version each release's runtime manifest pinned, for the releases
// a guide cites measurements from. 0.0.10 moved to 4.0.6 (release notes,
// "Effect 4.0.6 and failures"), so 0.0.9 pinned the version before it.
const RELEASE_PINS = { "0.0.9": "4.0.5" }

const RECORD = /\bfrom the (\d+\.\d+\.\d+) alpha review\b[^.]*?\bEffect (\d+\.\d+\.\d+)(?![\d.]*\d)/g

// records lists each measurement record in text: its release and Effect version.
const records = text => [...text.matchAll(RECORD)].map(m => ({ quote: m[0], release: m[1], effect: m[2] }))

// problems lists the records whose Effect version is not their release's pin.
function problems(text, pins = RELEASE_PINS) {
  return records(text).flatMap(record => {
    const pin = pins[record.release]
    if (pin === undefined) return [`"${record.quote}" cites release ${record.release}, whose Effect pin is not recorded`]
    return record.effect === pin ? [] : [`"${record.quote}" names Effect ${record.effect}, and ${record.release} pinned ${pin}`]
  })
}

// pages lists every Markdown file under a directory, as paths relative to it.
function pages(directory, prefix = "") {
  return readdirSync(new URL(directory + prefix, import.meta.url), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(directory, prefix + entry.name + "/") : entry.name.endsWith(".md") ? [prefix + entry.name] : [])
}

const compare = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number)
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}
const currentPin = JSON.parse(read("../../packages/runtime/package.json")).peerDependencies.effect
const GUIDE = "../user/src/vibelang-features/114-vibelang-for-effect-users.md"

test("every measurement record in the user guides names its release's Effect pin", () => {
  const found = pages("../user/src/").flatMap(page => problems(read("../user/src/" + page)).map(problem => page + ": " + problem))
  assert.deepEqual(found, [])
  assert.deepEqual(records(read(GUIDE)).map(record => [record.release, record.effect]), [["0.0.9", RELEASE_PINS["0.0.9"]]])
})

test("the recorded pins agree with the release notes", () => {
  const notes = read("../user/src/setup/release-notes.md")
  const start = notes.indexOf("\n## 0.0.10\n"), end = notes.indexOf("\n## 0.0.9\n")
  assert.ok(start >= 0 && end > start, "the release notes keep their 0.0.10 and 0.0.9 sections")
  assert.ok(notes.slice(start, end).includes("Use exactly `effect@4.0.6`"), "0.0.10 is the release that moved to effect 4.0.6")
  assert.ok(compare(RELEASE_PINS["0.0.9"], "4.0.6") < 0, "0.0.9 pinned an earlier Effect than the release after it")
})

test("an Effect bump leaves a correct record alone and would rewrite one that names the current pin", () => {
  const guide = read(GUIDE)
  const next = currentPin.replace(/\d+$/, patch => String(Number(patch) + 1))
  assert.deepEqual(records(rewrite(guide, currentPin, next)), records(guide))
  const wrong = `These are observations from the 0.0.9 alpha review on Linux x64, Node 26 and Effect ${currentPin}.`
  assert.equal(problems(wrong).length, 1)
  assert.notDeepEqual(records(rewrite(wrong, currentPin, next)), records(wrong))
})

test("the rewritten forms of the 0.0.9 record are rejected and the original is accepted", () => {
  const sentence = version => `These are single-machine observations from the 0.0.9 alpha review on Linux x64, Node 26 and Effect ${version}. They are not a performance guarantee.`
  assert.deepEqual(problems(sentence("4.0.5")), [])
  for (const version of ["4.0.6", "4.1.0", "4.2.0"]) {
    assert.deepEqual(problems(sentence(version)), [
      `"from the 0.0.9 alpha review on Linux x64, Node 26 and Effect ${version}" names Effect ${version}, and 0.0.9 pinned 4.0.5`,
    ])
  }
  assert.deepEqual(problems("Observations from the 0.0.7 alpha review on Effect 4.0.5."), [
    "\"from the 0.0.7 alpha review on Effect 4.0.5\" cites release 0.0.7, whose Effect pin is not recorded",
  ])
  assert.deepEqual(problems("The alpha review verified it with 0.64.3. Effect 4.0.6 already ships this module."), [])
})

const version = fc.tuple(fc.nat(9), fc.nat(99), fc.nat(99)).map(parts => parts.join("."))

test("fast-check: a record is accepted only with its release's pin, in any wording between the two", () => {
  fc.assert(fc.property(version, version, version,
    fc.constantFrom(" on Linux x64, Node 26 and ", " on ", ", on macOS arm64 with Bun and ", " with "),
    fc.constantFrom("These are single-machine observations ", "The numbers below come ", "Timings "),
    (release, pin, other, middle, lead) => {
      const pins = { [release]: pin }
      const sentence = effect => `${lead}from the ${release} alpha review${middle}Effect ${effect}. They are not a guarantee.`
      assert.deepEqual(problems(sentence(pin), pins), [])
      assert.equal(problems(sentence(other), pins).length, other === pin ? 0 : 1)
      assert.equal(problems(sentence(pin), {}).length, 1)
      assert.deepEqual(records(sentence(pin)), [{ quote: `from the ${release} alpha review${middle}Effect ${pin}`, release, effect: pin }])
    }), { seed: 4005, numRuns: 400, examples: [["0.0.9", "4.0.5", "4.1.1", " on Linux x64, Node 26 and ", "These are single-machine observations "]] })
})
