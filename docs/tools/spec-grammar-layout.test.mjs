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

test("stream-loop labels: a self-label is the loop's own jump; enclosing targets are rejected", () => {
  const running = readFileSync(root + "002-running.md", "utf8")
  const appendix = readFileSync(root + "900-appendices.md", "utf8")
  const section = running.split("## `for try`")[1].split("## Producers")[0]
  // A jump naming the for try itself is its own unlabeled jump, as ECMAScript's LoopContinues
  // tests the loop's label set; only statements enclosing the loop are rejected.
  assert.ok(section.includes("naming a statement that encloses the `for try`"))
  assert.ok(section.includes("break scan   // return false"))
  assert.ok(section.includes("continue scan               // return true"))
  assert.ok(running.includes("a `for try` consumes `continue`, or a `continue` naming it, as `return true` and `break`, or a `break` naming it, as `return false`"))
  assert.ok(!running.includes("including the `for try` statement itself"))
  assert.ok(appendix.includes("to a statement that encloses the `for try`; one naming the `for try` itself is its unlabeled"))
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
