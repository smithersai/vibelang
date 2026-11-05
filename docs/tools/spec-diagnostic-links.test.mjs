import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { SpecPath } from "../../scripts/testing/spec-path.mjs"

const chapter = name => readFileSync(SpecPath(name + ".md"), "utf8")

// Each Appendix B row links the chapter section that defines its rule, so the
// linked section names the row's code.
const slug = heading => heading.trim().toLowerCase().replaceAll("`", "").replace(/[^\w\- ]/g, "").replaceAll(" ", "-")

function section(text, anchor) {
  const lines = text.split("\n")
  let fenced = false
  const counts = new Map()
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("```")) { fenced = !fenced; continue }
    if (fenced) continue
    const heading = lines[i].match(/^(#+) (.+)$/)
    let fragment
    if (heading) {
      const base = slug(heading[2])
      const count = counts.get(base) ?? 0
      counts.set(base, count + 1)
      fragment = count ? base + "-" + count : base
    }
    const named = heading && fragment === anchor
    if (!named && !lines[i].includes(`<a id="${anchor}"></a>`)) continue
    const level = named ? heading[1].length : 6
    let inner = false
    let j = i + 1
    for (; j < lines.length; j++) {
      if (lines[j].startsWith("```")) { inner = !inner; continue }
      const next = inner ? null : lines[j].match(/^(#+) /)
      if (next && next[1].length <= level) break
    }
    return lines.slice(i, j).join("\n")
  }
  return undefined
}

test("every Appendix B row links a section that names its code", () => {
  const rows = [...chapter("900-appendices").matchAll(/^\| `(EK\d+)` \|.*\]\((?:([0-9]{3}-[a-z-]+)\.md)?(?:#([^)]+))?\)/gm)]
  assert.ok(rows.length > 200, "Appendix B rows")
  const unnamed = []
  for (const [, code, file, anchor] of rows) {
    const name = file ?? "900-appendices"
    const text = chapter(name)
    const body = anchor ? section(text, anchor) : text
    assert.ok(body !== undefined, `${code}: ${name}#${anchor} does not exist`)
    if (!body.includes(code)) unnamed.push(`${code} -> ${name}#${anchor ?? ""}`)
  }
  assert.deepEqual(unnamed, [])
})

const duplicateMeaning = JSON.parse(readFileSync(new URL("./property-regressions/r36-ek4857-duplicate-meaning.json", import.meta.url), "utf8"))

test("R36 OPUS-1: a duplicate Meaning fragment resolves the intended definition", () => {
  const { source, code, first, second, parent } = duplicateMeaning
  assert.ok(!section(source, first).includes(code), "the first Meaning is a different section")
  assert.ok(section(source, second)?.includes(code), "the numbered Meaning belongs to the shorthand")
  assert.ok(section(source, parent).includes(code), "the shorthand parent includes its definition")
})

test("fast-check: duplicate heading fragments preserve their occurrence and section boundary", () => {
  fc.assert(fc.property(
    fc.integer({ min: 2, max: 8 }),
    fc.integer({ min: 0, max: 100 }),
    fc.boolean(),
    (count, padding, fenced) => {
      const entries = Array.from({ length: count }, (_, i) =>
        "## Owner " + i + "\n\n### Meaning\n\n" + "\n".repeat(padding)
          + "occurrence-" + i + "\n"
          + (fenced ? "\n```md\n### Meaning\n<a id=\"ghost\"></a>\n```\n" : "")
          + "\n#### Detail\n\nchild-" + i + "\n")
      const source = entries.join("\n")
      for (let i = 0; i < count; i++) {
        const body = section(source, "meaning" + (i ? "-" + i : ""))
        assert.ok(body?.includes("occurrence-" + i), "duplicate fragment selects occurrence " + i)
        assert.ok(body.includes("child-" + i), "a child heading remains in its parent")
        for (let j = 0; j < count; j++) if (i !== j) {
          assert.ok(!body.includes("occurrence-" + j), "sibling sections stay separate")
        }
      }
      assert.equal(section(source, "meaning-" + count), undefined, "a missing fragment stays missing")
      assert.equal(section(source, "ghost"), undefined, "fenced explicit anchors are text")
      const explicit = "<a id=\"real\"></a>\n\ndefinition\n\n## Next\n\nother\n"
      assert.ok(section(explicit, "real").includes("definition"))
      assert.ok(!section(explicit, "real").includes("other"))
    },
  ), { seed: 3601, numRuns: 240 })
})

// Appendix B defines each printed identity and links its rule chapter. Keep the
// repair reference on the executable witness so native and mapper hosts agree.
const repairExamples = JSON.parse(readFileSync(new URL(
  "../../typescript/vibelang/cases/appendix-diagnostic-identities/examples.json", import.meta.url), "utf8"))
  .filter(example => example.repairReference)

function repairReferenceFindings(examples, readChapter = chapter) {
  return examples.flatMap(example => {
    const match = /^([0-9]{3}-[a-z-]+)#([a-z0-9-]+)$/.exec(example.repairReference)
    assert.ok(match, example.code + ": invalid repair reference")
    const body = section(readChapter(match[1]), match[2])
    return body !== undefined && new RegExp("\\b" + example.code + "\\b").test(body)
      ? [] : [example.code + " -> " + example.repairReference]
  })
}

test("retained native and mapper witnesses link their diagnostic repair definitions", () => {
  assert.deepEqual(repairExamples.map(example => example.code).sort(),
    ["EK1011", "EK2112", "EK2113", "EK2120", "EK2121", "EK9001", "EK9002", "EK9003", "EK9004"])
  for (const example of repairExamples) {
    assert.ok(example.source || example.archive || example.host, example.code + ": executable host")
    assert.ok(!example.control && !example.retired, example.code + ": active reporting witness")
  }
  assert.deepEqual(repairReferenceFindings(repairExamples), [])
})

test("repair references require a whole identity inside the named section", () => {
  fc.assert(fc.property(fc.constantFrom(...repairExamples), fc.nat({max: 99999}),
    fc.boolean(), fc.boolean(), (example, suffix, present, correctSection) => {
      const fixture = {...example, repairReference: "007-tooling#repair"}
      const code = example.code + (present ? "" : suffix)
      const source = "## " + (correctSection ? "Repair" : "Other") + "\n\n" + code +
        "\n\n## Neighbor\n\n" + example.code + "\n"
      assert.deepEqual(repairReferenceFindings([fixture], () => source),
        present && correctSection ? [] : [example.code + " -> 007-tooling#repair"])
    }), {seed: 349004, numRuns: 120})
})
