// The retained Effect error inventory has one authority: the table in chapter
// 4's "Retained fixed patterns". The compiler's guard table implements it, and
// the guides and the migration rules repeat its size and the Effect version it
// belongs to. This keeps the three in step, so an Effect bump that adds a
// tagged error cannot leave a guide on the old count or the old version.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import fc from "fast-check"

const read = path => readFileSync(new URL(path, import.meta.url), "utf8")

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
const spell = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "")
const WORDS = Array.from({ length: 100 }, (_, n) => spell(n))
const APOSTROPHE = "['" + String.fromCharCode(8217) + "]"
// "Effect 4.1.1's thirty-four tagged errors", "Effect 4.1.1 also retains
// thirty-four tagged error patterns", "the thirty-four retained Effect error
// patterns", "34 retained errors": a size, with the version when one is written.
const CLAIM = new RegExp(
  "(?:\\bEffect (\\d+\\.\\d+\\.\\d+)(?:" + APOSTROPHE + "s| (?:also )?retains) )?"
    + "\\b(\\d+|" + [...WORDS].sort((a, b) => b.length - a.length).join("|") + ")"
    + " (retained (?:Effect )?error(?: pattern| constructor)?s|tagged error(?: pattern)?s)\\b",
  "gi"
)

// claims lists every statement of the inventory's size in text. "Two tagged
// errors" with no version beside it describes some program's errors, not the
// inventory.
function claims(text) {
  return [...text.matchAll(CLAIM)].filter(m => m[1] !== undefined || m[3].toLowerCase() !== "tagged errors").map(m => ({
    quote: m[0],
    version: m[1],
    count: /^\d+$/.test(m[2]) ? Number(m[2]) : WORDS.indexOf(m[2].toLowerCase()),
  }))
}

// problems lists the claims in text that differ from the inventory.
function problems(text, { pin, count }) {
  return claims(text).flatMap(claim => [
    ...(claim.count === count ? [] : [`"${claim.quote}" counts ${claim.count}, and the inventory has ${count}`]),
    ...(claim.version === undefined || claim.version === pin ? [] : [`"${claim.quote}" names Effect ${claim.version}, and the pin is ${pin}`]),
  ])
}

// specInventory reads chapter 4's table: one row per retained error, tested by
// its module's guard alone and extracting the subject.
function specInventory(chapter) {
  const start = chapter.indexOf("\n## Retained fixed patterns\n")
  assert.ok(start >= 0, "chapter 4 has its Retained fixed patterns section")
  const end = chapter.indexOf("\n## ", start + 1)
  const section = chapter.slice(start, end < 0 ? undefined : end)
  const guards = [...section.matchAll(/^\| `[\w.]+`(?: \(`effect\/[\w/]+`\))? \| `\w+\.(is\w+)\(s\)` \| `\[s\]` \|$/gm)].map(m => m[1])
  const stated = claims(section).filter(claim => claim.version !== undefined)
  assert.equal(stated.length, 1, "the section states the pinned Effect version and the inventory's size once")
  return { guards, pin: stated[0].version, count: stated[0].count }
}

// compilerInventory reads every guard name in the compiler's fixedErrorGuards.
function compilerInventory(source) {
  const table = /\nvar fixedErrorGuards = map\[string\]map\[string\]string\{\n([\s\S]*?)\n\}\n/.exec(source)
  assert.ok(table, "the compiler declares fixedErrorGuards")
  return [...table[1].matchAll(/"\w+":\s*"(is\w+)"/g)].map(m => m[1])
}

// pages lists every Markdown file under a directory, as paths relative to it.
function pages(directory, prefix = "") {
  return readdirSync(new URL(directory + prefix, import.meta.url), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(directory, prefix + entry.name + "/") : entry.name.endsWith(".md") ? [prefix + entry.name] : [])
}

const spec = specInventory(read("../design/src/004-match.md"))
const GUIDE = "../user/src/vibelang-features/116-match-and-is.md"
const RULES = "../../.smithers/flows/migrate/rules.md"
// A release note records what a past change did, so its counts are history.
const guidance = [
  ...pages("../user/src/").filter(page => page !== "setup/release-notes.md").map(page => "../user/src/" + page),
  RULES,
  "../../.smithers/flows/migrate/context.md",
  "../../packages/compiler/skills/vibelang/SKILL.md",
  "../../README.md",
]

