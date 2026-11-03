// rule-evidence: docs/design/vips/0004-throw.md#f43abcba01c5b779
// VIP-4: The proposed generated toFixed/repeat contracts include RangeError, even for the
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const { entries } = JSON.parse(readFileSync(new URL("../../../../docs/design/inventory/throws.json", import.meta.url), "utf8"))
for (const [declaration, expected] of [["Number.toFixed", "RangeError"], ["String.repeat", "RangeError"], ["URL", "TypeError"]]) {
  const signatures = entries.filter(e => e.module === "global" && e.declaration === declaration)
  assert.ok(signatures.length, declaration)
  assert.ok(signatures.every(e => e.ownThrows === expected), declaration + ": " + signatures.map(e => e.ownThrows).join(", "))
}
console.log("validator metadata matches whole-signature failure classes")
