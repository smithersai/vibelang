import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = process.env.SPEC_TEST_ROOT ?? fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
const appendix = read("docs/design/src/900-appendices.md")
const tooling = read("docs/design/vips/0034-compiler-and-tooling.md")

// VIP-34: "Each VIP's rules take one fresh hundred-block of diagnostic
// codes, `EKvvxx` for VIP-vv; an older code is kept only where its rule is
// unchanged." VIP-8 denies resource syntax; it cannot own a current rule.
function problems(catalog, vip) {
  const rows = catalog.split("\n").filter(line => line.startsWith("| `EK0801` |"))
  const found = []
  if (rows.length !== 1) found.push("one assignment")
  if (!rows.every(row => /\| warning:/.test(row))) found.push("warning severity")
  if (!rows.every(row => /\| 34 \|/.test(row))) found.push("accepted owner")
  const numbering = catalog.slice(catalog.indexOf("## Appendix B"), catalog.indexOf("The old `EK2101`"))
  if (!numbering.includes("`EK0801`,")) found.push("retained code")
  if (!/\*\*Status:\*\* accepted/.test(vip)) found.push("accepted VIP")
  if (!vip.includes("`EK0801`") || !/`using` in effect code/.test(vip) || !/`acquireDisposable` inside `scoped`/.test(vip)) found.push("public trigger and repair")
  return found
}

test("the retained resource warning has accepted tooling authority", () => {
  assert.deepEqual(problems(appendix, tooling), [])
})

test("authority checks reject denied owners and preserve severity and assignment", () => {
  const row = appendix.split("\n").find(line => line.startsWith("| `EK0801` |"))
  assert.ok(row)
  // Keyed mutation corpus: each key keeps its meaning when cases are reordered.
  const cases = {
    "denied-vip8": [appendix.replace(row, row.replace(/\| \d+ \|/, "| 8 |")), tooling, "accepted owner"],
    "missing-row": [appendix.replace(row, ""), tooling, "one assignment"],
    "duplicate-row": [appendix.replace(row, row + "\n" + row), tooling, "one assignment"],
    "error-severity": [appendix.replace(row, row.replace("warning:", "error:")), tooling, "warning severity"],
    "unretained-code": [appendix.replace("`EK0801`,", ""), tooling, "retained code"],
    "missing-amendment": [appendix, tooling.replaceAll("`EK0801`", "`EK9999`"), "public trigger and repair"],
    "denied-tooling": [appendix, tooling.replace("**Status:** accepted", "**Status:** denied"), "accepted VIP"],
  }
  for (const [key, [catalog, vip, expected]] of Object.entries(cases)) assert.ok(problems(catalog, vip).includes(expected), key)
  // Explore neighbouring owners and layout without inventing language rules.
  let seed = 900
  for (let i = 0; i < 256; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const owner = seed % 40 + 1
    const changed = appendix.replace(row, row.replace(/\| \d+ \|/, `| ${owner} |`))
    assert.equal(problems(changed, tooling).includes("accepted owner"), owner !== 34, `owner:${owner}`)
  }
})
