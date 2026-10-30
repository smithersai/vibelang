import { describe, expect, test } from "bun:test"
import { homeProblems, linkTarget, links, sectionBlocks } from "./check-smithers-content.ts"

describe("links in app.md", () => {
  test("map vibelang.sh pages to their sources", () => {
    expect(linkTarget("https://vibelang.sh/001-onboarding.html")).toEqual({ file: "docs/user/src/001-onboarding.md" })
    expect(linkTarget("https://vibelang.sh/error-management/014-expected-errors.html")).toEqual({ file: "docs/user/src/error-management/014-expected-errors.md" })
    expect(linkTarget("https://vibelang.sh/spec/103-part1-ch03-errors.html")).toEqual({ file: "docs/design/src/103-part1-ch03-errors.md" })
    expect(linkTarget("https://vibelang.sh/")).toEqual({ ok: true })
  })
  test("map smithers.sh blobs to repository files", () => {
    expect(linkTarget("https://smithers.sh/effeck/effeck/blob/main/README.md")).toEqual({ file: "README.md" })
    expect(linkTarget("https://smithers.sh/effeck/effeck/issues")).toEqual({ ok: true })
  })
  test("refuse other hosts and plain http", () => {
    expect(linkTarget("https://example.com/x").error).toBeDefined()
    expect(linkTarget("http://vibelang.sh/001-onboarding.html").error).toBe("not https")
    expect(linkTarget("https://vibelang.sh/001-onboarding")).toEqual({ file: "docs/user/src/001-onboarding.md" })
  })
  test("are collected once, without trailing punctuation", () => {
    expect(links("See https://vibelang.sh/a.html. And (https://vibelang.sh/a.html), https://vibelang.sh/b.html")).toEqual(["https://vibelang.sh/a.html", "https://vibelang.sh/b.html"])
  })
})

test("sectionBlocks reads only the named section", () => {
  const md = "## Install\n\n```sh\nnpm a\n```\n\n## Other\n\n```sh\nnpm b\n```\n"
  expect(sectionBlocks(md, "Install", "sh")).toEqual(["npm a"])
})

describe("home.json", () => {
  const exists = (path: string) => path === "README.md"
  const one = (block: unknown) => JSON.stringify({ blocks: [block] })
  test("accepts a bare blocks array of the kinds smithers.sh renders", () => {
    const doc = JSON.stringify({ blocks: [{ type: "text", text: "x" }, { type: "prompt", title: "Ask" }, { type: "links", links: [{ label: "Docs", url: "https://vibelang.sh/" }] }, { type: "markdown", path: "README.md" }] })
    expect(homeProblems(doc, exists)).toEqual([])
  })
  test("accepts sections with audiences, and every kind the reader knows", () => {
    const doc = JSON.stringify({
      contributors: "anyone",
      sections: [
        { title: "Today", audience: "maintainer", blocks: [{ type: "action", flow: "branch.new", title: "New branch", key: "b" }, { type: "issues" }, { type: "runs" }, { type: "flows" }, { type: "stack" }] },
        { audience: "contributor", blocks: [{ type: "code", title: "Set up", language: "sh", code: "sh scripts/setup.sh" }, { type: "cards", cards: [{ title: "A card", text: "A line." }] }, { type: "app", flow: "issue.new", title: "File", picture: "issue" }] },
        { blocks: [{ type: "hero", title: "VibeLang", tagline: "Effect, readable.", install: "bun create vibelang@latest", actions: [{ label: "Docs", url: "https://vibelang.sh" }] }, { type: "stats", stats: [{ value: "MIT", label: "License" }] }, { type: "releases", releases: [{ name: "0.0.2", url: "https://github.com/smithersai/vibelang/releases", date: "2026-10-19" }] }, { type: "view", flow: "docs" }] }
      ]
    })
    expect(homeProblems(doc, exists)).toEqual([])
  })
  test("refuses a missing markdown file, a bad path and an unknown kind", () => {
    expect(homeProblems(one({ type: "markdown", path: "docs/site/fixed-by-agents.md" }), exists)).toEqual(["markdown file is missing: docs/site/fixed-by-agents.md"])
    expect(homeProblems(one({ type: "markdown", path: "../x.md" }), exists)[0]).toContain("block 0")
    expect(homeProblems(one({ type: "tiles" }), exists)).toEqual(["section 0, block 0: unknown type tiles, which smithers.sh skips", "home.json declares no blocks"])
  })
  test("refuses what the reader refuses", () => {
    expect(homeProblems(one({ type: "text", text: "<b>bold</b>" }), exists)[0]).toContain("breaks its kind's schema")
    expect(homeProblems(one({ type: "links", links: [{ label: "x", url: "javascript:alert(1)" }] }), exists)[0]).toContain("block 0")
    expect(homeProblems(one({ type: "releases", releases: [{ name: "1", url: "https://x.test", date: "2026-02-30" }] }), exists)[0]).toContain("block 0")
    expect(homeProblems(JSON.stringify({ blocks: [], sections: [] }), exists)[0]).toContain("not both")
    expect(homeProblems(JSON.stringify({ blocks: [], contributors: "all" }), exists)[0]).toContain("contributors")
    expect(homeProblems(JSON.stringify({ sections: [{ audience: "admins", blocks: [] }] }), exists)[0]).toContain("section 0")
    expect(homeProblems(JSON.stringify({ sections: Array.from({ length: 9 }, () => ({ blocks: [] })) }), exists)[0]).toContain("more than 8 sections")
    expect(homeProblems(JSON.stringify({ blocks: Array.from({ length: 33 }, () => ({ type: "runs" })) }), exists)[0]).toContain("more than 32 blocks")
  })
  test("refuses an empty, unparsable or oversized document", () => {
    expect(homeProblems(JSON.stringify({ blocks: [] }), exists)).toEqual(["home.json declares no blocks"])
    expect(homeProblems("not json", exists)).toEqual(["home.json is not JSON"])
    expect(homeProblems(JSON.stringify({ blocks: [{ type: "text", text: "x".repeat(4000) }], pad: "x".repeat(130 * 1024) }), exists)[0]).toBe("home.json is over 128 KiB")
  })
})
