import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8")
const appendix = () => read("design/src/900-appendices.md")

test("the complete interim block follows the landed registry, with meanings and retirement owners", () => {
  const inventory = appendix().split("### Transitional compiler diagnostics")[1]?.split("\n## ")[0]
  assert.ok(inventory, "Appendix B must distinguish emitted compatibility checks from normative rules")
  const registry = read("../typescript/tsc/internal/vibelang/diagnostics.go")
  const rules = [
    [9201, "error", "1, 3", /expected failure.*written error contract/],
    [9202, "error", "1, 3", /requirement.*written requirement contract/],
    [9203, "error", "1, 4", /plain return annotation.*runs an Effect or can fail/],
    [9204, "warning", "5", /old Effect `try`.*no expected errors/],
    [9205, "error", "1, 9", /declaration without a body.*return type.*not an Effect/],
    [9206, "error", "1, 3", /recursive function.*success type.*own result/],
    [9207, "error", "9", /service or control.*body or initializer/],
    [9208, "error", "9", /static service member.*same name.*instance service member/]
  ]
  const registered = [...registry.matchAll(/EK(92\d\d) = message\((92\d\d), (error|warning)Category,/g)]
  assert.deepEqual(registered.map(m => Number(m[1])).sort(), rules.map(r => r[0]))
  for (const [code, severity, owner, meaning] of rules) {
    assert.ok(registered.some(m => Number(m[1]) === code && Number(m[2]) === code && m[3] === severity))
    const row = inventory.split("\n").find(line => line.startsWith("| interim `EK" + code + "` |"))
    assert.ok(row, "missing emitted compatibility code EK" + code)
    assert.ok(row.includes("| " + severity + ":") && row.includes("| " + owner + " |"), row)
    assert.match(row, meaning)
  }
  assert.deepEqual([...inventory.matchAll(/\| interim `EK(\d+)`/g)].map(m => Number(m[1])).sort(), rules.map(r => r[0]))
  assert.match(inventory, /infallible Effect.*still run/s)
  assert.match(inventory, /control.*historical.*not.*accepted/s)
  assert.doesNotMatch(inventory, /interim `EK(?:2001|2002|2004)`/)
})

test("each existing migration warning has an Appendix B row and an owning VIP amendment", () => {
  for (const [code, file, vip] of [
    [4853, "fix_omitted_requirement.go", "0003-effect-type-shorthand.md"],
    [4854, "fix_service_declarations.go", "0009-service-declarations.md"],
    [4855, "fix_service_declarations.go", "0009-service-declarations.md"]
  ]) {
    const source = read("../typescript/tsc/internal/vibelang/" + file)
    assert.match(source, new RegExp("EK" + code + " = message\\(" + code + ", warningCategory,"))
    const row = appendix().split("\n").find(line => line.startsWith("| `EK" + code + "` |"))
    assert.ok(row?.includes("| warning: migration"), "missing migration-warning row EK" + code)
    assert.ok(read("design/vips/" + vip).includes("`EK" + code + "`"), "missing owning VIP amendment EK" + code)
  }
})
