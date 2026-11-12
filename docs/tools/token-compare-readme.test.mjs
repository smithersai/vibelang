import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// The README's token comparison links .smithers/token-compare/README.md, whose verify.mjs
// compiles and runs users.vibe. That page must not say verification fails for want of forms
// the alpha implements: every VIP it names must be accepted.
const root = fileURLToPath(new URL("../../", import.meta.url))
const readme = readFileSync(root + ".smithers/token-compare/README.md", "utf8")
const vips = root + "docs/design/vips/"

test("the token comparison names only accepted VIPs and no pending verification", () => {
  assert.doesNotMatch(readme, /fails on it until|until the compiler implements/)
  const sentence = /accepted VIP-([\d, and]+?), which the compiler implements/.exec(readme)
  assert.ok(sentence, "the page names the VIPs users.vibe uses")
  const numbers = sentence[1].split(/,\s*|\s+and\s+/).map(Number)
  assert.deepEqual(numbers, [1, 5, 6, 9, 12, 13, 18, 26])
  for (const n of numbers) {
    const file = readdirSync(vips).find(name => name.startsWith(String(n).padStart(4, "0") + "-"))
    assert.ok(file, "VIP-" + n)
    assert.match(readFileSync(vips + file, "utf8"), /^\*\*Status:\*\*\s+accepted\b/m, "VIP-" + n + " is accepted")
  }
})
