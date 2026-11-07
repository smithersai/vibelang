import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8")

// The built export check in bugbash4-docs needs the runtime's dist. This one reads
// the entry's export list, so a gate can run it on a tree with nothing built.
test("runtime export table lists every name the entry module exports", () => {
  const table = read("packages/runtime/README.md").split("## Public exports")[1].split(/\n## /)[0]
  const list = read("packages/runtime/src/entry.ts").match(/export const \{([\s\S]*?)\} = /)
  assert.ok(list, "entry.ts destructures its exports")
  const names = list[1].split(",").map(name => name.trim().split(":")[0]).filter(Boolean)
  assert.ok(names.includes("$fork"), "the export list holds the generated helpers")
  for (const name of names) assert.ok(table.includes("`" + name + "`"), "undocumented root export: " + name)
})
