import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { deniedVips, generate, loadRows, outputs, sourcePath, censusSection, isGeneratedCensusSection } from "./generate-grammar-admission.mjs"

const repository = fileURLToPath(new URL("../", import.meta.url))
const generator = fileURLToPath(new URL("./generate-grammar-admission.mjs", import.meta.url))
function fixture() {
  const scratch = join(repository, ".cache/language-tables-tests")
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, "grammar-"))
  for (const path of [sourcePath, ...outputs]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    copyFileSync(join(repository, path), join(root, path))
  }
  const vips = "docs/design/vips"
  mkdirSync(join(root, vips), { recursive: true })
  for (const name of readdirSync(join(repository, vips)))
    if (/^\d{4}.*\.md$/.test(name)) copyFileSync(join(repository, vips, name), join(root, vips, name))
  return root
}
const clean = root => rmSync(root, { recursive: true, force: true })
const save = (root, rows) => writeFileSync(join(root, sourcePath),
  "# Hook\tForm\tAuthority\tStatus\tReason\n" + rows.map(r => Object.values(r).join("\t")).join("\n") + "\n")

test("all grammar admission copies match their source", () => {
  assert.deepEqual(generate(repository, { check: true }), [])
})

test("fresh grammar generation is idempotent and preserves output mtimes", () => {
  const root = fixture()
  try {
    generate(root)
    const before = outputs.map(path => [readFileSync(join(root, path)), statSync(join(root, path)).mtimeMs])
    generate(root)
    for (const [i, path] of outputs.entries()) {
      assert.deepEqual(readFileSync(join(root, path)), before[i][0], path)
      assert.equal(statSync(join(root, path)).mtimeMs, before[i][1], path)
    }
    assert.deepEqual(generate(root, { check: true }), [])
  } finally { clean(root) }
})

// Independent reach oracle: every source column reaches both projections.
test("random source-column mutations fail and name every reached file without writes", () => {
  const root = fixture()
  const original = loadRows(root).filter(r => r.authority !== "-")
  let state = Number(process.env.LANG_TABLES_SEED ?? 0x6772616d) >>> 0
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0)
  const fields = ["hook", "form", "authority", "status", "reason"]
  try {
    const pristine = loadRows(root)
    for (let trial = 0; trial < 100; trial++) {
      const rows = structuredClone(pristine)
      const selected = (trial === 0 ? original.find(r => r.hook.includes("@")) ?? original[0] : original[random() % original.length]).hook
      const row = rows.find(r => r.hook === selected)
      const field = fields[trial % fields.length]
      const witness = random().toString(16)
      if (field === "hook") {
        const occupied = new Set(rows.filter(other => other !== row).map(other => other.hook))
        let changed = row.hook + (row.hook.includes("@") ? "-property-" : "@property-") + witness
        while (occupied.has(changed)) changed += "-next"
        row.hook = changed
      }
      else if (field === "form") row.form += "-property-" + witness
      else if (field === "authority") row.authority = row.authority === "001-functions.md" ? "002-running.md" : "001-functions.md"
      else if (field === "status") row.status = row.status === "support" ? "recovery" : "support"
      else row.reason += " Property witness " + witness
      save(root, rows)
      assert.doesNotThrow(() => loadRows(root), field + "/" + selected)
      const before = outputs.map(path => readFileSync(join(root, path)))
      const result = spawnSync(process.execPath, [generator, "--root", root, "--check"], { encoding: "utf8" })
      assert.equal(result.status, 1, field + ": " + result.stderr)
      const named = result.stderr.split("\n").filter(line => line.startsWith("stale ")).map(line => line.split(";")[0].slice(6))
      assert.deepEqual(named.sort(), [...outputs].sort(), field + "/" + selected)
      for (const [i, path] of outputs.entries()) assert.deepEqual(readFileSync(join(root, path)), before[i], path)
    }
  } finally { clean(root) }
})

