import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import test from "node:test"

const root = fileURLToPath(new URL("../design/src/", import.meta.url))
test("all grammar definitions live once in Appendix A Productions and chapter citations resolve", () => {
  const appendix = readFileSync(root + "900-appendices.md", "utf8")
  const section = appendix.slice(appendix.indexOf("### Productions"), appendix.indexOf("## Appendix B"))
  const definitions = (s) => [...s.matchAll(/```text\n([\s\S]*?)```/g)]
    .flatMap((b) => [...b[1].matchAll(/^([A-Z][A-Za-z0-9]*)\s*=\s/gm)].map((m) => m[1]))
  const all = definitions(appendix)
  const productions = definitions(section)
  assert.equal(new Set(all).size, all.length, "a production must have exactly one definition")
  assert.deepEqual([...all].sort(), [...productions].sort(), "every definition belongs under Productions")
  for (const name of all) {
    const anchor = name.toLowerCase()
    assert.ok(appendix.includes('id="' + anchor + '"') || appendix.includes("#### " + name + "\n"),
      name + " needs a stable anchor")
  }
  for (const file of readdirSync(root).filter((f) => f.endsWith(".md") && f !== "900-appendices.md")) {
    const text = readFileSync(root + file, "utf8")
    assert.deepEqual(definitions(text), [], file + " duplicates grammar")
    for (const [, label, anchor] of text.matchAll(/\[([A-Z][A-Za-z0-9]*)\]\(900-appendices\.md#([a-z]+)\)/g)) {
      assert.ok(productions.includes(label), file + ": undefined production " + label)
      assert.equal(anchor, label.toLowerCase(), file + ": unstable production anchor")
    }
  }
})

test("stream-loop restrictions agree with completion dispatch to the loop itself", () => {
  const running = readFileSync(root + "002-running.md", "utf8")
  const section = running.split("## `for try`")[1].split("## Producers")[0]
  assert.ok(running.includes("a `break` naming it, as `return false`"),
    "shared completion dispatch must handle a label on the stream loop")
  assert.ok(section.includes("naming a statement outside the `for try` statement"),
    "EK2003 must reject external targets without rejecting the loop itself")
})

test("chapter production citations use stable Appendix A links", () => {
  const appendix = readFileSync(root + "900-appendices.md", "utf8")
  const names = new Set([...appendix.matchAll(/^([A-Z][A-Za-z0-9]*)\s*=\s/gm)].map((m) => m[1]))
  for (const file of readdirSync(root).filter((f) => f.endsWith(".md") && f !== "900-appendices.md")) {
    const prose = readFileSync(root + file, "utf8").replace(/```[^\n]*\n[\s\S]*?```/g, "")
    for (const [, name] of prose.matchAll(/`([A-Z][A-Za-z0-9]*)`/g)) {
      assert.ok(!names.has(name), file + ": cite [" + name + "](900-appendices.md#" + name.toLowerCase() + ")")
    }
  }
})
