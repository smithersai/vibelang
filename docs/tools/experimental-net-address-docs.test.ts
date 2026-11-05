import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

test("the experimental module catalog lists the pure IPv6 predicate once", () => {
  const guide = read("../user/src/vibelang-features/118-experimental-platform-apis.md")
  const rows = guide.split("\n").filter(line => line.startsWith("| `Experimental.NetAddress` |"))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toContain("isIPv6")
  expect(rows[0]).toContain("none (pure)")
})

test("platform migration guidance preserves scoped IPv6 acceptance without a service", () => {
  const guide = read("../user/src/platform/platform-globals.md")
  expect(guide.includes("`Experimental.NetAddress.isIPv6(address)`")).toBe(true)
  expect(guide.includes("It needs no layer or `try`.")).toBe(true)
  expect(guide.includes("unsigned 32-bit range")).toBe(true)
  expect(guide.includes("`NetAddress.ipv6FromString`")).toBe(true)
})