test("invalid and duplicate grammar rows fail explicitly", () => {
  const root = fixture()
  const original = loadRows(root)
  try {
    for (const [field, value] of [["hook", "bad"], ["hook", "parser/vibelang_do.go:Parser.test@old@new"], ["form", "bad"], ["authority", "../private.md"],
      ["status", "invented"], ["reason", ""], ["reason", "a\tb"], ["reason", "a\rb"]]) {
      const rows = structuredClone(original)
      rows[0][field] = value
      save(root, rows)
      assert.throws(() => generate(root, { check: true }), /invalid|expected/)
    }
    const pending = structuredClone(original)
    pending[0].authority = "-"
    pending[0].status = "admitted"
    save(root, pending)
    assert.throws(() => generate(root), /without authority must be pending/)
    save(root, [...original, original[0]])
    assert.throws(() => generate(root), /duplicate hook/)
    save(root, [])
    assert.throws(() => generate(root), /empty grammar/)
  } finally { clean(root) }
})

test("a census reason citing a denied VIP states the denial", () => {
  const root = fixture()
  const original = loadRows(root)
  assert.equal(deniedVips(root).has(11), true)
  const hook = "parser/vibelang_trailing_legacy.go:isLegacyTrailingBlockHead"
  assert.match(original.find(r => r.hook === hook).reason, /^Denied by VIP-11; /)
  try {
    const rows = structuredClone(original)
    const row = rows.find(r => r.hook === hook)
    // The landed 2b7c9a5547ff census: spec-rules authority refused it three times.
    row.reason = "VIP-11 and Appendix C: private compatibility decoding only for EK1101 diagnosis"
    save(root, rows)
    assert.throws(() => loadRows(root), /grammar-admission\.tsv:\d+: reason cites denied VIP-11 without stating the denial/)
    row.reason = "VIP-2 pinned do expression and completion support"
    save(root, rows)
    assert.doesNotThrow(() => loadRows(root), "an accepted VIP needs no denial wording")
    row.reason = "Denied by VIP-11; Appendix C private compatibility decoding"
    save(root, rows)
    assert.doesNotThrow(() => loadRows(root))
  } finally { clean(root) }
})

test("a missing inventory is named and a broken section marker is rejected", () => {
  const root = fixture()
  try {
    rmSync(join(root, outputs[0]))
    assert.deepEqual(generate(root, { check: true }), [outputs[0]])
    generate(root)
    const appendix = join(root, outputs[1])
    writeFileSync(appendix, readFileSync(appendix, "utf8").replace("<!-- grammar-admission:end -->", ""))
    assert.throws(() => generate(root, { check: true }), /missing.*grammar-admission:end/)
  } finally { clean(root) }
})

test("generation changes no grammar production or diagnostic prose", () => {
  const root = fixture()
  const strip = text => text.replace(/<!-- grammar-admission:start -->[\s\S]*?<!-- grammar-admission:end -->\n\n/, "")
  try {
    const path = join(root, outputs[1])
    const before = strip(readFileSync(path, "utf8"))
    writeFileSync(path, before)
    generate(root)
    assert.equal(strip(readFileSync(path, "utf8")), before)
    const inventory = readFileSync(join(root, outputs[0]), "utf8").split("\n").filter(l => l && !l.startsWith("#"))
    const source = readFileSync(join(root, sourcePath), "utf8").split("\n").filter(l => l && !l.startsWith("#"))
    assert.deepEqual(inventory, source)
  } finally { clean(root) }
})

test("only a valid generated census frame is exempt from rule evidence", () => {
  const rows = loadRows(repository)
  const section = censusSection(rows)
  assert.equal(isGeneratedCensusSection(section), true)
  const one = censusSection([rows[0]])
  assert.equal(isGeneratedCensusSection(one.replace(rows[0].reason, rows[0].reason + " | forged column")), false)
  assert.equal(isGeneratedCensusSection(censusSection([{ ...rows[0], reason: "metadata | text" }])), true)
  for (const invalid of [
    censusSection([]),
    censusSection([rows[0], rows[0]]),
    censusSection([{ ...rows[0], authority: "-", status: "admitted" }]),
    censusSection([{ ...rows[0], reason: "text\nAn operand must compile." }]),
    section.replace("(" + rows.length + " records)", "(0 records)"),
    section.replace("generate-grammar-admission.mjs", "manual.mjs"),
    section.replace("\n\n</details>", "\nA `try` must compile.\n\n</details>")
  ]) assert.equal(isGeneratedCensusSection(invalid), false)
})