test("chapter 4, the compiler and the runtime's pin agree on the retained Effect errors", () => {
  assert.deepEqual([...spec.guards].sort(), compilerInventory(read("../../typescript/tsc/internal/vibelang/match_builtins.go")).sort())
  assert.equal(new Set(spec.guards).size, spec.guards.length, "a guard appears once")
  assert.equal(spec.count, spec.guards.length, "chapter 4's prose counts its own rows")
  assert.equal(spec.pin, JSON.parse(read("../../packages/runtime/package.json")).peerDependencies.effect)
  for (const chapter of ["../design/src/003-failures.md", "../design/src/004-match.md", "../design/src/008-runtime.md"]) {
    assert.deepEqual(problems(read(chapter), spec), [], chapter)
  }
})

test("the guides and the migration rules state chapter 4's inventory and Effect version", () => {
  for (const file of guidance) assert.deepEqual(problems(read(file), spec), [], file)
  for (const file of [GUIDE, RULES]) assert.ok(claims(read(file)).length > 0, `${file} states the inventory's size`)
  assert.ok(claims(read(GUIDE)).some(claim => claim.version === spec.pin), "the guide names the pinned Effect version beside the size")
})

test("the former guide and rule sentences are rejected", () => {
  const inventory = { pin: "4.1.1", count: 34 }
  assert.deepEqual(problems("Effect 4.1.0 also retains thirty-three tagged error patterns, including `Csv.CsvError`.", inventory), [
    "\"Effect 4.1.0 also retains thirty-three tagged error patterns\" counts 33, and the inventory has 34",
    "\"Effect 4.1.0 also retains thirty-three tagged error patterns\" names Effect 4.1.0, and the pin is 4.1.1",
  ])
  assert.deepEqual(problems("Qualified constructors in the thirty-three retained Effect error patterns use their native module guards.", inventory), [
    "\"thirty-three retained Effect error patterns\" counts 33, and the inventory has 34",
  ])
  assert.deepEqual(problems("Effect 4.1.1 also retains thirty-four tagged error patterns; the thirty-four retained error constructors; 34 retained errors.", inventory), [])
  assert.deepEqual(problems("Effect's retained errors extract the subject, and a union of two tagged errors keeps both guards.", inventory), [])
})

const version = fc.tuple(fc.nat(99), fc.nat(99), fc.nat(99)).map(parts => parts.join("."))
const phrase = fc.constantFrom(
  (pin, size) => `Effect ${pin} also retains ${size} tagged error patterns`,
  (pin, size) => `Effect ${pin} retains ${size} tagged error patterns`,
  (pin, size) => `Effect ${pin}'s ${size} tagged errors`,
  (pin, size) => `Effect ${pin}` + String.fromCharCode(8217) + `s ${size} tagged errors`,
)
const unversioned = fc.constantFrom(
  size => `the ${size} retained Effect error patterns`,
  size => `the ${size} retained error constructors`,
  size => `all ${size} retained error patterns`,
  size => `${size} retained errors`,
)

test("fast-check: a size or version that differs from the inventory is reported, and a matching one is not", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 99 }), fc.integer({ min: 1, max: 99 }), version, version, phrase, unversioned, fc.boolean(), fc.boolean(),
    (count, other, pin, otherPin, versioned, plain, digits, capital) => {
      const write = n => digits ? String(n) : capital ? spell(n)[0].toUpperCase() + spell(n).slice(1) : spell(n)
      const inventory = { pin, count }
      assert.deepEqual(problems(`Prose. ${versioned(pin, write(count))}, and ${plain(write(count))}.`, inventory), [])
      assert.deepEqual(claims(versioned(pin, write(count))), [{ quote: versioned(pin, write(count)), version: pin, count }])
      assert.equal(problems(plain(write(other)), inventory).length, other === count ? 0 : 1)
      assert.equal(problems(versioned(otherPin, write(other)), inventory).length, (other === count ? 0 : 1) + (otherPin === pin ? 0 : 1))
    }), { seed: 4034, numRuns: 500, examples: [[34, 33, "4.1.1", "4.1.0", (pin, size) => `Effect ${pin} also retains ${size} tagged error patterns`, size => `the ${size} retained Effect error patterns`, false, false]] })
})

test("fast-check: every size up to ninety-nine has one spelling, and prose without a size makes no claim", () => {
  assert.equal(new Set(WORDS).size, 100)
  fc.assert(fc.property(fc.constantFrom("retained Effect errors", "tagged errors", "a retained error's extractor", "untagged errors merge", "ordinary and tagged errors"),
    fc.constantFrom("Effect's", "its", "These", "the", "and"), (noun, lead) => {
      assert.deepEqual(claims(`${lead} ${noun} keep their module guards.`), [])
    }), { seed: 4035, numRuns: 100 })
})
