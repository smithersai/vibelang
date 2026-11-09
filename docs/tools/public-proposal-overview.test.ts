import { expect, test } from "bun:test"
import fc from "fast-check"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function internalAttributions(text: string) {
  return text.match(/\([^()\n]*\b(?:effectscript|smithers|claude)-\d+[a-z]?\b[^()\n]*\)/giu) ?? []
}
test("the public proposal overview keeps internal review attribution out of its source and generated page", () => {
  for (const file of ["docs/design/vips/README.md", "site/src/pages/vips/index.mdx"]) {
    expect(internalAttributions(readFileSync(resolve(import.meta.dir, "../..", file), "utf8"))).toEqual([])
  }
})
test("the attribution check catches generated review identifiers", () => {
  fc.assert(fc.property(
    fc.constantFrom("effectscript", "smithers", "claude"),
    fc.integer({ min: 0, max: 999999 }),
    fc.constantFrom("", "a", "b"),
    (prefix, id, suffix) => {
      const attribution = "(" + prefix + "-" + id + suffix + ", 2026-01-02, 03:04Z)"
      expect(internalAttributions("A rule " + attribution + " requires a preserving fix.")).toEqual([attribution])
    },
  ), { numRuns: 200 })
})
test("the attribution check preserves public proposal references and dates", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 9999 }), id => {
    expect(internalAttributions("A rule (VIP-" + id + ", 2026-01-02) requires a preserving fix.")).toEqual([])
    expect(internalAttributions("A public model (claude-opus-4-1) is named here.")).toEqual([])
  }), { numRuns: 200 })
})

test("rendered proposal checks quote the current public overview", () => {
  const checks = readFileSync(resolve(import.meta.dir, "../../site/scripts/proposal-overview.test.mjs"), "utf8")
  const patterns = [...checks.matchAll(/assert\.match\(text, \/(.*)\/([a-z]*)\)/g)]
  expect(patterns.length).toBeGreaterThanOrEqual(2)
  for (const file of ["docs/design/vips/README.md", "site/src/pages/vips/index.mdx"]) {
    const source = readFileSync(resolve(import.meta.dir, "../..", file), "utf8")
    for (const [, pattern, flags] of patterns) expect(source).toMatch(new RegExp(pattern, flags))
  }
})
